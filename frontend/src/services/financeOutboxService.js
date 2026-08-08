const FINANCE_OUTBOX_SCHEMA_VERSION = 1;
export const FINANCE_OUTBOX_STORAGE_KEY = 'kalpa_pending_finance_updates_v1';
export const FINANCE_OUTBOX_BACKUP_KEY = 'kalpa_pending_finance_updates_backup_v1';
export const FINANCE_OUTBOX_PING_KEY = 'kalpa_finance_outbox_ping_v1';
export const FINANCE_LAST_SYNCED_AT_KEY = 'kalpa_finance_last_synced_at_v1';
export const FINANCE_SYNC_EVENT = 'kalpa:finance-sync-changed';
export const FINANCE_FLUSH_EVENT = 'kalpa:finance-sync-flush';
const FINANCE_OUTBOX_LIMIT = 1000;
let runtimeStorageError = false;
let runtimeStorageErrorReason = '';
let cachedEnvelope = null;
let cachedStorage = null;
let cachedPrimaryRaw = null;
let cachedBackupRaw = null;

export const invalidateFinanceOutboxStorageCache = () => {
  cachedEnvelope = null;
  cachedStorage = null;
  cachedPrimaryRaw = null;
  cachedBackupRaw = null;
};

const getStorage = () => {
  try {
    const storage = globalThis.localStorage || null;
    if (cachedStorage && cachedStorage !== storage) invalidateFinanceOutboxStorageCache();
    return storage;
  } catch {
    return null;
  }
};

