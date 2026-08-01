import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { nanoid } from 'nanoid';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import pg from 'pg';
import nodemailer from 'nodemailer';
import { addCaseTimelineEvent, mergeTimelineEvents, normalizeCaseTimeline, normalizeTimelineEvent } from './services/timelineService.js';
import { FINANCE_FIELDS, applyFreshestFinance, buildFinanceSnapshot, financeFreshness, financeSnapshotHash, mergePaymentRecords } from './services/financeIntegrityService.js';
import { hashPassword, verifyPassword, passwordPolicyErrors, randomOpaqueToken, tokenHash, randomOtp, normalizeUsername, normalizeAuthRole, normalizeAuthStatus, stripCredentialFields, publicSessionUser, reconcileLegacyCredential } from './services/authService.js';
import { ROLE_CAPABILITIES, authorizationActor, canAccessCase, canMutateCase, canAccessFileDocument, canDeleteFileDocument, filterCasesForUser, hasCapability, isCaseAssignedToUser, normalizePermissionRole, notificationBelongsToUser } from './services/authorizationService.js';
import { attachRequestId, createRateLimiter, rejectDangerousJson, requireJsonForBody, secureResponseHeaders } from './middleware/security.js';
import { getRelationalHealth, loadRelationalState, normalizeEpochMilliseconds, persistRelationalState, reloadRelationalState, restoreRelationalRevision, runRelationalMigrations } from './repositories/postgresStateRepository.js';
import { buildFileReconciliationReport, createFileStorage, FileValidationError } from './services/fileStorageService.js';
import { createOperationalJobStore, filesystemUsage, inspectBackupManifests, recordOperationalEvent, requestLogMiddleware, structuredLog } from './services/operationalReliabilityService.js';
import { readAndVerifyReleaseCertificate } from './services/releaseCertificationService.js';
import { createCorsOriginPolicy, parseCorsOrigins } from './config/corsPolicy.js';
import { mergeLatestPresenceIntoSnapshot, preserveDirtyPresenceAfterReload } from './services/persistenceBackpressureService.js';
import { getRequestStateSnapshot } from './services/requestStateService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function boundedNumber(value, fallback, minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);
  const safeValue = Number.isFinite(parsed) ? parsed : Number(fallback);
  return Math.max(minimum, Math.min(maximum, safeValue));
}

function boundedEnvNumber(name, fallback, minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY) {
  const raw = String(process.env[name] ?? '').trim();
  return boundedNumber(raw === '' ? fallback : raw, fallback, minimum, maximum);
}

const DATA_DIR = process.env.KALPA_DATA_DIR ? path.resolve(process.env.KALPA_DATA_DIR) : path.join(__dirname, 'data');
const LEGACY_UPLOAD_DIR = process.env.KALPA_LEGACY_UPLOAD_DIR
  ? path.resolve(process.env.KALPA_LEGACY_UPLOAD_DIR)
  : (process.env.KALPA_UPLOAD_DIR ? path.resolve(process.env.KALPA_UPLOAD_DIR) : path.join(__dirname, 'uploads'));
const FILE_STORAGE_ROOT = process.env.KALPA_FILE_STORAGE_ROOT
  ? path.resolve(process.env.KALPA_FILE_STORAGE_ROOT)
  : path.join(DATA_DIR, 'private-files');
const BACKUP_ROOT = process.env.KALPA_BACKUP_ROOT ? path.resolve(process.env.KALPA_BACKUP_ROOT) : path.join(DATA_DIR, 'backups');
const RELEASE_CERTIFICATE_PATH = process.env.RELEASE_CERTIFICATE_PATH ? path.resolve(process.env.RELEASE_CERTIFICATE_PATH) : path.join(DATA_DIR, 'release-certification.json');
const RELEASE_CERTIFICATE_MAX_AGE_HOURS = boundedEnvNumber('RELEASE_CERTIFICATE_MAX_AGE_HOURS', 24, 1, 168);
const BACKUP_MAX_AGE_HOURS = boundedEnvNumber('BACKUP_MAX_AGE_HOURS', 26, 1, 720);
const DISK_WARNING_PERCENT = boundedEnvNumber('DISK_WARNING_PERCENT', 80, 50, 98);
const DISK_CRITICAL_PERCENT = boundedEnvNumber('DISK_CRITICAL_PERCENT', 90, DISK_WARNING_PERCENT + 1, 100);
const DB_FILE = process.env.KALPA_DB_FILE ? path.resolve(process.env.KALPA_DB_FILE) : path.join(DATA_DIR, 'db.json');
const AUTH_FILE = process.env.KALPA_AUTH_FILE ? path.resolve(process.env.KALPA_AUTH_FILE) : path.join(DATA_DIR, 'auth.json');
const SESSION_COOKIE_NAME = String(process.env.SESSION_COOKIE_NAME || 'kv_session').trim();
const SESSION_TTL_HOURS = boundedEnvNumber('SESSION_TTL_HOURS', 12, 1, 168);
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;
const LOGIN_LOCK_MINUTES = boundedEnvNumber('LOGIN_LOCK_MINUTES', 15, 1, 120);
const LOGIN_MAX_ATTEMPTS = boundedEnvNumber('LOGIN_MAX_ATTEMPTS', 5, 3, 20);
const JSON_BODY_LIMIT = String(process.env.JSON_BODY_LIMIT || '8mb');
const MAX_STATE_PROJECTS_PER_WRITE = boundedEnvNumber('MAX_STATE_PROJECTS_PER_WRITE', 1500, 1, 5000);
const MAX_CHAT_TEXT_LENGTH = boundedEnvNumber('MAX_CHAT_TEXT_LENGTH', 10000, 100, 50000);
const MAX_TIMELINE_TEXT_LENGTH = boundedEnvNumber('MAX_TIMELINE_TEXT_LENGTH', 2000, 100, 10000);
const MAX_CASE_TEXT_LENGTH = boundedEnvNumber('MAX_CASE_TEXT_LENGTH', 5000, 100, 20000);
const STATE_REVISION_RETENTION = boundedEnvNumber('STATE_REVISION_RETENTION', 200, 25, 5000);
const WHATSAPP_WEBHOOK_SECRET = String(process.env.WHATSAPP_WEBHOOK_SECRET || '').trim();
const RUNTIME_MODE = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_PRODUCTION = RUNTIME_MODE === 'production';
const BACKUP_REQUIRED = IS_PRODUCTION ? String(process.env.BACKUP_REQUIRED || 'true').trim().toLowerCase() !== 'false' : String(process.env.BACKUP_REQUIRED || '').trim().toLowerCase() === 'true';
const RELEASE_CERTIFICATE_REQUIRED = IS_PRODUCTION ? String(process.env.RELEASE_CERTIFICATE_REQUIRED || 'true').trim().toLowerCase() !== 'false' : String(process.env.RELEASE_CERTIFICATE_REQUIRED || '').trim().toLowerCase() === 'true';
const ALLOW_JSON_FALLBACK = !IS_PRODUCTION && String(process.env.ALLOW_JSON_FALLBACK || '').trim().toLowerCase() === 'true';
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
fs.mkdirSync(LEGACY_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BACKUP_ROOT, { recursive: true });

const BACKEND_PACKAGE_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || ''; } catch { return ''; }
})();

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || '';
const USE_POSTGRES = /^postgres(ql)?:\/\//i.test(DATABASE_URL);
const pool = USE_POSTGRES ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: boundedEnvNumber('DB_CONNECT_TIMEOUT_MS', 10000, 1000, 120000)
}) : null;
const operationalJobs = createOperationalJobStore({ pool, dataDir:DATA_DIR, usePostgres:USE_POSTGRES });
const serverStartedAt = new Date().toISOString();
let shuttingDown = false;
let lastPersistenceFailure = null;
let lastPersistenceSuccess = null;
let memoryState = null;
let relationalShadowState = null;
let postgresReady = false;
let stateVersion = 0;
let legacyCredentialCandidates = [];
let persistenceQueue = Promise.resolve();
let persistenceQueueDepth = 0;
let persistenceInFlight = 0;
let lastPersistenceDurationMs = 0;
let lastPersistenceReason = '';
let performanceDataRevision = 0;
let workspaceDataRevision = 0;
const WORKSPACE_SYNC_COLLECTIONS = Object.freeze(['users','cases','deletedProjectIds','teamChat','notifications','attendanceLogs']);
let workspaceCollectionRevisions = Object.fromEntries(WORKSPACE_SYNC_COLLECTIONS.map(collection => [collection, 0]));
let performanceBundleCache = { revision:-1, records:[], summary:null, diagnostics:null };
let leaderboardAggregateCache = new Map();
let activeForegroundWriteRequests = 0;
let presenceMutationGeneration = 0;
let persistedPresenceGeneration = 0;
let presenceFlushTimer = null;
let presenceFlushPromise = null;
const PRESENCE_HEARTBEAT_FLUSH_MS = boundedEnvNumber('PRESENCE_HEARTBEAT_FLUSH_MS', 180_000, 60_000, 15 * 60_000);
const PRESENCE_FLUSH_RETRY_MS = boundedEnvNumber('PRESENCE_FLUSH_RETRY_MS', 15_000, 5_000, 60_000);
const snapshotVersions = new WeakMap();
const snapshotPresenceGenerations = new WeakMap();

