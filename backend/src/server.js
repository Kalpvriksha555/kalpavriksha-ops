import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import pg from 'pg';
import nodemailer from 'nodemailer';
import { addCaseTimelineEvent, mergeTimelineEvents, normalizeCaseTimeline, normalizeTimelineEvent } from './services/timelineService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || '';
const USE_POSTGRES = /^postgres(ql)?:\/\//i.test(DATABASE_URL);
const pool = USE_POSTGRES ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
}) : null;
let memoryState = null;
let postgresReady = false;

const safeName = (name='file') => String(name).replace(/[^a-zA-Z0-9.\-_]/g, '_');
const MAX_UPLOAD_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB || 1024);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${nanoid(6)}-${safeName(file.originalname)}`)
  }),
  // Practical production safety limit. Number of files is intentionally not capped.
  limits: { fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024 }
});

function uploadErrorPayload(err) {
  const code = err?.code || '';
  if (code === 'LIMIT_FILE_SIZE') return { status: 413, error: `File is larger than the configured ${MAX_UPLOAD_SIZE_MB} MB upload limit.` };
  if (code === 'LIMIT_UNEXPECTED_FILE') return { status: 400, error: 'Upload field mismatch. Please refresh the page and try again.' };
  return { status: 400, error: err?.message || 'Upload failed before the file reached the server.' };
}
function uploadAny(req, res, next) {
  upload.any()(req, res, (err) => {
    if (err) {
      const payload = uploadErrorPayload(err);
      return res.status(payload.status).json({ ok:false, error:payload.error, code:err.code || 'UPLOAD_ERROR' });
    }
    req.files = Array.isArray(req.files) ? req.files : [];
    next();
  });
}
function uploadSingle(fieldName) {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err) {
        const payload = uploadErrorPayload(err);
        return res.status(payload.status).json({ ok:false, error:payload.error, code:err.code || 'UPLOAD_ERROR' });
      }
      next();
    });
  };
}

const roles = ['ADMIN','MANAGER','DESIGNER'];
const serviceTypes = ['Map Estimate','Key Route + Estimate','Key Layout','Colony Layout','Builder Layout','Sub Division','Floor Plan','Site Plan','Bank Technical Drawing','Other'];
const statuses = ['NEW_LEAD','ASSIGNED','IN_PROGRESS','DESIGN_SUBMITTED','MANAGER_REVIEW','REVISION_REQUIRED','COMPLETED','REOPENED_FOR_REVISION','CLOSED'];
const sourceDocTypes = ['Sale Deed','ATS','Technical Report','GPS Photo','Property Photo','Site Photo','Bank Technical','Admin Instruction','Excel Sheet','Word Document','Image/Photo','AutoCAD DWG/DXF','Other'];
const finalDocTypes = ['Completed PDF','Completed DWG','Completed DXF','Completed Excel','Completed Word','Completed Image/Photo','Revised PDF','Revised DWG/DXF','Other'];

const seed = {
  users:[
    { id: 1, name: 'Ashutosh Rai', username: 'ashutosh', password: '123', role: 'Admin', status: 'APPROVED' },
    { id: 2, name: 'Vaibhav Singh', username: 'vaibhav', password: '123', role: 'Admin', status: 'APPROVED' },
    { id: 3, name: 'Shubham Upadhyay', username: 'shubham', password: '123', role: 'Admin', status: 'APPROVED' },
    { id: 4, name: 'Amit Kushwaha', username: 'amit', password: '123', role: 'Manager', status: 'APPROVED' },
    { id: 5, name: 'Waqar', username: 'waqar', password: '123', role: 'Designer', status: 'APPROVED' },
    { id: 6, name: 'Nilu Gupta', username: 'nilu', password: '123', role: 'Designer', status: 'APPROVED' },
    { id: 7, name: 'Khushbu Pandey', username: 'khushbu', password: '123', role: 'Designer', status: 'APPROVED' }
  ],
  cases:[], deletedProjectIds:[], payments:[], performanceRecords:[], notifications:[], teamChat:[], whatsappInbox:[], audit:[], attendanceLogs:[], chatReads:{ADMIN:[],MANAGER:[],DESIGNER:[]}
};

async function ensurePostgres() {
  if (!USE_POSTGRES || postgresReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS files_meta (
    id text PRIMARY KEY,
    case_id text,
    name text,
    stored_name text,
    mime text,
    size bigint,
    purpose text,
    uploaded_by text,
    uploaded_at timestamptz DEFAULT now(),
    meta jsonb DEFAULT '{}'::jsonb
  )`);
  postgresReady = true;
}

function readJsonFallback(){
  if(!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(seed,null,2));
  return JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
}

async function initStore(){
  if (USE_POSTGRES) {
    await ensurePostgres();
    const row = await pool.query('SELECT value FROM app_state WHERE key=$1', ['main']);
    if (row.rows.length) {
      memoryState = norm(row.rows[0].value);
    } else {
      memoryState = norm(readJsonFallback());
      await pool.query('INSERT INTO app_state(key,value) VALUES($1,$2::jsonb) ON CONFLICT (key) DO NOTHING', ['main', JSON.stringify(memoryState)]);
    }
  } else {
    memoryState = norm(readJsonFallback());
  }
}

function db(){
  if (!memoryState) memoryState = norm(readJsonFallback());
  return structuredClone(memoryState);
}

function save(d){
  const normalized = norm(d);
  memoryState = structuredClone(normalized);

  // Production uses PostgreSQL as the source of truth. Avoid writing the full
  // app_state JSON file on every upload/chat/task action because that synchronous
  // disk write can make file uploads feel slow on a VPS. Keep JSON writes for
  // local fallback mode, or enable WRITE_JSON_BACKUP=true explicitly.
  if (!USE_POSTGRES || process.env.WRITE_JSON_BACKUP === 'true') {
    fs.writeFileSync(DB_FILE, JSON.stringify(normalized,null,2));
  }

  if (USE_POSTGRES) {
    ensurePostgres()
      .then(() => pool.query('INSERT INTO app_state(key,value,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()', ['main', JSON.stringify(normalized)]))
      .catch(err => console.error('PostgreSQL save failed:', err.message));
  }
}

async function loadDb(){
  if (USE_POSTGRES) {
    await ensurePostgres();
    const row = await pool.query('SELECT value FROM app_state WHERE key=$1', ['main']);
    if (row.rows.length) return norm(row.rows[0].value);
  }
  return db();
}

async function getDbStatus(){
  if (USE_POSTGRES) {
    await ensurePostgres();
    const r = await pool.query('SELECT now() as now');
    return { database:'postgresql', connected:true, time:r.rows[0].now };
  }
  return { database:'json-file', connected:true, time:now(), warning:'DATABASE_URL is not set. JSON fallback is not suitable for production.' };
}

function norm(d){
  d ||= structuredClone(seed);
  d.users ||= seed.users; d.cases ||= d.projects || []; d.deletedProjectIds ||= []; d.payments ||= []; d.notifications ||= []; d.teamChat ||= d.chatMessages || []; d.whatsappInbox ||= []; d.audit ||= []; d.attendanceLogs ||= []; d.chatReads ||= {ADMIN:[],MANAGER:[],DESIGNER:[]};
  d.users = cleanTeamUsers(d.users);
  d.performanceRecords = Array.isArray(d.performanceRecords) ? d.performanceRecords : [];
  d.deletedProjectIds = [...new Set((d.deletedProjectIds || []).map(x => String(x)).filter(Boolean))];
  const deletedSet = new Set(d.deletedProjectIds);
  d.cases = (d.cases || []).filter(c => c && !deletedSet.has(String(c.id || '')) && !deletedSet.has(String(c.caseId || '')));
  d.files ||= [];
  d.cases.forEach(c=>{ c.documents ||= []; c.completedFiles ||= c.completedFiles || []; c.history ||= []; c.comments ||= []; c.revisions ||= []; c.timeline = normalizeCaseTimeline(c); c.creatorName ||= c.createdBy || 'Admin'; c.createdAt ||= new Date().toISOString(); });
  d.performanceRecords = mergePerformanceRecords(d.performanceRecords, buildPerformanceRecordsFromCases(d.cases));
  normalizePersistedFileLinks(d);
  return d;
}


