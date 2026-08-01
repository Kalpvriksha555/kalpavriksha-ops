import { authFetch } from './authService';
import { isProjectDeletedError } from './requestControlService.js';
export { isProjectDeletedError } from './requestControlService.js';
export const getStatusColor = (status) => {
  switch (status) {
    case 'Lead Received': return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'Drafting': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'Drafting Paused': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'Internal Review': return 'bg-purple-100 text-purple-700 border-purple-200';
    case 'Revision Pending': return 'bg-red-100 text-red-700 border-red-200';
    case 'Revision In Progress': return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'Completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    default: return 'bg-slate-100 text-slate-700 border-slate-200';
  }
};

export const getPriorityColor = (priority, dueDate) => {
  if (dueDate && new Date(dueDate).getTime() < Date.now()) return 'text-red-700 bg-red-100 border-red-300 animate-pulse';
  switch (priority) {
    case 'Urgent': return 'text-red-600 bg-red-50 border-red-200';
    case 'High': return 'text-orange-600 bg-orange-50 border-orange-200';
    default: return 'text-slate-600 bg-slate-50 border-slate-200';
  }
};

// Phase 24C: task API + sync helpers. Keep operational task mutations behind
// this service so components do not create competing API/state code paths.

const FINANCE_FIELDS = Object.freeze([
  'estimate','ledger','financeVersion','paymentTrackingStatus','paymentTrackingUpdatedAt','paymentTrackingUpdatedBy',
  'paymentStatus','paymentReceived','paymentAmountIn','refundAmount','payerName','transactionId',
  'paymentDate','paymentTime','paymentAuditTrail','financeAccountingPeriod','lastFinanceMutationId','lastFinanceMutationAt'
]);

const toTime = (value) => {
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const getTaskFinanceTime = (task = {}) => Math.max(
  0,
  toTime(task.financeVersion),
  toTime(task.paymentTrackingUpdatedAt),
  toTime(task.ledger?.updatedAt),
  toTime(task.paymentUpdatedAt),
  toTime(task.paymentDate),
  ...(Array.isArray(task.paymentAuditTrail) ? task.paymentAuditTrail.map(item => toTime(item?.at || item?.updatedAt || item?.createdAt)) : [0])
);

const financeScore = (task = {}) => FINANCE_FIELDS.reduce((score, field) => {
  const value = task?.[field];
  if (value === undefined || value === null || value === '') return score;
  if (Array.isArray(value)) return score + (value.length ? 2 : 0);
  if (typeof value === 'object') return score + (Object.keys(value).length ? 2 : 0);
  return score + 1;
}, 0);

const applyFreshestTaskFinance = (target = {}, current = {}, incoming = {}) => {
  const currentTime = getTaskFinanceTime(current);
  const incomingTime = getTaskFinanceTime(incoming);
  const source = incomingTime > currentTime
    ? incoming
    : currentTime > incomingTime
      ? current
      : (financeScore(incoming) > financeScore(current) ? incoming : current);
  const next = { ...target };
  FINANCE_FIELDS.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(source || {}, field)) next[field] = structuredClone(source[field]);
    else delete next[field];
  });
  return next;
};

export const TASK_SYNC_STORAGE_KEYS = Object.freeze({
  projects: 'kalpa_projects',
  backup: 'kalpa_projects_backup',
  deleted: 'kalpa_deleted_project_ids',
  pendingCreates: 'kalpa_pending_created_projects',
  recentCreates: 'kalpa_recent_created_projects',
  pendingDeletes: 'kalpa_pending_deleted_project_ids',
  syncPing: 'kalpa_projects_sync_ping'
});

export const getTaskRecordTime = (task = {}) => {
  const candidates = [task.updatedAt, task.syncVersion, task.assignmentVersion, task.assignedAt, task.completedAt, task.submittedAt, task.createdAt];
  return Math.max(0, ...candidates.map(value => {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = new Date(value || 0).getTime();
    return !Number.isNaN(parsed) && parsed > 0 ? parsed : 0;
  }));
};

export const normalizeTaskAssignee = (value) => {
  const text = String(value || '').trim();
  return text || 'Unassigned';
};