const safeName = (name='file') => String(name).replace(/[^a-zA-Z0-9.\-_]/g, '_');
const MAX_UPLOAD_SIZE_MB = boundedEnvNumber('MAX_UPLOAD_SIZE_MB', 100, 1, 500);
const MAX_UPLOAD_FILES = boundedEnvNumber('MAX_UPLOAD_FILES', 20, 1, 100);
const MAX_INLINE_PREVIEW_MB = boundedEnvNumber('MAX_INLINE_PREVIEW_MB', 15, 1, 50);
const MAX_INLINE_PREVIEW_BYTES = MAX_INLINE_PREVIEW_MB * 1024 * 1024;
const fileStorage = createFileStorage({
  root: FILE_STORAGE_ROOT,
  legacyRoots: [LEGACY_UPLOAD_DIR]
});
if (IS_PRODUCTION && !String(process.env.KALPA_FILE_STORAGE_ROOT || '').trim()) {
  throw new Error('KALPA_FILE_STORAGE_ROOT is required in production and must point to persistent private storage outside the deployment directory.');
}
if (IS_PRODUCTION && String(process.env.FILE_STORAGE_PERSISTENT || '').trim().toLowerCase() !== 'true') {
  throw new Error('FILE_STORAGE_PERSISTENT=true is required in production after persistent storage has been mounted and verified.');
}
const storageHealthAtStartup = fileStorage.health();
if (!storageHealthAtStartup.ok) throw new Error(`Private file storage is not writable: ${storageHealthAtStartup.error || FILE_STORAGE_ROOT}`);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, fileStorage.tempDestination()),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${nanoid(12)}-${safeName(file.originalname || 'incoming')}.upload`)
  }),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: MAX_UPLOAD_FILES,
    fields: 100,
    parts: MAX_UPLOAD_FILES + 100
  }
});

function uploadErrorPayload(err) {
  const code = err?.code || '';
  if (code === 'LIMIT_FILE_SIZE') return { status: 413, error: `File is larger than the configured ${MAX_UPLOAD_SIZE_MB} MB upload limit.` };
  if (code === 'LIMIT_FILE_COUNT') return { status: 413, error: `A maximum of ${MAX_UPLOAD_FILES} files can be uploaded in one request.` };
  if (code === 'LIMIT_FIELD_COUNT' || code === 'LIMIT_PART_COUNT') return { status: 400, error: 'The upload contains too many form fields or parts.' };
  if (code === 'LIMIT_UNEXPECTED_FILE') return { status: 400, error: 'Upload field mismatch. Please refresh the page and try again.' };
  return { status: 400, error: err?.message || 'Upload failed before the file reached the server.' };
}

function cleanupIncomingUploads(files = []) {
  const tempRoot=path.resolve(fileStorage.tempRoot);
  for (const file of Array.isArray(files) ? files : []) {
    try {
      const candidate=file?.path ? path.resolve(file.path) : '';
      if (candidate && candidate.startsWith(`${tempRoot}${path.sep}`) && fs.existsSync(candidate)) fs.unlinkSync(candidate);
    } catch {}
  }
}

function cleanupRequestTempUploads(req = {}) {
  cleanupIncomingUploads(Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []));
}

function rollbackPreparedUploads(files = [], details = {}) {
  // The database reference is rolled back, but content-addressed objects must
  // not be moved immediately. A concurrent request may already have
  // deduplicated to the same hash and be waiting to commit its own row. Keep
  // the private object as a garbage-collection candidate and record the event.
  for (const file of Array.isArray(files) ? files : []) {
    const storageKey = String(file?.storageKey || file?.storedName || '').trim();
    if (!storageKey || file?.deduplicated || !storageKey.startsWith('objects/')) continue;
    void recordFileStorageEvent({
      fileId:details.fileId || file?.id || '',
      caseId:details.caseId || '',
      action:'UPLOAD_ORPHAN_CANDIDATE',
      actor:details.actor || 'system',
      storageKey,
      sha256:file?.sha256 || '',
      details:{ reason:details.reason || 'PERSISTENCE_FAILED_AFTER_UPLOAD', physicalAction:'retained-for-safe-gc' }
    });
  }
}

async function prepareSecureUploads(req, purpose = 'FILE', options = {}) {
  const files = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
  const prepared = [];
  try {
    for (const file of files) {
      const secured = await fileStorage.validateAndStore(file, { purpose });
      if (options.imagesOnly && !String(secured.detectedMime || '').startsWith('image/')) {
        rollbackPreparedUploads([secured], { reason:'PROFILE_PHOTO_NON_IMAGE', actor:'system' });
        throw new FileValidationError('PROFILE_PHOTO_INVALID', 'Profile photos must contain a valid supported image.', 400);
      }
      Object.assign(file, {
        filename: secured.storageKey,
        storageKey: secured.storageKey,
        storedName: secured.storageKey,
        sha256: secured.sha256,
        securityStatus: secured.securityStatus,
        antivirusStatus: secured.antivirusStatus,
        antivirusEngine: secured.antivirusEngine,
        storageProvider: secured.storageProvider,
        detectedMime: secured.detectedMime,
        suppliedMime: secured.suppliedMime,
        mimetype: secured.detectedMime,
        originalname: secured.originalName,
        size: secured.size,
        deduplicated: secured.deduplicated,
        storedAt: secured.storedAt,
        path: fileStorage.resolve({ storageKey: secured.storageKey })?.fp || ''
      });
      prepared.push(file);
    }
    req.files = prepared;
    req.file = prepared[0] || null;
    return prepared;
  } catch (error) {
    cleanupIncomingUploads(files);
    rollbackPreparedUploads(prepared,{reason:'UPLOAD_BATCH_ROLLED_BACK',actor:'system'});
    throw error;
  }
}

function fileUploadFailure(res, error, fallback = 'File upload failed.') {
  const status = Number(error?.statusCode || 400);
  return res.status(status).json({ ok:false, code:error?.code || 'FILE_VALIDATION_FAILED', error:error?.message || fallback, details:error?.details || undefined });
}

function isResolvedStoragePathAllowed(fp = '') {
  const resolved = path.resolve(String(fp || ''));
  return [fileStorage.root, LEGACY_UPLOAD_DIR].some(root => resolved === path.resolve(root) || resolved.startsWith(`${path.resolve(root)}${path.sep}`));
}
function uploadAny(req, res, next) {
  upload.any()(req, res, (err) => {
    if (err) {
      cleanupRequestTempUploads(req);
      const payload = uploadErrorPayload(err);
      return res.status(payload.status).json({ ok:false, error:payload.error, code:err.code || 'UPLOAD_ERROR' });
    }
    req.files = Array.isArray(req.files) ? req.files : [];
    let cleaned=false;
    const cleanup=()=>{ if (cleaned) return; cleaned=true; cleanupRequestTempUploads(req); };
    res.once('finish', cleanup);
    res.once('close', cleanup);
    next();
  });
}
function uploadSingle(fieldName) {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err) {
        cleanupRequestTempUploads(req);
        const payload = uploadErrorPayload(err);
        return res.status(payload.status).json({ ok:false, error:payload.error, code:err.code || 'UPLOAD_ERROR' });
      }
      let cleaned=false;
      const cleanup=()=>{ if (cleaned) return; cleaned=true; cleanupRequestTempUploads(req); };
      res.once('finish', cleanup);
      res.once('close', cleanup);
      next();
    });
  };
}

const roles = ['ADMIN','MANAGER','DESIGNER'];
const serviceTypes = ['Map Estimate','Key Route + Estimate','Key Layout','Colony Layout','Builder Layout','Sub Division','Floor Plan','Site Plan','Bank Technical Drawing','Other'];
const statuses = ['NEW_LEAD','ASSIGNED','IN_PROGRESS','DESIGN_SUBMITTED','MANAGER_REVIEW','REVISION_REQUIRED','COMPLETED','REOPENED_FOR_REVISION','CLOSED'];
const sourceDocTypes = ['Sale Deed','ATS','Technical Report','GPS Photo','Property Photo','Site Photo','Bank Technical','Admin Instruction','Excel Sheet','Word Document','Image/Photo','AutoCAD DWG/DXF','Other'];
const finalDocTypes = ['Completed PDF','Completed DWG','Completed DXF','Completed Excel','Completed Word','Completed Image/Photo','Revised PDF','Revised DWG/DXF','Other'];

// Source packages must never contain staff credentials, client records, messages,
// attendance, payments, or uploaded documents. PostgreSQL remains the source of
// truth in production; this empty seed exists only for an explicitly enabled
// local JSON sandbox.
const seed = {
  users:[],
  cases:[],
  deletedProjectIds:[],
  payments:[],
  performanceRecords:[],
  notifications:[],
  teamChat:[],
  whatsappInbox:[],
  audit:[],
  attendanceLogs:[],
  files:[],
  chatReads:{ADMIN:[],MANAGER:[],DESIGNER:[]}
};

function assertPersistenceConfiguration() {
  if (IS_PRODUCTION && !String(process.env.CORS_ORIGIN || '').trim()) {
    throw new Error('Production startup blocked: CORS_ORIGIN must explicitly list the trusted frontend origin(s).');
  }
  if (IS_PRODUCTION && !USE_POSTGRES) {
    throw new Error('Production startup blocked: DATABASE_URL must contain a valid PostgreSQL connection string.');
  }
  if (IS_PRODUCTION && BACKUP_REQUIRED && !String(process.env.KALPA_BACKUP_ROOT || '').trim()) {
    throw new Error('Production startup blocked: KALPA_BACKUP_ROOT must point to persistent backup storage outside the release directory.');
  }
  if (IS_PRODUCTION && BACKUP_REQUIRED && String(process.env.BACKUP_STORAGE_PERSISTENT || '').trim().toLowerCase() !== 'true') {
    throw new Error('Production startup blocked: BACKUP_STORAGE_PERSISTENT=true is required after independent backup storage is mounted and verified.');
  }
  if (!USE_POSTGRES && !ALLOW_JSON_FALLBACK) {
    throw new Error('No persistence backend configured. Set DATABASE_URL, or set ALLOW_JSON_FALLBACK=true only for an isolated local-development sandbox.');
  }
}

async function ensurePostgres() {
  if (!USE_POSTGRES || postgresReady) return;
  await runRelationalMigrations(pool);
  postgresReady = true;
}

function readJsonFallback(){
  if (!ALLOW_JSON_FALLBACK) {
    throw new Error('JSON fallback access blocked outside the explicit local-development sandbox.');
  }
  if(!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(seed,null,2));
  return JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
}

function captureLegacyCredentialCandidates(rawState = {}) {
  legacyCredentialCandidates = (Array.isArray(rawState?.users) ? rawState.users : [])
    .filter(user => user && (user.password || user.passwordHash || user.password_hash))
    .map(user => ({
      id: String(user.id || '').trim(),
      username: normalizeUsername(user.username || ''),
      password: String(user.password || user.passwordHash || user.password_hash || ''),
      role: user.role,
      status: user.status
    }));
}

async function initStore(){
  assertPersistenceConfiguration();
  if (USE_POSTGRES) {
    await ensurePostgres();
    const loaded = await loadRelationalState(pool, { normalizeState: norm, seedState: seed });
    if (loaded.legacyState) captureLegacyCredentialCandidates(loaded.legacyState);
    else captureLegacyCredentialCandidates(loaded.state);
    memoryState = norm(loaded.state);
    relationalShadowState = structuredClone(loaded.persistedState || loaded.state);
    stateVersion = Number(loaded.stateVersion || 0);
  } else {
    const rawState = readJsonFallback();
    captureLegacyCredentialCandidates(rawState);
    stateVersion = Number(rawState.__stateVersion || 0);
    delete rawState.__stateVersion;
    memoryState = norm(rawState);
    relationalShadowState = null;
  }
  workspaceDataRevision = Number(stateVersion || 0);
  workspaceCollectionRevisions = Object.fromEntries(WORKSPACE_SYNC_COLLECTIONS.map(collection => [collection, Number(stateVersion || 0)]));
}

function readDb(){
  if (!memoryState) throw new Error('Application state is not initialized.');
  return memoryState;
}

function db(){
  if (!memoryState) throw new Error('Application state is not initialized.');
  const snapshot = structuredClone(memoryState);
  snapshotVersions.set(snapshot, stateVersion);
  snapshotPresenceGenerations.set(snapshot, presenceMutationGeneration);
  return snapshot;
}

function requestDb(req = {}) {
  return getRequestStateSnapshot(req, db);
}

async function reloadCommittedState(){
  if (!USE_POSTGRES) return;
  const liveStateBeforeReload = memoryState;
  const loaded = await reloadRelationalState(pool, { normalizeState: norm });
  relationalShadowState = structuredClone(loaded.persistedState || loaded.state);
  memoryState = norm(preserveDirtyPresenceAfterReload({
    committedState:loaded.state,
    liveState:liveStateBeforeReload,
    mutationGeneration:presenceMutationGeneration,
    persistedGeneration:persistedPresenceGeneration
  }));
  stateVersion = Number(loaded.stateVersion || 0);
  workspaceDataRevision = Math.max(workspaceDataRevision + 1, stateVersion);
  workspaceCollectionRevisions = Object.fromEntries(WORKSPACE_SYNC_COLLECTIONS.map(collection => [
    collection,
    Math.max(Number(workspaceCollectionRevisions[collection] || 0) + 1, stateVersion)
  ]));
  performanceDataRevision += 1;
  leaderboardAggregateCache.clear();
}

function metadataAffectsPerformance(metadata = {}) {
  const sourceCollections = Array.isArray(metadata.requestedCollections) ? metadata.requestedCollections : metadata.collections;
  const collections = Array.isArray(sourceCollections) ? sourceCollections.map(value => String(value || '').trim()) : null;
  if (!collections) return true;
  if (collections.includes('cases') || collections.includes('performanceRecords')) return true;
  if (collections.includes('users')) {
    const reason = String(metadata.reason || '').trim().toLowerCase();
    // Heartbeats change only live presence and must not rebuild historical
    // productivity aggregates. Every other user write can change membership,
    // names, roles, limits or approval state and therefore must invalidate the
    // team comparison cache.
    return !reason.startsWith('presence_');
  }
  return false;
}

function workspaceCollectionsFromMetadata(metadata = {}) {
  const reason = String(metadata.reason || '').trim().toLowerCase();
  if (reason.startsWith('presence_')) return [];
  const sourceCollections = Array.isArray(metadata.requestedCollections) ? metadata.requestedCollections : metadata.collections;
  const collections = Array.isArray(sourceCollections)
    ? sourceCollections.map(value => String(value || '').trim()).filter(Boolean)
    : null;
  if (!collections) return [...WORKSPACE_SYNC_COLLECTIONS];
  return WORKSPACE_SYNC_COLLECTIONS.filter(collection => collections.includes(collection));
}

function markWorkspaceCollectionsChanged(metadata = {}) {
  const changed = workspaceCollectionsFromMetadata(metadata);
  if (!changed.length) return false;
  workspaceDataRevision += 1;
  for (const collection of changed) workspaceCollectionRevisions[collection] = workspaceDataRevision;
  return true;
}

function save(d, metadata = {}){
  const snapshotPresenceGeneration = Number(snapshotPresenceGenerations.get(d) ?? presenceMutationGeneration);
  const latestPresence = mergeLatestPresenceIntoSnapshot({
    snapshot:d,
    liveState:memoryState,
    snapshotGeneration:snapshotPresenceGeneration,
    liveGeneration:presenceMutationGeneration
  });
  const expectedVersion = Number(snapshotVersions.get(d) ?? stateVersion);
  if (expectedVersion !== stateVersion) {
    const error = new Error(`This update was created from stale application state. Expected local version ${expectedVersion}, current version ${stateVersion}. Refresh and retry.`);
    error.statusCode = 409;
    error.code = 'STATE_VERSION_CONFLICT';
    return Promise.reject(error);
  }
  const targetVersion = expectedVersion + 1;
  const includedPresenceGeneration = latestPresence.includedPresenceGeneration;
  const requestedCollections = Array.isArray(metadata.collections) ? metadata.collections.map(value => String(value || '').trim()).filter(Boolean) : null;
  const effectiveCollections = requestedCollections ? [...new Set(requestedCollections)] : null;
  if (effectiveCollections && includedPresenceGeneration > persistedPresenceGeneration) {
    if (!effectiveCollections.includes('users')) effectiveCollections.push('users');
    if (!effectiveCollections.includes('attendanceLogs')) effectiveCollections.push('attendanceLogs');
  }
  const effectiveMetadata = effectiveCollections
    ? { ...metadata, collections:effectiveCollections, requestedCollections:requestedCollections ? [...requestedCollections] : null }
    : metadata;
  const normalized = normalizeStateForSelectiveSave(latestPresence.state, effectiveMetadata);
  const persistenceReason = String(effectiveMetadata.reason || (effectiveMetadata.financeEvent ? 'finance_update' : effectiveMetadata.authOperations?.length ? 'authentication_update' : 'state_update'));
  if (metadataAffectsPerformance(effectiveMetadata)) {
    performanceDataRevision += 1;
    leaderboardAggregateCache.clear();
  }
  markWorkspaceCollectionsChanged(effectiveMetadata);
  // Make queued changes visible to later requests in this process. The queued
  // PostgreSQL transaction still has to succeed before the API returns success.
  memoryState = structuredClone(normalized);
  stateVersion = targetVersion;
  persistenceQueueDepth += 1;

  const persist = async () => {
    const startedAt = Date.now();
    persistenceInFlight += 1;
    try {
      if (!USE_POSTGRES) {
        normalized.__stateVersion = targetVersion;
        fs.writeFileSync(DB_FILE, JSON.stringify(normalized,null,2));
        delete normalized.__stateVersion;
        if (Array.isArray(effectiveMetadata.authOperations) && effectiveMetadata.authOperations.length) applyLocalAuthOperations(effectiveMetadata.authOperations);
        return { stateVersion:targetVersion, persistedAt: now(), database: 'json-file' };
      }

      await ensurePostgres();
      try {
        const inferredActor = effectiveMetadata.actor
          || effectiveMetadata.financeEvent?.actor
          || normalized.audit?.[0]?.actor
          || normalized.audit?.[0]?.by
          || normalized.audit?.[0]?.user
          || 'system';
        const result = await persistRelationalState(pool, {
          state: normalized,
          expectedVersion,
          targetVersion,
          metadata: { ...effectiveMetadata, actor: inferredActor, reason:persistenceReason },
          applyAuthOperationsWithClient,
          financeSnapshotHash,
          revisionRetention: STATE_REVISION_RETENTION,
          persistedBaseState: relationalShadowState
        });
        if (result?.committedState) relationalShadowState = structuredClone(result.committedState);
        if (process.env.WRITE_JSON_BACKUP === 'true') fs.writeFileSync(DB_FILE, JSON.stringify(normalized,null,2));
        return result;
      } catch (error) {
        await reloadCommittedState().catch(() => {});
        throw error;
      }
    } finally {
      persistenceInFlight = Math.max(0, persistenceInFlight - 1);
      lastPersistenceDurationMs = Math.max(0, Date.now() - startedAt);
      lastPersistenceReason = persistenceReason;
    }
  };

  const queued = persistenceQueue.then(persist, persist).then(async result => {
    persistedPresenceGeneration = Math.max(persistedPresenceGeneration, includedPresenceGeneration);
    lastPersistenceSuccess = {
      at:now(),
      stateVersion:targetVersion,
      database:result?.database || (USE_POSTGRES ? 'postgresql-relational' : 'json-file'),
      durationMs:lastPersistenceDurationMs,
      reason:persistenceReason
    };
    lastPersistenceFailure = null;
    return result;
  }, async error => {
    lastPersistenceFailure = { at:now(), code:error?.code || 'PERSISTENCE_FAILED', message:error?.message || String(error), expectedVersion, targetVersion, reason:persistenceReason, durationMs:lastPersistenceDurationMs };
    await operationalJobs.recordFailure('STATE_PERSISTENCE', error, { expectedVersion, targetVersion, reason:persistenceReason }, { maxAttempts:5 }).catch(() => {});
    await recordOperationalEvent(pool, USE_POSTGRES, { eventType:'STATE_PERSISTENCE_FAILED', severity:'ERROR', actor:effectiveMetadata.actor || effectiveMetadata.financeEvent?.actor || 'system', details:lastPersistenceFailure }).catch(() => {});
    throw error;
  }).finally(() => {
    persistenceQueueDepth = Math.max(0, persistenceQueueDepth - 1);
  });
  persistenceQueue = queued.catch(() => {});
  return queued;
}

function replacePresenceSliceInMemory(d = {}) {
  if (!memoryState) throw new Error('Application state is not initialized.');
  memoryState = {
    ...memoryState,
    users: structuredClone(d.users || []),
    attendanceLogs: structuredClone(d.attendanceLogs || [])
  };
  presenceMutationGeneration += 1;
}

function clearPresenceFlushTimer() {
  if (!presenceFlushTimer) return;
  clearTimeout(presenceFlushTimer);
  presenceFlushTimer = null;
}

function schedulePresenceFlush(delayMs = PRESENCE_HEARTBEAT_FLUSH_MS) {
  if (shuttingDown || presenceFlushTimer || presenceFlushPromise || presenceMutationGeneration <= persistedPresenceGeneration) return;
  presenceFlushTimer = setTimeout(() => {
    presenceFlushTimer = null;
    flushPresenceHeartbeatBatch().catch(error => {
      structuredLog('error','presence_flush_failed',{code:error?.code || '',error:error?.message || String(error)});
    });
  }, boundedNumber(delayMs, PRESENCE_HEARTBEAT_FLUSH_MS, 1_000, 15 * 60_000));
  presenceFlushTimer.unref?.();
}

async function flushPresenceHeartbeatBatch({ force = false, reason = 'presence_heartbeat_batch' } = {}) {
  if (presenceFlushPromise) return presenceFlushPromise;
  if (presenceMutationGeneration <= persistedPresenceGeneration) return null;
  if (!force && (activeForegroundWriteRequests > 0 || persistenceQueueDepth > 0 || persistenceInFlight > 0)) {
    schedulePresenceFlush(PRESENCE_FLUSH_RETRY_MS);
    return null;
  }
  const snapshot = db();
  presenceFlushPromise = save(snapshot, {
    actor:'system',
    reason,
    skipRevisionSnapshot:true,
    background:true,
    collections:['users','attendanceLogs']
  }).finally(() => {
    presenceFlushPromise = null;
    if (presenceMutationGeneration > persistedPresenceGeneration) schedulePresenceFlush(PRESENCE_FLUSH_RETRY_MS);
  });
  return presenceFlushPromise;
}

async function loadDb(){
  return db();
}

async function getDbStatus(){
  if (USE_POSTGRES) {
    await ensurePostgres();
    return getRelationalHealth(pool);
  }
  return { database:'json-file', connected:true, time:now(), localSandbox:true, warning:'Local JSON sandbox is enabled. Production requires PostgreSQL.', stateVersion };
}

async function databaseReadinessProbe() {
  const started = Date.now();
  if (!USE_POSTGRES) return { ok:ALLOW_JSON_FALLBACK, database:'json-file', latencyMs:Date.now()-started, localSandbox:true };
  try {
    await Promise.race([
      pool.query('SELECT 1 AS ok'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database readiness probe timed out.')), boundedEnvNumber('READINESS_DB_TIMEOUT_MS', 5000, 1000, 60000)))
    ]);
    return { ok:true, database:'postgresql-relational', latencyMs:Date.now()-started };
  } catch (error) {
    return { ok:false, database:'postgresql-relational', latencyMs:Date.now()-started, error:error.message || String(error) };
  }
}

async function buildReliabilityStatus({ detailed = false } = {}) {
  const [database, failedJobs] = await Promise.all([
    databaseReadinessProbe(),
    operationalJobs.list({ status:'FAILED', limit:50 }).catch(() => [])
  ]);
  const storage = fileStorage.health();
  const storageDisk = filesystemUsage(FILE_STORAGE_ROOT);
  const backupDisk = filesystemUsage(BACKUP_ROOT);
  const backups = inspectBackupManifests(BACKUP_ROOT, { maxAgeHours:BACKUP_MAX_AGE_HOURS });
  const releaseCertificate = readAndVerifyReleaseCertificate(RELEASE_CERTIFICATE_PATH, {
    expectedBackendVersion: BACKEND_PACKAGE_VERSION,
    maxAgeHours: RELEASE_CERTIFICATE_MAX_AGE_HOURS,
    requireCleanInstall: true,
    requireBackup: RELEASE_CERTIFICATE_REQUIRED && BACKUP_REQUIRED
  });
  const diskCritical = [storageDisk,backupDisk].some(item => item.ok && item.usedPercent >= DISK_CRITICAL_PERCENT);
  const diskWarning = [storageDisk,backupDisk].some(item => item.ok && item.usedPercent >= DISK_WARNING_PERCENT);
  const persistenceHealthy = !lastPersistenceFailure || (lastPersistenceSuccess && new Date(lastPersistenceSuccess.at).getTime() >= new Date(lastPersistenceFailure.at).getTime());
  const checks = {
    shuttingDown:!shuttingDown,
    database:database.ok,
    privateStorage:!!storage.ok,
    diskSpace:!diskCritical,
    backup:!BACKUP_REQUIRED || backups.ok,
    releaseCertificate:!RELEASE_CERTIFICATE_REQUIRED || releaseCertificate.ok,
    persistence:persistenceHealthy
  };
  const ok = Object.values(checks).every(Boolean);
  const base = {
    ok,
    status:ok ? 'READY' : 'NOT_READY',
    checkedAt:now(),
    uptimeSeconds:Math.round(process.uptime()),
    startedAt:serverStartedAt,
    checks,
    warning:diskWarning && !diskCritical ? `Disk usage is above ${DISK_WARNING_PERCENT}%.` : '',
    failedJobCount:failedJobs.length
  };
  if (!detailed) return base;
  return {
    ...base,
    database,
    storage:{...storage,root:undefined,tempRoot:undefined},
    disk:{storage:storageDisk,backups:backupDisk,warningPercent:DISK_WARNING_PERCENT,criticalPercent:DISK_CRITICAL_PERCENT},
    backups,
    releaseCertificate:{ required:RELEASE_CERTIFICATE_REQUIRED, path:RELEASE_CERTIFICATE_PATH, ...releaseCertificate },
    persistence:{
      lastSuccess:lastPersistenceSuccess,
      lastFailure:lastPersistenceFailure,
      stateVersion,
      queueDepth:persistenceQueueDepth,
      inFlight:persistenceInFlight,
      activeForegroundWrites:activeForegroundWriteRequests,
      lastDurationMs:lastPersistenceDurationMs,
      lastReason:lastPersistenceReason,
      presenceDirty:presenceMutationGeneration > persistedPresenceGeneration,
      presenceFlushMs:PRESENCE_HEARTBEAT_FLUSH_MS
    },
    failedJobs
  };
}


const emptyAuthStore = () => ({ credentials: [], sessions: [], events: [] });

function readLocalAuthStore() {
  if (!ALLOW_JSON_FALLBACK) throw new Error('Local authentication storage is available only in the explicit development sandbox.');
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  if (!fs.existsSync(AUTH_FILE)) fs.writeFileSync(AUTH_FILE, JSON.stringify(emptyAuthStore(), null, 2));
  try {
    const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return {
      credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      events: Array.isArray(parsed.events) ? parsed.events : []
    };
  } catch {
    const fresh = emptyAuthStore();
    fs.writeFileSync(AUTH_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function writeLocalAuthStore(store = emptyAuthStore()) {
  if (!ALLOW_JSON_FALLBACK) throw new Error('Local authentication storage is available only in the explicit development sandbox.');
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2));
}

function authCredentialRecord(input = {}) {
  return {
    user_id: String(input.user_id || input.userId || '').trim(),
    username: normalizeUsername(input.username),
    password_hash: String(input.password_hash || input.passwordHash || ''),
    role: normalizeAuthRole(input.role),
    status: normalizeAuthStatus(input.status),
    must_change_password: Boolean(input.must_change_password ?? input.mustChangePassword),
    password_version: Math.max(1, Number(input.password_version || input.passwordVersion || 1)),
    failed_attempts: Math.max(0, Number(input.failed_attempts || input.failedAttempts || 0)),
    locked_until: input.locked_until || input.lockedUntil || null,
    password_changed_at: input.password_changed_at || input.passwordChangedAt || null,
    created_at: input.created_at || input.createdAt || now(),
    updated_at: input.updated_at || input.updatedAt || now()
  };
}

function applyLocalAuthOperations(operations = []) {
  const store = readLocalAuthStore();
  for (const operation of operations || []) {
    const type = String(operation?.type || '');
    if (type === 'upsertCredential') {
      const next = authCredentialRecord(operation.credential || operation);
      const index = store.credentials.findIndex(item => String(item.user_id) === next.user_id || normalizeUsername(item.username) === next.username);
      if (index >= 0) store.credentials[index] = { ...store.credentials[index], ...next, created_at: store.credentials[index].created_at || next.created_at, updated_at: now() };
      else store.credentials.push(next);
    } else if (type === 'deleteCredential') {
      const userId = String(operation.userId || operation.user_id || '');
      store.credentials = store.credentials.filter(item => String(item.user_id) !== userId);
      store.sessions = store.sessions.map(session => String(session.user_id) === userId && !session.revoked_at ? { ...session, revoked_at: now() } : session);
    } else if (type === 'revokeSessions') {
      const userId = String(operation.userId || operation.user_id || '');
      const exceptHash = String(operation.exceptTokenHash || '');
      store.sessions = store.sessions.map(session => String(session.user_id) === userId && String(session.token_hash) !== exceptHash && !session.revoked_at ? { ...session, revoked_at: now() } : session);
    }
  }
  writeLocalAuthStore(store);
}

async function applyAuthOperationsWithClient(client, operations = []) {
  for (const operation of operations || []) {
    const type = String(operation?.type || '');
    if (type === 'upsertCredential') {
      const value = authCredentialRecord(operation.credential || operation);
      await client.query(
        `INSERT INTO auth_credentials(user_id, username, password_hash, role, status, must_change_password, password_version, failed_attempts, locked_until, password_changed_at, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,now()),now())
         ON CONFLICT (user_id) DO UPDATE SET
           username=EXCLUDED.username,
           password_hash=EXCLUDED.password_hash,
           role=EXCLUDED.role,
           status=EXCLUDED.status,
           must_change_password=EXCLUDED.must_change_password,
           password_version=EXCLUDED.password_version,
           failed_attempts=EXCLUDED.failed_attempts,
           locked_until=EXCLUDED.locked_until,
           password_changed_at=EXCLUDED.password_changed_at,
           updated_at=now()`,
        [value.user_id, value.username, value.password_hash, value.role, value.status, value.must_change_password, value.password_version, value.failed_attempts, value.locked_until, value.password_changed_at, value.created_at]
      );
    } else if (type === 'deleteCredential') {
      const userId = String(operation.userId || operation.user_id || '');
      await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1', [userId]);
      await client.query('DELETE FROM auth_credentials WHERE user_id=$1', [userId]);
    } else if (type === 'revokeSessions') {
      const userId = String(operation.userId || operation.user_id || '');
      const exceptHash = String(operation.exceptTokenHash || '');
      if (exceptHash) await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND token_hash<>$2', [userId, exceptHash]);
      else await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1', [userId]);
    }
  }
}

async function applyStandaloneAuthOperations(operations = []) {
  if (!operations.length) return;
  if (!USE_POSTGRES) {
    applyLocalAuthOperations(operations);
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applyAuthOperationsWithClient(client, operations);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function findCredentialByUsername(username = '') {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  if (USE_POSTGRES) {
    await ensurePostgres();
    const result = await pool.query('SELECT * FROM auth_credentials WHERE username=$1 LIMIT 1', [normalized]);
    return result.rows[0] || null;
  }
  return readLocalAuthStore().credentials.find(item => normalizeUsername(item.username) === normalized) || null;
}

async function findCredentialByUserId(userId = '') {
  const value = String(userId || '');
  if (!value) return null;
  if (USE_POSTGRES) {
    await ensurePostgres();
    const result = await pool.query('SELECT * FROM auth_credentials WHERE user_id=$1 LIMIT 1', [value]);
    return result.rows[0] || null;
  }
  return readLocalAuthStore().credentials.find(item => String(item.user_id) === value) || null;
}

async function countCredentials() {
  if (USE_POSTGRES) {
    await ensurePostgres();
    const result = await pool.query('SELECT count(*)::int AS count FROM auth_credentials');
    return Number(result.rows[0]?.count || 0);
  }
  return readLocalAuthStore().credentials.length;
}

async function recordAuthEvent({ userId = '', username = '', eventType = '', req = null, details = {} } = {}) {
  const event = {
    user_id: String(userId || ''),
    username: normalizeUsername(username),
    event_type: String(eventType || 'AUTH_EVENT'),
    ip_address: String(req?.ip || req?.socket?.remoteAddress || ''),
    user_agent: String(req?.get?.('user-agent') || ''),
    details: details && typeof details === 'object' ? details : {},
    created_at: now()
  };
  if (USE_POSTGRES) {
    await ensurePostgres();
    await pool.query(
      'INSERT INTO auth_events(user_id, username, event_type, ip_address, user_agent, details) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [event.user_id || null, event.username || null, event.event_type, event.ip_address || null, event.user_agent || null, JSON.stringify(event.details)]
    );
    return;
  }
  const store = readLocalAuthStore();
  store.events.unshift({ id: nanoid(10), ...event });
  store.events = store.events.slice(0, 2000);
  writeLocalAuthStore(store);
}

async function updateLoginFailure(credential = {}, req = null) {
  const nextAttempts = Number(credential.failed_attempts || 0) + 1;
  const lockedUntil = nextAttempts >= LOGIN_MAX_ATTEMPTS ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000).toISOString() : null;
  if (USE_POSTGRES) {
    await pool.query('UPDATE auth_credentials SET failed_attempts=$2, locked_until=$3, updated_at=now() WHERE user_id=$1', [credential.user_id, nextAttempts, lockedUntil]);
  } else {
    const store = readLocalAuthStore();
    store.credentials = store.credentials.map(item => String(item.user_id) === String(credential.user_id) ? { ...item, failed_attempts: nextAttempts, locked_until: lockedUntil, updated_at: now() } : item);
    writeLocalAuthStore(store);
  }
  await recordAuthEvent({ userId: credential.user_id, username: credential.username, eventType: lockedUntil ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', req, details: { failedAttempts: nextAttempts } });
}

async function clearLoginFailures(credential = {}) {
  if (USE_POSTGRES) await pool.query('UPDATE auth_credentials SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1', [credential.user_id]);
  else {
    const store = readLocalAuthStore();
    store.credentials = store.credentials.map(item => String(item.user_id) === String(credential.user_id) ? { ...item, failed_attempts: 0, locked_until: null, updated_at: now() } : item);
    writeLocalAuthStore(store);
  }
}

async function updateCredentialPassword(userId = '', passwordHash = '', mustChangePassword = false) {
  const existing = await findCredentialByUserId(userId);
  if (!existing) throw new Error('Authentication credential was not found.');
  const nextVersion = Number(existing.password_version || 1) + 1;
  const changedAt = now();
  if (USE_POSTGRES) {
    await pool.query(
      `UPDATE auth_credentials SET password_hash=$2, must_change_password=$3, password_version=$4,
       failed_attempts=0, locked_until=NULL, password_changed_at=$5, updated_at=now() WHERE user_id=$1`,
      [userId, passwordHash, Boolean(mustChangePassword), nextVersion, changedAt]
    );
  } else {
    const store = readLocalAuthStore();
    store.credentials = store.credentials.map(item => String(item.user_id) === String(userId) ? { ...item, password_hash: passwordHash, must_change_password: Boolean(mustChangePassword), password_version: nextVersion, failed_attempts: 0, locked_until: null, password_changed_at: changedAt, updated_at: changedAt } : item);
    writeLocalAuthStore(store);
  }
  return { ...existing, password_hash: passwordHash, must_change_password: Boolean(mustChangePassword), password_version: nextVersion, password_changed_at: changedAt };
}

async function createAuthSession(credential = {}, req = null) {
  const rawToken = randomOpaqueToken(32);
  const hashedToken = tokenHash(rawToken);
  const csrfToken = randomOpaqueToken(24);
  const createdAt = now();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const session = {
    token_hash: hashedToken,
    user_id: String(credential.user_id),
    csrf_token: csrfToken,
    password_version: Number(credential.password_version || 1),
    created_at: createdAt,
    expires_at: expiresAt,
    last_seen_at: createdAt,
    revoked_at: null,
    ip_address: String(req?.ip || req?.socket?.remoteAddress || ''),
    user_agent: String(req?.get?.('user-agent') || '')
  };
  if (USE_POSTGRES) {
    await ensurePostgres();
    await pool.query(
      `INSERT INTO auth_sessions(token_hash,user_id,csrf_token,password_version,created_at,expires_at,last_seen_at,ip_address,user_agent)
       VALUES($1,$2,$3,$4,$5,$6,$5,$7,$8)`,
      [session.token_hash, session.user_id, session.csrf_token, session.password_version, session.created_at, session.expires_at, session.ip_address || null, session.user_agent || null]
    );
  } else {
    const store = readLocalAuthStore();
    store.sessions.push(session);
    store.sessions = store.sessions.filter(item => !item.revoked_at && new Date(item.expires_at).getTime() > Date.now() - 24 * 60 * 60 * 1000).slice(-5000);
    writeLocalAuthStore(store);
  }
  return { rawToken, ...session };
}

async function findAuthSession(rawToken = '') {
  const hashed = tokenHash(rawToken);
  if (!rawToken) return null;
  if (USE_POSTGRES) {
    await ensurePostgres();
    const result = await pool.query('SELECT * FROM auth_sessions WHERE token_hash=$1 LIMIT 1', [hashed]);
    return result.rows[0] || null;
  }
  return readLocalAuthStore().sessions.find(item => item.token_hash === hashed) || null;
}

async function touchAuthSession(tokenHashValue = '') {
  if (!tokenHashValue) return;
  if (USE_POSTGRES) await pool.query('UPDATE auth_sessions SET last_seen_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHashValue]);
  else {
    const store = readLocalAuthStore();
    store.sessions = store.sessions.map(item => item.token_hash === tokenHashValue ? { ...item, last_seen_at: now() } : item);
    writeLocalAuthStore(store);
  }
}

async function revokeAuthSession(tokenHashValue = '') {
  if (!tokenHashValue) return;
  if (USE_POSTGRES) await pool.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE token_hash=$1', [tokenHashValue]);
  else {
    const store = readLocalAuthStore();
    store.sessions = store.sessions.map(item => item.token_hash === tokenHashValue && !item.revoked_at ? { ...item, revoked_at: now() } : item);
    writeLocalAuthStore(store);
  }
}

async function revokeAllUserSessions(userId = '', exceptTokenHash = '') {
  if (USE_POSTGRES) {
    if (exceptTokenHash) await pool.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND token_hash<>$2', [String(userId), exceptTokenHash]);
    else await pool.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1', [String(userId)]);
  } else {
    applyLocalAuthOperations([{ type: 'revokeSessions', userId: String(userId), exceptTokenHash }]);
  }
}

function parseRequestCookies(req = {}) {
  const cookies = {};
  String(req.headers?.cookie || '').split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index <= 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function setSessionCookie(res, rawToken = '') {
  const options = {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/'
  };
  if (process.env.SESSION_COOKIE_DOMAIN) options.domain = String(process.env.SESSION_COOKIE_DOMAIN).trim();
  res.cookie(SESSION_COOKIE_NAME, rawToken, options);
}

function clearSessionCookie(res) {
  const options = { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'lax', path: '/' };
  if (process.env.SESSION_COOKIE_DOMAIN) options.domain = String(process.env.SESSION_COOKIE_DOMAIN).trim();
  res.clearCookie(SESSION_COOKIE_NAME, options);
}

function findStateUserByIdOrUsername(userId = '', username = '', state = memoryState || seed) {
  const d = state || memoryState || seed;
  return (d.users || []).find(user => String(user.id || '') === String(userId || '') || normalizeUsername(user.username) === normalizeUsername(username)) || null;
}

async function resolveRequestAuthentication(req = {}) {
  const rawToken = parseRequestCookies(req)[SESSION_COOKIE_NAME] || '';
  if (!rawToken) return null;
  const session = await findAuthSession(rawToken);
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
    if (session?.token_hash) await revokeAuthSession(session.token_hash).catch(() => {});
    return null;
  }
  const credential = await findCredentialByUserId(session.user_id);
  if (!credential || Number(credential.password_version || 1) !== Number(session.password_version || 1)) {
    await revokeAuthSession(session.token_hash).catch(() => {});
    return null;
  }
  const user = findStateUserByIdOrUsername(credential.user_id, credential.username);
  if (!user || normalizeAuthStatus(user.status || credential.status) !== 'APPROVED' || normalizeAuthStatus(credential.status) !== 'APPROVED') {
    await revokeAuthSession(session.token_hash).catch(() => {});
    return null;
  }
  const lastSeen = new Date(session.last_seen_at || 0).getTime();
  if (!lastSeen || Date.now() - lastSeen > 5 * 60 * 1000) await touchAuthSession(session.token_hash).catch(() => {});
  return { rawToken, session, credential, user: publicSessionUser(user, credential) };
}

function isPublicApiPath(req = {}) {
  const routePath = String(req.path || '');
  return routePath === '/health' || routePath === '/health/live' || routePath === '/health/ready' || routePath === '/meta' || routePath === '/auth/login' || routePath === '/auth/session' || routePath === '/auth/clear-browser-session' || routePath === '/auth/recovery/request' || routePath === '/auth/recovery/reset';
}

function isSafeMethod(method = '') {
  return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
}

async function authenticationGate(req, res, next) {
  try {
    if (isPublicApiPath(req)) return next();
    const auth = await resolveRequestAuthentication(req);
    if (!auth) {
      clearSessionCookie(res);
      return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Sign in is required.' });
    }
    req.auth = auth;
    if (auth.user.mustChangePassword && !['/auth/change-password', '/auth/logout', '/auth/session'].includes(String(req.path || ''))) {
      return res.status(428).json({ ok: false, code: 'PASSWORD_CHANGE_REQUIRED', error: 'Change the administrator-issued temporary password before continuing.', user: auth.user });
    }
    if (!isSafeMethod(req.method)) {
      const supplied = String(req.get?.('x-csrf-token') || '');
      const expected = String(auth.session.csrf_token || '');
      if (!supplied || !expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
        return res.status(403).json({ ok: false, code: 'CSRF_TOKEN_INVALID', error: 'The security token is missing or invalid. Refresh the page and try again.' });
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdminSession(req, res, next) {
  if (normalizeAuthRole(req.auth?.user?.role) !== 'ADMIN') return res.status(403).json({ ok: false, code: 'ADMIN_REQUIRED', error: 'Admin access is required.' });
  next();
}

async function migrateLegacyCredentials() {
  const d = db();
  const operations = [];
  let stateChanged = false;
  let bootstrapCreated = false;
  let bootstrapUserId = '';
  let repairedLegacyCredentials = 0;
  for (let index = 0; index < (d.users || []).length; index += 1) {
    const original = d.users[index] || {};
    const username = normalizeUsername(original.username);
    const userId = String(original.id || username || '').trim();
    if (!username || !userId) continue;
    const existing = await findCredentialByUserId(userId) || await findCredentialByUsername(username);
    const legacyCandidate = legacyCredentialCandidates.find(candidate =>
      (candidate.id && candidate.id === userId) || (candidate.username && candidate.username === username)
    );
    const legacyPassword = String(legacyCandidate?.password || original.password || original.passwordHash || '').trim();
    let credential = existing;
    if (!credential && legacyPassword) {
      credential = authCredentialRecord({
        user_id: userId,
        username,
        password_hash: await hashPassword(legacyPassword),
        role: original.role,
        status: original.status,
        // This is the employee's existing password being moved into the secure
        // credential table, not an administrator-issued temporary password.
        must_change_password: false,
        password_version: 1
      });
      operations.push({ type: 'upsertCredential', credential });
    } else if (credential) {
      const reconciliation = reconcileLegacyCredential({ credential, user: original, legacyCandidate });
      if (reconciliation.repairedLegacyMigration) repairedLegacyCredentials += 1;
      const synchronized = authCredentialRecord(reconciliation.credential);
      const changed = [
        'user_id', 'username', 'role', 'status', 'must_change_password', 'password_version', 'failed_attempts', 'locked_until'
      ].some(field => String(credential[field] ?? '') !== String(synchronized[field] ?? ''));
      credential = synchronized;
      if (changed) operations.push({ type: 'upsertCredential', credential });
    }
    const safe = stripCredentialFields(original);
    if (JSON.stringify(safe) !== JSON.stringify(original)) stateChanged = true;
    d.users[index] = safe;
  }

  if ((await countCredentials()) === 0 && operations.length === 0) {
    const bootstrapUsername = normalizeUsername(process.env.BOOTSTRAP_ADMIN_USERNAME || '');
    const bootstrapPassword = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
    const bootstrapName = String(process.env.BOOTSTRAP_ADMIN_NAME || 'System Administrator').trim();
    if (bootstrapUsername || bootstrapPassword) {
      const errors = passwordPolicyErrors(bootstrapPassword);
      if (!bootstrapUsername || errors.length) throw new Error(`Bootstrap Admin configuration is invalid. ${errors.join(' ') || 'BOOTSTRAP_ADMIN_USERNAME is required.'}`);
      const userId = `admin-${nanoid(10)}`;
      bootstrapUserId = userId;
      const user = employeeLifecycleProfile({ id: userId, name: bootstrapName, username: bootstrapUsername, role: 'Admin', status: 'APPROVED', createdAt: Date.now(), createdBy: 'Secure bootstrap' }, {});
      d.users.push(stripCredentialFields(user));
      operations.push({
        type: 'upsertCredential',
        credential: authCredentialRecord({ user_id: userId, username: bootstrapUsername, password_hash: await hashPassword(bootstrapPassword), role: 'ADMIN', status: 'APPROVED', must_change_password: false, password_version: 1, password_changed_at: now() })
      });
      stateChanged = true;
      bootstrapCreated = true;
    }
  }

  if (USE_POSTGRES) {
    // Credential cutover is independent of the operational-state snapshot.
    // Do not rewrite cases, finance, files, or legacy orphan rows merely to
    // create password hashes.
    if (bootstrapCreated) await save(d, {
      actor:'secure-bootstrap',
      reason:'bootstrap_admin_create',
      authOperations: operations,
      collections:['users'],
      collectionRowIds:{users:[bootstrapUserId]}
    });
    else {
      await applyStandaloneAuthOperations(operations);
      if (stateChanged) memoryState = norm(d);
    }
  } else if (operations.length || stateChanged) {
    await save(d, { authOperations: operations, collections:['users'] });
  }
  if ((await countCredentials()) === 0) {
    throw new Error('No secure login credential exists. Set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD for the one-time secure bootstrap, or restore the existing user records before startup.');
  }
  if (repairedLegacyCredentials > 0) {
    console.info(JSON.stringify({
      timestamp: now(),
      level: 'info',
      event: 'legacy_auth_compatibility_repaired',
      repairedCredentials: repairedLegacyCredentials
    }));
  }
  legacyCredentialCandidates = [];
}


function norm(d){
  d ||= structuredClone(seed);
  d.users ||= seed.users; d.cases ||= d.projects || []; d.deletedProjectIds ||= []; d.payments = (Array.isArray(d.payments) ? d.payments : []).filter(Boolean); d.notifications ||= []; d.teamChat ||= d.chatMessages || []; d.whatsappInbox ||= []; d.audit ||= []; d.attendanceLogs ||= []; d.chatReads ||= {ADMIN:[],MANAGER:[],DESIGNER:[]};
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

function normalizeStateForSelectiveSave(d, metadata = {}) {
  const collections = Array.isArray(metadata.collections)
    ? new Set(metadata.collections.map(value => String(value || '').trim()).filter(Boolean))
    : null;
  if (!collections) return norm(d);

  d ||= structuredClone(seed);
  d.users ||= seed.users;
  d.cases ||= d.projects || [];
  d.deletedProjectIds ||= [];
  d.payments = Array.isArray(d.payments) ? d.payments : [];
  d.notifications ||= [];
  d.teamChat ||= d.chatMessages || [];
  d.whatsappInbox ||= [];
  d.audit ||= [];
  d.attendanceLogs ||= [];
  d.chatReads ||= {ADMIN:[],MANAGER:[],DESIGNER:[]};
  d.performanceRecords = Array.isArray(d.performanceRecords) ? d.performanceRecords : [];
  d.files ||= [];

  const explicitlyChangesUsers = !Array.isArray(metadata.requestedCollections) || metadata.requestedCollections.includes('users');
  if (collections.has('users') && explicitlyChangesUsers) d.users = cleanTeamUsers(d.users);
  if (collections.has('payments')) d.payments = d.payments.filter(Boolean);

  if (collections.has('deletedProjectIds')) {
    d.deletedProjectIds = [...new Set((d.deletedProjectIds || []).map(value => String(value)).filter(Boolean))];
  }

  if (collections.has('cases') || collections.has('deletedProjectIds')) {
    const deletedSet = new Set(d.deletedProjectIds || []);
    d.cases = (d.cases || []).filter(caseRecord => caseRecord
      && !deletedSet.has(String(caseRecord.id || ''))
      && !deletedSet.has(String(caseRecord.caseId || '')));
    const changedIds = new Set((metadata.collectionRowIds?.cases || []).map(value => String(value || '')).filter(Boolean));
    for (const caseRecord of d.cases) {
      if (changedIds.size && !changedIds.has(String(caseRecord.id || '')) && !changedIds.has(String(caseRecord.caseId || ''))) continue;
      caseRecord.documents ||= [];
      caseRecord.completedFiles ||= [];
      caseRecord.history ||= [];
      caseRecord.comments ||= [];
      caseRecord.revisions ||= [];
      caseRecord.timeline = normalizeCaseTimeline(caseRecord);
      caseRecord.creatorName ||= caseRecord.createdBy || 'Admin';
      caseRecord.createdAt ||= new Date().toISOString();
    }
  }

  // Performance records are derived from cases at read time by
  // getPerformanceBundle(). Avoid rebuilding the full historical set on every
  // task mutation; an explicit performance rebuild still persists the complete
  // canonical collection.
  if (collections.has('performanceRecords')) {
    d.performanceRecords = mergePerformanceRecords(d.performanceRecords, buildPerformanceRecordsFromCases(d.cases));
  }
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
  if(typeof value === 'number') return normalizeEpochMilliseconds(value) || 0;
  const raw=String(value).trim();
  const normalizedEpoch = normalizeEpochMilliseconds(raw);
  if(normalizedEpoch) return normalizedEpoch;
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
  return Math.max(0, ...candidates.map(value => {
    if (!value) return 0;
    const normalizedEpoch = normalizeEpochMilliseconds(value);
    if (normalizedEpoch) return normalizedEpoch;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }));
}

function assignmentFreshness(c = {}) {
  return Math.max(0, ...[c.assignmentVersion, c.assignedAt].map(value => {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = new Date(value || 0).getTime();
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }));
}

function normalizeCaseAssignee(c = {}) {
  const assignedTo = String(c.assignedTo || c.ownership?.assignedTo || c.assigneeName || c.assignedToName || c.assignedUserName || '').trim() || 'Unassigned';
  return {
    ...c,
    assignedTo,
    assigneeName: assignedTo === 'Unassigned' ? '' : assignedTo,
    ownership: { ...(c.ownership || {}), assignedTo }
  };
}

function mergeCaseCollection(a = [], b = []) {
  const result = [];
  const seen = new Set();
  for (const item of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (item === null || item === undefined) continue;
    const key = typeof item === 'object'
      ? String(item.id || item.fileId || item.workItemId || [item.name, item.type, item.at || item.time || item.date, item.text || item.title || item.action].filter(Boolean).join('|'))
      : String(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function mergeCaseRecords(existing = {}, incoming = {}) {
  const a = normalizeCaseAssignee(existing || {});
  const b = normalizeCaseAssignee(incoming || {});
  const base = caseFreshness(b) >= caseFreshness(a) ? { ...a, ...b } : { ...b, ...a };
  const assignmentSource = assignmentFreshness(b) >= assignmentFreshness(a) ? b : a;
  const assignedTo = String(assignmentSource.assignedTo || '').trim() || 'Unassigned';
  base.assignedTo = assignedTo;
  base.assigneeName = assignedTo === 'Unassigned' ? '' : assignedTo;
  base.assigneeId = assignmentSource.assigneeId ?? base.assigneeId;
  base.assigneeRole = assignmentSource.assigneeRole ?? base.assigneeRole;
  base.assignedBy = assignmentSource.assignedBy ?? base.assignedBy;
  base.assignedAt = assignmentSource.assignedAt ?? base.assignedAt;
  base.assignmentVersion = assignmentSource.assignmentVersion ?? assignmentSource.assignedAt ?? base.assignmentVersion;
  base.ownership = { ...(base.ownership || {}), ...(assignmentSource.ownership || {}), assignedTo, assignedBy: base.assignedBy };
  for (const field of ['documents','completedFiles','history','comments','revisions','subTasks','notes','revisionHistory','reassignmentHistory']) {
    base[field] = mergeCaseCollection(a[field], b[field]);
  }
  base.timeline = mergeTimelineEvents(a.timeline, b.timeline, a.history, b.history);
  // Finance has its own freshness clock. A newer task/status edit must never
  // replace a later finance update with an older browser snapshot.
  return normalizeCaseAssignee(applyFreshestFinance(base, a, b));
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
  const merged = [];
  for (const raw of [...(Array.isArray(existingCases) ? existingCases : []), ...(Array.isArray(incomingCases) ? incomingCases : [])].filter(Boolean)) {
    const c = normalizeCaseAssignee(raw);
    const ids = new Set(getCaseIdentitySet(c));
    const index = merged.findIndex(candidate => getCaseIdentitySet(candidate).some(id => ids.has(id)));
    if (index >= 0) merged[index] = mergeCaseRecords(merged[index], c);
    else merged.push(c);
  }
  return dedupeRenamedCases(filterDeletedCases(merged, deletedProjectIds || []), deletedProjectIds || []);
}

function rememberDeletedProject(d, id){
  const value = String(id || '').trim();
  if (!value) return;
  d.deletedProjectIds ||= [];
  if (!d.deletedProjectIds.map(String).includes(value)) d.deletedProjectIds.push(value);
}


function now(){ return new Date().toISOString(); }



function normalizeRoleValue(value = '') {
  return String(value || '').trim().toUpperCase();
}

function isAdminRoleValue(value = '') {
  return normalizeRoleValue(value) === 'ADMIN';
}

function requestRole(req = {}) {
  return req.auth?.user?.role || '';
}

function isFinanceAdminRequest(req = {}) {
  return isAdminRoleValue(requestRole(req));
}

function denyFinanceAccess(res) {
  return res.status(403).json({ ok:false, code:'FINANCE_ADMIN_REQUIRED', error:'Finance access is restricted to Admin users only.' });
}

function requestActor(req = {}) {
  return authorizationActor(req.auth?.user || {});
}

function authorizationDenied(req, res, code = 'FORBIDDEN', error = 'You do not have permission to perform this action.') {
  const actor = requestActor(req);
  recordAuthEvent({
    userId: actor.id,
    username: actor.username,
    eventType: 'AUTHORIZATION_DENIED',
    req,
    details: { code, method: req.method, path: req.originalUrl || req.url || '', role: actor.role }
  }).catch(() => {});
  return res.status(403).json({ ok:false, code, error, requestId:req.requestId || '' });
}

function requireCapability(capability, error = '') {
  return (req, res, next) => {
    if (!hasCapability(req.auth?.user || {}, capability)) {
      return authorizationDenied(req, res, 'CAPABILITY_REQUIRED', error || `Permission ${capability} is required.`);
    }
    next();
  };
}

function requireAnyRole(...rolesAllowed) {
  const allowed = new Set(rolesAllowed.flat().map(normalizePermissionRole).filter(Boolean));
  return (req, res, next) => {
    const role = normalizePermissionRole(req.auth?.user?.role);
    if (!allowed.has(role)) return authorizationDenied(req, res, 'ROLE_NOT_ALLOWED', 'Your role is not allowed to perform this action.');
    next();
  };
}

function textValue(value, field, maxLength = MAX_CASE_TEXT_LENGTH, { required = false } = {}) {
  const normalized = String(value ?? '').trim();
  if (required && !normalized) {
    const error = new Error(`${field} is required.`);
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (normalized.length > maxLength) {
    const error = new Error(`${field} cannot exceed ${maxLength} characters.`);
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  return normalized;
}

function numericValue(value, field, { min = 0, max = 1_000_000_000, fallback = 0 } = {}) {
  if (value === '' || value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    const error = new Error(`${field} must be a number between ${min} and ${max}.`);
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  return number;
}

function assertArrayLimit(value, field, max = 5000) {
  if (value !== undefined && !Array.isArray(value)) {
    const error = new Error(`${field} must be an array.`);
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (Array.isArray(value) && value.length > max) {
    const error = new Error(`${field} cannot contain more than ${max} records in one request.`);
    error.statusCode = 413;
    error.code = 'PAYLOAD_TOO_LARGE';
    throw error;
  }
}

function recordKey(record = {}, index = 0) {
  return String(record.id || record.fileId || record.eventId || record.createdAt || record.at || record.time || `${record.title || record.action || 'record'}:${index}`);
}

function mergeAppendOnly(existing = [], incoming = []) {
  const map = new Map();
  (Array.isArray(existing) ? existing : []).forEach((record, index) => map.set(recordKey(record, index), structuredClone(record)));
  (Array.isArray(incoming) ? incoming : []).forEach((record, index) => {
    const key = recordKey(record, index);
    if (!map.has(key)) map.set(key, structuredClone(record));
  });
  return [...map.values()];
}

const DESIGNER_MUTABLE_TASK_FIELDS = Object.freeze([
  'status', 'updatedAt', 'syncVersion', 'startedAt', 'draftingStartedAt', 'currentDraftingStartedAt',
  'draftingResumedAt', 'draftingPausedAt', 'draftingElapsedMsBeforePause', 'draftingElapsedMs',
  'submittedAt', 'draftingCompletedAt', 'internalReviewStartedAt', 'reviewStatus', 'finalConclusion',
  'revisionRequestedAt', 'revisionRequestedBy', 'revisionNote', 'workStartedAt', 'workCompletedAt'
]);

const DESIGNER_ALLOWED_STATUS_KEYS = new Set([
  'DRAFTING', 'DRAFTINGPAUSED', 'INPROGRESS', 'DESIGNSUBMITTED', 'MANAGERREVIEW',
  'INTERNALREVIEW', 'REVISIONINPROGRESS', 'REOPENEDFORREVISION', 'REVISIONPENDING'
]);

function statusKey(value = '') {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function authorizedProjectUpdate(existing = {}, incoming = {}, req = {}) {
  const actor = requestActor(req);
  const role = actor.role;
  if (!existing || !existing.id) return incoming;
  if (!canMutateCase(req.auth?.user || {}, existing, 'update')) {
    const error = new Error('You cannot modify this task.');
    error.statusCode = 403;
    error.code = 'TASK_UPDATE_FORBIDDEN';
    throw error;
  }

  if (role === 'ADMIN' || role === 'MANAGER') {
    let next = preserveFinanceFields(existing, incoming);
    next.id = existing.id;
    next.caseId = incoming.caseId || existing.caseId;
    next.createdAt = existing.createdAt;
    next.taskDate = existing.taskDate || normalizeTaskDate(existing.createdAt);
    next.taskAccountingPeriod = existing.taskAccountingPeriod || getCaseTaskAccountingPeriod(existing);
    next.recordedAt = existing.recordedAt || existing.createdAt;
    next.createdBy = existing.createdBy || existing.creatorName || actor.name;
    next.creatorName = existing.creatorName || existing.createdBy || actor.name;
    next.createdByRole = existing.createdByRole || actor.role;
    next.updatedAt = Date.now();
    next.syncVersion = Date.now();
    next.updatedBy = actor.name;
    next.ownership = { ...(existing.ownership || {}), ...(incoming.ownership || {}), editedBy:actor.name };
    if (String(next.assignedTo || next.assigneeName || '') !== String(existing.assignedTo || existing.assigneeName || '')) {
      next.assignedBy = actor.name;
      next.assignmentVersion = Date.now();
      next.assignedAt = Date.now();
      next.ownership.assignedBy = actor.name;
    }
    return next;
  }

  const next = structuredClone(existing);
  for (const field of DESIGNER_MUTABLE_TASK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(incoming || {}, field)) next[field] = structuredClone(incoming[field]);
  }
  if (!DESIGNER_ALLOWED_STATUS_KEYS.has(statusKey(next.status))) next.status = existing.status;
  next.documents = mergeAppendOnly(existing.documents || [], incoming.documents || []);
  next.completedFiles = mergeAppendOnly(existing.completedFiles || [], incoming.completedFiles || []);
  next.workFiles = mergeAppendOnly(existing.workFiles || [], incoming.workFiles || []);
  next.subTasks = mergeAppendOnly(existing.subTasks || [], incoming.subTasks || []);
  next.notes = mergeAppendOnly(existing.notes || [], incoming.notes || []);
  next.comments = mergeAppendOnly(existing.comments || [], incoming.comments || []);
  next.revisions = mergeAppendOnly(existing.revisions || [], incoming.revisions || []);
  next.timeline = mergeTimelineEvents(existing.timeline || [], incoming.timeline || []);
  next.history = mergeAppendOnly(existing.history || [], incoming.history || []);
  next.pausedDraftingSessions = mergeAppendOnly(existing.pausedDraftingSessions || [], incoming.pausedDraftingSessions || []);
  next.updatedAt = Date.now();
  next.syncVersion = Date.now();
  next.updatedBy = actor.name;
  if (next.draftingPausedAt) next.pausedBy = actor.name;
  return preserveFinanceFields(existing, next);
}

function authorizeCase(req, res, caseRecord, action = 'read') {
  const allowed = action === 'read'
    ? canAccessCase(req.auth?.user || {}, caseRecord)
    : canMutateCase(req.auth?.user || {}, caseRecord, action);
  if (!allowed) {
    authorizationDenied(req, res, 'CASE_ACCESS_DENIED', 'You do not have access to this task.');
    return false;
  }
  return true;
}

function requireCaseAction(action = 'read') {
  return (req, res, next) => {
    const d = requestDb(req);
    const caseRecord = findCaseByAnyId(d.cases || [], req.params.id || req.body?.caseId || req.body?.projectId || '');
    if (!caseRecord) {
      cleanupIncomingUploads(req.files || (req.file ? [req.file] : []));
      return res.status(404).json({ ok:false, code:'CASE_NOT_FOUND', error:'Case not found.' });
    }
    if (!authorizeCase(req, res, caseRecord, action)) {
      cleanupIncomingUploads(req.files || (req.file ? [req.file] : []));
      return;
    }
    req.caseRecord = caseRecord;
    next();
  };
}

// Check access before accepting a potentially large multipart body, but do not
// pin that snapshot for the duration of the upload. The normal middleware runs
// again after multer and attaches a fresh snapshot for mutation/persistence.
function preauthorizeCaseAction(action = 'read') {
  return (req, res, next) => {
    const transientState = db();
    const caseRecord = findCaseByAnyId(transientState.cases || [], req.params.id || '');
    if (!caseRecord) return res.status(404).json({ ok:false, code:'CASE_NOT_FOUND', error:'Case not found.' });
    if (!authorizeCase(req, res, caseRecord, action)) return;
    next();
  };
}

function assertExpectedFinanceVersion(record = {}, body = {}) {
  if (body.expectedFinanceVersion === undefined || body.expectedFinanceVersion === null || body.expectedFinanceVersion === '') return;
  const expected = Number(body.expectedFinanceVersion);
  const current = Number(record.financeVersion || 0);
  if (!Number.isFinite(expected) || expected !== current) {
    const error = new Error(`Finance data changed on the server. Expected finance version ${expected}, current version ${current}. Refresh before saving.`);
    error.statusCode = 409;
    error.code = 'FINANCE_VERSION_CONFLICT';
    throw error;
  }
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
const FINANCE_ACCOUNTING_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
function normalizeFinanceAccountingPeriod(value, fallback = now()) {
  const raw = String(value || '').trim();
  const direct = raw.slice(0, 7);
  if (FINANCE_ACCOUNTING_MONTH_PATTERN.test(direct)) return direct;
  const fallbackRaw = String(fallback || '').trim();
  const fallbackDirect = fallbackRaw.slice(0, 7);
  const candidate = value || fallback;
  const timestamp = candidate instanceof Date ? candidate.getTime() : new Date(candidate).getTime();
  if (Number.isFinite(timestamp) && timestamp > 0) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone:'Asia/Kolkata',
        year:'numeric',
        month:'2-digit'
      }).formatToParts(new Date(timestamp));
      const year = parts.find(part => part.type === 'year')?.value;
      const month = parts.find(part => part.type === 'month')?.value;
      const monthKey = year && month ? `${year}-${month}` : '';
      if (FINANCE_ACCOUNTING_MONTH_PATTERN.test(monthKey)) return monthKey;
    } catch {}
  }
  return FINANCE_ACCOUNTING_MONTH_PATTERN.test(fallbackDirect) ? fallbackDirect : '';
}
const TASK_DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function indiaDateKey(value = Date.now()) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const safeTimestamp = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone:'Asia/Kolkata',
      year:'numeric',
      month:'2-digit',
      day:'2-digit'
    }).formatToParts(new Date(safeTimestamp));
    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;
    const day = parts.find(part => part.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : '';
  } catch {
    return new Date(safeTimestamp).toISOString().slice(0, 10);
  }
}
function normalizeTaskDate(value, fallback = Date.now()) {
  const fallbackKey = indiaDateKey(fallback);
  const raw = String(value || '').trim().slice(0, 10);
  if (TASK_DATE_PATTERN.test(raw)) {
    const parsed = new Date(`${raw}T12:00:00+05:30`);
    if (Number.isFinite(parsed.getTime()) && indiaDateKey(parsed) === raw) return raw;
    return fallbackKey;
  }
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric) && numeric > 0
    ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value || 0).getTime();
  if (Number.isFinite(timestamp) && timestamp > 0) return indiaDateKey(timestamp);
  return fallbackKey;
}
function taskDateTimestamp(taskDate, recordedAt = Date.now()) {
  const nowMs = Number(recordedAt) || Date.now();
  const today = indiaDateKey(nowMs);
  const normalized = normalizeTaskDate(taskDate, nowMs);
  if (normalized === today) return nowMs;
  const timestamp = new Date(`${normalized}T12:00:00+05:30`).getTime();
  return Number.isFinite(timestamp) ? timestamp : nowMs;
}
function getCaseTaskAccountingPeriod(c = {}, fallback = now()) {
  const explicitTaskMonth = normalizeFinanceAccountingPeriod(c.taskAccountingPeriod, '');
  if (explicitTaskMonth) return explicitTaskMonth;
  const taskDateSource = c.taskDate || c.operationalDate || c.createdAt || c.createdOn || c.loggedAt || c.date;
  if (taskDateSource) {
    return normalizeFinanceAccountingPeriod(normalizeTaskDate(taskDateSource, fallback), fallback);
  }
  return normalizeFinanceAccountingPeriod(c.financeAccountingPeriod || c.ledger?.accountingPeriod, fallback);
}

function nonNegativeFinanceNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Math.max(0, Number(fallback) || 0);
  const cleaned = typeof value === 'string' ? value.replace(/[^0-9.-]/g, '') : value;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : Math.max(0, Number(fallback) || 0);
}
function hasOwnFinanceValue(body = {}, ...keys) {
  return keys.some(key => Object.prototype.hasOwnProperty.call(body || {}, key));
}
function upsertInlinePaymentLedger(d, c, status, body = {}) {
  d.payments ||= [];
  c.ledger ||= {};
  c.history ||= [];
  c.paymentAuditTrail ||= [];

  const nowIso = now();
  const by = body.by || body.updatedBy || 'Admin';
  const caseKey = String(c.id || c.caseId || '').trim();
  const caseNo = c.caseId || c.displayId || c.originalTaskId || c.id || '';
  const existing = d.payments.find(p => p.source === 'INLINE_PAYMENT_STATUS'
    && String(p.caseId || '') === caseKey
    && String(p.ledgerStatus || 'ACTIVE') === 'ACTIVE');

  const previousPaymentStatus = normalizePaymentTrackingStatus(c.paymentTrackingStatus || c.paymentStatus || c.paymentReceived || c.ledger?.status || '');
  const previousAmountIn = nonNegativeFinanceNumber(c.ledger?.amountIn ?? c.paymentAmountIn, 0);
  const previousExpenses = nonNegativeFinanceNumber(c.ledger?.expenses, 0);
  const previousRefund = nonNegativeFinanceNumber(c.ledger?.refund ?? c.refundAmount, 0);
  const hasExplicitAmount = hasOwnFinanceValue(body, 'amount', 'amountIn', 'paymentAmountIn');
  const hasExplicitExpenses = hasOwnFinanceValue(body, 'expenses');
  const hasExplicitRefund = hasOwnFinanceValue(body, 'refund', 'refundAmount');
  const explicitAmount = body.amount ?? body.amountIn ?? body.paymentAmountIn;
  const amount = hasExplicitAmount ? nonNegativeFinanceNumber(explicitAmount, previousAmountIn) : previousAmountIn;
  const expenses = hasExplicitExpenses ? nonNegativeFinanceNumber(body.expenses, previousExpenses) : previousExpenses;
  const refund = hasExplicitRefund ? nonNegativeFinanceNumber(body.refund ?? body.refundAmount, previousRefund) : previousRefund;
  const paymentDate = String(body.paymentDate || body.date || c.paymentDate || c.ledger?.date || indiaDateKey(nowIso)).trim();
  const accountingPeriod = getCaseTaskAccountingPeriod(c, body.accountingPeriod || paymentDate || nowIso);

  if (status === 'Paid' && amount <= 0) {
    const err = new Error('Amount received is required before marking payment as Paid.');
    err.statusCode = 400;
    throw err;
  }

  const computedStatus = deriveServerPaymentStatus({
    ...c,
    paymentAmountIn:amount,
    ledger:{ ...(c.ledger || {}), amountIn:amount }
  }, status);
  const receiptStatus = amount > 0 ? (computedStatus === 'Paid' ? 'YES' : 'PARTIAL') : (computedStatus === 'Pending' ? 'PARTIAL' : 'NO');

  c.financeVersion = Number(c.financeVersion || 0) + 1;
  c.financeAccountingPeriod = accountingPeriod;
  c.paymentTrackingStatus = computedStatus;
  c.paymentTrackingUpdatedAt = Date.now();
  c.paymentTrackingUpdatedBy = by;
  c.paymentStatus = amount > 0 ? receiptStatus : (computedStatus === 'Pending' ? 'PENDING' : 'NOT_UPDATED');
  c.paymentReceived = receiptStatus;
  c.paymentAmountIn = amount;
  c.refundAmount = refund;
  c.paymentDate = paymentDate;
  c.paymentTime = body.paymentTime || c.paymentTime || new Date().toTimeString().slice(0, 5);
  c.payerName = body.payerName || body.receivedFrom || c.payerName || '';
  c.transactionId = body.transactionId || body.txnId || c.transactionId || '';
  c.ledger = {
    ...c.ledger,
    amountIn:amount,
    expenses,
    refund,
    date:paymentDate,
    accountingPeriod,
    mode:body.mode || c.ledger?.mode || '',
    txnId:body.transactionId || body.txnId || c.ledger?.txnId || c.transactionId || '',
    receivedFrom:body.payerName || body.receivedFrom || c.ledger?.receivedFrom || c.payerName || c.customerName || '',
    status:computedStatus,
    paymentStatus:computedStatus,
    updatedAt:Date.now(),
    updatedBy:by,
    financeVersion:c.financeVersion,
    autoFilledFromPaymentStatus:amount > 0,
    financeLedgerLinked:amount > 0,
    financeLedgerId:existing?.id || c.ledger?.financeLedgerId || (amount > 0 ? nanoid(8) : c.ledger?.financeLedgerId)
  };

  const auditNote = body.note || (amount > 0
    ? (computedStatus === 'Paid' ? 'Admin recorded full payment from inline payment control' : 'Admin recorded a partial payment from inline payment control')
    : `Payment status changed to ${computedStatus}`);
  c.paymentAuditTrail.unshift({
    id:nanoid(8),
    at:nowIso,
    paymentDate,
    accountingPeriod,
    by,
    action:'Payment status updated',
    oldStatus:previousPaymentStatus,
    newStatus:computedStatus,
    oldAmount:previousAmountIn,
    newAmount:amount,
    oldExpenses:previousExpenses,
    newExpenses:expenses,
    oldRefund:previousRefund,
    newRefund:refund,
    note:auditNote
  });

  if (amount > 0) {
    const paymentValues = {
      caseNo,
      location:c.location || c.city || '',
      customerName:c.customerName || '',
      bankerName:c.bankerName || '',
      bank:c.client || c.bank || c.bankName || '',
      branch:c.branch || c.branchName || '',
      paymentReceived:receiptStatus,
      paymentAmountIn:amount,
      expenses,
      refundAmount:refund,
      paymentDate,
      accountingPeriod,
      paymentTime:c.paymentTime,
      payerName:c.payerName,
      transactionId:c.transactionId,
      mode:c.ledger.mode || '',
      ledgerStatus:'ACTIVE',
      updatedAt:nowIso,
      updatedBy:by,
      note:auditNote
    };
    if (existing) {
      Object.assign(existing, paymentValues);
    } else {
      d.payments.unshift({
        id:c.ledger.financeLedgerId,
        source:'INLINE_PAYMENT_STATUS',
        caseId:caseKey,
        ...paymentValues,
        createdAt:nowIso,
        createdBy:by
      });
    }
  } else if (existing) {
    existing.ledgerStatus = 'REVERSED';
    existing.reversedAt = nowIso;
    existing.reversedBy = by;
    existing.reversalReason = `Payment status changed to ${computedStatus}`;
    existing.updatedAt = nowIso;
    existing.updatedBy = by;
    existing.accountingPeriod = accountingPeriod;
    c.ledger.financeLedgerLinked = false;
  }

  const amountMovement = amount - previousAmountIn;
  const expenseMovement = expenses - previousExpenses;
  const refundMovement = refund - previousRefund;
  const movementParts = [];
  if (amountMovement) movementParts.push(`received ${amountMovement > 0 ? '+' : '-'}₹${Math.abs(amountMovement).toLocaleString('en-IN')}`);
  if (expenseMovement) movementParts.push(`expenses ${expenseMovement > 0 ? '+' : '-'}₹${Math.abs(expenseMovement).toLocaleString('en-IN')}`);
  if (refundMovement) movementParts.push(`refund ${refundMovement > 0 ? '+' : '-'}₹${Math.abs(refundMovement).toLocaleString('en-IN')}`);
  c.history.unshift({
    at:nowIso,
    by,
    action:`Finance updated for ${accountingPeriod}: ${computedStatus}${movementParts.length ? ` (${movementParts.join(', ')})` : ''}`
  });
  addCaseTimelineEvent(c, {
    type:'payment_updated',
    by,
    title:`Payment ${computedStatus}`,
    remarks:`Accounting month ${accountingPeriod}${movementParts.length ? ` • ${movementParts.join(', ')}` : ''}`
  });
  addAudit(d, by, `Finance updated for ${accountingPeriod}: ${computedStatus}`, caseNo);
  return c;
}

const PRESENCE_STALE_MS = boundedEnvNumber('PRESENCE_STALE_MS', 90000, 30000, 30 * 60 * 1000);
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
    const u = stripCredentialFields(employeeLifecycleProfile({ ...raw, role: normalizeRole(raw.role), status: normalizeStatus(raw.status || 'APPROVED') }, map.get(teamIdentityKey(raw)) || {}));
    if (!validTeamRole(u.role)) return;
    if (systemUserPattern.test(String(u.name || '')) || systemUserPattern.test(String(u.username || ''))) return;
    if (u.status === 'DELETED' || u.status === 'REJECTED' || u.status === 'ARCHIVED') return;
    const key = teamIdentityKey(u);
    if (!key) return;
    map.set(key, stripCredentialFields(employeeLifecycleProfile({ ...(map.get(key) || {}), ...u }, map.get(key) || {})));
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
  const u = { ...stripCredentialFields(user), role: normalizeRole(user.role), status: normalizeStatus(user.status) };
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
    const port = boundedEnvNumber('SMTP_PORT', provider === 'gmail' ? 465 : 587, 1, 65535);
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

function addAudit(d, by, action, entity){
  const entry={id:nanoid(8),at:now(),by,action,entity};
  d.audit.unshift(entry);
  return entry;
}
async function recordFileStorageEvent({fileId='',caseId='',action='FILE_EVENT',actor='',storageKey='',sha256='',details={}}={}) {
  if (!USE_POSTGRES) return;
  try {
    await ensurePostgres();
    await pool.query(
      `INSERT INTO file_storage_events(file_id,case_id,action,actor,storage_key,sha256,details)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [String(fileId || ''),String(caseId || ''),String(action || 'FILE_EVENT'),String(actor || ''),String(storageKey || ''),String(sha256 || ''),JSON.stringify(details || {})]
    );
  } catch(error) {
    console.warn('File storage audit event failed:', error.message);
  }
}
function notify(d, to, text, category='normal', target=''){
  const notification={id:nanoid(8),to,text,category,target,status:'UNREAD',createdAt:now()};
  d.notifications.unshift(notification);
  return notification;
}
function notifyRole(d, role, text, category='normal', target=''){ return notify(d,role,text,category,target); }
function notifyUser(d, userIdOrName, text, category='normal', target=''){ return notify(d,userIdOrName,text,category,target); }
function nextCaseNo(d, city='Lucknow'){ const code=String(city||'LKO').slice(0,3).toUpperCase(); return `KD-${code}-2026-${String(d.cases.length+1).padStart(2,'0')}`; }
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
  const storageKey = file.storageKey || file.storedName || file.filename || '';
  const detectedMime = file.detectedMime || file.mimetype || 'application/octet-stream';
  return {
    id,
    caseId,
    name:file.originalname,
    originalName:file.originalname,
    storageKey,
    storedName:path.basename(storageKey),
    mime:detectedMime,
    mimeType:detectedMime,
    suppliedMime:file.suppliedMime || '',
    size:Number(file.size || 0),
    sha256:file.sha256 || '',
    type:classify(file.originalname,detectedMime),
    purpose,
    uploadedBy,
    uploadedByRole:role,
    uploadedAt:now(),
    storedAt:file.storedAt || now(),
    securityStatus:file.securityStatus || 'VALIDATED',
    antivirusStatus:file.antivirusStatus || 'NOT_CONFIGURED',
    antivirusEngine:file.antivirusEngine || '',
    storageProvider:file.storageProvider || 'local-private',
    deduplicated:Boolean(file.deduplicated),
    storageStatus:'AVAILABLE',
    url:`/api/files/${id}/download`,
    previewUrl:`/api/files/${id}/preview`,
    downloadUrl:`/api/files/${id}/download`
  };
}