function parseDateMs(value){
  if(!value) return 0;
  if(value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  if(typeof value === 'object'){
    if(typeof value.toDate === 'function') return value.toDate().getTime();
    const sec = Number(value.seconds ?? value._seconds ?? value.sec);
    if(Number.isFinite(sec) && sec > 0) return Math.round(sec * 1000 + (Number(value.nanoseconds ?? value._nanoseconds ?? 0) || 0) / 1000000);
  }
  if(typeof value === 'number') return value > 0 && value < 10000000000 ? value * 1000 : value;
  const raw=String(value).trim();
  const num=Number(raw);
  if(Number.isFinite(num) && num > 0) return num < 10000000000 ? num * 1000 : num;
  const direct=new Date(raw).getTime();
  if(!Number.isNaN(direct)) return direct;
  const dmy=raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:[,\s]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if(dmy){
    let [,dd,mm,yyyy,hh='0',min='0',meridian='']=dmy;
    let hour=Number(hh||0); meridian=String(meridian).toLowerCase();
    if(meridian==='pm' && hour<12) hour+=12; if(meridian==='am' && hour===12) hour=0;
    const parsed=new Date(Number(yyyy.length===2?`20${yyyy}`:yyyy), Number(mm)-1, Number(dd), hour, Number(min||0)).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function caseStatusKey(c={}){ return String(c.status || c.reviewStatus || c.finalConclusion || '').toUpperCase().replace(/[^A-Z0-9]/g,''); }
function hasCompletedDeliverableForPerf(c={}){ return (Array.isArray(c.completedFiles) && c.completedFiles.length > 0) || (Array.isArray(c.documents) && c.documents.some(d => ['completed','final','completed file','revised file'].includes(String(d?.type || d?.purpose || '').toLowerCase()))); }
function isCompletedCaseForPerf(c={}){ const k=caseStatusKey(c); return ['COMPLETED','APPROVED','FINALAPPROVED','CLOSED'].includes(k) || !!c.completedAt || hasCompletedDeliverableForPerf(c); }
function isRevisionLedgerClone(c={}){ const id=String(c.id || c.caseId || '').toUpperCase(); return /_REV_|-REV-|REVISION/.test(id) && !!c.parentTaskId; }
function perfOwner(c={}){ return String(c.assigneeName || c.assignedTo || c.assignedToName || c.assignedUserName || c.designerName || c.completedBy || c.ownerName || c.userName || '').trim(); }
function perfTaskId(c={}){ return String(c.originalTaskId || c.rootTaskId || c.parentTaskId || c.caseId || c.id || '').trim(); }
function perfCaseType(c={}){ return String(c.caseType || c.type || c.taskType || c.serviceType || 'Other').trim() || 'Other'; }
function timelineTimes(c={}){ return [...(Array.isArray(c.timeline)?c.timeline:[]), ...(Array.isArray(c.history)?c.history:[])].map(e=>parseDateMs(e.at||e.time||e.timestamp||e.createdAt||e.date)).filter(Boolean); }
function perfBaselineMinutes(c={}){ const t=perfCaseType(c).toUpperCase(); return t.includes('COLONY') ? 180 : t.includes('SUBDIV') ? 150 : t.includes('FLOOR') ? 120 : t.includes('KEY ROUTE') && t.includes('MAP ESTIMATE') ? 95 : t.includes('KEY ROUTE') ? 75 : t.includes('MAP ESTIMATE') ? 55 : 75; }
function perfBreakMinutes(c={}){ const direct=Number(c.breakMinutes || c.breakDurationMinutes || c.totalBreakMinutes || 0) || 0; if(direct>0) return Math.round(direct); return 0; }
function perfRevisionCount(c={}){ return Math.max(Number(c.revisionCount||c.revisionsCount||0)||0, Array.isArray(c.revisions)?c.revisions.length:0, Array.isArray(c.subTasks)?c.subTasks.length:0); }
function buildPerformanceRecordsFromCases(cases=[]){
  const records=[];
  for(const c of Array.isArray(cases)?cases:[]){
    if(!c || !isCompletedCaseForPerf(c) || isRevisionLedgerClone(c)) continue;
    const userName=perfOwner(c); const taskId=perfTaskId(c); if(!userName || !taskId) continue;
    const times=[parseDateMs(c.createdAt), parseDateMs(c.assignedAt), parseDateMs(c.startedAt), parseDateMs(c.draftingStartedAt), parseDateMs(c.completedAt), parseDateMs(c.updatedAt), ...timelineTimes(c)].filter(Boolean);
    const start=parseDateMs(c.startedAt||c.draftingStartedAt||c.workStartedAt) || parseDateMs(c.assignedAt) || (times.length?Math.min(...times):0);
    const latestDocTime = Array.isArray(c.documents) ? Math.max(0, ...c.documents.map(d => parseDateMs(d.uploadedAt || d.createdAt || d.date)).filter(Boolean)) : 0;
    const latestCompletedFileTime = Array.isArray(c.completedFiles) ? Math.max(0, ...c.completedFiles.map(f => parseDateMs(f.uploadedAt || f.createdAt || f.date || f.completedAt)).filter(Boolean)) : 0;
    const end=parseDateMs(c.completedAt||c.finalApprovedAt||c.approvedAt||c.draftingCompletedAt||c.submittedAt||c.updatedAt) || latestCompletedFileTime || latestDocTime || (times.length?Math.max(...times):0);
    let mins=Number(c.completionMinutes||c.durationMinutes||c.completionDurationMinutes||0)||0;
    if(!mins && start && end && end>=start) mins=Math.max(1, Math.round((end-start)/60000));
    if(!mins) mins=perfBaselineMinutes(c);
    mins=Math.max(1, Math.round(mins - perfBreakMinutes(c)));
    const submitted=parseDateMs(c.submittedAt||c.uploadedAt||c.draftingCompletedAt||c.completedAt);
    const reviewed=parseDateMs(c.reviewedAt||c.reviewApprovedAt||c.finalApprovedAt||c.approvedAt);
    const reviewMinutes=submitted && reviewed && reviewed>=submitted ? Math.max(1, Math.round((reviewed-submitted)/60000)) : (isCompletedCaseForPerf(c) ? (perfRevisionCount(c)>0?25:15) : 0);
    records.push({ id:`${taskId}::${userName}`.toLowerCase(), taskId, userName, caseType:perfCaseType(c), location:c.location||c.city||'', bank:c.bank||c.bankName||'', assignedAt:parseDateMs(c.assignedAt)||0, startedAt:start||0, completedAt:end||0, totalCompletionMinutes:mins, reviewMinutes, revisionCount:perfRevisionCount(c), slaMet:true, createdFrom:'backend-lifecycle' });
  }
  return records;
}
function performanceRecordKey(r = {}){
  return String(r.id || `${r.taskId || r.caseId || ''}::${r.userName || r.assigneeName || r.assignedTo || r.designerName || ''}`).toLowerCase();
}
function hasUsefulTiming(r = {}){
  return recordCompletionMinutes(r) > 0 || recordReviewMinutes(r) > 0 || Number(r.totalCompletionMinutes || r.effectiveMinutes || r.activeMinutes || r.durationMinutes || 0) > 0;
}
function enrichPerformanceRecord(base = {}, incoming = {}){
  const merged = { ...(base || {}) };
  const directTimingFields = ['effectiveMinutes','totalCompletionMinutes','completionMinutes','activeMinutes','durationMinutes','reviewMinutes','reviewDurationMinutes'];
  const dateFields = ['assignedAt','startedAt','draftStartedAt','createdAt','completedAt','finishedAt','approvedAt','updatedAt','reviewStartedAt','reviewCompletedAt','reviewApprovedAt','finalApprovedAt'];
  const identityFields = ['id','taskId','userName','assigneeName','assignedTo','designerName','caseType','type','location','bank','createdFrom','timingSource'];
  for (const key of [...identityFields, ...dateFields]) {
    if ((merged[key] === undefined || merged[key] === null || merged[key] === '') && incoming[key] !== undefined && incoming[key] !== null && incoming[key] !== '') merged[key] = incoming[key];
  }
  // Prefer any positive calculated timing over a blank/zero legacy record. This is the
  // critical backfill path for old records that had counts but no durations.
  for (const key of directTimingFields) {
    const current = Number(merged[key] || 0) || 0;
    const next = Number(incoming[key] || 0) || 0;
    if (current <= 0 && next > 0) merged[key] = Math.round(next);
  }
  // Keep the latest completion timestamp, but never discard useful timing from the other row.
  const currentDone = parseDateMs(merged.completedAt || merged.finishedAt || merged.updatedAt);
  const nextDone = parseDateMs(incoming.completedAt || incoming.finishedAt || incoming.updatedAt);
  if (nextDone > currentDone) {
    merged.completedAt = incoming.completedAt || incoming.finishedAt || incoming.updatedAt || merged.completedAt;
  }
  const currentRevisions = Number(merged.revisionCount || 0) || 0;
  const nextRevisions = Number(incoming.revisionCount || 0) || 0;
  merged.revisionCount = Math.max(currentRevisions, nextRevisions);
  if (merged.slaMet === undefined && incoming.slaMet !== undefined) merged.slaMet = incoming.slaMet;
  if (!hasUsefulTiming(merged) && hasUsefulTiming(incoming)) return { ...incoming, ...merged };
  return merged;
}
function mergePerformanceRecords(existing=[], generated=[]){
  const map=new Map();
  [...existing, ...generated].filter(Boolean).forEach(r=>{
    const key=performanceRecordKey(r);
    if(!key || key === '::') return;
    const old=map.get(key);
    if(!old) { map.set(key, r); return; }
    const enriched = enrichPerformanceRecord(old, r);
    const oldTiming = hasUsefulTiming(old);
    const newTiming = hasUsefulTiming(r);
    const oldDone = parseDateMs(old.completedAt || old.finishedAt || old.updatedAt);
    const newDone = parseDateMs(r.completedAt || r.finishedAt || r.updatedAt);
    // If one side has timing and the other does not, keep the timed/enriched version.
    // Otherwise prefer the freshest metadata after enrichment.
    if ((!oldTiming && newTiming) || newDone >= oldDone) map.set(key, enriched);
    else map.set(key, enrichPerformanceRecord(r, old));
  });
  return Array.from(map.values());
}


function avgRounded(values = []){
  const nums = values.map(Number).filter(v => Number.isFinite(v) && v > 0);
  return nums.length ? Math.round(nums.reduce((a,b)=>a+b,0) / nums.length) : 0;
}
function recordCompletionMinutes(r = {}){
  const direct = Number(r.effectiveMinutes || r.totalCompletionMinutes || r.completionMinutes || r.activeMinutes || r.durationMinutes || 0) || 0;
  if (direct > 0) return Math.max(1, Math.round(direct));
  const start = parseDateMs(r.startedAt || r.draftStartedAt || r.assignedAt || r.createdAt);
  const end = parseDateMs(r.completedAt || r.finishedAt || r.approvedAt || r.updatedAt);
  return start && end && end >= start ? Math.max(1, Math.round((end - start) / 60000)) : 0;
}
function recordReviewMinutes(r = {}){
  const direct = Number(r.reviewMinutes || r.avgReviewMinutes || r.reviewDurationMinutes || 0) || 0;
  if (direct > 0) return Math.max(1, Math.round(direct));
  const start = parseDateMs(r.reviewStartedAt || r.submittedAt || r.completedAt);
  const end = parseDateMs(r.reviewCompletedAt || r.reviewApprovedAt || r.finalApprovedAt || r.approvedAt);
  return start && end && end >= start ? Math.max(1, Math.round((end - start) / 60000)) : 0;
}
function buildPerformanceDiagnostics(cases = [], records = []){
  const caseList = Array.isArray(cases) ? cases : [];
  const recordList = Array.isArray(records) ? records : [];
  const completedCandidates = caseList.filter(c => isCompletedCaseForPerf(c) && !isRevisionLedgerClone(c));
  const withOwner = completedCandidates.filter(c => !!perfOwner(c));
  const withTiming = recordList.filter(r => recordCompletionMinutes(r) > 0);
  const byReason = {
    totalCases: caseList.length,
    completedCandidates: completedCandidates.length,
    withOwner: withOwner.length,
    generatedRecords: recordList.length,
    recordsWithTiming: withTiming.length,
    skippedWithoutOwner: Math.max(0, completedCandidates.length - withOwner.length),
    revisionWorkExcluded: caseList.filter(c => isRevisionLedgerClone(c)).length
  };
  const sampleMissing = completedCandidates.filter(c => !perfOwner(c)).slice(0, 5).map(c => ({ id: perfTaskId(c), status: c.status, assignedTo: c.assignedTo, completedBy: c.completedBy, designerName: c.designerName }));
  return { ...byReason, sampleMissingOwner: sampleMissing };
}

function getRecordCompletedMs(r = {}) {
  return parseDateMs(r.completedAt || r.finishedAt || r.reviewCompletedAt || r.updatedAt || r.createdAt) || 0;
}
function rollingAverageFromRecords(rows = [], size = 10) {
  return avgRounded((rows || []).slice(0, size).map(recordCompletionMinutes));
}
function trendFromRecordRows(rows = [], size = 10) {
  const clean = (rows || []).filter(r => recordCompletionMinutes(r) > 0);
  const recent = clean.slice(0, size).map(recordCompletionMinutes).filter(Boolean);
  const previous = clean.slice(size, size * 2).map(recordCompletionMinutes).filter(Boolean);
  const recentAvg = avgRounded(recent);
  const previousAvg = avgRounded(previous);
  const pct = recentAvg && previousAvg ? Math.round(((previousAvg - recentAvg) / previousAvg) * 100) : 0;
  return { recentAvg, previousAvg, pct, label: pct > 5 ? 'Improving' : pct < -5 ? 'Declining' : 'Stable' };
}
function scoreFromAvg(avgCompletionMinutes = 0, baseline = 60) {
  if (!avgCompletionMinutes) return 70;
  return Math.max(0, Math.min(100, Math.round(100 - Math.max(0, avgCompletionMinutes - baseline) / 3 + Math.max(0, baseline - avgCompletionMinutes) / 6)));
}
function buildPerformanceSummary(records = [], users = []){
  const grouped = new Map();
  const cleanName = (name='') => String(name || '').trim().replace(/\s+/g, ' ');
  const recordList = Array.isArray(records) ? records : [];
  for (const r of recordList) {
    const userName = cleanName(r.userName || r.assigneeName || r.assignedTo || r.designerName || r.completedBy || r.user || '');
    if (!userName) continue;
    const completionMinutes = recordCompletionMinutes(r);
    if (!completionMinutes) continue;
    const reviewMinutes = recordReviewMinutes(r);
    const key = userName.toLowerCase();
    if (!grouped.has(key)) grouped.set(key, { userName, records: [], completion: [], review: [], revisions: 0, slaMet: 0, caseTypes: {} });
    const row = grouped.get(key);
    row.records.push(r);
    row.completion.push(completionMinutes);
    if (reviewMinutes) row.review.push(reviewMinutes);
    row.revisions += Number(r.revisionCount || 0) || 0;
    if (r.slaMet !== false) row.slaMet += 1;
    const caseType = String(r.caseType || r.type || r.serviceType || 'Other').trim() || 'Other';
    row.caseTypes[caseType] ||= { caseType, count: 0, total: 0, revisions: 0, slaMet: 0, review: [] };
    row.caseTypes[caseType].count += 1;
    row.caseTypes[caseType].total += completionMinutes;
    row.caseTypes[caseType].revisions += Number(r.revisionCount || 0) || 0;
    if (r.slaMet !== false) row.caseTypes[caseType].slaMet += 1;
    if (reviewMinutes) row.caseTypes[caseType].review.push(reviewMinutes);
  }
  const userSummaries = Array.from(grouped.values()).map(row => {
    const sortedRecords = row.records.slice().sort((a,b)=>getRecordCompletedMs(b)-getRecordCompletedMs(a));
    const completedCount = row.completion.length;
    const avgCompletionMinutes = avgRounded(row.completion);
    const avgReviewMinutes = avgRounded(row.review);
    const rolling10CompletionMinutes = rollingAverageFromRecords(sortedRecords, 10);
    const rolling30CompletionMinutes = rollingAverageFromRecords(sortedRecords, 30);
    const trend = trendFromRecordRows(sortedRecords, 10);
    const revisionRate = completedCount ? Number((row.revisions / completedCount).toFixed(2)) : 0;
    const slaPct = completedCount ? Math.round((row.slaMet / completedCount) * 100) : 100;
    const speedScore = scoreFromAvg(rolling10CompletionMinutes || avgCompletionMinutes, 60);
    const qualityScore = Math.max(0, Math.round(100 - revisionRate * 30));
    const slaScore = Math.max(0, Math.min(100, slaPct));
    const revisionScore = Math.max(0, Math.round(100 - revisionRate * 25));
    const attendanceScore = 90;
    const productivityScore = Math.round((speedScore * 0.40) + (qualityScore * 0.25) + (slaScore * 0.20) + (revisionScore * 0.10) + (attendanceScore * 0.05));
    const scoreBreakdown = { speedScore, qualityScore, slaScore, revisionScore, attendanceScore, productivityScore };
    const caseTypeStats = Object.values(row.caseTypes).map(ct => {
      const avg = Math.round(ct.total / ct.count);
      const reviewAvg = avgRounded(ct.review);
      return { ...ct, avg, avgCompletionMinutes: avg, avgReviewMinutes: reviewAvg, revisionRate: ct.count ? Number((ct.revisions / ct.count).toFixed(2)) : 0, slaPct: ct.count ? Math.round((ct.slaMet / ct.count) * 100) : 100 };
    }).sort((a,b)=>b.count-a.count || a.avg-b.avg).slice(0, 6);
    return {
      userName: row.userName,
      completedCount,
      avgCompletionMinutes,
      avgReviewMinutes,
      rolling10CompletionMinutes,
      rolling30CompletionMinutes,
      trend,
      revisionCount: row.revisions,
      revisionRate,
      slaPct,
      productivityScore,
      scoreBreakdown,
      caseTypeStats,
      timingSource: 'backend-summary-v2'
    };
  }).sort((a,b)=>b.productivityScore-a.productivityScore || b.completedCount-a.completedCount);
  const allCompletionMinutes = recordList.map(recordCompletionMinutes).filter(Boolean);
  const allReviewMinutes = recordList.map(recordReviewMinutes).filter(Boolean);
  const sortedAll = recordList.slice().sort((a,b)=>getRecordCompletedMs(b)-getRecordCompletedMs(a));
  const validation = {
    invalidDurations: recordList.filter(r => recordCompletionMinutes(r) <= 0).length,
    missingUser: recordList.filter(r => !cleanName(r.userName || r.assigneeName || r.assignedTo || r.designerName || r.completedBy || r.user || '')).length,
    duplicateTaskRecords: Math.max(0, recordList.length - new Set(recordList.map(r => String(r.taskId || r.id || '').toLowerCase())).size)
  };
  return {
    generatedAt: now(),
    version: '17E-enterprise-analytics',
    recordCount: recordList.length,
    userCount: userSummaries.length,
    avgCompletionMinutes: avgRounded(allCompletionMinutes),
    avgReviewMinutes: avgRounded(allReviewMinutes),
    rolling10CompletionMinutes: rollingAverageFromRecords(sortedAll, 10),
    rolling30CompletionMinutes: rollingAverageFromRecords(sortedAll, 30),
    trend: trendFromRecordRows(sortedAll, 10),
    users: userSummaries,
    validation,
    diagnostics: {
      usersWithRecords: userSummaries.length,
      recordsWithTiming: allCompletionMinutes.length,
      recordsWithReviewTiming: allReviewMinutes.length,
      teamUsers: Array.isArray(users) ? users.filter(u => String(u.role || '').toUpperCase() !== 'ADMIN').length : 0,
      validation
    }
  };
}

function filterDeletedCases(cases = [], deletedProjectIds = []){
  const deletedSet = new Set((deletedProjectIds || []).map(x => String(x)).filter(Boolean));
  return (Array.isArray(cases) ? cases : []).filter(c => c && !deletedSet.has(String(c.id || '')) && !deletedSet.has(String(c.caseId || '')));
}

function caseFreshness(c = {}) {
  const candidates = [c.syncVersion, c.updatedAt, c.assignmentVersion, c.assignedAt, c.completedAt, c.createdAt];
  for (const value of candidates) {
    if (!value) continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function getCaseIdentitySet(c = {}) {
  return [c.id, c.caseId, ...(Array.isArray(c.previousTaskIds) ? c.previousTaskIds : [])]
    .map(x => String(x || '').trim())
    .filter(Boolean);
}

function dedupeRenamedCases(cases = [], deletedProjectIds = []) {
  const deletedSet = new Set((deletedProjectIds || []).map(x => String(x || '').trim()).filter(Boolean));
  const sorted = (Array.isArray(cases) ? cases : [])
    .filter(Boolean)
    .sort((a, b) => caseFreshness(b) - caseFreshness(a));
  const usedIds = new Set();
  const result = [];
  for (const c of sorted) {
    const ids = getCaseIdentitySet(c);
    if (!ids.length) continue;
    if (ids.some(id => deletedSet.has(id) || usedIds.has(id))) continue;
    ids.forEach(id => usedIds.add(id));
    result.push(c);
  }
  return result.sort((a, b) => caseFreshness(b) - caseFreshness(a));
}


function mergeCasesPreservingFreshest(existingCases = [], incomingCases = [], deletedProjectIds = []) {
  // Never trust a full /api/state payload as the only source of truth. Different
  // browsers/users may save stale cached state later. Merge current DB cases with
  // incoming cases, then let dedupeRenamedCases choose the freshest version across
  // id, caseId and previousTaskIds. This prevents an edited/renamed task from
  // reverting back to an older version for managers/designers after another client
  // saves its stale local copy.
  const timelineById = new Map();
  for (const c of [...(Array.isArray(existingCases) ? existingCases : []), ...(Array.isArray(incomingCases) ? incomingCases : [])].filter(Boolean)) {
    for (const id of getCaseIdentitySet(c)) {
      const current = timelineById.get(id) || [];
      timelineById.set(id, mergeTimelineEvents(current, c.timeline, c.history));
    }
  }
  const merged = [
    ...(Array.isArray(existingCases) ? existingCases : []),
    ...(Array.isArray(incomingCases) ? incomingCases : [])
  ].filter(Boolean).map(c => {
    const nowStamp = Date.now();
    const ids = getCaseIdentitySet(c);
    const timeline = ids.map(id => timelineById.get(id)).find(Boolean) || c.timeline || [];
    return {
      ...c,
      timeline: mergeTimelineEvents(timeline, c.timeline, c.history),
      updatedAt: c.updatedAt || c.syncVersion || c.assignmentVersion || c.assignedAt || c.completedAt || c.createdAt || nowStamp,
      syncVersion: c.syncVersion || c.updatedAt || nowStamp
    };
  });
  return dedupeRenamedCases(filterDeletedCases(merged, deletedProjectIds || []), deletedProjectIds || []);
}

function rememberDeletedProject(d, id){
  const value = String(id || '').trim();
  if (!value) return;
  d.deletedProjectIds ||= [];
  if (!d.deletedProjectIds.map(String).includes(value)) d.deletedProjectIds.push(value);
}


function now(){ return new Date().toISOString(); }

const FINANCE_FIELDS = [
  'ledger', 'paymentTrackingStatus', 'paymentTrackingUpdatedAt', 'paymentTrackingUpdatedBy',
  'paymentStatus', 'paymentReceived', 'paymentAmountIn', 'refundAmount',
  'payerName', 'transactionId', 'paymentDate', 'paymentTime', 'paymentAuditTrail'
];

function normalizeRoleValue(value = '') {
  return String(value || '').trim().toUpperCase();
}

function isAdminRoleValue(value = '') {
  return normalizeRoleValue(value) === 'ADMIN';
}

function requestRole(req = {}) {
  return req.get?.('x-user-role') || req.body?.currentUserRole || req.body?.role || req.query?.role || '';
}

function isFinanceAdminRequest(req = {}) {
  return isAdminRoleValue(requestRole(req));
}

function denyFinanceAccess(res) {
  return res.status(403).json({ ok:false, error:'Finance access is restricted to Admin users only.' });
}

function preserveFinanceFields(existing = {}, incoming = {}) {
  const next = { ...(incoming || {}) };
  for (const key of FINANCE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(existing || {}, key)) {
      next[key] = structuredClone(existing[key]);
    } else if (key in next) {
      delete next[key];
    }
  }
  return next;
}

function preserveFinanceForNonAdminCases(existingCases = [], incomingCases = []) {
  const existingById = new Map();
  for (const c of existingCases || []) {
    [c.id, c.caseId, c.displayId, c.originalTaskId].filter(Boolean).forEach(id => existingById.set(String(id), c));
  }
  return (incomingCases || []).map(c => {
    const existing = [c.id, c.caseId, c.displayId, c.originalTaskId].filter(Boolean).map(String).map(id => existingById.get(id)).find(Boolean);
    return existing ? preserveFinanceFields(existing, c) : preserveFinanceFields({}, c);
  });
}


const PAYMENT_TRACKING_OPTIONS = ['Not Updated', 'Pending', 'Paid'];
function normalizePaymentTrackingStatus(value = '') {
  const key = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (key === 'PAID' || key === 'YES' || key === 'RECEIVED') return 'Paid';
  if (key === 'PENDING' || key === 'PARTIAL' || key === 'PAYMENTPENDING') return 'Pending';
  return 'Not Updated';
}
function getPositiveNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const cleaned = typeof value === 'string' ? value.replace(/[^0-9.-]/g, '') : value;
    const numeric = Number(cleaned);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}
function getCasePaymentAmount(c = {}, explicitAmount) {
  // Received amount must come from actual payment data, never from estimate.
  return getPositiveNumber(explicitAmount, c.paymentAmountIn, c.ledger?.amountIn);
}
function getCaseEstimateAmount(c = {}) {
  return getPositiveNumber(c.estimate, c.estimateAmount, c.totalAmount, c.amount, c.ledger?.expectedAmount);
}
function deriveServerPaymentStatus(c = {}, requestedStatus = '') {
  const estimate = getCaseEstimateAmount(c);
  const amount = getCasePaymentAmount(c);
  const requested = normalizePaymentTrackingStatus(requestedStatus || c.paymentTrackingStatus || c.paymentStatus || c.paymentReceived || c.ledger?.status || '');
  if (amount > 0) return estimate > 0 && amount < estimate ? 'Pending' : 'Paid';
  if (estimate > 0 || requested === 'Pending') return 'Pending';
  return 'Not Updated';
}
function findCaseByAnyId(cases = [], id = '') {
  const target = String(id || '').trim();
  return (cases || []).find(c => [c.id, c.caseId, c.displayId, c.originalTaskId]
    .filter(Boolean)
    .some(value => String(value).trim() === target));
}
function upsertInlinePaymentLedger(d, c, status, body = {}) {
  d.payments ||= [];
  c.ledger ||= {};
  c.history ||= [];
  const nowIso = now();
  const by = body.by || body.updatedBy || 'Admin';
  const amount = getCasePaymentAmount(c, body.amount ?? body.amountIn ?? body.paymentAmountIn);
  const caseKey = String(c.id || c.caseId || '').trim();
  const caseNo = c.caseId || c.displayId || c.originalTaskId || c.id || '';
  const existing = d.payments.find(p => p.source === 'INLINE_PAYMENT_STATUS'
    && String(p.caseId || '') === caseKey
    && String(p.ledgerStatus || 'ACTIVE') === 'ACTIVE');

  const previousPaymentStatus = normalizePaymentTrackingStatus(c.paymentTrackingStatus || c.paymentStatus || c.paymentReceived || c.ledger?.status || '');
  const previousAmountIn = Number(c.ledger?.amountIn ?? c.paymentAmountIn ?? 0) || 0;
  if (status === 'Paid' && amount <= 0) {
    const err = new Error('Amount received is required before marking payment as Paid.');
    err.statusCode = 400;
    throw err;
  }
  const computedStatus = status === 'Paid' ? deriveServerPaymentStatus({ ...c, paymentAmountIn: amount, ledger: { ...(c.ledger || {}), amountIn: amount } }, status) : deriveServerPaymentStatus(c, status);
  c.paymentTrackingStatus = computedStatus;
  c.paymentTrackingUpdatedAt = Date.now();
  c.paymentTrackingUpdatedBy = by;
  c.ledger = {
    ...c.ledger,
    status: computedStatus,
    paymentStatus: computedStatus,
    updatedAt: Date.now(),
    updatedBy: by,
  };

  if (computedStatus === 'Paid') {
    c.paymentAuditTrail ||= [];
    c.paymentAuditTrail.unshift({
      id: nanoid(8),
      at: nowIso,
      by,
      action: 'Payment status updated',
      oldStatus: previousPaymentStatus,
      newStatus: computedStatus,
      oldAmount: previousAmountIn,
      newAmount: amount,
      note: body.note || 'Admin marked payment as Paid from inline payment control'
    });
    c.paymentStatus = 'YES';
    c.paymentReceived = 'YES';
    c.paymentAmountIn = amount;
    c.paymentDate = body.paymentDate || nowIso.slice(0, 10);
    c.paymentTime = body.paymentTime || new Date().toTimeString().slice(0, 5);
    c.ledger.amountIn = amount;
    c.ledger.date = c.ledger.date || c.paymentDate;
    c.ledger.autoFilledFromPaymentStatus = true;
    c.ledger.financeLedgerLinked = true;
    c.ledger.financeLedgerId = existing?.id || c.ledger.financeLedgerId || nanoid(8);

    if (existing) {
      Object.assign(existing, {
        caseNo,
        location: c.location || c.city || '',
        customerName: c.customerName || '',
        bank: c.client || c.bank || c.bankName || '',
        branch: c.branch || c.branchName || '',
        paymentReceived: 'YES',
        paymentAmountIn: amount,
        paymentDate: c.paymentDate,
        paymentTime: c.paymentTime,
        ledgerStatus: 'ACTIVE',
        updatedAt: nowIso,
        updatedBy: by,
        note: body.note || 'Auto-updated from inline payment status',
      });
    } else {
      d.payments.unshift({
        id: c.ledger.financeLedgerId,
        source: 'INLINE_PAYMENT_STATUS',
        caseId: caseKey,
        caseNo,
        location: c.location || c.city || '',
        customerName: c.customerName || '',
        bankerName: c.bankerName || '',
        bank: c.client || c.bank || c.bankName || '',
        branch: c.branch || c.branchName || '',
        paymentReceived: 'YES',
        paymentAmountIn: amount,
        refundAmount: 0,
        paymentDate: c.paymentDate,
        paymentTime: c.paymentTime,
        payerName: body.payerName || c.customerName || '',
        transactionId: body.transactionId || '',
        mode: body.mode || 'Inline status',
        note: body.note || 'Auto-created after admin marked payment as Paid',
        ledgerStatus: 'ACTIVE',
        createdAt: nowIso,
        createdBy: by,
        updatedAt: nowIso,
        updatedBy: by,
      });
    }
    c.history.unshift({ at: nowIso, by, action: `Payment marked Paid and ₹${Number(amount || 0).toLocaleString('en-IN')} added to Finance Ledger` });
  } else {
    c.paymentAuditTrail ||= [];
    c.paymentAuditTrail.unshift({
      id: nanoid(8),
      at: nowIso,
      by,
      action: 'Payment status updated',
      oldStatus: previousPaymentStatus,
      newStatus: computedStatus,
      oldAmount: previousAmountIn,
      newAmount: previousAmountIn,
      note: existing ? `Previous paid ledger entry marked reversed because status changed to ${computedStatus}` : `Payment status changed to ${computedStatus}`
    });
    c.paymentStatus = computedStatus === 'Pending' ? 'PENDING' : 'NOT_UPDATED';
    c.paymentReceived = computedStatus === 'Pending' ? 'PARTIAL' : 'NO';
    c.ledger.financeLedgerLinked = false;
    if (existing) {
      existing.ledgerStatus = 'REVERSED';
      existing.reversedAt = nowIso;
      existing.reversedBy = by;
      existing.reversalReason = `Payment status changed to ${computedStatus}`;
      existing.updatedAt = nowIso;
      existing.updatedBy = by;
    }
    c.history.unshift({ at: nowIso, by, action: `Payment status changed to ${computedStatus}${existing ? '; previous paid ledger entry marked reversed' : ''}` });
  }
  addCaseTimelineEvent(c,{type:'payment_updated',by,title:`Payment ${computedStatus}`,remarks:amount > 0 ? `Amount received: ₹${Number(amount || 0).toLocaleString('en-IN')}` : ''});
  addAudit(d, by, `Inline payment status changed to ${computedStatus}`, caseNo);
  return c;
}

const PRESENCE_STALE_MS = Number(process.env.PRESENCE_STALE_MS || 90000);
const toMs = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};
const normalizeRole = (role = '') => {
  const value = String(role || '').trim().toUpperCase();
  if (value === 'ADMIN') return 'Admin';
  if (value === 'MANAGER') return 'Manager';
  if (value === 'DESIGNER') return 'Designer';
  return role || '';
};
const normalizeStatus = (status = 'APPROVED') => String(status || 'APPROVED').trim().toUpperCase() || 'APPROVED';
const systemUserPattern = /operations\s*manager/i;
const teamIdentityKey = (u = {}) => String(u.username || u.name || u.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const validTeamRole = (role = '') => ['Admin','Manager','Designer'].includes(normalizeRole(role));
function employeeLifecycleProfile(user = {}, existing = {}) {
  const nowMs = Date.now();
  const role = normalizeRole(user.role || existing.role || 'Designer');
  const status = normalizeStatus(user.status || existing.status || 'APPROVED');
  const isArchived = ['DELETED', 'REJECTED', 'ARCHIVED'].includes(status);
  const isRestricted = status === 'RESTRICTED';
  const lifecycleStatus = isArchived ? 'ARCHIVED' : (isRestricted ? 'RESTRICTED' : 'ACTIVE');
  const active = lifecycleStatus === 'ACTIVE';
  const profileCreatedAt = existing.profileCreatedAt || user.profileCreatedAt || nowMs;
  const base = { ...existing, ...user, role, status, profileCreatedAt, profileUpdatedAt: nowMs, lifecycleStatus };
  base.lifecycle = {
    ...(existing.lifecycle || {}),
    ...(user.lifecycle || {}),
    status: lifecycleStatus,
    active,
    restricted: isRestricted,
    archived: isArchived,
    createdAt: existing.lifecycle?.createdAt || user.lifecycle?.createdAt || profileCreatedAt,
    updatedAt: nowMs,
    archivedAt: isArchived ? (user.deletedAt || user.archivedAt || existing.lifecycle?.archivedAt || nowMs) : null,
    archivedBy: isArchived ? (user.deletedBy || user.archivedBy || existing.lifecycle?.archivedBy || '') : ''
  };
  base.attendanceProfile = { createdAt: profileCreatedAt, active, includeInAttendance: active && role !== 'Admin', lastPreparedAt: nowMs, ...(existing.attendanceProfile || {}), ...(user.attendanceProfile || {}) };
  base.availabilityProfile = { createdAt: profileCreatedAt, active, trackAvailability: active, defaultAvailability: 'Unavailable', ...(existing.availabilityProfile || {}), ...(user.availabilityProfile || {}) };
  base.chatProfile = { createdAt: profileCreatedAt, active, directMessages: active, mentions: active, ...(existing.chatProfile || {}), ...(user.chatProfile || {}) };
  base.performanceProfile = { createdAt: profileCreatedAt, active: active && role !== 'Admin', completedTasks: 0, revisionsHandled: 0, ...(existing.performanceProfile || {}), ...(user.performanceProfile || {}) };
  base.analyticsProfile = { createdAt: profileCreatedAt, active, role: role.toUpperCase(), ...(existing.analyticsProfile || {}), ...(user.analyticsProfile || {}) };
  base.workloadProfile = { createdAt: profileCreatedAt, active: active && role !== 'Admin', dailyLimit: role === 'Admin' ? 0 : 15, activeTasks: 0, ...(existing.workloadProfile || {}), ...(user.workloadProfile || {}) };
  base.notificationPreferences = { createdAt: profileCreatedAt, enabled: active, task: active, chat: active, mention: active, meeting: active, ...(existing.notificationPreferences || {}), ...(user.notificationPreferences || {}) };
  if (!active) {
    base.isOnline = false;
    base.availability = 'Unavailable';
    base.breakStartedAt = null;
    base.lastLogoutAt ||= nowMs;
    base.lastSeenAt ||= nowMs;
    base.availabilityUpdatedAt ||= nowMs;
  }
  return base;
}
function cleanTeamUsers(users = []) {
  const map = new Map();
  (users || []).forEach(raw => {
    if (!raw) return;
    const u = employeeLifecycleProfile({ ...raw, role: normalizeRole(raw.role), status: normalizeStatus(raw.status || 'APPROVED') }, map.get(teamIdentityKey(raw)) || {});
    if (!validTeamRole(u.role)) return;
    if (systemUserPattern.test(String(u.name || '')) || systemUserPattern.test(String(u.username || ''))) return;
    if (u.status === 'DELETED' || u.status === 'REJECTED' || u.status === 'ARCHIVED') return;
    const key = teamIdentityKey(u);
    if (!key) return;
    map.set(key, employeeLifecycleProfile({ ...(map.get(key) || {}), ...u }, map.get(key) || {}));
  });
  return [...map.values()];
}
const presenceTimestamp = (u = {}) => Math.max(
  toMs(u.lastHeartbeatAt),
  toMs(u.lastSeenAt),
  toMs(u.lastLoginAt),
  toMs(u.availabilityUpdatedAt)
);
function sanitizePresenceUser(user = {}, nowMs = Date.now()) {
  const u = { ...user, role: normalizeRole(user.role), status: normalizeStatus(user.status) };
  const last = presenceTimestamp(u);
  const trulyOnline = !!u.isOnline && !!last && (nowMs - last) <= PRESENCE_STALE_MS;
  if (!trulyOnline) {
    u.isOnline = false;
    if (String(u.availability || '').toLowerCase() !== 'unavailable') u.availability = 'Unavailable';
    if (!u.lastSeenAt && last) u.lastSeenAt = last;
    if (!u.lastLogoutAt && u.lastSeenAt) u.lastLogoutAt = u.lastSeenAt;
    u.breakStartedAt = null;
  }
  return u;
}
function sanitizePresenceUsers(users = []) {
  const nowMs = Date.now();
  return cleanTeamUsers(users || []).map(u => sanitizePresenceUser(u, nowMs));
}
function mergeUsersPreservingLatestPresence(existing = [], incoming = []) {
  const byId = new Map();
  const nowMs = Date.now();
  const add = (u = {}) => {
    const normalized = employeeLifecycleProfile({ ...u, role: normalizeRole(u.role), status: normalizeStatus(u.status || 'APPROVED') }, {});
    const key = teamIdentityKey(normalized) || String(normalized.id || Math.random());
    const prev = byId.get(key);
    if (!prev) { byId.set(key, { ...normalized }); return; }
    const prevTs = presenceTimestamp(prev);
    const nextTs = presenceTimestamp(normalized);
    const prevStillOnline = !!prev.isOnline && prevTs && (nowMs - prevTs) <= PRESENCE_STALE_MS;
    const incomingLooksLikeStaleOffline = !normalized.isOnline && String(normalized.availability || '').toLowerCase() === 'unavailable';
    // Keep profile edits, but never let stale tabs/full-state saves mark a live user offline.
    const merged = { ...prev, ...normalized };
    if (prevTs > nextTs || (prevStillOnline && incomingLooksLikeStaleOffline)) {
      merged.isOnline = prev.isOnline;
      merged.availability = prev.availability;
      merged.lastSeenAt = prev.lastSeenAt;
      merged.lastHeartbeatAt = prev.lastHeartbeatAt;
      merged.lastLoginAt = prev.lastLoginAt;
      merged.lastLogoutAt = prev.lastLogoutAt;
      merged.availabilityUpdatedAt = prev.availabilityUpdatedAt;
      merged.breakStartedAt = prev.breakStartedAt;
    }
    if (String(merged.availability || '').toLowerCase() === 'break' && !merged.breakStartedAt) {
      merged.breakStartedAt = merged.availabilityUpdatedAt || merged.lastHeartbeatAt || Date.now();
    }
    byId.set(key, merged);
  };
  (existing || []).forEach(add);
  (incoming || []).forEach(add);
  return sanitizePresenceUsers([...byId.values()]);
}

function localDateKeyFromMsServer(value) {
  const ms = toMs(value);
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString('en-CA'); } catch { return ''; }
}
function parseAttendanceClockServer(dateKey, clockValue = '') {
  if (!dateKey || !clockValue || clockValue === '-') return 0;
  const raw = String(clockValue || '').trim();
  if (!raw) return 0;
  const direct = new Date(`${dateKey} ${raw}`).getTime();
  if (!Number.isNaN(direct)) return direct;
  const match24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const ms = new Date(`${dateKey}T${String(match24[1]).padStart(2, '0')}:${match24[2]}:00`).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}
function normalizeAttendanceLogsForSave(logs = [], users = []) {
  const userMap = new Map((users || []).map(u => [String(u.id), u]));
  const byId = new Map();
  (Array.isArray(logs) ? logs : []).forEach(raw => {
    if (!raw) return;
    const dateKey = raw.date || localDateKeyFromMsServer(raw.loginAt || raw.firstLoginAt || Date.now());
    const user = userMap.get(String(raw.userId)) || (users || []).find(u => String(u.name || '').toLowerCase().trim() === String(raw.name || '').toLowerCase().trim()) || {};
    const parsedLogin = parseAttendanceClockServer(dateKey, raw.loginTime || raw.firstLogin);
    let loginAt = toMs(raw.loginAt) || toMs(raw.firstLoginAt) || parsedLogin;
    if (loginAt && localDateKeyFromMsServer(loginAt) !== dateKey) loginAt = parsedLogin || 0;
    let logoutAt = toMs(raw.logoutAt) || toMs(raw.lastTick) || parseAttendanceClockServer(dateKey, raw.logoutTime);
    if (logoutAt && localDateKeyFromMsServer(logoutAt) !== dateKey) logoutAt = 0;
    if (loginAt && logoutAt && logoutAt < loginAt) logoutAt = loginAt;
    const id = raw.id || `${raw.userId || user.id || raw.name}_${dateKey}`;
    const normalized = {
      ...raw,
      id,
      userId: raw.userId || user.id || '',
      name: raw.name || user.name || '',
      role: normalizeRole(raw.role || user.role || 'Designer'),
      date: dateKey,
      loginAt: loginAt || null,
      firstLoginAt: toMs(raw.firstLoginAt) || loginAt || null,
      loginTime: raw.loginTime || (loginAt ? new Date(loginAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : ''),
      firstLogin: raw.firstLogin || raw.loginTime || (loginAt ? new Date(loginAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : ''),
      logoutAt: logoutAt || null,
      logoutTime: raw.logoutTime || (logoutAt && logoutAt !== loginAt ? new Date(logoutAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : ''),
      totalLoggedInMinutes: Math.max(0, Math.floor(Number(raw.totalLoggedInMinutes) || 0)),
      activeMinutes: Math.max(0, Math.floor(Number(raw.activeMinutes) || 0)),
      totalBreakMinutes: Math.max(0, Math.floor(Number(raw.totalBreakMinutes || raw.breakMinutes || 0) || 0), (Array.isArray(raw.breakEvents) ? raw.breakEvents : []).reduce((sum, ev) => sum + Math.max(0, Math.floor(Number(ev?.minutes || 0) || ((toMs(ev?.end) && toMs(ev?.start)) ? (toMs(ev.end) - toMs(ev.start)) / 60000 : 0))), 0)),
      breakEvents: Array.isArray(raw.breakEvents) ? raw.breakEvents : [],
      currentBreakStartedAt: raw.currentBreakStartedAt || null,
      lastTick: toMs(raw.lastTick) && localDateKeyFromMsServer(raw.lastTick) === dateKey ? raw.lastTick : (logoutAt || loginAt || null)
    };
    const prev = byId.get(id);
    if (!prev || toMs(normalized.lastTick) >= toMs(prev.lastTick)) byId.set(id, normalized);
  });
  return [...byId.values()];
}

function attendanceFreshness(log = {}) {
  return Math.max(toMs(log.lastTick), toMs(log.logoutAt), toMs(log.updatedAt), toMs(log.loginAt), toMs(log.firstLoginAt));
}
function attendanceIdentityKey(log = {}) {
  const dateKey = log.date || localDateKeyFromMsServer(log.loginAt || log.firstLoginAt || Date.now());
  const userKey = log.userId || log.name || log.id || '';
  return `${String(userKey).toLowerCase().trim()}_${dateKey}`;
}
function mergeAttendanceLogsPreservingLatest(existingLogs = [], incomingLogs = [], users = []) {
  const normalizedExisting = normalizeAttendanceLogsForSave(existingLogs || [], users || []);
  const normalizedIncoming = normalizeAttendanceLogsForSave(incomingLogs || [], users || []);
  const byKey = new Map();
  for (const log of [...normalizedExisting, ...normalizedIncoming].filter(Boolean)) {
    const key = attendanceIdentityKey(log);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, log);
      continue;
    }

    const prevFresh = attendanceFreshness(prev);
    const logFresh = attendanceFreshness(log);
    const fresher = logFresh >= prevFresh ? log : prev;
    const older = logFresh >= prevFresh ? prev : log;

    // Attendance counters are cumulative for a day. A fresher heartbeat/state
    // payload may sometimes miss activeMinutes/totalLoggedInMinutes while the
    // UI is hydrating; never allow that transient lower number to erase already
    // accrued productive time. Preserve the maximum counter values for the same
    // user/day and use the freshest row only for presence fields.
    byKey.set(key, {
      ...older,
      ...fresher,
      totalLoggedInMinutes: Math.max(Number(prev.totalLoggedInMinutes) || 0, Number(log.totalLoggedInMinutes) || 0),
      activeMinutes: Math.max(Number(prev.activeMinutes) || 0, Number(log.activeMinutes) || 0),
      totalBreakMinutes: Math.max(Number(prev.totalBreakMinutes || prev.breakMinutes) || 0, Number(log.totalBreakMinutes || log.breakMinutes) || 0),
      firstLoginAt: toMs(prev.firstLoginAt) && toMs(log.firstLoginAt) ? Math.min(toMs(prev.firstLoginAt), toMs(log.firstLoginAt)) : (toMs(prev.firstLoginAt) || toMs(log.firstLoginAt) || null),
      loginAt: toMs(prev.loginAt) && toMs(log.loginAt) ? Math.min(toMs(prev.loginAt), toMs(log.loginAt)) : (toMs(prev.loginAt) || toMs(log.loginAt) || null),
      loginTime: prev.loginTime || log.loginTime || fresher.loginTime || ''
    });
  }
  return normalizeAttendanceLogsForSave([...byKey.values()], users || []);
}


function serverTodayKey(ms = Date.now()) {
  try { return new Date(ms).toLocaleDateString('en-CA', { timeZone: process.env.ATTENDANCE_TIMEZONE || 'Asia/Kolkata' }); } catch { return localDateKeyFromMsServer(ms); }
}
function serverClockTime(ms = Date.now()) {
  try { return new Date(ms).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', timeZone: process.env.ATTENDANCE_TIMEZONE || 'Asia/Kolkata' }); } catch { return new Date(ms).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }); }
}
function findAttendanceLogIndex(logs = [], user = {}, dateKey = serverTodayKey()) {
  const id = `${user.id || user.username || user.name}_${dateKey}`;
  const nameKey = String(user.name || '').toLowerCase().trim();
  return (logs || []).findIndex(l => String(l.id) === id || (String(l.userId || '') && String(l.userId) === String(user.id || '') && l.date === dateKey) || (nameKey && String(l.name || '').toLowerCase().trim() === nameKey && l.date === dateKey));
}
function upsertAttendanceFromPresence(d, user = {}, action = 'heartbeat', nowMs = Date.now()) {
  d.attendanceLogs = Array.isArray(d.attendanceLogs) ? d.attendanceLogs : [];
  const role = normalizeRole(user.role || 'Designer');
  if (role === 'Admin') return null;
  const dateKey = serverTodayKey(nowMs);
  const timeStr = serverClockTime(nowMs);
  const idx = findAttendanceLogIndex(d.attendanceLogs, user, dateKey);
  const existing = idx >= 0 ? d.attendanceLogs[idx] : null;
  const lastTick = toMs(existing?.lastTick) || toMs(existing?.logoutAt) || toMs(existing?.loginAt) || nowMs;
  const loginAt = toMs(existing?.loginAt) || toMs(existing?.firstLoginAt) || (action === 'login' ? nowMs : toMs(user.lastLoginAt)) || nowMs;
  const previousBreakStart = toMs(existing?.currentBreakStartedAt) || toMs(user.breakStartedAt);
  const wasOnBreak = !!previousBreakStart || String(existing?.status || '').toLowerCase().includes('break');
  const isBreakAction = action === 'break' || String(user.availability || '').toLowerCase() === 'break';
  const elapsed = Math.max(0, Math.floor((nowMs - Math.max(lastTick, loginAt)) / 60000));
  let totalLoggedInMinutes = Math.max(0, Math.floor(Number(existing?.totalLoggedInMinutes) || 0));
  let activeMinutes = Math.max(0, Math.floor(Number(existing?.activeMinutes) || 0));
  let totalBreakMinutes = Math.max(0, Math.floor(Number(existing?.totalBreakMinutes || existing?.breakMinutes || 0) || 0));
  if (existing && action !== 'login') {
    totalLoggedInMinutes += elapsed;
    if (wasOnBreak) totalBreakMinutes += elapsed; else activeMinutes += elapsed;
  }
  const events = Array.isArray(existing?.breakEvents) ? [...existing.breakEvents] : [];
  if (action === 'break' && !events.some(ev => ev.start && !ev.end)) {
    events.push({ id: `break_${nowMs}`, start: nowMs, startTime: timeStr, source: 'presence' });
  }
  if ((action === 'resume' || action === 'logout') && events.some(ev => ev.start && !ev.end)) {
    for (const ev of events) {
      if (ev.start && !ev.end) {
        ev.end = nowMs;
        ev.endTime = timeStr;
        ev.minutes = Math.floor(Math.max(0, nowMs - Number(ev.start)) / 60000);
        ev.source = ev.source || 'presence';
      }
    }
  }
  const isLogout = action === 'logout';
  const log = {
    ...(existing || {}),
    id: existing?.id || `${user.id || user.username || user.name}_${dateKey}`,
    userId: existing?.userId || user.id || '',
    name: existing?.name || user.name || user.username || '',
    role,
    date: dateKey,
    loginAt,
    firstLoginAt: toMs(existing?.firstLoginAt) || loginAt,
    loginTime: existing?.loginTime || serverClockTime(loginAt),
    firstLogin: existing?.firstLogin || existing?.loginTime || serverClockTime(loginAt),
    logoutAt: nowMs,
    logoutTime: timeStr,
    totalLoggedInMinutes,
    activeMinutes,
    totalBreakMinutes,
    currentBreakStartedAt: isBreakAction && !isLogout ? (previousBreakStart || nowMs) : null,
    breakEvents: events,
    isOnline: !isLogout,
    status: isLogout ? 'Logged Out' : (isBreakAction ? 'On Break' : 'Online'),
    lastTick: nowMs,
    presenceSource: 'backend-heartbeat-v3'
  };
  if (idx >= 0) d.attendanceLogs[idx] = log; else d.attendanceLogs.push(log);
  d.attendanceLogs = normalizeAttendanceLogsForSave(d.attendanceLogs, d.users || []);
  return log;
}

function findUserIndexByIdentity(users = [], identity = {}) {
  const wantedKeys = new Set([
    teamIdentityKey(identity),
    identity.id ? `id:${String(identity.id).trim()}` : '',
    identity.username ? `username:${String(identity.username).toLowerCase().replace(/[^a-z0-9]/g,'')}` : '',
    identity.email ? `email:${String(identity.email).trim().toLowerCase()}` : '',
    identity.name ? `name:${String(identity.name).toLowerCase().replace(/[^a-z0-9]/g,'')}` : ''
  ].filter(Boolean));
  return (users || []).findIndex(u => {
    const keys = new Set([
      teamIdentityKey(u),
      u.id ? `id:${String(u.id).trim()}` : '',
      u.username ? `username:${String(u.username).toLowerCase().replace(/[^a-z0-9]/g,'')}` : '',
      u.email ? `email:${String(u.email).trim().toLowerCase()}` : '',
      u.name ? `name:${String(u.name).toLowerCase().replace(/[^a-z0-9]/g,'')}` : ''
    ].filter(Boolean));
    for (const key of wantedKeys) if (keys.has(key)) return true;
    return false;
  });
}

function applyPresenceUpdate(d, userPatch = {}, action = 'heartbeat') {
  d.users ||= [];
  const nowMs = Date.now();
  const idx = findUserIndexByIdentity(d.users, userPatch);
  const existing = idx >= 0 ? d.users[idx] : {};
  const next = employeeLifecycleProfile({ ...existing, ...userPatch }, existing);
  next.isOnline = action === 'logout' ? false : true;
  next.lastSeenAt = nowMs;
  next.lastHeartbeatAt = nowMs;
  if (action === 'login') next.lastLoginAt = nowMs;
  if (action === 'logout') next.lastLogoutAt = nowMs;
  if (action === 'break') {
    next.availability = 'Break';
    next.breakStartedAt = userPatch.breakStartedAt || nowMs;
    next.availabilityUpdatedAt = nowMs;
  } else if (action === 'resume' || action === 'login' || action === 'heartbeat') {
    next.availability = userPatch.availability && userPatch.availability !== 'Unavailable' ? userPatch.availability : 'Available';
    if (next.availability !== 'Break') next.breakStartedAt = null;
    next.availabilityUpdatedAt = action === 'heartbeat' ? (next.availabilityUpdatedAt || nowMs) : nowMs;
  } else if (action === 'logout') {
    next.availability = 'Unavailable';
    next.breakStartedAt = null;
    next.availabilityUpdatedAt = nowMs;
  }
  if (idx >= 0) d.users[idx] = next; else d.users.push(next);
  d.users = sanitizePresenceUsers(d.users);
  const savedUser = d.users[findUserIndexByIdentity(d.users, next)] || next;
  upsertAttendanceFromPresence(d, savedUser, action, nowMs);
  return savedUser;
}


const otpStore = new Map();
const normalizeMobile = (mobile='') => String(mobile || '').replace(/\D/g, '').slice(-12);
const smsConfigured = () => {
  if (process.env.SMS_PROVIDER === 'twilio') return process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER;
  if (process.env.SMS_PROVIDER === 'fast2sms') return process.env.FAST2SMS_API_KEY;
  if (process.env.SMS_PROVIDER === 'msg91') return process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER_ID;
  return false;
};
async function sendOtpSms(mobile, otp) {
  const msg = `Kalpvriksha Designs Ops OTP is ${otp}. Do not share it with anyone.`;
  if (!smsConfigured()) {
    throw new Error('Real SMS OTP is not configured. Set SMS_PROVIDER and SMS credentials in backend .env.');
  }
  if (process.env.SMS_PROVIDER === 'twilio') {
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const body = new URLSearchParams({ To: mobile.startsWith('+') ? mobile : `+${mobile}`, From: process.env.TWILIO_FROM_NUMBER, Body: msg });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, { method:'POST', headers:{ Authorization:`Basic ${auth}`, 'Content-Type':'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new Error('Twilio SMS sending failed.');
    return true;
  }
  if (process.env.SMS_PROVIDER === 'fast2sms') {
    const res = await fetch('https://www.fast2sms.com/dev/bulkV2', { method:'POST', headers:{ authorization:process.env.FAST2SMS_API_KEY, 'Content-Type':'application/json' }, body: JSON.stringify({ route:'otp', variables_values: otp, numbers: normalizeMobile(mobile).slice(-10) }) });
    if (!res.ok) throw new Error('Fast2SMS OTP sending failed.');
    return true;
  }
  if (process.env.SMS_PROVIDER === 'msg91') {
    const res = await fetch('https://control.msg91.com/api/v5/otp', { method:'POST', headers:{ authkey:process.env.MSG91_AUTH_KEY, 'Content-Type':'application/json' }, body: JSON.stringify({ template_id:process.env.MSG91_TEMPLATE_ID, mobile: normalizeMobile(mobile), otp }) });
    if (!res.ok) throw new Error('MSG91 OTP sending failed.');
    return true;
  }
  throw new Error('Unsupported SMS_PROVIDER.');
}


const normalizeEmail = (email='') => String(email || '').trim().toLowerCase();
const cleanEnv = (value='') => String(value || '').trim();
const cleanSecret = (value='') => String(value || '').replace(/\s+/g, '');
const isProduction = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const localEmailOtpAllowed = () => String(process.env.ALLOW_LOCAL_EMAIL_OTP || '').toLowerCase() === 'true';
const emailProvider = () => cleanEnv(process.env.EMAIL_PROVIDER || (process.env.SMTP_USER || process.env.EMAIL_USER ? 'gmail' : 'local')).toLowerCase();
const smtpUser = () => cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USER || process.env.GMAIL_USER || '');
const smtpPass = () => cleanSecret(process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.EMAIL_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD || '');
const otpFromEmail = () => cleanEnv(process.env.OTP_FROM_EMAIL || process.env.SMTP_FROM || smtpUser() || 'otp@kalpvriksha.local');
const emailConfigured = () => {
  const provider = emailProvider();
  if (provider === 'local' || provider === 'console') return localEmailOtpAllowed();
  if (provider === 'resend') return !!(process.env.RESEND_API_KEY && otpFromEmail());
  if (provider === 'sendgrid') return !!(process.env.SENDGRID_API_KEY && otpFromEmail());
  if (provider === 'brevo') return !!(process.env.BREVO_API_KEY && otpFromEmail());
  if (provider === 'smtp' || provider === 'gmail') return !!((process.env.SMTP_HOST || provider === 'gmail') && smtpUser() && smtpPass() && otpFromEmail());
  return false;
};
const makeLocalEmailResult = (reason='Email delivery is running in local OTP mode.') => ({ ok:true, localOnly:true, warning: reason });
const friendlyEmailError = (err) => {
  const raw = String(err?.message || err || '');
  if (/535|5\.7\.8|BadCredentials|Username and Password not accepted/i.test(raw)) {
    return 'Gmail rejected the email credentials. Set EMAIL_PASS / SMTP_PASS to a valid Google App Password, or switch EMAIL_PROVIDER to brevo/resend/sendgrid with a verified sender. Normal Gmail passwords will not work.';
  }
  return raw || 'Could not send email OTP.';
};
async function sendEmail({ to, subject, text, html }) {
  const provider = emailProvider();
  const from = otpFromEmail();
  if (!emailConfigured()) {
    if (localEmailOtpAllowed()) return makeLocalEmailResult('Email credentials are not configured, so local OTP mode was used for testing.');
    throw new Error('Real Email OTP is not configured. Set EMAIL_PROVIDER and email credentials in backend .env.');
  }
  if (provider === 'local' || provider === 'console') {
    console.log(`[LOCAL EMAIL OTP] To: ${to} | Subject: ${subject} | ${text}`);
    return makeLocalEmailResult('Local OTP mode is enabled.');
  }
  if (provider === 'smtp' || provider === 'gmail') {
    const port = Number(process.env.SMTP_PORT || (provider === 'gmail' ? 465 : 587));
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false')) === 'true',
      auth: { user: smtpUser(), pass: smtpPass() }
    });
    try {
      await transporter.sendMail({ from, to, subject, text, html });
      return { ok:true, sent:true };
    } catch (err) {
      throw new Error(friendlyEmailError(err));
    }
  }
  if (provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text })
    });
    if (!res.ok) {
      const detail = await res.text().catch(()=> '');
      throw new Error(`Resend email OTP sending failed. Check RESEND_API_KEY and OTP_FROM_EMAIL. ${detail.slice(0,200)}`);
    }
    return true;
  }
  if (provider === 'sendgrid') {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: from }, subject, content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }] })
    });
    if (!res.ok) {
      const detail = await res.text().catch(()=> '');
      throw new Error(`SendGrid email OTP sending failed. Check SENDGRID_API_KEY and OTP_FROM_EMAIL. ${detail.slice(0,200)}`);
    }
    return true;
  }
  if (provider === 'brevo') {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: { email: from, name: 'Kalpvriksha Designs Ops' }, to: [{ email: to }], subject, htmlContent: html, textContent: text })
    });
    if (!res.ok) {
      const detail = await res.text().catch(()=> '');
      throw new Error(`Brevo email OTP sending failed. Check BREVO_API_KEY and OTP_FROM_EMAIL. ${detail.slice(0,200)}`);
    }
    return true;
  }
  throw new Error('Unsupported EMAIL_PROVIDER. Use smtp, gmail, resend, sendgrid, or brevo.');
}

