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
  cases:[], deletedProjectIds:[], payments:[], notifications:[], teamChat:[], whatsappInbox:[], audit:[], attendanceLogs:[], chatReads:{ADMIN:[],MANAGER:[],DESIGNER:[]}
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
  d.deletedProjectIds = [...new Set((d.deletedProjectIds || []).map(x => String(x)).filter(Boolean))];
  const deletedSet = new Set(d.deletedProjectIds);
  d.cases = (d.cases || []).filter(c => c && !deletedSet.has(String(c.id || '')) && !deletedSet.has(String(c.caseId || '')));
  d.files ||= [];
  d.cases.forEach(c=>{ c.documents ||= []; c.completedFiles ||= c.completedFiles || []; c.history ||= []; c.comments ||= []; c.revisions ||= []; c.creatorName ||= c.createdBy || 'Admin'; c.createdAt ||= new Date().toISOString(); });
  normalizePersistedFileLinks(d);
  return d;
}

function filterDeletedCases(cases = [], deletedProjectIds = []){
  const deletedSet = new Set((deletedProjectIds || []).map(x => String(x)).filter(Boolean));
  return (Array.isArray(cases) ? cases : []).filter(c => c && !deletedSet.has(String(c.id || '')) && !deletedSet.has(String(c.caseId || '')));
}

function rememberDeletedProject(d, id){
  const value = String(id || '').trim();
  if (!value) return;
  d.deletedProjectIds ||= [];
  if (!d.deletedProjectIds.map(String).includes(value)) d.deletedProjectIds.push(value);
}


function now(){ return new Date().toISOString(); }

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
  const add = (u = {}) => {
    const key = teamIdentityKey(u) || String(u.id || Math.random());
    const prev = byId.get(key);
    if (!prev) { byId.set(key, { ...u }); return; }
    const prevTs = presenceTimestamp(prev);
    const nextTs = presenceTimestamp(u);
    // Keep normal profile edits from incoming, but never let an older tab overwrite newer presence.
    const merged = { ...prev, ...u };
    if (prevTs > nextTs) {
      merged.isOnline = prev.isOnline;
      merged.availability = prev.availability;
      merged.lastSeenAt = prev.lastSeenAt;
      merged.lastHeartbeatAt = prev.lastHeartbeatAt;
      merged.lastLoginAt = prev.lastLoginAt;
      merged.lastLogoutAt = prev.lastLogoutAt;
      merged.availabilityUpdatedAt = prev.availabilityUpdatedAt;
      merged.breakStartedAt = prev.breakStartedAt;
    }
    byId.set(key, merged);
  };
  (existing || []).forEach(add);
  (incoming || []).forEach(add);
  return sanitizePresenceUsers([...byId.values()]);
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
  res.json({
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
    savedAt:now()
  });
});