function fileBaseName(value=''){
  try { return path.basename(decodeURIComponent(String(value || '').split('?')[0])); }
  catch { return path.basename(String(value || '').split('?')[0]); }
}
function normalizeFileName(value=''){
  return String(value || '').trim().toLowerCase().replace(/\s+/g,'_');
}
function safeHeaderFileName(value='file'){
  return String(value || 'file').replace(/[\r\n\0]/g,'').replace(/["\\]/g,'_').slice(0,180) || 'file';
}
function listUploadFiles(){
  try { return fs.readdirSync(LEGACY_UPLOAD_DIR).filter(name => fs.statSync(path.join(LEGACY_UPLOAD_DIR, name)).isFile()); }
  catch { return []; }
}
function addFileRegistryEntry(d, doc={}){
  if (!doc || !doc.id) return doc;
  d.files ||= [];
  const existing = d.files.find(f => String(f.id) === String(doc.id));
  const storageKey = doc.storageKey || doc.storedName || fileBaseName(doc.url || doc.fileUrl || '');
  const storedName = doc.storedName || fileBaseName(storageKey);
  const entry = {
    id: String(doc.id),
    caseId: doc.caseId || doc.projectId || '',
    name: doc.name || doc.fileName || doc.originalName || storageKey || 'file',
    originalName: doc.originalName || doc.name || doc.fileName || 'file',
    storageKey,
    storedName,
    mime: doc.mime || doc.mimeType || 'application/octet-stream',
    mimeType: doc.mimeType || doc.mime || 'application/octet-stream',
    suppliedMime: doc.suppliedMime || '',
    size: Number(doc.size || 0),
    sha256: doc.sha256 || '',
    purpose: doc.purpose || doc.type || 'FILE',
    uploadedBy: doc.uploadedBy || doc.by || 'Team',
    uploadedByRole: doc.uploadedByRole || '',
    uploadedAt: doc.uploadedAt || now(),
    storedAt: doc.storedAt || doc.uploadedAt || now(),
    securityStatus: doc.securityStatus || (doc.sha256 ? 'VALIDATED' : 'LEGACY_UNVERIFIED'),
    antivirusStatus: doc.antivirusStatus || (doc.sha256 ? 'NOT_CONFIGURED' : 'LEGACY_UNSCANNED'),
    antivirusEngine: doc.antivirusEngine || '',
    storageProvider: doc.storageProvider || (String(storageKey).startsWith('objects/') ? 'local-private' : 'legacy-local'),
    storageStatus: doc.storageStatus || 'UNKNOWN',
    chatScope: doc.chatScope || '',
    chatParticipants: Array.isArray(doc.chatParticipants) ? doc.chatParticipants : [],
    url: `/api/files/${doc.id}/download`,
    previewUrl: `/api/files/${doc.id}/preview`,
    downloadUrl: `/api/files/${doc.id}/download`
  };
  const resolved = resolveStoredUploadFile(entry);
  entry.storageStatus = String(entry.storageStatus || '').toUpperCase() === 'DELETED'
    ? 'DELETED'
    : (resolved ? 'AVAILABLE' : 'MISSING');
  if (entry.storageStatus === 'DELETED') entry.url = entry.previewUrl = entry.downloadUrl = '';
  if (existing) Object.assign(existing, entry);
  else d.files.unshift(entry);
  Object.assign(doc, {
    storageKey: entry.storageKey,
    storedName: entry.storedName,
    downloadUrl: entry.downloadUrl,
    previewUrl: entry.previewUrl,
    url: entry.url,
    mimeType: doc.mimeType || entry.mime,
    storageStatus: entry.storageStatus,
    securityStatus: doc.securityStatus || entry.securityStatus,
    storageProvider: doc.storageProvider || entry.storageProvider
  });
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
  return fileStorage.resolve(doc);
}
function resolveFileById(d, id){
  const requested = String(id || '');
  const normalized = normalizeFileName(requested);
  const matches = x => x && (
    String(x.id || x.fileId || '') === requested
    || [x.storageKey, x.storedName, x.stored_name, x.name, x.fileName]
      .filter(Boolean)
      .some(value => String(value) === requested || normalizeFileName(value) === normalized)
  );
  // The relational file registry is authoritative and indexed conceptually by id.
  // Search it first so a normal preview/download does not materialize every nested
  // task and chat attachment into one large temporary array.
  let doc = (d.files || []).find(matches) || null;
  if (!doc) {
    for (const c of d.cases || []) {
      doc = [
        ...(c.documents || []), ...(c.completedFiles || []), ...(c.sourceFiles || []),
        ...(c.workFiles || []), ...(c.files || [])
      ].find(matches) || null;
      if (doc) break;
    }
  }
  if (!doc) {
    for (const message of d.teamChat || []) {
      doc = [...(message.files || []), ...(message.attachments || []), ...(message.file ? [message.file] : [])].find(matches) || null;
      if (doc) break;
    }
  }
  if (!doc) return { doc:null, resolved:null };
  return { doc, resolved: resolveStoredUploadFile(doc) };
}

function resolveAuthorizedFile(req, res, id) {
  const d = readDb();
  const result = resolveFileById(d, id);
  if (result.doc && String(result.doc.storageStatus || '').toUpperCase() === 'DELETED') {
    res.status(410).json({ok:false,code:'FILE_DELETED',error:'This file was deleted and retained only as an audit record.'});
    return { d, doc:null, resolved:null, denied:true };
  }
  if (result.doc && !canAccessFileDocument(req.auth?.user || {}, result.doc, d.cases || [])) {
    authorizationDenied(req, res, 'FILE_ACCESS_DENIED', 'You do not have access to this file.');
    return { d, doc:null, resolved:null, denied:true };
  }
  return { d, ...result, denied:false };
}
function normalizePersistedFileLinks(d){
  d.files ||= [];
  for (const doc of allKnownFileDocs(d)) {
    if (!doc || !doc.id) continue;
    if (String(doc.storageStatus || '').toUpperCase() === 'DELETED') {
      doc.url=''; doc.downloadUrl=''; doc.previewUrl='';
    } else {
      doc.url = `/api/files/${doc.id}/download`;
      doc.downloadUrl = `/api/files/${doc.id}/download`;
      doc.previewUrl = `/api/files/${doc.id}/preview`;
    }
    addFileRegistryEntry(d, doc);
  }
  return d;
}
function sanitize(d, role){
  const out=structuredClone(d);
  const normalizedRole = normalizeAuthRole(role);
  out.users = (out.users || []).map(stripCredentialFields);
  if(normalizedRole!=='ADMIN'){
    delete out.payments;
    out.cases=(out.cases || []).map(c=>{
      const safe={...c};
      for (const field of FINANCE_FIELDS) delete safe[field];
      delete safe.estimateAmount;
      delete safe.amountReceived;
      delete safe.receivedAmount;
      return safe;
    });
  }
  if(normalizedRole==='DESIGNER') out.audit=[];
  return out;
}

function sanitizeCasesForRole(cases = [], role = '') {
  const normalizedRole = normalizeAuthRole(role);
  return (cases || []).filter(Boolean).map(caseRecord => {
    const safe = structuredClone(caseRecord);
    if (normalizedRole !== 'ADMIN') {
      for (const field of FINANCE_FIELDS) delete safe[field];
      delete safe.estimateAmount;
      delete safe.amountReceived;
      delete safe.receivedAmount;
    }
    return safe;
  });
}

function queryFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0','false','no','off'].includes(String(value).trim().toLowerCase());
}

function stateSyncDescriptor() {
  return {
    stateVersion:Number(stateVersion || 0),
    dataRevision:Number(workspaceDataRevision || 0),
    presenceGeneration:Number(presenceMutationGeneration || 0),
    collectionRevisions:{ ...workspaceCollectionRevisions },
    syncToken:`${Number(workspaceDataRevision || 0)}.${Number(presenceMutationGeneration || 0)}`
  };
}

function parseClientCollectionRevisions(value = '') {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const normalized = {};
    for (const collection of WORKSPACE_SYNC_COLLECTIONS) {
      const revision = Number(parsed[collection]);
      if (!Number.isFinite(revision) || revision < 0) return null;
      normalized[collection] = revision;
    }
    return normalized;
  } catch {
    return null;
  }
}