async function sendOtpEmail(email, otp) {
  const to = normalizeEmail(email);
  const subject = 'Kalpvriksha Designs Ops OTP';
  const text = `Your Kalpvriksha Designs Ops OTP is ${otp}. It expires in 5 minutes. Do not share it with anyone.`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Kalpvriksha Designs Ops</h2><p>Your OTP is:</p><div style="font-size:28px;font-weight:800;letter-spacing:4px">${otp}</div><p>This OTP expires in 5 minutes. Do not share it with anyone.</p></div>`;
  return sendEmail({ to, subject, text, html });
}

function addAudit(d, by, action, entity){ d.audit.unshift({id:nanoid(8),at:now(),by,action,entity}); }
function notify(d, to, text, category='normal', target=''){
  d.notifications.unshift({id:nanoid(8),to,text,category,target,status:'UNREAD',createdAt:now()});
}
function notifyRole(d, role, text, category='normal', target=''){ notify(d,role,text,category,target); }
function notifyUser(d, userIdOrName, text, category='normal', target=''){ notify(d,userIdOrName,text,category,target); }
function nextCaseNo(d, city='Lucknow'){ const code=String(city||'LKO').slice(0,3).toUpperCase(); return `KD-${code}-2026-${String(d.cases.length+1).padStart(4,'0')}`; }
function leastBusy(d){ return sanitizePresenceUsers(d.users).filter(u=>normalizeRole(u.role)==='Designer').map(u=>({ ...u, active:d.cases.filter(c=>c.assigneeId===u.id && !['COMPLETED','CLOSED'].includes(c.status)).length })).sort((a,b)=>a.active-b.active)[0] || sanitizePresenceUsers(d.users).find(u=>normalizeRole(u.role)==='Manager'); }
function publicUrl(){ return process.env.PUBLIC_APP_URL || 'http://localhost:5173'; }
function classify(name='', mime=''){
  const s=(name+' '+mime).toLowerCase();
  if(s.includes('deed')) return 'Sale Deed'; if(s.includes('ats')) return 'ATS'; if(s.includes('technical')) return 'Technical Report'; if(s.includes('gps')) return 'GPS Photo';
  if(/\.(jpg|jpeg|png|webp|heic|gif)$/i.test(name)||s.includes('image/')) return 'Image/Photo';
  if(/\.(dwg|dxf)$/i.test(name)) return 'AutoCAD DWG/DXF';
  if(/\.(xlsx|xls|csv)$/i.test(name)) return 'Excel Sheet';
  if(/\.(docx|doc|rtf)$/i.test(name)) return 'Word Document';
  if(/\.pdf$/i.test(name)||s.includes('pdf')) return 'PDF'; return 'Other';
}
function docPayload(file, uploadedBy, role, purpose='SOURCE', caseId=''){
  const id = nanoid(8);
  return {id,caseId,name:file.originalname,storedName:file.filename,mime:file.mimetype,size:file.size,type:classify(file.originalname,file.mimetype),purpose,uploadedBy,uploadedByRole:role,uploadedAt:now(),url:`/api/uploads/${file.filename}`,downloadUrl:`/api/files/${id}/download`};
}

function fileBaseName(value=''){
  try { return path.basename(decodeURIComponent(String(value || '').split('?')[0])); }
  catch { return path.basename(String(value || '').split('?')[0]); }
}
function normalizeFileName(value=''){
  return String(value || '').trim().toLowerCase().replace(/\s+/g,'_');
}
function listUploadFiles(){
  try { return fs.readdirSync(UPLOAD_DIR).filter(name => fs.statSync(path.join(UPLOAD_DIR, name)).isFile()); }
  catch { return []; }
}
function addFileRegistryEntry(d, doc={}){
  if (!doc || !doc.id) return doc;
  d.files ||= [];
  const existing = d.files.find(f => String(f.id) === String(doc.id));
  const entry = {
    id: String(doc.id),
    caseId: doc.caseId || doc.projectId || '',
    name: doc.name || doc.fileName || doc.originalName || doc.storedName || 'file',
    storedName: doc.storedName || fileBaseName(doc.url || doc.fileUrl || ''),
    mime: doc.mime || doc.mimeType || 'application/octet-stream',
    size: Number(doc.size || 0),
    purpose: doc.purpose || doc.type || 'FILE',
    uploadedBy: doc.uploadedBy || doc.by || 'Team',
    uploadedAt: doc.uploadedAt || now(),
    url: doc.url || (doc.storedName ? `/uploads/${doc.storedName}` : ''),
    downloadUrl: `/api/files/${doc.id}/download`
  };
  if (existing) Object.assign(existing, entry);
  else d.files.unshift(entry);
  doc.downloadUrl = entry.downloadUrl;
  if (!doc.url && entry.url) doc.url = entry.url;
  if (!doc.storedName && entry.storedName) doc.storedName = entry.storedName;
  return doc;
}
function allKnownFileDocs(d={}){
  const caseDocs = (d.cases || []).flatMap(c => [
    ...(c.documents || []),
    ...(c.completedFiles || []),
    ...(c.sourceFiles || []),
    ...(c.workFiles || []),
    ...(c.files || [])
  ].filter(Boolean));
  const chatDocs = (d.teamChat || []).flatMap(m => [
    ...(m.files || []),
    ...(m.attachments || []),
    ...(m.file ? [m.file] : [])
  ].filter(Boolean));
  return [...(d.files || []), ...caseDocs, ...chatDocs].filter(Boolean);
}
function resolveStoredUploadFile(doc={}){
  const candidates = [
    doc.storedName,
    doc.stored_name,
    fileBaseName(doc.url || ''),
    fileBaseName(doc.fileUrl || ''),
    fileBaseName(doc.downloadUrl || ''),
  ].filter(Boolean);
  for (const stored of candidates) {
    const fp = path.resolve(UPLOAD_DIR, stored);
    if (fp.startsWith(path.resolve(UPLOAD_DIR)) && fs.existsSync(fp)) return { stored, fp };
  }
  // Backward compatibility: older records often saved only the original filename.
  const uploadFiles = listUploadFiles();
  const wanted = normalizeFileName(doc.name || doc.fileName || doc.originalName || '');
  if (wanted) {
    const exact = uploadFiles.find(name => normalizeFileName(name) === wanted);
    if (exact) return { stored: exact, fp: path.resolve(UPLOAD_DIR, exact) };
    const suffix = uploadFiles.find(name => normalizeFileName(name).endsWith(wanted));
    if (suffix) return { stored: suffix, fp: path.resolve(UPLOAD_DIR, suffix) };
  }
  return null;
}
function resolveFileById(d, id){
  const docs = allKnownFileDocs(d);
  let doc = docs.find(x => String(x.id || x.fileId || '') === String(id));
  if (!doc) {
    // Some legacy frontend records used the stored file name itself as the id.
    const uploadFiles = listUploadFiles();
    const stored = uploadFiles.find(name => String(name) === String(id) || normalizeFileName(name) === normalizeFileName(id));
    if (stored) doc = { id, name: stored, storedName: stored, url: `/uploads/${stored}` };
  }
  if (!doc) return { doc:null, resolved:null };
  return { doc, resolved: resolveStoredUploadFile(doc) };
}
function normalizePersistedFileLinks(d){
  d.files ||= [];
  for (const doc of allKnownFileDocs(d)) {
    if (!doc || !doc.id) continue;
    doc.downloadUrl = `/api/files/${doc.id}/download`;
    addFileRegistryEntry(d, doc);
  }
  return d;
}
function sanitize(d, role){
  const out=structuredClone(d);
  if(role!=='ADMIN'){
    delete out.payments;
    out.cases=out.cases.map(c=>{ const {estimateAmount,paymentStatus,paymentAmountIn,refundAmount,payerName,transactionId,paymentDate,paymentTime,...rest}=c; return rest; });
  }
  if(role==='DESIGNER') out.audit=[];
  return out;
}
function isActiveCase(c={}){ return !['COMPLETED','CLOSED'].includes(String(c.status||'').toUpperCase()); }
function caseBusySince(c={}){ return toMs(c.startedAt)||toMs(c.assignedAt)||toMs(c.createdAt); }
function teamStatus(d){
  return sanitizePresenceUsers(d.users).map(u=>{
    const active=d.cases.filter(c=>c.assigneeId===u.id && isActiveCase(c));
    const lastDone=d.cases.filter(c=>c.assigneeId===u.id && c.completedAt && !isActiveCase(c)).sort((a,b)=>toMs(b.completedAt)-toMs(a.completedAt))[0];
    const freeSince=active.length?null:(lastDone?.completedAt || null);
    const busySince=active.length?active.map(caseBusySince).filter(Boolean).sort((a,b)=>a-b)[0]:null;
    const completedToday=d.cases.filter(c=>c.assigneeId===u.id && c.completedAt && new Date(c.completedAt).toDateString()===new Date().toDateString()).length;
    return {id:u.id,name:u.name,role:u.role,phone:u.phone,status:active.length?'BUSY':'FREE',activeTasks:active.map(c=>({id:c.id,caseId:c.caseId,customerName:c.customerName,status:c.status,busySince:caseBusySince(c)})),freeSince,freeForMinutes:freeSince?Math.max(0,Math.floor((Date.now()-new Date(freeSince).getTime())/60000)):0,busySince,busyForMinutes:busySince?Math.max(0,Math.floor((Date.now()-Number(busySince))/60000)):0,completedToday};
  });
}
function dailyLedger(d, dateStr=new Date().toISOString().slice(0,10)){
  const same=(iso)=>String(iso||'').slice(0,10)===dateStr;
  const byLocation={};
  d.cases.filter(c=>same(c.createdAt)).forEach(c=>{ byLocation[c.city||'Unknown']=(byLocation[c.city||'Unknown']||0)+1; });
  const pays=d.payments.filter(p=>same(p.paymentDate||p.createdAt));
  return {date:dateStr,totalCases:Object.values(byLocation).reduce((a,b)=>a+b,0),byLocation,paymentReceived:pays.reduce((s,p)=>s+Number(p.paymentAmountIn||0),0),refund:pays.reduce((s,p)=>s+Number(p.refundAmount||0),0),pending:d.cases.reduce((s,c)=>s+((c.paymentStatus==='RECEIVED')?0:Number(c.estimateAmount||0)-Number(c.paymentAmountIn||0)),0),payments:pays};
}
function mentionTargets(text, users){
  const low=String(text||'').toLowerCase();
  return users.filter(u=> low.includes('@'+u.name.toLowerCase().split(' ')[0]) || low.includes('@'+u.role.toLowerCase()) || low.includes('@'+u.name.toLowerCase().replaceAll(' ','') )).map(u=>u.name);
}
function parseLead(text=''){
  const get=(k)=>{ const m=String(text).match(new RegExp(k+'\\s*[:=-]\\s*([^,\\n]+)','i')); return m?.[1]?.trim()||''};
  const amt=String(text).match(/(?:amount|fees|estimate)\D*(\d+)/i);
  return {customerName:get('customer')||get('name')||'WhatsApp Lead',city:get('city')||(/ayodhya/i.test(text)?'Ayodhya':'Lucknow'),serviceType:/floor/i.test(text)?'Floor Plan':/layout/i.test(text)?'Key Layout':/route/i.test(text)?'Key Route + Estimate':'Map Estimate',estimateAmount:amt?Number(amt[1]):'',propertyAddress:text};
}

const app=express();
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean) : true }));
app.use((req,res,next)=>{
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  next();
});
app.use(express.json({limit: process.env.JSON_BODY_LIMIT || '30mb'}));
app.use('/uploads',express.static(UPLOAD_DIR));

function sendProfilePhotoPlaceholder(res) {
  res.status(200);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="28" fill="#f1f5f9"/><circle cx="80" cy="60" r="28" fill="#cbd5e1"/><path d="M34 138c6-28 27-44 46-44s40 16 46 44" fill="#cbd5e1"/></svg>`);
}