export const normalizeTaskRecord = (task = {}) => {
  if (!task || typeof task !== 'object') return task;
  const assignedTo = normalizeTaskAssignee(task.assignedTo || task.ownership?.assignedTo || task.assigneeName || task.assignedToName || task.assignedUserName);
  return {
    ...task,
    id: String(task.id || task.caseId || '').trim() || task.id,
    caseId: task.caseId || task.id,
    assignedTo,
    ownership: { ...(task.ownership || {}), assignedTo },
    updatedAt: task.updatedAt || task.syncVersion || task.createdAt || Date.now()
  };
};

export const normalizeTaskList = (tasks = []) => (Array.isArray(tasks) ? tasks.map(normalizeTaskRecord).filter(t => t?.id) : []);

export const mergeTaskRecord = (current = {}, incoming = {}) => {
  const a = normalizeTaskRecord(current || {});
  const b = normalizeTaskRecord(incoming || {});
  if (!a?.id) return b;
  if (!b?.id) return a;
  const incomingNewer = getTaskRecordTime(b) >= getTaskRecordTime(a);
  const merged = incomingNewer ? { ...a, ...b } : { ...b, ...a };
  const aAssigned = a.assignedTo && a.assignedTo !== 'Unassigned';
  const bAssigned = b.assignedTo && b.assignedTo !== 'Unassigned';
  if (aAssigned || bAssigned) {
    const aTime = Number(a.assignmentVersion || a.assignedAt || 0);
    const bTime = Number(b.assignmentVersion || b.assignedAt || 0);
    const chosen = !aAssigned ? b : !bAssigned ? a : (bTime >= aTime ? b : a);
    merged.assignedTo = chosen.assignedTo;
    merged.assignedBy = chosen.assignedBy || merged.assignedBy;
    merged.assignedAt = chosen.assignedAt || merged.assignedAt;
    merged.assignmentVersion = chosen.assignmentVersion || chosen.assignedAt || merged.assignmentVersion;
    merged.ownership = { ...(merged.ownership || {}), assignedTo: merged.assignedTo, assignedBy: merged.assignedBy };
  }
  const timeline = [...(Array.isArray(a.timeline) ? a.timeline : []), ...(Array.isArray(b.timeline) ? b.timeline : [])];
  const seen = new Set();
  merged.timeline = timeline.filter(item => {
    const key = [item?.id, item?.text || item?.title, item?.time || item?.at].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return normalizeTaskRecord(applyFreshestTaskFinance(merged, a, b));
};

export const mergeTaskLists = (current = [], incoming = []) => {
  const byId = new Map();
  [...normalizeTaskList(current), ...normalizeTaskList(incoming)].forEach(task => {
    const key = String(task.id);
    byId.set(key, byId.has(key) ? mergeTaskRecord(byId.get(key), task) : task);
  });
  return Array.from(byId.values()).sort((a, b) => getTaskRecordTime(b) - getTaskRecordTime(a));
};

const parseJsonSafe = async (response) => response.json().catch(() => ({}));

const throwApiError = async (response, fallback) => {
  const payload = await parseJsonSafe(response);
  const error = new Error(payload.error || `${fallback}: ${response.status}`);
  error.status = response.status;
  error.code = payload.code || '';
  error.payload = payload;
  throw error;
};


export const fetchBackendState = async ({ apiBase, headers = {}, includePerformance = true, compact = true, sinceDataRevision = null, sinceVersion = null, sincePresence = null, sinceCollections = null }) => {
  const query = new URLSearchParams({
    compact: compact ? '1' : '0',
    performance: includePerformance ? '1' : '0'
  });
  if (Number.isFinite(Number(sinceDataRevision)) && Number(sinceDataRevision) >= 0) query.set('sinceDataRevision', String(Number(sinceDataRevision)));
  if (Number.isFinite(Number(sinceVersion)) && Number(sinceVersion) >= 0) query.set('sinceVersion', String(Number(sinceVersion)));
  if (Number.isFinite(Number(sincePresence)) && Number(sincePresence) >= 0) query.set('sincePresence', String(Number(sincePresence)));
  if (sinceCollections && typeof sinceCollections === 'object') query.set('sinceCollections', JSON.stringify(sinceCollections));
  const res = await authFetch(`${apiBase}/api/state?${query.toString()}`, { cache: 'no-store', headers, timeoutMs:60_000 });
  if (!res.ok) return throwApiError(res, 'Backend state failed');
  return parseJsonSafe(res);
};

const TASK_WRITE_TIMEOUT_MS = 2 * 60 * 1000;

export const createTaskApi = async ({ apiBase, headers = {}, task, expectedTaskVersion, mutationId }) => {
  let res;
  const normalizedTask=normalizeTaskRecord(task);
  const expected=expectedTaskVersion ?? normalizedTask.taskVersion ?? 0;
  const stableMutationId=String(mutationId || normalizedTask.mutationId || normalizedTask.clientMutationId || '').trim();
  try {
    res = await authFetch(`${apiBase}/api/state/projects`, {
      method: 'POST',
      headers,
      timeoutMs:TASK_WRITE_TIMEOUT_MS,
      body: JSON.stringify({ project: normalizedTask, expectedTaskVersion:expected, mutationId:stableMutationId })
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const timeoutError = new Error('Task save took too long. Refresh once before retrying so a successful save is not duplicated.');
      timeoutError.code = 'TASK_SAVE_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }
  if (!res.ok) return throwApiError(res, 'Backend project save failed');
  return parseJsonSafe(res);
};

export const saveTasksApi = async ({ apiBase, headers = {}, tasks = [] }) => {
  const res = await authFetch(`${apiBase}/api/state`, {
    method: 'POST',
    headers,
    timeoutMs:TASK_WRITE_TIMEOUT_MS,
    body: JSON.stringify({ projects: normalizeTaskList(tasks) })
  });
  if (!res.ok) throw new Error(`Backend state save failed: ${res.status}`);
  return parseJsonSafe(res);
};

export const deleteTaskApi = async ({ apiBase, taskId, headers = {} }) => {
  const res = await authFetch(`${apiBase}/api/state/projects/${encodeURIComponent(String(taskId))}`, { method: 'DELETE', headers, timeoutMs:TASK_WRITE_TIMEOUT_MS });
  if (!res.ok && res.status !== 404) return throwApiError(res, 'Backend task delete failed');
  return parseJsonSafe(res);
};

export const persistTasksToLocalCache = (tasks = [], { sanitize = (x) => x, filterDeleted = (x) => x, broadcast } = {}) => {
  const compact = sanitize(filterDeleted(normalizeTaskList(tasks)));
  try { localStorage.setItem(TASK_SYNC_STORAGE_KEYS.backup, JSON.stringify(compact)); } catch(e) {}
  try { localStorage.setItem(TASK_SYNC_STORAGE_KEYS.projects, JSON.stringify(compact)); } catch(e) {}
  try { if (typeof broadcast === 'function') broadcast(compact); } catch(e) {}
  return compact;
};

export const saveBackendStateApi = async ({ apiBase, headers = {}, payload = {} }) => {
  const normalizedPayload = { ...payload };
  if (Object.prototype.hasOwnProperty.call(payload, 'projects')) normalizedPayload.projects = normalizeTaskList(payload.projects || []);
  const res = await authFetch(`${apiBase}/api/state`, {
    method: 'POST',
    headers,
    timeoutMs:TASK_WRITE_TIMEOUT_MS,
    body: JSON.stringify(normalizedPayload)
  });
  if (!res.ok) throw new Error(`Backend state save failed: ${res.status}`);
  return parseJsonSafe(res);
};


const FINANCE_WRITE_TIMEOUT_MS = 45 * 1000;

export const saveFinanceStatusApi = async ({ apiBase, headers = {}, taskId, status, details = {}, expectedFinanceVersion, mutationId }) => {
  try {
    const res = await authFetch(`${apiBase}/api/state/projects/${encodeURIComponent(String(taskId))}/payment-status`, {
      method: 'POST',
      headers,
      timeoutMs:FINANCE_WRITE_TIMEOUT_MS,
      body: JSON.stringify({
        paymentTrackingStatus: status,
        expectedFinanceVersion,
        mutationId,
        ...details
      })
    });
    if (!res.ok) return throwApiError(res, 'Finance save failed');
    return parseJsonSafe(res);
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const timeoutError = new Error('Finance auto-save took too long. Your values remain on screen. Leave the field again or make another edit to retry safely; the same mutation ID prevents duplicate posting if the first attempt completed.');
      timeoutError.name = 'FinanceTimeoutError';
      timeoutError.code = 'FINANCE_SAVE_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }
};

export const fetchFinanceHistoryApi = async ({ apiBase, headers = {}, taskId }) => {
  const res = await authFetch(`${apiBase}/api/finance/history/${encodeURIComponent(String(taskId))}`, { cache: 'no-store', headers });
  if (!res.ok) return throwApiError(res, 'Finance history failed');
  return parseJsonSafe(res);
};