function getPerformanceBundle(d = readDb()) {
  if (performanceBundleCache.revision === performanceDataRevision) return performanceBundleCache;
  const records = mergePerformanceRecords(d.performanceRecords || [], buildPerformanceRecordsFromCases(d.cases || []));
  performanceBundleCache = {
    revision:performanceDataRevision,
    records,
    summary:buildPerformanceSummary(records, d.users || []),
    diagnostics:buildPerformanceDiagnostics(d.cases || [], records)
  };
  return performanceBundleCache;
}

function performanceRangeMs(value = 'month') {
  const key = String(value || 'month').trim().toLowerCase();
  if (key === 'week') return 7 * 86400000;
  if (key === 'quarter') return 90 * 86400000;
  return 30 * 86400000;
}

function leaderboardAggregateStats(d = readDb(), range = 'month') {
  const rangeKey = ['week','month','quarter'].includes(String(range || '').toLowerCase()) ? String(range).toLowerCase() : 'month';
  const nowMs = Date.now();
  const todayKey = serverTodayKey(nowMs);
  const cacheKey = `${performanceDataRevision}:${rangeKey}:${todayKey}`;
  const cached = leaderboardAggregateCache.get(cacheKey);
  if (cached) return cached;

  const cutoff = nowMs - performanceRangeMs(rangeKey);
  const performance = getPerformanceBundle(d);
  const summaryByName = new Map((performance.summary?.users || []).map(row => [String(row.userName || '').trim().toLowerCase(), row]));
  const approvedMembers = (d.users || [])
    .filter(user => normalizeStatus(user.status) === 'APPROVED' && normalizeRole(user.role) !== 'Admin');
  const userKeyById = new Map();
  const userKeyByName = new Map();
  approvedMembers.forEach(user => {
    const canonical = String(user.id || user.name || '').trim().toLowerCase();
    if (!canonical) return;
    [user.id, user.userId].filter(Boolean).forEach(value => userKeyById.set(String(value).trim().toLowerCase(), canonical));
    [user.name, user.username].filter(Boolean).forEach(value => userKeyByName.set(String(value).trim().toLowerCase(), canonical));
  });
  const caseStats = new Map();
  const ensure = (keyValue = '') => {
    const key = String(keyValue || '').trim().toLowerCase();
    if (!key) return null;
    if (!caseStats.has(key)) caseStats.set(key, { assignedCount:0, completedCount:0, activeCount:0, revisionCases:0, completedToday:0 });
    return caseStats.get(key);
  };
  for (const c of filterDeletedCases(d.cases || [], d.deletedProjectIds || [])) {
    const ownerId = [c.assigneeId, c.assignedUserId, c.ownerId, c.userId]
      .map(value => String(value || '').trim().toLowerCase()).find(value => value && userKeyById.has(value));
    const ownerName = String(perfOwner(c) || '').trim().toLowerCase();
    const canonicalOwner = (ownerId && userKeyById.get(ownerId)) || userKeyByName.get(ownerName) || ownerName;
    const row = ensure(canonicalOwner);
    if (!row) continue;
    const createdMs = parseDateMs(c.createdAt || c.assignedAt || c.updatedAt);
    const completedMs = parseDateMs(c.completedAt || c.finalApprovedAt || c.approvedAt || c.updatedAt);
    const inRange = createdMs >= cutoff || completedMs >= cutoff;
    const completed = isCompletedCaseForPerf(c);
    if (inRange) {
      row.assignedCount += 1;
      if (completed) row.completedCount += 1;
      else row.activeCount += 1;
      if (perfRevisionCount(c) > 0) row.revisionCases += 1;
    }
    if (completed && completedMs && serverTodayKey(completedMs) === todayKey) row.completedToday += 1;
  }
  const aggregates = approvedMembers
    .map(user => {
      const nameKey = String(user.name || '').trim().toLowerCase();
      const canonical = String(user.id || user.name || '').trim().toLowerCase();
      const summary = summaryByName.get(nameKey) || {};
      const counts = caseStats.get(canonical) || caseStats.get(nameKey) || { assignedCount:0, completedCount:0, activeCount:0, revisionCases:0, completedToday:0 };
      return {
        id:user.id,
        name:user.name,
        role:user.role,
        status:user.status,
        dailyLimit:Number(user.dailyLimit || user.taskLimit || user.workloadProfile?.dailyLimit || 15) || 15,
        ...counts,
        completedHistoryCount:Number(summary.completedCount || 0) || 0,
        avgCompletionMinutes:Number(summary.avgCompletionMinutes || 0) || 0,
        avgReviewMinutes:Number(summary.avgReviewMinutes || 0) || 0,
        rolling10CompletionMinutes:Number(summary.rolling10CompletionMinutes || 0) || 0,
        rolling30CompletionMinutes:Number(summary.rolling30CompletionMinutes || 0) || 0,
        trend:summary.trend || { pct:0, label:'Stable' },
        revisionCount:Number(summary.revisionCount || 0) || 0,
        revisionRate:Number(summary.revisionRate || 0) || 0,
        slaPct:Number(summary.slaPct || 0) || 0,
        productivityScore:Number(summary.productivityScore || 0) || 0,
        scoreBreakdown:summary.scoreBreakdown || {},
        caseTypeStats:Array.isArray(summary.caseTypeStats) ? summary.caseTypeStats : [],
        timingSource:summary.timingSource || 'No history yet'
      };
    })
    .sort((a,b) => b.productivityScore - a.productivityScore || b.completedHistoryCount - a.completedHistoryCount || String(a.name).localeCompare(String(b.name)))
    .map((member, index) => ({ ...member, rank:index + 1 }));

  const aggregate = {
    generatedAt:performance.summary?.generatedAt || now(),
    range:rangeKey,
    recordCount:Number(performance.summary?.recordCount || performance.records.length || 0),
    avgCompletionMinutes:Number(performance.summary?.avgCompletionMinutes || 0) || 0,
    avgReviewMinutes:Number(performance.summary?.avgReviewMinutes || 0) || 0,
    rolling10CompletionMinutes:Number(performance.summary?.rolling10CompletionMinutes || 0) || 0,
    rolling30CompletionMinutes:Number(performance.summary?.rolling30CompletionMinutes || 0) || 0,
    trend:performance.summary?.trend || { pct:0, label:'Stable' },
    members:aggregates
  };
  leaderboardAggregateCache.set(cacheKey, aggregate);
  // Keep this bounded even during long-running production use.
  if (leaderboardAggregateCache.size > 9) {
    const oldestKey = leaderboardAggregateCache.keys().next().value;
    if (oldestKey) leaderboardAggregateCache.delete(oldestKey);
  }
  return aggregate;
}

function buildTeamLeaderboard(d = readDb(), range = 'month') {
  const aggregate = leaderboardAggregateStats(d, range);
  const presenceById = new Map(sanitizePresenceUsers(d.users || []).map(user => [String(user.id || '').trim().toLowerCase(), user]));
  const members = aggregate.members.map(member => {
    const presence = presenceById.get(String(member.id || '').trim().toLowerCase()) || {};
    return {
      ...member,
      availability:presence.availability || 'Unavailable',
      isOnline:!!presence.isOnline,
      lastSeenAt:presence.lastSeenAt || null,
      lastHeartbeatAt:presence.lastHeartbeatAt || null
    };
  });
  return { ...aggregate, members };
}
function chatReadKey(req = {}) {
  const actor = requestActor(req);
  return actor.id || actor.username || actor.role || 'UNKNOWN';
}

function chatIdentityKeys(user = {}) {
  const actor=authorizationActor(user);
  return [actor.id,actor.username,actor.name].map(value=>String(value || '').trim().toLowerCase()).filter(Boolean);
}

function canAccessChatMessage(user = {}, message = {}) {
  const role=normalizePermissionRole(user.role);
  if (role === 'ADMIN' || role === 'MANAGER') return true;
  if (role !== 'DESIGNER') return false;
  const keys=chatIdentityKeys(user);
  const sender=[message.senderId,message.userId,message.sender,message.by].map(value=>String(value || '').trim().toLowerCase()).filter(Boolean);
  const recipient=String(message.recipient || 'global').trim().toLowerCase();
  return recipient === 'global' || sender.some(value=>keys.includes(value)) || keys.includes(recipient);
}

function scopedTeamChat(d = {}, req = {}) {
  return (d.teamChat || []).filter(message=>canAccessChatMessage(req.auth?.user || {},message));
}

function scopedNotifications(d = {}, req = {}) {
  const actor = req.auth?.user || {};
  return (d.notifications || []).filter(notification => notificationBelongsToUser(notification, actor));
}

function scopedAttendance(d = {}, req = {}) {
  const actor = requestActor(req);
  if (actor.role === 'ADMIN' || actor.role === 'MANAGER') return d.attendanceLogs || [];
  return (d.attendanceLogs || []).filter(log => {
    const values = [log.userId, log.username, log.userName, log.name].map(value => String(value || '').trim().toLowerCase());
    return values.includes(actor.id.toLowerCase()) || values.includes(actor.username.toLowerCase()) || values.includes(actor.name.toLowerCase());
  });
}

function scopedState(d = {}, req = {}, options = {}) {
  const actor = req.auth?.user || {};
  const role = normalizePermissionRole(actor.role);
  const compact = options.compact === true;
  const includePerformance = options.includePerformance !== false;
  const visibleCases = filterCasesForUser(filterDeletedCases(d.cases || [], d.deletedProjectIds || []), actor);
  const safeCases = sanitizeCasesForRole(visibleCases, role);
  const chatMessages = scopedTeamChat(d, req);
  const payload = {
    users:sanitizePresenceUsers(d.users || []),
    projects:safeCases,
    deletedProjectIds:[...(d.deletedProjectIds || [])],
    chatMessages,
    notifications:scopedNotifications(d, req),
    attendanceLogs:scopedAttendance(d, req)
  };
  if (!compact) {
    payload.cases = safeCases;
    payload.teamChat = chatMessages;
  }
  if (includePerformance) {
    const performance = getPerformanceBundle(d);
    payload.performanceRecords = performance.records;
    payload.performanceSummary = performance.summary;
  }
  if (role === 'ADMIN' && !compact) {
    payload.payments = (d.payments || []).filter(Boolean);
    payload.audit = d.audit || [];
  }
  return payload;
}

function scopedStateCollections(d = {}, req = {}, collections = []) {
  const requested = new Set(Array.isArray(collections) ? collections : []);
  const actor = req.auth?.user || {};
  const role = normalizePermissionRole(actor.role);
  const payload = {};
  if (requested.has('users')) payload.users = sanitizePresenceUsers(d.users || []);
  if (requested.has('cases')) {
    const visibleCases = filterCasesForUser(filterDeletedCases(d.cases || [], d.deletedProjectIds || []), actor);
    payload.projects = sanitizeCasesForRole(visibleCases, role);
  }
  if (requested.has('deletedProjectIds')) payload.deletedProjectIds = [...(d.deletedProjectIds || [])];
  if (requested.has('teamChat')) payload.chatMessages = scopedTeamChat(d, req);
  if (requested.has('notifications')) payload.notifications = scopedNotifications(d, req);
  if (requested.has('attendanceLogs')) payload.attendanceLogs = scopedAttendance(d, req);
  return payload;
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
  const pays=(d.payments || []).filter(Boolean).filter(p=>same(p.paymentDate||p.createdAt));
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
if (IS_PRODUCTION) app.set('trust proxy', 1);
app.disable('x-powered-by');
const configuredCorsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);
const isCorsOriginAllowed = createCorsOriginPolicy({
  configuredOrigins: configuredCorsOrigins,
  production: IS_PRODUCTION
});
const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (isCorsOriginAllowed(origin)) return callback(null, true);
    const error = new Error('Origin is not allowed by CORS policy.');
    error.statusCode = 403;
    error.code = 'CORS_ORIGIN_DENIED';
    callback(error);
  },
  methods: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','X-CSRF-Token','X-Request-Id','X-Webhook-Secret'],
  exposedHeaders: ['X-Request-Id','Content-Disposition','Content-Length','Content-Type','RateLimit-Limit','RateLimit-Remaining','RateLimit-Reset','Retry-After']
};
const loginRateLimiter = createRateLimiter({ windowMs:15 * 60 * 1000, max:20, prefix:'login', key:req => `login:${req.ip || req.socket?.remoteAddress || 'unknown'}:${normalizeUsername(req.body?.username || '')}` });
const recoveryRateLimiter = createRateLimiter({ windowMs:15 * 60 * 1000, max:8, prefix:'recovery' });
const otpRateLimiter = createRateLimiter({ windowMs:10 * 60 * 1000, max:8, prefix:'otp' });
const emailTestRateLimiter = createRateLimiter({ windowMs:60 * 60 * 1000, max:5, prefix:'email-test' });
const apiWriteRateLimiter = createRateLimiter({ windowMs:60 * 1000, max:boundedEnvNumber('API_WRITE_RATE_LIMIT', 300, 10, 10000), prefix:'api-write', key:req => `api-write:${req.auth?.user?.id || req.ip || req.socket?.remoteAddress || 'unknown'}` });
app.use(attachRequestId);
app.use(requestLogMiddleware);
app.use(secureResponseHeaders);
app.use(cors(corsOptions));
app.use(express.json({limit: JSON_BODY_LIMIT}));
app.use(rejectDangerousJson);
app.use('/api', requireJsonForBody);
app.use('/api', authenticationGate);
app.use('/api', (req,res,next) => isSafeMethod(req.method) ? next() : apiWriteRateLimiter(req,res,next));
app.use('/api', (req, res, next) => {
  const isForegroundWrite = !isSafeMethod(req.method) && req.path !== '/presence';
  if (!isForegroundWrite) return next();
  activeForegroundWriteRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeForegroundWriteRequests = Math.max(0, activeForegroundWriteRequests - 1);
  };
  res.once('finish', release);
  res.once('close', release);
  next();
});
app.get('/uploads/:filename', authenticationGate, (req,res)=>{
  const filename=safeName(path.basename(String(req.params.filename || '')));
  if (!filename) return res.status(404).send('File not found');
  const mode=String(req.query.mode || '').toLowerCase();
  const suffix=mode ? `?mode=${encodeURIComponent(mode)}` : '';
  res.redirect(307, `/api/uploads/${encodeURIComponent(filename)}${suffix}`);
});


// The workspace intentionally requires a fresh sign-in after every browser reload.
// This public, idempotent boot endpoint revokes any cookie left by a previous page
// instance before React renders protected operational data.
app.post('/api/auth/clear-browser-session', async (req, res) => {
  const rawToken = parseRequestCookies(req)[SESSION_COOKIE_NAME] || '';
  if (rawToken) await revokeAuthSession(tokenHash(rawToken)).catch(() => {});
  clearSessionCookie(res);
  res.json({ ok:true, authenticated:false });
});

app.post('/api/auth/login', loginRateLimiter, async (req, res) => {
  const username = normalizeUsername(req.body?.username || '');
  const password = String(req.body?.password || '');
  try {
    if (!username || !password) return res.status(400).json({ ok: false, code: 'LOGIN_FIELDS_REQUIRED', error: 'Username and password are required.' });
    const credential = await findCredentialByUsername(username);
    const lockedUntil = credential?.locked_until ? new Date(credential.locked_until).getTime() : 0;
    const valid = credential ? await verifyPassword(password, credential.password_hash) : false;
    if (!credential || !valid) {
      if (credential && lockedUntil > Date.now()) {
        await recordAuthEvent({ userId: credential.user_id, username, eventType: 'LOGIN_BLOCKED_LOCK', req });
        return res.status(423).json({ ok: false, code: 'LOGIN_LOCKED', error: `Too many failed attempts. Use the correct password or try again after ${new Date(lockedUntil).toLocaleTimeString()}.` });
      }
      if (credential) await updateLoginFailure(credential, req);
      else await recordAuthEvent({ username, eventType: 'LOGIN_FAILED_UNKNOWN_USER', req });
      return res.status(401).json({ ok: false, code: 'LOGIN_FAILED', error: 'Invalid username or password.' });
    }
    if (lockedUntil > Date.now()) {
      // A correct credential proves account ownership. Clear only the automatic
      // failed-attempt lock; intentionally RESTRICTED accounts are still denied below.
      await clearLoginFailures(credential);
      await recordAuthEvent({ userId: credential.user_id, username, eventType: 'LOGIN_UNLOCKED_WITH_VALID_PASSWORD', req });
    }
    const stateUser = findStateUserByIdOrUsername(credential.user_id, credential.username);
    const approved = stateUser && normalizeAuthStatus(stateUser.status || credential.status) === 'APPROVED' && normalizeAuthStatus(credential.status) === 'APPROVED';
    if (!approved) {
      await recordAuthEvent({ userId: credential.user_id, username, eventType: 'LOGIN_BLOCKED_RESTRICTED', req });
      return res.status(403).json({ ok: false, code: 'ACCOUNT_RESTRICTED', error: 'This account is restricted. Ask the administrator to allow login.' });
    }
    await clearLoginFailures(credential);
    const refreshedCredential = await findCredentialByUserId(credential.user_id) || credential;
    const session = await createAuthSession(refreshedCredential, req);
    setSessionCookie(res, session.rawToken);
    const user = publicSessionUser(stateUser, refreshedCredential);
    await recordAuthEvent({ userId: user.id, username: user.username, eventType: 'LOGIN_SUCCEEDED', req, details: { mustChangePassword: user.mustChangePassword } });
    res.json({ ok: true, authenticated: true, user, csrfToken: session.csrf_token, expiresAt: session.expires_at, sessionHours: SESSION_TTL_HOURS });
  } catch (error) {
    res.status(500).json({ ok: false, code: 'LOGIN_ERROR', error: error.message || 'Login failed.' });
  }
});

app.get('/api/auth/session', async (req, res) => {
  try {
    const auth = await resolveRequestAuthentication(req);
    if (!auth) {
      clearSessionCookie(res);
      return res.status(401).json({ ok: false, authenticated: false, code: 'AUTH_REQUIRED', error: 'No active session.' });
    }
    res.json({ ok: true, authenticated: true, user: auth.user, csrfToken: auth.session.csrf_token, expiresAt: auth.session.expires_at, sessionHours: SESSION_TTL_HOURS });
  } catch (error) {
    res.status(500).json({ ok: false, authenticated: false, error: error.message || 'Session check failed.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  await revokeAuthSession(req.auth?.session?.token_hash || '').catch(() => {});
  await recordAuthEvent({ userId: req.auth?.user?.id, username: req.auth?.user?.username, eventType: 'LOGOUT', req }).catch(() => {});
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/logout-all', async (req, res) => {
  await revokeAllUserSessions(req.auth?.user?.id || '');
  await recordAuthEvent({ userId: req.auth?.user?.id, username: req.auth?.user?.username, eventType: 'LOGOUT_ALL', req }).catch(() => {});
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/change-password', async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const errors = passwordPolicyErrors(newPassword);
    if (errors.length) return res.status(400).json({ ok: false, code: 'PASSWORD_POLICY_FAILED', error: errors.join(' '), errors });
    const credential = await findCredentialByUserId(req.auth.user.id);
    if (!credential || !(await verifyPassword(currentPassword, credential.password_hash))) {
      await recordAuthEvent({ userId: req.auth.user.id, username: req.auth.user.username, eventType: 'PASSWORD_CHANGE_FAILED', req });
      return res.status(401).json({ ok: false, code: 'CURRENT_PASSWORD_INVALID', error: 'Current password is incorrect.' });
    }
    if (await verifyPassword(newPassword, credential.password_hash)) return res.status(400).json({ ok: false, code: 'PASSWORD_REUSE', error: 'Choose a password different from the current password.' });
    const updated = await updateCredentialPassword(req.auth.user.id, await hashPassword(newPassword), false);
    await revokeAllUserSessions(req.auth.user.id);
    const nextSession = await createAuthSession(updated, req);
    setSessionCookie(res, nextSession.rawToken);
    const stateUser = findStateUserByIdOrUsername(updated.user_id, updated.username);
    const user = publicSessionUser(stateUser, updated);
    await recordAuthEvent({ userId: user.id, username: user.username, eventType: 'PASSWORD_CHANGED', req });
    res.json({ ok: true, user, csrfToken: nextSession.csrf_token, expiresAt: nextSession.expires_at });
  } catch (error) {
    res.status(500).json({ ok: false, code: 'PASSWORD_CHANGE_ERROR', error: error.message || 'Password could not be changed.' });
  }
});

app.post('/api/auth/recovery/request', recoveryRateLimiter, async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username || '');
    const channel = String(req.body?.channel || 'email').toLowerCase() === 'mobile' ? 'mobile' : 'email';
    const credential = await findCredentialByUsername(username);
    const user = credential ? findStateUserByIdOrUsername(credential.user_id, credential.username) : null;
    if (!credential || !user || normalizeAuthStatus(user.status || credential.status) !== 'APPROVED') {
      return res.status(400).json({ ok: false, code: 'RECOVERY_DETAILS_INVALID', error: 'The account or registered recovery details do not match.' });
    }
    const enteredEmail = normalizeEmail(req.body?.email || '');
    const enteredMobile = normalizeMobile(req.body?.mobile || '');
    const registeredEmail = normalizeEmail(user.email || '');
    const registeredMobile = normalizeMobile(user.phone || user.mobile || '');
    if (channel === 'email') {
      if (!user.emailRegistered || !registeredEmail || enteredEmail !== registeredEmail) return res.status(400).json({ ok: false, code: 'RECOVERY_DETAILS_INVALID', error: 'The account or registered recovery details do not match.' });
    } else if (!user.mobileRegistered || !registeredMobile || enteredMobile.slice(-10) !== registeredMobile.slice(-10)) {
      return res.status(400).json({ ok: false, code: 'RECOVERY_DETAILS_INVALID', error: 'The account or registered recovery details do not match.' });
    }
    const otp = randomOtp();
    const delivery = channel === 'email' ? await sendOtpEmail(registeredEmail, otp) : await sendOtpSms(registeredMobile, otp);
    const challengeId = nanoid(16);
    otpStore.set(challengeId, { userId: credential.user_id, username, channel, purpose: 'password_recovery', otp, expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 });
    const response = { ok: true, challengeId, channel, expiresInSeconds: 300 };
    if (delivery?.localOnly && localEmailOtpAllowed()) response.devOtp = otp;
    await recordAuthEvent({ userId: credential.user_id, username, eventType: 'PASSWORD_RECOVERY_REQUESTED', req, details: { channel } });
    res.json(response);
  } catch (error) {
    res.status(503).json({ ok: false, code: 'RECOVERY_SEND_FAILED', error: error.message || 'Recovery OTP could not be sent.' });
  }
});

