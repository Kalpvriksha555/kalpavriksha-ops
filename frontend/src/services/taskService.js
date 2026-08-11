import { authFetch } from './authService';
import { asArray, asRecord } from '../utils/runtimeShapeUtils.js';
import { getClientMutationGeneration, isProjectDeletedError } from './requestControlService.js';
import { apiHttpError, readApiRecord, validateWorkspaceStatePayload } from './apiContractService.js';
import { applyFreshestTaskFinance } from '../utils/financeMergeUtils.js';
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
  const candidates = [task?.updatedAt, task?.syncVersion, task?.assignmentVersion, task?.assignedAt, task?.completedAt, task?.submittedAt, task?.createdAt];
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
  const source = asRecord(task);
  const assignedTo = normalizeTaskAssignee(source?.assignedTo || source?.ownership?.assignedTo || source?.assigneeName || source?.assignedToName || source?.assignedUserName);
  return {
    ...source,
    id: String(source?.id || source?.caseId || '').trim() || source?.id,
    caseId: source?.caseId || source?.id,
    assignedTo,
    ownership: { ...asRecord(source?.ownership), assignedTo },
    documents: asArray(source?.documents),
    completedFiles: asArray(source?.completedFiles),
    finalFiles: asArray(source?.finalFiles),
    workFiles: asArray(source?.workFiles),
    sourceFiles: asArray(source?.sourceFiles),
    subTasks: asArray(source?.subTasks),
    revisions: asArray(source?.revisions),
    notes: asArray(source?.notes),
    reassignmentHistory: asArray(source?.reassignmentHistory),
    deliveryLog: asArray(source?.deliveryLog),
    revisionHistory: asArray(source?.revisionHistory),
    reviewHistory: asArray(source?.reviewHistory),
    caseEditHistory: asArray(source?.caseEditHistory),
    pausedDraftingSessions: asArray(source?.pausedDraftingSessions),
    previousTaskIds: asArray(source?.previousTaskIds),
    paymentAuditTrail: asArray(source?.paymentAuditTrail),
    timeline: asArray(source?.timeline),
    history: asArray(source?.history),
    ledger: asRecord(source?.ledger),
    updatedAt: source?.updatedAt || source?.syncVersion || source?.createdAt || Date.now()
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
    merged.ownership = { ...asRecord(merged.ownership), assignedTo: merged.assignedTo, assignedBy: merged.assignedBy };
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

const parseJsonSafe = async (response, operation = 'API request', options = {}) => readApiRecord(response, {
  operation,
  requireOk:response.ok && options.requireOk !== false,
  requiredFields:options.requiredFields || []
});

const throwApiError = async (response, fallback) => {
  const payload = await readApiRecord(response, { operation:fallback || 'API request' });
  throw apiHttpError(response, payload, fallback || 'Request failed.');
};

const requireConfirmedProject = (payload, operation = 'Task save') => {
  const project = asRecord(payload?.project || payload?.case);
  if (!project.id && !project.caseId) {
    const error = new Error(`${operation} returned success without a confirmed task identity. Refresh before retrying.`);
    error.name = 'ApiContractError';
    error.code = 'TASK_CONFIRMATION_MISSING';
    error.payload = asRecord(payload);
    throw error;
  }
  return payload;
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
  const clientMutationGenerationAtStart = getClientMutationGeneration();
  const res = await authFetch(`${apiBase}/api/state?${query.toString()}`, { cache: 'no-store', headers, timeoutMs:60_000 });
  if (!res.ok) return throwApiError(res, 'Backend state failed');
  const payload = validateWorkspaceStatePayload(await parseJsonSafe(res, 'Workspace state'));
  const clientMutationGenerationAtResponse = getClientMutationGeneration();
  return {
    ...payload,
    _clientMutationGenerationAtStart:clientMutationGenerationAtStart,
    _clientMutationGenerationAtResponse:clientMutationGenerationAtResponse,
    _staleAfterClientMutation:clientMutationGenerationAtResponse !== clientMutationGenerationAtStart
  };
};

const TASK_WRITE_TIMEOUT_MS = 2 * 60 * 1000;

export const createTaskApi = async ({ apiBase, headers = {}, task, expectedTaskVersion, mutationId, operation = '' }) => {
  let res;
  const normalizedTask=normalizeTaskRecord(task);
  const expected=expectedTaskVersion ?? normalizedTask.taskVersion ?? 0;
  const stableMutationId=String(mutationId || normalizedTask.mutationId || normalizedTask.clientMutationId || '').trim();
  try {
    res = await authFetch(`${apiBase}/api/state/projects`, {
      method: 'POST',
      headers,
      timeoutMs:TASK_WRITE_TIMEOUT_MS,
      body: JSON.stringify({ project: normalizedTask, expectedTaskVersion:expected, mutationId:stableMutationId, operation:String(operation || '').trim().toLowerCase() })
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
  return requireConfirmedProject(await parseJsonSafe(res, 'Task save'), 'Task save');
};

export const saveTasksApi = async ({ apiBase, headers = {}, tasks = [] }) => {
  const res = await authFetch(`${apiBase}/api/state`, {
    method: 'POST',
    headers,
    timeoutMs:TASK_WRITE_TIMEOUT_MS,
    body: JSON.stringify({ projects: normalizeTaskList(tasks) })
  });
  if (!res.ok) return throwApiError(res, 'Backend state save failed');
  return parseJsonSafe(res, 'Backend state save');
};

export const deleteTaskApi = async ({ apiBase, taskId, headers = {}, expectedTaskVersion, mutationId }) => {
  let res;
  try {
    res = await authFetch(`${apiBase}/api/state/projects/${encodeURIComponent(String(taskId))}`, {
      method: 'DELETE',
      headers,
      timeoutMs:TASK_WRITE_TIMEOUT_MS,
      body:JSON.stringify({ expectedTaskVersion, mutationId:String(mutationId || '').trim() })
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const timeoutError = new Error('Task delete took too long. The task remains hidden while server confirmation retries with the same delete request.');
      timeoutError.code = 'TASK_DELETE_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }
  if (!res.ok && res.status !== 404) return throwApiError(res, 'Backend task delete failed');
  if (res.status === 404) {
    const payload = await readApiRecord(res, { operation:'Backend task delete' });
    return { ...payload, ok:true, alreadyAbsent:true, deletedProjectIds:asArray(payload.deletedProjectIds) };
  }
  return parseJsonSafe(res, 'Backend task delete');
};

export const persistTasksToLocalCache = (tasks = [], { sanitize = (x) => x, filterDeleted = (x) => x, broadcast } = {}) => {
  const compact = sanitize(filterDeleted(normalizeTaskList(tasks)));
  try { localStorage.setItem(TASK_SYNC_STORAGE_KEYS.backup, JSON.stringify(compact)); } catch(e) {}
  try { localStorage.setItem(TASK_SYNC_STORAGE_KEYS.projects, JSON.stringify(compact)); } catch(e) {}
  try { if (typeof broadcast === 'function') broadcast(compact); } catch(e) {}
  return compact;
};

export const saveBackendStateApi = async ({ apiBase, headers = {}, payload = {} }) => {
  payload = asRecord(payload);
  const normalizedPayload = { ...payload };
  if (Object.prototype.hasOwnProperty.call(payload, 'projects')) normalizedPayload.projects = normalizeTaskList(payload.projects);
  const res = await authFetch(`${apiBase}/api/state`, {
    method: 'POST',
    headers,
    timeoutMs:TASK_WRITE_TIMEOUT_MS,
    body: JSON.stringify(normalizedPayload)
  });
  if (!res.ok) return throwApiError(res, 'Backend state save failed');
  return parseJsonSafe(res, 'Backend state save');
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
    return requireConfirmedProject(await parseJsonSafe(res, 'Finance save'), 'Finance save');
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const timeoutError = new Error('Finance save took too long. Your values remain on screen. Select Save Payment Details again; the same mutation ID prevents duplicate posting if the first attempt completed.');
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
  return parseJsonSafe(res, 'Finance history');
};
