const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_FILE_RETENTION_DAYS = 90;
export const DEFAULT_TRASH_RETENTION_DAYS = 1;

function timestampMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  const normalizeEpoch = (numeric) => {
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    // Legacy/browser payloads occasionally persisted Unix seconds while the
    // current application stores milliseconds/ISO timestamps. Treat plausible
    // epoch-second values as seconds instead of accidentally expiring them as
    // dates in 1970 under the 90-day retention job.
    if (numeric >= 1_000_000_000 && numeric < 100_000_000_000) return numeric * 1000;
    return numeric;
  };
  if (typeof value === 'number') return normalizeEpoch(value);
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return normalizeEpoch(numeric);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function filePurpose(doc = {}) {
  return String(doc?.purpose || doc?.type || doc?.folder || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
}

export function financialFileReferenceSets(state = {}) {
  const ids = new Set();
  const storageKeys = new Set();
  const visit = (value, depth = 0) => {
    if (!value || depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = String(key).toLowerCase();
      if (['id','fileid','receiptfileid'].includes(normalizedKey) && typeof item === 'string' && item.trim()) ids.add(item.trim());
      if (['storagekey','storedname','stored_name'].includes(normalizedKey) && typeof item === 'string' && item.trim()) storageKeys.add(item.trim());
      if (item && typeof item === 'object') visit(item, depth + 1);
    }
  };

  // Payment rows and per-case ledger objects are financial records and are
  // permanently exempt from ordinary 90-day attachment retention.
  visit(Array.isArray(state.payments) ? state.payments : []);
  for (const record of (Array.isArray(state.cases) ? state.cases : [])) {
    visit(record?.ledger || null);
    visit(record?.finance || null);
    visit(record?.paymentLedger || null);
  }
  return { ids, storageKeys };
}

export function isFinancialRetentionProtected(doc = {}, references = { ids:new Set(), storageKeys:new Set() }) {
  const purpose = filePurpose(doc);
  if (purpose === 'PAYMENT_RECEIPT' || purpose === 'FINANCE' || purpose === 'FINANCIAL' || purpose === 'BANK_LEDGER' || purpose === 'LEDGER') return true;
  const id = String(doc?.id || doc?.fileId || '').trim();
  const storageKey = String(doc?.storageKey || doc?.storedName || doc?.stored_name || '').trim();
  return Boolean((id && references.ids?.has(id)) || (storageKey && references.storageKeys?.has(storageKey)));
}

export function isPermanentFileProtected(doc = {}, references) {
  const purpose = filePurpose(doc);
  if (purpose === 'PROFILE' || purpose === 'PROFILE_PHOTO' || purpose === 'AVATAR') return true;
  return isFinancialRetentionProtected(doc, references);
}

export function fileAgeAnchorMs(doc = {}) {
  return timestampMs(doc?.uploadedAt || doc?.storedAt || doc?.createdAt || doc?.timestamp || 0);
}

export function shouldExpireFile(doc = {}, { nowMs = Date.now(), retentionDays = DEFAULT_FILE_RETENTION_DAYS, references } = {}) {
  if (!doc || typeof doc !== 'object') return false;
  const status = String(doc.storageStatus || '').trim().toUpperCase();
  if (status === 'DELETED' || status === 'EXPIRED') return false;
  if (isPermanentFileProtected(doc, references)) return false;
  const anchor = fileAgeAnchorMs(doc);
  if (!anchor) return false; // fail closed: unknown-age files are retained
  const retentionMs = Math.max(1, Number(retentionDays || DEFAULT_FILE_RETENTION_DAYS)) * DAY_MS;
  return nowMs - anchor >= retentionMs;
}

export function expirationPatch({ nowMs = Date.now(), retentionDays = DEFAULT_FILE_RETENTION_DAYS, actor = 'storage-retention' } = {}) {
  const expiredAt = new Date(nowMs).toISOString();
  return {
    storageStatus:'EXPIRED',
    expiredAt,
    expiredBy:actor,
    retentionDays:Number(retentionDays || DEFAULT_FILE_RETENTION_DAYS),
    expiryReason:`Automatic ${Number(retentionDays || DEFAULT_FILE_RETENTION_DAYS)}-day storage retention`,
    url:'',
    previewUrl:'',
    downloadUrl:''
  };
}

function patchMatchingDocs(list, ids, patch) {
  if (!Array.isArray(list)) return false;
  let changed = false;
  for (const doc of list) {
    if (!doc || !ids.has(String(doc.id || doc.fileId || ''))) continue;
    Object.assign(doc, patch);
    changed = true;
  }
  return changed;
}

export function applyFileRetentionToState(state = {}, { nowMs = Date.now(), retentionDays = DEFAULT_FILE_RETENTION_DAYS, actor = 'storage-retention' } = {}) {
  const references = financialFileReferenceSets(state);
  const expiredIds = new Set();
  const expiredStorageKeys = new Set();
  const protectedIds = [];
  const unknownAgeIds = [];
  const patch = expirationPatch({ nowMs, retentionDays, actor });

  for (const doc of (Array.isArray(state.files) ? state.files : [])) {
    if (!doc || !doc.id) continue;
    if (isPermanentFileProtected(doc, references)) {
      protectedIds.push(String(doc.id));
      continue;
    }
    const anchor = fileAgeAnchorMs(doc);
    if (!anchor) {
      unknownAgeIds.push(String(doc.id));
      continue;
    }
    if (!shouldExpireFile(doc, { nowMs, retentionDays, references })) continue;
    Object.assign(doc, patch);
    expiredIds.add(String(doc.id));
    const key = String(doc.storageKey || doc.storedName || doc.stored_name || '').trim();
    if (key) expiredStorageKeys.add(key);
  }

  const changedCaseIds = [];
  const changedMessageIds = [];
  if (expiredIds.size) {
    for (const record of (Array.isArray(state.cases) ? state.cases : [])) {
      let changed = false;
      for (const field of ['documents','completedFiles','sourceFiles','workFiles','files','uploads','attachments']) {
        changed = patchMatchingDocs(record?.[field], expiredIds, patch) || changed;
      }
      if (record?.file && expiredIds.has(String(record.file?.id || record.file?.fileId || ''))) {
        Object.assign(record.file, patch);
        changed = true;
      }
      if (changed) changedCaseIds.push(String(record.id || record.caseId || ''));
    }
    for (const message of (Array.isArray(state.teamChat) ? state.teamChat : [])) {
      let changed = false;
      changed = patchMatchingDocs(message?.files, expiredIds, patch) || changed;
      changed = patchMatchingDocs(message?.attachments, expiredIds, patch) || changed;
      if (message?.file && expiredIds.has(String(message.file?.id || message.file?.fileId || ''))) {
        Object.assign(message.file, patch);
        changed = true;
      }
      if (changed) changedMessageIds.push(String(message.id || ''));
    }
  }

  return {
    expiredIds:[...expiredIds],
    expiredStorageKeys:[...expiredStorageKeys],
    changedCaseIds:changedCaseIds.filter(Boolean),
    changedMessageIds:changedMessageIds.filter(Boolean),
    protectedIds,
    unknownAgeIds,
    retentionDays:Number(retentionDays || DEFAULT_FILE_RETENTION_DAYS)
  };
}