app.post('/api/auth/recovery/reset', recoveryRateLimiter, async (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId || '');
    const otp = String(req.body?.otp || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    const record = otpStore.get(challengeId);
    if (!record || record.purpose !== 'password_recovery') return res.status(400).json({ ok: false, code: 'RECOVERY_SESSION_INVALID', error: 'Password recovery session was not found. Request a new OTP.' });
    if (record.expiresAt < Date.now()) {
      otpStore.delete(challengeId);
      return res.status(400).json({ ok: false, code: 'OTP_EXPIRED', error: 'OTP expired. Request a new OTP.' });
    }
    record.attempts += 1;
    if (record.attempts > 5) {
      otpStore.delete(challengeId);
      return res.status(429).json({ ok: false, code: 'OTP_ATTEMPTS_EXCEEDED', error: 'Too many incorrect attempts. Request a new OTP.' });
    }
    if (record.otp !== otp) return res.status(400).json({ ok: false, code: 'OTP_INVALID', error: 'Invalid OTP.' });
    const errors = passwordPolicyErrors(newPassword);
    if (errors.length) return res.status(400).json({ ok: false, code: 'PASSWORD_POLICY_FAILED', error: errors.join(' '), errors });
    const updated = await updateCredentialPassword(record.userId, await hashPassword(newPassword), false);
    await revokeAllUserSessions(record.userId);
    otpStore.delete(challengeId);
    await recordAuthEvent({ userId: record.userId, username: record.username, eventType: 'PASSWORD_RECOVERED', req });
    res.json({ ok: true, username: updated.username });
  } catch (error) {
    res.status(500).json({ ok: false, code: 'RECOVERY_RESET_FAILED', error: error.message || 'Password could not be reset.' });
  }
});

app.get('/api/auth/health', requireAdminSession, async (_req, res) => {
  try {
    let activeSessions = 0;
    let lockedCredentials = 0;
    if (USE_POSTGRES) {
      const sessions = await pool.query('SELECT count(*)::int AS count FROM auth_sessions WHERE revoked_at IS NULL AND expires_at>now()');
      const locked = await pool.query('SELECT count(*)::int AS count FROM auth_credentials WHERE locked_until>now()');
      activeSessions = Number(sessions.rows[0]?.count || 0);
      lockedCredentials = Number(locked.rows[0]?.count || 0);
    } else {
      const store = readLocalAuthStore();
      activeSessions = store.sessions.filter(item => !item.revoked_at && new Date(item.expires_at).getTime() > Date.now()).length;
      lockedCredentials = store.credentials.filter(item => item.locked_until && new Date(item.locked_until).getTime() > Date.now()).length;
    }
    res.json({ ok: true, credentialCount: await countCredentials(), activeSessions, lockedCredentials, passwordHash: 'scrypt-v1', httpOnlyCookie: true, csrfProtection: true, sessionHours: SESSION_TTL_HOURS });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || 'Authentication health could not be loaded.' });
  }
});

app.post('/api/auth/users', requireAdminSession, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const username = normalizeUsername(req.body?.username || '');
    const password = String(req.body?.password || '');
    const role = normalizeAuthRole(req.body?.role || 'DESIGNER');
    if (!name || !username) return res.status(400).json({ ok: false, error: 'Name and username are required.' });
    if (role === 'ADMIN') return res.status(400).json({ ok: false, error: 'Creating another Admin requires controlled database approval.' });
    const errors = passwordPolicyErrors(password);
    if (errors.length) return res.status(400).json({ ok: false, code: 'PASSWORD_POLICY_FAILED', error: errors.join(' '), errors });
    if (await findCredentialByUsername(username)) return res.status(409).json({ ok: false, code: 'USERNAME_EXISTS', error: 'This username already exists.' });
    const d = db();
    const userId = String(req.body?.id || `user-${nanoid(12)}`);
    const displayRole = role === 'MANAGER' ? 'Manager' : 'Designer';
    const user = stripCredentialFields(employeeLifecycleProfile({ id: userId, name, username, role: displayRole, status: 'APPROVED', createdAt: Date.now(), createdBy: req.auth.user.name }, {}));
    d.users.push(user);
    d.users = cleanTeamUsers(d.users);
    const credential = authCredentialRecord({ user_id: userId, username, password_hash: await hashPassword(password), role, status: 'APPROVED', must_change_password: true, password_version: 1 });
    const persistence = await save(d, {
      actor:req.auth.user.name,
      reason:'auth_user_create',
      authOperations: [{ type: 'upsertCredential', credential }],
      collections:['users'],
      collectionRowIds:{users:[userId]}
    });
    await recordAuthEvent({ userId, username, eventType: 'USER_CREDENTIAL_CREATED', req, details: { role, createdBy: req.auth.user.name } });
    res.status(201).json({ ok: true, user: publicSessionUser(user, credential), persistence });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, code: error.code || '', error: error.message || 'User could not be created.' });
  }
});

app.patch('/api/auth/users/:id', requireAdminSession, async (req, res) => {
  try {
    const d = db();
    const index = (d.users || []).findIndex(user => String(user.id) === String(req.params.id));
    if (index < 0) return res.status(404).json({ ok: false, error: 'User was not found.' });
    const existingUser = d.users[index];
    const existingCredential = await findCredentialByUserId(existingUser.id);
    if (!existingCredential) return res.status(409).json({ ok: false, code: 'CREDENTIAL_MISSING', error: 'This account has no secure credential. Reset its password first.' });
    if (normalizeAuthRole(existingUser.role) === 'ADMIN' && String(existingUser.id) !== String(req.auth.user.id)) return res.status(403).json({ ok: false, error: 'Another Admin account cannot be modified here.' });
    const username = req.body?.username !== undefined ? normalizeUsername(req.body.username) : normalizeUsername(existingUser.username);
    const usernameOwner = await findCredentialByUsername(username);
    if (usernameOwner && String(usernameOwner.user_id) !== String(existingUser.id)) return res.status(409).json({ ok: false, code: 'USERNAME_EXISTS', error: 'This username already exists.' });
    const role = req.body?.role !== undefined ? normalizeAuthRole(req.body.role) : normalizeAuthRole(existingUser.role);
    const status = req.body?.status !== undefined ? normalizeAuthStatus(req.body.status) : normalizeAuthStatus(existingUser.status);
    const nextUser = stripCredentialFields(employeeLifecycleProfile({ ...existingUser, name: req.body?.name !== undefined ? String(req.body.name).trim() : existingUser.name, username, role: role === 'ADMIN' ? 'Admin' : role === 'MANAGER' ? 'Manager' : 'Designer', status }, existingUser));
    d.users[index] = nextUser;
    const nextCredential = {
      ...existingCredential,
      username,
      role,
      status,
      // Allow Login must also remove a stale failed-attempt lock. Previously an
      // Admin could approve the account while the credential remained locked.
      ...(status === 'APPROVED' ? { failed_attempts: 0, locked_until: null } : {})
    };
    const authOperations = [{ type: 'upsertCredential', credential: nextCredential }];
    if (status !== 'APPROVED') authOperations.push({ type: 'revokeSessions', userId: existingUser.id });
    const persistence = await save(d, {
      actor:req.auth.user.name,
      reason:'auth_user_update',
      authOperations,
      collections:['users'],
      collectionRowIds:{users:[String(nextUser.id)]}
    });
    await recordAuthEvent({ userId: existingUser.id, username, eventType: 'USER_ACCESS_UPDATED', req, details: { role, status, updatedBy: req.auth.user.name } });
    res.json({ ok: true, user: publicSessionUser(nextUser, nextCredential), persistence });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, code: error.code || '', error: error.message || 'User access could not be updated.' });
  }
});

app.post('/api/auth/users/:id/reset-password', requireAdminSession, async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    const errors = passwordPolicyErrors(password);
    if (errors.length) return res.status(400).json({ ok: false, code: 'PASSWORD_POLICY_FAILED', error: errors.join(' '), errors });
    const credential = await findCredentialByUserId(req.params.id);
    if (!credential) return res.status(404).json({ ok: false, error: 'User credential was not found.' });
    const updated = await updateCredentialPassword(req.params.id, await hashPassword(password), true);
    await revokeAllUserSessions(req.params.id);
    await recordAuthEvent({ userId: req.params.id, username: credential.username, eventType: 'PASSWORD_RESET_BY_ADMIN', req, details: { resetBy: req.auth.user.name } });
    res.json({ ok: true, userId: req.params.id, username: updated.username, mustChangePassword: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || 'Password could not be reset.' });
  }
});


