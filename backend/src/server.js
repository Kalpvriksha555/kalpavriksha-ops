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
import { FINANCE_FIELDS, applyFreshestFinance, buildFinanceSnapshot, financeFreshness, financeMutationFingerprint, financeSnapshotHash, findFinanceMutationReceipt, mergePaymentRecords, rememberFinanceMutationReceipt } from './services/financeIntegrityService.js';
import { hashPassword, verifyPassword, passwordPolicyErrors, randomOpaqueToken, tokenHash, randomOtp, normalizeUsername, normalizeAuthRole, normalizeAuthStatus, stripCredentialFields, publicSessionUser, reconcileLegacyCredential } from './services/authService.js';
import { ROLE_CAPABILITIES, authorizationActor, canAccessCase, canMutateCase, canAccessFileDocument, canDeleteFileDocument, filterCasesForUser, hasCapability, isCaseAssignedToUser, normalizePermissionRole, notificationBelongsToUser } from './services/authorizationService.js';
import { attachRequestId, createRateLimiter, rejectDangerousJson, requireJsonForBody, secureResponseHeaders } from './middleware/security.js';
import { getRelationalHealth, loadRelationalState, normalizeEpochMilliseconds, persistRelationalState, reloadRelationalState, restoreRelationalRevision, runRelationalMigrations } from './repositories/postgresStateRepository.js';
import { buildFileReconciliationReport, createFileStorage, FileValidationError } from './services/fileStorageService.js';
import { createOperationalJobStore, filesystemUsage, inspectBackupManifests, recordOperationalEvent, requestLogMiddleware, structuredLog } from './services/operationalReliabilityService.js';
import { readAndVerifyReleaseCertificate } from './services/releaseCertificationService.js';
import { createCorsOriginPolicy, parseCorsOrigins } from './config/corsPolicy.js';
import { classifyPersistenceFailure, isDeferredPersistenceOperation, mergeLatestPresenceIntoSnapshot, persistenceCommitEvidenceMatches, persistenceReadiness, preserveDirtyPresenceAfterReload, runtimeRecoveryCanRun } from './services/persistenceBackpressureService.js';
import { getRequestStateSnapshot } from './services/requestStateService.js';
import { applyFileRetentionToState, DEFAULT_FILE_RETENTION_DAYS } from './services/storageRetentionService.js';
import { applyPresenceClientCommandMetadata, classifyPresenceClientCommand, computeAttendanceAccrual, normalizePresenceClientCommand, parseIndiaAttendanceClock } from './services/presenceProtocolService.js';
import { normalizeClientDiagnostic, publicApiErrorPayload, sanitizeOperationalPath, serverErrorFingerprint } from './services/runtimeDiagnosticsService.js';

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
const DUMMY_LOGIN_PASSWORD_HASH = 'scrypt-v1$32768$8$1$_22jkmO6P8qKfqeryLWkqg$TUFN-xwufhuSxnscEG42MCZQeJQ0rZhDfWs6pM1ika1JU9JkB8PPpdmsmQfTTvQHrLRUdY51ZKh5BGiUIm26nw';
const JSON_BODY_LIMIT = String(process.env.JSON_BODY_LIMIT || '8mb');
const MAX_STATE_PROJECTS_PER_WRITE = boundedEnvNumber('MAX_STATE_PROJECTS_PER_WRITE', 1500, 1, 5000);
const MAX_CHAT_TEXT_LENGTH = boundedEnvNumber('MAX_CHAT_TEXT_LENGTH', 10000, 100, 50000);
const MAX_TIMELINE_TEXT_LENGTH = boundedEnvNumber('MAX_TIMELINE_TEXT_LENGTH', 2000, 100, 10000);
const MAX_CASE_TEXT_LENGTH = boundedEnvNumber('MAX_CASE_TEXT_LENGTH', 5000, 100, 20000);
const STATE_REVISION_RETENTION = boundedEnvNumber('STATE_REVISION_RETENTION', 200, 25, 5000);
const STATE_REVISION_SNAPSHOT_INTERVAL = boundedEnvNumber('STATE_REVISION_SNAPSHOT_INTERVAL', 100, 10, 500);
const STATE_REVISION_SNAPSHOT_MAX_AGE_MINUTES = boundedEnvNumber('STATE_REVISION_SNAPSHOT_MAX_AGE_MINUTES', 60, 5, 1440);
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
  connectionTimeoutMillis: boundedEnvNumber('DB_CONNECT_TIMEOUT_MS', 10000, 1000, 120000),
  idleTimeoutMillis: boundedEnvNumber('DB_IDLE_TIMEOUT_MS', 30000, 5000, 300000),
  max: boundedEnvNumber('DB_POOL_MAX', 12, 2, 50),
  query_timeout: boundedEnvNumber('DB_QUERY_TIMEOUT_MS', 120000, 5000, 10 * 60 * 1000)
}) : null;
const operationalJobs = createOperationalJobStore({ pool, dataDir:DATA_DIR, usePostgres:USE_POSTGRES });
const serverStartedAt = new Date().toISOString();
let shuttingDown = false;
let startupFailure = null;
let startupRecoveryTimer = null;
let startupRecoveryInFlight = null;
let lastDatabasePoolError = null;
let otpCleanupTimer = null;
let authCleanupTimer = null;
let storageRetentionTimer = null;
let storageRetentionInitialTimer = null;
let unhandledRejectionTimes = [];
let lastPersistenceFailure = null;
let lastCriticalPersistenceFailure = null;
let lastDeferredPersistenceFailure = null;
let lastPersistenceRecovery = null;
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
const WORKSPACE_CHANGE_LOG_LIMIT = boundedEnvNumber('WORKSPACE_CHANGE_LOG_LIMIT', 250, 50, 2000);
const WORKSPACE_COMPACT_CHAT_LIMIT = boundedEnvNumber('WORKSPACE_COMPACT_CHAT_LIMIT', 1500, 250, 10000);
const WORKSPACE_COMPACT_NOTIFICATION_LIMIT = boundedEnvNumber('WORKSPACE_COMPACT_NOTIFICATION_LIMIT', 300, 100, 5000);
let workspaceCollectionChangeLog = Object.fromEntries(WORKSPACE_SYNC_COLLECTIONS.map(collection => [collection, []]));
let performanceBundleCache = { revision:-1, records:[], summary:null, diagnostics:null };
let leaderboardAggregateCache = new Map();
let activeForegroundWriteRequests = 0;
let presenceMutationGeneration = 0;
let persistedPresenceGeneration = 0;
let presenceFlushTimer = null;
let presenceFlushPromise = null;
let presenceDirtyRows = { users:new Map(), attendanceLogs:new Map() };
const PRESENCE_HEARTBEAT_FLUSH_MS = boundedEnvNumber('PRESENCE_HEARTBEAT_FLUSH_MS', 180_000, 60_000, 15 * 60_000);
const PRESENCE_FLUSH_RETRY_MS = boundedEnvNumber('PRESENCE_FLUSH_RETRY_MS', 15_000, 5_000, 60_000);
const snapshotVersions = new WeakMap();
const snapshotPresenceGenerations = new WeakMap();

if (pool) {
  // pg emits idle-client failures through the Pool 'error' event. Without a
  // listener, EventEmitter treats that as an uncaught exception and PM2 enters
  // a restart loop even though a fresh database connection may work normally.
  pool.on('error', error => {
    postgresReady = false;
    lastDatabasePoolError = {
      at:new Date().toISOString(),
      code:error?.code || 'DB_POOL_ERROR',
      message:error?.message || String(error)
    };
    structuredLog('error','database_pool_error',lastDatabasePoolError);
  });
}

const safeName = (name='file') => String(name).replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/[^a-zA-Z0-9.\-_]/g, '_');
const MAX_UPLOAD_SIZE_MB = boundedEnvNumber('MAX_UPLOAD_SIZE_MB', 100, 1, 100);
const MAX_UPLOAD_FILES = boundedEnvNumber('MAX_UPLOAD_FILES', 20, 1, 20);
const MAX_INLINE_PREVIEW_MB = boundedEnvNumber('MAX_INLINE_PREVIEW_MB', 15, 1, 50);
const MAX_INLINE_PREVIEW_BYTES = MAX_INLINE_PREVIEW_MB * 1024 * 1024;
const FILE_STORAGE_GC_GRACE_MS = boundedEnvNumber('FILE_STORAGE_GC_GRACE_MS', 24 * 60 * 60 * 1000, 0, 30 * 24 * 60 * 60 * 1000);
const FILE_RETENTION_DAYS = boundedEnvNumber('FILE_RETENTION_DAYS', DEFAULT_FILE_RETENTION_DAYS, 30, 3650);
const FILE_RETENTION_INTERVAL_MS = boundedEnvNumber('FILE_RETENTION_INTERVAL_MS', 24 * 60 * 60 * 1000, 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);
const FILE_RETENTION_START_DELAY_MS = boundedEnvNumber('FILE_RETENTION_START_DELAY_MS', 10 * 60 * 1000, 60_000, 60 * 60 * 1000);
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

