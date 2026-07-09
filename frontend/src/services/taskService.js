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
  syncPing: 'kalpa_projects_sync_ping'
});

export const getTaskRecordTime = (task = {}) => {
  const candidates = [task.updatedAt, task.syncVersion, task.assignmentVersion, task.assignedAt, task.completedAt, task.submittedAt, task.createdAt];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = new Date(value || 0).getTime();
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 0;
};

export const normalizeTaskAssignee = (value) => {
  const text = String(value || '').trim();
  return text || 'Unassigned';
};

export const normalizeTaskRecord = (task = {}) => {
  if (!task || typeof task !== 'object') return task;
  const assignedTo = normalizeTaskAssignee(task.assignedTo || task.ownership?.assignedTo);
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
  return normalizeTaskRecord(merged);
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

export const fetchBackendState = async ({ apiBase, headers = {} }) => {
  const res = await fetch(`${apiBase}/api/state`, { cache: 'no-store', headers });
  if (!res.ok) throw new Error(`Backend state failed: ${res.status}`);
  return parseJsonSafe(res);
};

export const createTaskApi = async ({ apiBase, headers = {}, currentUserRole = '', task }) => {
  const res = await fetch(`${apiBase}/api/state/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ currentUserRole, project: normalizeTaskRecord(task) })
  });
  if (!res.ok) throw new Error(`Backend project save failed: ${res.status}`);
  return parseJsonSafe(res);
};

export const saveTasksApi = async ({ apiBase, headers = {}, currentUserRole = '', tasks = [] }) => {
  const res = await fetch(`${apiBase}/api/state`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ currentUserRole, projects: normalizeTaskList(tasks) })
  });
  if (!res.ok) throw new Error(`Backend state save failed: ${res.status}`);
  return parseJsonSafe(res);
};

export const deleteTaskApi = async ({ apiBase, taskId, headers = {} }) => {
  const res = await fetch(`${apiBase}/api/state/projects/${encodeURIComponent(String(taskId))}`, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 404) throw new Error(`Backend task delete failed: ${res.status}`);
  return parseJsonSafe(res);
};

export const persistTasksToLocalCache = (tasks = [], { sanitize = (x) => x, filterDeleted = (x) => x, broadcast } = {}) => {
  const compact = sanitize(filterDeleted(normalizeTaskList(tasks)));
  try { localStorage.setItem(TASK_SYNC_STORAGE_KEYS.backup, JSON.stringify(compact)); } catch(e) {}
  try { localStorage.setItem(TASK_SYNC_STORAGE_KEYS.projects, JSON.stringify(compact)); } catch(e) {}
  try { if (typeof broadcast === 'function') broadcast(compact); } catch(e) {}
  return compact;
};

export const saveBackendStateApi = async ({ apiBase, headers = {}, payload = {}, currentUserRole = '' }) => {
  const res = await fetch(`${apiBase}/api/state`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, currentUserRole, projects: normalizeTaskList(payload.projects || []) })
  });
  if (!res.ok) throw new Error(`Backend state save failed: ${res.status}`);
  return parseJsonSafe(res);
};