function sendProfilePhotoPlaceholder(res) {
  res.status(200);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="28" fill="#f1f5f9"/><circle cx="80" cy="60" r="28" fill="#cbd5e1"/><path d="M34 138c6-28 27-44 46-44s40 16 46 44" fill="#cbd5e1"/></svg>`);
}

function resolveProfilePhotoPath(requestedName = '') {
  const requested = String(requestedName || '').trim();
  const d = readDb();
  const user = (d.users || []).find(item => [item.id, item.username, item.name, fileBaseName(item.profilePhoto || ''), fileBaseName(item.profilePhotoFile || '')]
    .filter(Boolean).some(value => String(value) === requested || safeName(String(value)) === safeName(requested)));
  if (!user) return '';
  const resolved = fileStorage.resolve({
    storageKey: user.profilePhotoStorageKey || user.profilePhotoFile || '',
    storedName: user.profilePhotoFile || '',
    name: user.profilePhotoOriginalName || fileBaseName(user.profilePhoto || '')
  });
  return resolved?.fp && isResolvedStoragePathAllowed(resolved.fp) ? resolved.fp : '';
}

app.get('/api/profile/photo/:filename', async (req, res) => {
  try {
    const fp = resolveProfilePhotoPath(req.params.filename || '');
    if (!fp) return sendProfilePhotoPlaceholder(res);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(fp);
  } catch {
    sendProfilePhotoPlaceholder(res);
  }
});

app.get('/api/uploads/:filename', async (req, res) => {
  const filename = safeName(req.params.filename || '');
  if (!filename) return res.status(404).send('File not found');
  const d = readDb();
  const doc = allKnownFileDocs(d).find(item => {
    const stored = item.storageKey || item.storedName || item.stored_name || fileBaseName(item.url || item.fileUrl || '');
    return fileBaseName(String(stored || '')) === filename || String(stored || '') === filename;
  });
  if (!doc || !canAccessFileDocument(req.auth?.user || {}, doc, d.cases || [])) {
    return authorizationDenied(req, res, 'FILE_ACCESS_DENIED', 'You do not have access to this file.');
  }
  const mode = String(req.query.mode || '').toLowerCase() === 'preview' ? 'preview' : 'download';
  return res.redirect(307, `/api/files/${encodeURIComponent(doc.id)}/${mode}`);
});

app.get('/api/health', async (_req, res) => {
  const status = await buildReliabilityStatus({ detailed:false });
  res.status(status.ok ? 200 : 503).json({ ...status, service:'Kalpvriksha Ops API' });
});
app.get('/api/health/live', (_req, res) => res.status(shuttingDown ? 503 : 200).json({ ok:!shuttingDown, status:shuttingDown ? 'SHUTTING_DOWN' : 'ALIVE', service:'Kalpvriksha Ops API', time:now(), uptimeSeconds:Math.round(process.uptime()) }));
app.get('/api/health/ready', async (_req, res) => {
  const status = await buildReliabilityStatus({ detailed:false });
  res.status(status.ok ? 200 : 503).json(status);
});

function getEmailStatusPayload() {
  const provider = emailProvider();
  const host = process.env.SMTP_HOST || (provider === 'gmail' ? 'smtp.gmail.com' : '');
  const port = boundedEnvNumber('SMTP_PORT', provider === 'gmail' ? 465 : 587, 1, 65535);
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

app.get('/api/email/health', requireAdminSession, async (_req, res) => res.json(getEmailStatusPayload()));
app.get('/api/email/status', requireAdminSession, async (_req, res) => res.json(getEmailStatusPayload()));

app.post('/api/email/test', requireAdminSession, emailTestRateLimiter, async (req,res)=>{
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

app.post('/api/otp/send', otpRateLimiter, async (req,res)=>{
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const mobile = normalizeMobile(req.body.mobile || '');
    const email = normalizeEmail(req.body.email || '');
    const purpose = String(req.body.purpose || 'otp');
    const channel = String(req.body.channel || (email ? 'email' : 'mobile')).toLowerCase();
    if (!username) return res.status(400).json({ ok:false, error:'Username is required.' });
    if (channel === 'email' && !email.includes('@')) return res.status(400).json({ ok:false, error:'A valid registered email address is required.' });
    if (channel !== 'email' && mobile.length < 10) return res.status(400).json({ ok:false, error:'A valid registered mobile number is required.' });
    const otp = randomOtp();
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
app.post('/api/otp/verify', otpRateLimiter, async (req,res)=>{
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

app.get('/',async (_req,res)=>res.json({ok:true,app:'Kalpvriksha Designs ERP'}));
app.get('/api/meta',async (_req,res)=>res.json({roles,serviceTypes,statuses,sourceDocTypes,finalDocTypes}));
app.get('/api/bootstrap', requireCapability('state:read'), async (req,res)=>{
  const d = readDb();
  const scoped = scopedState(d, req, { compact:queryFlag(req.query.compact, false), includePerformance:queryFlag(req.query.performance, true) });
  const readIds = d.chatReads?.[chatReadKey(req)] || [];
  const unreadChat = (d.teamChat || []).filter(message => !readIds.includes(message.id)).length;
  const actor = requestActor(req);
  const mentionUnread = (d.teamChat || []).filter(message => !readIds.includes(message.id) && (message.mentions || []).some(value => {
    const text = String(value || '').trim().toLowerCase();
    return text === actor.role.toLowerCase() || text === actor.name.toLowerCase() || text === actor.username.toLowerCase();
  })).length;
  const meta = { teamStatus:teamStatus(d), unreadChat, mentionUnread, permissions:ROLE_CAPABILITIES?.[actor.role] || [] };
  if (actor.role === 'ADMIN') meta.dailyLedger = dailyLedger(d);
  res.json({ ...scoped, meta, stateVersion });
});

app.get('/api/state', requireCapability('state:read'), async (req,res)=>{
  const sync = stateSyncDescriptor();
  const sinceDataRevision = Number(req.query.sinceDataRevision);
  const sinceVersion = Number(req.query.sinceVersion);
  const sincePresence = Number(req.query.sincePresence);
  const sinceCollections = parseClientCollectionRevisions(req.query.sinceCollections);
  const hasDataRevision = Number.isFinite(sinceDataRevision) && sinceDataRevision >= 0;
  const hasLegacyVersion = Number.isFinite(sinceVersion) && sinceVersion >= 0;
  const hasPresence = Number.isFinite(sincePresence) && sincePresence >= 0;
  const sameWorkspaceData = hasDataRevision ? sinceDataRevision === sync.dataRevision : (hasLegacyVersion && sinceVersion === sync.stateVersion);
  if (sameWorkspaceData && hasPresence) {
    if (sincePresence === sync.presenceGeneration) {
      return res.json({ ok:true, unchanged:true, database:USE_POSTGRES ? 'postgresql' : 'json-file', savedAt:now(), ...sync });
    }
    const d = readDb();
    return res.json({
      ok:true,
      partial:'presence',
      database:USE_POSTGRES ? 'postgresql' : 'json-file',
      users:sanitizePresenceUsers(d.users || []),
      attendanceLogs:scopedAttendance(d, req),
      savedAt:now(),
      ...sync
    });
  }
  if (!sameWorkspaceData && sinceCollections) {
    const changedCollections = WORKSPACE_SYNC_COLLECTIONS.filter(collection => Number(sinceCollections[collection]) !== Number(sync.collectionRevisions[collection]));
    const presenceChanged = hasPresence && sincePresence !== sync.presenceGeneration;
    if (presenceChanged) {
      if (!changedCollections.includes('users')) changedCollections.push('users');
      if (!changedCollections.includes('attendanceLogs')) changedCollections.push('attendanceLogs');
    }
    if (changedCollections.length && changedCollections.length < WORKSPACE_SYNC_COLLECTIONS.length) {
      const d = readDb();
      return res.json({
        ok:true,
        partial:'workspace',
        changedCollections,
        database:USE_POSTGRES ? 'postgresql' : 'json-file',
        ...scopedStateCollections(d, req, changedCollections),
        savedAt:now(),
        ...sync
      });
    }
  }
  const d = readDb();
  const scoped = scopedState(d, req, { compact:queryFlag(req.query.compact, false), includePerformance:queryFlag(req.query.performance, true) });
  res.json({
    ok:true,
    database:USE_POSTGRES ? 'postgresql' : 'json-file',
    ...scoped,
    savedAt:now(),
    ...sync
  });
});

app.get('/api/performance-records', requireCapability('performance:read'), async (_req, res) => {
  const performance = getPerformanceBundle(readDb());
  res.json({ ok: true, records:performance.records, summary:performance.summary, diagnostics:performance.diagnostics });
});

app.get('/api/performance/diagnostics', requireCapability('performance:read'), async (_req, res) => {
  const performance = getPerformanceBundle(readDb());
  res.json({ ok: true, diagnostics:performance.diagnostics, summary:performance.summary });
});

app.get('/api/performance/leaderboard', requireCapability('performance:read'), async (req, res) => {
  const range = ['week','month','quarter'].includes(String(req.query.range || '').toLowerCase()) ? String(req.query.range).toLowerCase() : 'month';
  res.json({ ok:true, leaderboard:buildTeamLeaderboard(readDb(), range) });
});

app.post('/api/performance/rebuild', requireCapability('performance:rebuild'), async (req, res) => {
  const d = db();
  const generated = buildPerformanceRecordsFromCases(d.cases || []);
  const records = mergePerformanceRecords([], generated);
  d.performanceRecords = records;
  await save(d,{actor:requestActor(req).name,reason:'performance_rebuild',collections:['performanceRecords']});
  const summary = buildPerformanceSummary(records, d.users || []);
  res.json({ ok: true, rebuilt: records.length, records, summary, diagnostics: buildPerformanceDiagnostics(d.cases || [], records) });
});

app.get('/api/app-state', requireAdminSession, async (req, res) => {
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

app.get('/api/system/status', requireCapability('system:read'), async (_req, res) => {
  try {
    const [db, reliability] = await Promise.all([getDbStatus(), buildReliabilityStatus({ detailed:false })]);
    const cloudConnected = String(db.database || '').startsWith('postgresql') && db.connected === true;
    res.status(reliability.ok ? 200 : 503).json({ ok:reliability.ok, cloudConnected, database:db.database, connected:db.connected, localMode:!cloudConnected, reliability });
  } catch (e) {
    res.status(500).json({ ok:false, cloudConnected:false, localMode:true, error:e.message });
  }
});

app.get('/api/system/reliability', requireAdminSession, async (_req,res)=>{
  try {
    const status = await buildReliabilityStatus({ detailed:true });
    res.status(status.ok ? 200 : 503).json(status);
  } catch(error) {
    res.status(500).json({ok:false,code:error.code || 'RELIABILITY_STATUS_FAILED',error:error.message || 'Reliability status could not be loaded.'});
  }
});

app.get('/api/system/backups', requireAdminSession, async (_req,res)=>{
  const backups = inspectBackupManifests(BACKUP_ROOT,{maxAgeHours:BACKUP_MAX_AGE_HOURS});
  res.status(!BACKUP_REQUIRED || backups.ok ? 200 : 503).json({ok:!BACKUP_REQUIRED || backups.ok,required:BACKUP_REQUIRED,...backups});
});

app.get('/api/system/release-certification', requireAdminSession, async (_req,res)=>{
  const certification = readAndVerifyReleaseCertificate(RELEASE_CERTIFICATE_PATH, {
    expectedBackendVersion: BACKEND_PACKAGE_VERSION,
    maxAgeHours: RELEASE_CERTIFICATE_MAX_AGE_HOURS,
    requireCleanInstall: true,
    requireBackup: RELEASE_CERTIFICATE_REQUIRED && BACKUP_REQUIRED
  });
  const ok = !RELEASE_CERTIFICATE_REQUIRED || certification.ok;
  res.status(ok ? 200 : 503).json({ ok, required:RELEASE_CERTIFICATE_REQUIRED, backendVersion:BACKEND_PACKAGE_VERSION, ...certification });
});

app.get('/api/system/jobs', requireAdminSession, async (req,res)=>{
  try {
    const jobs = await operationalJobs.list({status:String(req.query.status || ''),limit:Number(req.query.limit || 100)});
    res.json({ok:true,jobs,failedCount:jobs.filter(job=>job.status==='FAILED').length});
  } catch(error) {
    res.status(500).json({ok:false,code:'OPERATIONAL_JOBS_FAILED',error:error.message || 'Operational jobs could not be loaded.'});
  }
});

app.post('/api/system/jobs/:id/retry', requireAdminSession, async (req,res)=>{
  try {
    const jobs = await operationalJobs.list({limit:500});
    const job = jobs.find(item=>item.id===String(req.params.id));
    if (!job) return res.status(404).json({ok:false,code:'JOB_NOT_FOUND',error:'Operational job was not found.'});
    if (job.jobType === 'STATE_PERSISTENCE') return res.status(409).json({ok:false,code:'UNSAFE_AUTOMATIC_RETRY',error:'A failed state write cannot be replayed automatically because newer data may exist. Review the database revision and retry the original user action.'});
    const retried = await operationalJobs.retry(job.id,requestActor(req).name);
    await recordOperationalEvent(pool,USE_POSTGRES,{eventType:'OPERATIONAL_JOB_RETRY_REQUESTED',severity:'INFO',actor:requestActor(req).name,requestId:req.requestId,details:{jobId:job.id,jobType:job.jobType}}).catch(()=>{});
    res.json({ok:true,job:retried});
  } catch(error) {
    res.status(500).json({ok:false,code:'JOB_RETRY_FAILED',error:error.message || 'The job could not be queued for retry.'});
  }
});

app.get('/api/system/events', requireAdminSession, async (req,res)=>{
  if (!USE_POSTGRES) return res.json({ok:true,events:[],warning:'Persistent operational events require PostgreSQL.'});
  try {
    const limit=Math.max(1,Math.min(500,Number(req.query.limit || 100)));
    const result=await pool.query('SELECT id,event_type,severity,actor,request_id,details,created_at FROM operational_events ORDER BY created_at DESC LIMIT $1',[limit]);
    res.json({ok:true,events:result.rows});
  } catch(error) {
    res.status(500).json({ok:false,code:'OPERATIONAL_EVENTS_FAILED',error:error.message || 'Operational events could not be loaded.'});
  }
});



app.post('/api/state/projects', async (req, res) => {
  try {
    const d = db();
    const actor = requestActor(req);
    const incoming = req.body?.project || req.body?.case || req.body;
    if (!incoming || typeof incoming !== 'object' || (!incoming.id && !incoming.caseId)) {
      return res.status(400).json({ ok:false, code:'PROJECT_ID_REQUIRED', error:'Project id is required.' });
    }
    const projectId = textValue(incoming.id || incoming.caseId, 'Project id', 200, { required:true });
    const incomingIds = getCaseIdentitySet(incoming);
    const tombstones = new Set((d.deletedProjectIds || []).map(String));
    if (incomingIds.some(id => tombstones.has(id))) {
      return res.status(409).json({ ok:false, code:'PROJECT_DELETED', error:'This task was permanently deleted and cannot be restored by a stale client.', deletedProjectIds:d.deletedProjectIds || [] });
    }

    const existing = findCaseByAnyId(d.cases || [], projectId) || findCaseByAnyId(d.cases || [], incoming.caseId || '');
    let safeIncoming;
    if (existing) {
      safeIncoming = authorizedProjectUpdate(existing, incoming, req);
    } else {
      if (!hasCapability(req.auth?.user || {}, 'task:create')) return authorizationDenied(req, res, 'TASK_CREATE_FORBIDDEN', 'Only Admins and Managers can create tasks.');
      safeIncoming = preserveFinanceFields({}, structuredClone(incoming));
      const recordedAt = Date.now();
      const todayTaskDate = indiaDateKey(recordedAt);
      const requestedTaskDate = normalizeTaskDate(incoming.taskDate || incoming.operationalDate || incoming.createdAt, recordedAt);
      if (requestedTaskDate > todayTaskDate) {
        const error = new Error('Task date cannot be in the future.');
        error.statusCode = 400;
        error.code = 'TASK_DATE_IN_FUTURE';
        throw error;
      }
      safeIncoming.id = projectId;
      safeIncoming.caseId = incoming.caseId || projectId;
      safeIncoming.taskDate = requestedTaskDate;
      safeIncoming.taskAccountingPeriod = normalizeFinanceAccountingPeriod(requestedTaskDate, recordedAt);
      safeIncoming.createdAt = taskDateTimestamp(requestedTaskDate, recordedAt);
      safeIncoming.recordedAt = recordedAt;
      safeIncoming.updatedAt = recordedAt;
      safeIncoming.syncVersion = recordedAt;
      safeIncoming.createdBy = actor.name;
      safeIncoming.creatorName = actor.name;
      safeIncoming.createdByRole = actor.role;
      safeIncoming.updatedBy = actor.name;
      safeIncoming.ownership = { ...(incoming.ownership || {}), createdBy:actor.name, editedBy:actor.name };
      safeIncoming.history = mergeAppendOnly([], incoming.history || []);
      safeIncoming.timeline = mergeTimelineEvents([], incoming.timeline || []);
    }

    d.cases = mergeCasesPreservingFreshest(d.cases || [], [safeIncoming], d.deletedProjectIds || []);
    const saved = findCaseByAnyId(d.cases || [], projectId) || findCaseByAnyId(d.cases || [], safeIncoming.caseId || projectId) || safeIncoming;
    addAudit(d, actor.name, existing ? 'Task updated' : 'Task created', saved.caseId || saved.id);
    const auditEntry = d.audit?.[0];
    const persistence = await save(d, {
      actor:actor.name,
      reason:existing ? 'task_update' : 'task_create',
      skipRevisionSnapshot:true,
      periodicRevisionSnapshot:true,
      collections:['cases','audit'],
      collectionRowIds:{
        cases:[String(saved.id || saved.caseId)],
        audit:auditEntry?.id ? [String(auditEntry.id)] : []
      }
    });
    const visible = sanitizeCasesForRole([saved], actor.role)[0] || saved;
    res.json({ ok:true, project:visible, case:visible, deletedProjectIds:d.deletedProjectIds || [], counts:{ cases:(d.cases || []).length }, persistence });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok:false, code:e.code || '', error:e.message || 'Project save failed.', requestId:req.requestId || '' });
  }
});

app.delete('/api/state/projects/:id', requireAnyRole('ADMIN','MANAGER'), requireCaseAction('delete'), async (req,res)=>{
  const d = requestDb(req);
  const actor = requestActor(req);
  const id = textValue(req.params.id, 'Project id', 200, { required:true });
  const before = (d.cases || []).length;
  (d.cases || []).filter(c => String(c.id) === id || String(c.caseId) === id).forEach(c => {
    rememberDeletedProject(d, c.id);
    rememberDeletedProject(d, c.caseId);
    addAudit(d, actor.name, 'Task permanently deleted', c.caseId || c.id);
  });
  rememberDeletedProject(d, id);
  d.cases = filterDeletedCases(d.cases || [], d.deletedProjectIds || []);
  d.notifications = (d.notifications || []).filter(n => String(n.caseId || n.projectId || n.targetId || '') !== id);
  await save(d, { actor:actor.name, reason:'task_delete', collections:['cases','notifications','audit','deletedProjectIds'] });
  res.json({ok:true, deleted:before - d.cases.length, deletedProjectIds:d.deletedProjectIds || [], counts:{cases:d.cases.length}});
});

app.post('/api/presence', requireCapability('presence:self'), async (req, res) => {
  try {
    const actor = requestActor(req);
    const body = req.body || {};
    const action = String(body.action || 'heartbeat').toLowerCase();
    const safeAction = ['login','heartbeat','break','resume','logout'].includes(action) ? action : 'heartbeat';
    const stateUser = findStateUserByIdOrUsername(actor.id, actor.username);
    if (!stateUser) return res.status(404).json({ ok:false, code:'USER_NOT_FOUND', error:'Signed-in user record was not found.' });
    const requestedAvailability = ['Available','Busy','Break','Unavailable'].includes(String(body.availability || body.user?.availability || ''))
      ? String(body.availability || body.user?.availability)
      : stateUser.availability;
    const userPatch = {
      ...stateUser,
      id:actor.id,
      username:actor.username,
      name:actor.name,
      role:stateUser.role,
      status:stateUser.status,
      availability:requestedAvailability,
      breakStartedAt:safeAction === 'break' ? Date.now() : stateUser.breakStartedAt
    };

    if (safeAction === 'heartbeat') {
      // Heartbeats are high-frequency and must never rewrite the complete
      // operational database or queue behind task/file writes. Only the small
      // presence slice is updated in memory, then coalesced into one durable
      // write every few minutes or included in the next normal business write.
      const presenceState = {
        users: structuredClone(memoryState?.users || []),
        attendanceLogs: structuredClone(memoryState?.attendanceLogs || [])
      };
      const user = applyPresenceUpdate(presenceState, userPatch, safeAction);
      replacePresenceSliceInMemory(presenceState);
      schedulePresenceFlush();
      return res.json({
        ok:true,
        user,
        users:sanitizePresenceUsers(presenceState.users || []),
        attendanceLogs:scopedAttendance({ users:presenceState.users || [], attendanceLogs:presenceState.attendanceLogs || [] }, req),
        persistence:{ mode:'coalesced', queued:false, flushWithinMs:PRESENCE_HEARTBEAT_FLUSH_MS }
      });
    }

    const d = db();
    const user = applyPresenceUpdate(d, userPatch, safeAction);
    presenceMutationGeneration += 1;
    snapshotPresenceGenerations.set(d, presenceMutationGeneration);
    const persistence = await save(d, {
      actor:actor.name,
      reason:`presence_${safeAction}`,
      skipRevisionSnapshot:true,
      collections:['users','attendanceLogs']
    });
    res.json({ ok:true, user, users:sanitizePresenceUsers(d.users || []), attendanceLogs:scopedAttendance(d, req), persistence });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok:false, code:e.code || '', error:e.message || 'Presence update failed.' });
  }
});

app.post('/api/state', async (req,res)=>{
  try {
    const d = db();
    const body = req.body || {};
    const actor = requestActor(req);
    const hasProjects = Array.isArray(body.projects) || Array.isArray(body.cases);
    const incomingCases = Array.isArray(body.projects) ? body.projects : (Array.isArray(body.cases) ? body.cases : []);
    assertArrayLimit(incomingCases, 'projects', MAX_STATE_PROJECTS_PER_WRITE);
    const authorizedIncoming = [];
    for (const incoming of incomingCases.filter(Boolean)) {
      if (!incoming.id && !incoming.caseId) continue;
      const existing = findCaseByAnyId(d.cases || [], incoming.id || incoming.caseId) || findCaseByAnyId(d.cases || [], incoming.caseId || incoming.id);
      if (existing) authorizedIncoming.push(authorizedProjectUpdate(existing, incoming, req));
      else {
        if (!hasCapability(req.auth?.user || {}, 'task:create')) {
          const error = new Error('Only Admins and Managers can create tasks.');
          error.statusCode = 403;
          error.code = 'TASK_CREATE_FORBIDDEN';
          throw error;
        }
        const created = preserveFinanceFields({}, structuredClone(incoming));
        created.createdBy = actor.name;
        created.creatorName = actor.name;
        created.createdByRole = actor.role;
        created.updatedBy = actor.name;
        created.createdAt ||= Date.now();
        created.updatedAt = Date.now();
        created.syncVersion = Date.now();
        created.ownership = { ...(created.ownership || {}), createdBy:actor.name, editedBy:actor.name };
        authorizedIncoming.push(created);
      }
    }
    if (hasProjects) d.cases = mergeCasesPreservingFreshest(d.cases || [], authorizedIncoming, d.deletedProjectIds || []);
    else d.cases = dedupeRenamedCases(filterDeletedCases(d.cases || [], d.deletedProjectIds || []), d.deletedProjectIds || []);
    d.users = sanitizePresenceUsers(d.users || []);
    d.payments = (d.payments || []).filter(Boolean);
    const ignoredFields = ['users','deletedProjectIds','chatMessages','teamChat','notifications','attendanceLogs','payments','audit']
      .filter(field => Object.prototype.hasOwnProperty.call(body, field));
    const changedCaseIds=authorizedIncoming
      .map(item=>findCaseByAnyId(d.cases || [], item.id || item.caseId))
      .filter(Boolean)
      .map(item=>String(item.id || item.caseId))
      .filter(Boolean);
    const persistence = hasProjects && changedCaseIds.length
      ? await save(d,{actor:actor.name,reason:'legacy_state_project_update',skipRevisionSnapshot:true,periodicRevisionSnapshot:true,collections:['cases'],collectionRowIds:{cases:[...new Set(changedCaseIds)]}})
      : { mode:'no-op', persisted:false, reason:'No project changes were supplied.' };
    const performanceRecords = mergePerformanceRecords(d.performanceRecords || [], buildPerformanceRecordsFromCases(d.cases || []));
    res.json({ok:true, database:USE_POSTGRES ? 'postgresql' : 'json-file', savedAt:now(), ignoredFields, deletedProjectIds:d.deletedProjectIds || [], performanceRecords, counts:{users:d.users.length, cases:d.cases.length, performanceRecords:performanceRecords.length, chatMessages:d.teamChat.length, notifications:d.notifications.length, attendanceLogs:d.attendanceLogs.length}, persistence});
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok:false, code:e.code || '', error:e.message || 'State save failed.', requestId:req.requestId || '' });
  }
});


app.post('/api/cases', requireAnyRole('ADMIN','MANAGER'), uploadAny, async (req,res)=>{
  let preparedUploads=[];
  let persistenceCommitted=false;
  let rollbackActor='system';
  let rollbackCaseId='';
  try {
    const d = db();
    const body = req.body || {};
    const actor = requestActor(req);
    rollbackActor=actor.name;
    let assignee = (d.users || []).find(user => String(user.id || '') === String(body.assigneeId || ''));
    if (!assignee) assignee = leastBusy(d);
    const manager = sanitizePresenceUsers(d.users).find(user => normalizeRole(user.role) === 'Manager');
    const recordedAt = Date.now();
    const todayTaskDate = indiaDateKey(recordedAt);
    const taskDate = normalizeTaskDate(body.taskDate || body.operationalDate || recordedAt, recordedAt);
    if (taskDate > todayTaskDate) {
      const error = new Error('Task date cannot be in the future.');
      error.statusCode = 400;
      error.code = 'TASK_DATE_IN_FUTURE';
      throw error;
    }
    const createdAt = taskDateTimestamp(taskDate, recordedAt);
    const taskAccountingPeriod = normalizeFinanceAccountingPeriod(taskDate, recordedAt);
    const serviceType = serviceTypes.includes(String(body.serviceType || '')) ? String(body.serviceType) : 'Other';
    const priority = ['Normal','High','Urgent'].includes(String(body.priority || '')) ? String(body.priority) : 'Normal';
    const city = textValue(body.city || 'Lucknow', 'City', 120, { required:true });
    const c = {
      id:nanoid(8),
      caseId:nextCaseNo(d, city),
      source:'Manual',
      createdByRole:actor.role,
      createdBy:actor.name,
      creatorName:actor.name,
      customerName:textValue(body.customerName || 'New Customer', 'Customer name', 200, { required:true }),
      customerPhone:textValue(body.customerPhone || '', 'Customer phone', 30),
      bankerName:textValue(body.bankerName || '', 'Banker name', 200),
      bank:textValue(body.bank || '', 'Bank', 200),
      branch:textValue(body.branch || '', 'Branch', 200),
      serviceType,
      otherDescription:textValue(body.otherDescription || '', 'Description', MAX_CASE_TEXT_LENGTH),
      city,
      propertyAddress:textValue(body.propertyAddress || '', 'Property address', MAX_CASE_TEXT_LENGTH),
      estimateAmount:numericValue(body.estimateAmount, 'Estimate amount', { min:0, max:100_000_000, fallback:0 }),
      priority,
      status:'ASSIGNED',
      assigneeId:assignee?.id,
      assigneeName:assignee?.name,
      assigneeRole:assignee?.role,
      assignedTo:assignee?.name || 'Unassigned',
      assignedBy:actor.name,
      assignedAt:Date.now(),
      assignmentVersion:Date.now(),
      managerId:manager?.id,
      managerName:manager?.name,
      taskDate,
      taskAccountingPeriod,
      createdAt,
      recordedAt,
      updatedAt:recordedAt,
      syncVersion:recordedAt,
      startedAt:null,
      completedAt:null,
      dueAt:textValue(body.dueAt || '', 'Due date', 100),
      paymentStatus:'PENDING',
      documents:[], comments:[], revisions:[], history:[{at:recordedAt,effectiveAt:createdAt,by:actor.name,action:taskDate === todayTaskDate ? 'Lead created and task assigned' : `Backdated lead created for ${taskDate} and task assigned`}], timeline:[],
      ownership:{ createdBy:actor.name, assignedBy:actor.name, assignedTo:assignee?.name || 'Unassigned' }
    };
    addCaseTimelineEvent(c, { type:'created', by:actor.name, at:createdAt, recordedAt, title:taskDate === todayTaskDate ? 'Case Created' : `Case Created for ${taskDate}`, remarks:`${c.caseId} created for ${c.customerName}${taskDate === todayTaskDate ? '' : ' as a backdated entry'}` });
    if (assignee) addCaseTimelineEvent(c, { type:'assigned', by:actor.name, at:createdAt, title:`Assigned to ${assignee.name}`, remarks:'Initial smart assignment' });
    preparedUploads=await prepareSecureUploads(req, 'SOURCE');
    for (const file of req.files || []) c.documents.push(addFileRegistryEntry(d, docPayload(file, actor.name, actor.role, 'SOURCE', c.id)));
    if ((req.files || []).length) addCaseTimelineEvent(c, { type:'source_uploaded', by:actor.name, title:`${req.files.length} source file(s) uploaded` });
    d.cases.unshift(c);
    rollbackCaseId=c.id;
    const notifications=[
      notifyRole(d,'ADMIN',`New case ${c.caseId} created by ${actor.name}`,'task',c.id),
      notifyRole(d,'MANAGER',`New case ${c.caseId} created by ${actor.name}`,'task',c.id),
      assignee ? notifyUser(d,assignee.name,`New task assigned: ${c.caseId}`,'task',c.id) : null
    ].filter(Boolean);
    const auditEntry=addAudit(d,actor.name,'Case created',c.caseId);
    await save(d, {
      actor:actor.name,
      reason:'case_create',
      collections:['cases','files','notifications','audit'],
      collectionRowIds:{
        cases:[String(c.id)],
        files:(c.documents || []).map(doc=>String(doc.id)).filter(Boolean),
        notifications:notifications.map(item=>String(item.id)).filter(Boolean),
        audit:[String(auditEntry.id)]
      }
    });
    persistenceCommitted=true;
    await Promise.all((c.documents || []).map(doc=>recordFileStorageEvent({fileId:doc.id,caseId:c.id,action:'FILE_UPLOADED',actor:actor.name,storageKey:doc.storageKey,sha256:doc.sha256,details:{purpose:doc.purpose,name:doc.name}})));
    res.status(201).json(c);
  } catch (error) {
    cleanupRequestTempUploads(req);
    if (!persistenceCommitted) rollbackPreparedUploads(preparedUploads,{reason:'CASE_CREATE_PERSISTENCE_FAILED',actor:rollbackActor,caseId:rollbackCaseId});
    if (error instanceof FileValidationError) return fileUploadFailure(res, error, 'Case file upload failed.');
    res.status(error.statusCode || 500).json({ ok:false, code:error.code || '', error:error.message || 'Case creation failed.' });
  }
});

app.post('/api/cases/:id/assign', requireAnyRole('ADMIN','MANAGER'), requireCaseAction('update'), async (req,res)=>{
  const d = requestDb(req);
  const c = req.caseRecord;
  const actor = requestActor(req);
  const assigneeId = textValue(req.body.assigneeId, 'Assignee', 200, { required:true });
  const user = (d.users || []).find(item => String(item.id || '') === assigneeId && normalizeAuthStatus(item.status || 'APPROVED') === 'APPROVED');
  if (!user) return res.status(400).json({ok:false,code:'ASSIGNEE_NOT_FOUND',error:'Assignee not found or inactive.'});
  c.assigneeId=user.id; c.assigneeName=user.name; c.assigneeRole=user.role; c.assignedTo=user.name; c.assignedBy=actor.name;
  c.status='ASSIGNED'; c.assignedAt=Date.now(); c.assignmentVersion=Date.now(); c.updatedAt=Date.now(); c.syncVersion=Date.now();
  c.ownership={...(c.ownership || {}),assignedTo:user.name,assignedBy:actor.name};
  c.history ||= []; c.history.unshift({at:now(),by:actor.name,action:`Assigned to ${user.name}`});
  addCaseTimelineEvent(c,{type:'assigned',by:actor.name,title:`Assigned to ${user.name}`,remarks:textValue(req.body.remarks || '', 'Remarks', MAX_TIMELINE_TEXT_LENGTH)});
  const notification=notifyUser(d,user.name,`Task assigned to you: ${c.caseId}`,'task',c.id);
  const auditEntry=addAudit(d,actor.name,'Task assigned',c.caseId);
  await save(d,{actor:actor.name,reason:'case_assign',collections:['cases','notifications','audit'],collectionRowIds:{cases:[String(c.id)],notifications:[String(notification.id)],audit:[String(auditEntry.id)]}}); res.json(c);
});

app.post('/api/cases/:id/start', requireCaseAction('start'), async (req,res)=>{
  const d=requestDb(req); const c=req.caseRecord; const actor=requestActor(req);
  c.status='IN_PROGRESS'; c.startedAt ||= now(); c.updatedAt=Date.now(); c.syncVersion=Date.now();
  c.history ||= []; c.history.unshift({at:now(),by:actor.name,action:'Work started'});
  addCaseTimelineEvent(c,{type:'started',by:actor.name,title:'Designer Started',remarks:textValue(req.body.remarks || '', 'Remarks', MAX_TIMELINE_TEXT_LENGTH)});
  await save(d,{actor:actor.name,reason:'case_start',collections:['cases'],collectionRowIds:{cases:[String(c.id)]}}); res.json(c);
});

app.post('/api/cases/:id/upload-source', requireAnyRole('ADMIN','MANAGER'), preauthorizeCaseAction('update'), uploadAny, requireCaseAction('update'), async (req,res)=>{
  let preparedUploads=[];
  let persistenceCommitted=false;
  try {
    const d=requestDb(req); const c=req.caseRecord; const actor=requestActor(req);
    preparedUploads=await prepareSecureUploads(req, 'SOURCE');
    if (!(req.files || []).length) return res.status(400).json({ok:false,code:'FILE_REQUIRED',error:'Select at least one source file.'});
    for(const file of req.files || []) c.documents.push(addFileRegistryEntry(d, docPayload(file,actor.name,actor.role,'SOURCE',c.id)));
    c.history ||= []; c.history.unshift({at:now(),by:actor.name,action:`Uploaded ${req.files?.length || 0} source file(s)`});
    addCaseTimelineEvent(c,{type:'source_uploaded',by:actor.name,title:`${req.files?.length || 0} source file(s) uploaded`});
    const notification=notifyUser(d,c.assigneeName,`New source files added for ${c.caseId}`,'task',c.id);
    const uploadedDocs=(req.files || []).map(file=>(c.documents || []).find(item=>item.storageKey===file.storageKey)).filter(Boolean);
    await save(d,{actor:actor.name,reason:'case_source_upload',collections:['cases','files','notifications'],collectionRowIds:{cases:[String(c.id)],files:uploadedDocs.map(doc=>String(doc.id)),notifications:[String(notification.id)]}});
    persistenceCommitted=true;
    await Promise.all((req.files || []).map(file=>{const doc=(c.documents || []).find(item=>item.storageKey===file.storageKey);return recordFileStorageEvent({fileId:doc?.id,caseId:c.id,action:'FILE_UPLOADED',actor:actor.name,storageKey:file.storageKey,sha256:file.sha256,details:{purpose:'SOURCE',name:file.originalname}});}));
    res.json(c);
  } catch (error) {
    cleanupRequestTempUploads(req);
    if (!persistenceCommitted) rollbackPreparedUploads(preparedUploads,{reason:'CASE_SOURCE_UPLOAD_PERSISTENCE_FAILED',actor:requestActor(req).name,caseId:req.caseRecord?.id || ''});
    if (error instanceof FileValidationError) return fileUploadFailure(res,error,'Source file upload failed.');
    res.status(error.statusCode || 500).json({ok:false,code:error.code || '',error:error.message || 'Source file upload failed.'});
  }
});

app.post('/api/cases/:id/upload-final', preauthorizeCaseAction('upload-final'), uploadAny, requireCaseAction('upload-final'), async (req,res)=>{
  let preparedUploads=[];
  let persistenceCommitted=false;
  try {
    const d=requestDb(req); const c=req.caseRecord; const actor=requestActor(req);
    const isRevision=String(req.body.isRevision || 'false') === 'true' || c.status === 'REOPENED_FOR_REVISION';
    preparedUploads=await prepareSecureUploads(req, isRevision ? 'REVISION_FINAL' : 'FINAL');
    if (!(req.files || []).length) return res.status(400).json({ok:false,code:'FILE_REQUIRED',error:'Select at least one completed file.'});
    for(const file of req.files || []) {
      const doc=addFileRegistryEntry(d, docPayload(file,actor.name,actor.role,isRevision?'REVISION_FINAL':'FINAL',c.id));
      doc.type=isRevision?'Revised File':'Completed File'; doc.folder=isRevision?'revised-completed':'completed'; c.documents.push(doc);
    }
    c.status='MANAGER_REVIEW'; c.updatedAt=Date.now(); c.syncVersion=Date.now();
    c.history ||= []; c.history.unshift({at:now(),by:actor.name,action:isRevision?'Revised file uploaded':'Completed file uploaded for manager review'});
    addCaseTimelineEvent(c,{type:isRevision?'revision_uploaded':'completion_uploaded',by:actor.name,title:isRevision?'Revision Completion Uploaded':'Completion Uploaded',remarks:`${req.files?.length || 0} file(s) uploaded`});
    addCaseTimelineEvent(c,{type:'internal_review',by:'System',title:'Internal Review Pending',remarks:'Completion is awaiting manager review'});
    const notifications=[
      notifyRole(d,'MANAGER',`${isRevision?'Revised':'Completed'} file uploaded: ${c.caseId}`,'completed',c.id),
      notifyRole(d,'ADMIN',`${isRevision?'Revised':'Completed'} file uploaded: ${c.caseId}`,'completed',c.id)
    ];
    const auditEntry=addAudit(d,actor.name,'Final upload',c.caseId);
    const uploadedDocs=(req.files || []).map(file=>(c.documents || []).find(item=>item.storageKey===file.storageKey)).filter(Boolean);
    await save(d,{actor:actor.name,reason:isRevision?'case_revision_final_upload':'case_final_upload',collections:['cases','files','notifications','audit'],collectionRowIds:{cases:[String(c.id)],files:uploadedDocs.map(doc=>String(doc.id)),notifications:notifications.map(item=>String(item.id)),audit:[String(auditEntry.id)]}});
    persistenceCommitted=true;
    await Promise.all((req.files || []).map(file=>{const doc=(c.documents || []).find(item=>item.storageKey===file.storageKey);return recordFileStorageEvent({fileId:doc?.id,caseId:c.id,action:'FILE_UPLOADED',actor:actor.name,storageKey:file.storageKey,sha256:file.sha256,details:{purpose:isRevision?'REVISION_FINAL':'FINAL',name:file.originalname}});}));
    res.json(c);
  } catch (error) {
    cleanupRequestTempUploads(req);
    if (!persistenceCommitted) rollbackPreparedUploads(preparedUploads,{reason:'CASE_FINAL_UPLOAD_PERSISTENCE_FAILED',actor:requestActor(req).name,caseId:req.caseRecord?.id || ''});
    if (error instanceof FileValidationError) return fileUploadFailure(res,error,'Completed file upload failed.');
    res.status(error.statusCode || 500).json({ok:false,code:error.code || '',error:error.message || 'Completed file upload failed.'});
  }
});

app.post('/api/cases/:id/manager-complete', requireAnyRole('ADMIN','MANAGER'), requireCaseAction('review'), async (req,res)=>{
  const d=requestDb(req); const c=req.caseRecord; const actor=requestActor(req);
  c.status='COMPLETED'; c.completedAt=now(); c.updatedAt=Date.now(); c.syncVersion=Date.now();
  c.history ||= []; c.history.unshift({at:now(),by:actor.name,action:'Reviewed by manager and marked complete'});
  addCaseTimelineEvent(c,{type:'approved',by:actor.name,title:'Approved',remarks:'Reviewed by manager and marked complete'});
  const notifications=[
    notifyRole(d,'ADMIN',`Case completed after manager review: ${c.caseId}`,'completed',c.id),
    notifyUser(d,c.assigneeName,`Case marked complete: ${c.caseId}`,'completed',c.id)
  ];
  const auditEntry=addAudit(d,actor.name,'Case completed',c.caseId);
  await save(d,{actor:actor.name,reason:'case_manager_complete',collections:['cases','notifications','audit'],collectionRowIds:{cases:[String(c.id)],notifications:notifications.map(item=>String(item.id)),audit:[String(auditEntry.id)]}}); res.json(c);
});

app.post('/api/cases/:id/revision', requireAnyRole('ADMIN','MANAGER'), requireCaseAction('revision'), async (req,res)=>{
  const d=requestDb(req); const c=req.caseRecord; const actor=requestActor(req);
  c.status='REOPENED_FOR_REVISION'; c.priority='Urgent'; c.updatedAt=Date.now(); c.syncVersion=Date.now();
  const rev={id:nanoid(8),note:textValue(req.body.note || 'Banker revision requested','Revision note',MAX_TIMELINE_TEXT_LENGTH,{required:true}),by:actor.name,createdAt:now()};
  c.revisions ||= []; c.revisions.unshift(rev); c.history ||= []; c.history.unshift({at:now(),by:actor.name,action:'Revision opened as urgent'});
  addCaseTimelineEvent(c,{type:'revision_created',by:actor.name,at:rev.createdAt,title:'Revision Created',remarks:rev.note});
  const notifications=[
    notifyUser(d,c.assigneeName,`URGENT revision task: ${c.caseId} - ${rev.note}`,'task',c.id),
    notifyRole(d,'MANAGER',`URGENT revision opened: ${c.caseId}`,'task',c.id)
  ];
  await save(d,{actor:actor.name,reason:'case_revision_open',collections:['cases','notifications'],collectionRowIds:{cases:[String(c.id)],notifications:notifications.map(item=>String(item.id))}}); res.json(c);
});

app.get('/api/cases/:id/timeline', requireCaseAction('read'), async (req,res)=>{
  const c=req.caseRecord; c.timeline=normalizeCaseTimeline(c);
  res.json({ok:true,caseId:c.id,caseNo:c.caseId,timeline:c.timeline});
});

app.post('/api/cases/:id/timeline', requireCaseAction('timeline'), async (req,res)=>{
  const d=requestDb(req); const c=req.caseRecord; const actor=requestActor(req);
  const event=addCaseTimelineEvent(c,{
    type:textValue(req.body.type || 'manual','Event type',100),
    by:actor.name,
    title:textValue(req.body.title || req.body.text || 'Timeline Event','Timeline title',MAX_TIMELINE_TEXT_LENGTH,{required:true}),
    remarks:textValue(req.body.remarks || req.body.note || '','Timeline remarks',MAX_TIMELINE_TEXT_LENGTH),
    meta:req.body.meta && typeof req.body.meta === 'object' ? req.body.meta : {}
  });
  const auditEntry=addAudit(d,actor.name,'Timeline event added',c.caseId);
  await save(d,{actor:actor.name,reason:'case_timeline_add',collections:['cases','audit'],collectionRowIds:{cases:[String(c.id)],audit:[String(auditEntry.id)]}});
  res.json({ok:true,event,timeline:c.timeline,case:c});
});

app.post('/api/state/projects/:id/payment-status', async (req, res) => {
  if (!isFinanceAdminRequest(req)) return denyFinanceAccess(res);
  try {
    const d = db();
    const c = findCaseByAnyId(d.cases || [], req.params.id);
    if (!c) return res.status(404).json({ ok:false, error:'Case not found' });
    assertExpectedFinanceVersion(c, req.body || {});
    const previousSnapshot = buildFinanceSnapshot(c);
    const status = normalizePaymentTrackingStatus(req.body.paymentTrackingStatus || req.body.status || req.body.paymentStatus);
    const actor = requestActor(req);
    const updated = upsertInlinePaymentLedger(d, c, status, { ...(req.body || {}), by:actor.name, updatedBy:actor.name });
    updated.updatedAt = Date.now();
    updated.syncVersion = Date.now();
    const nextSnapshot = buildFinanceSnapshot(updated);
    const auditEntry=d.audit?.[0];
    const changedPaymentId=String(updated.ledger?.financeLedgerId || '').trim();
    const changedPayment=changedPaymentId ? (d.payments || []).find(item=>String(item.id || '')===changedPaymentId) : null;
    const collections=['cases','audit'];
    const collectionRowIds={cases:[String(updated.id || updated.caseId)],audit:auditEntry?.id ? [String(auditEntry.id)] : []};
    if (changedPayment) { collections.push('payments'); collectionRowIds.payments=[changedPaymentId]; }
    const persistence = await save(d, {
      actor:actor.name,
      reason:'finance_payment_status_update',
      collections,
      collectionRowIds,
      financeEvent: {
        caseId: String(updated.id || updated.caseId || req.params.id),
        caseNo: updated.caseId || updated.id || '',
        action: `Payment status changed to ${updated.paymentTrackingStatus || status}`,
        actor: actor.name,
        previousSnapshot,
        nextSnapshot
      }
    });
    res.json({ ok:true, project:updated, case:updated, payment:changedPayment || null, financeVersion:updated.financeVersion, persistence });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok:false, code:e.code || '', error:e.message || 'Payment status update failed' });
  }
});

app.post('/api/cases/:id/payment', async (req,res)=>{
  if (!isFinanceAdminRequest(req)) return denyFinanceAccess(res);
  try {
    const d=db();
    const c=findCaseByAnyId(d.cases || [], req.params.id);
    if(!c) return res.status(404).json({ok:false,error:'Case not found'});
    assertExpectedFinanceVersion(c, req.body || {});
    const previousSnapshot = buildFinanceSnapshot(c);
    const previousStatus = normalizePaymentTrackingStatus(c.paymentTrackingStatus || c.paymentStatus || c.paymentReceived || c.ledger?.status || '');
    const previousAmount = nonNegativeFinanceNumber(c.ledger?.amountIn ?? c.paymentAmountIn, 0);
    const previousExpenses = nonNegativeFinanceNumber(c.ledger?.expenses, 0);
    const previousRefund = nonNegativeFinanceNumber(c.ledger?.refund ?? c.refundAmount, 0);
    const received=String(req.body.paymentReceived||'').toUpperCase();
    if(!['YES','NO','PARTIAL','REFUND'].includes(received)) return res.status(400).json({ok:false,error:'paymentReceived is mandatory: YES, NO, PARTIAL or REFUND'});
    const nowIso = now();
    const actor = requestActor(req);
    const paymentDate=textValue(req.body.paymentDate||indiaDateKey(nowIso),'Payment date',20);
    const accountingPeriod=getCaseTaskAccountingPeriod(c, req.body.accountingPeriod || paymentDate || nowIso);
    const paymentAmount=numericValue(req.body.paymentAmountIn,'Payment amount',{min:0,max:100_000_000,fallback:0});
    const expenses=hasOwnFinanceValue(req.body,'expenses')
      ? numericValue(req.body.expenses,'Expenses',{min:0,max:100_000_000,fallback:previousExpenses})
      : previousExpenses;
    const refund=hasOwnFinanceValue(req.body,'refundAmount','refund')
      ? numericValue(req.body.refundAmount ?? req.body.refund,'Refund amount',{min:0,max:100_000_000,fallback:previousRefund})
      : previousRefund;
    const p={
      id:nanoid(8),
      caseId:c.id,
      caseNo:c.caseId,
      location:c.city || c.location || '',
      bankerName:c.bankerName,
      bank:c.bank || c.client || '',
      branch:c.branch,
      paymentReceived:received,
      paymentAmountIn:paymentAmount,
      expenses,
      refundAmount:refund,
      paymentDate,
      accountingPeriod,
      paymentTime:textValue(req.body.paymentTime||new Date().toTimeString().slice(0,5),'Payment time',20),
      payerName:textValue(req.body.payerName||'','Payer name',200),
      transactionId:textValue(req.body.transactionId||'','Transaction ID',200),
      mode:textValue(req.body.mode||'','Payment mode',100),
      note:textValue(req.body.note||'','Payment note',MAX_TIMELINE_TEXT_LENGTH),
      createdAt:nowIso,
      createdBy:actor.name,
      updatedAt:nowIso,
      updatedBy:actor.name
    };
    d.payments = mergePaymentRecords(d.payments || [], [p]);
    c.financeVersion = Number(c.financeVersion || 0) + 1;
    const nextTrackingStatus=normalizePaymentTrackingStatus(received);
    Object.assign(c,{
      financeAccountingPeriod:accountingPeriod,
      paymentTrackingStatus:nextTrackingStatus,
      paymentTrackingUpdatedAt:Date.now(),
      paymentTrackingUpdatedBy:p.createdBy,
      paymentStatus:received,
      paymentReceived:received,
      paymentAmountIn:p.paymentAmountIn,
      refundAmount:p.refundAmount,
      payerName:p.payerName,
      transactionId:p.transactionId,
      paymentDate:p.paymentDate,
      paymentTime:p.paymentTime,
      ledger:{
        ...(c.ledger || {}),
        amountIn:p.paymentAmountIn,
        expenses:p.expenses,
        refund:p.refundAmount,
        date:p.paymentDate,
        accountingPeriod,
        mode:p.mode,
        txnId:p.transactionId,
        status:nextTrackingStatus,
        paymentStatus:nextTrackingStatus,
        updatedAt:Date.now(),
        updatedBy:p.createdBy,
        financeVersion:c.financeVersion
      }
    });
    c.paymentAuditTrail ||= [];
    c.paymentAuditTrail.unshift({
      id:nanoid(8),
      at:nowIso,
      paymentDate:p.paymentDate,
      accountingPeriod,
      by:p.createdBy,
      action:'Payment ledger updated',
      oldStatus:previousStatus,
      newStatus:c.paymentTrackingStatus,
      oldAmount:previousAmount,
      newAmount:p.paymentAmountIn,
      oldExpenses:previousExpenses,
      newExpenses:p.expenses,
      oldRefund:previousRefund,
      newRefund:p.refundAmount,
      note:p.note
    });
    c.history ||= [];
    c.history.unshift({at:nowIso,by:p.createdBy,action:`Payment ledger updated for ${accountingPeriod}: ${received}`});
    const auditEntry=addAudit(d,p.createdBy,`Payment ledger updated for ${accountingPeriod}`,c.caseId);
    const nextSnapshot = buildFinanceSnapshot(c);
    const persistence = await save(d, {
      actor:p.createdBy,
      reason:'finance_payment_ledger_update',
      collections:['cases','payments','audit'],
      collectionRowIds:{cases:[String(c.id || c.caseId)],payments:[String(p.id)],audit:[String(auditEntry.id)]},
      financeEvent:{caseId:String(c.id || c.caseId),caseNo:c.caseId || c.id || '',action:`Payment ledger updated for ${accountingPeriod}: ${received}`,actor:p.createdBy,previousSnapshot,nextSnapshot}
    });
    res.json({ok:true,payment:p,project:c,case:c,financeVersion:c.financeVersion,persistence});
  } catch (e) {
    res.status(e.statusCode || 500).json({ok:false,code:e.code || '',error:e.message || 'Payment ledger update failed'});
  }
});


app.get('/api/finance/history/:id', async (req, res) => {
  if (!isFinanceAdminRequest(req)) return denyFinanceAccess(res);
  try {
    const d = readDb();
    const c = findCaseByAnyId(d.cases || [], req.params.id);
    const caseId = String(c?.id || req.params.id || '');
    const caseNo = String(c?.caseId || req.params.id || '');
    if (USE_POSTGRES) {
      await ensurePostgres();
      const result = await pool.query(
        `SELECT id, case_id, case_no, action, actor, state_version, previous_snapshot, next_snapshot, snapshot_hash, created_at
         FROM finance_history
         WHERE case_id = $1 OR case_no = $2
         ORDER BY created_at DESC
         LIMIT 200`,
        [caseId, caseNo]
      );
      return res.json({ ok:true, caseId, caseNo, history:result.rows });
    }
    return res.json({ ok:true, caseId, caseNo, history:(c?.paymentAuditTrail || []).map((event, index) => ({ id:event.id || index, action:event.action || 'Finance updated', actor:event.by || '', created_at:event.at || event.time || '', state_version:null, next_snapshot:buildFinanceSnapshot(c) })) });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok:false, code:e.code || '', error:e.message || 'Finance history could not be loaded.' });
  }
});

app.get('/api/finance/health', async (req, res) => {
  if (!isFinanceAdminRequest(req)) return denyFinanceAccess(res);
  try {
    const d = readDb();
    const financeCases = (d.cases || []).filter(c => financeFreshness(c) > 0);
    const latestFinanceAt = Math.max(0, ...financeCases.map(financeFreshness));
    let historyCount = 0;
    let latestHistoryAt = null;
    if (USE_POSTGRES) {
      await ensurePostgres();
      const result = await pool.query('SELECT count(*)::int AS count, max(created_at) AS latest_at FROM finance_history');
      historyCount = Number(result.rows[0]?.count || 0);
      latestHistoryAt = result.rows[0]?.latest_at || null;
    }
    res.json({ ok:true, database:USE_POSTGRES ? 'postgresql' : 'json-file', stateVersion, financeCases:financeCases.length, paymentRecords:(d.payments || []).filter(Boolean).length, latestFinanceAt:latestFinanceAt || null, historyCount, latestHistoryAt, durableWrites:true, staleFinanceProtection:true });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message || 'Finance health check failed.' });
  }
});


app.post('/api/profile/photo', uploadSingle('photo'), async (req, res) => {
  let preparedUploads=[];
  let persistenceCommitted=false;
  let rollbackActor='system';
  try {
    if (!req.file) return res.status(400).json({ ok:false, code:'FILE_REQUIRED', error:'No photo uploaded.' });
    if (Number(req.file.size || 0) > 5 * 1024 * 1024) { cleanupRequestTempUploads(req); return res.status(413).json({ok:false,code:'PROFILE_PHOTO_TOO_LARGE',error:'Profile photos must be no larger than 5 MB.'}); }
    const d = db();
    const actor = requestActor(req);
    rollbackActor=actor.name;
    const user = findStateUserByIdOrUsername(actor.id, actor.username, d);
    if (!user) { cleanupRequestTempUploads(req); return res.status(404).json({ ok:false, error:'Signed-in user record was not found.' }); }
    req.files=[req.file];
    preparedUploads=await prepareSecureUploads(req,'PROFILE',{imagesOnly:true});
    const previousKey = user.profilePhotoStorageKey || user.profilePhotoFile || '';
    const profilePhoto = `/api/profile/photo/${encodeURIComponent(user.id || user.username)}`;
    user.profilePhoto = profilePhoto;
    user.profilePhotoFile = req.file.storageKey;
    user.profilePhotoStorageKey = req.file.storageKey;
    user.profilePhotoSha256 = req.file.sha256;
    user.profilePhotoMime = req.file.mimetype;
    user.profilePhotoOriginalName = req.file.originalname;
    user.profileUpdatedAt = Date.now();
    user.profilePhotoUpdatedAt = Date.now();
    await save(d, { actor:actor.name, reason:'profile_photo_update', collections:['users'], collectionRowIds:{users:[String(user.id)]} });
    persistenceCommitted=true;
    if (previousKey && previousKey !== req.file.storageKey) {
      // Content-addressed objects can be shared by profile photos and task
      // attachments. Immediate physical deletion has a race with another
      // upload that has validated the same hash but has not committed its row
      // yet. Keep the private object for a later grace-period garbage-collection
      // pass; the old profile URL is already unreachable after the row commit.
      await recordFileStorageEvent({
        action:'PROFILE_PHOTO_REPLACED',
        actor:actor.name,
        storageKey:previousKey,
        details:{ userId:user.id, physicalAction:'retained-for-safe-gc' }
      });
    }
    res.json({ ok:true, profilePhoto, url:profilePhoto, storedName:path.basename(req.file.storageKey), storageKey:req.file.storageKey, sha256:req.file.sha256, updated:true });
  } catch (error) {
    cleanupRequestTempUploads(req);
    if (!persistenceCommitted) rollbackPreparedUploads(preparedUploads,{reason:'PROFILE_PHOTO_PERSISTENCE_FAILED',actor:rollbackActor});
    if (error instanceof FileValidationError) return fileUploadFailure(res,error,'Profile photo upload failed.');
    res.status(error.statusCode || 500).json({ ok:false, code:error.code || '', error:error.message || 'Profile photo upload failed' });
  }
});

app.post('/api/files/upload', uploadAny, async (req, res) => {
  let preparedUploads=[];
  let persistenceCommitted=false;
  let rollbackActor='system';
  let rollbackCaseId='';
  try {
    const incomingFiles = req.files || [];
    if (!incomingFiles.length) return res.status(400).json({ ok:false, code:'FILE_REQUIRED', error:'No file uploaded.' });
    if (incomingFiles.length !== 1) { cleanupRequestTempUploads(req); return res.status(400).json({ok:false,code:'SINGLE_FILE_REQUIRED',error:'This endpoint accepts one file at a time.'}); }
    const d = db();
    const actor = requestActor(req);
    rollbackActor=actor.name;
    const type = String(req.body.type || 'source').toLowerCase();
    const allowedTypes = new Set(['source','working','completed','chat']);
    if (!allowedTypes.has(type)) { cleanupRequestTempUploads(req); return res.status(400).json({ok:false,code:'FILE_PURPOSE_INVALID',error:'Invalid file purpose.'}); }
    const projectId = textValue(req.body.projectId || req.body.caseId || '', 'Project id', 200);
    rollbackCaseId=projectId;
    const caseRecord = projectId ? findCaseByAnyId(d.cases || [], projectId) : null;
    if (projectId && !caseRecord) { cleanupRequestTempUploads(req); return res.status(404).json({ ok:false, code:'CASE_NOT_FOUND', error:'The target task was not found.' }); }
    if (type === 'source') {
      if (!['ADMIN','MANAGER'].includes(actor.role)) { cleanupRequestTempUploads(req); return authorizationDenied(req, res, 'SOURCE_UPLOAD_FORBIDDEN', 'Only Admins and Managers can upload source files.'); }
    } else if (projectId && !canMutateCase(req.auth?.user || {}, caseRecord, type === 'completed' ? 'upload-final' : 'upload-working')) {
      cleanupRequestTempUploads(req);
      return authorizationDenied(req, res, 'FILE_UPLOAD_FORBIDDEN', 'You cannot upload files to this task.');
    } else if (!projectId && type !== 'chat' && !['ADMIN','MANAGER'].includes(actor.role)) {
      cleanupRequestTempUploads(req);
      return authorizationDenied(req, res, 'UNSCOPED_UPLOAD_FORBIDDEN', 'A task reference is required for this upload.');
    }
    const purpose = type === 'completed' ? 'FINAL' : (type === 'working' ? 'WORKING' : (type === 'chat' ? 'CHAT' : 'SOURCE'));
    preparedUploads=await prepareSecureUploads(req,purpose);
    const file = docPayload(req.file, actor.name, actor.role, purpose, projectId);
    file.type = type;
    file.folder = type;
    if (type === 'chat') {
      file.chatScope = String(req.body.chatScope || 'PRIVATE').toUpperCase() === 'GLOBAL' ? 'GLOBAL' : 'PRIVATE';
      file.chatParticipants = [actor.id,actor.username,actor.name,req.body.recipientId,req.body.recipientUsername,req.body.recipient]
        .map(value=>String(value || '').trim().toLowerCase()).filter(Boolean);
    }
    addFileRegistryEntry(d, file);
    await save(d, {
      actor:actor.name,
      reason:'file_upload',
      skipRevisionSnapshot:true,
      periodicRevisionSnapshot:true,
      collections:['files'],
      collectionRowIds:{ files:[String(file.id)] }
    });
    persistenceCommitted=true;
    await recordFileStorageEvent({fileId:file.id,caseId:projectId,action:'FILE_UPLOADED',actor:actor.name,storageKey:file.storageKey,sha256:file.sha256,details:{purpose,name:file.name}});
    res.status(201).json({ ok:true, file });
  } catch (error) {
    cleanupRequestTempUploads(req);
    if (!persistenceCommitted) rollbackPreparedUploads(preparedUploads,{reason:'FILE_REGISTRY_PERSISTENCE_FAILED',actor:rollbackActor,caseId:rollbackCaseId});
    if (error instanceof FileValidationError) return fileUploadFailure(res,error,'File upload failed.');
    res.status(error.statusCode || 500).json({ ok:false, code:error.code || '', error:error.message || 'File upload failed.' });
  }
});

app.get('/api/files/:id',async (req,res)=>{
  const mode = String(req.query.mode || '').toLowerCase();
  if(mode !== 'preview' && mode !== 'download') {
    return res.status(400).json({ ok:false, error:'Use ?mode=preview or ?mode=download' });
  }
  const { doc, resolved, denied } = resolveAuthorizedFile(req, res, req.params.id);
  if (denied) return;
  if(!doc) return res.status(404).send('File record not found. It may be an older unsaved upload. Please refresh the page or re-upload the file.');
  if(!resolved) return res.status(410).send('File unavailable on server. The record exists, but the physical file is missing. Please re-upload this file once.');
  const { stored, fp } = resolved;
  if(!isResolvedStoragePathAllowed(fp)) return res.status(400).send('Invalid file path');
  const fileName = doc.name || doc.fileName || stored;
  const mime = String(doc.mime || doc.mimeType || '').toLowerCase();
  const lowerName = String(fileName || '').toLowerCase();
  const isPdf = /\.pdf$/i.test(fileName) || mime.includes('pdf');
  const imageMimeByExt = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') ? 'image/jpeg'
    : lowerName.endsWith('.png') ? 'image/png'
    : lowerName.endsWith('.gif') ? 'image/gif'
    : lowerName.endsWith('.webp') ? 'image/webp'
    : lowerName.endsWith('.bmp') ? 'image/bmp'
    : '';
  const isImage = mime.startsWith('image/') || Boolean(imageMimeByExt);
  if(mode === 'preview' && !isPdf && !isImage) return res.status(415).send('Preview is available for PDF and image files only.');
  const fileSize = fs.statSync(fp).size;
  res.setHeader('Access-Control-Expose-Headers','Content-Disposition, Content-Length, Content-Type, Accept-Ranges');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (mode === 'preview') res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'");
  res.setHeader('Content-Length', String(fileSize));
  if(isPdf) res.type('application/pdf');
  else if(isImage) res.type(mime.startsWith('image/') ? mime : imageMimeByExt || 'application/octet-stream');
  else if(doc.mime || doc.mimeType) res.type(doc.mime || doc.mimeType);
  res.setHeader('Content-Disposition', `${mode === 'preview' ? 'inline' : 'attachment'}; filename="${safeHeaderFileName(fileName)}"`);
  return res.sendFile(fp);
});
app.get('/api/files/:id/status',async (req,res)=>{
  const { doc, resolved, denied } = resolveAuthorizedFile(req, res, req.params.id);
  if (denied) return;
  res.json({
    ok: true,
    found: !!doc,
    available: !!resolved,
    id: req.params.id,
    name: doc?.name || doc?.fileName || doc?.storedName || '',
    previewUrl: doc ? `/api/files/${doc.id || req.params.id}/preview` : '',
    previewDataUrl: doc ? `/api/files/${doc.id || req.params.id}/preview-data` : '',
    downloadUrl: doc ? `/api/files/${doc.id || req.params.id}/download` : ''
  });
});

app.get('/api/files/:id/preview-data',async (req,res)=>{
  const { doc, resolved, denied } = resolveAuthorizedFile(req, res, req.params.id);
  if (denied) return;
  if(!doc) return res.status(404).json({ ok:false, error:'File record not found. Please refresh the page or re-upload the file.' });
  if(!resolved) return res.status(410).json({ ok:false, error:'File unavailable on server. Please re-upload this file once.' });
  const { stored, fp } = resolved;
  if(!isResolvedStoragePathAllowed(fp)) return res.status(400).json({ ok:false, error:'Invalid file path' });
  const fileName = doc.name || doc.fileName || stored;
  const mime = String(doc.mime || doc.mimeType || '').toLowerCase();
  const lowerName = String(fileName || '').toLowerCase();
  const isPdf = /\.pdf$/i.test(fileName) || mime.includes('pdf');
  const imageMimeByExt = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') ? 'image/jpeg'
    : lowerName.endsWith('.png') ? 'image/png'
    : lowerName.endsWith('.gif') ? 'image/gif'
    : lowerName.endsWith('.webp') ? 'image/webp'
    : lowerName.endsWith('.bmp') ? 'image/bmp'
    : '';
  const isImage = mime.startsWith('image/') || Boolean(imageMimeByExt);
  if(!isPdf && !isImage) return res.status(415).json({ ok:false, error:'Preview is available for PDF and image files only.' });
  const stat = fs.statSync(fp);
  if (stat.size > MAX_INLINE_PREVIEW_BYTES) return res.status(413).json({ok:false,code:'INLINE_PREVIEW_TOO_LARGE',error:`Inline preview data is limited to ${MAX_INLINE_PREVIEW_MB} MB. Use the streamed preview or download instead.`});
  const mimeType = isPdf ? 'application/pdf' : (mime.startsWith('image/') ? mime : imageMimeByExt || 'application/octet-stream');
  const base64 = fs.readFileSync(fp).toString('base64');
  res.setHeader('Cache-Control','private, no-store, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.json({ ok:true, id: doc.id || req.params.id, name: fileName, kind: isPdf ? 'pdf' : 'image', mimeType, size: stat.size, dataUrl: `data:${mimeType};base64,${base64}` });
});

app.get('/api/files/:id/preview',async (req,res)=>{
  const { doc, resolved, denied } = resolveAuthorizedFile(req, res, req.params.id);
  if (denied) return;
  if(!doc) {
    return res.status(404).send('File record not found. It may be an older unsaved upload. Please refresh the page or re-upload the file.');
  }
  if(!resolved) {
    return res.status(410).send('File unavailable on server. The record exists, but the physical file is missing. Please re-upload this file once.');
  }
  const { stored, fp } = resolved;
  if(!isResolvedStoragePathAllowed(fp)) return res.status(400).send('Invalid file path');
  const fileName = doc.name || doc.fileName || stored;
  const mime = String(doc.mime || doc.mimeType || '').toLowerCase();
  const lowerName = String(fileName || '').toLowerCase();
  const isPdf = /\.pdf$/i.test(fileName) || mime.includes('pdf');
  const imageMimeByExt = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') ? 'image/jpeg'
    : lowerName.endsWith('.png') ? 'image/png'
    : lowerName.endsWith('.gif') ? 'image/gif'
    : lowerName.endsWith('.webp') ? 'image/webp'
    : lowerName.endsWith('.bmp') ? 'image/bmp'
    : '';
  const isImage = mime.startsWith('image/') || Boolean(imageMimeByExt);
  if(!isPdf && !isImage) return res.status(415).send('Preview is available for PDF and image files only.');
  const fileSize = fs.statSync(fp).size;
  res.setHeader('Access-Control-Expose-Headers','Content-Disposition, Content-Length, Content-Type');
  res.setHeader('Cache-Control','private, no-store, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Type', isPdf ? 'application/pdf' : (mime.startsWith('image/') ? mime : imageMimeByExt || 'application/octet-stream'));
  res.setHeader('Content-Length', String(fileSize));
  res.setHeader('Content-Disposition', `inline; filename="${safeHeaderFileName(fileName)}"`);
  return res.sendFile(fp);
});
app.get('/api/files/:id/download',async (req,res)=>{
  const { doc, resolved, denied } = resolveAuthorizedFile(req, res, req.params.id);
  if (denied) return;
  if(!doc) {
    return res.status(404).send('File record not found. It may be an older unsaved upload. Please refresh the page or re-upload the file.');
  }
  if(!resolved) {
    return res.status(410).send('File unavailable on server. The record exists, but the physical file is missing. Please re-upload this file once.');
  }
  const { stored, fp } = resolved;
  if(!isResolvedStoragePathAllowed(fp)) return res.status(400).send('Invalid file path');
  res.setHeader('Access-Control-Expose-Headers','Content-Disposition, Content-Length, Content-Type');
  res.setHeader('Cache-Control','private, no-store, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options','nosniff');
  const fileSize = fs.statSync(fp).size;
  const fileName = doc.name || doc.fileName || stored;
  res.setHeader('Content-Length', String(fileSize));
  if (/\.pdf$/i.test(fileName) || String(doc.mime || doc.mimeType || '').toLowerCase().includes('pdf')) res.type('application/pdf');
  else if (doc.mime || doc.mimeType) res.type(doc.mime || doc.mimeType);
  res.download(fp, safeHeaderFileName(fileName));
});

app.delete('/api/files/:id',async (req,res)=>{
  try {
    const d=db();
    const target = resolveFileById(d, req.params.id).doc;
    if (!target) return res.status(404).json({ ok:false, code:'FILE_NOT_FOUND', error:'File record not found.' });
    if (!canDeleteFileDocument(req.auth?.user || {}, target, d.cases || [])) return authorizationDenied(req, res, 'FILE_DELETE_FORBIDDEN', 'You cannot delete this file.');
    const actor = requestActor(req);
    const targetId=String(target.id || req.params.id);
    const targetKey=String(target.storageKey || target.storedName || target.stored_name || '');
    const matches = doc => String(doc?.id || '') === targetId;
    let removed=false;
    const changedCaseIds=[];
    const changedMessageIds=[];

    for (const c of d.cases || []) {
      const fields=['documents','completedFiles','sourceFiles','workFiles','files'];
      let changed=false;
      for (const field of fields) {
        const before=Array.isArray(c[field]) ? c[field] : [];
        const after=before.filter(doc=>!matches(doc));
        if (after.length!==before.length) { c[field]=after; changed=true; removed=true; }
      }
      if (changed) {
        if (c.id || c.caseId) changedCaseIds.push(String(c.id || c.caseId));
        c.history ||= [];
        c.history.unshift({ at: now(), by: actor.name, action: `File deleted: ${target.name || targetId}` });
        addCaseTimelineEvent(c,{type:'file_deleted',by:actor.name,title:'File deleted',remarks:target.name || targetId});
      }
    }

    for (const message of d.teamChat || []) {
      let messageChanged=false;
      for (const field of ['files','attachments']) {
        const before=Array.isArray(message[field]) ? message[field] : [];
        const after=before.filter(doc=>!matches(doc));
        if (after.length!==before.length) { message[field]=after; removed=true; messageChanged=true; }
      }
      if (message.file && matches(message.file)) { delete message.file; removed=true; messageChanged=true; }
      if (messageChanged && message.id) changedMessageIds.push(String(message.id));
    }

    d.files ||= [];
    let registry=d.files.find(doc=>String(doc?.id || '')===targetId);
    if (!registry) { registry={...target,id:targetId}; d.files.unshift(registry); }
    Object.assign(registry,{
      storageStatus:'DELETED',
      deletedAt:now(),
      deletedBy:actor.name,
      deletedByRole:actor.role,
      deleteReason:textValue(req.body?.reason || 'Deleted by authorised user','Delete reason',500),
      url:'',previewUrl:'',downloadUrl:''
    });
    removed=true;

    const activeSameObject=targetKey && d.files.some(doc=>String(doc?.id || '')!==targetId
      && String(doc?.storageStatus || '').toUpperCase()!=='DELETED'
      && String(doc?.storageKey || doc?.storedName || '')===targetKey);
    const auditEntry=addAudit(d,actor.name,'File deleted',`${targetId}:${target.name || ''}`);
    if (removed) {
      const collections=['files','audit'];
      const collectionRowIds={files:[targetId],audit:[String(auditEntry.id)]};
      if (changedCaseIds.length) { collections.push('cases'); collectionRowIds.cases=[...new Set(changedCaseIds)]; }
      if (changedMessageIds.length) { collections.push('teamChat'); collectionRowIds.teamChat=[...new Set(changedMessageIds)]; }
      await save(d,{actor:actor.name,reason:'file_delete',collections,collectionRowIds});
    }

    // Commit the logical deletion first. Content-addressed objects are kept
    // private for a later grace-period garbage-collection pass. Moving an
    // object immediately is unsafe: another concurrent upload may have already
    // deduplicated to the same hash but not yet committed its database row.
    // Logical deletion removes every authorised route to this file immediately.
    const physicalAction = targetKey
      ? (activeSameObject ? 'retained-shared-object' : 'retained-for-safe-gc')
      : 'no-storage-object';
    const physicalError='';
    await recordFileStorageEvent({fileId:targetId,caseId:target.caseId || '',action:'FILE_DELETED',actor:actor.name,storageKey:targetKey,sha256:target.sha256 || '',details:{physicalAction,reason:registry.deleteReason}});
    res.json({ ok:true, removed, fileId:targetId, storageStatus:'DELETED', physicalAction, physicalError:physicalError || undefined });
  } catch(error) {
    res.status(error.statusCode || 500).json({ok:false,code:error.code || '',error:error.message || 'File deletion failed.'});
  }
});

app.get('/api/system/files/storage-health', requireAdminSession, async (_req,res)=>{
  const health=fileStorage.health();
  res.status(health.ok ? 200 : 503).json({
    ok:health.ok,
    provider:'local-private',
    writable:health.writable,
    objectCount:health.objects,
    antivirusMode:health.antivirusMode,
    antivirusRequired:health.antivirusRequired,
    persistentConfigured:!IS_PRODUCTION || String(process.env.FILE_STORAGE_PERSISTENT || '').toLowerCase()==='true',
    legacyCompatibilityRootConfigured:Boolean(LEGACY_UPLOAD_DIR)
  });
});

app.get('/api/system/files/reconciliation', requireAdminSession, async (_req,res)=>{
  const d=readDb();
  const report=buildFileReconciliationReport(d,fileStorage,{docs:d.files || []});
  const legacyAvailable=report.available.filter(item=>item.provider==='legacy-local').length;
  res.json({ok:true,...report,legacyAvailable,storage:fileStorage.health()});
});

app.post('/api/system/files/reconciliation', requireAdminSession, async (req,res)=>{
  let importedObjects=[];
  let persistenceCommitted=false;
  let rollbackActor='system';
  try {
    if (String(req.body?.confirm || '')!=='RECONCILE FILE STORAGE') {
      return res.status(400).json({ok:false,code:'CONFIRMATION_REQUIRED',error:'Type RECONCILE FILE STORAGE to run the safe reconciliation.'});
    }
    const d=db();
    d.files ||= [];
    const before=buildFileReconciliationReport(d,fileStorage,{docs:d.files});
    let imported=0, markedMissing=0, refreshed=0;
    const actor=requestActor(req);
    rollbackActor=actor.name;
    for (const registry of d.files) {
      if (!registry?.id || String(registry.storageStatus || '').toUpperCase()==='DELETED') continue;
      const resolved=fileStorage.resolve(registry);
      if (resolved?.provider==='legacy-local') {
        try {
          const secured=await fileStorage.importLegacyFile(registry);
          if (secured) {
            importedObjects.push(secured);
            const patch={
              storageKey:secured.storageKey,storedName:secured.storageKey,sha256:secured.sha256,
              size:secured.size,mime:secured.detectedMime,mimeType:secured.detectedMime,
              securityStatus:'VALIDATED',storageProvider:'local-private',storageStatus:'AVAILABLE',
              storedAt:secured.storedAt,url:`/api/files/${registry.id}/download`,
              previewUrl:`/api/files/${registry.id}/preview`,downloadUrl:`/api/files/${registry.id}/download`
            };
            for (const doc of allKnownFileDocs(d)) if (String(doc?.id || '')===String(registry.id)) Object.assign(doc,patch);
            imported++;
          }
        } catch(error) {
          registry.storageStatus='QUARANTINED';
          registry.securityStatus='VALIDATION_FAILED';
          registry.storageError=error.message || 'Legacy file validation failed.';
        }
      } else if (resolved) {
        const stat=fs.statSync(resolved.fp);
        const patch={storageStatus:'AVAILABLE',storageProvider:resolved.provider,size:Number(registry.size || stat.size)};
        for (const doc of allKnownFileDocs(d)) if (String(doc?.id || '')===String(registry.id)) Object.assign(doc,patch);
        refreshed++;
      } else {
        const patch={storageStatus:'MISSING',storageCheckedAt:now()};
        for (const doc of allKnownFileDocs(d)) if (String(doc?.id || '')===String(registry.id)) Object.assign(doc,patch);
        markedMissing++;
      }
    }
    const auditEntry=addAudit(d,actor.name,'File storage reconciliation',`imported=${imported};missing=${markedMissing};refreshed=${refreshed}`);
    await save(d,{actor:actor.name,reason:'file_reconciliation',collections:['files','cases','teamChat','audit'],collectionRowIds:{audit:[String(auditEntry.id)]}});
    persistenceCommitted=true;
    const after=buildFileReconciliationReport(d,fileStorage,{docs:d.files});
    if (USE_POSTGRES) {
      try {
        await pool.query(`INSERT INTO file_reconciliation_runs(actor,imported_count,missing_count,refreshed_count,before_counts,after_counts) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,[actor.name,imported,markedMissing,refreshed,JSON.stringify(before.counts),JSON.stringify(after.counts)]);
      } catch(error) { console.warn('File reconciliation audit failed:',error.message); }
    }
    await recordFileStorageEvent({action:'FILE_RECONCILIATION',actor:actor.name,details:{imported,markedMissing,refreshed,before:before.counts,after:after.counts}});
    res.json({ok:true,imported,markedMissing,refreshed,before:before.counts,after:after.counts,report:after});
  } catch(error) {
    if (!persistenceCommitted) rollbackPreparedUploads(importedObjects,{reason:'FILE_RECONCILIATION_PERSISTENCE_FAILED',actor:rollbackActor});
    res.status(error.statusCode || 500).json({ok:false,code:error.code || '',error:error.message || 'File reconciliation failed.'});
  }
});