function releaseRequestStorageLeases(req = {}) {
  const releases=Array.isArray(req.__fileStorageLeaseReleases) ? req.__fileStorageLeaseReleases.splice(0) : [];
  for (const release of releases) {
    try { release(); } catch {}
  }
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
      const secured = await fileStorage.validateAndStore(file, { purpose, acquireLease:true });
      if (secured.releaseStorageLease) {
        req.__fileStorageLeaseReleases ||= [];
        req.__fileStorageLeaseReleases.push(secured.releaseStorageLease);
      }
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
    let tempsCleaned=false;
    const cleanupTemps=()=>{ if (tempsCleaned) return; tempsCleaned=true; cleanupRequestTempUploads(req); };
    const cleanupAll=()=>{ cleanupTemps(); releaseRequestStorageLeases(req); };
    res.once('finish',cleanupAll);
    res.once('close',cleanupTemps);
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
      let tempsCleaned=false;
      const cleanupTemps=()=>{ if (tempsCleaned) return; tempsCleaned=true; cleanupRequestTempUploads(req); };
      const cleanupAll=()=>{ cleanupTemps(); releaseRequestStorageLeases(req); };
      res.once('finish',cleanupAll);
      res.once('close',cleanupTemps);
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

function writeJsonAtomic(filePath, value) {
  const target=path.resolve(filePath);
  const temp=`${target}.${process.pid}.${Date.now()}.tmp`;
  const payload=JSON.stringify(value,null,2);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  let fd=null;
  try {
    fd=fs.openSync(temp,'w',0o600);
    fs.writeFileSync(fd,payload,'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd=null;
    fs.renameSync(temp,target);
    try {
      const dirFd=fs.openSync(path.dirname(target),'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {}
  } catch (error) {
    if (fd !== null) try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

function readJsonFallback(){
  if (!ALLOW_JSON_FALLBACK) {
    throw new Error('JSON fallback access blocked outside the explicit local-development sandbox.');
  }
  if(!fs.existsSync(DB_FILE)) writeJsonAtomic(DB_FILE,seed);
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
    relationalShadowState = ownRelationalShadow(loaded.persistedState || loaded.state);
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
  resetWorkspaceCollectionChangeLog(workspaceDataRevision);
  presenceDirtyRows = { users:new Map(), attendanceLogs:new Map() };
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

const frozenRelationalShadowObjects = new WeakSet();
function freezeRelationalShadow(value) {
  if (!value || typeof value !== 'object' || frozenRelationalShadowObjects.has(value)) return value;
  frozenRelationalShadowObjects.add(value);
  for (const child of Object.values(value)) freezeRelationalShadow(child);
  return Object.freeze(value);
}

function ownRelationalShadow(value, { alreadyOwned = false } = {}) {
  const owned = alreadyOwned ? value : structuredClone(value || {});
  return freezeRelationalShadow(owned);
}

function recordMatchesCollectionRow(collection = '', record = {}, selectedIds = new Set()) {
  if (!selectedIds.size) return false;
  if (collection === 'cases') return getCaseIdentitySet(record).some(value => selectedIds.has(String(value || '').trim()));
  if (collection === 'users') return [record.id,record.userId,record.username,record.name].some(value => selectedIds.has(String(value || '').trim()));
  if (collection === 'payments') return [record.id,record.paymentId,record.caseId,record.caseNo,record.taskId,record.projectId].some(value => selectedIds.has(String(value || '').trim()));
  return selectedIds.has(String(record?.id || '').trim());
}

function selectiveDb({ collections = [], collectionRowIds = {}, cloneAll = [] } = {}) {
  if (!memoryState) throw new Error('Application state is not initialized.');
  const selectedCollections = [...new Set((collections || []).map(value => String(value || '').trim()).filter(Boolean))];
  const cloneAllSet = new Set((cloneAll || []).map(value => String(value || '').trim()).filter(Boolean));
  const snapshot = { ...memoryState };
  for (const collection of selectedCollections) {
    const source = collection === 'cases'
      ? (memoryState.cases || [])
      : collection === 'teamChat'
        ? (memoryState.teamChat || [])
        : memoryState[collection];
    if (Array.isArray(source)) {
      const selectedIds = new Set((collectionRowIds?.[collection] || []).map(value => String(value || '').trim()).filter(Boolean));
      snapshot[collection] = source.map(record => (
        cloneAllSet.has(collection) || recordMatchesCollectionRow(collection, record, selectedIds)
          ? structuredClone(record)
          : record
      ));
    } else if (source && typeof source === 'object') {
      snapshot[collection] = structuredClone(source);
    } else {
      snapshot[collection] = source;
    }
  }
  snapshotVersions.set(snapshot, stateVersion);
  snapshotPresenceGenerations.set(snapshot, presenceMutationGeneration);
  return snapshot;
}

function adoptSelectiveState(previousState = {}, nextState = {}, collections = null) {
  if (!Array.isArray(collections) || !collections.length) return structuredClone(nextState);
  const adopted = { ...previousState };
  for (const collection of collections) {
    const key = String(collection || '').trim();
    if (!key) continue;
    if (key === 'cases') adopted.cases = nextState.cases || nextState.projects || [];
    else if (key === 'teamChat') adopted.teamChat = nextState.teamChat || nextState.chatMessages || [];
    else adopted[key] = nextState[key];
  }
  return adopted;
}

function financeDb(caseId = '') {
  if (!memoryState) throw new Error('Application state is not initialized.');
  const target = String(caseId || '').trim();
  const sourceCases = memoryState.cases || [];
  const caseIndex = sourceCases.findIndex(caseRecord => [
    caseRecord?.id,
    caseRecord?.caseId,
    caseRecord?.displayId,
    caseRecord?.originalTaskId
  ].filter(Boolean).some(value => String(value).trim() === target));
  if (caseIndex < 0) return null;

  // Finance changes touch one case, at most one payment row, and prepend one
  // audit row. Keep every unrelated collection by reference instead of cloning
  // thousands of files, performance rows, chats and notifications for one save.
  const cases = sourceCases.slice();
  cases[caseIndex] = structuredClone(sourceCases[caseIndex]);
  const caseRecord=cases[caseIndex];
  const paymentAliases=new Set(getCaseIdentitySet(caseRecord).map(value=>String(value || '').trim()).filter(Boolean));
  const linkedPaymentId=String(caseRecord?.ledger?.financeLedgerId || '').trim();
  const payments=(memoryState.payments || []).slice();
  for (let index=0; index<payments.length; index+=1) {
    const payment=payments[index];
    const matchesLinkedId=linkedPaymentId && String(payment?.id || '').trim()===linkedPaymentId;
    const matchesTask=[payment?.caseId,payment?.caseNo,payment?.taskId,payment?.projectId]
      .some(value=>paymentAliases.has(String(value || '').trim()));
    if (matchesLinkedId || matchesTask) payments[index]=payment ? {...payment} : payment;
  }
  const audit = (memoryState.audit || []).slice();
  const snapshot = { ...memoryState, cases, payments, audit };
  snapshotVersions.set(snapshot, stateVersion);
  snapshotPresenceGenerations.set(snapshot, presenceMutationGeneration);
  return { snapshot, caseRecord:cases[caseIndex] };
}

function taskDb(caseId = '', options = {}) {
  if (!memoryState) throw new Error('Application state is not initialized.');
  const target=String(caseId || '').trim();
  const sourceCases=memoryState.cases || [];
  const caseIndex=target ? sourceCases.findIndex(record=>getCaseIdentitySet(record).includes(target)) : -1;
  const cases=sourceCases.slice();
  if (caseIndex >= 0) cases[caseIndex]=structuredClone(sourceCases[caseIndex]);
  const snapshot={...memoryState,cases};
  if (options.audit) snapshot.audit=(memoryState.audit || []).slice();
  if (options.notifications) snapshot.notifications=(memoryState.notifications || []).slice();
  if (options.files) snapshot.files=(memoryState.files || []).slice();
  if (options.teamChat) snapshot.teamChat=(memoryState.teamChat || []).slice();
  if (options.deletedProjectIds) snapshot.deletedProjectIds=(memoryState.deletedProjectIds || []).slice();
  snapshotVersions.set(snapshot,stateVersion);
  snapshotPresenceGenerations.set(snapshot,presenceMutationGeneration);
  return {snapshot,caseRecord:caseIndex >= 0 ? cases[caseIndex] : null};
}


function fileDeleteDb(fileId = '') {
  if (!memoryState) throw new Error('Application state is not initialized.');
  const targetId=String(fileId || '').trim();
  const referencesFile=(record={})=>{
    const docs=[...(record.documents || []),...(record.completedFiles || []),...(record.sourceFiles || []),...(record.workFiles || []),...(record.files || []),...(record.attachments || []),...(record.file ? [record.file] : [])];
    return docs.some(doc=>String(doc?.id || '')===targetId);
  };
  const cases=(memoryState.cases || []).slice();
  for (let index=0; index<cases.length; index+=1) if (referencesFile(cases[index])) cases[index]=structuredClone(cases[index]);
  const teamChat=(memoryState.teamChat || []).slice();
  for (let index=0; index<teamChat.length; index+=1) if (referencesFile(teamChat[index])) teamChat[index]=structuredClone(teamChat[index]);
  const files=(memoryState.files || []).slice();
  const registryIndex=files.findIndex(doc=>String(doc?.id || '')===targetId);
  if (registryIndex >= 0) files[registryIndex]=structuredClone(files[registryIndex]);
  const snapshot={...memoryState,cases,teamChat,files,audit:(memoryState.audit || []).slice()};
  snapshotVersions.set(snapshot,stateVersion);
  snapshotPresenceGenerations.set(snapshot,presenceMutationGeneration);
  return snapshot;
}


function requestDb(req = {}) {
  return getRequestStateSnapshot(req, db);
}

function requestTaskDb(req = {}, options = {}) {
  const target=req.params?.id || req.body?.caseId || req.body?.projectId || '';
  return getRequestStateSnapshot(req,()=>taskDb(target,options).snapshot);
}

function publishCommittedState({ committedState, version, liveStateBeforeReload = memoryState } = {}) {
  memoryState = norm(preserveDirtyPresenceAfterReload({
    committedState,
    liveState:liveStateBeforeReload,
    mutationGeneration:presenceMutationGeneration,
    persistedGeneration:persistedPresenceGeneration
  }));
  stateVersion = Number(version || 0);
  workspaceDataRevision = Math.max(workspaceDataRevision + 1, stateVersion);
  workspaceCollectionRevisions = Object.fromEntries(WORKSPACE_SYNC_COLLECTIONS.map(collection => [
    collection,
    Math.max(Number(workspaceCollectionRevisions[collection] || 0) + 1, stateVersion)
  ]));
  performanceDataRevision += 1;
  leaderboardAggregateCache.clear();
  resetWorkspaceCollectionChangeLog(workspaceDataRevision);
}

async function reloadCommittedState(){
  if (!USE_POSTGRES) return null;
  const liveStateBeforeReload = memoryState;
  const loaded = await reloadRelationalState(pool, { normalizeState: norm });
  relationalShadowState = ownRelationalShadow(loaded.persistedState || loaded.state);
  publishCommittedState({
    committedState:loaded.state,
    version:loaded.stateVersion,
    liveStateBeforeReload
  });
  return loaded;
}

function restoreVerifiedShadowAfterPersistenceFailure(expectedVersion = stateVersion) {
  if (!USE_POSTGRES || !relationalShadowState) return false;
  publishCommittedState({
    // The relational shadow is deeply frozen and represents the most recent
    // verified commit. Clone only on this exceptional rollback path, then keep
    // the newer presence slice dirty so it can retry without losing telemetry.
    // For a foreground failure this shadow is served read-only until PostgreSQL
    // can be reloaded, because COMMIT outcome may still be ambiguous.
    committedState:structuredClone(relationalShadowState),
    version:expectedVersion,
    liveStateBeforeReload:memoryState
  });
  return true;
}

function resetWorkspaceCollectionChangeLog(revision = workspaceDataRevision) {
  const markerRevision = Number(revision || 0);
  workspaceCollectionChangeLog = Object.fromEntries(WORKSPACE_SYNC_COLLECTIONS.map(collection => [collection, [{ revision:markerRevision, full:true, rowIds:[] }]]));
}

function metadataCollectionRowIds(metadata = {}, collection = '') {
  const values = metadata?.collectionRowIds?.[collection];
  if (!Array.isArray(values)) return null;
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function workspaceRowChangesSince(sinceCollections = {}, changedCollections = []) {
  const result = {};
  for (const collection of changedCollections) {
    const sinceRevision = Number(sinceCollections?.[collection] || 0);
    const log = workspaceCollectionChangeLog[collection] || [];
    if (!log.length || sinceRevision < Number(log[0]?.revision || 0)) {
      result[collection] = null;
      continue;
    }
    const relevant = log.filter(entry => Number(entry.revision || 0) > sinceRevision);
    if (!relevant.length || relevant.some(entry => entry.full === true)) {
      result[collection] = null;
      continue;
    }
    result[collection] = [...new Set(relevant.flatMap(entry => entry.rowIds || []).map(String).filter(Boolean))];
  }
  return result;
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
  const revision = workspaceDataRevision;
  for (const collection of changed) {
    workspaceCollectionRevisions[collection] = revision;
    const rowIds = metadataCollectionRowIds(metadata, collection);
    const entry = { revision, full:rowIds === null || collection === 'deletedProjectIds', rowIds:rowIds || [] };
    const log = workspaceCollectionChangeLog[collection] || (workspaceCollectionChangeLog[collection] = []);
    log.push(entry);
    if (log.length > WORKSPACE_CHANGE_LOG_LIMIT) log.splice(0, log.length - WORKSPACE_CHANGE_LOG_LIMIT);
  }
  return true;
}

function markPresenceRowsDirty(user = null, attendanceLog = null, generation = presenceMutationGeneration) {
  const userId = String(user?.id || user?.username || '').trim();
  const attendanceId = String(attendanceLog?.id || '').trim();
  if (userId) presenceDirtyRows.users.set(userId, Number(generation || 0));
  if (attendanceId) presenceDirtyRows.attendanceLogs.set(attendanceId, Number(generation || 0));
}

function dirtyPresenceRowIdsThrough(generation = presenceMutationGeneration) {
  const limit = Number(generation || 0);
  return {
    users:[...presenceDirtyRows.users.entries()].filter(([, value]) => Number(value || 0) <= limit).map(([id]) => id),
    attendanceLogs:[...presenceDirtyRows.attendanceLogs.entries()].filter(([, value]) => Number(value || 0) <= limit).map(([id]) => id)
  };
}

function clearPersistedPresenceRowsThrough(generation = persistedPresenceGeneration) {
  const limit = Number(generation || 0);
  for (const map of [presenceDirtyRows.users, presenceDirtyRows.attendanceLogs]) {
    for (const [id, value] of map.entries()) if (Number(value || 0) <= limit) map.delete(id);
  }
}

function ensureOperationalTaskVersionsForSave(snapshot = {}, metadata = {}, committedState = {}) {
  const reason=String(metadata.reason || '').trim().toLowerCase();
  const collections=Array.isArray(metadata.collections) ? metadata.collections.map(String) : null;
  if (collections && !collections.includes('cases')) return;
  if (reason.startsWith('finance_') || reason.includes('payment') || reason.startsWith('presence_')) return;
  const rowIds=new Set((metadata.collectionRowIds?.cases || []).map(value=>String(value || '')).filter(Boolean));
  for (const record of snapshot.cases || []) {
    if (rowIds.size && !getCaseIdentitySet(record).some(id=>rowIds.has(String(id)))) continue;
    const previous=findCaseByAnyId(committedState.cases || [],record.id || record.caseId);
    const previousVersion=currentTaskVersion(previous || {});
    if (currentTaskVersion(record) <= previousVersion) record.taskVersion=previousVersion+1;
    record.lastTaskMutationId ||= `${reason || 'task-write'}:${record.id || record.caseId}:${nanoid(8)}`;
    record.lastTaskMutationAt ||= now();
  }
}

function save(d, metadata = {}){
  if (startupFailure) {
    const error=new Error('Operational writes are blocked while backend startup or integrity recovery is incomplete.');
    error.statusCode=503;
    error.code='BACKEND_STARTUP_MAINTENANCE';
    return Promise.reject(error);
  }
  ensureOperationalTaskVersionsForSave(d,metadata,memoryState || {});
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
  const effectiveCollectionRowIds = Object.fromEntries(Object.entries(metadata.collectionRowIds || {}).map(([key, values]) => [key, Array.isArray(values) ? [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))] : values]));
  if (effectiveCollections && includedPresenceGeneration > persistedPresenceGeneration) {
    const dirtyRows = dirtyPresenceRowIdsThrough(includedPresenceGeneration);
    if (!effectiveCollections.includes('users')) effectiveCollections.push('users');
    if (!effectiveCollections.includes('attendanceLogs')) effectiveCollections.push('attendanceLogs');
    if (dirtyRows.users.length) effectiveCollectionRowIds.users = [...new Set([...(effectiveCollectionRowIds.users || []), ...dirtyRows.users])];
    if (dirtyRows.attendanceLogs.length) effectiveCollectionRowIds.attendanceLogs = [...new Set([...(effectiveCollectionRowIds.attendanceLogs || []), ...dirtyRows.attendanceLogs])];
  }
  const selectiveWrite = Array.isArray(effectiveCollections) && effectiveCollections.length > 0;
  const effectiveMetadata = effectiveCollections
    ? {
        ...metadata,
        collections:effectiveCollections,
        collectionRowIds:effectiveCollectionRowIds,
        requestedCollections:requestedCollections ? [...requestedCollections] : null,
        skipRevisionSnapshot:metadata.forceRevisionSnapshot === true ? Boolean(metadata.skipRevisionSnapshot) : (metadata.skipRevisionSnapshot ?? true),
        periodicRevisionSnapshot:metadata.periodicRevisionSnapshot ?? true,
        revisionSnapshotInterval:metadata.revisionSnapshotInterval ?? STATE_REVISION_SNAPSHOT_INTERVAL,
        revisionSnapshotMaxAgeMinutes:metadata.revisionSnapshotMaxAgeMinutes ?? STATE_REVISION_SNAPSHOT_MAX_AGE_MINUTES
      }
    : metadata;
  const normalized = normalizeStateForSelectiveSave(latestPresence.state, effectiveMetadata);
  const persistenceReason = String(effectiveMetadata.reason || (effectiveMetadata.financeEvent ? 'finance_update' : effectiveMetadata.authOperations?.length ? 'authentication_update' : 'state_update'));
  const deferredPersistence = isDeferredPersistenceOperation({ metadata:effectiveMetadata, reason:persistenceReason });
  if (metadataAffectsPerformance(effectiveMetadata)) {
    performanceDataRevision += 1;
    leaderboardAggregateCache.clear();
  }
  markWorkspaceCollectionsChanged(effectiveMetadata);
  // Make queued changes visible to later requests in this process. The queued
  // PostgreSQL transaction still has to succeed before the API returns success.
  memoryState = effectiveMetadata.takeSnapshotOwnership === true
    ? normalized
    : selectiveWrite
      ? adoptSelectiveState(memoryState || {}, normalized, effectiveCollections)
      : structuredClone(normalized);
  stateVersion = targetVersion;
  persistenceQueueDepth += 1;

  const persist = async () => {
    const startedAt = Date.now();
    persistenceInFlight += 1;
    try {
      if (!USE_POSTGRES) {
        normalized.__stateVersion = targetVersion;
        try {
          writeJsonAtomic(DB_FILE,normalized);
        } finally {
          delete normalized.__stateVersion;
        }
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
        if (result?.committedState) {
          relationalShadowState = ownRelationalShadow(result.committedState, {
            alreadyOwned:result.committedStateOwned === true
          });
        }
        if (process.env.WRITE_JSON_BACKUP === 'true') writeJsonAtomic(DB_FILE,normalized);
        return result;
      } catch (error) {
        let recoverySucceeded = false;
        let verifiedFallbackRestored = false;
        let reloadFailure = null;
        let recoveredState = null;
        try {
          recoveredState = await reloadCommittedState();
          recoverySucceeded = true;
          if (persistenceCommitEvidenceMatches(error, recoveredState)) {
            // COMMIT reached PostgreSQL but the acknowledgement was lost. The
            // exact version+hash now present in a fresh repeatable-read snapshot
            // proves this transaction committed, so report success instead of
            // forcing the browser to retry an already durable mutation.
            structuredLog('warn','relational_commit_ack_reconciled',{
              reason:persistenceReason,
              stateVersion:recoveredState.stateVersion,
              snapshotHash:String(recoveredState.snapshotHash || '').slice(0,16)
            });
            return {
              stateVersion:Number(recoveredState.stateVersion || targetVersion),
              persistedAt:now(),
              database:'postgresql-relational',
              snapshotHash:recoveredState.snapshotHash || '',
              counts:recoveredState.counts || {},
              committedState:relationalShadowState,
              committedStateOwned:true,
              commitConfirmedAfterReconnect:true
            };
          }
        } catch (reloadError) {
          reloadFailure = reloadError;
          // Never expose the failed optimistic business state through read-only
          // access. Restore the last physically verified shadow even for a
          // foreground failure; foreground writes remain blocked until the
          // database can be reloaded and the real commit outcome is known.
          verifiedFallbackRestored = restoreVerifiedShadowAfterPersistenceFailure(expectedVersion);
          if (deferredPersistence && verifiedFallbackRestored) {
            structuredLog('warn','runtime_deferred_recovery_preserved',{
              persistenceCode:error?.code || '',
              persistenceError:error?.message || String(error),
              reloadCode:reloadError?.code || 'RUNTIME_STATE_RECOVERY_FAILED',
              reloadError:reloadError?.message || String(reloadError),
              reason:persistenceReason,
              restoredVersion:expectedVersion
            });
          } else {
            startupFailure={
              code:reloadError?.code || 'RUNTIME_STATE_RECOVERY_FAILED',
              message:reloadError?.message || String(reloadError),
              at:new Date().toISOString(),
              retryable:isRetryableStartupFailure(reloadError),
              phase:'runtime'
            };
            scheduleStartupRecovery();
            structuredLog('fatal',verifiedFallbackRestored ? 'runtime_state_recovery_read_only_shadow' : 'runtime_state_recovery_blocked',{
              persistenceCode:error?.code || '',
              persistenceError:error?.message || String(error),
              verifiedFallbackRestored,
              recovery:startupFailurePayload()
            });
          }
        }
        error.persistenceRecovery={
          ok:recoverySucceeded || (deferredPersistence && verifiedFallbackRestored),
          databaseReloaded:recoverySucceeded,
          verifiedFallbackRestored,
          reloadCode:reloadFailure?.code || '',
          reloadError:reloadFailure?.message || ''
        };
        throw error;
      }
    } finally {
      persistenceInFlight = Math.max(0, persistenceInFlight - 1);
      lastPersistenceDurationMs = Math.max(0, Date.now() - startedAt);
      lastPersistenceReason = persistenceReason;
    }
  };

  const queued = persistenceQueue.then(persist, persist).then(async result => {
    if (USE_POSTGRES && result?.committedState && Number(stateVersion) < Number(targetVersion)) {
      // A recovery reload can temporarily move the published runtime version
      // behind later writes that were already queued. As those durable commits
      // finish, republish their verified committed state in order so memory can
      // never remain behind PostgreSQL after the queue drains.
      publishCommittedState({
        committedState:result.committedState,
        version:targetVersion,
        liveStateBeforeReload:memoryState
      });
    }
    const committedDeferredPresence = includedPresenceGeneration > persistedPresenceGeneration;
    persistedPresenceGeneration = Math.max(persistedPresenceGeneration, includedPresenceGeneration);
    clearPersistedPresenceRowsThrough(persistedPresenceGeneration);
    lastPersistenceSuccess = {
      at:now(),
      stateVersion:targetVersion,
      database:result?.database || (USE_POSTGRES ? 'postgresql-relational' : 'json-file'),
      durationMs:lastPersistenceDurationMs,
      reason:persistenceReason
    };
    lastPersistenceFailure = null;
    lastPersistenceRecovery = { at:now(), ok:true, method:'commit', reason:persistenceReason, stateVersion:targetVersion };
    if (deferredPersistence || committedDeferredPresence) lastDeferredPersistenceFailure = null;
    if (!deferredPersistence) lastCriticalPersistenceFailure = null;
    const persistenceJobType = deferredPersistence ? 'PRESENCE_PERSISTENCE' : 'STATE_PERSISTENCE';
    await operationalJobs.resolveFailures(persistenceJobType, {
      recoveredAt:now(),
      stateVersion:targetVersion,
      reason:persistenceReason
    }).catch(() => {});
    if (committedDeferredPresence && persistenceJobType !== 'PRESENCE_PERSISTENCE') {
      await operationalJobs.resolveFailures('PRESENCE_PERSISTENCE', {
        recoveredAt:now(),
        stateVersion:targetVersion,
        reason:'presence_folded_into_foreground_commit'
      }).catch(() => {});
    }
    return result;
  }, async error => {
    const recovery = error?.persistenceRecovery || {};
    const disposition = classifyPersistenceFailure({
      metadata:effectiveMetadata,
      reason:persistenceReason,
      recoverySucceeded:recovery.databaseReloaded === true,
      verifiedFallbackRestored:recovery.verifiedFallbackRestored === true,
      usePostgres:USE_POSTGRES
    });
    lastPersistenceRecovery = {
      at:now(),
      ok:disposition.safelyRecovered,
      method:recovery.databaseReloaded ? 'database_reload' : recovery.verifiedFallbackRestored ? 'verified_shadow' : 'unrecovered',
      reason:persistenceReason,
      reloadCode:recovery.reloadCode || ''
    };
    lastPersistenceFailure = {
      at:now(),
      code:error?.code || 'PERSISTENCE_FAILED',
      message:error?.message || String(error),
      expectedVersion,
      targetVersion,
      reason:persistenceReason,
      durationMs:lastPersistenceDurationMs,
      deferred:disposition.deferred,
      recovered:disposition.safelyRecovered,
      critical:disposition.critical
    };
    if (disposition.deferred) lastDeferredPersistenceFailure = lastPersistenceFailure;
    if (disposition.critical) lastCriticalPersistenceFailure = lastPersistenceFailure;
    await operationalJobs.recordFailure(
      disposition.jobType,
      error,
      { expectedVersion, targetVersion, reason:persistenceReason, recovered:disposition.safelyRecovered },
      { maxAttempts:5, dedupKey:persistenceReason }
    ).catch(() => {});
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
  // selectiveDb already owns the two top-level arrays and clones only the rows
  // being changed. Re-cloning every historical attendance row on each heartbeat
  // made presence traffic compete with tasks, uploads and finance writes.
  memoryState = {
    ...memoryState,
    users: d.users || [],
    attendanceLogs: d.attendanceLogs || []
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
  const flushGeneration = presenceMutationGeneration;
  const rowIds = dirtyPresenceRowIdsThrough(flushGeneration);
  if (!rowIds.users.length && !rowIds.attendanceLogs.length) return null;
  const snapshot = selectiveDb({
    collections:['users','attendanceLogs'],
    collectionRowIds:rowIds
  });
  snapshotPresenceGenerations.set(snapshot, flushGeneration);
  presenceFlushPromise = save(snapshot, {
    actor:'system',
    reason,
    skipRevisionSnapshot:true,
    background:true,
    collections:['users','attendanceLogs'],
    collectionRowIds:rowIds
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
  const persistenceHealthy = persistenceReadiness({ criticalFailure:lastCriticalPersistenceFailure });
  const checks = {
    shuttingDown:!shuttingDown,
    startup:!startupFailure,
    database:database.ok,
    privateStorage:!!storage.ok,
    diskSpace:!diskCritical,
    backup:!BACKUP_REQUIRED || backups.ok,
    releaseCertificate:!RELEASE_CERTIFICATE_REQUIRED || releaseCertificate.ok,
    persistence:persistenceHealthy
  };
  const ok = Object.values(checks).every(Boolean);
  const reliabilityWarnings = [];
  if (diskWarning && !diskCritical) reliabilityWarnings.push(`Disk usage is above ${DISK_WARNING_PERCENT}%.`);
  if (lastDeferredPersistenceFailure) reliabilityWarnings.push('Presence persistence is temporarily deferred; foreground operations remain available while it retries.');
  else if (lastPersistenceFailure?.recovered) reliabilityWarnings.push('The most recent failed write was rolled back and verified state was recovered safely.');
  if (backups.warning === 'LATEST_BACKUP_ATTEMPT_FAILED') reliabilityWarnings.push('The latest backup attempt failed, but a recent verified recovery point remains available.');
  const base = {
    ok,
    backendVersion:BACKEND_PACKAGE_VERSION,
    status:ok ? 'READY' : 'NOT_READY',
    checkedAt:now(),
    uptimeSeconds:Math.round(process.uptime()),
    startedAt:serverStartedAt,
    checks,
    warning:reliabilityWarnings.join(' '),
    failedJobCount:failedJobs.length,
    startupFailure:startupFailurePayload()
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
      lastCriticalFailure:lastCriticalPersistenceFailure,
      lastDeferredFailure:lastDeferredPersistenceFailure,
      lastRecovery:lastPersistenceRecovery,
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

function startupFailurePayload() {
  if (!startupFailure) return null;
  return {
    code:startupFailure.code || 'BACKEND_STARTUP_MAINTENANCE',
    message:startupFailure.message || 'Backend startup validation failed.',
    at:startupFailure.at || serverStartedAt,
    retryable:Boolean(startupFailure.retryable),
    phase:startupFailure.phase || 'startup',
    readOnlyAvailable:Boolean(startupFailure.phase === 'runtime' && memoryState)
  };
}

function isRetryableStartupFailure(error = {}) {
  const code=String(error?.code || '').toUpperCase();
  const message=String(error?.message || error || '').toLowerCase();
  if (code === 'RELATIONAL_STATE_INTEGRITY_FAILURE') return false;
  if (message.includes('production startup blocked')) return false;
  if (message.includes('private file storage is not writable')) return false;
  if (message.includes('persistent storage')) return false;
  return USE_POSTGRES;
}

async function attemptStartupRecovery() {
  if (!startupFailure || shuttingDown || startupRecoveryInFlight) return startupRecoveryInFlight;
  if (!startupFailure.retryable) return null;
  const recoveryPhase=startupFailure.phase || 'runtime';
  if (recoveryPhase === 'runtime' && !runtimeRecoveryCanRun({
    queueDepth:persistenceQueueDepth,
    inFlight:persistenceInFlight,
    activeForegroundWrites:activeForegroundWriteRequests
  })) {
    structuredLog('warn','runtime_recovery_waiting_for_write_drain',{
      queueDepth:persistenceQueueDepth,
      inFlight:persistenceInFlight,
      activeForegroundWrites:activeForegroundWriteRequests
    });
    return false;
  }
  startupRecoveryInFlight=(async()=>{
    try {
      postgresReady=false;
      if (recoveryPhase === 'runtime' && memoryState) {
        // Runtime recovery must not call initStore(): doing so clears dirty
        // presence bookkeeping and reinitializes workspace revisions. Reconnect,
        // then reload one verified relational snapshot while preserving any
        // newer unsaved presence rows for their normal deferred retry.
        await ensurePostgres();
        await reloadCommittedState();
      } else {
        await initStore();
        await migrateLegacyCredentials();
      }
      const recovered=startupFailurePayload();
      startupFailure=null;
      lastCriticalPersistenceFailure=null;
      await operationalJobs.resolveFailures('STATE_PERSISTENCE', {
        recoveredAt:now(),
        stateVersion,
        reason:'runtime_integrity_recovered'
      }).catch(() => {});
      if (presenceMutationGeneration > persistedPresenceGeneration) schedulePresenceFlush(PRESENCE_FLUSH_RETRY_MS);
      if (startupRecoveryTimer) { clearInterval(startupRecoveryTimer); startupRecoveryTimer=null; }
      structuredLog('info','server_startup_recovered',{previousFailure:recovered,stateVersion,recoveryPhase});
      return true;
    } catch(error) {
      startupFailure={
        code:error?.code || 'STARTUP_RECOVERY_FAILED',
        message:error?.message || String(error),
        at:new Date().toISOString(),
        retryable:isRetryableStartupFailure(error),
        phase:recoveryPhase
      };
      if (!startupFailure.retryable && startupRecoveryTimer) { clearInterval(startupRecoveryTimer); startupRecoveryTimer=null; }
      structuredLog('warn','server_startup_recovery_waiting',startupFailurePayload());
      return false;
    } finally {
      startupRecoveryInFlight=null;
    }
  })();
  return startupRecoveryInFlight;
}

function scheduleStartupRecovery() {
  if (startupRecoveryTimer || !startupFailure?.retryable || shuttingDown) return;
  startupRecoveryTimer=setInterval(()=>{
    attemptStartupRecovery().catch(error=>structuredLog('error','server_startup_recovery_error',{code:error?.code || '',error:error?.message || String(error)}));
  },boundedEnvNumber('STARTUP_RECOVERY_INTERVAL_MS',30000,5000,300000));
  startupRecoveryTimer.unref?.();
}


const emptyAuthStore = () => ({ credentials: [], sessions: [], events: [] });

function readLocalAuthStore() {
  if (!ALLOW_JSON_FALLBACK) throw new Error('Local authentication storage is available only in the explicit development sandbox.');
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  if (!fs.existsSync(AUTH_FILE)) writeJsonAtomic(AUTH_FILE,emptyAuthStore());
  try {
    const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return {
      credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      events: Array.isArray(parsed.events) ? parsed.events : []
    };
  } catch (cause) {
    const error=new Error('Local authentication storage is unreadable. The existing file was preserved and startup was blocked instead of replacing credentials.');
    error.code='LOCAL_AUTH_STORE_CORRUPT';
    error.cause=cause;
    throw error;
  }
}

function writeLocalAuthStore(store = emptyAuthStore()) {
  if (!ALLOW_JSON_FALLBACK) throw new Error('Local authentication storage is available only in the explicit development sandbox.');
  writeJsonAtomic(AUTH_FILE,store);
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

async function recordAuthEventBestEffort(args = {}) {
  try {
    await recordAuthEvent(args);
    return true;
  } catch (error) {
    structuredLog('warn','auth_event_record_failed',{
      eventType:String(args?.eventType || 'AUTH_EVENT'),
      userId:String(args?.userId || ''),
      requestId:String(args?.req?.requestId || ''),
      code:error?.code || 'AUTH_EVENT_WRITE_FAILED'
    });
    return false;
  }
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
  void recordAuthEventBestEffort({ userId: credential.user_id, username: credential.username, eventType: lockedUntil ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', req, details: { failedAttempts: nextAttempts } });
  return { ...credential, failed_attempts:nextAttempts, locked_until:lockedUntil };
}

async function clearLoginFailures(credential = {}) {
  const cleared = { ...credential, failed_attempts:0, locked_until:null };
  const alreadyClear = Number(credential.failed_attempts || 0) === 0 && !credential.locked_until;
  if (alreadyClear) return cleared;
  if (USE_POSTGRES) await pool.query('UPDATE auth_credentials SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1', [credential.user_id]);
  else {
    const store = readLocalAuthStore();
    store.credentials = store.credentials.map(item => String(item.user_id) === String(credential.user_id) ? { ...item, failed_attempts: 0, locked_until: null, updated_at: now() } : item);
    writeLocalAuthStore(store);
  }
  return cleared;
}

async function updateCredentialPassword(userId = '', passwordHash = '', mustChangePassword = false, existingCredential = null) {
  const existing = existingCredential || await findCredentialByUserId(userId);
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
  return { ...existing, password_hash: passwordHash, must_change_password: Boolean(mustChangePassword), password_version: nextVersion, failed_attempts:0, locked_until:null, password_changed_at: changedAt };
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
    // One account has exactly one live session. Serialize concurrent sign-ins on
    // the credential row so two devices cannot both pass a revoke-then-insert
    // race and remain active together. The newest completed sign-in owns the
    // account session; the previous device fails closed on its next request.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT user_id FROM auth_credentials WHERE user_id=$1 FOR UPDATE', [session.user_id]);
      await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL', [session.user_id]);
      await client.query(
        `INSERT INTO auth_sessions(token_hash,user_id,csrf_token,password_version,created_at,expires_at,last_seen_at,ip_address,user_agent)
         VALUES($1,$2,$3,$4,$5,$6,$5,$7,$8)`,
        [session.token_hash, session.user_id, session.csrf_token, session.password_version, session.created_at, session.expires_at, session.ip_address || null, session.user_agent || null]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } else {
    const store = readLocalAuthStore();
    store.sessions = store.sessions.map(item => String(item.user_id) === session.user_id && !item.revoked_at ? { ...item, revoked_at:createdAt } : item);
    store.sessions.push(session);
    store.sessions = store.sessions.filter(item => new Date(item.expires_at).getTime() > Date.now() - 24 * 60 * 60 * 1000).slice(-5000);
    writeLocalAuthStore(store);
  }
  return { rawToken, ...session };
}

async function cleanupExpiredAuthSessions() {
  const cutoffMs=Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (USE_POSTGRES) {
    const result=await pool.query(
      `DELETE FROM auth_sessions
       WHERE expires_at < now() - interval '30 days'
          OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')`
    );
    return Number(result.rowCount || 0);
  }
  const store=readLocalAuthStore();
  const before=store.sessions.length;
  store.sessions=store.sessions.filter(item=>{
    const expiry=new Date(item.expires_at || 0).getTime();
    const revoked=new Date(item.revoked_at || 0).getTime();
    return expiry >= cutoffMs && (!item.revoked_at || revoked >= cutoffMs);
  }).slice(-5000);
  if (store.sessions.length !== before) writeLocalAuthStore(store);
  return before-store.sessions.length;
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
    const suppliedSessionContext = String(req.get?.('x-csrf-token') || '');
    const expectedSessionContext = String(auth.session.csrf_token || '');
    const suppliedContextMismatch = Boolean(
      suppliedSessionContext
      && expectedSessionContext
      && (
        suppliedSessionContext.length !== expectedSessionContext.length
        || !crypto.timingSafeEqual(Buffer.from(suppliedSessionContext), Buffer.from(expectedSessionContext))
      )
    );
    // Browsers share cookies across tabs. A second tab can therefore replace the
    // cookie while an older tab still has a different in-memory page token. Treat
    // that as a stale page context on both reads and writes, but do not clear the
    // shared cookie: the newer tab legitimately owns it.
    if (suppliedContextMismatch) {
      res.setHeader('X-Auth-Session-Context', 'changed');
      return res.status(409).json({
        ok:false,
        code:'AUTH_SESSION_CONTEXT_CHANGED',
        error:'This browser tab no longer owns the active sign-in. Reload this tab before continuing.'
      });
    }
    if (!isSafeMethod(req.method)) {
      if (!suppliedSessionContext || !expectedSessionContext) {
        return res.status(403).json({ ok: false, code: 'CSRF_TOKEN_INVALID', error: 'The security token is missing or invalid. Refresh the page and try again.' });
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}


async function requireFreshAuthenticatedRequestAfterBody(req, res, next) {
  try {
    const originalSessionHash = String(req.auth?.session?.token_hash || '');
    const originalUserId = String(req.auth?.user?.id || '');
    const refreshed = await resolveRequestAuthentication(req);
    const refreshedSessionHash = String(refreshed?.session?.token_hash || '');
    const refreshedUserId = String(refreshed?.user?.id || '');

    // Multipart parsing can legitimately take many minutes on a slow link. The
    // request was authenticated before multer began consuming the body, so the
    // original session may have been logged out/replaced while bytes were still
    // arriving. Re-resolve the exact cookie token before any persistent mutation.
    if (!refreshed || !originalSessionHash || refreshedSessionHash !== originalSessionHash || refreshedUserId !== originalUserId) {
      cleanupRequestTempUploads(req);
      res.setHeader('X-Auth-Session-Context', 'changed');
      return res.status(401).json({
        ok: false,
        code: 'AUTH_SESSION_EXPIRED_DURING_REQUEST',
        error: 'Your sign-in changed while this upload was in progress. The upload was not committed. Sign in again and retry.'
      });
    }

    req.auth = refreshed;
    return next();
  } catch (error) {
    cleanupRequestTempUploads(req);
    structuredLog('error', 'multipart_session_revalidation_failed', {
      requestId: req.requestId || '',
      code: error?.code || 'AUTH_REVALIDATION_FAILED'
    });
    return res.status(503).json({
      ok: false,
      code: 'AUTH_REVALIDATION_FAILED',
      error: 'The upload session could not be revalidated. Nothing was committed.'
    });
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
    const completionEventAt=parseDateMs(c.completedAt||c.finalApprovedAt||c.approvedAt||c.draftingCompletedAt||c.submittedAt||c.closedAt||c.deliveredAt) || latestCompletedFileTime || latestDocTime || 0;
    const end=completionEventAt || parseDateMs(c.updatedAt) || (times.length?Math.max(...times):0);
    let mins=Number(c.completionMinutes||c.durationMinutes||c.completionDurationMinutes||0)||0;
    if(!mins && start && end && end>=start) mins=Math.max(1, Math.round((end-start)/60000));
    if(!mins) mins=perfBaselineMinutes(c);
    mins=Math.max(1, Math.round(mins - perfBreakMinutes(c)));
    const submitted=parseDateMs(c.submittedAt||c.uploadedAt||c.draftingCompletedAt||c.completedAt);
    const reviewed=parseDateMs(c.reviewedAt||c.reviewApprovedAt||c.finalApprovedAt||c.approvedAt);
    const reviewMinutes=submitted && reviewed && reviewed>=submitted ? Math.max(1, Math.round((reviewed-submitted)/60000)) : (isCompletedCaseForPerf(c) ? (perfRevisionCount(c)>0?25:15) : 0);
    records.push({ id:`${taskId}::${userName}`.toLowerCase(), taskId, userName, userId:String(c.assigneeId||c.assignedUserId||c.ownerId||c.userId||''), caseType:perfCaseType(c), location:c.location||c.city||'', bank:c.bank||c.bankName||'', assignedAt:parseDateMs(c.assignedAt)||0, startedAt:start||0, completedAt:end||0, completionEventAt:completionEventAt||0, completionMonthKey:completionEventAt ? serverMonthKey(completionEventAt) : '', completionDateSource:completionEventAt ? 'explicit-lifecycle' : 'legacy-derived', totalCompletionMinutes:mins, reviewMinutes, revisionCount:perfRevisionCount(c), slaMet:true, createdFrom:'backend-lifecycle' });
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
  const dateFields = ['assignedAt','startedAt','draftStartedAt','createdAt','completedAt','completionEventAt','finishedAt','approvedAt','updatedAt','reviewStartedAt','reviewCompletedAt','reviewApprovedAt','finalApprovedAt'];
  const identityFields = ['id','taskId','userId','userName','assigneeName','assignedTo','designerName','caseType','type','location','bank','createdFrom','timingSource','completionMonthKey','completionDateSource'];
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
  if (parseDateMs(incoming.completionEventAt) > 0) {
    merged.completionEventAt = incoming.completionEventAt;
    merged.completionMonthKey = incoming.completionMonthKey || serverMonthKey(incoming.completionEventAt);
    merged.completionDateSource = incoming.completionDateSource || 'explicit-lifecycle';
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
  return parseDateMs(r.completionEventAt || r.finalApprovedAt || r.approvedAt || r.completedAt || r.finishedAt || r.reviewCompletedAt || r.updatedAt || r.createdAt) || 0;
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
  return [c.id, c.caseId, c.displayId, ...(Array.isArray(c.previousTaskIds) ? c.previousTaskIds : [])]
    .map(x => String(x || '').trim())
    .filter(Boolean);
}

function nextAvailableCaseIdentity(cases = [], requestedId = '', deletedProjectIds = []) {
  const requested=String(requestedId || '').trim();
  const used=new Set([
    ...(cases || []).flatMap(record=>getCaseIdentitySet(record)),
    ...(deletedProjectIds || []).map(value=>String(value || '').trim())
  ].filter(Boolean));
  if (requested && !used.has(requested)) return requested;
  const numbered=requested.match(/^(.*?)-(\d+)$/);
  const prefix=numbered?.[1] || requested || 'TASK';
  const width=Math.max(2,numbered?.[2]?.length || 0);
  const startingSerial=Math.max(1,Number(numbered?.[2] || 1));
  for (let serial=startingSerial + 1; serial < startingSerial + 100000; serial+=1) {
    const candidate=`${prefix}-${String(serial).padStart(width,'0')}`;
    if (!used.has(candidate)) return candidate;
  }
  const error=new Error('A unique task reference could not be allocated. Please retry.');
  error.statusCode=409;
  error.code='TASK_ID_ALLOCATION_FAILED';
  throw error;
}

function assertCaseDisplayIdentityAvailable(cases = [], candidate = {}, existing = null) {
  const immutableId=String(existing?.id || candidate?.id || '').trim();
  const requested=String(candidate?.displayId || candidate?.caseId || candidate?.id || '').trim();
  if (!requested) return;
  const conflict=(cases || []).find(record=>{
    if (!record) return false;
    if (immutableId && String(record.id || '').trim()===immutableId) return false;
    return getCaseIdentitySet(record).includes(requested);
  });
  if (!conflict) return;
  const error=new Error(`Task reference ${requested} is already used by another task.`);
  error.statusCode=409;
  error.code='TASK_DISPLAY_ID_CONFLICT';
  throw error;
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

function sendApiFailure(res, req, error, fallback = 'The request could not be completed.', extra = {}) {
  const status = Number(error?.statusCode || error?.status || 500) || 500;
  const safePath = sanitizeOperationalPath(req?.originalUrl || req?.url || '');
  const fingerprint = serverErrorFingerprint(error, { method:req?.method || '', path:safePath, code:error?.code || '' });
  const payload = publicApiErrorPayload({ error, status, fallback, requestId:req?.requestId || '', extra, fingerprint });
  if (status >= 500) {
    try { res.setHeader('X-Error-Fingerprint', fingerprint); } catch {}
    structuredLog('error','api_route_failure',{ requestId:req?.requestId || '', method:req?.method || '', path:safePath, status, code:error?.code || '', errorFingerprint:fingerprint, error:error?.message || 'Unexpected server error.' });
    operationalJobs.recordFailure('API_REQUEST', error, { requestId:req?.requestId || '', method:req?.method || '', path:safePath, errorFingerprint:fingerprint }, { maxAttempts:1 }).catch(()=>{});
  }
  return res.status(status).json(payload);
}

function authorizationDenied(req, res, code = 'FORBIDDEN', error = 'You do not have permission to perform this action.') {
  const actor = requestActor(req);
  recordAuthEvent({
    userId: actor.id,
    username: actor.username,
    eventType: 'AUTHORIZATION_DENIED',
    req,
    details: { code, method: req.method, path: sanitizeOperationalPath(req.originalUrl || req.url || ''), role: actor.role }
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

function normalizeReadByEntries(value) {
  if (Array.isArray(value)) return value.filter(entry => entry !== null && entry !== undefined && entry !== '');
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function readByEntryKeys(entry) {
  const raw = typeof entry === 'string'
    ? [entry]
    : [entry?.userId, entry?.id, entry?.username, entry?.name];
  return raw.map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
}

function actorReadKeys(actor = {}) {
  return [actor?.id, actor?.username, actor?.name]
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function readByIncludesActor(value, actor = {}) {
  const actorKeys = new Set(actorReadKeys(actor));
  if (!actorKeys.size) return false;
  return normalizeReadByEntries(value).some(entry => readByEntryKeys(entry).some(key => actorKeys.has(key)));
}

function appendReadByActor(value, actor = {}, readAt = now()) {
  const entries = normalizeReadByEntries(value);
  if (readByIncludesActor(entries, actor)) return entries;
  return [...entries, { name:actor?.name || '', username:actor?.username || '', userId:actor?.id || '', time:readAt }];
}

function normalizeNotificationForClient(notification = {}) {
  if (!notification || typeof notification !== 'object' || Array.isArray(notification)) return notification;
  return { ...notification, readBy:normalizeReadByEntries(notification.readBy) };
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

function assertProjectUpdateAuthorized(existing = {}, req = {}) {
  if (!existing || !existing.id) return;
  if (!canMutateCase(req.auth?.user || {}, existing, 'update')) {
    const error = new Error('You cannot modify this task.');
    error.statusCode = 403;
    error.code = 'TASK_UPDATE_FORBIDDEN';
    throw error;
  }
}

function authorizedProjectUpdate(existing = {}, incoming = {}, req = {}) {
  const actor = requestActor(req);
  const role = actor.role;
  if (!existing || !existing.id) return incoming;
  assertProjectUpdateAuthorized(existing, req);

  if (role === 'ADMIN' || role === 'MANAGER') {
    let next = preserveFinanceFields(existing, { ...existing, ...(incoming || {}) });
    const previousDisplayId = String(existing.displayId || existing.caseId || existing.id || '').trim();
    const requestedDisplayId = String(incoming.displayId || incoming.caseId || previousDisplayId || existing.id || '').trim();
    next.id = existing.id;
    next.displayId = requestedDisplayId || existing.id;
    next.caseId = next.displayId;
    next.previousTaskIds = [...new Set([
      ...(Array.isArray(existing.previousTaskIds) ? existing.previousTaskIds : []),
      ...(previousDisplayId && previousDisplayId !== next.displayId && previousDisplayId !== String(existing.id || '') ? [previousDisplayId] : [])
    ].map(value=>String(value || '').trim()).filter(Boolean))];
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

function requireCaseAction(action = 'read', snapshotOptions = {}) {
  return (req, res, next) => {
    const d = requestTaskDb(req,snapshotOptions);
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
    const transientState = readDb();
    const caseRecord = findCaseByAnyId(transientState.cases || [], req.params.id || '');
    if (!caseRecord) return res.status(404).json({ ok:false, code:'CASE_NOT_FOUND', error:'Case not found.' });
    if (!authorizeCase(req, res, caseRecord, action)) return;
    next();
  };
}

function financeMutationId(body = {}) {
  return String(body?.mutationId || body?.clientMutationId || '').trim().slice(0, 200);
}

function assertFinanceMutationReplayMatches(record = {}, mutationId = '', fingerprint = '', operation = '') {
  if (!mutationId) return null;
  const receipt = findFinanceMutationReceipt(record, mutationId);
  if (!receipt) return null;
  const storedFingerprint = String(receipt?.fingerprint || '').trim();
  const storedOperation = String(receipt?.operation || '').trim().toLowerCase();
  const requestedOperation = String(operation || '').trim().toLowerCase();
  if ((storedFingerprint && fingerprint && storedFingerprint !== fingerprint)
      || (storedOperation && requestedOperation && storedOperation !== requestedOperation)) {
    const error = new Error('This finance mutation ID was already used for a different payment change. Generate a new mutation ID and retry from the latest finance state.');
    error.statusCode = 409;
    error.code = 'FINANCE_MUTATION_ID_REUSE';
    error.currentFinanceVersion = Number(record?.financeVersion || 0);
    throw error;
  }
  return receipt;
}

async function resolveCommittedFinanceReplay({ caseId = '', mutationId = '', fingerprint = '', operation = '' } = {}) {
  if (!mutationId) return null;
  const readCommitted = () => {
    const committedState = USE_POSTGRES ? relationalShadowState : readDb();
    const committedCase = findCaseByAnyId(committedState?.cases || [], caseId);
    const receipt = committedCase ? assertFinanceMutationReplayMatches(committedCase, mutationId, fingerprint, operation) : null;
    return receipt ? { committedState, committedCase, receipt } : null;
  };
  const immediate = readCommitted();
  if (immediate) return immediate;

  // A retry can arrive while the first request is still inside the serialized
  // persistence queue. memoryState deliberately exposes queued writes so later
  // requests see current state, but that must not turn an uncommitted mutation
  // into success. If the exact mutation is pending, wait only for the queue that
  // already existed at this point, then re-check durable committed state.
  const pendingCase = findCaseByAnyId(memoryState?.cases || [], caseId);
  const pendingReceipt = pendingCase ? assertFinanceMutationReplayMatches(pendingCase, mutationId, fingerprint, operation) : null;
  if (!pendingReceipt) return null;
  const pendingQueue = persistenceQueue;
  await pendingQueue.catch(() => {});
  return readCommitted();
}

function assertExpectedFinanceVersion(record = {}, body = {}) {
  if (body.expectedFinanceVersion === undefined || body.expectedFinanceVersion === null || body.expectedFinanceVersion === '') return;
  const expected = Number(body.expectedFinanceVersion);
  const current = Number(record.financeVersion || 0);
  if (!Number.isFinite(expected) || expected !== current) {
    const error = new Error(`Finance data changed on the server. Expected finance version ${expected}, current version ${current}. Refresh before saving.`);
    error.statusCode = 409;
    error.code = 'FINANCE_VERSION_CONFLICT';
    error.currentFinanceVersion = current;
    throw error;
  }
}

function currentTaskVersion(record = {}) {
  const value = Number(record.taskVersion || 0);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function assertExpectedTaskVersion(existing = {}, incoming = {}, body = {}) {
  const current = currentTaskVersion(existing);
  const supplied = body.expectedTaskVersion ?? incoming.taskVersion;
  if (supplied === undefined || supplied === null || supplied === '') {
    if (current === 0) return;
    const error = new Error('This task was changed after your screen loaded. Refresh the task before saving.');
    error.statusCode = 409;
    error.code = 'TASK_VERSION_REQUIRED';
    error.currentTaskVersion = current;
    throw error;
  }
  const expected = Number(supplied);
  if (!Number.isFinite(expected) || expected !== current) {
    const error = new Error(`Task data changed on the server. Expected task version ${expected}, current version ${current}. Refresh before saving.`);
    error.statusCode = 409;
    error.code = 'TASK_VERSION_CONFLICT';
    error.currentTaskVersion = current;
    throw error;
  }
}

function taskMutationId(body = {}, incoming = {}) {
  const supplied = [
    body.mutationId,
    body.clientMutationId,
    incoming.mutationId,
    incoming.clientMutationId
  ].find(value => String(value || '').trim());
  return String(supplied || '').trim().slice(0, 200);
}

const TASK_MUTATION_FINGERPRINT_IGNORED_FIELDS = new Set([
  'mutationId','clientMutationId','expectedTaskVersion','taskVersion',
  'lastTaskMutationId','lastTaskMutationAt','lastTaskMutationFingerprint','lastTaskMutationOperation',
  'updatedAt','syncVersion'
]);

function canonicalTaskMutationValue(value) {
  if (Array.isArray(value)) return value.map(canonicalTaskMutationValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key=>!TASK_MUTATION_FINGERPRINT_IGNORED_FIELDS.has(key)).map(key=>[key,canonicalTaskMutationValue(value[key])]));
}

function taskMutationFingerprint(operation = 'update', payload = {}) {
  const canonical=JSON.stringify({operation:String(operation || 'update').trim().toLowerCase(),payload:canonicalTaskMutationValue(payload || {})});
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function assertTaskMutationReplayMatches(record = {}, mutationId = '', fingerprint = '', operation = '') {
  if (!mutationId || String(record.lastTaskMutationId || '') !== String(mutationId)) return false;
  const storedFingerprint=String(record.lastTaskMutationFingerprint || '').trim();
  const storedOperation=String(record.lastTaskMutationOperation || '').trim().toLowerCase();
  const requestedOperation=String(operation || '').trim().toLowerCase();
  if ((storedFingerprint && fingerprint && storedFingerprint !== fingerprint) || (storedOperation && requestedOperation && storedOperation !== requestedOperation)) {
    const error=new Error('This mutation ID was already used for a different task change. Generate a new mutation ID and retry from the latest task state.');
    error.statusCode=409;
    error.code='TASK_MUTATION_ID_REUSE';
    error.currentTaskVersion=currentTaskVersion(record);
    throw error;
  }
  return true;
}

function prepareDedicatedTaskMutation(req = {}, record = {}, operation = 'update') {
  const mutationId=taskMutationId(req.body || {}, {});
  const fingerprint=taskMutationFingerprint(operation,req.body || {});
  if (assertTaskMutationReplayMatches(record,mutationId,fingerprint,operation)) return { replay:true, mutationId, fingerprint, operation };
  assertExpectedTaskVersion(record,{},req.body || {});
  return { replay:false, mutationId:mutationId || `${operation}:${record.id || record.caseId}:${nanoid(12)}`, fingerprint, operation };
}

function commitDedicatedTaskMutation(record = {}, previous = {}, mutation = {}) {
  record.taskVersion=nextTaskVersion(previous || {});
  record.lastTaskMutationId=String(mutation.mutationId || '').slice(0,200);
  record.lastTaskMutationFingerprint=String(mutation.fingerprint || '').slice(0,128);
  record.lastTaskMutationOperation=String(mutation.operation || 'update').trim().toLowerCase().slice(0,80);
  record.lastTaskMutationAt=now();
  return record;
}

function completedTaskDocuments(record = {}) {
  const docs = [
    ...(Array.isArray(record.documents) ? record.documents : []),
    ...(Array.isArray(record.completedFiles) ? record.completedFiles : []),
    ...(Array.isArray(record.files) ? record.files : [])
  ];
  return docs.filter(doc => {
    const key = String(doc?.purpose || doc?.type || doc?.folder || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return ['FINAL','REVISIONFINAL','COMPLETED','COMPLETEDFILE','REVISEDFILE','REVISED COMPLETED'].map(value => value.replace(/[^A-Z0-9]/g, '')).includes(key);
  });
}

function assertTaskLifecycleTransition(existing = {}, next = {}, actor = {}) {
  const previousStatus = statusKey(existing.status);
  const nextStatus = statusKey(next.status);
  const actorRole=String(actor.role || '').toUpperCase();
  const leavingFinalStatus=['COMPLETED','CLOSED','APPROVED'].includes(previousStatus) && nextStatus !== previousStatus;
  if (leavingFinalStatus && !['ADMIN','MANAGER'].includes(actorRole)) {
    const error = new Error('A completed task must be reopened for revision by an Admin or Manager before more work can start.');
    error.statusCode = 403;
    error.code = 'TASK_REOPEN_FORBIDDEN';
    throw error;
  }
  const enteringProtectedStatus = ['INTERNALREVIEW','MANAGERREVIEW','COMPLETED','CLOSED','APPROVED'].includes(nextStatus) && nextStatus !== previousStatus;
  if (enteringProtectedStatus && completedTaskDocuments(next).length === 0) {
    const error = new Error('A completed work file must be stored before this task can enter review or completion.');
    error.statusCode = 409;
    error.code = 'COMPLETED_FILE_REQUIRED';
    throw error;
  }
  if (['COMPLETED','CLOSED','APPROVED'].includes(nextStatus) && nextStatus !== previousStatus && !['ADMIN','MANAGER'].includes(actorRole)) {
    const error = new Error('Only an Admin or Manager can approve and complete a task.');
    error.statusCode = 403;
    error.code = 'TASK_COMPLETION_FORBIDDEN';
    throw error;
  }
}

function nextTaskVersion(existing = {}) {
  return currentTaskVersion(existing) + 1;
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
  return (cases || []).find(c => [
    c.id,
    c.caseId,
    c.displayId,
    c.originalTaskId,
    ...(Array.isArray(c.previousTaskIds) ? c.previousTaskIds : [])
  ]
    .filter(Boolean)
    .some(value => String(value).trim() === target));
}
function financeResponsePatch(c = {}) {
  const patch = {
    id:c.id,
    caseId:c.caseId,
    updatedAt:c.updatedAt,
    syncVersion:c.syncVersion
  };
  for (const field of FINANCE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(c || {}, field)) patch[field] = structuredClone(c[field]);
  }
  return patch;
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
function upsertInlinePaymentLedger(d, c, status, body = {}, mutation = {}) {
  d.payments ||= [];
  c.ledger ||= {};
  c.history ||= [];
  c.paymentAuditTrail ||= [];

  const nowIso = now();
  const by = body.by || body.updatedBy || 'Admin';
  const caseKey = String(c.id || c.caseId || '').trim();
  const caseNo = c.caseId || c.displayId || c.originalTaskId || c.id || '';
  const caseIdentifiers = new Set([c.id,c.caseId,c.displayId,c.originalTaskId,caseKey,caseNo].map(value => String(value || '').trim()).filter(Boolean));
  const existing = d.payments.find(payment => payment?.source === 'INLINE_PAYMENT_STATUS'
    && String(payment.ledgerStatus || 'ACTIVE') === 'ACTIVE'
    && [payment.caseId,payment.caseNo,payment.taskId].some(value => caseIdentifiers.has(String(value || '').trim())));

  const previousPaymentStatus = normalizePaymentTrackingStatus(c.paymentTrackingStatus || c.paymentStatus || c.paymentReceived || c.ledger?.status || '');
  const previousAmountIn = nonNegativeFinanceNumber(c.ledger?.amountIn ?? c.paymentAmountIn, 0);
  const previousExpenses = nonNegativeFinanceNumber(c.ledger?.expenses, 0);
  const previousRefund = nonNegativeFinanceNumber(c.ledger?.refund ?? c.refundAmount, 0);
  const hasExplicitEstimate = hasOwnFinanceValue(body, 'estimate', 'estimateAmount', 'expectedAmount');
  const hasExplicitAmount = hasOwnFinanceValue(body, 'amount', 'amountIn', 'paymentAmountIn');
  const hasExplicitExpenses = hasOwnFinanceValue(body, 'expenses');
  const hasExplicitRefund = hasOwnFinanceValue(body, 'refund', 'refundAmount');
  const estimate = hasExplicitEstimate
    ? nonNegativeFinanceNumber(body.estimate ?? body.estimateAmount ?? body.expectedAmount, getCaseEstimateAmount(c))
    : getCaseEstimateAmount(c);
  const explicitAmount = body.amount ?? body.amountIn ?? body.paymentAmountIn;
  const amount = hasExplicitAmount ? nonNegativeFinanceNumber(explicitAmount, previousAmountIn) : previousAmountIn;
  const expenses = hasExplicitExpenses ? nonNegativeFinanceNumber(body.expenses, previousExpenses) : previousExpenses;
  const refund = hasExplicitRefund ? nonNegativeFinanceNumber(body.refund ?? body.refundAmount, previousRefund) : previousRefund;
  const requestedPaymentDate = String(body.paymentDate || body.date || c.paymentDate || c.ledger?.date || indiaDateKey(nowIso)).trim().slice(0, 10);
  const paymentDate = normalizeTaskDate(requestedPaymentDate, nowIso);
  if (!TASK_DATE_PATTERN.test(requestedPaymentDate) || paymentDate !== requestedPaymentDate) {
    const err = new Error('Payment date must be a valid date in YYYY-MM-DD format.');
    err.statusCode = 400;
    err.code = 'INVALID_PAYMENT_DATE';
    throw err;
  }
  if (paymentDate > indiaDateKey(nowIso)) {
    const err = new Error('Payment date cannot be in the future.');
    err.statusCode = 400;
    err.code = 'PAYMENT_DATE_IN_FUTURE';
    throw err;
  }
  for (const [label, value] of [['Estimate',estimate],['Amount received',amount],['Expenses',expenses],['Refund',refund]]) {
    if (!Number.isFinite(value) || value < 0 || value > 100_000_000) {
      const err = new Error(`${label} must be between ₹0 and ₹10,00,00,000.`);
      err.statusCode = 400;
      err.code = 'INVALID_FINANCE_AMOUNT';
      throw err;
    }
  }
  if (refund > amount) {
    const err = new Error('Refund cannot be greater than the total amount received.');
    err.statusCode = 400;
    err.code = 'REFUND_EXCEEDS_RECEIVED';
    throw err;
  }
  const accountingPeriod = getCaseTaskAccountingPeriod(c, body.accountingPeriod || paymentDate || nowIso);

  if (status === 'Paid' && amount <= 0) {
    const err = new Error('Amount received is required before marking payment as Paid.');
    err.statusCode = 400;
    throw err;
  }

  if (hasExplicitEstimate) {
    c.estimate = estimate;
    c.estimateAmount = estimate;
  }
  const computedStatus = deriveServerPaymentStatus({
    ...c,
    estimate,
    paymentAmountIn:amount,
    ledger:{ ...(c.ledger || {}), expectedAmount:estimate, amountIn:amount }
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
  c.paymentTime = body.paymentTime || c.paymentTime || localClock24FromMsServer(Date.now());
  c.payerName = body.payerName || body.receivedFrom || c.payerName || '';
  c.transactionId = body.transactionId || body.txnId || c.transactionId || '';
  c.ledger = {
    ...c.ledger,
    expectedAmount:estimate,
    amountIn:amount,
    expenses,
    refund,
    date:paymentDate,
    accountingPeriod,
    mode:body.mode || c.ledger?.mode || '',
    txnId:body.transactionId || body.txnId || c.ledger?.txnId || c.transactionId || '',
    receivedFrom:body.payerName || body.receivedFrom || c.ledger?.receivedFrom || c.payerName || c.customerName || '',
    note:body.note !== undefined ? String(body.note || '').trim() : (c.ledger?.note || ''),
    screenshot:body.screenshot !== undefined ? structuredClone(body.screenshot) : (c.ledger?.screenshot || null),
    status:computedStatus,
    paymentStatus:computedStatus,
    updatedAt:Date.now(),
    updatedBy:by,
    financeVersion:c.financeVersion,
    autoFilledFromPaymentStatus:amount > 0,
    financeLedgerLinked:amount > 0,
    financeLedgerId:existing?.id || c.ledger?.financeLedgerId || (amount > 0 ? nanoid(8) : c.ledger?.financeLedgerId)
  };
  const committedMutationId = String(mutation?.mutationId || financeMutationId(body)).trim().slice(0, 200);
  const committedMutationFingerprint = String(mutation?.fingerprint || '').trim();
  const committedMutationOperation = String(mutation?.operation || 'payment-status').trim().toLowerCase();

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
  if (c.paymentAuditTrail.length > 500) c.paymentAuditTrail = c.paymentAuditTrail.slice(0, 500);

  if (amount > 0) {
    const paymentValues = {
      caseNo,
      location:c.location || c.city || '',
      customerName:c.customerName || '',
      bankerName:c.bankerName || '',
      bank:c.client || c.bank || c.bankName || '',
      branch:c.branch || c.branchName || '',
      estimateAmount:estimate,
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
      note:auditNote,
      receiptFileId:c.ledger?.screenshot && typeof c.ledger.screenshot === 'object' ? (c.ledger.screenshot.id || '') : '',
      financeMutationId:committedMutationId || c.lastFinanceMutationId || ''
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

  if (committedMutationId) {
    rememberFinanceMutationReceipt(c, {
      mutationId:committedMutationId,
      fingerprint:committedMutationFingerprint,
      operation:committedMutationOperation,
      financeVersion:c.financeVersion,
      paymentId:String(c.ledger?.financeLedgerId || existing?.id || ''),
      committedAt:nowIso
    });
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
  if (c.history.length > 1000) c.history = c.history.slice(0, 1000);
  addCaseTimelineEvent(c, {
    type:'payment_updated',
    by,
    title:`Payment ${computedStatus}`,
    remarks:`Accounting month ${accountingPeriod}${movementParts.length ? ` • ${movementParts.join(', ')}` : ''}`
  });
  addAudit(d, by, `Finance updated for ${accountingPeriod}: ${computedStatus}`, caseNo);
  return c;
}

const PRESENCE_STALE_MS = boundedEnvNumber('PRESENCE_STALE_MS', 2 * 60 * 1000, 60_000, 30 * 60 * 1000);
const PRESENCE_ATTENDANCE_MAX_GAP_MS = boundedEnvNumber('PRESENCE_ATTENDANCE_MAX_GAP_MS', 10 * 60 * 1000, 2 * 60 * 1000, 60 * 60 * 1000);
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
const teamIdentityKey = (u = {}) => String(u?.username || u?.name || u?.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
function publicTeamUser(user = {}) {
  const u = sanitizePresenceUser(user);
  return {
    id:u.id || '', username:u.username || '', name:u.name || '', role:u.role || '', status:u.status || '',
    designation:u.designation || '', profilePhoto:u.profilePhoto || '', profilePhotoVersion:u.profilePhotoVersion || '',
    isOnline:Boolean(u.isOnline), availability:u.availability || 'Unavailable', lastSeenAt:u.lastSeenAt || null,
    lastHeartbeatAt:u.lastHeartbeatAt || null, lastLoginAt:u.lastLoginAt || null, lastLogoutAt:u.lastLogoutAt || null,
    availabilityUpdatedAt:u.availabilityUpdatedAt || null, breakStartedAt:u.breakStartedAt || null
  };
}
function scopedUsers(d = {}, req = {}) {
  const actor = requestActor(req);
  return sanitizePresenceUsers(d.users || []).map(user => {
    const own = String(user.id || '') === String(actor.id || '') || normalizeUsername(user.username) === normalizeUsername(actor.username || '');
    return own ? stripCredentialFields(user) : publicTeamUser(user);
  });
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

const INDIA_DATE_KEY_FORMATTER_SERVER = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' });
const INDIA_CLOCK_24_FORMATTER_SERVER = new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit', hour12:false });
function localClock24FromMsServer(value = Date.now()) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return INDIA_CLOCK_24_FORMATTER_SERVER.format(new Date(Number.isFinite(timestamp) ? timestamp : Date.now()));
}

function localDateKeyFromMsServer(value = Date.now()) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
  const parts = INDIA_DATE_KEY_FORMATTER_SERVER.formatToParts(new Date(safeTimestamp));
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : new Date(safeTimestamp).toISOString().slice(0,10);
}
function parseAttendanceClockServer(dateKey, clockValue = '') {
  return parseIndiaAttendanceClock(dateKey, clockValue);
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
    let firstLoginAt = toMs(raw.firstLoginAt) || loginAt;
    if (firstLoginAt && localDateKeyFromMsServer(firstLoginAt) !== dateKey) firstLoginAt = loginAt || parsedLogin || 0;
    const explicitBreakMinutes = (Array.isArray(raw.breakEvents) ? raw.breakEvents : []).reduce((sum, ev) => {
      const explicit = Number(ev?.minutes);
      const start = toMs(ev?.start);
      const end = toMs(ev?.end);
      const derived = start && end ? (end - start) / 60000 : 0;
      return sum + Math.max(0, Math.floor(Number.isFinite(explicit) ? explicit : derived));
    }, 0);
    const normalized = {
      ...raw,
      id,
      userId: raw.userId || user.id || '',
      name: raw.name || user.name || '',
      role: normalizeRole(raw.role || user.role || 'Designer'),
      date: dateKey,
      loginAt: loginAt || null,
      firstLoginAt: firstLoginAt || loginAt || null,
      loginTime: raw.loginTime || (loginAt ? new Date(loginAt).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Kolkata' }) : ''),
      firstLogin: raw.firstLogin || raw.loginTime || (loginAt ? new Date(loginAt).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Kolkata' }) : ''),
      logoutAt: logoutAt || null,
      logoutTime: raw.logoutTime || (logoutAt && logoutAt !== loginAt ? new Date(logoutAt).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Kolkata' }) : ''),
      totalLoggedInMinutes: Math.max(0, Math.floor(Number(raw.totalLoggedInMinutes) || 0)),
      activeMinutes: Math.max(0, Math.floor(Number(raw.activeMinutes) || 0)),
      totalBreakMinutes: Math.max(0, Math.floor(Number(raw.totalBreakMinutes || raw.breakMinutes || 0) || 0), explicitBreakMinutes),
      breakEvents: Array.isArray(raw.breakEvents) ? raw.breakEvents : [],
      currentBreakStartedAt: raw.currentBreakStartedAt || null,
      attendanceAccrualRemainderMs: Math.max(0, Math.min(59_999, Math.floor(Number(raw.attendanceAccrualRemainderMs) || 0))),
      presenceGapMinutes: Math.max(0, Math.floor(Number(raw.presenceGapMinutes) || 0)),
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


function serverTodayKey(ms = Date.now()) { return localDateKeyFromMsServer(ms); }
function serverClockTime(ms = Date.now()) { return localClock24FromMsServer(ms); }
function findAttendanceLogIndex(logs = [], user = {}, dateKey = serverTodayKey()) {
  const id = `${user.id || user.username || user.name}_${dateKey}`;
  const nameKey = String(user.name || '').toLowerCase().trim();
  return (logs || []).findIndex(l => String(l.id) === id || (String(l.userId || '') && String(l.userId) === String(user.id || '') && l.date === dateKey) || (nameKey && String(l.name || '').toLowerCase().trim() === nameKey && l.date === dateKey));
}
function upsertAttendanceFromPresence(d, user = {}, action = 'heartbeat', nowMs = Date.now(), previousUser = {}) {
  d.attendanceLogs = Array.isArray(d.attendanceLogs) ? d.attendanceLogs : [];
  const role = normalizeRole(user.role || 'Designer');
  if (role === 'Admin') return null;
  const dateKey = serverTodayKey(nowMs);
  const timeStr = serverClockTime(nowMs);
  const idx = findAttendanceLogIndex(d.attendanceLogs, user, dateKey);
  const existing = idx >= 0 ? d.attendanceLogs[idx] : null;
  // A daily row begins on the first accepted presence command for that India
  // calendar day. Never carry yesterday's login clock into a new row: after a
  // suspended laptop or overnight network gap that inflated today's attendance.
  const loginAt = toMs(existing?.loginAt) || toMs(existing?.firstLoginAt) || nowMs;
  const lastTick = toMs(existing?.lastTick) || toMs(existing?.logoutAt) || loginAt;
  const previousBreakStart = toMs(existing?.currentBreakStartedAt) || toMs(previousUser?.breakStartedAt) || toMs(user.breakStartedAt);
  const wasOnBreak = !!previousBreakStart || String(existing?.status || '').toLowerCase().includes('break') || String(previousUser?.availability || '').toLowerCase() === 'break';
  const isBreakAction = action === 'break' || String(user.availability || '').toLowerCase() === 'break';
  const accrual = existing && action !== 'login'
    ? computeAttendanceAccrual({
        lastTick,
        loginAt,
        nowMs,
        remainderMs:existing?.attendanceAccrualRemainderMs,
        maxGapMs:PRESENCE_ATTENDANCE_MAX_GAP_MS
      })
    : { wholeMinutes:0, remainderMs:0, ignoredGapMinutes:0 };
  const elapsed = Math.max(0, Math.floor(Number(accrual.wholeMinutes) || 0));
  let totalLoggedInMinutes = Math.max(0, Math.floor(Number(existing?.totalLoggedInMinutes) || 0));
  let activeMinutes = Math.max(0, Math.floor(Number(existing?.activeMinutes) || 0));
  let totalBreakMinutes = Math.max(0, Math.floor(Number(existing?.totalBreakMinutes || existing?.breakMinutes || 0) || 0));
  if (existing && action !== 'login') {
    totalLoggedInMinutes += elapsed;
    if (wasOnBreak) totalBreakMinutes += elapsed; else activeMinutes += elapsed;
  }
  const events = Array.isArray(existing?.breakEvents) ? existing.breakEvents.map(ev => ({ ...ev })) : [];
  // Break-event minutes are accumulated from the same bounded heartbeat delta as
  // the daily counters. Do not derive a completed break from wall-clock start/end:
  // a suspended laptop or disconnected browser could otherwise turn an ignored
  // presence gap back into hours of break time when Resume finally arrives.
  if (existing && wasOnBreak && action !== 'login') {
    for (const ev of events) {
      if (ev.start && !ev.end) {
        const savedMinutes = Number(ev.minutes);
        ev.minutes = Math.max(0, Math.floor((Number.isFinite(savedMinutes) ? savedMinutes : 0) + elapsed));
        ev.lastAccruedAt = nowMs;
        ev.source = ev.source || 'presence';
      }
    }
  }
  if (action === 'break' && !events.some(ev => ev.start && !ev.end)) {
    const breakStart = previousBreakStart || nowMs;
    events.push({ id: `break_${breakStart}`, start: breakStart, startTime: serverClockTime(breakStart), minutes:0, lastAccruedAt:nowMs, source: 'presence' });
  }
  if ((action === 'resume' || action === 'logout') && events.some(ev => ev.start && !ev.end)) {
    for (const ev of events) {
      if (ev.start && !ev.end) {
        ev.end = nowMs;
        ev.endTime = timeStr;
        const savedMinutes = Number(ev.minutes);
        ev.minutes = Math.max(0, Math.floor(Number.isFinite(savedMinutes) ? savedMinutes : 0));
        ev.lastAccruedAt = nowMs;
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
    attendanceAccrualRemainderMs:Math.max(0, Math.min(59_999, Math.floor(Number(accrual.remainderMs) || 0))),
    presenceGapMinutes:Math.max(0, Math.floor(Number(existing?.presenceGapMinutes) || 0) + Math.floor(Number(accrual.ignoredGapMinutes) || 0)),
    presenceSource: 'backend-heartbeat-v4'
  };
  const normalizedLog = normalizeAttendanceLogsForSave([log], d.users || [user])[0] || log;
  if (idx >= 0) d.attendanceLogs[idx] = normalizedLog; else d.attendanceLogs.push(normalizedLog);
  return normalizedLog;
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

function applyPresenceUpdate(d, userPatch = {}, action = 'heartbeat', command = { legacy:true }) {
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
    const alreadyOnBreak = String(existing?.availability || '').toLowerCase() === 'break' && toMs(existing?.breakStartedAt);
    next.availability = 'Break';
    next.breakStartedAt = alreadyOnBreak || toMs(userPatch.breakStartedAt) || nowMs;
    next.availabilityUpdatedAt = alreadyOnBreak ? (existing.availabilityUpdatedAt || next.breakStartedAt) : nowMs;
  } else if (action === 'resume') {
    next.availability = 'Available';
    next.breakStartedAt = null;
    next.availabilityUpdatedAt = nowMs;
  } else if (action === 'login') {
    // A new authenticated presence epoch starts available. Stale break/offline
    // state from a previous browser session must not leak into the new session.
    next.availability = 'Available';
    next.breakStartedAt = null;
    next.availabilityUpdatedAt = nowMs;
  } else if (action === 'heartbeat') {
    // Heartbeats are liveness-only. They never change availability or break
    // state, so a slow pre-break heartbeat cannot undo a later Break/Resume.
    const authoritativeAvailability = ['Available','Busy','Break'].includes(String(existing?.availability || ''))
      ? String(existing.availability)
      : 'Available';
    next.availability = authoritativeAvailability;
    next.breakStartedAt = authoritativeAvailability === 'Break' ? (existing?.breakStartedAt || next.breakStartedAt || nowMs) : null;
    next.availabilityUpdatedAt = existing?.availabilityUpdatedAt || next.availabilityUpdatedAt || nowMs;
  } else if (action === 'logout') {
    next.availability = 'Unavailable';
    next.breakStartedAt = null;
    next.availabilityUpdatedAt = nowMs;
  }
  applyPresenceClientCommandMetadata(next, command);
  const savedUser = sanitizePresenceUser(next, nowMs);
  if (idx >= 0) d.users[idx] = savedUser; else d.users.push(savedUser);
  const attendanceLog = upsertAttendanceFromPresence(d, savedUser, action, nowMs, existing);
  return { user:savedUser, attendanceLog };
}


const otpStore = new Map();
const OTP_STORE_MAX = boundedEnvNumber('OTP_STORE_MAX', 2000, 100, 20000);
function pruneOtpChallenges(referenceTime = Date.now()) {
  for (const [challengeId, record] of otpStore.entries()) {
    if (!record || Number(record.expiresAt || 0) <= referenceTime) otpStore.delete(challengeId);
  }
  if (otpStore.size <= OTP_STORE_MAX) return otpStore.size;
  const oldest=[...otpStore.entries()]
    .sort((a,b)=>Number(a[1]?.createdAt || a[1]?.expiresAt || 0)-Number(b[1]?.createdAt || b[1]?.expiresAt || 0));
  for (const [challengeId] of oldest.slice(0,otpStore.size-OTP_STORE_MAX)) otpStore.delete(challengeId);
  return otpStore.size;
}
function storeOtpChallenge(challengeId, record = {}) {
  pruneOtpChallenges();
  if (otpStore.size >= OTP_STORE_MAX) {
    const oldest=otpStore.keys().next().value;
    if (oldest) otpStore.delete(oldest);
  }
  otpStore.set(challengeId,{...record,createdAt:Number(record.createdAt || Date.now())});
  return challengeId;
}
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
  const notification={id:nanoid(8),to,text,category,target,status:'UNREAD',readBy:[],createdAt:now()};
  d.notifications.unshift(notification);
  return notification;
}
function notifyRole(d, role, text, category='normal', target=''){ return notify(d,role,text,category,target); }
function notifyUser(d, userIdOrName, text, category='normal', target=''){ return notify(d,userIdOrName,text,category,target); }
function nextCaseNo(d, city='Lucknow', referenceTime=Date.now()){
  const code=String(city || 'LKO').replace(/[^a-z0-9]/gi,'').slice(0,3).toUpperCase() || 'LKO';
  const year=indiaDateKey(referenceTime).slice(0,4);
  const prefix=`KD-${code}-${year}-`;
  const used=new Set();
  let maximum=0;
  for (const record of d?.cases || []) {
    for (const value of [record?.caseId,record?.displayId,record?.id]) {
      const id=String(value || '').trim();
      if (!id) continue;
      used.add(id.toUpperCase());
      if (!id.toUpperCase().startsWith(prefix)) continue;
      const suffix=Number(id.slice(prefix.length));
      if (Number.isInteger(suffix) && suffix > maximum) maximum=suffix;
    }
  }
  let sequence=maximum+1;
  let candidate=`${prefix}${String(sequence).padStart(2,'0')}`;
  while (used.has(candidate.toUpperCase())) {
    sequence+=1;
    candidate=`${prefix}${String(sequence).padStart(2,'0')}`;
  }
  return candidate;
}
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
    uploadMutationId: doc.uploadMutationId || '',
    uploadContentIdentity: doc.uploadContentIdentity || '',
    purpose: doc.purpose || doc.type || 'FILE',
    type: doc.type || doc.folder || '',
    folder: doc.folder || doc.type || '',
    uploadedBy: doc.uploadedBy || doc.by || 'Team',
    uploadedByRole: doc.uploadedByRole || '',
    uploadedById: doc.uploadedById || '',
    uploadedByUsername: doc.uploadedByUsername || '',
    uploadedAt: doc.uploadedAt || now(),
    storedAt: doc.storedAt || doc.uploadedAt || now(),
    securityStatus: doc.securityStatus || (doc.sha256 ? 'VALIDATED' : 'LEGACY_UNVERIFIED'),
    antivirusStatus: doc.antivirusStatus || (doc.sha256 ? 'NOT_CONFIGURED' : 'LEGACY_UNSCANNED'),
    antivirusEngine: doc.antivirusEngine || '',
    storageProvider: doc.storageProvider || (String(storageKey).startsWith('objects/') ? 'local-private' : 'legacy-local'),
    storageStatus: doc.storageStatus || 'UNKNOWN',
    chatScope: doc.chatScope || '',
    chatParticipants: Array.isArray(doc.chatParticipants) ? doc.chatParticipants : [],
    isVoiceNote: Boolean(doc.isVoiceNote),
    url: `/api/files/${doc.id}/download`,
    previewUrl: `/api/files/${doc.id}/preview`,
    downloadUrl: `/api/files/${doc.id}/download`
  };
  const resolved = resolveStoredUploadFile(entry);
  const requestedStorageStatus=String(entry.storageStatus || '').toUpperCase();
  entry.storageStatus = ['DELETED','EXPIRED'].includes(requestedStorageStatus)
    ? requestedStorageStatus
    : (resolved ? 'AVAILABLE' : 'MISSING');
  if (['DELETED','EXPIRED'].includes(entry.storageStatus)) entry.url = entry.previewUrl = entry.downloadUrl = '';
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
    storageProvider: doc.storageProvider || entry.storageProvider,
    uploadMutationId: doc.uploadMutationId || entry.uploadMutationId || '',
    uploadContentIdentity: doc.uploadContentIdentity || entry.uploadContentIdentity || '',
    uploadedById: doc.uploadedById || entry.uploadedById || '',
    uploadedByUsername: doc.uploadedByUsername || entry.uploadedByUsername || '',
    isVoiceNote: Boolean(doc.isVoiceNote || entry.isVoiceNote)
  });
  return doc;
}
function allKnownFileDocs(d={}){
  const caseDocs = (Array.isArray(d.cases) ? d.cases : []).flatMap(c => [
    ...(Array.isArray(c.documents) ? c.documents : []),
    ...(Array.isArray(c.completedFiles) ? c.completedFiles : []),
    ...(Array.isArray(c.sourceFiles) ? c.sourceFiles : []),
    ...(Array.isArray(c.workFiles) ? c.workFiles : []),
    ...(Array.isArray(c.files) ? c.files : []),
    ...(Array.isArray(c.uploads) ? c.uploads : []),
    ...(Array.isArray(c.attachments) ? c.attachments : []),
    ...(c.file ? [c.file] : [])
  ].filter(Boolean));
  const chatDocs = (Array.isArray(d.teamChat) ? d.teamChat : []).flatMap(m => [
    ...(Array.isArray(m.files) ? m.files : []),
    ...(Array.isArray(m.attachments) ? m.attachments : []),
    ...(m.file ? [m.file] : [])
  ].filter(Boolean));
  return [...(Array.isArray(d.files) ? d.files : []), ...caseDocs, ...chatDocs].filter(Boolean);
}

function fileStorageKey(doc={}) {
  return String(doc.storageKey || doc.storedName || doc.stored_name || '').trim();
}
function activeFileStorageKeys(d={}) {
  const keys=new Set();
  for (const doc of allKnownFileDocs(d)) {
    if (['DELETED','EXPIRED'].includes(String(doc?.storageStatus || '').toUpperCase())) continue;
    const key=fileStorageKey(doc);
    if (key.startsWith('objects/')) keys.add(key);
  }
  return keys;
}
function deletedFileStorageCandidateTimes(d={}) {
  const times=new Map();
  for (const doc of d.files || []) {
    if (!['DELETED','EXPIRED'].includes(String(doc?.storageStatus || '').toUpperCase())) continue;
    const key=fileStorageKey(doc);
    if (!key.startsWith('objects/')) continue;
    const deletedAt=parseDateMs(doc.deletedAt || doc.storageDeletedAt || doc.expiredAt || 0);
    times.set(key, Math.max(times.get(key) || 0, deletedAt || 0));
  }
  return times;
}
async function collectFileStorageGarbage({ actor='system', graceMs=FILE_STORAGE_GC_GRACE_MS }={}) {
  const safeGraceMs=boundedNumber(graceMs, FILE_STORAGE_GC_GRACE_MS, 0, 30 * 24 * 60 * 60 * 1000);
  const startedAt=Date.now();
  const initial=readDb();
  const active=activeFileStorageKeys(initial);
  const deletedTimes=deletedFileStorageCandidateTimes(initial);
  const result={ scanned:0, movedToTrash:0, retainedActive:0, retainedLeased:0, retainedGrace:0, missing:0, errors:[] };
  for (const object of fileStorage.listObjects()) {
    result.scanned += 1;
    const key=String(object.storageKey || '');
    if (active.has(key)) { result.retainedActive += 1; continue; }
    let stat;
    try { stat=fs.statSync(object.fp); } catch { result.missing += 1; continue; }
    const candidateAt=Math.max(Number(stat.mtimeMs || 0), Number(deletedTimes.get(key) || 0));
    if (startedAt - candidateAt < safeGraceMs) { result.retainedGrace += 1; continue; }
    if (fileStorage.hasActiveLease(key)) { result.retainedLeased += 1; continue; }
    // Re-read immediately before the physical move. This catches task/file rows
    // committed after the initial scan, while the cross-process lease covers an
    // upload that has stored/deduplicated the object but has not committed yet.
    if (activeFileStorageKeys(readDb()).has(key)) { result.retainedActive += 1; continue; }
    if (fileStorage.hasActiveLease(key)) { result.retainedLeased += 1; continue; }
    try {
      const target=fileStorage.softDelete(key,{actor,reason:'UNREFERENCED_AFTER_GRACE',graceMs:safeGraceMs});
      if (!target) {
        if (fileStorage.hasActiveLease(key)) result.retainedLeased += 1;
        else result.missing += 1;
        continue;
      }
      result.movedToTrash += 1;
      await recordFileStorageEvent({action:'FILE_OBJECT_TRASHED',actor,storageKey:key,details:{trashPath:path.relative(fileStorage.root,target),graceMs:safeGraceMs}});
    } catch(error) {
      result.errors.push({storageKey:key,error:error.message || String(error)});
    }
  }
  return { ...result, ok:result.errors.length===0, graceMs:safeGraceMs, completedAt:now() };
}
async function runAutomaticFileRetention({ actor='storage-retention' } = {}) {
  if (startupFailure || shuttingDown) return { ok:false, skipped:true, reason:startupFailure ? 'startup-maintenance' : 'shutting-down' };
  const snapshot=db();
  const retention=applyFileRetentionToState(snapshot,{nowMs:Date.now(),retentionDays:FILE_RETENTION_DAYS,actor});
  if (retention.expiredIds.length) {
    const collections=['files'];
    const collectionRowIds={files:retention.expiredIds};
    if (retention.changedCaseIds.length) { collections.push('cases'); collectionRowIds.cases=retention.changedCaseIds; }
    if (retention.changedMessageIds.length) { collections.push('teamChat'); collectionRowIds.teamChat=retention.changedMessageIds; }
    await save(snapshot,{actor,reason:'automatic_file_retention',takeSnapshotOwnership:true,collections,collectionRowIds});
    for (const id of retention.expiredIds) {
      const doc=(snapshot.files || []).find(item=>String(item?.id || '')===String(id));
      await recordFileStorageEvent({fileId:id,caseId:doc?.caseId || '',action:'FILE_EXPIRED',actor,storageKey:fileStorageKey(doc || {}),sha256:doc?.sha256 || '',details:{retentionDays:FILE_RETENTION_DAYS,financeProtected:false}}).catch(()=>{});
    }
  }
  // Once logical expiry has committed, objects with no remaining active references
  // can move to recoverable trash. Trash itself is permanently purged after its
  // own short safety window, so the disk is actually reclaimed rather than merely
  // moving bytes to another directory on the same filesystem.
  const gc=await collectFileStorageGarbage({actor,graceMs:0});
  const trash=fileStorage.pruneTrash(Date.now());
  const result={ok:gc.ok,completedAt:now(),retentionDays:FILE_RETENTION_DAYS,expiredRecords:retention.expiredIds.length,protectedFinancialOrProfileRecords:retention.protectedIds.length,unknownAgeRetained:retention.unknownAgeIds.length,movedToTrash:gc.movedToTrash,trashFilesPurged:trash.deletedFiles,bytesFreedFromTrash:trash.freedBytes,errors:gc.errors};
  structuredLog(result.ok ? 'info' : 'warn','automatic_file_retention_completed',result);
  await recordOperationalEvent(pool,USE_POSTGRES,{eventType:'STORAGE_RETENTION_COMPLETED',severity:result.ok ? 'INFO' : 'WARN',actor,details:result}).catch(()=>{});
  return result;
}

function scheduleAutomaticFileRetention() {
  if (storageRetentionInitialTimer || storageRetentionTimer) return;
  storageRetentionInitialTimer=setTimeout(()=>{
    storageRetentionInitialTimer=null;
    runAutomaticFileRetention().catch(error=>{
      structuredLog('error','automatic_file_retention_failed',{code:error?.code || '',error:error?.message || String(error)});
      operationalJobs.recordFailure('STORAGE_RETENTION',error,{retentionDays:FILE_RETENTION_DAYS},{maxAttempts:1}).catch(()=>{});
    });
  },FILE_RETENTION_START_DELAY_MS);
  storageRetentionInitialTimer.unref?.();
  storageRetentionTimer=setInterval(()=>{
    runAutomaticFileRetention().catch(error=>{
      structuredLog('error','automatic_file_retention_failed',{code:error?.code || '',error:error?.message || String(error)});
      operationalJobs.recordFailure('STORAGE_RETENTION',error,{retentionDays:FILE_RETENTION_DAYS},{maxAttempts:1}).catch(()=>{});
    });
  },FILE_RETENTION_INTERVAL_MS);
  storageRetentionTimer.unref?.();
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
        ...(Array.isArray(c.documents) ? c.documents : []), ...(Array.isArray(c.completedFiles) ? c.completedFiles : []),
        ...(Array.isArray(c.sourceFiles) ? c.sourceFiles : []), ...(Array.isArray(c.workFiles) ? c.workFiles : []),
        ...(Array.isArray(c.files) ? c.files : []), ...(Array.isArray(c.uploads) ? c.uploads : []),
        ...(Array.isArray(c.attachments) ? c.attachments : []), ...(c.file ? [c.file] : [])
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
  const unavailableStatus=String(result.doc?.storageStatus || '').toUpperCase();
  if (result.doc && unavailableStatus === 'DELETED') {
    res.status(410).json({ok:false,code:'FILE_DELETED',error:'This file was deleted and retained only as an audit record.'});
    return { d, doc:null, resolved:null, denied:true };
  }
  if (result.doc && unavailableStatus === 'EXPIRED') {
    res.status(410).json({ok:false,code:'FILE_RETENTION_EXPIRED',error:`This file expired under the ${Number(result.doc.retentionDays || FILE_RETENTION_DAYS)}-day storage-retention policy.`});
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
    if (['DELETED','EXPIRED'].includes(String(doc.storageStatus || '').toUpperCase())) {
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
function credentialSafeProfileUser(user = {}) {
  const credentialSafeUser = stripCredentialFields(user);
  for (const field of Object.keys(user)) if (!Object.hasOwn(credentialSafeUser,field)) delete user[field];
  return user;
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

const sanitizedCaseResponseCache = new WeakMap();
function caseSanitizationStamp(caseRecord = {}) {
  return [
    caseRecord.updatedAt,
    caseRecord.taskVersion,
    caseRecord.financeVersion,
    caseRecord.lastTaskMutationAt,
    Array.isArray(caseRecord.history) ? caseRecord.history.length : 0,
    Array.isArray(caseRecord.documents) ? caseRecord.documents.length : 0
  ].join(':');
}
function sanitizeCasesForRole(cases = [], role = '') {
  const normalizedRole = normalizeAuthRole(role);
  const records = (cases || []).filter(Boolean);
  // Admins are allowed to receive the authoritative rows. Avoid cloning every
  // task on every adaptive state poll when no redaction is required.
  if (normalizedRole === 'ADMIN') return records;
  return records.map(caseRecord => {
    const stamp = caseSanitizationStamp(caseRecord);
    const cached = sanitizedCaseResponseCache.get(caseRecord);
    if (cached?.stamp === stamp) return cached.value;
    const safe = structuredClone(caseRecord);
    for (const field of FINANCE_FIELDS) delete safe[field];
    delete safe.estimateAmount;
    delete safe.amountReceived;
    delete safe.receivedAmount;
    sanitizedCaseResponseCache.set(caseRecord, { stamp, value:safe });
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

function serverMonthKey(ms = Date.now()) {
  const dayKey = serverTodayKey(ms);
  return /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? dayKey.slice(0, 7) : '';
}

function normalizePerformanceMonthKey(value = '', fallback = serverMonthKey(Date.now())) {
  const raw = String(value || '').trim().slice(0, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : fallback;
}

function performanceRangeMs(value = 'month') {
  const key = String(value || 'month').trim().toLowerCase();
  if (key === 'week') return 7 * 86400000;
  if (key === 'quarter') return 90 * 86400000;
  return 30 * 86400000;
}

function performanceScopeConfig(input = {}) {
  const source = typeof input === 'string' ? { range:input } : (input || {});
  const scope = String(source.scope || '').trim().toLowerCase();
  if (scope === 'overall') return { scope:'overall', month:'', range:'', key:'overall' };
  if (scope === 'month') {
    const month = normalizePerformanceMonthKey(source.month);
    return { scope:'month', month, range:'', key:`month:${month}` };
  }
  const legacyRange = ['week','month','quarter'].includes(String(source.range || '').toLowerCase()) ? String(source.range).toLowerCase() : '';
  if (legacyRange) return { scope:'rolling', month:'', range:legacyRange, key:`rolling:${legacyRange}` };
  const month = normalizePerformanceMonthKey(source.month);
  return { scope:'month', month, range:'', key:`month:${month}` };
}

function performanceBaselineDetails(user = {}) {
  const profile = user.performanceProfile || {};
  const month = normalizePerformanceMonthKey(
    profile.scoreBaselineMonth || profile.baselineMonth || user.performanceBaselineMonth,
    ''
  );
  const at = parseDateMs(profile.scoreBaselineAt || profile.baselineAt || user.performanceBaselineAt);
  return {
    enabled:Boolean(month && at),
    month,
    at:month && at ? at : 0,
    updatedAt:profile.scoreBaselineUpdatedAt || profile.baselineUpdatedAt || user.performanceBaselineUpdatedAt || null,
    updatedBy:profile.scoreBaselineUpdatedBy || profile.baselineUpdatedBy || user.performanceBaselineUpdatedBy || ''
  };
}

function performanceEventMatchesScope(eventAt = 0, config = performanceScopeConfig(), baselineAt = 0, nowMs = Date.now()) {
  const timestamp = parseDateMs(eventAt);
  if (!timestamp || (baselineAt && timestamp < baselineAt)) return false;
  if (config.scope === 'overall') return true;
  if (config.scope === 'month') return serverMonthKey(timestamp) === config.month;
  return timestamp >= nowMs - performanceRangeMs(config.range);
}

function performanceWorkAndCompletionMatchScope(workStartedAt = 0, completionAt = 0, config = performanceScopeConfig(), baselineAt = 0, nowMs = Date.now()) {
  if (!performanceEventMatchesScope(completionAt, config, baselineAt, nowMs)) return false;
  if (config.scope === 'month' || baselineAt) {
    return performanceEventMatchesScope(workStartedAt, config, baselineAt, nowMs);
  }
  return true;
}

function latestPerformanceDocumentTime(c = {}) {
  const lists = [c.completedFiles, c.documents, c.files, c.uploads, c.attachments].filter(Array.isArray);
  let latest = 0;
  for (const list of lists) {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const marker = String(item.type || item.category || item.status || item.fileType || item.name || item.filename || '').toLowerCase();
      if (marker && !/complete|final|approved|deliver|drawing|dwg|pdf/.test(marker)) continue;
      latest = Math.max(latest, parseDateMs(item.uploadedAt || item.createdAt || item.updatedAt || item.completedAt || item.date || item.time));
    }
  }
  return latest;
}

function performanceCaseCreatedAt(c = {}) {
  return parseDateMs(c.assignedAt || c.createdAt || c.taskDate || c.receivedAt || c.addedAt || c.createdOn);
}

function performanceCaseCompletedAt(c = {}) {
  return parseDateMs(c.completedAt || c.finalApprovedAt || c.approvedAt || c.draftingCompletedAt || c.submittedAt || c.closedAt || c.deliveredAt)
    || latestPerformanceDocumentTime(c)
    || 0;
}

function performanceCaseRevisionAt(c = {}) {
  const explicit = parseDateMs(c.lastRevisionAt || c.revisionUpdatedAt || c.revisionRequestedAt || c.revertedAt || c.lastRevertedAt);
  if (explicit) return explicit;
  const events = [
    ...(Array.isArray(c.timeline) ? c.timeline : []),
    ...(Array.isArray(c.history) ? c.history : []),
    ...(Array.isArray(c.activityLog) ? c.activityLog : []),
    ...(Array.isArray(c.events) ? c.events : [])
  ];
  let latest = 0;
  for (const event of events) {
    const text = String(event?.text || event?.message || event?.title || event?.action || event?.type || event?.status || '').toLowerCase();
    if (!/revision|revert|correction|changes requested/.test(text)) continue;
    latest = Math.max(latest, parseDateMs(event.at || event.time || event.timestamp || event.date || event.createdAt || event.updatedAt));
  }
  return latest;
}

function recordScopeCompletionAt(record = {}, config = performanceScopeConfig()) {
  const explicit = parseDateMs(record.completionEventAt || record.finalApprovedAt || record.approvedAt || record.finishedAt);
  if (config.scope === 'month') return explicit;
  return explicit || getRecordCompletedMs(record);
}

function leaderboardAggregateStats(d = readDb(), options = {}) {
  const config = performanceScopeConfig(options);
  const nowMs = Date.now();
  const todayKey = serverTodayKey(nowMs);
  const rangeKey = config.key;
  const cacheKey = `${performanceDataRevision}:${rangeKey}:${todayKey}`;
  const cached = leaderboardAggregateCache.get(cacheKey);
  if (cached) return cached;

  const performance = getPerformanceBundle(d);
  const approvedMembers = (d.users || [])
    .filter(user => normalizeStatus(user.status) === 'APPROVED' && normalizeRole(user.role) !== 'Admin');
  const userKeyById = new Map();
  const userKeyByName = new Map();
  const memberByCanonical = new Map();
  approvedMembers.forEach(user => {
    const canonical = String(user.id || user.name || '').trim().toLowerCase();
    if (!canonical) return;
    memberByCanonical.set(canonical, user);
    [user.id, user.userId].filter(Boolean).forEach(value => userKeyById.set(String(value).trim().toLowerCase(), canonical));
    [user.name, user.username].filter(Boolean).forEach(value => userKeyByName.set(String(value).trim().toLowerCase(), canonical));
  });
  const resolveCanonicalOwner = (c = {}) => {
    const byId = [c.userId, c.assigneeId, c.assignedUserId, c.ownerId]
      .map(value => String(value || '').trim().toLowerCase())
      .find(value => value && userKeyById.has(value));
    const ownerName = String(c.userName || c.assigneeName || c.assignedTo || c.designerName || c.completedBy || perfOwner(c) || '').trim().toLowerCase();
    return (byId && userKeyById.get(byId)) || userKeyByName.get(ownerName) || ownerName;
  };

  const scopedRecords = (performance.records || []).filter(record => {
    const canonical = resolveCanonicalOwner(record);
    const member = memberByCanonical.get(canonical);
    if (!member) return false;
    const baseline = performanceBaselineDetails(member);
    return performanceWorkAndCompletionMatchScope(
      parseDateMs(record.assignedAt || record.startedAt || record.createdAt),
      recordScopeCompletionAt(record, config),
      config,
      baseline.at,
      nowMs
    );
  });
  const scopedSummary = buildPerformanceSummary(scopedRecords, d.users || []);
  const summaryByName = new Map((scopedSummary.users || []).map(row => [String(row.userName || '').trim().toLowerCase(), row]));

  const caseStats = new Map();
  const ensure = (canonical = '') => {
    const key = String(canonical || '').trim().toLowerCase();
    if (!key) return null;
    if (!caseStats.has(key)) caseStats.set(key, { assignedCount:0, completedCount:0, activeCount:0, revisionCases:0, completedToday:0 });
    return caseStats.get(key);
  };
  for (const c of filterDeletedCases(d.cases || [], d.deletedProjectIds || [])) {
    const canonicalOwner = resolveCanonicalOwner(c);
    const member = memberByCanonical.get(canonicalOwner);
    const row = member ? ensure(canonicalOwner) : null;
    if (!row) continue;
    const baseline = performanceBaselineDetails(member);
    const createdAt = performanceCaseCreatedAt(c);
    const completedAt = performanceCaseCompletedAt(c);
    const completed = isCompletedCaseForPerf(c);
    if (performanceEventMatchesScope(createdAt, config, baseline.at, nowMs)) {
      row.assignedCount += 1;
      if (!completed) row.activeCount += 1;
    }
    const completedInScope = completed && performanceWorkAndCompletionMatchScope(createdAt, completedAt, config, baseline.at, nowMs);
    if (completedInScope) row.completedCount += 1;
    if (perfRevisionCount(c) > 0) {
      const revisionAt = performanceCaseRevisionAt(c) || (completed ? completedAt : 0);
      if (performanceEventMatchesScope(revisionAt, config, baseline.at, nowMs)) row.revisionCases += 1;
    }
    if (completedInScope && completedAt && serverTodayKey(completedAt) === todayKey) row.completedToday += 1;
  }

  const aggregates = approvedMembers
    .map(user => {
      const nameKey = String(user.name || '').trim().toLowerCase();
      const canonical = String(user.id || user.name || '').trim().toLowerCase();
      const summary = summaryByName.get(nameKey) || {};
      const counts = caseStats.get(canonical) || caseStats.get(nameKey) || { assignedCount:0, completedCount:0, activeCount:0, revisionCases:0, completedToday:0 };
      const baseline = performanceBaselineDetails(user);
      return {
        id:user.id,
        name:user.name,
        role:user.role,
        status:user.status,
        dailyLimit:Number(user.dailyLimit || user.taskLimit || user.workloadProfile?.dailyLimit || 15) || 15,
        ...counts,
        completedRecordCount:Number(summary.completedCount || 0) || 0,
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
        timingSource:summary.timingSource || 'No history in scope',
        performanceProfile:{
          ...(user.performanceProfile || {}),
          scoreBaselineEnabled:baseline.enabled,
          scoreBaselineMonth:baseline.month,
          scoreBaselineAt:baseline.at ? new Date(baseline.at).toISOString() : null,
          scoreBaselineUpdatedAt:baseline.updatedAt,
          scoreBaselineUpdatedBy:baseline.updatedBy
        }
      };
    })
    .sort((a,b) => b.productivityScore - a.productivityScore || b.completedRecordCount - a.completedRecordCount || String(a.name).localeCompare(String(b.name)))
    .map((member, index) => ({ ...member, rank:index + 1 }));

  const aggregate = {
    generatedAt:scopedSummary.generatedAt || now(),
    scope:config.scope,
    month:config.month || '',
    range:config.range || '',
    recordCount:Number(scopedSummary.recordCount || scopedRecords.length || 0),
    avgCompletionMinutes:Number(scopedSummary.avgCompletionMinutes || 0) || 0,
    avgReviewMinutes:Number(scopedSummary.avgReviewMinutes || 0) || 0,
    rolling10CompletionMinutes:Number(scopedSummary.rolling10CompletionMinutes || 0) || 0,
    rolling30CompletionMinutes:Number(scopedSummary.rolling30CompletionMinutes || 0) || 0,
    trend:scopedSummary.trend || { pct:0, label:'Stable' },
    members:aggregates
  };
  leaderboardAggregateCache.set(cacheKey, aggregate);
  if (leaderboardAggregateCache.size > 24) {
    const oldestKey = leaderboardAggregateCache.keys().next().value;
    if (oldestKey) leaderboardAggregateCache.delete(oldestKey);
  }
  return aggregate;
}

function buildTeamLeaderboard(d = readDb(), options = {}) {
  const aggregate = leaderboardAggregateStats(d, options);
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
  return (d.notifications || []).filter(notification => notificationBelongsToUser(notification, actor)).map(normalizeNotificationForClient);
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
  const fullChatMessages = scopedTeamChat(d, req);
  const fullNotifications = scopedNotifications(d, req);
  // Keep the normal operational workspace bounded even after months of use.
  // PostgreSQL remains the permanent source of truth; older chat is available
  // through the authenticated history endpoint instead of living forever in
  // every browser tab's React heap.
  const chatMessages = compact ? fullChatMessages.slice(0, WORKSPACE_COMPACT_CHAT_LIMIT) : fullChatMessages;
  const notifications = compact ? fullNotifications.slice(0, WORKSPACE_COMPACT_NOTIFICATION_LIMIT) : fullNotifications;
  const payload = {
    users:scopedUsers(d, req),
    projects:safeCases,
    deletedProjectIds:[...(d.deletedProjectIds || [])],
    chatMessages,
    notifications,
    attendanceLogs:scopedAttendance(d, req),
    liveWindow:{
      chatReturned:chatMessages.length,
      chatTotal:fullChatMessages.length,
      notificationsReturned:notifications.length,
      notificationsTotal:fullNotifications.length
    }
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

function filterCollectionRows(collection = '', rows = [], selectedIds = null) {
  if (!Array.isArray(selectedIds)) return rows;
  if (!selectedIds.length) return [];
  const ids = new Set(selectedIds.map(value => String(value || '').trim()).filter(Boolean));
  if (!ids.size) return [];
  return (rows || []).filter(record => recordMatchesCollectionRow(collection, record, ids));
}

function scopedStateCollections(d = {}, req = {}, collections = [], rowChanges = {}) {
  const requested = new Set(Array.isArray(collections) ? collections : []);
  const actor = req.auth?.user || {};
  const role = normalizePermissionRole(actor.role);
  const payload = {};
  if (requested.has('users')) {
    const rows = filterCollectionRows('users', d.users || [], rowChanges?.users);
    payload.users = scopedUsers({ ...d, users:rows }, req);
  }
  if (requested.has('cases')) {
    const candidateCases = filterCollectionRows('cases', filterDeletedCases(d.cases || [], d.deletedProjectIds || []), rowChanges?.cases);
    const visibleCases = filterCasesForUser(candidateCases, actor);
    payload.projects = sanitizeCasesForRole(visibleCases, role);
  }
  if (requested.has('deletedProjectIds')) payload.deletedProjectIds = [...(d.deletedProjectIds || [])];
  if (requested.has('teamChat')) payload.chatMessages = filterCollectionRows('teamChat', scopedTeamChat(d, req), rowChanges?.teamChat);
  if (requested.has('notifications')) payload.notifications = filterCollectionRows('notifications', scopedNotifications(d, req), rowChanges?.notifications);
  if (requested.has('attendanceLogs')) payload.attendanceLogs = filterCollectionRows('attendanceLogs', scopedAttendance(d, req), rowChanges?.attendanceLogs);
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
    const completedToday=d.cases.filter(c=>c.assigneeId===u.id && c.completedAt && localDateKeyFromMsServer(c.completedAt)===localDateKeyFromMsServer(Date.now())).length;
    return {id:u.id,name:u.name,role:u.role,phone:u.phone,status:active.length?'BUSY':'FREE',activeTasks:active.map(c=>({id:c.id,caseId:c.caseId,customerName:c.customerName,status:c.status,busySince:caseBusySince(c)})),freeSince,freeForMinutes:freeSince?Math.max(0,Math.floor((Date.now()-new Date(freeSince).getTime())/60000)):0,busySince,busyForMinutes:busySince?Math.max(0,Math.floor((Date.now()-Number(busySince))/60000)):0,completedToday};
  });
}
function dailyLedger(d, dateStr=localDateKeyFromMsServer(Date.now())){
  const same=(iso)=>localDateKeyFromMsServer(iso)===dateStr;
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
  exposedHeaders: ['X-Request-Id','X-Error-Fingerprint','X-Auth-Session-Context','Content-Disposition','Content-Length','Content-Type','RateLimit-Limit','RateLimit-Remaining','RateLimit-Reset','Retry-After']
};
const loginRateLimiter = createRateLimiter({ windowMs:15 * 60 * 1000, max:20, prefix:'login', key:req => `login:${req.ip || req.socket?.remoteAddress || 'unknown'}:${normalizeUsername(req.body?.username || '')}` });
const recoveryRateLimiter = createRateLimiter({ windowMs:15 * 60 * 1000, max:8, prefix:'recovery' });
const otpRateLimiter = createRateLimiter({ windowMs:10 * 60 * 1000, max:8, prefix:'otp' });
const emailTestRateLimiter = createRateLimiter({ windowMs:60 * 60 * 1000, max:5, prefix:'email-test' });
const clientDiagnosticRateLimiter = createRateLimiter({ windowMs:5 * 60 * 1000, max:60, prefix:'client-diagnostic', key:req => `client-diagnostic:${req.auth?.user?.id || req.ip || req.socket?.remoteAddress || 'unknown'}` });
const recentClientDiagnosticReports = new Map();
const apiWriteRateLimiter = createRateLimiter({ windowMs:60 * 1000, max:boundedEnvNumber('API_WRITE_RATE_LIMIT', 300, 10, 10000), prefix:'api-write', key:req => `api-write:${req.auth?.user?.id || req.ip || req.socket?.remoteAddress || 'unknown'}` });
app.use(attachRequestId);
app.use(requestLogMiddleware);
app.use(secureResponseHeaders);
app.use(cors(corsOptions));
app.use(express.json({limit: JSON_BODY_LIMIT}));
app.use(rejectDangerousJson);
app.use('/api', requireJsonForBody);
app.use('/api', (req,res,next) => {
  if (!startupFailure) return next();
  const publicDuringMaintenance=new Set(['/health','/health/live','/health/ready','/meta']);
  if (publicDuringMaintenance.has(req.path)) return next();
  const runtimeReadOnly = startupFailure.phase === 'runtime' && memoryState && isSafeMethod(req.method);
  const runtimeAuthPaths = new Set(['/auth/login','/auth/session','/auth/logout','/auth/clear-browser-session','/auth/recovery/request','/auth/recovery/reset','/otp/send','/otp/verify','/client-diagnostics']);
  if (runtimeReadOnly || (startupFailure.phase === 'runtime' && runtimeAuthPaths.has(req.path))) return next();
  res.setHeader('Retry-After', startupFailure.retryable ? '30' : '300');
  return res.status(503).json({
    ok:false,
    code:'BACKEND_STARTUP_MAINTENANCE',
    error:startupFailure.phase === 'runtime'
      ? 'A runtime integrity recovery is incomplete. Read-only access remains available, but operational writes are temporarily blocked.'
      : 'The backend is online but startup validation has not completed. No operational write has been accepted.',
    startupFailure:startupFailurePayload()
  });
});
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
  const startedAt = process.hrtime.bigint();
  const username = normalizeUsername(req.body?.username || '');
  const password = String(req.body?.password || '');
  const previousRawToken = parseRequestCookies(req)[SESSION_COOKIE_NAME] || '';
  const setLoginTiming = () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    res.setHeader('Server-Timing', `login;dur=${elapsedMs.toFixed(1)}`);
  };
  try {
    if (!username || !password) {
      setLoginTiming();
      return res.status(400).json({ ok: false, code: 'LOGIN_FIELDS_REQUIRED', error: 'Username and password are required.' });
    }
    const credential = await findCredentialByUsername(username);
    const lockedUntil = credential?.locked_until ? new Date(credential.locked_until).getTime() : 0;
    // Always perform scrypt verification, including unknown usernames, so account
    // existence cannot be inferred from a materially faster failure path.
    const valid = await verifyPassword(password, credential?.password_hash || DUMMY_LOGIN_PASSWORD_HASH);
    if (!credential || !valid) {
      if (credential && lockedUntil > Date.now()) {
        void recordAuthEventBestEffort({ userId: credential.user_id, username, eventType: 'LOGIN_BLOCKED_LOCK', req });
        setLoginTiming();
        return res.status(423).json({ ok: false, code: 'LOGIN_LOCKED', error: 'Too many failed attempts. Try again later or use password recovery.' });
      }
      if (credential) await updateLoginFailure(credential, req);
      else void recordAuthEventBestEffort({ username, eventType: 'LOGIN_FAILED_UNKNOWN_USER', req });
      setLoginTiming();
      return res.status(401).json({ ok: false, code: 'LOGIN_FAILED', error: 'Invalid username or password.' });
    }

    let refreshedCredential = credential;
    if (lockedUntil > Date.now()) {
      refreshedCredential = await clearLoginFailures(credential);
      void recordAuthEventBestEffort({ userId: credential.user_id, username, eventType: 'LOGIN_UNLOCKED_WITH_VALID_PASSWORD', req });
    }
    const stateUser = findStateUserByIdOrUsername(refreshedCredential.user_id, refreshedCredential.username);
    const approved = stateUser && normalizeAuthStatus(stateUser.status || refreshedCredential.status) === 'APPROVED' && normalizeAuthStatus(refreshedCredential.status) === 'APPROVED';
    if (!approved) {
      void recordAuthEventBestEffort({ userId: refreshedCredential.user_id, username, eventType: 'LOGIN_BLOCKED_RESTRICTED', req });
      setLoginTiming();
      return res.status(403).json({ ok: false, code: 'ACCOUNT_RESTRICTED', error: 'This account is restricted. Ask the administrator to allow login.' });
    }
    refreshedCredential = await clearLoginFailures(refreshedCredential);
    if (previousRawToken) await revokeAuthSession(tokenHash(previousRawToken)).catch(() => {});
    const session = await createAuthSession(refreshedCredential, req);
    setSessionCookie(res, session.rawToken);
    const user = publicSessionUser(stateUser, refreshedCredential);
    setLoginTiming();
    res.json({ ok: true, authenticated: true, user, csrfToken: session.csrf_token, expiresAt: session.expires_at, sessionHours: SESSION_TTL_HOURS });
    void recordAuthEventBestEffort({ userId: user.id, username: user.username, eventType: 'LOGIN_SUCCEEDED', req, details: { mustChangePassword: user.mustChangePassword } });
  } catch (error) {
    structuredLog('error','login_request_failed',{requestId:req.requestId,username,code:error?.code || 'LOGIN_FAILURE'});
    if (!res.headersSent) {
      setLoginTiming();
      res.status(503).json({ ok: false, code: 'LOGIN_TEMPORARILY_UNAVAILABLE', error: 'Sign in is temporarily unavailable. Please try again.', requestId:req.requestId });
    }
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
    structuredLog('error','session_check_failed',{requestId:req.requestId,code:error?.code || 'SESSION_CHECK_UNAVAILABLE'});
    res.status(503).json({ ok: false, authenticated: false, code:'SESSION_CHECK_UNAVAILABLE', error:'Session check is temporarily unavailable.', requestId:req.requestId });
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
    if (newPassword === currentPassword) return res.status(400).json({ ok:false, code:'PASSWORD_REUSE', error:'Choose a password different from the current password.' });
    const credential = await findCredentialByUserId(req.auth.user.id);
    if (!credential || !(await verifyPassword(currentPassword, credential.password_hash))) {
      void recordAuthEventBestEffort({ userId: req.auth.user.id, username: req.auth.user.username, eventType: 'PASSWORD_CHANGE_FAILED', req });
      return res.status(401).json({ ok: false, code: 'CURRENT_PASSWORD_INVALID', error: 'Current password is incorrect.' });
    }
    const updated = await updateCredentialPassword(req.auth.user.id, await hashPassword(newPassword), false, credential);
    await revokeAllUserSessions(req.auth.user.id);
    const nextSession = await createAuthSession(updated, req);
    setSessionCookie(res, nextSession.rawToken);
    const stateUser = findStateUserByIdOrUsername(updated.user_id, updated.username);
    const user = publicSessionUser(stateUser, updated);
    res.json({ ok: true, user, csrfToken: nextSession.csrf_token, expiresAt: nextSession.expires_at });
    void recordAuthEventBestEffort({ userId: user.id, username: user.username, eventType: 'PASSWORD_CHANGED', req });
  } catch (error) {
    structuredLog('error','password_change_failed',{requestId:req.requestId,userId:req.auth?.user?.id || '',code:error?.code || 'PASSWORD_CHANGE_ERROR'});
    if (!res.headersSent) sendApiFailure(res, req, Object.assign(error,{ code:error?.code || 'PASSWORD_CHANGE_ERROR' }), 'Password could not be changed. Please try again.');
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
    storeOtpChallenge(challengeId, { userId: credential.user_id, username, channel, purpose: 'password_recovery', otp, expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 });
    const response = { ok: true, challengeId, channel, expiresInSeconds: 300 };
    if (delivery?.localOnly && localEmailOtpAllowed()) response.devOtp = otp;
    await recordAuthEvent({ userId: credential.user_id, username, eventType: 'PASSWORD_RECOVERY_REQUESTED', req, details: { channel } });
    res.json(response);
  } catch (error) {
    structuredLog('error','password_recovery_send_failed',{requestId:req.requestId,code:error?.code || 'RECOVERY_SEND_FAILED'});
    res.status(503).json({ ok: false, code: 'RECOVERY_SEND_FAILED', error: 'Recovery OTP could not be sent. Please try again.', requestId:req.requestId });
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
    structuredLog('error','password_recovery_reset_failed',{requestId:req.requestId,code:error?.code || 'RECOVERY_RESET_FAILED'});
    sendApiFailure(res, req, Object.assign(error,{ code:error?.code || 'RECOVERY_RESET_FAILED' }), 'Password could not be reset. Please try again.');
  }
});

app.get('/api/auth/health', requireAdminSession, async (req, res) => {
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
    sendApiFailure(res, req, error, 'Authentication health could not be loaded.');
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
    const d = selectiveDb({ collections:['users'] });
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
    void recordAuthEventBestEffort({ userId, username, eventType: 'USER_CREDENTIAL_CREATED', req, details: { role, createdBy: req.auth.user.name } });
    res.status(201).json({ ok: true, user: publicSessionUser(user, credential), persistence });
  } catch (error) {
    sendApiFailure(res, req, error, 'User could not be created.');
  }
});

app.patch('/api/auth/users/:id', requireAdminSession, async (req, res) => {
  try {
    const d = selectiveDb({ collections:['users'], collectionRowIds:{ users:[String(req.params.id)] } });
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
    sendApiFailure(res, req, error, 'User access could not be updated.');
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
    sendApiFailure(res, req, error, 'Password could not be reset.');
  }
});


function sendProfilePhotoPlaceholder(res) {
  res.status(200);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="28" fill="#f1f5f9"/><circle cx="80" cy="60" r="28" fill="#cbd5e1"/><path d="M34 138c6-28 27-44 46-44s40 16 46 44" fill="#cbd5e1"/></svg>`);
}

function resolveProfilePhotoRecord(requestedName = '') {
  const requested = String(requestedName || '').trim();
  const d = readDb();
  const user = (d.users || []).find(item => [item.id, item.username, item.name, fileBaseName(item.profilePhoto || ''), fileBaseName(item.profilePhotoFile || '')]
    .filter(Boolean).some(value => String(value) === requested || safeName(String(value)) === safeName(requested)));
  if (!user) return null;
  const resolved = fileStorage.resolve({
    storageKey:user.profilePhotoStorageKey || user.profilePhotoFile || '',
    storedName:user.profilePhotoFile || '',
    name:user.profilePhotoOriginalName || fileBaseName(user.profilePhoto || '')
  });
  if (!resolved?.fp || !isResolvedStoragePathAllowed(resolved.fp)) return null;
  const profilePhotoMime = String(user.profilePhotoMime || '').toLowerCase();
  const mimeType = profilePhotoMime.startsWith('image/') ? profilePhotoMime : 'application/octet-stream';
  return { fp:resolved.fp, mimeType, fileName:user.profilePhotoOriginalName || 'profile-photo' };
}
function resolveProfilePhotoPath(requestedName = '') { return resolveProfilePhotoRecord(requestedName)?.fp || ''; }

app.get('/api/profile/photo/:filename', async (req, res) => {
  try {
    const photo = resolveProfilePhotoRecord(req.params.filename || '');
    if (!photo) return sendProfilePhotoPlaceholder(res);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Content-Disposition', contentDispositionValue('inline', photo.fileName));
    res.sendFile(photo.fp);
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
app.get('/api/health/live', (_req, res) => {
  const processAlive=!shuttingDown;
  const healthy=processAlive;
  res.status(healthy ? 200 : 503).json({
    ok:healthy,
    processAlive,
    status:shuttingDown ? 'SHUTTING_DOWN' : startupFailure ? 'DEGRADED' : 'ALIVE',
    service:'Kalpvriksha Ops API',
    backendVersion:BACKEND_PACKAGE_VERSION,
    time:now(),
    uptimeSeconds:Math.round(process.uptime()),
    startupFailure:startupFailurePayload()
  });
});
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
    const actor = requestActor(req);
    const username = normalizeUsername(req.body.username || actor.username || '');
    const mobile = normalizeMobile(req.body.mobile || '');
    const email = normalizeEmail(req.body.email || '');
    const purpose = String(req.body.purpose || 'otp');
    const channel = String(req.body.channel || (email ? 'email' : 'mobile')).toLowerCase();
    if (username && actor.username && username !== normalizeUsername(actor.username)) return res.status(403).json({ok:false,code:'OTP_ACTOR_MISMATCH',error:'OTP registration must belong to the signed-in account.'});
    if (!['email_registration','mobile_registration','otp'].includes(purpose)) return res.status(400).json({ok:false,code:'OTP_PURPOSE_INVALID',error:'Unsupported OTP purpose.'});
    if (channel === 'email' && !email.includes('@')) return res.status(400).json({ ok:false, error:'A valid registered email address is required.' });
    if (channel !== 'email' && mobile.length < 10) return res.status(400).json({ ok:false, error:'A valid registered mobile number is required.' });
    const otp = randomOtp();
    const delivery = channel === 'email' ? await sendOtpEmail(email, otp) : await sendOtpSms(mobile, otp);
    const challengeId = nanoid(12);
    storeOtpChallenge(challengeId, { actorId:actor.id, actorUsername:actor.username, username, channel, mobile, mobileSuffix:mobile.slice(-10), email, purpose, otp, expiresAt:Date.now()+5*60*1000, attempts:0 });
    const response = { ok:true, channel, challengeId, expiresInSeconds:300 };
    if (delivery?.localOnly && localEmailOtpAllowed()) { response.localOnly=true; response.devOtp=otp; response.warning=delivery.warning || 'Local email OTP mode used.'; }
    res.json(response);
  } catch (err) {
    structuredLog('error','otp_send_failed',{requestId:req.requestId,code:err?.code || 'OTP_SEND_FAILED'});
    res.status(503).json({ ok:false, code:'OTP_SEND_FAILED', error:'Could not send OTP. Please try again.' });
  }
});
app.post('/api/otp/verify', otpRateLimiter, async (req,res)=>{
  try {
    const actor = requestActor(req);
    const challengeId = String(req.body.challengeId || '');
    const otp = String(req.body.otp || '').trim();
    const purpose = String(req.body.purpose || 'otp');
    const record = otpStore.get(challengeId);
    if (!record) return res.status(400).json({ ok:false, error:'OTP session not found. Please send OTP again.' });
    if (String(record.actorId || '') !== String(actor.id || '') || normalizeUsername(record.actorUsername || '') !== normalizeUsername(actor.username || '')) return res.status(403).json({ok:false,code:'OTP_ACTOR_MISMATCH',error:'This OTP belongs to a different signed-in account.'});
    if (record.expiresAt < Date.now()) { otpStore.delete(challengeId); return res.status(400).json({ ok:false, error:'OTP expired. Please send OTP again.' }); }
    if (record.purpose !== purpose) return res.status(400).json({ ok:false, error:'OTP purpose mismatch.' });
    record.attempts += 1;
    if (record.attempts > 5) { otpStore.delete(challengeId); return res.status(429).json({ ok:false, error:'Too many incorrect attempts. Please send OTP again.' }); }
    if (record.otp !== otp) return res.status(400).json({ ok:false, error:'Invalid OTP.' });
    const d = selectiveDb({collections:['users'], collectionRowIds:{users:[String(actor.id)]}});
    const user = findStateUserByIdOrUsername(actor.id,actor.username,d);
    if (!user) return res.status(404).json({ok:false,code:'PROFILE_NOT_FOUND',error:'Signed-in user record was not found.'});
    if (purpose === 'email_registration') { user.email=record.email; user.emailRegistered=true; }
    if (purpose === 'mobile_registration') { user.phone=record.mobile; user.mobile=record.mobile; user.mobileRegistered=true; }
    user.updatedAt=Date.now();
    credentialSafeProfileUser(user);
    const persistence = await save(d,{actor:actor.name,reason:`${purpose}_verified`,collections:['users'],collectionRowIds:{users:[String(user.id)]}});
    otpStore.delete(challengeId);
    res.json({ ok:true, user:publicSessionUser(user,req.auth.credential || {}), emailRegistered:true, mobileRegistered:true, persistence });
  } catch (error) {
    structuredLog('error','otp_verify_failed',{requestId:req.requestId,code:error?.code || 'OTP_VERIFY_FAILED'});
    if (!res.headersSent) sendApiFailure(res, req, Object.assign(error,{ code:error?.code || 'OTP_VERIFY_FAILED' }), 'OTP verification could not be completed.');
  }
});

app.get('/',async (_req,res)=>res.json({ok:true,app:'Kalpvriksha Designs ERP'}));
app.get('/api/meta',async (_req,res)=>res.json({roles,serviceTypes,statuses,sourceDocTypes,finalDocTypes}));
app.get('/api/bootstrap', requireCapability('state:read'), async (req,res)=>{
  const d = readDb();
  const scoped = scopedState(d, req, { compact:queryFlag(req.query.compact, false), includePerformance:queryFlag(req.query.performance, true) });
  const readIds = d.chatReads?.[chatReadKey(req)] || [];
  const unreadChat = (Array.isArray(d.teamChat) ? d.teamChat : []).filter(message => !readIds.includes(message.id)).length;
  const actor = requestActor(req);
  const mentionUnread = (Array.isArray(d.teamChat) ? d.teamChat : []).filter(message => !readIds.includes(message.id) && (Array.isArray(message?.mentions) ? message.mentions : []).some(value => {
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
      users:scopedUsers(d, req),
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
    if (changedCollections.length) {
      const d = readDb();
      const rowChanges = workspaceRowChangesSince(sinceCollections, changedCollections);
      return res.json({
        ok:true,
        partial:'workspace',
        changedCollections,
        rowDeltaCollections:Object.fromEntries(Object.entries(rowChanges).map(([collection, ids]) => [collection, Array.isArray(ids)])),
        rowDeltaIds:Object.fromEntries(Object.entries(rowChanges).filter(([, ids]) => Array.isArray(ids)).map(([collection, ids]) => [collection, ids])),
        database:USE_POSTGRES ? 'postgresql' : 'json-file',
        ...scopedStateCollections(d, req, changedCollections, rowChanges),
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
  const scope = ['month','overall'].includes(String(req.query.scope || '').toLowerCase()) ? String(req.query.scope).toLowerCase() : '';
  const range = ['week','month','quarter'].includes(String(req.query.range || '').toLowerCase()) ? String(req.query.range).toLowerCase() : '';
  const month = normalizePerformanceMonthKey(req.query.month);
  res.json({ ok:true, leaderboard:buildTeamLeaderboard(readDb(), { scope, month, range }) });
});

app.patch('/api/performance/baseline/:id', requireAdminSession, async (req, res) => {
  try {
    const targetId = String(req.params.id || '').trim();
    const enabled = req.body?.enabled === true;
    const currentMonth = serverMonthKey(Date.now());
    const baselineMonth = normalizePerformanceMonthKey(req.body?.month, currentMonth);
    if (enabled && baselineMonth > currentMonth) return res.status(400).json({ ok:false, code:'FUTURE_PERFORMANCE_BASELINE', error:'Performance scoring cannot start in a future month.' });
    const d = selectiveDb({ collections:['users','audit'], collectionRowIds:{ users:[targetId] } });
    const index = (d.users || []).findIndex(user => String(user.id || '') === targetId);
    if (index < 0) return res.status(404).json({ ok:false, error:'Team member was not found.' });
    const existing = d.users[index];
    const targetRole = normalizeRole(existing.role);
    if (!['Manager','Designer'].includes(targetRole)) return res.status(400).json({ ok:false, code:'PERFORMANCE_ROLE_NOT_ELIGIBLE', error:'Only Manager and Designer accounts can have a performance score baseline.' });
    const actor = requestActor(req);
    const profile = { ...(existing.performanceProfile || {}) };
    let baselineAt = null;
    if (enabled) {
      baselineAt = new Date(`${baselineMonth}-01T00:00:00+05:30`).toISOString();
      profile.scoreBaselineEnabled = true;
      profile.scoreBaselineMonth = baselineMonth;
      profile.scoreBaselineAt = baselineAt;
      profile.scoreBaselineUpdatedAt = now();
      profile.scoreBaselineUpdatedBy = actor.name;
    } else {
      delete profile.scoreBaselineEnabled;
      delete profile.scoreBaselineMonth;
      delete profile.scoreBaselineAt;
      delete profile.scoreBaselineUpdatedAt;
      delete profile.scoreBaselineUpdatedBy;
      delete profile.baselineMonth;
      delete profile.baselineAt;
      delete profile.baselineUpdatedAt;
      delete profile.baselineUpdatedBy;
    }
    const nextUser = { ...existing, performanceProfile:profile, profileUpdatedAt:Date.now() };
    delete nextUser.performanceBaselineMonth;
    delete nextUser.performanceBaselineAt;
    delete nextUser.performanceBaselineUpdatedAt;
    delete nextUser.performanceBaselineUpdatedBy;
    d.users[index] = nextUser;
    const auditEntry = addAudit(d, actor.name, enabled ? `Performance score baseline started from ${baselineMonth}` : 'Full performance score history restored', existing.name || targetId);
    const persistence = await save(d, {
      actor:actor.name,
      reason:enabled ? 'performance_baseline_enable' : 'performance_baseline_disable',
      collections:['users','audit'],
      collectionRowIds:{ users:[targetId], audit:[String(auditEntry.id)] },
      skipRevisionSnapshot:true,
      periodicRevisionSnapshot:true
    });
    res.json({ ok:true, enabled, baselineMonth:enabled ? baselineMonth : '', baselineAt, user:stripCredentialFields(nextUser), persistence });
  } catch (error) {
    sendApiFailure(res, req, error, 'Performance baseline could not be updated.');
  }
});

app.post('/api/performance/rebuild', requireCapability('performance:rebuild'), async (req, res) => {
  const d = selectiveDb({ collections:['performanceRecords'] });
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
    sendApiFailure(res, req, e, 'Application state could not be loaded.');
  }
});

app.get('/api/system/status', requireCapability('system:read'), async (req, res) => {
  try {
    const [db, reliability] = await Promise.all([getDbStatus(), buildReliabilityStatus({ detailed:false })]);
    const cloudConnected = String(db.database || '').startsWith('postgresql') && db.connected === true;
    res.status(reliability.ok ? 200 : 503).json({ ok:reliability.ok, cloudConnected, database:db.database, connected:db.connected, localMode:!cloudConnected, reliability });
  } catch (e) {
    sendApiFailure(res, req, e, 'System status could not be loaded.', { cloudConnected:false, localMode:true });
  }
});

app.get('/api/system/reliability', requireAdminSession, async (req,res)=>{
  try {
    const status = await buildReliabilityStatus({ detailed:true });
    res.status(status.ok ? 200 : 503).json(status);
  } catch(error) {
    sendApiFailure(res, req, Object.assign(error,{ code:error.code || 'RELIABILITY_STATUS_FAILED' }), 'Reliability status could not be loaded.');
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
    sendApiFailure(res, req, Object.assign(error,{ code:error.code || 'OPERATIONAL_JOBS_FAILED' }), 'Operational jobs could not be loaded.');
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
    sendApiFailure(res, req, Object.assign(error,{ code:error.code || 'JOB_RETRY_FAILED' }), 'The job could not be queued for retry.');
  }
});

app.get('/api/system/events', requireAdminSession, async (req,res)=>{
  if (!USE_POSTGRES) return res.json({ok:true,events:[],warning:'Persistent operational events require PostgreSQL.'});
  try {
    const limit=Math.max(1,Math.min(500,Number(req.query.limit || 100)));
    const result=await pool.query('SELECT id,event_type,severity,actor,request_id,details,created_at FROM operational_events ORDER BY created_at DESC LIMIT $1',[limit]);
    res.json({ok:true,events:result.rows});
  } catch(error) {
    sendApiFailure(res, req, Object.assign(error,{ code:error.code || 'OPERATIONAL_EVENTS_FAILED' }), 'Operational events could not be loaded.');
  }
});

app.post('/api/client-diagnostics', clientDiagnosticRateLimiter, async (req,res)=>{
  try {
    const diagnostic = normalizeClientDiagnostic(req.body || {});
    const actor = requestActor(req);
    const nowMs = Date.now();
    if (recentClientDiagnosticReports.size > 1000) {
      for (const [key, seenAt] of recentClientDiagnosticReports.entries()) if (nowMs - seenAt > 5 * 60 * 1000) recentClientDiagnosticReports.delete(key);
    }
    const dedupeKey = `${actor.id || actor.username || actor.name}|${diagnostic.fingerprint}|${diagnostic.relatedRequestId || ''}`;
    const lastSeenAt = Number(recentClientDiagnosticReports.get(dedupeKey) || 0);
    if (nowMs - lastSeenAt < 30_000) return res.json({ok:true,recorded:false,duplicate:true,diagnosticId:diagnostic.diagnosticId});
    recentClientDiagnosticReports.set(dedupeKey, nowMs);
    const runtimeFailure = !diagnostic.status || diagnostic.status >= 500 || ['window-error','unhandled-rejection','app-error-boundary','root-ui-boundary','communication-hub-boundary'].includes(diagnostic.source);
    const event = {
      eventType:'CLIENT_RUNTIME_DIAGNOSTIC',
      severity:runtimeFailure ? 'ERROR' : 'WARN',
      actor:`client-${String(actor.role || 'user').toLowerCase()}`,
      requestId:diagnostic.relatedRequestId || req.requestId || '',
      details:{
        ...diagnostic,
        role:actor.role || '',
        reportRequestId:req.requestId || ''
      }
    };
    let persisted = true;
    try { await recordOperationalEvent(pool,USE_POSTGRES,event); }
    catch (persistError) {
      persisted = false;
      structuredLog('warn','client_runtime_diagnostic_unpersisted',{requestId:event.requestId,diagnosticId:diagnostic.diagnosticId,fingerprint:diagnostic.fingerprint,source:diagnostic.source,route:diagnostic.route,reason:persistError?.code || 'EVENT_STORE_UNAVAILABLE'});
    }
    res.json({ok:true,recorded:true,persisted,diagnosticId:diagnostic.diagnosticId});
  } catch(error) {
    sendApiFailure(res, req, error, 'Client diagnostic could not be recorded.');
  }
});



app.post('/api/state/projects', async (req, res) => {
  try {
    const actor = requestActor(req);
    const incoming = req.body?.project || req.body?.case || req.body;
    if (!incoming || typeof incoming !== 'object' || (!incoming.id && !incoming.caseId)) {
      return res.status(400).json({ ok:false, code:'PROJECT_ID_REQUIRED', error:'Project id is required.' });
    }
    const projectId = textValue(incoming.id || incoming.caseId, 'Project id', 200, { required:true });
    const taskSnapshot=taskDb(projectId,{audit:true,notifications:true});
    const d=taskSnapshot.snapshot;
    const mutationId = taskMutationId(req.body || {}, incoming);
    // Older clients already prefix new-task mutation IDs with "create-". Keep
    // that compatibility while newer clients send an explicit operation.
    const createIntent=String(req.body?.operation || '').trim().toLowerCase()==='create'
      || req.body?.createOnly === true
      || mutationId.startsWith('create-');
    const mutationOperation=createIntent ? 'create' : 'update';
    const mutationFingerprint=taskMutationFingerprint(mutationOperation,incoming);
    if (createIntent) {
      if (!hasCapability(req.auth?.user || {}, 'task:create')) return authorizationDenied(req, res, 'TASK_CREATE_FORBIDDEN', 'Only Admins and Managers can create tasks.');
      const committedReplay=mutationId ? (d.cases || []).find(record=>String(record?.lastTaskMutationId || '')===mutationId) : null;
      if (committedReplay) {
        assertTaskMutationReplayMatches(committedReplay,mutationId,mutationFingerprint,mutationOperation);
        const visibleReplay=sanitizeCasesForRole([committedReplay],actor.role)[0] || committedReplay;
        return res.json({ok:true,idempotent:true,project:visibleReplay,case:visibleReplay,deletedProjectIds:d.deletedProjectIds || [],counts:{cases:(d.cases || []).length}});
      }
    }
    const incomingIds = getCaseIdentitySet(incoming);
    const tombstones = new Set((d.deletedProjectIds || []).map(String));
    if (!createIntent && incomingIds.some(id => tombstones.has(id))) {
      return res.status(409).json({ ok:false, code:'PROJECT_DELETED', error:'This task was permanently deleted and cannot be restored by a stale client.', deletedProjectIds:d.deletedProjectIds || [] });
    }

    let existing = findCaseByAnyId(d.cases || [], projectId) || findCaseByAnyId(d.cases || [], incoming.caseId || '') || findCaseByAnyId(d.cases || [], incoming.displayId || '');
    const createIdentityCollision=createIntent && (Boolean(existing) || incomingIds.some(id=>tombstones.has(id) || Boolean(findCaseByAnyId(d.cases || [],id))));
    const allocatedProjectId=createIdentityCollision
      ? nextAvailableCaseIdentity(d.cases || [],incoming.displayId || incoming.caseId || projectId,d.deletedProjectIds || [])
      : projectId;
    if (createIntent) existing=null;

    let safeIncoming;
    if (existing) {
      // Authorization must run before both idempotent-replay and optimistic-
      // concurrency checks. An unrelated user must not be able to confirm a
      // task or receive its redacted row merely by guessing a mutation ID.
      assertProjectUpdateAuthorized(existing, req);
      if (mutationId && assertTaskMutationReplayMatches(existing,mutationId,mutationFingerprint,mutationOperation)) {
        const visibleExisting = sanitizeCasesForRole([existing], actor.role)[0];
        return res.json({ ok:true, idempotent:true, project:visibleExisting, case:visibleExisting, deletedProjectIds:d.deletedProjectIds || [], counts:{ cases:(d.cases || []).length } });
      }
      assertExpectedTaskVersion(existing, incoming, req.body || {});
      safeIncoming = authorizedProjectUpdate(existing, incoming, req);
      assertTaskLifecycleTransition(existing, safeIncoming, actor);
      safeIncoming.taskVersion = nextTaskVersion(existing);
      safeIncoming.lastTaskMutationId = mutationId || nanoid(16);
      safeIncoming.lastTaskMutationFingerprint = mutationFingerprint;
      safeIncoming.lastTaskMutationOperation = mutationOperation;
      safeIncoming.lastTaskMutationAt = now();
    } else {
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
      safeIncoming.id = allocatedProjectId;
      safeIncoming.displayId = createIdentityCollision ? allocatedProjectId : (incoming.displayId || incoming.caseId || allocatedProjectId);
      safeIncoming.caseId = safeIncoming.displayId;
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
      safeIncoming.taskVersion = 1;
      safeIncoming.lastTaskMutationId = mutationId || nanoid(16);
      safeIncoming.lastTaskMutationFingerprint = mutationFingerprint;
      safeIncoming.lastTaskMutationOperation = mutationOperation;
      safeIncoming.lastTaskMutationAt = now();
      assertTaskLifecycleTransition({}, safeIncoming, actor);
    }

    assertCaseDisplayIdentityAvailable(d.cases || [],safeIncoming,existing);
    d.cases = mergeCasesPreservingFreshest(d.cases || [], [safeIncoming], d.deletedProjectIds || []);
    const saved = findCaseByAnyId(d.cases || [], safeIncoming.id || allocatedProjectId) || findCaseByAnyId(d.cases || [], safeIncoming.caseId || allocatedProjectId) || safeIncoming;
    const auditEntry = addAudit(d, actor.name, existing ? 'Task updated' : 'Task created', saved.caseId || saved.id);
    const notificationEntries=[];
    const assignmentChanged = String(existing?.assignedTo || 'Unassigned') !== String(saved.assignedTo || 'Unassigned');
    if ((!existing || assignmentChanged) && String(saved.assignedTo || '').trim() && String(saved.assignedTo) !== 'Unassigned') {
      notificationEntries.push(notifyUser(d, saved.assigneeId || saved.assignedTo, `${existing ? 'Task re-assigned' : 'New task assigned'}: ${saved.displayId || saved.caseId || saved.id}`, 'info', saved.id));
    }
    if (!existing && (saved.originalTaskId || saved.parentTaskId || saved.revisionCode || saved.isRevisionWorkItem)) {
      notificationEntries.push(notifyRole(d,'MANAGER',`Revision work item created: ${saved.displayId || saved.caseId || saved.id}${saved.revisionCode ? ` ${saved.revisionCode}` : ''}`,'urgent',saved.id));
    }
    if (existing && statusKey(existing.status) !== statusKey(saved.status) && statusKey(saved.status) === 'COMPLETED') {
      notificationEntries.push(notifyRole(d, 'MANAGER', `Task completed: ${saved.displayId || saved.caseId || saved.id}`, 'success', saved.id));
      if (saved.assignedTo && saved.assignedTo !== 'Unassigned') notificationEntries.push(notifyUser(d, saved.assigneeId || saved.assignedTo, `Task marked completed: ${saved.displayId || saved.caseId || saved.id}`, 'success', saved.id));
    }
    if (existing && String(existing.priority || '') !== 'Urgent' && String(saved.priority || '') === 'Urgent' && saved.assignedTo && saved.assignedTo !== 'Unassigned') {
      notificationEntries.push(notifyUser(d, saved.assigneeId || saved.assignedTo, `Urgent task update: ${saved.displayId || saved.caseId || saved.id}`, 'urgent', saved.id));
    }

    const collections=['cases','audit'];
    const collectionRowIds={ cases:[String(saved.id || saved.caseId)], audit:[String(auditEntry.id)] };
    if (notificationEntries.length) {
      collections.push('notifications');
      collectionRowIds.notifications=notificationEntries.map(entry=>String(entry.id));
    }
    const persistence = await save(d, {
      actor:actor.name,
      reason:existing ? 'task_update' : 'task_create',
      skipRevisionSnapshot:true,
      periodicRevisionSnapshot:true,
      takeSnapshotOwnership:true,
      collections,
      collectionRowIds
    });
    const visible = sanitizeCasesForRole([saved], actor.role)[0] || saved;
    res.json({ ok:true, project:visible, case:visible, requestedProjectId:projectId, taskIdAllocated:createIdentityCollision, notifications:notificationEntries, deletedProjectIds:d.deletedProjectIds || [], counts:{ cases:(d.cases || []).length }, persistence });
  } catch (e) {
    sendApiFailure(res, req, e, 'Project save failed.', { currentTaskVersion:e.currentTaskVersion });
  }
});

app.delete('/api/state/projects/:id', requireAnyRole('ADMIN','MANAGER'), requireCaseAction('delete',{notifications:true,audit:true,deletedProjectIds:true}), async (req,res)=>{
  const d = requestDb(req);
  const actor = requestActor(req);
  const requestedId = textValue(req.params.id, 'Project id', 200, { required:true });
  const target=req.caseRecord;
  // Deletion is naturally idempotent after commit because a retry receives
  // CASE_NOT_FOUND/404, but the first attempt must still be based on the exact
  // task version the user reviewed before deleting it.
  assertExpectedTaskVersion(target,target,req.body || {});
  const targetIds=new Set([...getCaseIdentitySet(target),requestedId].map(value=>String(value || '').trim()).filter(Boolean));
  const before = (d.cases || []).length;
  for (const identity of targetIds) rememberDeletedProject(d,identity);
  const auditEntry=addAudit(d, actor.name, 'Task permanently deleted', target.caseId || target.displayId || target.id);
  d.cases = (d.cases || []).filter(record=>String(record?.id || '')!==String(target.id || ''));
  d.cases = filterDeletedCases(d.cases || [], d.deletedProjectIds || []);
  const deletedNotificationIds=[];
  d.notifications = (d.notifications || []).filter(notification=>{
    const reference=String(notification.caseId || notification.projectId || notification.targetId || '').trim();
    const remove=targetIds.has(reference);
    if (remove && notification?.id) deletedNotificationIds.push(String(notification.id));
    return !remove;
  });
  await save(d, {
    actor:actor.name,
    reason:'task_delete',
    takeSnapshotOwnership:true,
    collections:['cases','notifications','audit','deletedProjectIds'],
    collectionRowIds:{cases:[String(target.id || target.caseId)],notifications:deletedNotificationIds,audit:[String(auditEntry.id)]}
  });
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
    const presenceCommand = normalizePresenceClientCommand(body);
    const commandDisposition = classifyPresenceClientCommand(stateUser, safeAction, presenceCommand);
    if (commandDisposition.epochMismatch) {
      return res.status(409).json({
        ok:false,
        code:'PRESENCE_CLIENT_EPOCH_STALE',
        error:'This page belongs to an older presence session. Refresh or sign in again before changing live status.',
        presenceGeneration:presenceMutationGeneration
      });
    }
    if (commandDisposition.stale) {
      const staleDateKey = serverTodayKey();
      const staleAttendanceIndex = findAttendanceLogIndex(memoryState?.attendanceLogs || [], stateUser, staleDateKey);
      const staleAttendanceLog = staleAttendanceIndex >= 0 ? (memoryState?.attendanceLogs || [])[staleAttendanceIndex] : null;
      return res.json({
        ok:true,
        idempotent:true,
        staleClientSequence:true,
        user:sanitizePresenceUser(stateUser),
        attendanceLog:staleAttendanceLog,
        presenceGeneration:presenceMutationGeneration
      });
    }
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

    const dateKey = serverTodayKey();
    const attendanceIndex = findAttendanceLogIndex(memoryState?.attendanceLogs || [], stateUser, dateKey);
    const attendanceId = String((memoryState?.attendanceLogs || [])[attendanceIndex]?.id || `${actor.id || actor.username || actor.name}_${dateKey}`);
    const presenceState = selectiveDb({
      collections:['users','attendanceLogs'],
      collectionRowIds:{ users:[String(actor.id || actor.username)], attendanceLogs:[attendanceId] }
    });
    const { user, attendanceLog } = applyPresenceUpdate(presenceState, userPatch, safeAction, presenceCommand);
    replacePresenceSliceInMemory(presenceState);
    markPresenceRowsDirty(user, attendanceLog, presenceMutationGeneration);

    if (safeAction === 'heartbeat') {
      // Heartbeats change one employee row and one current-day attendance row.
      // Keep them memory-fast and coalesce their durable write so foreground
      // task/file/finance actions are never blocked by presence traffic.
      schedulePresenceFlush();
      return res.json({
        ok:true,
        user,
        attendanceLog,
        presenceGeneration:presenceMutationGeneration,
        persistence:{ mode:'coalesced', queued:false, flushWithinMs:PRESENCE_HEARTBEAT_FLUSH_MS }
      });
    }

    snapshotPresenceGenerations.set(presenceState, presenceMutationGeneration);
    const rowIds={
      users:[String(user.id || user.username || actor.id)].filter(Boolean),
      attendanceLogs:[String(attendanceLog?.id || attendanceId)].filter(Boolean)
    };
    let persistence;
    try {
      persistence = await save(presenceState, {
        actor:actor.name,
        reason:`presence_${safeAction}`,
        skipRevisionSnapshot:true,
        collections:['users','attendanceLogs'],
        collectionRowIds:rowIds
      });
    } catch (error) {
      // Presence is operational telemetry, not a reason to deny the complete
      // workspace. A failed transaction is rolled back and reloadCommittedState()
      // preserves the dirty presence slice. Retry it in the coalesced background
      // queue unless the independent integrity reload placed the API in protected mode.
      if (!startupFailure) {
        schedulePresenceFlush(PRESENCE_FLUSH_RETRY_MS);
        structuredLog('warn','presence_persistence_deferred',{
          action:safeAction,
          userId:actor.id,
          code:error?.code || 'PRESENCE_PERSISTENCE_FAILED',
          error:error?.message || String(error),
          retryWithinMs:PRESENCE_FLUSH_RETRY_MS
        });
        return res.status(202).json({
          ok:true,
          temporarilyDeferred:true,
          code:'PRESENCE_PERSISTENCE_DEFERRED',
          user,
          attendanceLog,
          presenceGeneration:presenceMutationGeneration,
          retryWithinMs:PRESENCE_FLUSH_RETRY_MS
        });
      }
      throw error;
    }
    res.json({ ok:true, user, attendanceLog, presenceGeneration:presenceMutationGeneration, persistence });
  } catch (e) {
    sendApiFailure(res, req, e, 'Presence update failed.');
  }
});

app.post('/api/state', async (req,res)=>{
  try {
    const body = req.body || {};
    const actor = requestActor(req);
    const hasProjects = Array.isArray(body.projects) || Array.isArray(body.cases);
    const incomingCases = Array.isArray(body.projects) ? body.projects : (Array.isArray(body.cases) ? body.cases : []);
    const incomingIds=[...new Set(incomingCases.flatMap(item=>[item?.id,item?.caseId,item?.displayId,item?.originalTaskId]).map(value=>String(value || '').trim()).filter(Boolean))];
    const d = hasProjects
      ? selectiveDb({ collections:['cases'], collectionRowIds:{cases:incomingIds} })
      : selectiveDb({ collections:['cases'] });
    assertArrayLimit(incomingCases, 'projects', MAX_STATE_PROJECTS_PER_WRITE);
    const authorizedIncoming = [];
    for (const incoming of incomingCases.filter(Boolean)) {
      if (!incoming.id && !incoming.caseId) continue;
      const existing = findCaseByAnyId(d.cases || [], incoming.id || incoming.caseId) || findCaseByAnyId(d.cases || [], incoming.caseId || incoming.id);
      if (existing) {
        // Keep the legacy broad-state path aligned with the dedicated task API:
        // reject unauthorized callers before exposing any task-version detail.
        assertProjectUpdateAuthorized(existing,req);
        assertExpectedTaskVersion(existing,incoming,incoming);
        const authorized=authorizedProjectUpdate(existing,incoming,req);
        assertTaskLifecycleTransition(existing,authorized,actor);
        authorizedIncoming.push(authorized);
      } else {
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
        created.taskVersion=1;
        created.lastTaskMutationId=taskMutationId(incoming,incoming) || nanoid(16);
        created.lastTaskMutationAt=now();
        assertTaskLifecycleTransition({},created,actor);
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
    // The legacy compatibility response reports the existing cached performance
    // set. Rebuilding all historical analytics after a task save caused a second
    // whole-project CPU spike even though the performance endpoint is separate.
    const performanceRecords = d.performanceRecords || [];
    res.json({ok:true, database:USE_POSTGRES ? 'postgresql' : 'json-file', savedAt:now(), ignoredFields, deletedProjectIds:d.deletedProjectIds || [], performanceRecords, counts:{users:d.users.length, cases:d.cases.length, performanceRecords:performanceRecords.length, chatMessages:d.teamChat.length, notifications:d.notifications.length, attendanceLogs:d.attendanceLogs.length}, persistence});
  } catch (e) {
    sendApiFailure(res, req, e, 'State save failed.');
  }
});


app.post('/api/cases', requireAnyRole('ADMIN','MANAGER'), uploadAny, requireFreshAuthenticatedRequestAfterBody, requireAnyRole('ADMIN','MANAGER'), async (req,res)=>{
  let preparedUploads=[];
  let persistenceCommitted=false;
  let rollbackActor='system';
  let rollbackCaseId='';
  try {
    const d = selectiveDb({ collections:['cases','files','notifications','audit'] });
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
    sendApiFailure(res, req, error, 'Case creation failed.');
  }
});

app.post('/api/cases/:id/assign', requireAnyRole('ADMIN','MANAGER'), requireCaseAction('update',{notifications:true,audit:true}), async (req,res)=>{
  const d = requestDb(req);
  const c = req.caseRecord;
  const actor = requestActor(req);
  const mutation=prepareDedicatedTaskMutation(req,c,'assign');
  if (mutation.replay) return res.json({...c,idempotent:true});
  const previousCase=structuredClone(c);
  const assigneeId = textValue(req.body.assigneeId, 'Assignee', 200, { required:true });
  const user = (d.users || []).find(item => String(item.id || '') === assigneeId && normalizeAuthStatus(item.status || 'APPROVED') === 'APPROVED');
  if (!user) return res.status(400).json({ok:false,code:'ASSIGNEE_NOT_FOUND',error:'Assignee not found or inactive.'});
  c.assigneeId=user.id; c.assigneeName=user.name; c.assigneeRole=user.role; c.assignedTo=user.name; c.assignedBy=actor.name;
  c.status='ASSIGNED'; c.assignedAt=Date.now(); c.assignmentVersion=Date.now(); c.updatedAt=Date.now(); c.syncVersion=Date.now();
  c.ownership={...(c.ownership || {}),assignedTo:user.name,assignedBy:actor.name};
  c.history ||= []; c.history.unshift({at:now(),by:actor.name,action:`Assigned to ${user.name}`});
  addCaseTimelineEvent(c,{type:'assigned',by:actor.name,title:`Assigned to ${user.name}`,remarks:textValue(req.body.remarks || '', 'Remarks', MAX_TIMELINE_TEXT_LENGTH)});
  commitDedicatedTaskMutation(c,previousCase,mutation);
  const notification=notifyUser(d,user.name,`Task assigned to you: ${c.caseId}`,'task',c.id);
  const auditEntry=addAudit(d,actor.name,'Task assigned',c.caseId);
  await save(d,{actor:actor.name,reason:'case_assign',takeSnapshotOwnership:true,collections:['cases','notifications','audit'],collectionRowIds:{cases:[String(c.id)],notifications:[String(notification.id)],audit:[String(auditEntry.id)]}}); res.json(c);
});

app.post('/api/cases/:id/start', requireCaseAction('start'), async (req,res)=>{
  const d=requestDb(req); const c=req.caseRecord; const actor=requestActor(req);
  const mutation=prepareDedicatedTaskMutation(req,c,'start');
  if (mutation.replay) return res.json({...c,idempotent:true});
  const previousCase=structuredClone(c);
  c.status='IN_PROGRESS'; c.startedAt ||= now(); c.updatedAt=Date.now(); c.syncVersion=Date.now();
  c.history ||= []; c.history.unshift({at:now(),by:actor.name,action:'Work started'});
  addCaseTimelineEvent(c,{type:'started',by:actor.name,title:'Designer Started',remarks:textValue(req.body.remarks || '', 'Remarks', MAX_TIMELINE_TEXT_LENGTH)});
  assertTaskLifecycleTransition(previousCase,c,actor);
  commitDedicatedTaskMutation(c,previousCase,mutation);
  await save(d,{actor:actor.name,reason:'case_start',takeSnapshotOwnership:true,collections:['cases'],collectionRowIds:{cases:[String(c.id)]}}); res.json(c);
});

app.post('/api/cases/:id/upload-source', requireAnyRole('ADMIN','MANAGER'), preauthorizeCaseAction('update'), uploadAny, requireFreshAuthenticatedRequestAfterBody, requireAnyRole('ADMIN','MANAGER'), requireCaseAction('update',{files:true,notifications:true}), async (req,res)=>{
  let preparedUploads=[];
  let persistenceCommitted=false;
  try {
    const actor=requestActor(req);
    preparedUploads=await prepareSecureUploads(req, 'SOURCE');
    if (!(req.files || []).length) return res.status(400).json({ok:false,code:'FILE_REQUIRED',error:'Select at least one source file.'});
    const {snapshot:d,caseRecord:c}=taskDb(req.params.id,{files:true,notifications:true});
    if (!c) throw Object.assign(new Error('Case not found.'),{statusCode:404,code:'CASE_NOT_FOUND'});
    if (!canMutateCase(req.auth?.user || {},c,'update')) throw Object.assign(new Error('You cannot upload source files to this task.'),{statusCode:403,code:'FILE_UPLOAD_FORBIDDEN'});
    for(const file of req.files || []) c.documents.push(addFileRegistryEntry(d, docPayload(file,actor.name,actor.role,'SOURCE',c.id)));
    c.history ||= []; c.history.unshift({at:now(),by:actor.name,action:`Uploaded ${req.files?.length || 0} source file(s)`});
    addCaseTimelineEvent(c,{type:'source_uploaded',by:actor.name,title:`${req.files?.length || 0} source file(s) uploaded`});
    const notification=notifyUser(d,c.assigneeName,`New source files added for ${c.caseId}`,'task',c.id);
    const uploadedDocs=(req.files || []).map(file=>(c.documents || []).find(item=>item.storageKey===file.storageKey)).filter(Boolean);
    await save(d,{actor:actor.name,reason:'case_source_upload',takeSnapshotOwnership:true,collections:['cases','files','notifications'],collectionRowIds:{cases:[String(c.id)],files:uploadedDocs.map(doc=>String(doc.id)),notifications:[String(notification.id)]}});
    persistenceCommitted=true;
    await Promise.all((req.files || []).map(file=>{const doc=(c.documents || []).find(item=>item.storageKey===file.storageKey);return recordFileStorageEvent({fileId:doc?.id,caseId:c.id,action:'FILE_UPLOADED',actor:actor.name,storageKey:file.storageKey,sha256:file.sha256,details:{purpose:'SOURCE',name:file.originalname}});}));
    res.json(c);
  } catch (error) {
    cleanupRequestTempUploads(req);
    if (!persistenceCommitted) rollbackPreparedUploads(preparedUploads,{reason:'CASE_SOURCE_UPLOAD_PERSISTENCE_FAILED',actor:requestActor(req).name,caseId:req.caseRecord?.id || ''});
    if (error instanceof FileValidationError) return fileUploadFailure(res,error,'Source file upload failed.');
    sendApiFailure(res, req, error, 'Source file upload failed.');
  }
});

app.post('/api/cases/:id/upload-final', preauthorizeCaseAction('upload-final'), uploadAny, requireFreshAuthenticatedRequestAfterBody, requireCaseAction('upload-final',{files:true,notifications:true,audit:true}), async (req,res)=>{
  let preparedUploads=[];
  let persistenceCommitted=false;
  try {
    const actor=requestActor(req);
    const preflightCase=req.caseRecord;
    const requestedRevision=String(req.body.isRevision || 'false') === 'true';
    let isRevision=requestedRevision || statusKey(preflightCase?.status)==='REOPENEDFORREVISION';
    preparedUploads=await prepareSecureUploads(req, isRevision ? 'REVISION_FINAL' : 'FINAL');
    if (!(req.files || []).length) return res.status(400).json({ok:false,code:'FILE_REQUIRED',error:'Select at least one completed file.'});
    const {snapshot:d,caseRecord:c}=taskDb(req.params.id,{files:true,notifications:true,audit:true});
    if (!c) throw Object.assign(new Error('Case not found.'),{statusCode:404,code:'CASE_NOT_FOUND'});
    if (!canMutateCase(req.auth?.user || {},c,'upload-final')) throw Object.assign(new Error('You cannot upload completed files to this task.'),{statusCode:403,code:'FILE_UPLOAD_FORBIDDEN'});
    isRevision=requestedRevision || statusKey(c.status)==='REOPENEDFORREVISION';
    const previousCase=structuredClone(c);
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
    assertTaskLifecycleTransition(previousCase,c,actor);
    await save(d,{actor:actor.name,reason:isRevision?'case_revision_final_upload':'case_final_upload',takeSnapshotOwnership:true,collections:['cases','files','notifications','audit'],collectionRowIds:{cases:[String(c.id)],files:uploadedDocs.map(doc=>String(doc.id)),notifications:notifications.map(item=>String(item.id)),audit:[String(auditEntry.id)]}});
    persistenceCommitted=true;
    await Promise.all((req.files || []).map(file=>{const doc=(c.documents || []).find(item=>item.storageKey===file.storageKey);return recordFileStorageEvent({fileId:doc?.id,caseId:c.id,action:'FILE_UPLOADED',actor:actor.name,storageKey:file.storageKey,sha256:file.sha256,details:{purpose:isRevision?'REVISION_FINAL':'FINAL',name:file.originalname}});}));
    res.json(c);
  } catch (error) {
    cleanupRequestTempUploads(req);
    if (!persistenceCommitted) rollbackPreparedUploads(preparedUploads,{reason:'CASE_FINAL_UPLOAD_PERSISTENCE_FAILED',actor:requestActor(req).name,caseId:req.caseRecord?.id || ''});
    if (error instanceof FileValidationError) return fileUploadFailure(res,error,'Completed file upload failed.');
    sendApiFailure(res, req, error, 'Completed file upload failed.');
  }
});

app.post('/api/cases/:id/manager-complete', requireAnyRole('ADMIN','MANAGER'), requireCaseAction('review',{notifications:true,audit:true}), async (req,res)=>{
  const d=requestDb(req); const c=req.caseRecord; const actor=requestActor(req);
  const mutation=prepareDedicatedTaskMutation(req,c,'manager-complete');
  if (mutation.replay) return res.json({...c,idempotent:true});
  const previousCase=structuredClone(c);
  assertTaskLifecycleTransition(c,{...c,status:'COMPLETED'},actor);
  c.status='COMPLETED'; c.completedAt=now(); c.updatedAt=Date.now(); c.syncVersion=Date.now();
  c.history ||= []; c.history.unshift({at:now(),by:actor.name,action:'Reviewed by manager and marked complete'});
  addCaseTimelineEvent(c,{type:'approved',by:actor.name,title:'Approved',remarks:'Reviewed by manager and marked complete'});
  commitDedicatedTaskMutation(c,previousCase,mutation);
  const notifications=[
    notifyRole(d,'ADMIN',`Case completed after manager review: ${c.caseId}`,'completed',c.id),
    notifyUser(d,c.assigneeName,`Case marked complete: ${c.caseId}`,'completed',c.id)
  ];
  const auditEntry=addAudit(d,actor.name,'Case completed',c.caseId);
  await save(d,{actor:actor.name,reason:'case_manager_complete',takeSnapshotOwnership:true,collections:['cases','notifications','audit'],collectionRowIds:{cases:[String(c.id)],notifications:notifications.map(item=>String(item.id)),audit:[String(auditEntry.id)]}}); res.json(c);
});

app.post('/api/cases/:id/revision', requireAnyRole('ADMIN','MANAGER'), requireCaseAction('revision',{notifications:true}), async (req,res)=>{
  const d=requestDb(req); const c=req.caseRecord; const actor=requestActor(req);
  const mutation=prepareDedicatedTaskMutation(req,c,'revision');
  if (mutation.replay) return res.json({...c,idempotent:true});
  const previousCase=structuredClone(c);
  c.status='REOPENED_FOR_REVISION'; c.priority='Urgent'; c.updatedAt=Date.now(); c.syncVersion=Date.now();
  const rev={id:nanoid(8),note:textValue(req.body.note || 'Banker revision requested','Revision note',MAX_TIMELINE_TEXT_LENGTH,{required:true}),by:actor.name,createdAt:now()};
  c.revisions ||= []; c.revisions.unshift(rev); c.history ||= []; c.history.unshift({at:now(),by:actor.name,action:'Revision opened as urgent'});
  addCaseTimelineEvent(c,{type:'revision_created',by:actor.name,at:rev.createdAt,title:'Revision Created',remarks:rev.note});
  commitDedicatedTaskMutation(c,previousCase,mutation);
  const notifications=[
    notifyUser(d,c.assigneeName,`URGENT revision task: ${c.caseId} - ${rev.note}`,'task',c.id),
    notifyRole(d,'MANAGER',`URGENT revision opened: ${c.caseId}`,'task',c.id)
  ];
  await save(d,{actor:actor.name,reason:'case_revision_open',takeSnapshotOwnership:true,collections:['cases','notifications'],collectionRowIds:{cases:[String(c.id)],notifications:notifications.map(item=>String(item.id))}}); res.json(c);
});

app.get('/api/cases/:id/timeline', requireCaseAction('read'), async (req,res)=>{
  const c=req.caseRecord; c.timeline=normalizeCaseTimeline(c);
  res.json({ok:true,caseId:c.id,caseNo:c.caseId,timeline:c.timeline});
});

app.post('/api/cases/:id/timeline', requireCaseAction('timeline',{audit:true}), async (req,res)=>{
  const d=requestDb(req); const c=req.caseRecord; const actor=requestActor(req);
  const mutation=prepareDedicatedTaskMutation(req,c,'timeline');
  if (mutation.replay) return res.json({ok:true,idempotent:true,event:null,timeline:c.timeline || [],case:c});
  const previousCase=structuredClone(c);
  const event=addCaseTimelineEvent(c,{
    type:textValue(req.body.type || 'manual','Event type',100),
    by:actor.name,
    title:textValue(req.body.title || req.body.text || 'Timeline Event','Timeline title',MAX_TIMELINE_TEXT_LENGTH,{required:true}),
    remarks:textValue(req.body.remarks || req.body.note || '','Timeline remarks',MAX_TIMELINE_TEXT_LENGTH),
    meta:req.body.meta && typeof req.body.meta === 'object' ? req.body.meta : {}
  });
  commitDedicatedTaskMutation(c,previousCase,mutation);
  const auditEntry=addAudit(d,actor.name,'Timeline event added',c.caseId);
  await save(d,{actor:actor.name,reason:'case_timeline_add',takeSnapshotOwnership:true,collections:['cases','audit'],collectionRowIds:{cases:[String(c.id)],audit:[String(auditEntry.id)]}});
  res.json({ok:true,event,timeline:c.timeline,case:c});
});

app.post('/api/state/projects/:id/payment-status', async (req, res) => {
  if (!isFinanceAdminRequest(req)) return denyFinanceAccess(res);
  const requestStartedAt = Date.now();
  try {
    const mutationId = financeMutationId(req.body || {});
    const mutationOperation = 'payment-status';
    const mutationFingerprint = mutationId ? financeMutationFingerprint(mutationOperation, req.body || {}) : '';
    const replay = mutationId ? await resolveCommittedFinanceReplay({ caseId:req.params.id, mutationId, fingerprint:mutationFingerprint, operation:mutationOperation }) : null;
    if (replay?.committedCase) {
      const paymentId = String(replay.receipt?.paymentId || replay.committedCase.ledger?.financeLedgerId || '').trim();
      const committedPayment = paymentId ? (replay.committedState?.payments || []).find(item => String(item.id || '') === paymentId) : null;
      const confirmedProject = financeResponsePatch(replay.committedCase);
      return res.json({
        ok:true,
        idempotent:true,
        project:confirmedProject,
        case:confirmedProject,
        payment:committedPayment || null,
        financeVersion:replay.committedCase.financeVersion,
        persistence:{ database:USE_POSTGRES ? 'postgresql-relational' : 'json-file', stateVersion, alreadyCommitted:true },
        durationMs:Date.now() - requestStartedAt
      });
    }
    const financeSnapshot = financeDb(req.params.id);
    if (!financeSnapshot) return res.status(404).json({ ok:false, error:'Case not found' });
    const d = financeSnapshot.snapshot;
    const c = financeSnapshot.caseRecord;
    assertExpectedFinanceVersion(c, req.body || {});
    const previousSnapshot = buildFinanceSnapshot(c);
    const status = normalizePaymentTrackingStatus(req.body.paymentTrackingStatus || req.body.status || req.body.paymentStatus);
    const actor = requestActor(req);
    const updated = upsertInlinePaymentLedger(d, c, status, { ...(req.body || {}), by:actor.name, updatedBy:actor.name }, { mutationId, fingerprint:mutationFingerprint, operation:mutationOperation });
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
      skipRevisionSnapshot:true,
      periodicRevisionSnapshot:true,
      revisionSnapshotInterval:10,
      revisionSnapshotMaxAgeMinutes:15,
      takeSnapshotOwnership:true,
      financeEvent: {
        caseId: String(updated.id || updated.caseId || req.params.id),
        caseNo: updated.caseId || updated.id || '',
        action: `Payment status changed to ${updated.paymentTrackingStatus || status}`,
        actor: actor.name,
        previousSnapshot,
        nextSnapshot
      }
    });
    res.setHeader('Server-Timing', `finance;dur=${Math.max(0, Date.now() - requestStartedAt)}`);
    const confirmedProject = financeResponsePatch(updated);
    res.json({ ok:true, project:confirmedProject, case:confirmedProject, payment:changedPayment || null, financeVersion:updated.financeVersion, persistence, durationMs:Date.now() - requestStartedAt });
  } catch (e) {
    sendApiFailure(res, req, e, 'Payment status update failed.', { currentFinanceVersion:e.currentFinanceVersion });
  }
});

app.post('/api/cases/:id/payment', async (req,res)=>{
  if (!isFinanceAdminRequest(req)) return denyFinanceAccess(res);
  try {
    const mutationId=financeMutationId(req.body || {});
    const mutationOperation='payment-ledger';
    const mutationFingerprint=mutationId ? financeMutationFingerprint(mutationOperation,req.body || {}) : '';
    const replay=mutationId ? await resolveCommittedFinanceReplay({caseId:req.params.id,mutationId,fingerprint:mutationFingerprint,operation:mutationOperation}) : null;
    if (replay?.committedCase) {
      const paymentId=String(replay.receipt?.paymentId || '').trim();
      const committedPayment=paymentId ? (replay.committedState?.payments || []).find(item=>String(item?.id || '')===paymentId) : null;
      const confirmedProject=financeResponsePatch(replay.committedCase);
      return res.json({ok:true,idempotent:true,payment:committedPayment || null,project:confirmedProject,case:confirmedProject,financeVersion:replay.committedCase.financeVersion,persistence:{database:USE_POSTGRES ? 'postgresql-relational' : 'json-file',stateVersion,alreadyCommitted:true}});
    }
    const financeSnapshot=financeDb(req.params.id);
    if(!financeSnapshot) return res.status(404).json({ok:false,error:'Case not found'});
    const d=financeSnapshot.snapshot;
    const c=financeSnapshot.caseRecord;
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
    const requestedPaymentDate=textValue(req.body.paymentDate||indiaDateKey(nowIso),'Payment date',20);
    const paymentDate=normalizeTaskDate(requestedPaymentDate,nowIso);
    if (!TASK_DATE_PATTERN.test(requestedPaymentDate) || paymentDate !== requestedPaymentDate) {
      const error=new Error('Payment date must be a valid date in YYYY-MM-DD format.');
      error.statusCode=400;
      error.code='INVALID_PAYMENT_DATE';
      throw error;
    }
    if (paymentDate > indiaDateKey(nowIso)) {
      const error=new Error('Payment date cannot be in the future.');
      error.statusCode=400;
      error.code='PAYMENT_DATE_IN_FUTURE';
      throw error;
    }
    const accountingPeriod=getCaseTaskAccountingPeriod(c, req.body.accountingPeriod || paymentDate || nowIso);
    const paymentAmount=numericValue(req.body.paymentAmountIn,'Payment amount',{min:0,max:100_000_000,fallback:0});
    const expenses=hasOwnFinanceValue(req.body,'expenses')
      ? numericValue(req.body.expenses,'Expenses',{min:0,max:100_000_000,fallback:previousExpenses})
      : previousExpenses;
    const refund=hasOwnFinanceValue(req.body,'refundAmount','refund')
      ? numericValue(req.body.refundAmount ?? req.body.refund,'Refund amount',{min:0,max:100_000_000,fallback:previousRefund})
      : previousRefund;
    if (refund > paymentAmount) {
      const error=new Error('Refund cannot be greater than the total amount received.');
      error.statusCode=400;
      error.code='REFUND_EXCEEDS_RECEIVED';
      throw error;
    }
    if (received === 'YES' && paymentAmount <= 0) {
      const error=new Error('Payment amount is required when paymentReceived is YES.');
      error.statusCode=400;
      error.code='PAYMENT_AMOUNT_REQUIRED';
      throw error;
    }
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
      paymentTime:textValue(req.body.paymentTime||localClock24FromMsServer(Date.now()),'Payment time',20),
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
    if (c.paymentAuditTrail.length > 500) c.paymentAuditTrail = c.paymentAuditTrail.slice(0, 500);
    c.history ||= [];
    c.history.unshift({at:nowIso,by:p.createdBy,action:`Payment ledger updated for ${accountingPeriod}: ${received}`});
    if (c.history.length > 1000) c.history = c.history.slice(0, 1000);
    const auditEntry=addAudit(d,p.createdBy,`Payment ledger updated for ${accountingPeriod}`,c.caseId);
    if (mutationId) rememberFinanceMutationReceipt(c,{mutationId,fingerprint:mutationFingerprint,operation:mutationOperation,financeVersion:c.financeVersion,paymentId:p.id,committedAt:nowIso});
    const nextSnapshot = buildFinanceSnapshot(c);
    const persistence = await save(d, {
      actor:p.createdBy,
      reason:'finance_payment_ledger_update',
      collections:['cases','payments','audit'],
      collectionRowIds:{cases:[String(c.id || c.caseId)],payments:[String(p.id)],audit:[String(auditEntry.id)]},
      skipRevisionSnapshot:true,
      periodicRevisionSnapshot:true,
      revisionSnapshotInterval:10,
      revisionSnapshotMaxAgeMinutes:15,
      takeSnapshotOwnership:true,
      financeEvent:{caseId:String(c.id || c.caseId),caseNo:c.caseId || c.id || '',action:`Payment ledger updated for ${accountingPeriod}: ${received}`,actor:p.createdBy,previousSnapshot,nextSnapshot}
    });
    const confirmedProject=financeResponsePatch(c);
    res.json({ok:true,payment:p,project:confirmedProject,case:confirmedProject,financeVersion:c.financeVersion,persistence});
  } catch (e) {
    sendApiFailure(res, req, e, 'Payment ledger update failed.', { currentFinanceVersion:e.currentFinanceVersion });
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
    sendApiFailure(res, req, e, 'Finance history could not be loaded.');
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
    sendApiFailure(res, req, e, 'Finance health check failed.');
  }
});


const SELF_PROFILE_FIELDS = Object.freeze(new Set(['phone','mobile','email','designation','aadharNumber','panNumber','emergencyContact','address','bankDetails']));
app.patch('/api/profile', async (req,res)=>{
  try {
    const actor = requestActor(req);
    const d = selectiveDb({collections:['users'],collectionRowIds:{users:[String(actor.id)]}});
    const user = findStateUserByIdOrUsername(actor.id, actor.username, d);
    if (!user) return res.status(404).json({ok:false,code:'PROFILE_NOT_FOUND',error:'Signed-in user record was not found.'});
    const patch=req.body && typeof req.body==='object' ? req.body : {};
    for (const field of Object.keys(patch)) {
      if (!SELF_PROFILE_FIELDS.has(field) && !['emailRegistered','mobileRegistered'].includes(field)) return res.status(400).json({ok:false,code:'SELF_PROFILE_FIELD_FORBIDDEN',error:`${field} cannot be changed from My Profile.`});
    }
    for (const field of SELF_PROFILE_FIELDS) if (Object.hasOwn(patch,field)) user[field]=String(patch[field] ?? '').trim();
    // Registration flags can only remain true after the OTP verifier has already
    // established them; a profile PATCH can never promote an unverified contact.
    if (patch.emailRegistered === false) user.emailRegistered=false;
    if (patch.mobileRegistered === false) user.mobileRegistered=false;
    user.updatedAt=Date.now();
    credentialSafeProfileUser(user);
    const persistence=await save(d,{actor:actor.name,reason:'self_profile_update',collections:['users'],collectionRowIds:{users:[String(user.id)]}});
    res.json({ok:true,user:publicSessionUser(user,req.auth.credential || {}),persistence});
  } catch (error) {
    sendApiFailure(res, req, Object.assign(error,{ code:error.code || 'PROFILE_UPDATE_FAILED' }), 'Profile could not be updated.');
  }
});

const PROFILE_PHOTO_MAX_MB = 5;
const PROFILE_PHOTO_UPLOAD_CONTRACT = Object.freeze({maxMb:PROFILE_PHOTO_MAX_MB,allowedMimeTypes:['image/png','image/jpeg','image/gif','image/webp','image/bmp']});
const profilePhotoUpload = uploadSingle('photo');
app.post('/api/profile/photo', profilePhotoUpload, requireFreshAuthenticatedRequestAfterBody, async (req, res) => {
  let preparedUploads=[];
  let persistenceCommitted=false;
  let rollbackActor='system';
  try {
    if (!req.file) return res.status(400).json({ ok:false, code:'FILE_REQUIRED', error:'No photo uploaded.' });
    if (Number(req.file.size || 0) > PROFILE_PHOTO_MAX_MB * 1024 * 1024) { cleanupRequestTempUploads(req); return res.status(413).json({ok:false,code:'PROFILE_PHOTO_TOO_LARGE',error:'Profile photos must be no larger than 5 MB.'}); }
    const actor = requestActor(req);
    const d = selectiveDb({collections:['users'],collectionRowIds:{users:[String(actor.id)]}});
    rollbackActor=actor.name;
    const user = findStateUserByIdOrUsername(actor.id, actor.username, d);
    if (!user) { cleanupRequestTempUploads(req); return res.status(404).json({ok:false,error:'Signed-in user record was not found.'}); }
    req.files=[req.file];
    preparedUploads=await prepareSecureUploads(req,'PROFILE',{imagesOnly:true});
    if (!PROFILE_PHOTO_UPLOAD_CONTRACT.allowedMimeTypes.includes(String(req.file.mimetype || '').toLowerCase())) throw new FileValidationError('PROFILE_PHOTO_INVALID','Profile photos must be PNG, JPEG, GIF, WebP or BMP.',400);
    const previousKey=user.profilePhotoStorageKey || user.profilePhotoFile || '';
    const profilePhoto=`/api/profile/photo/${encodeURIComponent(user.id || user.username)}`;
    if (user.profilePhotoSha256 && user.profilePhotoSha256 === req.file.sha256 && previousKey) {
      const confirmed=publicSessionUser(user,req.auth.credential || {});
      persistenceCommitted=true;
      return res.json({ok:true,idempotent:true,updated:false,user:confirmed,profilePhoto,url:profilePhoto,storedName:path.basename(previousKey),storageKey:previousKey,sha256:user.profilePhotoSha256});
    }
    user.profilePhoto=profilePhoto;
    user.profilePhotoFile=req.file.storageKey;
    user.profilePhotoStorageKey=req.file.storageKey;
    user.profilePhotoSha256=req.file.sha256;
    user.profilePhotoMime=req.file.mimetype;
    user.profilePhotoOriginalName=req.file.originalname;
    user.profileUpdatedAt=Date.now();
    user.profilePhotoUpdatedAt=Date.now();
    credentialSafeProfileUser(user);
    const persistence=await save(d,{actor:actor.name,reason:'profile_photo_update',collections:['users'],collectionRowIds:{users:[String(user.id)]}});
    persistenceCommitted=true;
    if (previousKey && previousKey !== req.file.storageKey) {
      await recordFileStorageEvent({action:'PROFILE_PHOTO_REPLACED',actor:actor.name,storageKey:previousKey,details:{userId:user.id,physicalAction:'retained-for-safe-gc'}});
    }
    res.json({ok:true,user:publicSessionUser(user,req.auth.credential || {}),profilePhoto,url:profilePhoto,storedName:path.basename(req.file.storageKey),storageKey:req.file.storageKey,sha256:req.file.sha256,updated:true,persistence});
  } catch (error) {
    cleanupRequestTempUploads(req);
    if (!persistenceCommitted) rollbackPreparedUploads(preparedUploads,{reason:'PROFILE_PHOTO_PERSISTENCE_FAILED',actor:rollbackActor});
    if (error instanceof FileValidationError) return fileUploadFailure(res,error,'Profile photo upload failed.');
    sendApiFailure(res, req, error, 'Profile photo upload failed.');
  }
});

function normalizeFilePurposeType(value = '') {
  return String(value || 'source').trim().toLowerCase();
}

function storedFilePurpose(type = '') {
  return ({
    source:'SOURCE',
    working:'WORKING',
    completed:'FINAL',
    revision:'REVISION',
    discussion:'DISCUSSION',
    'payment-receipt':'PAYMENT_RECEIPT',
    chat:'CHAT'
  })[normalizeFilePurposeType(type)] || '';
}

function appendUniqueDocument(list = [], file = {}) {
  const incomingId=String(file?.id || '').trim();
  const existing=Array.isArray(list) ? list : [];
  if (incomingId && existing.some(doc=>String(doc?.id || '').trim()===incomingId)) return existing;
  return [...existing, structuredClone(file)];
}

function attachStoredFileToCase(caseRecord = {}, file = {}, type = '', actor = {}) {
  const normalizedType=normalizeFilePurposeType(type);
  if (!caseRecord || normalizedType === 'chat' || normalizedType === 'payment-receipt') return caseRecord;
  caseRecord.documents=appendUniqueDocument(caseRecord.documents || [],file);
  if (normalizedType === 'source') caseRecord.sourceFiles=appendUniqueDocument(caseRecord.sourceFiles || [],file);
  if (normalizedType === 'working') caseRecord.workFiles=appendUniqueDocument(caseRecord.workFiles || [],file);
  if (normalizedType === 'completed') {
    caseRecord.completedFiles=appendUniqueDocument(caseRecord.completedFiles || [],file);
    const stamp=Date.now();
    caseRecord.status='Internal Review';
    caseRecord.submittedAt=caseRecord.submittedAt || stamp;
    caseRecord.draftingCompletedAt=caseRecord.draftingCompletedAt || stamp;
    caseRecord.internalReviewStartedAt=caseRecord.internalReviewStartedAt || stamp;
    caseRecord.completedAt=null;
    caseRecord.finalConclusion='Pending Internal Review';
    caseRecord.reviewStatus='Pending';
    caseRecord.subTasks=(caseRecord.subTasks || []).map(st=>!['DONE','COMPLETED','CLOSED'].includes(statusKey(st?.status)) ? {...st,status:'Done',completedBy:actor.name,completedAt:stamp} : st);
  }
  addCaseTimelineEvent(caseRecord,{
    type:normalizedType === 'completed' ? 'final_file_uploaded' : 'file_uploaded',
    by:actor.name,
    title:normalizedType === 'completed' ? 'Completed work file uploaded for internal review' : 'File uploaded',
    remarks:file.name || file.id
  });
  caseRecord.updatedAt=Date.now();
  caseRecord.syncVersion=caseRecord.updatedAt;
  caseRecord.updatedBy=actor.name;
  caseRecord.taskVersion=nextTaskVersion(caseRecord);
  caseRecord.lastTaskMutationId=`file:${file.id}`;
  caseRecord.lastTaskMutationAt=now();
  return caseRecord;
}

app.post('/api/files/upload', uploadAny, requireFreshAuthenticatedRequestAfterBody, async (req, res) => {
  let preparedUploads=[];
  let persistenceCommitted=false;
  let rollbackActor='system';
  let rollbackCaseId='';
  try {
    const incomingFiles=req.files || [];
    if (!incomingFiles.length) return res.status(400).json({ok:false,code:'FILE_REQUIRED',error:'No file uploaded.'});
    if (incomingFiles.length !== 1) { cleanupRequestTempUploads(req); return res.status(400).json({ok:false,code:'SINGLE_FILE_REQUIRED',error:'This endpoint accepts one file at a time.'}); }
    const actor=requestActor(req);
    rollbackActor=actor.name;
    const type=normalizeFilePurposeType(req.body.type || 'source');
    const purpose=storedFilePurpose(type);
    if (!purpose) { cleanupRequestTempUploads(req); return res.status(400).json({ok:false,code:'FILE_PURPOSE_INVALID',error:'Invalid file purpose.'}); }
    const projectId=textValue(req.body.projectId || req.body.caseId || '', 'Project id', 200);
    const taskMutationId=textValue(req.body.taskMutationId || req.body.projectMutationId || '', 'Task mutation id', 200);
    const uploadMutationId=textValue(req.body.mutationId || req.body.uploadMutationId || '', 'Upload mutation id', 200);
    const uploadedById=String(actor.id || '').trim();
    const requestedChatScope=type === 'chat' && String(req.body.chatScope || 'PRIVATE').toUpperCase() === 'GLOBAL' ? 'GLOBAL' : (type === 'chat' ? 'PRIVATE' : '');
    const requestedChatParticipants=type === 'chat' ? [actor.id,actor.username,actor.name,req.body.recipientId,req.body.recipientUsername,req.body.recipient]
      .map(value=>String(value || '').trim().toLowerCase()).filter(Boolean).filter((value,index,list)=>list.indexOf(value)===index).sort() : [];
    const requestedVoiceNote=type === 'chat' && ['true','1','yes'].includes(String(req.body.isVoiceNote || '').toLowerCase());
    rollbackCaseId=projectId;
    let resolvedProjectId=projectId;

    const findUploadTarget=(state)=>{
      // A pending create can be committed under a different canonical task ID
      // when the optimistic browser ID collides with an existing task. When the
      // create mutation identity is available it is the stronger, unambiguous
      // reference and must win before the stale optimistic ID is considered.
      // Otherwise a stale ID that now belongs to another task could receive the
      // attachment even though the file belongs to the newly created task.
      if (taskMutationId) {
        const byMutation=(state.cases || []).find(record=>String(record?.lastTaskMutationId || '')===taskMutationId) || null;
        if (byMutation) return byMutation;
      }
      if (!projectId) return null;
      return findCaseByAnyId(state.cases || [],projectId);
    };
    const authorizeUpload=(state)=>{
      const record=findUploadTarget(state);
      if (projectId && !record) { const error=new Error('The target task was not found.'); error.statusCode=404; error.code='CASE_NOT_FOUND'; throw error; }
      if (record) { resolvedProjectId=String(record.id || record.caseId || projectId); rollbackCaseId=resolvedProjectId; }
      if (type === 'source' && !['ADMIN','MANAGER'].includes(actor.role)) { const error=new Error('Only Admins and Managers can upload source files.'); error.statusCode=403; error.code='SOURCE_UPLOAD_FORBIDDEN'; throw error; }
      if (type === 'payment-receipt' && actor.role !== 'ADMIN') { const error=new Error('Only an Admin can upload payment receipts.'); error.statusCode=403; error.code='PAYMENT_RECEIPT_FORBIDDEN'; throw error; }
      if (record && !['source','payment-receipt'].includes(type) && !canMutateCase(req.auth?.user || {},record,type === 'completed' ? 'upload-final' : 'upload-working')) { const error=new Error('You cannot upload files to this task.'); error.statusCode=403; error.code='FILE_UPLOAD_FORBIDDEN'; throw error; }
      if (!projectId && type !== 'chat') { const error=new Error('A task reference is required for this upload.'); error.statusCode=400; error.code='UNSCOPED_UPLOAD_FORBIDDEN'; throw error; }
      return record;
    };
    const storedUploadType=(item={})=>{
      const explicit=String(item?.type || item?.folder || '').trim().toLowerCase();
      if (explicit) return explicit;
      return ({SOURCE:'source',WORKING:'working',FINAL:'completed',REVISION:'revision',REVISION_FINAL:'completed',DISCUSSION:'discussion',PAYMENT_RECEIPT:'payment-receipt',CHAT:'chat'})[String(item?.purpose || '').trim().toUpperCase()] || '';
    };
    const sameUploadActor=(item={})=>{
      const storedKeys=[item?.uploadedById,item?.uploadedByUsername,item?.uploadedBy].map(value=>String(value || '').trim().toLowerCase()).filter(Boolean);
      const actorKeys=[actor.id,actor.username,actor.name].map(value=>String(value || '').trim().toLowerCase()).filter(Boolean);
      return storedKeys.some(value=>actorKeys.includes(value));
    };
    const findCommittedUpload=(state={},incomingFile=null)=>{
      if (!uploadMutationId) return null;
      const candidates=(Array.isArray(state.files) ? state.files : []).filter(item=>String(item?.uploadMutationId || '')===uploadMutationId && sameUploadActor(item));
      if (!candidates.length) return null;
      const targetRecord=projectId ? findUploadTarget(state) : null;
      const targetIds=new Set(targetRecord ? getCaseIdentitySet(targetRecord) : [String(resolvedProjectId || projectId || '')]);
      const incomingName=String(incomingFile?.originalname || incomingFiles[0]?.originalname || '').trim();
      const incomingSize=Number(incomingFile?.size || incomingFiles[0]?.size || 0);
      const incomingSha=String(incomingFile?.sha256 || '').trim();
      const exact=candidates.find(item=>{
        const storedParticipants=(Array.isArray(item?.chatParticipants) ? item.chatParticipants : []).map(value=>String(value || '').toLowerCase()).sort();
        const sameParticipants=requestedChatParticipants.length === storedParticipants.length && requestedChatParticipants.every((value,index)=>value === storedParticipants[index]);
        const sameTarget=!projectId || targetIds.has(String(item?.caseId || ''));
        const sameType=storedUploadType(item)===type;
        const sameName=!incomingName || String(item?.originalName || item?.name || '').trim()===incomingName;
        const sameSize=!incomingSize || Number(item?.size || 0)===incomingSize;
        const sameSha=!incomingSha || !item?.sha256 || String(item.sha256)===incomingSha;
        const sameChat=type!=='chat' || (String(item?.chatScope || 'PRIVATE')===requestedChatScope && sameParticipants && Boolean(item?.isVoiceNote)===requestedVoiceNote);
        return sameTarget && sameType && sameName && sameSize && sameSha && sameChat;
      }) || null;
      if (exact) return exact;
      const error=new Error('This upload retry identity was already used for a different file or destination. Select the file again to create a new upload identity.');
      error.statusCode=409;
      error.code='UPLOAD_MUTATION_ID_REUSE';
      throw error;
    };
    const idempotentUploadResponse=(state,existingFile)=>{
      const linkedCase=projectId ? findUploadTarget(state) : null;
      const visibleCase=linkedCase ? (sanitizeCasesForRole([linkedCase],actor.role)[0] || linkedCase) : null;
      return {ok:true,idempotent:true,file:existingFile,project:visibleCase,case:visibleCase,requestedProjectId:projectId,resolvedProjectId,persistence:{mode:'idempotent',persisted:true,reason:'DUPLICATE_UPLOAD_MUTATION'}};
    };

    const initialState=readDb();
    authorizeUpload(initialState);
    // Validate and hash the incoming bytes before confirming an idempotent retry.
    // Filename/size metadata alone is not strong enough: two different files can
    // legitimately share them. This makes response-loss retry exact rather than
    // risking a silent attachment substitution.
    preparedUploads=await prepareSecureUploads(req,purpose);
    if (type === 'payment-receipt') {
      const detected=String(req.file?.mimetype || '').toLowerCase();
      if (!(detected === 'application/pdf' || detected.startsWith('image/'))) throw new FileValidationError('PAYMENT_RECEIPT_TYPE_INVALID','Payment receipts must be a PDF or supported image file.',400);
    }

    const uploadSnapshot=taskDb(resolvedProjectId,{files:true});
    const d=uploadSnapshot.snapshot;
    const caseRecord=authorizeUpload(d);
    const concurrentUpload=findCommittedUpload(d,req.file);
    if (concurrentUpload) {
      // The verified content-addressed object is the same object referenced by
      // the existing committed row. Keep it active and return that row rather
      // than creating another file record after a lost browser response.
      preparedUploads=[]; cleanupRequestTempUploads(req);
      return res.status(200).json(idempotentUploadResponse(d,concurrentUpload));
    }
    const file=docPayload(req.file,actor.name,actor.role,purpose,resolvedProjectId);
    file.uploadMutationId=uploadMutationId || nanoid(16);
    file.uploadedById=actor.id;
    file.uploadedByUsername=actor.username;
    file.type=type;
    file.folder=type;
    file.isVoiceNote=requestedVoiceNote;
    if (type === 'chat') {
      file.chatScope=requestedChatScope;
      file.chatParticipants=requestedChatParticipants;
      if (requestedVoiceNote && String(file.name || '').toLowerCase().endsWith('.webm')) { file.mime='audio/webm'; file.mimeType='audio/webm'; }
    }
    addFileRegistryEntry(d,file);
    let updatedCase=null;
    if (caseRecord && !['chat','payment-receipt'].includes(type)) {
      const previousCase=structuredClone(caseRecord);
      updatedCase=attachStoredFileToCase(caseRecord,file,type,actor);
      assertTaskLifecycleTransition(previousCase,updatedCase,actor);
    }
    const collections=['files'];
    const collectionRowIds={files:[String(file.id)]};
    if (updatedCase) { collections.push('cases'); collectionRowIds.cases=[String(updatedCase.id || updatedCase.caseId)]; }
    const persistence=await save(d,{actor:actor.name,reason:'file_upload',skipRevisionSnapshot:true,periodicRevisionSnapshot:true,takeSnapshotOwnership:true,collections,collectionRowIds});
    persistenceCommitted=true;
    await recordFileStorageEvent({fileId:file.id,caseId:resolvedProjectId,action:'FILE_UPLOADED',actor:actor.name,storageKey:file.storageKey,sha256:file.sha256,details:{purpose,name:file.name,requestedProjectId:projectId}});
    const visibleCase=updatedCase ? (sanitizeCasesForRole([updatedCase],actor.role)[0] || updatedCase) : null;
    res.status(201).json({ok:true,file,project:visibleCase,case:visibleCase,requestedProjectId:projectId,resolvedProjectId,persistence});
  } catch (error) {
    cleanupRequestTempUploads(req);
    if (!persistenceCommitted) rollbackPreparedUploads(preparedUploads,{reason:'FILE_REGISTRY_PERSISTENCE_FAILED',actor:rollbackActor,caseId:rollbackCaseId});
    if (error instanceof FileValidationError) return fileUploadFailure(res,error,'File upload failed.');
    sendApiFailure(res, req, error, 'File upload failed.');
  }
});

function getStoredFilePreviewDescriptor(doc = {}, resolved = {}) {
  const fileName=String(doc.name || doc.fileName || resolved.stored || 'file');
  const extension=`.${fileName.split('.').pop()?.toLowerCase() || ''}`;
  const mime=String(doc.mime || doc.mimeType || '').toLowerCase();
  const purpose=String(doc.purpose || doc.type || doc.folder || fileName).toLowerCase();
  const genericMime = !mime || mime === 'application/octet-stream';
  const imageExtensions=new Set(['.jpg','.jpeg','.png','.gif','.webp','.bmp','.heic','.heif']);
  const videoExtensions=new Set(['.mp4','.mov','.avi','.mkv','.webm']);
  const audioExtensions=new Set(['.mp3','.wav','.m4a','.ogg','.webm']);
  const textExtensions=new Set(['.txt','.csv','.json','.md','.log','.rtf']);
  const officeExtensions=new Set(['.doc','.docx','.xls','.xlsx','.ppt','.pptx']);
  const cadExtensions=new Set(['.dwg','.dxf']);
  const extensionKind = imageExtensions.has(extension) ? 'image'
    : videoExtensions.has(extension) ? 'video'
    : audioExtensions.has(extension) ? 'audio'
    : textExtensions.has(extension) ? 'text'
    : officeExtensions.has(extension) ? 'office'
    : cadExtensions.has(extension) ? 'cad' : 'file';
  // Inline preview capability is extension-bound. Current uploads are
  // signature-validated against their extensions, and legacy MIME metadata is
  // not trusted to turn an otherwise unsupported active format (for example
  // SVG/HTML) into an inline image/text response.
  const kind = extension === '.webm' && /(voice|audio)/.test(purpose) ? 'audio'
    : extension === '.pdf' ? 'pdf'
    : extensionKind;
  const inferredMimeByExtension={
    '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp','.heic':'image/heic','.heif':'image/heif',
    '.mp4':'video/mp4','.mov':'video/quicktime','.avi':'video/x-msvideo','.mkv':'video/x-matroska','.webm':kind === 'audio' ? 'audio/webm' : 'video/webm',
    '.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.ogg':'audio/ogg',
    '.txt':'text/plain; charset=utf-8','.csv':'text/csv; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/markdown; charset=utf-8','.log':'text/plain; charset=utf-8','.rtf':'application/rtf'
  };
  const canonicalStreamMime = kind === 'pdf' ? 'application/pdf' : (['image','video','audio','text'].includes(kind) ? inferredMimeByExtension[extension] : '');
  const mimeType = extension === '.webm' && kind === 'audio' ? 'audio/webm'
    : (canonicalStreamMime || (!genericMime ? mime : 'application/octet-stream'));
  return {fileName,extension,mime,mimeType,kind,fp:resolved.fp,stored:resolved.stored};
}
function contentDispositionValue(mode = 'attachment', fileName = 'file') {
  const raw=String(fileName || 'file').replace(/[\r\n\0]/g,'').slice(0,240) || 'file';
  const ascii=raw.replace(/[^\x20-\x7e]/g,'_').replace(/["\\]/g,'_');
  const encoded=encodeURIComponent(raw).replace(/['()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
function applyPrivateFileResponseHeaders(res, descriptor = {}, mode = 'download', size = null) {
  const fileName=descriptor.fileName;
  res.setHeader('Access-Control-Expose-Headers','Content-Disposition, Content-Length, Content-Type, Accept-Ranges');
  res.setHeader('Cache-Control','private, no-store, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Accept-Ranges','bytes');
  if (mode === 'preview') res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'");
  if (descriptor.mimeType) res.setHeader('Content-Type',descriptor.mimeType);
  if (Number.isFinite(size)) res.setHeader('Content-Length',String(size));
  res.setHeader('Content-Disposition',contentDispositionValue(mode === 'preview' ? 'inline' : 'attachment',fileName));
}
async function sendAuthorizedStoredFile(req,res,mode='download') {
  const {doc,resolved,denied}=resolveAuthorizedFile(req,res,req.params.id);
  if (denied) return;
  if (!doc) return res.status(404).send('File record not found. It may be an older unsaved upload. Please refresh the page or re-upload the file.');
  if (!resolved) return res.status(410).send('File unavailable on server. The record exists, but the physical file is missing. Please re-upload this file once.');
  const descriptor=getStoredFilePreviewDescriptor(doc,resolved);
  const fp=descriptor.fp;
  if (!isResolvedStoragePathAllowed(fp)) return res.status(400).send('Invalid file path');
  if (mode === 'preview' && !['pdf','image','video','audio','text'].includes(descriptor.kind)) return res.status(415).send('Inline preview is not available for this file type. Download the file instead.');
  const stat=await fs.promises.stat(fp);
  applyPrivateFileResponseHeaders(res,descriptor,mode,stat.size);
  return res.sendFile(fp);
}

app.get('/api/files/:id',async (req,res)=>{
  const mode=String(req.query.mode || '').toLowerCase();
  if (!['preview','download'].includes(mode)) return res.status(400).json({ok:false,error:'Use ?mode=preview or ?mode=download'});
  return sendAuthorizedStoredFile(req,res,mode);
});
app.get('/api/files/:id/status',async (req,res)=>{
  const {doc,resolved,denied}=resolveAuthorizedFile(req,res,req.params.id);
  if (denied) return;
  const descriptor=doc && resolved ? getStoredFilePreviewDescriptor(doc,resolved) : null;
  res.json({ok:true,found:!!doc,available:!!resolved,id:req.params.id,name:doc?.name || doc?.fileName || doc?.storedName || '',kind:descriptor?.kind || 'file',mimeType:descriptor?.mimeType || '',size:doc?.size || null,previewUrl:doc ? `/api/files/${doc.id || req.params.id}/preview` : '',previewDataUrl:doc ? `/api/files/${doc.id || req.params.id}/preview-data` : '',downloadUrl:doc ? `/api/files/${doc.id || req.params.id}/download` : ''});
});
app.get('/api/files/:id/preview-data',async (req,res)=>{
  const {doc,resolved,denied}=resolveAuthorizedFile(req,res,req.params.id);
  if (denied) return;
  if (!doc) return res.status(404).json({ok:false,error:'File record not found. Please refresh the page or re-upload the file.'});
  if (!resolved) return res.status(410).json({ok:false,error:'File unavailable on server. Please re-upload this file once.'});
  const descriptor=getStoredFilePreviewDescriptor(doc,resolved);
  if (!['pdf','image'].includes(descriptor.kind)) return res.status(415).json({ok:false,error:'Legacy inline preview data is available only for PDF and image files.'});
  const stat=await fs.promises.stat(descriptor.fp);
  if (stat.size > MAX_INLINE_PREVIEW_BYTES) return res.status(413).json({ok:false,code:'INLINE_PREVIEW_TOO_LARGE',error:`Inline preview data is limited to ${MAX_INLINE_PREVIEW_MB} MB. Use the streamed preview or download instead.`});
  const bytes=await fs.promises.readFile(descriptor.fp);
  res.setHeader('Cache-Control','private, no-store, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.json({ok:true,id:doc.id || req.params.id,name:descriptor.fileName,kind:descriptor.kind,mimeType:descriptor.mimeType,size:stat.size,dataUrl:`data:${descriptor.mimeType};base64,${bytes.toString('base64')}`});
});
app.get('/api/files/:id/preview',async (req,res)=>sendAuthorizedStoredFile(req,res,'preview'));
app.get('/api/files/:id/download',async (req,res)=>sendAuthorizedStoredFile(req,res,'download'));

app.delete('/api/files/:id',async (req,res)=>{
  try {
    const d=fileDeleteDb(req.params.id);
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
      const fields=['documents','completedFiles','sourceFiles','workFiles','files','uploads','attachments'];
      let changed=false;
      for (const field of fields) {
        const before=Array.isArray(c[field]) ? c[field] : [];
        const after=before.filter(doc=>!matches(doc));
        if (after.length!==before.length) { c[field]=after; changed=true; removed=true; }
      }
      if (c.file && matches(c.file)) { delete c.file; changed=true; removed=true; }
      if (changed) {
        if (c.id || c.caseId) changedCaseIds.push(String(c.id || c.caseId));
        c.history ||= [];
        c.history.unshift({ at: now(), by: actor.name, action: `File deleted: ${target.name || targetId}` });
        addCaseTimelineEvent(c,{type:'file_deleted',by:actor.name,title:'File deleted',remarks:target.name || targetId});
        c.updatedAt=Date.now();
        c.syncVersion=c.updatedAt;
        c.updatedBy=actor.name;
        c.taskVersion=nextTaskVersion(c);
        c.lastTaskMutationId=`file-delete:${targetId}`;
        c.lastTaskMutationAt=now();
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
      await save(d,{actor:actor.name,reason:'file_delete',takeSnapshotOwnership:true,collections,collectionRowIds});
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
    const updatedCases=(d.cases || []).filter(c=>changedCaseIds.includes(String(c.id || c.caseId)));
    const visibleCases=sanitizeCasesForRole(updatedCases,actor.role);
    res.json({ ok:true, removed, fileId:targetId, storageStatus:'DELETED', physicalAction, physicalError:physicalError || undefined, cases:visibleCases, projects:visibleCases, case:visibleCases[0] || null, project:visibleCases[0] || null });
  } catch(error) {
    sendApiFailure(res, req, error, 'File deletion failed.');
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


app.post('/api/system/files/garbage-collect', requireAdminSession, async (req,res)=>{
  try {
    if (String(req.body?.confirm || '')!=='COLLECT FILE STORAGE GARBAGE') {
      return res.status(400).json({ok:false,code:'CONFIRMATION_REQUIRED',error:'Type COLLECT FILE STORAGE GARBAGE to run recoverable file cleanup.'});
    }
    const actor=requestActor(req);
    const result=await collectFileStorageGarbage({actor:actor.name,graceMs:FILE_STORAGE_GC_GRACE_MS});
    const status=result.errors.length ? 207 : 200;
    res.status(status).json(result);
  } catch(error) {
    sendApiFailure(res, req, Object.assign(error,{ code:error.code || 'FILE_GC_FAILED' }), 'File garbage collection failed.');
  }
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
      if (!registry?.id || ['DELETED','EXPIRED'].includes(String(registry.storageStatus || '').toUpperCase())) continue;
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
    sendApiFailure(res, req, error, 'File reconciliation failed.');
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

app.get('/api/chat/history', requireCapability('state:read'), async (req,res)=>{
  const limit=Math.max(1,Math.min(250,Number(req.query.limit || 250) || 250));
  const beforeRaw=Number(req.query.before || 0);
  const before=Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : Number.POSITIVE_INFINITY;
  const rows=scopedTeamChat(readDb(),req)
    .filter(message=>toMs(message?.sentAt || message?.createdAt || message?.updatedAt || message?.id) < before)
    .sort((a,b)=>toMs(b?.sentAt || b?.createdAt || b?.updatedAt || b?.id)-toMs(a?.sentAt || a?.createdAt || a?.updatedAt || a?.id))
    .slice(0,limit);
  const nextBefore=rows.length ? toMs(rows[rows.length-1]?.sentAt || rows[rows.length-1]?.createdAt || rows[rows.length-1]?.updatedAt || rows[rows.length-1]?.id) : 0;
  res.json({ok:true,messages:rows,nextBefore,hasMore:rows.length === limit});
});

app.post('/api/chat', async (req,res)=>{
  try {
    const d=selectiveDb({ collections:['teamChat','notifications','audit'] });
    const actor=requestActor(req);
    const mutationId=textValue(req.body.mutationId || req.body.clientMutationId || '', 'Message mutation id', 200);
    if (mutationId) {
      const existingMessage=(d.teamChat || []).find(item =>
        String(item?.mutationId || '') === mutationId
        && String(item?.senderId || '').trim() === String(actor.id || '').trim()
      );
      if (existingMessage) return res.json({ok:true,idempotent:true,message:existingMessage});
    }
    const text=textValue(req.body.text || '', 'Message', MAX_CHAT_TEXT_LENGTH);
    const recipient=textValue(req.body.recipient || 'global','Recipient',200) || 'global';
    if (recipient !== 'global') {
      const recipientKey=String(recipient).trim().toLowerCase();
      const recipientExists=(Array.isArray(d.users) ? d.users : []).some(user=>[user?.id,user?.username,user?.name].map(value=>String(value || '').trim().toLowerCase()).includes(recipientKey));
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
      const chatFile=structuredClone(resolved);
      chatFile.chatScope=recipient === 'global' ? 'GLOBAL' : 'DIRECT';
      chatFile.chatParticipants=recipient === 'global'
        ? []
        : [...new Set([actor.id,actor.username,actor.name,recipient].map(value=>String(value || '').trim()).filter(Boolean))];
      files.push(chatFile);
    }
    const createdAt=now();
    const notificationIdsBefore=new Set((d.notifications || []).map(item=>String(item.id || '')));
    const msg={
      id:nanoid(10),
      mutationId:mutationId || nanoid(16),
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
    // Chat stores an immutable copy of attachment metadata. The underlying
    // private file registry is not changed by sending a message, so do not
    // enqueue an unrelated file-table write.
    if (notificationIds.length) { collections.push('notifications'); collectionRowIds.notifications=notificationIds; }
    await save(d,{actor:actor.name,reason:'chat_message_create',collections,collectionRowIds}); res.status(201).json({ok:true,message:msg});
  } catch (error) {
    sendApiFailure(res, req, error, 'Chat message could not be sent.');
  }
});

app.patch('/api/chat/:id', async (req,res)=>{
  try {
    const d=selectiveDb({ collections:['teamChat'], collectionRowIds:{ teamChat:[String(req.params.id)] } });
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
      message.readBy=appendReadByActor(message.readBy, actor, now());
    }
    message.updatedAt=now();
    await save(d,{actor:actor.name,reason:'chat_message_update',collections:['teamChat'],collectionRowIds:{teamChat:[String(message.id)]}}); res.json({ok:true,message});
  } catch(error) {
    sendApiFailure(res, req, error, 'Message update failed.');
  }
});

app.delete('/api/chat/:id', async (req,res)=>{
  const d=selectiveDb({ collections:['teamChat'], collectionRowIds:{ teamChat:[String(req.params.id)] } });
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
  const source=readDb();
  const actor=requestActor(req);
  const key=chatReadKey(req);
  const activeChannel=textValue(req.body.activeChannel || '__all__','Active channel',200);
  const readable=[];
  for (const message of source.teamChat || []) {
    if (!canAccessChatMessage(req.auth?.user || {},message)) continue;
    const sender=String(message.sender || message.by || '').trim().toLowerCase();
    const recipient=String(message.recipient || 'global').trim().toLowerCase();
    const mine=[actor.name,actor.username,actor.id].map(value=>String(value || '').trim().toLowerCase());
    const relevant=activeChannel==='__all__'
      || (activeChannel==='global' && recipient==='global')
      || (recipient && mine.includes(recipient))
      || (String(activeChannel).toLowerCase()===sender && mine.includes(recipient));
    if (relevant && message?.id) readable.push(String(message.id));
  }
  const changedNotificationIds=(source.notifications || [])
    .filter(notification=>notification.target==='chat' && notificationBelongsToUser(notification, req.auth?.user || {}) && !readByIncludesActor(notification.readBy, actor))
    .map(notification=>String(notification.id || '')).filter(Boolean);
  const d=selectiveDb({
    collections:['teamChat','chatReads','notifications'],
    collectionRowIds:{teamChat:readable,notifications:changedNotificationIds}
  });
  d.chatReads ||= {};
  const readAt=now();
  for (const message of d.teamChat || []) {
    if (!readable.includes(String(message?.id || ''))) continue;
    message.readBy=appendReadByActor(message.readBy, actor, readAt);
  }
  d.chatReads[key]=[...new Set([...(d.chatReads[key] || []),...readable])];
  for (const notification of d.notifications || []) {
    if (!changedNotificationIds.includes(String(notification?.id || ''))) continue;
    notification.status='READ'; notification.readAt=readAt; notification.readBy=appendReadByActor(notification.readBy, actor, readAt);
  }
  const collections=['chatReads'];
  const collectionRowIds={};
  if (readable.length) { collections.push('teamChat'); collectionRowIds.teamChat=readable; }
  if (changedNotificationIds.length) { collections.push('notifications'); collectionRowIds.notifications=changedNotificationIds; }
  await save(d,{actor:actor.name,reason:'chat_mark_read',collections,collectionRowIds});
  res.json({ok:true,readBy:actor.name,count:readable.length});
});

app.post('/api/notifications', async (req,res)=>{
  try {
    const d=selectiveDb({ collections:['notifications','audit'] });
    const actor=requestActor(req);
    const mutationId=textValue(req.body.mutationId || req.body.clientMutationId || '', 'Notification mutation id', 200);
    if (mutationId) {
      const existingNotification=(d.notifications || []).find(item =>
        String(item?.mutationId || '') === mutationId
        && String(item?.createdById || '').trim() === String(actor.id || '').trim()
      );
      if (existingNotification) return res.json({ok:true,idempotent:true,notification:existingNotification});
    }
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
    const notification={id:nanoid(8),mutationId:mutationId || nanoid(16),to,targetRole:targetRole || '',targetUser:targetUser || '',title,text:title,type,category,priority,target:textValue(req.body.target || '', 'Notification target', 200),caseId:textValue(req.body.caseId || req.body.projectId || '', 'Notification task', 200),status:'UNREAD',readBy:[],createdAt:now(),createdBy:actor.name,createdById:actor.id};
    d.notifications.unshift(notification);
    const auditEntry=addAudit(d, actor.name, 'Notification created', notification.id);
    await save(d,{actor:actor.name,reason:'notification_create',collections:['notifications','audit'],collectionRowIds:{notifications:[String(notification.id)],audit:[String(auditEntry.id)]}});
    res.status(201).json({ok:true,notification});
  } catch(error) {
    sendApiFailure(res, req, error, 'Notification could not be created.');
  }
});

app.post('/api/notifications/:id/read', async (req,res)=>{
  const d=selectiveDb({ collections:['notifications'], collectionRowIds:{ notifications:[String(req.params.id)] } });
  const notification=(d.notifications || []).find(item=>String(item.id)===String(req.params.id));
  if (!notification) return res.status(404).json({ok:false,code:'NOTIFICATION_NOT_FOUND',error:'Notification not found.'});
  if (!notificationBelongsToUser(notification, req.auth?.user || {})) return authorizationDenied(req,res,'NOTIFICATION_ACCESS_DENIED','You cannot update this notification.');
  const actor=requestActor(req);
  const readAt=now();
  notification.status='READ'; notification.readAt=readAt; notification.readBy=appendReadByActor(notification.readBy, actor, readAt);
  await save(d,{actor:actor.name,reason:'notification_mark_read',collections:['notifications'],collectionRowIds:{notifications:[String(notification.id)]}}); res.json({ok:true});
});

app.post('/api/notifications/read-all', async (req,res)=>{
  const actor=requestActor(req);
  const changedIds=(readDb().notifications || [])
    .filter(notification=>notificationBelongsToUser(notification, req.auth?.user || {}) && !readByIncludesActor(notification.readBy, actor))
    .map(notification=>String(notification.id || '')).filter(Boolean);
  if (!changedIds.length) return res.json({ok:true,count:0,persistence:{mode:'no-op',persisted:false}});
  const d=selectiveDb({ collections:['notifications'], collectionRowIds:{notifications:changedIds} });
  const readAt=now();
  for (const notification of d.notifications || []) {
    if (!changedIds.includes(String(notification?.id || ''))) continue;
    notification.status='READ'; notification.readAt=readAt; notification.readBy=appendReadByActor(notification.readBy, actor, readAt);
  }
  const persistence=await save(d,{actor:actor.name,reason:'notifications_mark_all_read',collections:['notifications'],collectionRowIds:{notifications:changedIds}});
  res.json({ok:true,count:changedIds.length,persistence});
});

app.post('/whatsapp/mock/incoming', authenticationGate, apiWriteRateLimiter, requireAdminSession, uploadAny, requireFreshAuthenticatedRequestAfterBody, requireAdminSession, async (req,res)=>{
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
    const sourceMessageId=textValue(req.body.messageId || req.body.sourceMessageId || req.body.webhookId || req.body.eventId || '', 'WhatsApp source message id', 200);
    if (sourceMessageId) {
      const committed=readDb();
      const priorInbox=(committed.whatsappInbox || []).find(item=>String(item?.sourceMessageId || '')===sourceMessageId);
      if (priorInbox) {
        cleanupRequestTempUploads(req);
        const priorCase=findCaseByAnyId(committed.cases || [],priorInbox.caseInternalId || priorInbox.caseId);
        return res.status(200).json({...(priorCase || {}),ok:true,idempotent:true,sourceMessageId});
      }
    }
    const d=selectiveDb({ collections:['cases','files','whatsappInbox','notifications'] });
    const parsed=parseLead(textValue(req.body.text || '','WhatsApp text',MAX_CASE_TEXT_LENGTH,{required:true}));
    const assignee=leastBusy(d);
    const fromName=textValue(req.body.fromName || req.body.from || 'WhatsApp Banker','Sender name',200);
    const caseInternalId=nanoid(8);
    rollbackCaseId=caseInternalId;
    preparedUploads=await prepareSecureUploads(req,'SOURCE');
    const c={id:caseInternalId,caseId:nextCaseNo(d,parsed.city),source:'WhatsApp',sourceMessageId,createdByRole:'BANKER',creatorName:fromName,createdBy:fromName,customerName:parsed.customerName,customerPhone:'',bankerName:fromName,bank:textValue(req.body.bank || '','Bank',200),branch:textValue(req.body.branch || '','Branch',200),serviceType:parsed.serviceType,city:parsed.city,propertyAddress:parsed.propertyAddress,estimateAmount:Number(parsed.estimateAmount || 0),priority:'Normal',status:'ASSIGNED',assigneeId:assignee?.id,assigneeName:assignee?.name,assigneeRole:assignee?.role,assignedTo:assignee?.name || 'Unassigned',createdAt:now(),completedAt:null,paymentStatus:'PENDING',documents:(req.files || []).map(file=>addFileRegistryEntry(d,docPayload(file,'WhatsApp','BANKER','SOURCE',caseInternalId))),comments:[],revisions:[],history:[{at:now(),by:'WhatsApp',action:'Lead created from WhatsApp'}]};
    d.cases.unshift(c); d.whatsappInbox.unshift({id:nanoid(8),sourceMessageId,caseInternalId:c.id,from:textValue(req.body.from || '','Sender',100),fromName,text:req.body.text,createdAt:now(),caseId:c.caseId});
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
    sendApiFailure(res, req, error, 'WhatsApp lead could not be created.');
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

app.get('/api/db/health', requireAdminSession, async (req,res)=>{
  try {
    if (USE_POSTGRES) {
      await ensurePostgres();
      const health = await getRelationalHealth(pool);
      return res.status(health.integrity?.ok === false ? 503 : 200).json({ ok:health.integrity?.ok !== false, ...health });
    }
    const d = readDb();
    return res.json({ok:true,database:'json-file',connected:true,file:DB_FILE,localSandbox:true,warning:'Local JSON sandbox is enabled. Production requires PostgreSQL.',stateVersion,counts:{users:(d.users||[]).length,cases:(d.cases||[]).length,chatMessages:(d.teamChat||[]).length,notifications:(d.notifications||[]).length,attendanceLogs:(d.attendanceLogs||[]).length,payments:(d.payments||[]).filter(Boolean).length}});
  } catch (err) {
    return sendApiFailure(res, req, err, 'Database health check failed.', { database:USE_POSTGRES?'postgresql-relational':'json-file' });
  }
});

app.get('/api/db/migrations', requireAdminSession, async (req,res)=>{
  if (!USE_POSTGRES) return res.json({ok:true,database:'json-file',migrations:[],warning:'Schema migrations run only with PostgreSQL.'});
  try {
    await ensurePostgres();
    const result = await pool.query('SELECT version,name,checksum,execution_ms,applied_at FROM schema_migrations ORDER BY version');
    res.json({ok:true,database:'postgresql-relational',migrations:result.rows});
  } catch (error) {
    sendApiFailure(res, req, error, 'Database integrity operation failed.');
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
    sendApiFailure(res, req, error, 'Database integrity operation failed.');
  }
});

app.post('/api/db/revisions/:id/restore', requireAdminSession, async (req,res)=>{
  if (!USE_POSTGRES) return res.status(409).json({ok:false,code:'POSTGRES_REQUIRED',error:'Revision restore requires PostgreSQL.'});
  try {
    const revisionId = Number(req.params.id);
    const confirmation = String(req.body?.confirmation || '').trim();
    if (!Number.isInteger(revisionId) || revisionId <= 0) return res.status(400).json({ok:false,code:'REVISION_ID_INVALID',error:'A valid revision id is required.'});
    if (confirmation !== `RESTORE ${revisionId}`) return res.status(400).json({ok:false,code:'RESTORE_CONFIRMATION_REQUIRED',error:`Type RESTORE ${revisionId} to confirm this recovery operation.`});
    const expectedCurrentVersion=Number(req.body?.expectedCurrentVersion);
    if (!Number.isInteger(expectedCurrentVersion) || expectedCurrentVersion !== Number(stateVersion)) {
      return res.status(409).json({ok:false,code:'RESTORE_VERSION_MISMATCH',error:'The live database changed after this restore was prepared. Refresh revision history and confirm again.',expectedCurrentVersion:stateVersion});
    }
    if (activeForegroundWriteRequests > 1 || persistenceQueueDepth > 0 || persistenceInFlight > 0) {
      return res.status(409).json({ok:false,code:'RESTORE_WRITE_ACTIVITY',error:'A foreground write is still active. Wait for it to finish before restoring a revision.'});
    }
    await persistenceQueue.catch(() => {});
    if (Number(stateVersion) !== expectedCurrentVersion) {
      return res.status(409).json({ok:false,code:'RESTORE_VERSION_MISMATCH',error:'The live database changed while waiting for queued writes. Refresh revision history and confirm again.',expectedCurrentVersion:stateVersion});
    }
    const actor = requestActor(req);
    let result;
    try {
      result = await restoreRelationalRevision(pool, { revisionId, actor:actor.name, applyAuthOperationsWithClient, financeSnapshotHash });
    } catch (restoreError) {
      if (restoreError?.commitOutcomeUnknown === true) {
        const recovered = await reloadCommittedState();
        if (persistenceCommitEvidenceMatches(restoreError, recovered)) {
          result = {
            stateVersion:recovered.stateVersion,
            snapshotHash:recovered.snapshotHash,
            counts:recovered.counts,
            database:'postgresql-relational',
            commitConfirmedAfterReconnect:true
          };
        } else throw restoreError;
      } else throw restoreError;
    }
    await reloadCommittedState();
    res.json({ok:true,restoredRevisionId:revisionId,...result});
  } catch (error) {
    sendApiFailure(res, req, error, 'The operation could not be completed.');
  }
});


app.use((err, req, res, _next) => {
  if (res.headersSent) return;
  sendApiFailure(res, req, err, 'Unexpected server error.');
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
    if (startupRecoveryTimer) { clearInterval(startupRecoveryTimer); startupRecoveryTimer=null; }
    if (otpCleanupTimer) { clearInterval(otpCleanupTimer); otpCleanupTimer=null; }
    if (authCleanupTimer) { clearInterval(authCleanupTimer); authCleanupTimer=null; }
    if (storageRetentionInitialTimer) { clearTimeout(storageRetentionInitialTimer); storageRetentionInitialTimer=null; }
    if (storageRetentionTimer) { clearInterval(storageRetentionTimer); storageRetentionTimer=null; }
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
    await operationalJobs.resolveFailures('STATE_PERSISTENCE', {
      recoveredAt:now(),
      stateVersion,
      reason:'startup_integrity_verified'
    }).catch(() => {});
    startupFailure=null;
  } catch (error) {
    startupFailure={
      code:error?.code || 'STARTUP_VALIDATION_FAILED',
      message:error?.message || String(error),
      at:new Date().toISOString(),
      retryable:isRetryableStartupFailure(error),
      phase:'startup'
    };
    // Keep one stable maintenance process listening instead of letting PM2
    // restart hundreds of times. Health endpoints remain available and every
    // operational route returns a clear 503 without accepting writes.
    structuredLog('error','server_startup_maintenance',startupFailurePayload());
  }

  try {
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
    httpServer.maxRequestsPerSocket = boundedEnvNumber('HTTP_MAX_REQUESTS_PER_SOCKET',1000,100,10000);
    httpServer.ref();
    otpCleanupTimer=setInterval(()=>pruneOtpChallenges(),5 * 60 * 1000);
    otpCleanupTimer.unref?.();
    authCleanupTimer=setInterval(()=>cleanupExpiredAuthSessions().catch(error=>structuredLog('warn','auth_session_cleanup_failed',{code:error?.code || '',error:error?.message || String(error)})),15 * 60 * 1000);
    authCleanupTimer.unref?.();
    cleanupExpiredAuthSessions().catch(error=>structuredLog('warn','auth_session_cleanup_failed',{code:error?.code || '',error:error?.message || String(error)}));
    scheduleAutomaticFileRetention();
    scheduleStartupRecovery();
    structuredLog('info',startupFailure ? 'server_started_maintenance' : 'server_started',{
      host:HOST,
      port:Number(PORT),
      storage:USE_POSTGRES ? 'postgresql-relational' : 'json-sandbox',
      startedAt:serverStartedAt,
      requestTimeoutMs,
      headersTimeoutMs,
      startupFailure:startupFailurePayload()
    });
  } catch (error) {
    structuredLog('fatal','http_listener_start_failed',{error:error?.message || String(error),code:error?.code || ''});
    if (pool) await pool.end().catch(() => {});
    process.exit(1);
  }
}

process.once('SIGTERM',()=>gracefulShutdown('SIGTERM',0));
process.once('SIGINT',()=>gracefulShutdown('SIGINT',0));
process.on('unhandledRejection',reason=>{
  const error=reason instanceof Error ? reason : new Error(String(reason));
  const stamp=Date.now();
  unhandledRejectionTimes=unhandledRejectionTimes.filter(value=>stamp-value < 60_000);
  unhandledRejectionTimes.push(stamp);
  structuredLog('error','unhandled_rejection',{error:error.message,stack:error.stack || '',recentCount:unhandledRejectionTimes.length});
  operationalJobs.recordFailure('UNHANDLED_REJECTION',error,{}, {maxAttempts:1}).catch(()=>{});
  if (unhandledRejectionTimes.length >= 3) gracefulShutdown('REPEATED_UNHANDLED_REJECTION',1);
});
process.on('uncaughtException',error=>{
  structuredLog('fatal','uncaught_exception',{error:error.message,stack:error.stack || ''});
  gracefulShutdown('UNCAUGHT_EXCEPTION',1);
});

startServer();