function resolveProfilePhotoPath(requestedName = '') {
  const requested = safeName(fileBaseName(requestedName || ''));
  const d = db();
  const candidates = [];
  if (requested) candidates.push(requested);
  for (const user of (d.users || [])) {
    const photoBase = safeName(fileBaseName(user.profilePhoto || ''));
    const storedBase = safeName(fileBaseName(user.profilePhotoFile || ''));
    if (!requested || photoBase === requested || storedBase === requested) {
      if (user.profilePhotoFile) candidates.push(fileBaseName(user.profilePhotoFile));
      if (user.profilePhoto) candidates.push(fileBaseName(user.profilePhoto));
    }
  }
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    const resolved = resolveStoredUploadFile({ storedName: candidate, name: candidate, url: `/uploads/${candidate}` });
    if (resolved?.fp) return resolved.fp;
  }
  return '';
}

app.get('/api/profile/photo/:filename', (req, res) => {
  try {
    const fp = resolveProfilePhotoPath(req.params.filename || '');
    if (!fp) return sendProfilePhotoPlaceholder(res);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(fp);
  } catch (err) {
    sendProfilePhotoPlaceholder(res);
  }
});

app.get('/api/uploads/:filename', (req, res) => {
  try {
    const filename = safeName(req.params.filename || '');
    if (!filename) return res.status(404).send('File not found');
    const fp = path.resolve(UPLOAD_DIR, filename);
    if (!fp.startsWith(path.resolve(UPLOAD_DIR)) || !fs.existsSync(fp)) return res.status(404).send('File not found');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(fp);
  } catch (err) {
    res.status(500).send('Unable to load file');
  }
});