const createMutationId = () => {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}
  return `finance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const financeActorKey = (user = {}) => String(user.id || user.username || user.name || '').trim().toLowerCase();

export const financeTaskKey = (task = {}) => String(task.id || task.caseId || task.taskId || '').trim();
const financeLastSyncedKey = (actorId = '') => `${FINANCE_LAST_SYNCED_AT_KEY}::${String(actorId || '').trim().toLowerCase() || 'unknown'}`;

export const sanitizeFinanceDraftForStorage = (draft = {}) => ({
  estimate: String(draft.estimate ?? ''),
  amountIn: String(draft.amountIn ?? ''),
  expenses: String(draft.expenses ?? ''),
  refund: String(draft.refund ?? ''),
  date: String(draft.date ?? ''),
  receivedFrom: String(draft.receivedFrom ?? ''),
  txnId: String(draft.txnId ?? ''),
  mode: String(draft.mode ?? ''),
  note: String(draft.note ?? ''),
  screenshot: draft.screenshot && typeof draft.screenshot === 'object'
    ? {
        id: draft.screenshot.id || '',
        name: draft.screenshot.name || draft.screenshot.fileName || '',
        fileName: draft.screenshot.fileName || draft.screenshot.name || '',
        type: draft.screenshot.type || '',
        mimeType: draft.screenshot.mimeType || '',
        size: Number(draft.screenshot.size || 0),
        uploadedAt: draft.screenshot.uploadedAt || draft.screenshot.createdAt || '',
      }
    : (draft.screenshot || null),
});

export const getStoredFinanceDraftSignature = (draft = {}) => JSON.stringify({
  estimate: String(draft.estimate ?? '').trim(),
  amountIn: String(draft.amountIn ?? '').trim(),
  expenses: String(draft.expenses ?? '').trim(),
  refund: String(draft.refund ?? '').trim(),
  date: String(draft.date ?? '').trim(),
  receivedFrom: String(draft.receivedFrom ?? '').trim(),
  txnId: String(draft.txnId ?? '').trim(),
  mode: String(draft.mode ?? '').trim(),
  note: String(draft.note ?? '').trim(),
  screenshotId: draft.screenshot?.id || draft.screenshot || '',
});

const parseStoredEnvelope = (raw) => {
  const exists = raw !== null && raw !== undefined && String(raw) !== '';
  if (!exists) return { exists:false, valid:false, generation:0, records:{} };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { exists:true, valid:false, generation:0, records:{} };
    }
    if (parsed.records && typeof parsed.records === 'object' && !Array.isArray(parsed.records)) {
      return {
        exists:true,
        valid:true,
        generation:Math.max(0, Number(parsed.generation || 0)),
        records:parsed.records,
      };
    }
    // Backward compatibility for the first outbox format, which stored the
    // record map directly without a mirrored generation envelope.
    const records = parsed;
    const generation = Object.values(records).reduce(
      (latest, record) => Math.max(latest, Number(record?.updatedAt || record?.queuedAt || 0)),
      0
    );
    return { exists:true, valid:true, generation, records };
  } catch {
    return { exists:true, valid:false, generation:0, records:{} };
  }
};

const readEnvelope = ({ fresh = false } = {}) => {
  const storage = getStorage();
  if (!storage) return { generation:0, records:{} };
  const primaryRaw = storage.getItem(FINANCE_OUTBOX_STORAGE_KEY);
  const backupRaw = storage.getItem(FINANCE_OUTBOX_BACKUP_KEY);
  if (!fresh && cachedEnvelope && cachedStorage === storage && primaryRaw === cachedPrimaryRaw && backupRaw === cachedBackupRaw) return cachedEnvelope;
  const primary = parseStoredEnvelope(primaryRaw);
  const backup = parseStoredEnvelope(backupRaw);
  let selected = { generation:0, records:{} };
  if (primary.valid && backup.valid) {
    // Choose one complete generation instead of merging individual rows. A
    // row merge could resurrect an already-confirmed mutation when only one
    // mirror completed a deletion before a browser/storage interruption.
    selected = primary.generation >= backup.generation ? primary : backup;
  } else if (primary.valid) {
    selected = primary;
  } else if (backup.valid) {
    selected = backup;
  } else if (primary.exists || backup.exists) {
    runtimeStorageError = true;
    runtimeStorageErrorReason = 'The stored payment-sync queue is unreadable. Do not close the browser until it is reviewed.';
  }
  cachedStorage = storage;
  cachedPrimaryRaw = primaryRaw;
  cachedBackupRaw = backupRaw;
  cachedEnvelope = { generation:Number(selected.generation || 0), records:selected.records || {} };
  return cachedEnvelope;
};

// Every mutating caller receives its own top-level map. This preserves the
// cached parsed generation while preventing an unsuccessful write from
// mutating the in-memory committed outbox.
const readMap = (options) => ({ ...readEnvelope(options).records });

const emitChanged = (detail = {}) => {
  const payload = { at: Date.now(), source: 'finance-outbox', ...detail };
  try {
    globalThis.window?.dispatchEvent?.(new CustomEvent(FINANCE_SYNC_EVENT, { detail: payload }));
  } catch {}
  const storage = getStorage();
  try { storage?.setItem(FINANCE_OUTBOX_PING_KEY, JSON.stringify(payload)); } catch {}
};

const writeMap = (map, detail = {}) => {
  const storage = getStorage();
  if (!storage) {
    runtimeStorageError = true;
    runtimeStorageErrorReason = 'Browser storage is unavailable.';
    emitChanged({ ...detail, action:'storage-error', storageError:true });
    return false;
  }

  let serialized = '';
  let generation = 0;
  let entries = [];
  let committedRecords = {};
  try {
    entries = Object.entries(map || {})
      .filter(([, record]) => record?.taskId && record?.actorId)
      .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0));
    // Never silently discard an unsynced payment record. At the deliberately
    // high safety limit, reject the new write and surface a visible storage
    // error while preserving the previously committed outbox generation.
    if (entries.length > FINANCE_OUTBOX_LIMIT) {
      runtimeStorageError = true;
      runtimeStorageErrorReason = 'The pending payment queue reached its safety limit.';
      emitChanged({ ...detail, action:'storage-error', storageError:true });
      return false;
    }
    generation = Math.max(1, Number((cachedStorage === storage ? cachedEnvelope?.generation : readEnvelope().generation) || 0) + 1);
    committedRecords = Object.fromEntries(entries);
    serialized = JSON.stringify({
      schemaVersion:FINANCE_OUTBOX_SCHEMA_VERSION,
      generation,
      writtenAt:Date.now(),
      records:committedRecords,
    });
  } catch {
    runtimeStorageError = true;
    runtimeStorageErrorReason = 'The pending payment queue could not be prepared for storage.';
    emitChanged({ ...detail, action:'storage-error', storageError:true });
    return false;
  }

  let backupWritten = false;
  let primaryWritten = false;
  try {
    storage.setItem(FINANCE_OUTBOX_BACKUP_KEY, serialized);
    backupWritten = true;
  } catch {}
  try {
    storage.setItem(FINANCE_OUTBOX_STORAGE_KEY, serialized);
    primaryWritten = true;
  } catch {}

  if (!backupWritten && !primaryWritten) {
    runtimeStorageError = true;
    runtimeStorageErrorReason = 'The browser rejected durable storage for the pending payment queue.';
    emitChanged({ ...detail, action:'storage-error', storageError:true });
    return false;
  }
  runtimeStorageError = false;
  runtimeStorageErrorReason = '';
  cachedStorage = storage;
  try { cachedPrimaryRaw = storage.getItem(FINANCE_OUTBOX_STORAGE_KEY); } catch { cachedPrimaryRaw = primaryWritten ? serialized : null; }
  try { cachedBackupRaw = storage.getItem(FINANCE_OUTBOX_BACKUP_KEY); } catch { cachedBackupRaw = backupWritten ? serialized : null; }
  cachedEnvelope = { generation, records:committedRecords };
  emitChanged({ ...detail, mirrored: backupWritten && primaryWritten, generation, storageError:false });
  return true;
};

export const getFinanceOutboxRecords = (actorId = '') => {
  const actorKey = String(actorId || '').trim().toLowerCase();
  return Object.values(readMap())
    .filter(record => record?.taskId && (!actorKey || String(record.actorId || '').trim().toLowerCase() === actorKey))
    .sort((a, b) => Number(a.queuedAt || a.updatedAt || 0) - Number(b.queuedAt || b.updatedAt || 0));
};

export const getFinanceOutboxRecord = (taskId, actorId = '') => {
  const taskKey = String(taskId || '').trim();
  const actorKey = String(actorId || '').trim().toLowerCase();
  if (!taskKey || !actorKey) return null;
  return readMap()[`${actorKey}::${taskKey}`] || null;
};

export const queueFinanceDraft = ({ project = {}, draft = {}, user = {}, mutationId = '', expectedFinanceVersion } = {}) => {
  const taskId = financeTaskKey(project);
  const actorId = financeActorKey(user);
  if (!taskId || !actorId) return null;

  const map = readMap();
  const key = `${actorId}::${taskId}`;
  const previous = map[key] || {};
  const safeDraft = sanitizeFinanceDraftForStorage(draft);
  const draftSignature = getStoredFinanceDraftSignature(safeDraft);
  const sameDraft = previous.draftSignature === draftSignature;
  const now = Date.now();
  const nextMutationId = sameDraft
    ? String(previous.mutationId || mutationId || createMutationId())
    : String(mutationId || createMutationId());

  const record = {
    schemaVersion: FINANCE_OUTBOX_SCHEMA_VERSION,
    key,
    taskId,
    actorId,
    actorName: String(user.name || previous.actorName || ''),
    status: String(project.paymentTrackingStatus || project.paymentStatus || previous.status || ''),
    draft: safeDraft,
    draftSignature,
    mutationId: nextMutationId,
    expectedFinanceVersion: Number(
      sameDraft
        ? (previous.expectedFinanceVersion ?? expectedFinanceVersion ?? project.financeVersion ?? 0)
        : (expectedFinanceVersion ?? previous.confirmedFinanceVersion ?? project.financeVersion ?? 0)
    ),
    queuedAt: sameDraft ? Number(previous.queuedAt || now) : now,
    updatedAt: now,
    attempts: sameDraft ? Number(previous.attempts || 0) : 0,
    lastAttemptAt: sameDraft ? Number(previous.lastAttemptAt || 0) : 0,
    lastError: sameDraft ? String(previous.lastError || '') : '',
    lastErrorCode: sameDraft ? String(previous.lastErrorCode || '') : '',
    retryable: sameDraft ? previous.retryable !== false : true,
    state: sameDraft && previous.state === 'error' ? 'error' : 'pending',
  };

  map[key] = record;
  if (!writeMap(map, { action: 'queued', taskId, actorId })) return null;
  return record;
};

export const markFinanceOutboxAttempt = (key, mutationId = '') => {
  const map = readMap();
  const storedRecord = map[String(key || '')];
  if (!storedRecord || (mutationId && String(storedRecord.mutationId) !== String(mutationId))) return storedRecord || null;
  const record = { ...storedRecord };
  record.attempts = Number(record.attempts || 0) + 1;
  record.lastAttemptAt = Date.now();
  record.lastError = '';
  record.lastErrorCode = '';
  record.retryable = true;
  record.state = 'syncing';
  map[record.key] = record;
  writeMap(map, { action: 'attempt', taskId: record.taskId, actorId: record.actorId });
  return record;
};

export const markFinanceOutboxError = (key, mutationId = '', error = {}, options = {}) => {
  const map = readMap();
  const storedRecord = map[String(key || '')];
  if (!storedRecord || (mutationId && String(storedRecord.mutationId) !== String(mutationId))) return storedRecord || null;
  const record = { ...storedRecord };
  record.lastError = String(error?.message || error || 'Payment update could not be synced.');
  record.lastErrorCode = String(error?.code || options.code || 'FINANCE_SYNC_FAILED');
  record.retryable = options.retryable !== false;
  record.state = 'error';
  record.updatedAt = Date.now();
  map[record.key] = record;
  writeMap(map, { action: 'error', taskId: record.taskId, actorId: record.actorId });
  return record;
};

export const advanceFinanceOutboxAfterConfirmation = ({ key, mutationId, confirmedFinanceVersion, actorId = '' } = {}) => {
  const map = readMap();
  const storedRecord = map[String(key || '')];
  const record = storedRecord ? { ...storedRecord } : null;
  const storage = getStorage();
  if (!record) {
    try { storage?.setItem(financeLastSyncedKey(actorId), String(Date.now())); } catch {}
    emitChanged({ action: 'confirmed-missing' });
    return { removed: false, newerPending: false };
  }

  if (String(record.mutationId) === String(mutationId || '')) {
    delete map[record.key];
    try { storage?.setItem(financeLastSyncedKey(record.actorId || actorId), String(Date.now())); } catch {}
    writeMap(map, { action: 'confirmed', taskId: record.taskId, actorId: record.actorId });
    return { removed: true, newerPending: false };
  }

  record.expectedFinanceVersion = Number(confirmedFinanceVersion ?? record.expectedFinanceVersion ?? 0);
  record.confirmedFinanceVersion = Number(confirmedFinanceVersion ?? record.confirmedFinanceVersion ?? 0);
  record.lastError = '';
  record.lastErrorCode = '';
  record.retryable = true;
  record.state = 'pending';
  record.updatedAt = Date.now();
  map[record.key] = record;
  writeMap(map, { action: 'advanced', taskId: record.taskId, actorId: record.actorId });
  return { removed: false, newerPending: true, record };
};

export const removeFinanceOutboxRecord = (key, mutationId = '') => {
  const map = readMap();
  const record = map[String(key || '')];
  if (!record || (mutationId && String(record.mutationId) !== String(mutationId))) return false;
  delete map[record.key];
  return writeMap(map, { action: 'removed', taskId: record.taskId, actorId: record.actorId });
};

export const getFinanceSyncSnapshot = (actorId = '', inFlightCount = 0) => {
  const records = getFinanceOutboxRecords(actorId);
  const errors = records.filter(record => record.state === 'error');
  const retryable = records.filter(record => record.retryable !== false);
  const storage = getStorage();
  let lastSyncedAt = 0;
  try { lastSyncedAt = Number(storage?.getItem(financeLastSyncedKey(actorId)) || 0); } catch {}
  return {
    total: records.length,
    pending: records.filter(record => record.state !== 'error').length,
    errors: errors.length,
    retryable: retryable.length,
    syncing: Math.max(0, Number(inFlightCount || 0)),
    lastSyncedAt,
    storageError:runtimeStorageError,
    storageErrorReason:runtimeStorageErrorReason,
    records,
  };
};

export const requestFinanceOutboxFlush = () => {
  try {
    globalThis.window?.dispatchEvent?.(new CustomEvent(FINANCE_FLUSH_EVENT, { detail: { at: Date.now() } }));
  } catch {}
  emitChanged({ action: 'flush-requested' });
};
