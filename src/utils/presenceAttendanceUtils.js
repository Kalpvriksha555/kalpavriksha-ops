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


export const formatClockTimeFromMs = (ms, fallback = '-') => {
  const value = toMs(ms);
  if (!value) return fallback;
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const localDateKeyFromMs = (ms) => {
  const value = toMs(ms);
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-CA');
};

const parseDateTimeFromLogClock = (dateKey, clockValue = '') => {
  if (!dateKey || !clockValue || clockValue === '-') return 0;
  const raw = String(clockValue || '').trim();
  if (!raw) return 0;
  // Supports both modern browser times (01:06 AM) and older 24-hour entries (15:21).
  const direct = new Date(`${dateKey} ${raw}`).getTime();
  if (!Number.isNaN(direct)) return direct;
  const match24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const dt = new Date(`${dateKey}T${String(match24[1]).padStart(2, '0')}:${match24[2]}:00`);
    const ms = dt.getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
};

export const isSessionDateMatch = (ms, dateKey) => {
  const value = toMs(ms);
  if (!value || !dateKey) return false;
  return localDateKeyFromMs(value) === dateKey;
};

export const getAttendanceSessionStartMs = (log = {}, user = null) => {
  const dateKey = log.date || new Date().toLocaleDateString('en-CA');
  const explicit = toMs(log.loginAt) || toMs(log.firstLoginAt);
  if (explicit) return explicit;

  // When an attendance row exists but has no persisted loginAt, recover from the user's live session.
  const userLogin = toMs(user?.lastLoginAt);
  if (isSessionDateMatch(userLogin, dateKey)) return userLogin;

  return parseDateTimeFromLogClock(dateKey, log.loginTime || log.firstLogin);
};

export const getAttendanceSessionEndMs = (log = {}, user = null, now = Date.now()) => {
  const start = getAttendanceSessionStartMs(log, user);
  const online = user && isPresenceUserOnline(user, now);
  if (online) return now;

  const candidates = [
    toMs(log.logoutAt),
    toMs(log.lastTick),
    toMs(user?.lastLogoutAt),
    toMs(user?.lastSeenAt),
    toMs(user?.lastHeartbeatAt),
    parseDateTimeFromLogClock(log.date, log.logoutTime)
  ].filter(Boolean).filter(ms => !start || ms >= start);

  if (candidates.length) return Math.max(...candidates);
  return start || 0;
};

export const getAttendanceFirstLoginLabel = (log = {}, user = null) => {
  const start = getAttendanceSessionStartMs(log, user);
  return start ? formatClockTimeFromMs(start) : (log.loginTime || '-');
};

export const deriveAttendanceSession = (log = {}, user = null, now = Date.now()) => {
  const start = getAttendanceSessionStartMs(log, user);
  const end = getAttendanceSessionEndMs(log, user, now);
  const online = !!(user && isPresenceUserOnline(user, now));
  const breakMinutes = getBreakMinutesFromLog(log, now);
  const savedTotal = Math.max(0, Math.floor(Number(log.totalLoggedInMinutes) || 0));
  const computedTotal = start && end && end >= start ? Math.floor((end - start) / 60000) : 0;

  // Prefer the session window. It prevents offline users from continuing to accrue time
  // after logout while still recovering missing totals for online users.
  const totalLoggedInMinutes = computedTotal || savedTotal;
  const savedActive = Math.max(0, Math.floor(Number(log.activeMinutes) || 0));
  const computedActive = Math.max(0, totalLoggedInMinutes - breakMinutes);

  return {
    start,
    end,
    online,
    totalLoggedInMinutes,
    activeMinutes: Math.max(savedActive, computedActive),
    breakMinutes,
    firstLoginLabel: start ? formatClockTimeFromMs(start) : (log.loginTime || '-'),
    lastSeenMs: online ? 0 : end
  };
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


export const getUserTaskActiveMinutesForDate = (projects = [], userName = '', dateKey = localDateKeyFromMs(Date.now()), now = Date.now()) => {
  const key = identityKey(userName);
  if (!key || !dateKey) return 0;

  const dayStart = new Date(`${dateKey}T00:00:00`).getTime();
  const dayEnd = new Date(`${dateKey}T23:59:59.999`).getTime();
  if (!dayStart || !dayEnd) return 0;

  const intervals = (projects || [])
    .filter(project => project && identityKey(project.assignedTo || project.designer || project.completedBy) === key)
    .map(project => {
      const start = getTaskBusySince(project);
      if (!start) return null;
      const finished = getTaskFinishedAt(project);
      const end = isActiveWorkStatus(project.status) ? now : (finished || toMs(project.updatedAt) || now);
      const from = Math.max(start, dayStart);
      const to = Math.min(end, dayEnd, now);
      if (!from || !to || to <= from) return null;
      return [from, to];
    })
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);

  if (!intervals.length) return 0;

  const merged = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (!last || interval[0] > last[1]) {
      merged.push([...interval]);
    } else {
      last[1] = Math.max(last[1], interval[1]);
    }
  }

  return merged.reduce((total, [from, to]) => total + Math.floor((to - from) / 60000), 0);
};