app.get('/api/health', (_req, res) => res.json({ ok:true, service:'Kalpvriksha OTP/API', time:now(), smsProvider:process.env.SMS_PROVIDER || '', emailProvider:process.env.EMAIL_PROVIDER || '' }));

function getEmailStatusPayload() {
  const provider = emailProvider();
  const host = process.env.SMTP_HOST || (provider === 'gmail' ? 'smtp.gmail.com' : '');
  const port = Number(process.env.SMTP_PORT || (provider === 'gmail' ? 465 : 587));
  return {
    ok: true,
    provider,
    configured: !!emailConfigured(),
    from: otpFromEmail(),
    smtpHost: host,
    smtpPort: port,
    smtpSecure: String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false')) === 'true',
    smtpUserConfigured: !!smtpUser(),
    smtpPasswordConfigured: !!smtpPass(),
    localOtpAllowed: localEmailOtpAllowed(),
    mode: emailConfigured() && provider !== 'local' && provider !== 'console' ? 'real-email' : (localEmailOtpAllowed() ? 'local-testing' : 'not-configured')
  };
}

app.get('/api/email/health', (_req, res) => res.json(getEmailStatusPayload()));
app.get('/api/email/status', (_req, res) => res.json(getEmailStatusPayload()));

app.post('/api/email/test', async (req,res)=>{
  try {
    const to = normalizeEmail(req.body.email || req.body.to || '');
    if (!to.includes('@')) return res.status(400).json({ ok:false, error:'Valid email is required.' });
    await sendEmail({
      to,
      subject:'Kalpvriksha Designs Ops Email Test',
      text:'Email configuration is working for Kalpvriksha Designs Ops.',
      html:'<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Kalpvriksha Designs Ops</h2><p>Email configuration is working.</p></div>'
    });
    res.json({ ok:true, message:'Test email sent.' });
  } catch (err) {
    res.status(503).json({ ok:false, error: err.message || 'Could not send test email.' });
  }
});