app.get('/api/app-state', async (_req, res) => {
  try {
    const state = await loadDb();
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

app.post('/api/state',(req,res)=>{
  const d=db();
  const body=req.body || {};
  d.users = Array.isArray(body.users) ? mergeUsersPreservingLatestPresence(d.users || [], body.users) : sanitizePresenceUsers(d.users || []);
  const incomingDeleted = Array.isArray(body.deletedProjectIds) ? body.deletedProjectIds : [];
  d.deletedProjectIds = [...new Set([...(d.deletedProjectIds || []), ...incomingDeleted].map(x => String(x)).filter(Boolean))];
  const incomingCases = Array.isArray(body.projects) ? body.projects : (Array.isArray(body.cases) ? body.cases : d.cases);
  d.cases = filterDeletedCases(incomingCases, d.deletedProjectIds || []);
  d.teamChat = Array.isArray(body.chatMessages) ? body.chatMessages : (Array.isArray(body.teamChat) ? body.teamChat : d.teamChat);
  d.notifications = Array.isArray(body.notifications) ? body.notifications : d.notifications;
  d.attendanceLogs = Array.isArray(body.attendanceLogs) ? body.attendanceLogs : d.attendanceLogs;
  d.payments = Array.isArray(body.payments) ? body.payments : d.payments;
  d.audit = Array.isArray(body.audit) ? body.audit : d.audit;
  save(d);
  res.json({ok:true, database: USE_POSTGRES ? 'postgresql' : 'json-file', savedAt:now(), deletedProjectIds:d.deletedProjectIds || [], counts:{users:d.users.length, cases:d.cases.length, chatMessages:d.teamChat.length, notifications:d.notifications.length, attendanceLogs:d.attendanceLogs.length}});
});


app.post('/api/cases', uploadAny, async (req,res)=>{
  const d=db(); const body=req.body; const creatorName=body.creatorName||body.createdBy||'Admin';
  let assignee=d.users.find(u=>u.id===body.assigneeId); if(!assignee) assignee=leastBusy(d);
  const manager=sanitizePresenceUsers(d.users).find(u=>normalizeRole(u.role)==='Manager');
  const c={id:nanoid(8),caseId:nextCaseNo(d,body.city),source:body.source||'Manual',createdByRole:body.createdByRole||'ADMIN',creatorName,customerName:body.customerName||'New Customer',customerPhone:body.customerPhone||'',bankerName:body.bankerName||'',bank:body.bank||'',branch:body.branch||'',serviceType:body.serviceType||'Map Estimate',otherDescription:body.otherDescription||'',city:body.city||'Lucknow',propertyAddress:body.propertyAddress||'',estimateAmount:body.serviceType==='Map Estimate'||body.serviceType?.includes('Estimate')?Number(body.estimateAmount||0):Number(body.estimateAmount||0),priority:body.priority||'Normal',status:'ASSIGNED',assigneeId:assignee?.id,assigneeName:assignee?.name,assigneeRole:assignee?.role,managerId:manager?.id,managerName:manager?.name,createdAt:now(),startedAt:null,completedAt:null,dueAt:body.dueAt||'',paymentStatus:'PENDING',documents:[],comments:[],revisions:[],history:[{at:now(),by:creatorName,action:'Lead created and task assigned'}]};
  for(const f of (req.files||[])) c.documents.push(addFileRegistryEntry(d, docPayload(f,creatorName,body.createdByRole||'ADMIN','SOURCE',c.id)));
  d.cases.unshift(c); notifyRole(d,'ADMIN',`New case ${c.caseId} created by ${creatorName}`,'task',c.id); notifyRole(d,'MANAGER',`New case ${c.caseId} created by ${creatorName}`,'task',c.id); if(assignee) notifyUser(d,assignee.name,`New task assigned: ${c.caseId}`,'task',c.id); addAudit(d,creatorName,'Case created',c.caseId); save(d); res.json(c);
});
app.post('/api/cases/:id/assign',(req,res)=>{ const d=db(); const c=d.cases.find(x=>x.id===req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); const u=d.users.find(x=>x.id===req.body.assigneeId); if(!u) return res.status(400).json({error:'Assignee not found'}); c.assigneeId=u.id; c.assigneeName=u.name; c.assigneeRole=u.role; c.status='ASSIGNED'; c.history.unshift({at:now(),by:req.body.by||'Manager',action:`Assigned to ${u.name}`}); notifyUser(d,u.name,`Task assigned to you: ${c.caseId}`,'task',c.id); addAudit(d,req.body.by||'Manager','Task assigned',c.caseId); save(d); res.json(c); });
app.post('/api/cases/:id/start',(req,res)=>{ const d=db(); const c=d.cases.find(x=>x.id===req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); c.status='IN_PROGRESS'; c.startedAt ||= now(); c.history.unshift({at:now(),by:req.body.by||c.assigneeName,action:'Work started'}); save(d); res.json(c); });
app.post('/api/cases/:id/upload-source', uploadAny,(req,res)=>{ const d=db(); const c=d.cases.find(x=>x.id===req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); for(const f of req.files||[]) c.documents.push(addFileRegistryEntry(d, docPayload(f,req.body.by||'Admin',req.body.role||'ADMIN','SOURCE',c.id))); c.history.unshift({at:now(),by:req.body.by||'Admin',action:`Uploaded ${req.files?.length||0} source file(s)`}); notifyUser(d,c.assigneeName,`New source files added for ${c.caseId}`,'task',c.id); save(d); res.json(c); });
app.post('/api/cases/:id/upload-final', uploadAny,(req,res)=>{ const d=db(); const c=d.cases.find(x=>x.id===req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); const isRevision=String(req.body.isRevision||'false')==='true' || c.status==='REOPENED_FOR_REVISION'; for(const f of req.files||[]) { const doc=addFileRegistryEntry(d, docPayload(f,req.body.by||c.assigneeName,req.body.role||'DESIGNER',isRevision?'REVISION_FINAL':'FINAL',c.id)); doc.type = isRevision ? 'Revised File' : 'Completed File'; doc.folder = isRevision ? 'revised-completed' : 'completed'; c.documents.push(doc); }
  c.status='MANAGER_REVIEW'; c.history.unshift({at:now(),by:req.body.by||c.assigneeName,action:isRevision?'Revised file uploaded':'Completed file uploaded for manager review'}); notifyRole(d,'MANAGER',`${isRevision?'Revised':'Completed'} file uploaded: ${c.caseId}`,'completed',c.id); notifyRole(d,'ADMIN',`${isRevision?'Revised':'Completed'} file uploaded: ${c.caseId}`,'completed',c.id); addAudit(d,req.body.by||c.assigneeName,'Final upload',c.caseId); save(d); res.json(c); });
app.post('/api/cases/:id/manager-complete', async (req,res)=>{ const d=db(); const c=d.cases.find(x=>x.id===req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); c.status='COMPLETED'; c.completedAt=now(); c.history.unshift({at:now(),by:req.body.by||'Manager',action:'Reviewed by manager and marked complete'}); notifyRole(d,'ADMIN',`Case completed after manager review: ${c.caseId}`,'completed',c.id); notifyUser(d,c.assigneeName,`Case marked complete: ${c.caseId}`,'completed',c.id); addAudit(d,req.body.by||'Manager','Case completed',c.caseId); save(d); res.json(c); });
app.post('/api/cases/:id/revision',(req,res)=>{ const d=db(); const c=d.cases.find(x=>x.id===req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); c.status='REOPENED_FOR_REVISION'; c.priority='Urgent'; const rev={id:nanoid(8),note:req.body.note||'Banker revision requested',by:req.body.by||'Admin/Manager',createdAt:now()}; c.revisions.unshift(rev); c.history.unshift({at:now(),by:rev.by,action:'Revision opened as urgent'}); notifyUser(d,c.assigneeName,`URGENT revision task: ${c.caseId} - ${rev.note}`,'task',c.id); notifyRole(d,'MANAGER',`URGENT revision opened: ${c.caseId}`,'task',c.id); save(d); res.json(c); });
app.post('/api/cases/:id/payment',(req,res)=>{ const d=db(); const c=d.cases.find(x=>x.id===req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); const received=String(req.body.paymentReceived||'').toUpperCase(); if(!['YES','NO','PARTIAL','REFUND'].includes(received)) return res.status(400).json({error:'paymentReceived is mandatory: YES, NO, PARTIAL or REFUND'}); const p={id:nanoid(8),caseId:c.id,caseNo:c.caseId,location:c.city,bankerName:c.bankerName,bank:c.bank,branch:c.branch,paymentReceived:received,paymentAmountIn:Number(req.body.paymentAmountIn||0),refundAmount:Number(req.body.refundAmount||0),paymentDate:req.body.paymentDate||new Date().toISOString().slice(0,10),paymentTime:req.body.paymentTime||new Date().toTimeString().slice(0,5),payerName:req.body.payerName||'',transactionId:req.body.transactionId||'',mode:req.body.mode||'',note:req.body.note||'',createdAt:now(),createdBy:req.body.by||'Admin'}; d.payments.unshift(p); Object.assign(c,{paymentStatus:received,paymentAmountIn:p.paymentAmountIn,refundAmount:p.refundAmount,payerName:p.payerName,transactionId:p.transactionId,paymentDate:p.paymentDate,paymentTime:p.paymentTime}); c.history.unshift({at:now(),by:p.createdBy,action:`Payment ledger updated: ${received}`}); addAudit(d,p.createdBy,'Payment ledger updated',c.caseId); save(d); res.json(p); });


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
  res.setHeader('Content-Length', String(fs.statSync(fp).size));
  res.download(fp, doc.name || doc.fileName || stored);
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
app.get('/api/cases/:id/share-whatsapp',(req,res)=>{ const d=db(); const c=d.cases.find(x=>x.id===req.params.id); if(!c) return res.status(404).json({error:'Case not found'}); const finalDocs=(c.documents||[]).filter(doc=>doc.purpose==='FINAL' || doc.purpose==='REVISION_FINAL'); if(!finalDocs.length) return res.status(400).json({error:'No completed document available to share'}); const latestOriginal=finalDocs.filter(x=>x.purpose==='FINAL').slice(-1); const docs=latestOriginal.length?latestOriginal:finalDocs.slice(-1); const links=docs.map(x=>`${publicUrl().replace(':5173',':8080')}/api/files/${x.id}/download`).join('\n'); const msg=`Kalpvriksha Designs completed document for ${c.caseId}\nCustomer: ${c.customerName}\n${links}`; res.json({message:msg,waLink:`https://wa.me/?text=${encodeURIComponent(msg)}`,documents:docs}); });

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