export const getAttendanceActiveTaskMinutes = (log = {}, user = null, projects = [], now = Date.now()) => {
  if (!user || normalizeRole(user.role) === PRESENCE_ROLES.ADMIN) return 0;

  const session = deriveAttendanceSession(log, user, now);
  const sessionStart = session.start;
  const sessionEnd = session.end;

  // Active time must mean actual task-busy time inside today's logged-in window.
  // Do not count old assigned tasks when the user has no login for the selected date.
  // Do not let active time exceed total logged-in time.
  if (!sessionStart || !sessionEnd || sessionEnd <= sessionStart || session.totalLoggedInMinutes <= 0) return 0;

  const dateKey = log.date || localDateKeyFromMs(sessionStart || now);
  const key = identityKey(user.name || log.name);
  if (!key || !dateKey) return 0;

  const dayStart = new Date(`${dateKey}T00:00:00`).getTime();
  const dayEnd = new Date(`${dateKey}T23:59:59.999`).getTime();
  const windowStart = Math.max(sessionStart, dayStart);
  const windowEnd = Math.min(sessionEnd, dayEnd, now);
  if (!windowStart || !windowEnd || windowEnd <= windowStart) return 0;

  const intervals = (projects || [])
    .filter(project => project && samePerson(project.assignedTo || project.designer || project.completedBy, user.name || log.name))
    .map(project => {
      const start = getTaskBusySince(project);
      if (!start) return null;
      const finished = getTaskFinishedAt(project);
      const end = isActiveWorkStatus(project.status) ? now : (finished || toMs(project.updatedAt) || now);
      const from = Math.max(start, windowStart);
      const to = Math.min(end, windowEnd);
      if (!from || !to || to <= from) return null;
      return [from, to];
    })
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);

  if (!intervals.length) return 0;

  const merged = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (!last || interval[0] > last[1]) {
      merged.push([...interval]);
    } else {
      last[1] = Math.max(last[1], interval[1]);
    }
  }

  const busyMinutes = merged.reduce((total, [from, to]) => total + Math.floor((to - from) / 60000), 0);
  return Math.max(0, Math.min(busyMinutes, session.totalLoggedInMinutes));
};

export const getSafeAttendanceDeltaMinutes = (fromMs, toMsValue = Date.now(), maxGapMinutes = 10) => {
  const from = Number(fromMs) || 0;
  const to = Number(toMsValue) || Date.now();
  if (!from || to <= from) return 0;
  const elapsed = (to - from) / 60000;
  return elapsed > maxGapMinutes ? 0 : elapsed;
};

export const getAttendanceBaseLoginMs = (log = {}, user = null) => (
  getAttendanceSessionStartMs(log, user)
);

export const getTotalLoggedInMinutesFromLog = (log = {}, user = null, now = Date.now()) => (
  deriveAttendanceSession(log, user, now).totalLoggedInMinutes
);

export const getActiveMinutesFromLog = (log = {}, user = null, now = Date.now()) => (
  deriveAttendanceSession(log, user, now).activeMinutes
);

export const buildAttendanceAccrual = (log = {}, now = Date.now(), isOnBreak = false) => {
  const delta = getSafeAttendanceDeltaMinutes(log.lastTick || log.logoutAt || log.loginAt, now, 10);
  return {
    totalLoggedInMinutes: (Number(log.totalLoggedInMinutes) || 0) + delta,
    activeMinutes: (Number(log.activeMinutes) || 0) + (!isOnBreak ? delta : 0),
    totalBreakMinutes: (Number(log.totalBreakMinutes) || 0) + (isOnBreak ? delta : 0),
    lastTick: now
  };
};