app.post('/api/otp/send', async (req,res)=>{
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const mobile = normalizeMobile(req.body.mobile || '');
    const email = normalizeEmail(req.body.email || '');
    const purpose = String(req.body.purpose || 'otp');
    const channel = String(req.body.channel || (email ? 'email' : 'mobile')).toLowerCase();
    if (!username) return res.status(400).json({ ok:false, error:'Username is required.' });
    if (channel === 'email' && !email.includes('@')) return res.status(400).json({ ok:false, error:'A valid registered email address is required.' });
    if (channel !== 'email' && mobile.length < 10) return res.status(400).json({ ok:false, error:'A valid registered mobile number is required.' });
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const delivery = channel === 'email' ? await sendOtpEmail(email, otp) : await sendOtpSms(mobile, otp);
    const challengeId = nanoid(12);
    otpStore.set(challengeId, { username, channel, mobileSuffix: mobile.slice(-10), email, purpose, otp, expiresAt: Date.now() + 5*60*1000, attempts: 0 });
    const response = { ok:true, channel, challengeId, expiresInSeconds:300 };
    if (delivery?.localOnly && localEmailOtpAllowed()) {
      response.localOnly = true;
      response.devOtp = otp;
      response.warning = delivery.warning || 'Local email OTP mode used.';
    }
    res.json(response);
  } catch (err) {
    res.status(503).json({ ok:false, error: err.message || 'Could not send OTP.' });
  }
});
app.post('/api/otp/verify', (req,res)=>{
  const challengeId = String(req.body.challengeId || '');
  const otp = String(req.body.otp || '').trim();
  const purpose = String(req.body.purpose || 'otp');
  const record = otpStore.get(challengeId);
  if (!record) return res.status(400).json({ ok:false, error:'OTP session not found. Please send OTP again.' });
  if (record.expiresAt < Date.now()) { otpStore.delete(challengeId); return res.status(400).json({ ok:false, error:'OTP expired. Please send OTP again.' }); }
  if (record.purpose !== purpose) return res.status(400).json({ ok:false, error:'OTP purpose mismatch.' });
  record.attempts += 1;
  if (record.attempts > 5) { otpStore.delete(challengeId); return res.status(429).json({ ok:false, error:'Too many incorrect attempts. Please send OTP again.' }); }
  if (record.otp !== otp) return res.status(400).json({ ok:false, error:'Invalid OTP.' });
  otpStore.delete(challengeId);
  res.json({ ok:true });
});

app.get('/',(_req,res)=>res.json({ok:true,app:'Kalpvriksha Designs ERP'}));
app.get('/api/meta',(_req,res)=>res.json({roles,serviceTypes,statuses,sourceDocTypes,finalDocTypes}));
app.get('/api/bootstrap',(req,res)=>{ const role=req.query.role||'ADMIN'; const d=db(); const safe=sanitize(d,role); const readIds=d.chatReads?.[role]||[]; const unreadChat=d.teamChat.filter(m=>!readIds.includes(m.id)).length; const mentionUnread=d.teamChat.filter(m=>!readIds.includes(m.id)&&(m.mentions||[]).some(x=>String(x).toUpperCase()===role || String(x).toLowerCase().includes(role.toLowerCase()))).length; res.json({...safe,meta:{teamStatus:teamStatus(d),dailyLedger:dailyLedger(d),unreadChat,mentionUnread}}); });

app.get('/api/state',(req,res)=>{
  const d=db();
  const role = requestRole(req);
  const isAdmin = isAdminRoleValue(role);
  const payload = {
    ok:true,
    database: USE_POSTGRES ? 'postgresql' : 'json-file',
    users:sanitizePresenceUsers(d.users || []),
    projects:filterDeletedCases(d.cases || [], d.deletedProjectIds || []),
    deletedProjectIds:d.deletedProjectIds || [],
    chatMessages:d.teamChat || [],
    notifications:d.notifications || [],
    attendanceLogs:d.attendanceLogs || [],
    payments:d.payments || [],
    audit:d.audit || [],
    performanceRecords: mergePerformanceRecords(d.performanceRecords || [], buildPerformanceRecordsFromCases(d.cases || [])),
    performanceSummary: buildPerformanceSummary(mergePerformanceRecords(d.performanceRecords || [], buildPerformanceRecordsFromCases(d.cases || [])), d.users || []),
    savedAt:now()
  };
  if (!isAdmin) {
    const sanitized = sanitize({ ...d, cases: payload.projects }, 'NON_ADMIN');
    payload.projects = sanitized.cases || [];
    delete payload.payments;
    delete payload.audit;
    // Performance records are non-financial operational analytics and are safe for the team dashboards.
  }
  res.json(payload);
});

app.get('/api/performance-records', (req, res) => {
  const d = db();
  const generated = buildPerformanceRecordsFromCases(d.cases || []);
  const records = mergePerformanceRecords(d.performanceRecords || [], generated);
  const summary = buildPerformanceSummary(records, d.users || []);
  res.json({ ok: true, records, summary, diagnostics: buildPerformanceDiagnostics(d.cases || [], records) });
});

app.get('/api/performance/diagnostics', (req, res) => {
  const d = db();
  const generated = buildPerformanceRecordsFromCases(d.cases || []);
  const records = mergePerformanceRecords(d.performanceRecords || [], generated);
  res.json({ ok: true, diagnostics: buildPerformanceDiagnostics(d.cases || [], records), summary: buildPerformanceSummary(records, d.users || []) });
});

app.post('/api/performance/rebuild', (req, res) => {
  const d = db();
  const generated = buildPerformanceRecordsFromCases(d.cases || []);
  const records = mergePerformanceRecords([], generated);
  d.performanceRecords = records;
  save(d);
  const summary = buildPerformanceSummary(records, d.users || []);
  res.json({ ok: true, rebuilt: records.length, records, summary, diagnostics: buildPerformanceDiagnostics(d.cases || [], records) });
});