app.get('/api/cases/:id/share-whatsapp', requireAnyRole('ADMIN','MANAGER'), requireCaseAction('read'), async (req,res)=>{
  const d=requestDb(req);
  const c=req.caseRecord;
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

app.post('/api/chat', async (req,res)=>{
  try {
    const d=db();
    const actor=requestActor(req);
    const text=textValue(req.body.text || '', 'Message', MAX_CHAT_TEXT_LENGTH);
    const recipient=textValue(req.body.recipient || 'global','Recipient',200) || 'global';
    if (recipient !== 'global') {
      const recipientKey=String(recipient).trim().toLowerCase();
      const recipientExists=(d.users || []).some(user=>[user.id,user.username,user.name].map(value=>String(value || '').trim().toLowerCase()).includes(recipientKey));
      if (!recipientExists) return res.status(400).json({ok:false,code:'CHAT_RECIPIENT_INVALID',error:'The selected chat recipient does not exist.'});
    }
    let explicitTaskRefs=[];
    try { explicitTaskRefs=Array.isArray(req.body.taskRefs) ? req.body.taskRefs : (req.body.taskRefs ? JSON.parse(req.body.taskRefs || '[]') : []); } catch { explicitTaskRefs=[]; }
    assertArrayLimit(explicitTaskRefs, 'taskRefs', 20);
    const accessibleCases=filterCasesForUser(d.cases || [], req.auth?.user || {});
    const taskRefs=resolveChatTaskReferences(text, explicitTaskRefs, accessibleCases);
    let explicitMentions=[];
    try { explicitMentions=Array.isArray(req.body.mentions) ? req.body.mentions : (req.body.mentions ? JSON.parse(req.body.mentions || '[]') : []); } catch { explicitMentions=[]; }
    assertArrayLimit(explicitMentions, 'mentions', 50);
    const mentions=mentionTargets(text,d.users).concat(explicitMentions.map(value => textValue(value,'Mention',200)));
    const unique=[...new Set(mentions)].slice(0,50);
    const caseId=textValue(req.body.caseId || '', 'Case id', 200);
    if (caseId) {
      const caseRecord=findCaseByAnyId(d.cases || [], caseId);
      if (!caseRecord || !canAccessCase(req.auth?.user || {}, caseRecord)) return authorizationDenied(req,res,'CHAT_CASE_ACCESS_DENIED','You cannot attach this message to that task.');
    }
    const requestedFiles=Array.isArray(req.body.files) ? req.body.files : [];
    assertArrayLimit(requestedFiles,'files',20);
    const files=[];
    for (const reference of requestedFiles) {
      const fileId=String(reference?.id || reference?.fileId || '').trim();
      if (!fileId) continue;
      const resolved=resolveFileById(d,fileId).doc;
      if (!resolved || !canAccessFileDocument(req.auth?.user || {},resolved,d.cases || [])) {
        return authorizationDenied(req,res,'CHAT_FILE_ACCESS_DENIED','A referenced chat attachment is unavailable or not permitted.');
      }
      resolved.chatScope=recipient === 'global' ? 'GLOBAL' : 'DIRECT';
      resolved.chatParticipants=recipient === 'global'
        ? []
        : [...new Set([actor.id,actor.username,actor.name,recipient].map(value=>String(value || '').trim()).filter(Boolean))];
      files.push(structuredClone(resolved));
    }
    const createdAt=now();
    const notificationIdsBefore=new Set((d.notifications || []).map(item=>String(item.id || '')));
    const msg={
      id:nanoid(10),
      by:actor.name,
      sender:actor.name,
      senderId:actor.id,
      role:actor.role,
      senderRole:actor.role,
      recipient,
      caseId,
      text,
      mentions:unique,
      taskRefs,
      files,
      file:files[0] || null,
      fileUrl:req.body.fileUrl && files.length ? String(files[0].downloadUrl || files[0].url || '') : '',
      fileName:files[0]?.name || '',
      fileType:files[0]?.mime || files[0]?.mimeType || '',
      roomUrl:textValue(req.body.roomUrl || '', 'Meeting room URL', 1000),
      readBy:[{name:actor.name,userId:actor.id,time:createdAt}],
      sentAt:Date.now(),
      createdAt
    };
    d.teamChat.unshift(msg);
    if(unique.length) unique.forEach(name=>notifyUser(d,name,`You were mentioned by ${actor.name} in team chat`,'mention','chat'));
    else if(recipient !== 'global') notifyUser(d,recipient,`New message from ${actor.name}: ${(text || msg.fileName || 'Attachment').slice(0,80)}`,'chat','chat');
    else if(taskRefs.length) {
      notifyRole(d,'ADMIN',`${actor.name} mentioned task ${taskRefs[0].id || taskRefs[0].caseId} in team chat`,'task','chat');
      notifyRole(d,'MANAGER',`${actor.name} mentioned task ${taskRefs[0].id || taskRefs[0].caseId} in team chat`,'task','chat');
      notifyRole(d,'DESIGNER',`${actor.name} mentioned task ${taskRefs[0].id || taskRefs[0].caseId} in team chat`,'task','chat');
    } else ['ADMIN','MANAGER','DESIGNER'].forEach(role=>notifyRole(d,role,'New normal chat message','normal','chat'));
    const notificationIds=(d.notifications || []).filter(item=>!notificationIdsBefore.has(String(item.id || ''))).map(item=>String(item.id)).filter(Boolean);
    const collections=['teamChat'];
    const collectionRowIds={teamChat:[String(msg.id)]};
    const fileIds=files.map(item=>String(item.id || '')).filter(Boolean);
    if (fileIds.length) { collections.push('files'); collectionRowIds.files=fileIds; }
    if (notificationIds.length) { collections.push('notifications'); collectionRowIds.notifications=notificationIds; }
    await save(d,{actor:actor.name,reason:'chat_message_create',collections,collectionRowIds}); res.status(201).json(msg);
  } catch (error) {
    res.status(error.statusCode || 500).json({ok:false,code:error.code || '',error:error.message || 'Chat message could not be sent.'});
  }
});

app.patch('/api/chat/:id', async (req,res)=>{
  try {
    const d=db();
    const actor=requestActor(req);
    const message=(d.teamChat || []).find(item=>String(item.id)===String(req.params.id));
    if (!message) return res.status(404).json({ok:false,code:'CHAT_MESSAGE_NOT_FOUND',error:'Message not found.'});
    if (!canAccessChatMessage(req.auth?.user || {},message)) return authorizationDenied(req,res,'CHAT_ACCESS_DENIED','You do not have access to this chat message.');
    const isAuthor=[message.senderId,message.userId].map(String).includes(actor.id) || String(message.sender || message.by || '').trim().toLowerCase()===actor.name.toLowerCase();
    const canModerate=['ADMIN','MANAGER'].includes(actor.role);
    if (req.body.text !== undefined || req.body.deleted !== undefined) {
      if (!isAuthor && !canModerate) return authorizationDenied(req,res,'CHAT_EDIT_FORBIDDEN','Only the sender, Admin, or Manager can edit or delete this message.');
      if (req.body.deleted === true) {
        message.deleted=true; message.text='This message was deleted.'; message.deletedBy=actor.name; message.deletedAt=now();
        message.fileUrl=''; message.fileName=''; message.fileType=''; message.roomUrl='';
      } else {
        message.text=textValue(req.body.text || '','Message',MAX_CHAT_TEXT_LENGTH);
        message.editedBy=actor.name; message.editedAt=now();
      }
    }
    if (req.body.reactions && typeof req.body.reactions === 'object') {
      const reactions={};
      for (const [emoji, users] of Object.entries(req.body.reactions).slice(0,30)) {
        const key=textValue(emoji,'Reaction',20);
        const names=(Array.isArray(users) ? users : []).map(value=>textValue(typeof value==='string'?value:value?.name || '','Reaction user',200)).filter(Boolean).slice(0,100);
        reactions[key]=[...new Set(names)];
      }
      message.reactions=reactions;
    }
    if (req.body.markRead === true || Array.isArray(req.body.readBy)) {
      message.readBy=mergeAppendOnly(message.readBy || [], [{name:actor.name,userId:actor.id,time:now()}]);
    }
    message.updatedAt=now();
    await save(d,{actor:actor.name,reason:'chat_message_update',collections:['teamChat'],collectionRowIds:{teamChat:[String(message.id)]}}); res.json({ok:true,message});
  } catch(error) {
    res.status(error.statusCode || 500).json({ok:false,code:error.code || '',error:error.message || 'Message update failed.'});
  }
});

app.delete('/api/chat/:id', async (req,res)=>{
  const d=db();
  const actor=requestActor(req);
  const message=(d.teamChat || []).find(item=>String(item.id)===String(req.params.id));
  if (!message) return res.status(404).json({ok:false,code:'CHAT_MESSAGE_NOT_FOUND',error:'Message not found.'});
  if (!canAccessChatMessage(req.auth?.user || {},message)) return authorizationDenied(req,res,'CHAT_ACCESS_DENIED','You do not have access to this chat message.');
  const isAuthor=String(message.senderId || '')===actor.id || String(message.sender || message.by || '').trim().toLowerCase()===actor.name.toLowerCase();
  if (!isAuthor && !['ADMIN','MANAGER'].includes(actor.role)) return authorizationDenied(req,res,'CHAT_DELETE_FORBIDDEN','Only the sender, Admin, or Manager can delete this message.');
  message.deleted=true; message.text='This message was deleted.'; message.deletedBy=actor.name; message.deletedAt=now();
  message.fileUrl=''; message.fileName=''; message.fileType=''; message.roomUrl=''; message.updatedAt=now();
  await save(d,{actor:actor.name,reason:'chat_message_delete',collections:['teamChat'],collectionRowIds:{teamChat:[String(message.id)]}}); res.json({ok:true,message});
});

app.post('/api/chat/read', async (req,res)=>{
  const d=db();
  const actor=requestActor(req);
  const key=chatReadKey(req);
  const activeChannel=textValue(req.body.activeChannel || '__all__','Active channel',200);
  d.chatReads ||= {};
  const readable=[];
  for (const message of d.teamChat || []) {
    if (!canAccessChatMessage(req.auth?.user || {},message)) continue;
    const sender=String(message.sender || message.by || '').trim().toLowerCase();
    const recipient=String(message.recipient || 'global').trim().toLowerCase();
    const mine=[actor.name,actor.username,actor.id].map(value=>String(value || '').trim().toLowerCase());
    const relevant=activeChannel==='__all__'
      || (activeChannel==='global' && recipient==='global')
      || (recipient && mine.includes(recipient))
      || (String(activeChannel).toLowerCase()===sender && mine.includes(recipient));
    if (!relevant) continue;
    readable.push(message.id);
    message.readBy=mergeAppendOnly(message.readBy || [],[{name:actor.name,userId:actor.id,time:now()}]);
  }
  d.chatReads[key]=[...new Set([...(d.chatReads[key] || []),...readable])];
  const changedNotificationIds=[];
  (d.notifications || []).forEach(notification=>{
    if(notification.target==='chat' && notificationBelongsToUser(notification, req.auth?.user || {})) {
      notification.status='READ'; notification.readAt=now(); notification.readBy=actor.name;
      if (notification.id) changedNotificationIds.push(String(notification.id));
    }
  });
  const collections=['chatReads'];
  const collectionRowIds={};
  if (readable.length) { collections.push('teamChat'); collectionRowIds.teamChat=[...new Set(readable.map(String))]; }
  if (changedNotificationIds.length) { collections.push('notifications'); collectionRowIds.notifications=[...new Set(changedNotificationIds)]; }
  await save(d,{actor:actor.name,reason:'chat_mark_read',collections,collectionRowIds}); res.json({ok:true,readBy:actor.name,count:readable.length});
});

app.post('/api/notifications', async (req,res)=>{
  try {
    const d=db();
    const actor=requestActor(req);
    const targetRole=normalizePermissionRole(req.body.targetRole || req.body.role || '');
    const targetUser=textValue(req.body.targetUser || req.body.user || '', 'Notification recipient', 200);
    const title=textValue(req.body.title || req.body.text || '', 'Notification title', 500, {required:true});
    const type=textValue(req.body.type || req.body.category || 'info', 'Notification type', 50);
    const category=textValue(req.body.category || type || 'normal', 'Notification category', 50);
    const priority=textValue(req.body.priority || 'Normal', 'Notification priority', 30);
    const ownTargets=[actor.id,actor.username,actor.name].map(value=>String(value || '').trim().toLowerCase());
    const targetUserKey=String(targetUser || '').trim().toLowerCase();
    const privileged=['ADMIN','MANAGER'].includes(actor.role);
    const designerAllowed=actor.role==='DESIGNER' && ((targetRole==='ADMIN' || targetRole==='MANAGER') || (targetUserKey && ownTargets.includes(targetUserKey)));
    if (!privileged && !designerAllowed) return authorizationDenied(req,res,'NOTIFICATION_CREATE_FORBIDDEN','You cannot create a notification for this recipient.');
    if (!targetRole && !targetUser) return res.status(400).json({ok:false,code:'NOTIFICATION_TARGET_REQUIRED',error:'A notification role or user is required.'});
    const to=targetUser || targetRole;
    const notification={id:nanoid(8),to,targetRole:targetRole || '',targetUser:targetUser || '',title,text:title,type,category,priority,target:textValue(req.body.target || '', 'Notification target', 200),caseId:textValue(req.body.caseId || req.body.projectId || '', 'Notification task', 200),status:'UNREAD',createdAt:now(),createdBy:actor.name,createdById:actor.id};
    d.notifications.unshift(notification);
    const auditEntry=addAudit(d, actor.name, 'Notification created', notification.id);
    await save(d,{actor:actor.name,reason:'notification_create',collections:['notifications','audit'],collectionRowIds:{notifications:[String(notification.id)],audit:[String(auditEntry.id)]}});
    res.status(201).json({ok:true,notification});
  } catch(error) {
    res.status(error.statusCode || 500).json({ok:false,code:error.code || '',error:error.message || 'Notification could not be created.'});
  }
});

app.post('/api/notifications/:id/read', async (req,res)=>{
  const d=db();
  const notification=(d.notifications || []).find(item=>String(item.id)===String(req.params.id));
  if (!notification) return res.status(404).json({ok:false,code:'NOTIFICATION_NOT_FOUND',error:'Notification not found.'});
  if (!notificationBelongsToUser(notification, req.auth?.user || {})) return authorizationDenied(req,res,'NOTIFICATION_ACCESS_DENIED','You cannot update this notification.');
  notification.status='READ'; notification.readAt=now(); notification.readBy=requestActor(req).name;
  await save(d,{actor:requestActor(req).name,reason:'notification_mark_read',collections:['notifications'],collectionRowIds:{notifications:[String(notification.id)]}}); res.json({ok:true});
});

app.post('/api/notifications/read-all', async (req,res)=>{
  const d=db(); const actor=requestActor(req); let count=0; const changedIds=[];
  for (const notification of d.notifications || []) {
    if (!notificationBelongsToUser(notification, req.auth?.user || {})) continue;
    if (notification.status !== 'READ') count += 1;
    notification.status='READ'; notification.readAt=now(); notification.readBy=actor.name;
    if (notification.id) changedIds.push(String(notification.id));
  }
  const persistence=changedIds.length
    ? await save(d,{actor:actor.name,reason:'notifications_mark_all_read',collections:['notifications'],collectionRowIds:{notifications:[...new Set(changedIds)]}})
    : {mode:'no-op',persisted:false};
  res.json({ok:true,count,persistence});
});

app.post('/whatsapp/mock/incoming', authenticationGate, apiWriteRateLimiter, requireAdminSession, uploadAny, async (req,res)=>{
  let preparedUploads=[];
  let persistenceCommitted=false;
  let rollbackCaseId='';
  try {
    if (IS_PRODUCTION) {
      if (!WHATSAPP_WEBHOOK_SECRET) { cleanupRequestTempUploads(req); return res.status(503).json({ok:false,code:'WEBHOOK_DISABLED',error:'The mock WhatsApp webhook is disabled in production.'}); }
      const supplied=String(req.get('x-webhook-secret') || '');
      if (!supplied || supplied.length !== WHATSAPP_WEBHOOK_SECRET.length || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(WHATSAPP_WEBHOOK_SECRET))) {
        cleanupRequestTempUploads(req);
        return authorizationDenied(req,res,'WEBHOOK_SECRET_INVALID','Webhook secret is invalid.');
      }
    }
    const d=db();
    const parsed=parseLead(textValue(req.body.text || '','WhatsApp text',MAX_CASE_TEXT_LENGTH,{required:true}));
    const assignee=leastBusy(d);
    const fromName=textValue(req.body.fromName || req.body.from || 'WhatsApp Banker','Sender name',200);
    const caseInternalId=nanoid(8);
    rollbackCaseId=caseInternalId;
    preparedUploads=await prepareSecureUploads(req,'SOURCE');
    const c={id:caseInternalId,caseId:nextCaseNo(d,parsed.city),source:'WhatsApp',createdByRole:'BANKER',creatorName:fromName,createdBy:fromName,customerName:parsed.customerName,customerPhone:'',bankerName:fromName,bank:textValue(req.body.bank || '','Bank',200),branch:textValue(req.body.branch || '','Branch',200),serviceType:parsed.serviceType,city:parsed.city,propertyAddress:parsed.propertyAddress,estimateAmount:Number(parsed.estimateAmount || 0),priority:'Normal',status:'ASSIGNED',assigneeId:assignee?.id,assigneeName:assignee?.name,assigneeRole:assignee?.role,assignedTo:assignee?.name || 'Unassigned',createdAt:now(),completedAt:null,paymentStatus:'PENDING',documents:(req.files || []).map(file=>addFileRegistryEntry(d,docPayload(file,'WhatsApp','BANKER','SOURCE',caseInternalId))),comments:[],revisions:[],history:[{at:now(),by:'WhatsApp',action:'Lead created from WhatsApp'}]};
    d.cases.unshift(c); d.whatsappInbox.unshift({id:nanoid(8),from:textValue(req.body.from || '','Sender',100),fromName,text:req.body.text,createdAt:now(),caseId:c.caseId});
    const notifications=[
      notifyRole(d,'ADMIN',`New WhatsApp case ${c.caseId} from ${c.creatorName}`,'task',c.id),
      notifyRole(d,'MANAGER',`New WhatsApp case ${c.caseId} from ${c.creatorName}`,'task',c.id),
      notifyUser(d,c.assigneeName,`New WhatsApp task assigned: ${c.caseId}`,'task',c.id)
    ];
    const inboxEntry=d.whatsappInbox[0];
    await save(d,{actor:fromName,reason:'whatsapp_case_create',collections:['cases','files','whatsappInbox','notifications'],collectionRowIds:{cases:[String(c.id)],files:(c.documents || []).map(doc=>String(doc.id)),whatsappInbox:[String(inboxEntry.id)],notifications:notifications.map(item=>String(item.id))}});
    persistenceCommitted=true;
    res.status(201).json(c);
  } catch(error) {
    cleanupRequestTempUploads(req);
    if (!persistenceCommitted) rollbackPreparedUploads(preparedUploads,{reason:'WHATSAPP_CASE_PERSISTENCE_FAILED',actor:'WhatsApp',caseId:rollbackCaseId});
    if (error instanceof FileValidationError) return fileUploadFailure(res,error,'WhatsApp attachment upload failed.');
    res.status(error.statusCode || 500).json({ok:false,code:error.code || '',error:error.message || 'WhatsApp lead could not be created.'});
  }
});

app.get('/api/qr/:caseId', async (req,res)=>{
  const d=readDb();
  const c=findCaseByAnyId(d.cases || [], req.params.caseId);
  if (!c) return res.status(404).json({ok:false,error:'Case not found.'});
  if (!authorizeCase(req,res,c,'read')) return;
  const data=await QRCode.toDataURL(`${publicUrl()}/case/${encodeURIComponent(c.caseId || c.id)}`);
  res.json({qr:data});
});

app.get('/api/db/health', requireAdminSession, async (_req,res)=>{
  try {
    if (USE_POSTGRES) {
      await ensurePostgres();
      const health = await getRelationalHealth(pool);
      return res.status(health.integrity?.ok === false ? 503 : 200).json({ ok:health.integrity?.ok !== false, ...health });
    }
    const d = readDb();
    return res.json({ok:true,database:'json-file',connected:true,file:DB_FILE,localSandbox:true,warning:'Local JSON sandbox is enabled. Production requires PostgreSQL.',stateVersion,counts:{users:(d.users||[]).length,cases:(d.cases||[]).length,chatMessages:(d.teamChat||[]).length,notifications:(d.notifications||[]).length,attendanceLogs:(d.attendanceLogs||[]).length,payments:(d.payments||[]).filter(Boolean).length}});
  } catch (err) {
    return res.status(500).json({ok:false,database:USE_POSTGRES?'postgresql-relational':'json-file',code:err.code || '',error:err.message});
  }
});

app.get('/api/db/migrations', requireAdminSession, async (_req,res)=>{
  if (!USE_POSTGRES) return res.json({ok:true,database:'json-file',migrations:[],warning:'Schema migrations run only with PostgreSQL.'});
  try {
    await ensurePostgres();
    const result = await pool.query('SELECT version,name,checksum,execution_ms,applied_at FROM schema_migrations ORDER BY version');
    res.json({ok:true,database:'postgresql-relational',migrations:result.rows});
  } catch (error) {
    res.status(500).json({ok:false,code:error.code || '',error:error.message});
  }
});

app.get('/api/db/revisions', requireAdminSession, async (req,res)=>{
  if (!USE_POSTGRES) return res.json({ok:true,database:'json-file',revisions:[],warning:'Revision history is available only with PostgreSQL.'});
  try {
    const limit = boundedNumber(req.query.limit, 50, 1, 200);
    const result = await pool.query(
      `SELECT id,state_version,actor,reason,snapshot_hash,entity_counts,created_at
       FROM state_revisions ORDER BY state_version DESC LIMIT $1`,
      [limit]
    );
    res.json({ok:true,revisions:result.rows});
  } catch (error) {
    res.status(500).json({ok:false,code:error.code || '',error:error.message});
  }
});

app.post('/api/db/revisions/:id/restore', requireAdminSession, async (req,res)=>{
  if (!USE_POSTGRES) return res.status(409).json({ok:false,code:'POSTGRES_REQUIRED',error:'Revision restore requires PostgreSQL.'});
  try {
    const revisionId = Number(req.params.id);
    const confirmation = String(req.body?.confirmation || '').trim();
    if (!Number.isInteger(revisionId) || revisionId <= 0) return res.status(400).json({ok:false,code:'REVISION_ID_INVALID',error:'A valid revision id is required.'});
    if (confirmation !== `RESTORE ${revisionId}`) return res.status(400).json({ok:false,code:'RESTORE_CONFIRMATION_REQUIRED',error:`Type RESTORE ${revisionId} to confirm this recovery operation.`});
    await persistenceQueue.catch(() => {});
    const actor = requestActor(req);
    const result = await restoreRelationalRevision(pool, { revisionId, actor:actor.name, applyAuthOperationsWithClient, financeSnapshotHash });
    await reloadCommittedState();
    res.json({ok:true,restoredRevisionId:revisionId,...result});
  } catch (error) {
    res.status(error.statusCode || 500).json({ok:false,code:error.code || '',error:error.message});
  }
});


app.use((err, req, res, _next) => {
  const status = Number(err?.statusCode || err?.status || 500);
  structuredLog(status >= 500 ? 'error' : 'warn','api_error',{requestId:req?.requestId || '',method:req?.method || '',path:req?.originalUrl || '',status,code:err?.code || '',error:err?.message || 'Unexpected server error.'});
  if (status >= 500) operationalJobs.recordFailure('API_REQUEST',err,{requestId:req?.requestId || '',method:req?.method || '',path:req?.originalUrl || ''},{maxAttempts:1}).catch(()=>{});
  if (res.headersSent) return;
  res.status(status).json({ ok:false, requestId:req?.requestId || '', code:err?.code || '', error:err?.message || 'Unexpected server error.' });
});

const PORT=boundedEnvNumber('PORT',8080,1,65535);
const HOST=String(process.env.BIND_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')).trim();
let httpServer = null;

async function gracefulShutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  structuredLog('warn','server_shutdown_started',{signal,exitCode});
  const forceTimer = setTimeout(() => {
    structuredLog('fatal','server_shutdown_forced',{signal});
    process.exit(1);
  }, boundedEnvNumber('GRACEFUL_SHUTDOWN_TIMEOUT_MS',15000,5000,120000));
  forceTimer.unref();
  try {
    if (httpServer) await new Promise(resolve => httpServer.close(resolve));
    clearPresenceFlushTimer();
    if (presenceMutationGeneration > persistedPresenceGeneration) {
      await flushPresenceHeartbeatBatch({ force:true, reason:'presence_shutdown_flush' }).catch(error => {
        structuredLog('error','presence_shutdown_flush_failed',{code:error?.code || '',error:error?.message || String(error)});
      });
    }
    await persistenceQueue.catch(() => {});
    if (pool) await pool.end().catch(() => {});
    structuredLog('info','server_shutdown_completed',{signal});
    clearTimeout(forceTimer);
    process.exit(exitCode);
  } catch (error) {
    structuredLog('fatal','server_shutdown_failed',{signal,error:error.message || String(error)});
    clearTimeout(forceTimer);
    process.exit(1);
  }
}

async function startServer() {
  try {
    await initStore();
    await migrateLegacyCredentials();
    httpServer = await new Promise((resolve, reject) => {
      const server = app.listen(PORT, HOST);
      server.once('listening', () => resolve(server));
      server.once('error', reject);
    });
    const requestTimeoutMs = boundedEnvNumber('HTTP_REQUEST_TIMEOUT_MS',35 * 60 * 1000,5 * 60 * 1000,60 * 60 * 1000);
    const headersTimeoutMs = boundedEnvNumber('HTTP_HEADERS_TIMEOUT_MS',65_000,10_000,requestTimeoutMs - 1_000);
    httpServer.requestTimeout = requestTimeoutMs;
    httpServer.headersTimeout = headersTimeoutMs;
    httpServer.keepAliveTimeout = boundedEnvNumber('HTTP_KEEP_ALIVE_TIMEOUT_MS',5_000,1_000,120_000);
    httpServer.ref();
    structuredLog('info','server_started',{host:HOST,port:Number(PORT),storage:USE_POSTGRES ? 'postgresql-relational' : 'json-sandbox',startedAt:serverStartedAt,requestTimeoutMs,headersTimeoutMs});
  } catch (err) {
    structuredLog('fatal','server_startup_blocked',{error:err.message || String(err),code:err.code || ''});
    if (pool) await pool.end().catch(() => {});
    process.exit(1);
  }
}

process.once('SIGTERM',()=>gracefulShutdown('SIGTERM',0));
process.once('SIGINT',()=>gracefulShutdown('SIGINT',0));
process.on('unhandledRejection',reason=>{
  const error=reason instanceof Error ? reason : new Error(String(reason));
  structuredLog('error','unhandled_rejection',{error:error.message,stack:error.stack || ''});
  operationalJobs.recordFailure('UNHANDLED_REJECTION',error,{}, {maxAttempts:1}).catch(()=>{});
});
process.on('uncaughtException',error=>{
  structuredLog('fatal','uncaught_exception',{error:error.message,stack:error.stack || ''});
  gracefulShutdown('UNCAUGHT_EXCEPTION',1);
});

startServer();
