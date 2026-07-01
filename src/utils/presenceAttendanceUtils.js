// Presence, busy/free, and attendance calculation helpers.
// Extracted during modularization phase 4 to keep App.jsx focused on UI orchestration.

const ONLINE_STALE_MS = 5 * 60 * 1000;

export const toMs = (value) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const normalizeRole = (role = '') => {
  const value = String(role || '').trim().toUpperCase();
  if (value === 'ADMIN') return 'Admin';
  if (value === 'MANAGER') return 'Manager';
  if (value === 'DESIGNER') return 'Designer';
  return role || '';
};

export const PRESENCE_ROLES = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  DESIGNER: 'Designer'
};

const normalizePersonName = (name = '') => {
  const raw = String(name || '').trim();
  if (/khus+h?bu|khushboo|khushbu/i.test(raw)) return 'Khushbu Pandey';
  if (/ali\s*waqar|^ali$|^waqar$/i.test(raw)) return 'Waqar';
  return raw;
};

const identityKey = (value = '') => normalizePersonName(String(value || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
const samePerson = (a = '', b = '') => identityKey(a) === identityKey(b);

const userLastActivityAt = (user = {}) => Math.max(
  toMs(user.lastHeartbeatAt),
  toMs(user.lastSeenAt),
  toMs(user.lastLoginAt),
  toMs(user.availabilityUpdatedAt)
);

export const isPresenceUserOnline = (user = {}, nowMs = Date.now()) => {
  if (!user || !user.isOnline) return false;
  const lastActivity = userLastActivityAt(user);
  return !!lastActivity && (nowMs - lastActivity) <= ONLINE_STALE_MS;
};

export const getBreakMinutesFromLog = (log = {}, now = Date.now()) => {
  const stored = Number(log.totalBreakMinutes) || 0;
  const openBreak = log.currentBreakStartedAt ? Math.floor(Math.max(0, now - Number(log.currentBreakStartedAt)) / 60000) : 0;
  return stored + openBreak;
};

export const normalizeWorkStatus = (status = '') => String(status || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
export const WORK_DONE_STATUSES = new Set(['COMPLETED', 'CLOSED', 'CANCELLED', 'CANCELED', 'ARCHIVED', 'DELETED']);
export const isActiveWorkStatus = (status = '') => !WORK_DONE_STATUSES.has(normalizeWorkStatus(status));

export const getTaskBusySince = (project = {}) => (
  toMs(project.draftingStartedAt)
  || toMs(project.workStartedAt)
  || toMs(project.busySinceAt)
  || toMs(project.assignedAt)
  || toMs(project.startedAt)
  || toMs(project.createdAt)
  || 0
);

export const getTaskFinishedAt = (project = {}) => Math.max(
  toMs(project.completedAt),
  toMs(project.draftingCompletedAt),
  toMs(project.submittedAt),
  toMs(project.closedAt),
  toMs(project.reviewedAt),
  toMs(project.finishedAt),
  toMs(project.updatedAt)
);

export const getUserActiveTasks = (projects = [], userName = '') => (
  (projects || []).filter(project => samePerson(project.assignedTo, userName) && isActiveWorkStatus(project.status))
);

export const getUserLastCompletedAt = (projects = [], userName = '') => {
  const completed = (projects || [])
    .filter(project => samePerson(project.assignedTo, userName) && !isActiveWorkStatus(project.status) && getTaskFinishedAt(project))
    .map(project => getTaskFinishedAt(project))
    .sort((a, b) => b - a);
  return completed.length ? completed[0] : 0;
};

export const getUserFreeSince = (projects = [], userName = '', presenceTimes = {}, user = null) => {
  if (normalizeRole(user?.role) === PRESENCE_ROLES.ADMIN) return 0;
  const active = getUserActiveTasks(projects, userName);
  if (active.length > 0) return 0;
  const key = normalizePersonName(userName);
  return (
    toMs(presenceTimes?.[key]?.freeSince)
    || getUserLastCompletedAt(projects, userName)
    || toMs(user?.freeSinceAt)
    || toMs(user?.availableSinceAt)
    || toMs(user?.availabilityUpdatedAt)
    || 0
  );
};

export const getUserBusySince = (projects = [], userName = '', presenceTimes = {}) => {
  const active = getUserActiveTasks(projects, userName)
    .map(project => ({ project, since: getTaskBusySince(project) }))
    .filter(item => item.since)
    .sort((a, b) => b.since - a.since);
  if (active.length) return active[0].since;
  const key = normalizePersonName(userName);
  return toMs(presenceTimes?.[key]?.busySince) || 0;
};

export const getSafeAttendanceDeltaMinutes = (fromMs, toMsValue = Date.now(), maxGapMinutes = 10) => {
  const from = Number(fromMs) || 0;
  const to = Number(toMsValue) || Date.now();
  if (!from || to <= from) return 0;
  const elapsed = (to - from) / 60000;
  return elapsed > maxGapMinutes ? 0 : elapsed;
};

export const getAttendanceBaseLoginMs = (log = {}, user = null) => (
  toMs(log.loginAt)
  || toMs(log.firstLoginAt)
  || toMs(user?.lastLoginAt)
  || 0
);

export const getTotalLoggedInMinutesFromLog = (log = {}, user = null, now = Date.now()) => {
  const saved = Number(log.totalLoggedInMinutes) || 0;
  const loginMs = getAttendanceBaseLoginMs(log, user);
  const isOnline = user && isPresenceUserOnline(user, now);

  if (isOnline) {
    const lastTick = toMs(log.lastTick) || toMs(log.logoutAt) || loginMs || toMs(user?.lastHeartbeatAt) || toMs(user?.lastSeenAt);
    return Math.max(0, Math.floor(saved + getSafeAttendanceDeltaMinutes(lastTick, now, 10)));
  }

  if (saved > 0) return Math.max(0, Math.floor(saved));
  if (!loginMs) return Math.max(0, Math.floor((Number(log.activeMinutes) || 0) + getBreakMinutesFromLog(log, now)));
  const endMs = toMs(log.logoutAt) || toMs(user?.lastLogoutAt) || toMs(user?.lastSeenAt) || toMs(log.lastTick) || now;
  return Math.max(0, Math.floor((endMs - loginMs) / 60000));
};

export const getActiveMinutesFromLog = (log = {}, user = null, now = Date.now()) => {
  const saved = Number(log.activeMinutes) || 0;
  const isOnline = user && isPresenceUserOnline(user, now);
  const isOnBreak = log.status === 'On Break' || user?.availability === 'Break' || !!log.currentBreakStartedAt;
  if (!isOnline || isOnBreak) return Math.max(0, Math.floor(saved));
  const lastTick = toMs(log.lastTick) || toMs(log.logoutAt) || getAttendanceBaseLoginMs(log, user);
  return Math.max(0, Math.floor(saved + getSafeAttendanceDeltaMinutes(lastTick, now, 10)));
};

export const buildAttendanceAccrual = (log = {}, now = Date.now(), isOnBreak = false) => {
  const delta = getSafeAttendanceDeltaMinutes(log.lastTick || log.logoutAt || log.loginAt, now, 10);
  return {
    totalLoggedInMinutes: (Number(log.totalLoggedInMinutes) || 0) + delta,
    activeMinutes: (Number(log.activeMinutes) || 0) + (!isOnBreak ? delta : 0),
    totalBreakMinutes: (Number(log.totalBreakMinutes) || 0) + (isOnBreak ? delta : 0),
    lastTick: now
  };
};