app.get('/api/app-state', async (req, res) => {
  try {
    const state = await loadDb();
    if (!isFinanceAdminRequest(req)) {
      const safe = sanitize(structuredClone(state), 'NON_ADMIN');
      return res.json({ ok: true, state: safe, ...safe });
    }
    res.json({ ok: true, state, ...state });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/system/status', async (_req, res) => {
  try {
    const db = await getDbStatus();
    res.json({ ok: true, cloudConnected: db.connected, database: db.database, connected: db.connected, localMode: !db.connected });
  } catch (e) {
    res.status(500).json({ ok: false, cloudConnected: false, localMode: true, error: e.message });
  }
});



app.delete('/api/state/projects/:id', (req,res)=>{
  const d=db();
  const id=String(req.params.id || '');
  const before=(d.cases || []).length;
  (d.cases || []).filter(c => String(c.id) === id || String(c.caseId) === id).forEach(c => { rememberDeletedProject(d, c.id); rememberDeletedProject(d, c.caseId); });
  rememberDeletedProject(d, id);
  d.cases=filterDeletedCases(d.cases || [], d.deletedProjectIds || []);
  d.notifications = (d.notifications || []).filter(n => String(n.caseId || n.projectId || n.targetId || '') !== id);
  save(d);
  res.json({ok:true, deleted: before - d.cases.length, deletedProjectIds:d.deletedProjectIds || [], counts:{cases:d.cases.length}});
});

app.post('/api/presence', (req, res) => {
  try {
    const d = db();
    const body = req.body || {};
    const action = String(body.action || 'heartbeat').toLowerCase();
    const userPatch = body.user || body;
    if (!userPatch || (!userPatch.id && !userPatch.username && !userPatch.email && !userPatch.name)) {
      return res.status(400).json({ ok:false, error:'User identity is required for presence update.' });
    }
    const safeAction = ['login','heartbeat','break','resume','logout'].includes(action) ? action : 'heartbeat';
    const user = applyPresenceUpdate(d, userPatch, safeAction);
    save(d);
    res.json({ ok:true, user, users:sanitizePresenceUsers(d.users || []), attendanceLogs:d.attendanceLogs || [] });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message || 'Presence update failed.' });
  }
});

app.post('/api/state',(req,res)=>{
  const d=db();
  const body=req.body || {};
  d.users = Array.isArray(body.users) ? mergeUsersPreservingLatestPresence(d.users || [], body.users) : sanitizePresenceUsers(d.users || []);
  const incomingDeleted = Array.isArray(body.deletedProjectIds) ? body.deletedProjectIds : [];
  d.deletedProjectIds = [...new Set([...(d.deletedProjectIds || []), ...incomingDeleted].map(x => String(x)).filter(Boolean))];
  const incomingCases = Array.isArray(body.projects) ? body.projects : (Array.isArray(body.cases) ? body.cases : []);
  const isFinanceAdmin = isFinanceAdminRequest(req);
  const safeIncomingCases = (Array.isArray(body.projects) || Array.isArray(body.cases)) && !isFinanceAdmin
    ? preserveFinanceForNonAdminCases(d.cases || [], incomingCases)
    : incomingCases;
  d.cases = Array.isArray(body.projects) || Array.isArray(body.cases)
    ? mergeCasesPreservingFreshest(d.cases || [], safeIncomingCases, d.deletedProjectIds || [])
    : dedupeRenamedCases(filterDeletedCases(d.cases || [], d.deletedProjectIds || []), d.deletedProjectIds || []);
  d.teamChat = Array.isArray(body.chatMessages) ? body.chatMessages : (Array.isArray(body.teamChat) ? body.teamChat : d.teamChat);
  d.notifications = Array.isArray(body.notifications) ? body.notifications : d.notifications;
  d.attendanceLogs = Array.isArray(body.attendanceLogs) ? mergeAttendanceLogsPreservingLatest(d.attendanceLogs || [], body.attendanceLogs, d.users || []) : normalizeAttendanceLogsForSave(d.attendanceLogs || [], d.users || []);
  d.payments = isFinanceAdmin && Array.isArray(body.payments) ? body.payments : d.payments;
  d.audit = isFinanceAdmin && Array.isArray(body.audit) ? body.audit : d.audit;
  save(d);
  const performanceRecords = mergePerformanceRecords(d.performanceRecords || [], buildPerformanceRecordsFromCases(d.cases || []));
  res.json({ok:true, database: USE_POSTGRES ? 'postgresql' : 'json-file', savedAt:now(), deletedProjectIds:d.deletedProjectIds || [], performanceRecords, counts:{users:d.users.length, cases:d.cases.length, performanceRecords:performanceRecords.length, chatMessages:d.teamChat.length, notifications:d.notifications.length, attendanceLogs:d.attendanceLogs.length}});
});


app.post('/api/cases', uploadAny, async (req,res)=>{
  const d=db(); const body=req.body; const creatorName=body.creatorName||body.createdBy||'Admin';
  let assignee=d.users.find(u=>u.id===body.assigneeId); if(!assignee) assignee=leastBusy(d);
  const manager=sanitizePresenceUsers(d.users).find(u=>normalizeRole(u.role)==='Manager');
  const createdAt = now();
  const c={id:nanoid(8),caseId:nextCaseNo(d,body.city),source:body.source||'Manual',createdByRole:body.createdByRole||'ADMIN',creatorName,customerName:body.customerName||'New Customer',customerPhone:body.customerPhone||'',bankerName:body.bankerName||'',bank:body.bank||'',branch:body.branch||'',serviceType:body.serviceType||'Map Estimate',otherDescription:body.otherDescription||'',city:body.city||'Lucknow',propertyAddress:body.propertyAddress||'',estimateAmount:body.serviceType==='Map Estimate'||body.serviceType?.includes('Estimate')?Number(body.estimateAmount||0):Number(body.estimateAmount||0),priority:body.priority||'Normal',status:'ASSIGNED',assigneeId:assignee?.id,assigneeName:assignee?.name,assigneeRole:assignee?.role,managerId:manager?.id,managerName:manager?.name,createdAt,startedAt:null,completedAt:null,dueAt:body.dueAt||'',paymentStatus:'PENDING',documents:[],comments:[],revisions:[],history:[{at:createdAt,by:creatorName,action:'Lead created and task assigned'}],timeline:[]};
  addCaseTimelineEvent(c, { type:'created', by:creatorName, at:createdAt, title:'Case Created', remarks:`${c.caseId} created for ${c.customerName}` });
  if (assignee) addCaseTimelineEvent(c, { type:'assigned', by:creatorName, at:createdAt, title:`Assigned to ${assignee.name}`, remarks:'Initial smart assignment' });
  for(const f of (req.files||[])) c.documents.push(addFileRegistryEntry(d, docPayload(f,creatorName,body.createdByRole||'ADMIN','SOURCE',c.id)));
  if ((req.files || []).length) addCaseTimelineEvent(c, { type:'source_uploaded', by:creatorName, title:`${req.files.length} source file(s) uploaded` });
  d.cases.unshift(c); notifyRole(d,'ADMIN',`New case ${c.caseId} created by ${creatorName}`,'task',c.id); notifyRole(d,'MANAGER',`New case ${c.caseId} created by ${creatorName}`,'task',c.id); if(assignee) notifyUser(d,assignee.name,`New task assigned: ${c.caseId}`,'task',c.id); addAudit(d,creatorName,'Case created',c.caseId); save(d); res.json(c);
});
app.post('/api/cases/:id/assign',(req,res)=>{ const d=db(); const c=findCaseByAnyId(d.cases, req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); const u=d.users.find(x=>x.id===req.body.assigneeId); if(!u) return res.status(400).json({error:'Assignee not found'}); const by=req.body.by||'Manager'; c.assigneeId=u.id; c.assigneeName=u.name; c.assigneeRole=u.role; c.status='ASSIGNED'; c.assignedAt=now(); c.history.unshift({at:now(),by,action:`Assigned to ${u.name}`}); addCaseTimelineEvent(c,{type:'assigned',by,title:`Assigned to ${u.name}`,remarks:req.body.remarks||''}); notifyUser(d,u.name,`Task assigned to you: ${c.caseId}`,'task',c.id); addAudit(d,by,'Task assigned',c.caseId); save(d); res.json(c); });
app.post('/api/cases/:id/start',(req,res)=>{ const d=db(); const c=findCaseByAnyId(d.cases, req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); const by=req.body.by||c.assigneeName||'Designer'; c.status='IN_PROGRESS'; c.startedAt ||= now(); c.history.unshift({at:now(),by,action:'Work started'}); addCaseTimelineEvent(c,{type:'started',by,title:'Designer Started',remarks:req.body.remarks||''}); save(d); res.json(c); });
app.post('/api/cases/:id/upload-source', uploadAny,(req,res)=>{ const d=db(); const c=findCaseByAnyId(d.cases, req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); const by=req.body.by||'Admin'; for(const f of req.files||[]) c.documents.push(addFileRegistryEntry(d, docPayload(f,by,req.body.role||'ADMIN','SOURCE',c.id))); c.history.unshift({at:now(),by,action:`Uploaded ${req.files?.length||0} source file(s)`}); addCaseTimelineEvent(c,{type:'source_uploaded',by,title:`${req.files?.length||0} source file(s) uploaded`}); notifyUser(d,c.assigneeName,`New source files added for ${c.caseId}`,'task',c.id); save(d); res.json(c); });
app.post('/api/cases/:id/upload-final', uploadAny,(req,res)=>{ const d=db(); const c=findCaseByAnyId(d.cases, req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); const by=req.body.by||c.assigneeName||'Designer'; const isRevision=String(req.body.isRevision||'false')==='true' || c.status==='REOPENED_FOR_REVISION'; for(const f of req.files||[]) { const doc=addFileRegistryEntry(d, docPayload(f,by,req.body.role||'DESIGNER',isRevision?'REVISION_FINAL':'FINAL',c.id)); doc.type = isRevision ? 'Revised File' : 'Completed File'; doc.folder = isRevision ? 'revised-completed' : 'completed'; c.documents.push(doc); }
  c.status='MANAGER_REVIEW'; c.history.unshift({at:now(),by,action:isRevision?'Revised file uploaded':'Completed file uploaded for manager review'}); addCaseTimelineEvent(c,{type:isRevision?'revision_uploaded':'completion_uploaded',by,title:isRevision?'Revision Completion Uploaded':'Completion Uploaded',remarks:`${req.files?.length||0} file(s) uploaded`}); addCaseTimelineEvent(c,{type:'internal_review',by:'System',title:'Internal Review Pending',remarks:'Completion is awaiting manager review'}); notifyRole(d,'MANAGER',`${isRevision?'Revised':'Completed'} file uploaded: ${c.caseId}`,'completed',c.id); notifyRole(d,'ADMIN',`${isRevision?'Revised':'Completed'} file uploaded: ${c.caseId}`,'completed',c.id); addAudit(d,by,'Final upload',c.caseId); save(d); res.json(c); });
app.post('/api/cases/:id/manager-complete', async (req,res)=>{ const d=db(); const c=findCaseByAnyId(d.cases, req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); const by=req.body.by||'Manager'; c.status='COMPLETED'; c.completedAt=now(); c.history.unshift({at:now(),by,action:'Reviewed by manager and marked complete'}); addCaseTimelineEvent(c,{type:'approved',by,title:'Approved',remarks:'Reviewed by manager and marked complete'}); notifyRole(d,'ADMIN',`Case completed after manager review: ${c.caseId}`,'completed',c.id); notifyUser(d,c.assigneeName,`Case marked complete: ${c.caseId}`,'completed',c.id); addAudit(d,by,'Case completed',c.caseId); save(d); res.json(c); });
app.post('/api/cases/:id/revision',(req,res)=>{ const d=db(); const c=findCaseByAnyId(d.cases, req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); c.status='REOPENED_FOR_REVISION'; c.priority='Urgent'; const rev={id:nanoid(8),note:req.body.note||'Banker revision requested',by:req.body.by||'Admin/Manager',createdAt:now()}; c.revisions.unshift(rev); c.history.unshift({at:now(),by:rev.by,action:'Revision opened as urgent'}); addCaseTimelineEvent(c,{type:'revision_created',by:rev.by,at:rev.createdAt,title:'Revision Created',remarks:rev.note}); notifyUser(d,c.assigneeName,`URGENT revision task: ${c.caseId} - ${rev.note}`,'task',c.id); notifyRole(d,'MANAGER',`URGENT revision opened: ${c.caseId}`,'task',c.id); save(d); res.json(c); });


app.get('/api/cases/:id/timeline', (req,res)=>{
  const d=db();
  const c=findCaseByAnyId(d.cases || [], req.params.id);
  if(!c) return res.status(404).json({ok:false,error:'Case not found'});
  c.timeline = normalizeCaseTimeline(c);
  res.json({ok:true, caseId:c.id, caseNo:c.caseId, timeline:c.timeline});
});

app.post('/api/cases/:id/timeline', (req,res)=>{
  const d=db();
  const c=findCaseByAnyId(d.cases || [], req.params.id);
  if(!c) return res.status(404).json({ok:false,error:'Case not found'});
  const event=addCaseTimelineEvent(c, { type:req.body.type || 'manual', by:req.body.by || req.body.user || 'System', title:req.body.title || req.body.text || 'Timeline Event', remarks:req.body.remarks || req.body.note || '', meta:req.body.meta || {} });
  addAudit(d,event.by,'Timeline event added',c.caseId);
  save(d);
  res.json({ok:true,event,timeline:c.timeline,case:c});
});

app.post('/api/state/projects/:id/payment-status', (req, res) => {
  if (!isFinanceAdminRequest(req)) return denyFinanceAccess(res);
  try {
    const d = db();
    const c = findCaseByAnyId(d.cases || [], req.params.id);
    if (!c) return res.status(404).json({ ok:false, error:'Case not found' });
    const status = normalizePaymentTrackingStatus(req.body.paymentTrackingStatus || req.body.status || req.body.paymentStatus);
    const updated = upsertInlinePaymentLedger(d, c, status, req.body || {});
    updated.updatedAt = Date.now();
    updated.syncVersion = Date.now();
    save(d);
    res.json({ ok:true, project:updated, case:updated, payments:d.payments || [] });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok:false, error:e.message || 'Payment status update failed' });
  }
});

app.post('/api/cases/:id/payment',(req,res)=>{ if (!isFinanceAdminRequest(req)) return denyFinanceAccess(res); const d=db(); const c=d.cases.find(x=>x.id===req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); const received=String(req.body.paymentReceived||'').toUpperCase(); if(!['YES','NO','PARTIAL','REFUND'].includes(received)) return res.status(400).json({error:'paymentReceived is mandatory: YES, NO, PARTIAL or REFUND'}); const p={id:nanoid(8),caseId:c.id,caseNo:c.caseId,location:c.city,bankerName:c.bankerName,bank:c.bank,branch:c.branch,paymentReceived:received,paymentAmountIn:Number(req.body.paymentAmountIn||0),refundAmount:Number(req.body.refundAmount||0),paymentDate:req.body.paymentDate||new Date().toISOString().slice(0,10),paymentTime:req.body.paymentTime||new Date().toTimeString().slice(0,5),payerName:req.body.payerName||'',transactionId:req.body.transactionId||'',mode:req.body.mode||'',note:req.body.note||'',createdAt:now(),createdBy:req.body.by||'Admin'}; d.payments.unshift(p); Object.assign(c,{paymentStatus:received,paymentAmountIn:p.paymentAmountIn,refundAmount:p.refundAmount,payerName:p.payerName,transactionId:p.transactionId,paymentDate:p.paymentDate,paymentTime:p.paymentTime}); c.history.unshift({at:now(),by:p.createdBy,action:`Payment ledger updated: ${received}`}); addAudit(d,p.createdBy,'Payment ledger updated',c.caseId); save(d); res.json(p); });


