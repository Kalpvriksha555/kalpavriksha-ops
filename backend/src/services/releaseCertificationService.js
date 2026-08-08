import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildFinanceSnapshot, financeCompletenessScore, financeFreshness, financeSnapshotHash } from './financeIntegrityService.js';

export const RELEASE_CERTIFICATE_SCHEMA_VERSION = 1;
export const FINANCE_RECOVERY_PLAN_SCHEMA_VERSION = 1;

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
};

export const stableJson = (value) => JSON.stringify(stableValue(value));
export const sha256Text = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
export const sha256Object = (value) => sha256Text(stableJson(value));

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
};

const safeUrlSummary = (value = '') => {
  try {
    const parsed = new URL(String(value));
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`;
  } catch {
    return '';
  }
};

export function databaseFingerprint(databaseUrl = '') {
  const summary = safeUrlSummary(databaseUrl);
  return summary ? sha256Text(summary) : '';
}

function check(id, ok, message, severity = 'error', details = {}) {
  return { id, ok: !!ok, severity, message, details };
}

export function validateProductionEnvironment(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  const corsOrigins = String(env.CORS_ORIGIN || '').split(',').map((item) => item.trim()).filter(Boolean);
  const storageRoot = String(env.KALPA_FILE_STORAGE_ROOT || '').trim();
  const backupRoot = String(env.KALPA_BACKUP_ROOT || '').trim();
  const certificatePath = String(env.RELEASE_CERTIFICATE_PATH || '').trim();
  const checks = [
    check('node_env', nodeEnv === 'production', 'NODE_ENV must be production.'),
    check('postgresql', /^postgres(ql)?:\/\//i.test(databaseUrl), 'DATABASE_URL must be a PostgreSQL connection string.'),
    check('json_fallback', !toBoolean(env.ALLOW_JSON_FALLBACK, false), 'ALLOW_JSON_FALLBACK must be disabled in production.'),
    check('cors_explicit', corsOrigins.length > 0 && !corsOrigins.includes('*'), 'CORS_ORIGIN must list explicit trusted origins.'),
    check('cors_https', corsOrigins.length > 0 && corsOrigins.every((origin) => /^https:\/\//i.test(origin)), 'Every production CORS origin must use HTTPS.'),
    check('private_storage_root', !!storageRoot && path.isAbsolute(storageRoot), 'KALPA_FILE_STORAGE_ROOT must be an absolute persistent path.'),
    check('private_storage_persistent', toBoolean(env.FILE_STORAGE_PERSISTENT, false), 'FILE_STORAGE_PERSISTENT must be true.'),
    check('backup_root', !!backupRoot && path.isAbsolute(backupRoot), 'KALPA_BACKUP_ROOT must be an absolute persistent path.'),
    check('backup_required', toBoolean(env.BACKUP_REQUIRED, true), 'BACKUP_REQUIRED must be true.'),
    check('backup_persistent', toBoolean(env.BACKUP_STORAGE_PERSISTENT, false), 'BACKUP_STORAGE_PERSISTENT must be true.'),
    check('bootstrap_disabled', !String(env.BOOTSTRAP_ADMIN_PASSWORD || '').trim(), 'BOOTSTRAP_ADMIN_PASSWORD must be removed after the initial account is established.'),
    check('local_otp_disabled', !toBoolean(env.ALLOW_LOCAL_EMAIL_OTP, false), 'ALLOW_LOCAL_EMAIL_OTP must be false in production.'),
    check('certificate_path', !!certificatePath && path.isAbsolute(certificatePath), 'RELEASE_CERTIFICATE_PATH must be an absolute path.'),
    check('cookie_name', String(env.SESSION_COOKIE_NAME || 'kv_session').trim().length >= 4, 'SESSION_COOKIE_NAME must be configured.'),
    check('session_ttl', Number(env.SESSION_TTL_HOURS || 12) >= 1 && Number(env.SESSION_TTL_HOURS || 12) <= 24, 'Production session lifetime must be between 1 and 24 hours.'),
    check('upload_limit', Number(env.MAX_UPLOAD_SIZE_MB || 100) > 0 && Number(env.MAX_UPLOAD_SIZE_MB || 100) <= 100, 'MAX_UPLOAD_SIZE_MB must not exceed 100 MB.')
  ];
  return {
    ok: checks.every((item) => item.ok || item.severity !== 'error'),
    checkedAt: new Date().toISOString(),
    databaseFingerprint: databaseFingerprint(databaseUrl),
    checks,
    errors: checks.filter((item) => !item.ok && item.severity === 'error'),
    warnings: checks.filter((item) => !item.ok && item.severity === 'warning')
  };
}

const ignoredTreeNames = new Set([
  '.git', 'node_modules', 'dist', 'release', '.release', 'coverage', 'test-results', 'playwright-report',
  'src/data', 'src/uploads', 'uploads', 'logs'
]);

function shouldIgnoreTree(relativePath, entryName) {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
  if (entryName === 'release-certification.json') return true;
  if (ignoredTreeNames.has(entryName)) return true;
  if (ignoredTreeNames.has(normalized)) return true;
  if (/(^|\/)node_modules(\/|$)/.test(normalized)) return true;
  // Deployment swaps frontend builds through dist.next/dist.previous. Those are
  // generated runtime build artifacts, never release source. Including them in
  // sourceTreeHash makes an otherwise byte-identical certified source fail the
  // permanent release gate immediately after the atomic frontend switch.
  if (/(^|\/)dist(?:\.(?:next|previous))?(\/|$)/.test(normalized)) return true;
  if (/(^|\/)src\/(?:data|uploads)(\/|$)/.test(normalized)) return true;
  if (/^(?:backend\/)?data(?:\/|$)/.test(normalized)) return true;
  if (/^(?:private-files|backups)(?:\/|$)/.test(normalized)) return true;
  if (/\.log$/i.test(entryName) || /^\.env(?:\.|$)/.test(entryName)) return true;
  return false;
}

export function sourceTreeHash(rootPath) {
  const root = path.resolve(rootPath);
  const files = [];
  const walk = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (shouldIgnoreTree(childRelative, entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute, childRelative);
      else if (entry.isFile()) files.push(childRelative);
    }
  };
  walk(root);
  const hash = crypto.createHash('sha256');
  for (const relative of files) {
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, relative)));
    hash.update('\0');
  }
  return { hash: hash.digest('hex'), fileCount: files.length, files };
}

export function createReleaseCertificate({
  appVersion,
  backendVersion,
  sourceHash,
  sourceFileCount,
  gitCommit = '',
  checks = [],
  cleanInstall = null,
  backup = null,
  database = null,
  environment = null,
  createdBy = 'release-certify',
  maxAgeHours = 24
} = {}) {
  const normalizedChecks = (Array.isArray(checks) ? checks : []).map((item) => ({
    id: String(item.id || item.name || ''),
    status: String(item.status || (item.ok ? 'PASS' : 'FAIL')).toUpperCase(),
    durationMs: Math.max(0, Number(item.durationMs || 0)),
    details: item.details || {}
  }));
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(maxAgeHours || 24)) * 3_600_000).toISOString();
  const payload = {
    schemaVersion: RELEASE_CERTIFICATE_SCHEMA_VERSION,
    id: `release-${createdAt.replace(/[-:.]/g, '')}-${crypto.randomBytes(4).toString('hex')}`,
    status: normalizedChecks.length > 0 && normalizedChecks.every((item) => item.status === 'PASS') && cleanInstall?.status === 'PASS' ? 'CERTIFIED' : 'FAILED',
    appVersion: String(appVersion || ''),
    backendVersion: String(backendVersion || ''),
    gitCommit: String(gitCommit || ''),
    sourceHash: String(sourceHash || ''),
    sourceFileCount: Number(sourceFileCount || 0),
    createdAt,
    expiresAt,
    createdBy: String(createdBy || 'release-certify'),
    checks: normalizedChecks,
    cleanInstall: cleanInstall || { status: 'MISSING' },
    backup: backup || null,
    database: database || null,
    environment: environment || null
  };
  return { ...payload, certificateHash: sha256Object(payload) };
}

export function verifyReleaseCertificate(certificate, {
  expectedAppVersion = '',
  expectedBackendVersion = '',
  expectedSourceHash = '',
  maxAgeHours = 24,
  requireCleanInstall = true,
  requireBackup = false,
  now = Date.now()
} = {}) {
  const failures = [];
  if (!certificate || typeof certificate !== 'object') failures.push('Certificate is missing or invalid.');
  const copy = certificate && typeof certificate === 'object' ? { ...certificate } : {};
  const suppliedHash = String(copy.certificateHash || '');
  delete copy.certificateHash;
  const computedHash = sha256Object(copy);
  if (!suppliedHash || suppliedHash !== computedHash) failures.push('Certificate hash does not match its contents.');
  if (Number(copy.schemaVersion) !== RELEASE_CERTIFICATE_SCHEMA_VERSION) failures.push('Certificate schema version is unsupported.');
  if (copy.status !== 'CERTIFIED') failures.push('Release status is not CERTIFIED.');
  if (expectedAppVersion && copy.appVersion !== expectedAppVersion) failures.push('Certificate application version does not match the deployed version.');
  if (expectedBackendVersion && copy.backendVersion !== expectedBackendVersion) failures.push('Certificate backend version does not match the deployed version.');
  if (expectedSourceHash && copy.sourceHash !== expectedSourceHash) failures.push('Certificate source hash does not match the deployed source.');
  const createdMs = new Date(copy.createdAt || 0).getTime();
  const expiresMs = new Date(copy.expiresAt || 0).getTime();
  const ageHours = createdMs > 0 ? (Number(now) - createdMs) / 3_600_000 : Infinity;
  if (!Number.isFinite(createdMs) || createdMs <= 0) failures.push('Certificate creation time is invalid.');
  if (!Number.isFinite(expiresMs) || expiresMs <= Number(now)) failures.push('Certificate is expired.');
  if (ageHours > Math.max(1, Number(maxAgeHours || 24))) failures.push('Certificate is older than the allowed release window.');
  if (!Array.isArray(copy.checks) || !copy.checks.length || copy.checks.some((item) => item.status !== 'PASS')) failures.push('One or more certification checks did not pass.');
  if (requireCleanInstall && copy.cleanInstall?.status !== 'PASS') failures.push('A verified clean installation is required.');
  if (requireBackup && !(copy.backup?.status === 'VERIFIED' && copy.backup?.ok !== false)) failures.push('A verified backup is required.');
  return {
    ok: failures.length === 0,
    status: failures.length ? 'INVALID' : 'VALID',
    failures,
    computedHash,
    certificateHash: suppliedHash,
    ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
    certificate: copy
  };
}

export function readAndVerifyReleaseCertificate(filePath, options = {}) {
  try {
    const certificate = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
    return { path: path.resolve(filePath), ...verifyReleaseCertificate(certificate, options) };
  } catch (error) {
    return { ok: false, status: 'MISSING_OR_INVALID', path: path.resolve(filePath), failures: [error.message || String(error)] };
  }
}

export function extractCasesFromRecoverySource(raw = {}) {
  const safeRaw = raw && typeof raw === 'object' ? raw : {};
  const root = safeRaw.state && typeof safeRaw.state === 'object' ? safeRaw.state : safeRaw;
  const candidates = [root.cases, root.projects, root.projectsBackup, safeRaw.projectsBackup, safeRaw.projects];
  return candidates.find((items) => Array.isArray(items) && items.length) || [];
}

const caseKey = (record = {}) => String(record?.id || record?.caseId || record?.caseNo || '').trim();

export function buildFinanceRecoveryPlan({
  sourceCases = [],
  targetCases = [],
  sourceLabel = 'recovery-source',
  targetLabel = 'live-database',
  targetStateVersion = 0,
  targetDatabaseFingerprint = '',
  createdBy = 'finance-recovery-plan'
} = {}) {
  const sourceById = new Map((sourceCases || []).filter(Boolean).map((item) => [caseKey(item), item]).filter(([key]) => key));
  const targetById = new Map((targetCases || []).filter(Boolean).map((item) => [caseKey(item), item]).filter(([key]) => key));
  const actions = [];
  for (const [id, source] of sourceById) {
    const sourceSnapshot = buildFinanceSnapshot(source);
    if (!Object.keys(sourceSnapshot).length) continue;
    const sourceHash = financeSnapshotHash(sourceSnapshot);
    const sourceFresh = financeFreshness(source);
    const sourceCompleteness = financeCompletenessScore(source);
    const target = targetById.get(id);
    if (!target) {
      actions.push({ caseId: id, action: 'SKIP_MISSING_TARGET', reason: 'The live task does not exist.', sourceFreshness: sourceFresh, sourceHash });
      continue;
    }
    const targetSnapshot = buildFinanceSnapshot(target);
    const targetHash = financeSnapshotHash(targetSnapshot);
    const targetFresh = financeFreshness(target);
    const targetCompleteness = financeCompletenessScore(target);
    if (sourceHash === targetHash) {
      actions.push({ caseId: id, action: 'NO_CHANGE', reason: 'Finance snapshots are identical.', sourceFreshness: sourceFresh, targetFreshness: targetFresh, sourceHash, targetHash });
      continue;
    }
    let action = 'REVIEW';
    let reason = 'Finance snapshots differ but freshness is inconclusive.';
    if (sourceFresh > targetFresh) {
      action = 'RECOVER';
      reason = 'The recovery source contains a newer finance snapshot.';
    } else if (sourceFresh === targetFresh && sourceCompleteness > targetCompleteness) {
      action = 'REVIEW';
      reason = 'The source is more complete but has the same finance timestamp; manual review is required.';
    } else {
      action = 'SKIP_NOT_NEWER';
      reason = 'The recovery source is not newer than the live finance snapshot.';
    }
    actions.push({
      caseId: id,
      caseNo: String(target.caseId || target.caseNo || source.caseId || source.caseNo || id),
      action,
      reason,
      sourceFreshness: sourceFresh,
      targetFreshness: targetFresh,
      sourceCompleteness,
      targetCompleteness,
      sourceHash,
      targetHash,
      expectedTargetFinanceVersion: Number(target.financeVersion || 0),
      sourceSnapshot: action === 'RECOVER' || action === 'REVIEW' ? sourceSnapshot : undefined
    });
  }
  const createdAt = new Date().toISOString();
  const base = {
    schemaVersion: FINANCE_RECOVERY_PLAN_SCHEMA_VERSION,
    id: `finance-recovery-${createdAt.replace(/[-:.]/g, '')}-${crypto.randomBytes(4).toString('hex')}`,
    status: 'DRY_RUN',
    createdAt,
    createdBy,
    sourceLabel,
    targetLabel,
    targetStateVersion: Number(targetStateVersion || 0),
    targetDatabaseFingerprint: String(targetDatabaseFingerprint || ''),
    actions,
    summary: {
      sourceCases: sourceById.size,
      targetCases: targetById.size,
      recover: actions.filter((item) => item.action === 'RECOVER').length,
      review: actions.filter((item) => item.action === 'REVIEW').length,
      noChange: actions.filter((item) => item.action === 'NO_CHANGE').length,
      skipped: actions.filter((item) => item.action.startsWith('SKIP_')).length
    }
  };
  return { ...base, planHash: sha256Object(base) };
}

export function verifyFinanceRecoveryPlan(plan, {
  targetStateVersion,
  targetDatabaseFingerprint = ''
} = {}) {
  const failures = [];
  const copy = plan && typeof plan === 'object' ? { ...plan } : {};
  const suppliedHash = String(copy.planHash || '');
  delete copy.planHash;
  if (Number(copy.schemaVersion) !== FINANCE_RECOVERY_PLAN_SCHEMA_VERSION) failures.push('Recovery plan schema version is unsupported.');
  if (!suppliedHash || suppliedHash !== sha256Object(copy)) failures.push('Recovery plan hash does not match its contents.');
  if (copy.status !== 'DRY_RUN') failures.push('Recovery plan is not a dry-run plan.');
  if (targetStateVersion !== undefined && Number(copy.targetStateVersion) !== Number(targetStateVersion)) failures.push('Live state version changed after the plan was generated.');
  if (targetDatabaseFingerprint && copy.targetDatabaseFingerprint !== targetDatabaseFingerprint) failures.push('Recovery plan targets a different database.');
  if (!Array.isArray(copy.actions)) failures.push('Recovery actions are missing.');
  return { ok: failures.length === 0, failures, planHash: suppliedHash, plan: copy };
}

export function applyFinanceRecoveryPlanToCases(targetCases = [], plan, {
  confirmation = '',
  actor = 'system',
  now = Date.now()
} = {}) {
  const expectedConfirmation = `APPLY FINANCE RECOVERY ${plan?.id || ''}`;
  if (String(confirmation || '').trim() !== expectedConfirmation) {
    const error = new Error(`Confirmation must exactly match: ${expectedConfirmation}`);
    error.code = 'FINANCE_RECOVERY_CONFIRMATION_REQUIRED';
    throw error;
  }
  const recoverActions = (plan.actions || []).filter((item) => item.action === 'RECOVER');
  const actionById = new Map(recoverActions.map((item) => [String(item.caseId), item]));
  const financeEvents = [];
  const updatedCases = (targetCases || []).map((record) => {
    const id = caseKey(record);
    const action = actionById.get(id);
    if (!action) return record;
    const previousSnapshot = buildFinanceSnapshot(record);
    if (financeSnapshotHash(previousSnapshot) !== action.targetHash) {
      const error = new Error(`Finance changed for ${id} after the recovery plan was created.`);
      error.code = 'FINANCE_RECOVERY_TARGET_CHANGED';
      throw error;
    }
    if (financeSnapshotHash(action.sourceSnapshot || {}) !== action.sourceHash) {
      const error = new Error(`Recovery source snapshot hash is invalid for ${id}.`);
      error.code = 'FINANCE_RECOVERY_SOURCE_INVALID';
      throw error;
    }
    const next = { ...record };
    for (const key of Object.keys(previousSnapshot)) delete next[key];
    Object.assign(next, structuredClone(action.sourceSnapshot || {}));
    next.financeVersion = Math.max(Number(next.financeVersion || 0), Number(now), Number(record.financeVersion || 0) + 1);
    const audit = Array.isArray(next.paymentAuditTrail) ? [...next.paymentAuditTrail] : [];
    audit.push({
      id: `recovery-${plan.id}-${id}`,
      action: 'Finance selectively recovered',
      by: actor,
      at: new Date(Number(now)).toISOString(),
      recoveryPlanId: plan.id,
      sourceLabel: plan.sourceLabel,
      sourceSnapshotHash: action.sourceHash
    });
    next.paymentAuditTrail = audit;
    const nextSnapshot = buildFinanceSnapshot(next);
    financeEvents.push({
      caseId: id,
      caseNo: action.caseNo || id,
      action: 'Finance selectively recovered',
      actor,
      previousSnapshot,
      nextSnapshot
    });
    return next;
  });
  return { updatedCases, financeEvents, recoveredCount: financeEvents.length };
}