app.post('/api/profile/photo', uploadSingle('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok:false, error:'No photo uploaded' });
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ ok:false, error:'Only image files are allowed for profile photo.' });
    }
    const d = db();
    const userId = String(req.body.userId || '').trim();
    const username = String(req.body.username || '').trim().toLowerCase();
    const user = (d.users || []).find(u => String(u.id || '') === userId || String(u.username || '').toLowerCase() === username);
    const profilePhoto = `/api/profile/photo/${req.file.filename}`;
    if (user) {
      user.profilePhoto = profilePhoto;
      user.profilePhotoFile = req.file.filename;
      user.profileUpdatedAt = Date.now();
      user.profilePhotoUpdatedAt = Date.now();
      save(d);
    }
    res.json({ ok:true, profilePhoto, url:profilePhoto, storedName:req.file.filename, updated:!!user });
  } catch (err) {
    res.status(500).json({ ok:false, error:err.message || 'Profile photo upload failed' });
  }
});

app.post('/api/files/upload', uploadAny, (req, res) => {
  const incomingFiles = req.files || [];
  const fileFromAnyField = incomingFiles[0];
  if (!fileFromAnyField) return res.status(400).json({ ok:false, error: 'No file uploaded' });
  req.file = fileFromAnyField;
  const d = db();
  const type = String(req.body.type || 'source').toLowerCase();
  const purpose = type === 'completed' ? 'FINAL' : (type === 'working' ? 'WORKING' : 'SOURCE');
  const file = docPayload(req.file, req.body.by || 'Team', req.body.role || 'USER', purpose, req.body.projectId || req.body.caseId || '');
  file.type = type;
  file.folder = type;
  addFileRegistryEntry(d, file);
  save(d);
  res.json({ ok: true, file });
});
app.get('/api/files/:id/status',(req,res)=>{
  const d = db();
  const { doc, resolved } = resolveFileById(d, req.params.id);
  res.json({
    ok: true,
    found: !!doc,
    available: !!resolved,
    id: req.params.id,
    name: doc?.name || doc?.fileName || doc?.storedName || '',
    downloadUrl: doc ? `/api/files/${doc.id || req.params.id}/download` : ''
  });
});
app.get('/api/files/:id/download',(req,res)=>{
  const d=db();
  const { doc, resolved } = resolveFileById(d, req.params.id);
  if(!doc) {
    return res.status(404).send('File record not found. It may be an older unsaved upload. Please refresh the page or re-upload the file.');
  }
  if(!resolved) {
    return res.status(410).send('File unavailable on server. The record exists, but the physical file is missing. Please re-upload this file once.');
  }
  const { stored, fp } = resolved;
  if(!fp.startsWith(path.resolve(UPLOAD_DIR))) return res.status(400).send('Invalid file path');
  res.setHeader('Access-Control-Expose-Headers','Content-Disposition, Content-Length, Content-Type');
  res.setHeader('Cache-Control','private, max-age=0, must-revalidate');
  const fileSize = fs.statSync(fp).size;
  const fileName = doc.name || doc.fileName || stored;
  res.setHeader('Content-Length', String(fileSize));
  if (/\.pdf$/i.test(fileName) || String(doc.mime || doc.mimeType || '').toLowerCase().includes('pdf')) res.type('application/pdf');
  else if (doc.mime || doc.mimeType) res.type(doc.mime || doc.mimeType);
  res.download(fp, fileName);
});

app.delete('/api/files/:id',(req,res)=>{
  const d=db();
  let removed = false;
  let storedNames = [];
  const matches = (doc) => String(doc?.id || '') === String(req.params.id);

  for (const c of d.cases || []) {
    const docs = c.documents || [];
    const completed = c.completedFiles || [];
    [...docs, ...completed].filter(matches).forEach(doc => {
      const resolved = resolveStoredUploadFile(doc);
      const stored = resolved?.stored || doc.storedName || fileBaseName(doc.url || '');
      if (stored) storedNames.push(stored);
    });
    c.documents = docs.filter(doc => !matches(doc));
    c.completedFiles = completed.filter(doc => !matches(doc));
    if (c.documents.length !== docs.length || c.completedFiles.length !== completed.length) {
      removed = true;
      c.history ||= [];
      c.history.unshift({ at: now(), by: req.body?.by || 'Team', action: 'File deleted' });
    }
  }

  for (const m of d.teamChat || []) {
    const files = m.files || [];
    files.filter(matches).forEach(doc => {
      const resolved = resolveStoredUploadFile(doc);
      const stored = resolved?.stored || doc.storedName || fileBaseName(doc.url || '');
      if (stored) storedNames.push(stored);
    });
    m.files = files.filter(doc => !matches(doc));
    if (m.files.length !== files.length) removed = true;
  }

  const registryBefore = d.files || [];
  registryBefore.filter(matches).forEach(doc => {
    const resolved = resolveStoredUploadFile(doc);
    const stored = resolved?.stored || doc.storedName || fileBaseName(doc.url || '');
    if (stored) storedNames.push(stored);
  });
  d.files = registryBefore.filter(doc => !matches(doc));
  if (d.files.length !== registryBefore.length) removed = true;

  [...new Set(storedNames)].forEach(stored => {
    const fp = path.resolve(UPLOAD_DIR, stored);
    if (fp.startsWith(path.resolve(UPLOAD_DIR)) && fs.existsSync(fp)) {
      try { fs.unlinkSync(fp); } catch(e) { console.warn('File unlink failed:', e.message); }
    }
  });

  if (removed) save(d);
  res.json({ ok: true, removed });
});
app.get('/api/cases/:id/share-whatsapp',(req,res)=>{
  const d=db();
  const c=findCaseByAnyId(d.cases || [], req.params.id);
  if(!c) return res.status(404).json({error:'Case not found'});
  const finalDocs=[...(c.completedFiles || []), ...(c.documents||[])]
    .filter(doc => ['FINAL','REVISION_FINAL'].includes(String(doc.purpose || '').toUpperCase()) || ['completed file','revised file','completed'].includes(String(doc.type || '').toLowerCase()));
  if(!finalDocs.length) return res.status(400).json({error:'No completed document available to share'});

  const validDocs = finalDocs.map(doc => {
    const resolved = resolveStoredUploadFile(doc);
    const fileSize = resolved ? fs.statSync(resolved.fp).size : Number(doc.size || 0);
    const fileName = doc.name || doc.fileName || doc.storedName || 'completed-file.pdf';
    const isPdf = /\.pdf$/i.test(fileName) || String(doc.mime || doc.mimeType || '').toLowerCase().includes('pdf');
    return { doc, resolved, fileSize, fileName, isPdf };
  }).filter(x => x.resolved && (!x.isPdf || x.fileSize >= 1200));

  if(!validDocs.length) return res.status(410).json({error:'Completed PDF is missing or appears corrupt on the server. Please re-upload the completed PDF once.'});
  const selected = validDocs.slice(-1);
  const links = selected.map(x => `${publicUrl().replace(':5173',':8080')}/api/files/${x.doc.id}/download`).join('\n');
  const msg=`Kalpvriksha Designs completed document for ${c.caseId || c.id}\nCustomer: ${c.customerName || 'Customer'}\n${links}`;
  res.json({message:msg,waLink:`https://wa.me/?text=${encodeURIComponent(msg)}`,documents:selected.map(x=>({...x.doc, size:x.fileSize, downloadUrl:`/api/files/${x.doc.id}/download`}))});
});

function normalizeTaskReferenceId(value='') { return String(value || '').replace(/^#/, '').trim().toUpperCase(); }
function compactTaskReference(c={}) {
  if (!c) return null;
  return {
    id: c.id || c.caseId || '',
    caseId: c.caseId || c.id || '',
    customerName: c.customerName || '',
    location: c.location || c.city || c.propertyAddress || '',
    bank: c.client || c.bankName || c.bank || '',
    status: c.status || '',
    assignedTo: c.assignedTo || c.assigneeName || ''
  };
}
function resolveChatTaskReferences(text='', explicitRefs=[], cases=[]) {
  const found = new Map();
  const addCase = (c) => {
    const ref = compactTaskReference(c);
    const key = normalizeTaskReferenceId(ref?.id || ref?.caseId);
    if (ref && key && !found.has(key)) found.set(key, ref);
  };
  const allCases = Array.isArray(cases) ? cases : [];
  (Array.isArray(explicitRefs) ? explicitRefs : []).forEach(ref => {
    const key = normalizeTaskReferenceId(ref?.id || ref?.caseId || ref?.taskId);
    const match = allCases.find(c => [c.id, c.caseId].filter(Boolean).some(id => normalizeTaskReferenceId(id) === key));
    if (match) addCase(match);
    else if (key) found.set(key, { id: ref.id || ref.caseId || ref.taskId || '', caseId: ref.caseId || ref.id || ref.taskId || '' });
  });
  const haystack = ` ${String(text || '').toUpperCase()} `;
  allCases.forEach(c => {
    const ids = [c.id, c.caseId].filter(Boolean).map(normalizeTaskReferenceId);
    if (ids.some(id => id && (haystack.includes(`#${id}`) || haystack.includes(` ${id} `) || haystack.includes(`
${id} `) || haystack.includes(` ${id}
`)))) addCase(c);
  });
  return Array.from(found.values()).slice(0, 5);
}

app.post('/api/chat', uploadAny,(req,res)=>{ const d=db(); const text=req.body.text||''; let explicitTaskRefs=[]; try { explicitTaskRefs=req.body.taskRefs?JSON.parse(req.body.taskRefs||'[]'):[]; } catch(e) { explicitTaskRefs=[]; } const taskRefs=resolveChatTaskReferences(text, explicitTaskRefs, d.cases||[]); const ments=mentionTargets(text,d.users).concat(req.body.mentions?JSON.parse(req.body.mentions||'[]'):[]); const unique=[...new Set(ments)]; const msg={id:nanoid(8),by:req.body.by||'Team',role:req.body.role||'ADMIN',caseId:req.body.caseId||'',text,mentions:unique,taskRefs,files:(req.files||[]).map(f=>addFileRegistryEntry(d, docPayload(f,req.body.by||'Team',req.body.role||'ADMIN','CHAT'))),createdAt:now()}; d.teamChat.unshift(msg); if(unique.length){ unique.forEach(name=>notifyUser(d,name,`You were mentioned by ${msg.by} in team chat`,'mention','chat')); } else if(taskRefs.length){ notifyRole(d,'ADMIN',`${msg.by} mentioned task ${taskRefs[0].id || taskRefs[0].caseId} in team chat`,'task','chat'); notifyRole(d,'MANAGER',`${msg.by} mentioned task ${taskRefs[0].id || taskRefs[0].caseId} in team chat`,'task','chat'); notifyRole(d,'DESIGNER',`${msg.by} mentioned task ${taskRefs[0].id || taskRefs[0].caseId} in team chat`,'task','chat'); } else { notifyRole(d,'ADMIN','New normal chat message','normal','chat'); notifyRole(d,'MANAGER','New normal chat message','normal','chat'); notifyRole(d,'DESIGNER','New normal chat message','normal','chat'); } save(d); res.json(msg); });
app.post('/api/chat/read',(req,res)=>{ const d=db(); const role=req.body.role||'ADMIN'; d.chatReads ||= {}; d.chatReads[role]=(d.teamChat||[]).map(m=>m.id); d.notifications.forEach(n=>{ if(n.target==='chat' && (n.to===role || n.to===req.body.name || n.category==='mention')) n.status='READ'; }); save(d); res.json({ok:true}); });
app.post('/api/notifications/:id/read',(req,res)=>{ const d=db(); const n=d.notifications.find(x=>x.id===req.params.id); if(n) n.status='READ'; save(d); res.json({ok:true}); });
app.post('/whatsapp/mock/incoming', uploadAny,(req,res)=>{ const d=db(); const parsed=parseLead(req.body.text||''); const assignee=leastBusy(d); const c={id:nanoid(8),caseId:nextCaseNo(d,parsed.city),source:'WhatsApp',createdByRole:'BANKER',creatorName:req.body.fromName||req.body.from||'WhatsApp Banker',customerName:parsed.customerName,customerPhone:'',bankerName:req.body.fromName||'WhatsApp Banker',bank:req.body.bank||'',branch:req.body.branch||'',serviceType:parsed.serviceType,city:parsed.city,propertyAddress:parsed.propertyAddress,estimateAmount:Number(parsed.estimateAmount||0),priority:'Normal',status:'ASSIGNED',assigneeId:assignee?.id,assigneeName:assignee?.name,assigneeRole:assignee?.role,createdAt:now(),completedAt:null,paymentStatus:'PENDING',documents:(req.files||[]).map(f=>addFileRegistryEntry(d, docPayload(f,'WhatsApp','BANKER','SOURCE'))),comments:[],revisions:[],history:[{at:now(),by:'WhatsApp',action:'Lead created from WhatsApp'}]}; d.cases.unshift(c); d.whatsappInbox.unshift({id:nanoid(8),from:req.body.from,fromName:req.body.fromName,text:req.body.text,createdAt:now(),caseId:c.caseId}); notifyRole(d,'ADMIN',`New WhatsApp case ${c.caseId} from ${c.creatorName}`,'task',c.id); notifyRole(d,'MANAGER',`New WhatsApp case ${c.caseId} from ${c.creatorName}`,'task',c.id); notifyUser(d,c.assigneeName,`New WhatsApp task assigned: ${c.caseId}`,'task',c.id); save(d); res.json(c); });
app.get('/api/qr/:caseId', async (req,res)=>{ const data=await QRCode.toDataURL(`${publicUrl()}/case/${req.params.caseId}`); res.json({qr:data}); });

app.get('/api/db/health', async (_req,res)=>{
  try {
    if (USE_POSTGRES) {
      await ensurePostgres();
      const r = await pool.query('SELECT now() as now');
      const d = db();
      return res.json({ok:true,database:'postgresql',connected:true,time:r.rows[0].now,counts:{users:(d.users||[]).length,cases:(d.cases||[]).length,chatMessages:(d.teamChat||[]).length,notifications:(d.notifications||[]).length,attendanceLogs:(d.attendanceLogs||[]).length}});
    }
    const d = db();
    return res.json({ok:true,database:'json-file',connected:true,file:DB_FILE,warning:'Set DATABASE_URL to use PostgreSQL for production.',counts:{users:(d.users||[]).length,cases:(d.cases||[]).length,chatMessages:(d.teamChat||[]).length,notifications:(d.notifications||[]).length,attendanceLogs:(d.attendanceLogs||[]).length}});
  } catch (err) {
    return res.status(500).json({ok:false,database:USE_POSTGRES?'postgresql':'json-file',error:err.message});
  }
});

const PORT=process.env.PORT||8080;
initStore()
  .then(()=>app.listen(PORT,()=>console.log(`Kalpvriksha API running on http://localhost:${PORT} using ${USE_POSTGRES ? 'PostgreSQL' : 'JSON fallback'}`)))
  .catch(err=>{ console.error('Failed to initialize data store:', err); process.exit(1); });

