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
  const explicitCandidates = [toMs(log.loginAt), toMs(log.firstLoginAt)].filter(Boolean);
  const sameDayExplicit = explicitCandidates.find(ms => isSessionDateMatch(ms, dateKey));
  if (sameDayExplicit) return sameDayExplicit;

  // When an attendance row exists but has no persisted loginAt, recover from the user's live session.
  // Never use a previous day's login timestamp for today's row; it creates impossible
  // combinations like "First login today" with "Last seen three days ago".
  const userLogin = toMs(user?.lastLoginAt);
  if (isSessionDateMatch(userLogin, dateKey)) return userLogin;

  return parseDateTimeFromLogClock(dateKey, log.loginTime || log.firstLogin);
};

export const getAttendanceSessionEndMs = (log = {}, user = null, now = Date.now()) => {
  const start = getAttendanceSessionStartMs(log, user);
  const online = user && isPresenceUserOnline(user, now);
  if (online) return now;

  const dateKey = log.date || (start ? localDateKeyFromMs(start) : new Date().toLocaleDateString('en-CA'));
  const candidates = [
    toMs(log.logoutAt),
    toMs(log.lastTick),
    toMs(user?.lastLogoutAt),
    toMs(user?.lastSeenAt),
    toMs(user?.lastHeartbeatAt),
    parseDateTimeFromLogClock(log.date, log.logoutTime)
  ].filter(Boolean).filter(ms => (!start || ms >= start) && (!dateKey || isSessionDateMatch(ms, dateKey)));

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
  const breakMinutes = getBreakMinutesFromLog(log, now, user);
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

export const getBreakMinutesFromLog = (log = {}, now = Date.now(), user = null) => {
  const stored = Number(log.totalBreakMinutes || log.breakMinutes || log.breakMinutesToday || 0) || 0;
  const logBreakStart = toMs(log.currentBreakStartedAt || log.breakStartedAt);
  const userBreakStart = toMs(user?.currentBreakStartedAt || user?.breakStartedAt || user?.availabilityProfile?.breakStartedAt);
  const userOnBreak = String(user?.availability || '').toLowerCase() === 'break';
  const activeStart = logBreakStart || (userOnBreak ? userBreakStart : 0);
  const openBreak = activeStart ? Math.floor(Math.max(0, now - activeStart) / 60000) : 0;
  return stored + openBreak;
};

export const normalizeWorkStatus = (status = '') => String(status || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
export const WORK_DONE_STATUSES = new Set(['COMPLETED', 'CLOSED', 'CANCELLED', 'CANCELED', 'ARCHIVED', 'DELETED']);
export const isActiveWorkStatus = (status = '') => !WORK_DONE_STATUSES.has(normalizeWorkStatus(status));

export const getDraftingSessionStart = (project = {}) => (
  toMs(project.draftingResumedAt)
  || toMs(project.currentDraftingStartedAt)
  || toMs(project.draftingStartedAt)
  || toMs(project.workStartedAt)
  || toMs(project.busySinceAt)
  || toMs(project.assignedAt)
  || toMs(project.startedAt)
  || toMs(project.createdAt)
  || 0
);

export const getDraftingElapsedMs = (project = {}, now = Date.now()) => {
  const saved = Math.max(0, Number(project.draftingElapsedMsBeforePause) || Number(project.draftingElapsedMs) || 0);
  if (isDraftingStatus(project.status)) {
    const sessionStart = getDraftingSessionStart(project);
    return saved + (sessionStart ? Math.max(0, toMs(now) - sessionStart) : 0);
  }
  if (isDraftingPausedStatus(project.status)) return saved;
  const completed = toMs(project.draftingCompletedAt) || toMs(project.submittedAt) || toMs(project.completedAt);
  if (completed) return Number(project.draftingFinalElapsedMs) || saved || (toMs(project.draftingStartedAt) ? Math.max(0, completed - toMs(project.draftingStartedAt)) : 0);
  return saved || (toMs(project.draftingStartedAt) ? Math.max(0, toMs(now) - toMs(project.draftingStartedAt)) : 0);
};

export const getTaskBusySince = (project = {}) => getDraftingSessionStart(project);

export const getTaskFinishedAt = (project = {}) => Math.max(
  toMs(project.completedAt),
  toMs(project.draftingCompletedAt),
  toMs(project.submittedAt),
  toMs(project.closedAt),
  toMs(project.reviewedAt),
  toMs(project.finishedAt),
  toMs(project.updatedAt)
);

export const isDraftingStatus = (status = '') => normalizeWorkStatus(status) === 'DRAFTING';
export const isDraftingPausedStatus = (status = '') => normalizeWorkStatus(status) === 'DRAFTINGPAUSED';

export const getUserActiveTasks = (projects = [], userName = '') => (
  (projects || []).filter(project => samePerson(project.assignedTo, userName) && isDraftingStatus(project.status))
);

export const getUserDraftingTask = (projects = [], userName = '') => (
  getUserActiveTasks(projects, userName)
    .slice()
    .sort((a, b) => getTaskBusySince(b) - getTaskBusySince(a))[0] || null
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
  const sessionStart = Math.max(
    toMs(user?.lastLoginAt),
    toMs(user?.loginAt),
    toMs(user?.sessionStartedAt)
  );

  // Free-since must belong to the current online session. Old availabilityUpdatedAt
  // values were causing wrong labels like "Free since 46h" after a fresh login.
  const candidates = [
    toMs(presenceTimes?.[key]?.freeSince),
    getUserLastCompletedAt(projects, userName),
    toMs(user?.freeSinceAt),
    toMs(user?.availableSinceAt),
    toMs(user?.availabilityUpdatedAt)
  ].filter(Boolean);

  const sessionCandidates = sessionStart
    ? candidates.filter(ms => ms >= sessionStart)
    : candidates;

  return sessionCandidates.length ? Math.max(...sessionCandidates) : sessionStart || 0;
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


export const normalizeBreakEvents = (events = [], now = Date.now()) => (
  (Array.isArray(events) ? events : [])
    .map((ev, index) => {
      const start = toMs(ev.start || ev.startAt || ev.breakStartedAt);
      const end = toMs(ev.end || ev.endAt || ev.breakEndedAt);
      if (!start) return null;
      const open = !end;
      const effectiveEnd = end || now;
      const minutes = Math.max(0, Math.floor(Number(ev.minutes || ev.durationMinutes || 0) || ((effectiveEnd - start) / 60000)));
      return {
        ...ev,
        id: ev.id || `break_${start}_${index}`,
        start,
        end: end || null,
        open,
        minutes,
        startTime: ev.startTime || formatClockTimeFromMs(start),
        endTime: ev.endTime || (end ? formatClockTimeFromMs(end) : ''),
        label: open ? `${formatClockTimeFromMs(start)} → Live` : `${formatClockTimeFromMs(start)} → ${formatClockTimeFromMs(end)}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.start - a.start)
);

export const getOpenBreakEvent = (events = [], now = Date.now()) => normalizeBreakEvents(events, now).find(ev => ev.open) || null;


export const buildAttendanceEngineV3 = ({ attendanceLogs = [], users = [], projects = [], dateKey = localDateKeyFromMs(Date.now()), now = Date.now() } = {}) => {
  const operationalUsers = (Array.isArray(users) ? users : [])
    .filter(user => user && String(user.status || 'APPROVED').toUpperCase() === 'APPROVED')
    .filter(user => normalizeRole(user.role) !== PRESENCE_ROLES.ADMIN);
  const safeLogs = Array.isArray(attendanceLogs) ? attendanceLogs : [];

  const findLogForUser = (user) => safeLogs
    .filter(log => log && log.date === dateKey && (String(log.userId || '') === String(user.id || '') || samePerson(log.name, user.name)))
    .sort((a, b) => Math.max(toMs(b.lastTick), toMs(b.logoutAt), toMs(b.updatedAt), toMs(b.loginAt), toMs(b.firstLoginAt)) - Math.max(toMs(a.lastTick), toMs(a.logoutAt), toMs(a.updatedAt), toMs(a.loginAt), toMs(a.firstLoginAt)))[0] || null;

  const rows = operationalUsers.map(user => {
    const log = findLogForUser(user);
    const baseBreakEvents = Array.isArray(log?.breakEvents) ? log.breakEvents : [];
    const inferredBreakStart = ((dateKey === localDateKeyFromMs(now) && String(user.availability || '').toLowerCase() === 'break') ? (user.currentBreakStartedAt || user.breakStartedAt || user.availabilityProfile?.breakStartedAt || null) : null);
    const openBreakExists = baseBreakEvents.some(ev => ev && (ev.start || ev.startAt) && !(ev.end || ev.endAt));
    const rowBase = {
      ...(log || {}),
      id: log?.id || `${user.id || identityKey(user.name)}_${dateKey}_empty`,
      userId: user.id,
      name: user.name,
      role: normalizeRole(user.role),
      date: dateKey,
      breakEvents: inferredBreakStart && !openBreakExists ? [...baseBreakEvents, { start: inferredBreakStart, startTime: formatClockTimeFromMs(inferredBreakStart) }] : baseBreakEvents,
      currentBreakStartedAt: log?.currentBreakStartedAt || inferredBreakStart,
    };

    const session = deriveAttendanceSession(rowBase, user, now);
    const hasLogin = !!session.start;
    const isToday = dateKey === localDateKeyFromMs(now);
    const latestPresenceMs = Math.max(toMs(user.lastHeartbeatAt), toMs(user.lastSeenAt), toMs(rowBase.lastTick), toMs(rowBase.logoutAt));
    const freshPresence = isToday && !!latestPresenceMs && (now - latestPresenceMs) <= ONLINE_STALE_MS;
    const onlineNow = isToday && hasLogin && (isPresenceUserOnline(user, now) || (!!rowBase.isOnline && freshPresence));
    const onBreak = onlineNow && (String(user.availability || rowBase.status || '').toLowerCase().includes('break') || !!rowBase.currentBreakStartedAt);
    const activeTasks = getUserActiveTasks(projects, user.name || rowBase.name);
    const taskBusyMinutes = getAttendanceActiveTaskMinutes(rowBase, user, projects, now);
    const savedProductiveCandidates = [
      rowBase.productiveMinutes,
      rowBase.productiveMinutesV3,
      rowBase.taskBusyMinutes,
      rowBase.activeTaskMinutes,
      rowBase.activeMinutes,
    ].map(v => Math.max(0, Math.floor(Number(v) || 0))).filter(Number.isFinite);

    const totalLoggedInMinutes = Math.max(
      0,
      Math.floor(Number(rowBase.totalLoggedInMinutes) || 0),
      session.totalLoggedInMinutes
    );
    const breakEvents = normalizeBreakEvents(rowBase.breakEvents, now);
    const openBreak = getOpenBreakEvent(breakEvents, now);
    const eventBreakMinutes = breakEvents.reduce((sum, ev) => sum + Math.max(0, Number(ev.minutes) || 0), 0);
    const breakMinutes = Math.max(0, Math.min(totalLoggedInMinutes, Math.max(session.breakMinutes, eventBreakMinutes)));
    // V3 rule: each daily counter is monotonic. The UI may reconstruct a lower
    // value while projects/presence are still loading, but it must never erase a
    // higher valid value already saved for the same user/day.
    const rawProductive = Math.max(0, taskBusyMinutes, ...savedProductiveCandidates);
    const productiveMinutes = Math.max(0, Math.min(rawProductive, totalLoggedInMinutes));
    const idleMinutes = Math.max(0, totalLoggedInMinutes - productiveMinutes - breakMinutes);
    const productivePct = totalLoggedInMinutes > 0 ? Math.min(100, Math.round((productiveMinutes / totalLoggedInMinutes) * 100)) : 0;
    const working = onlineNow && !onBreak && (activeTasks.length > 0 || productivePct >= 90 && productiveMinutes > 0);
    const status = onBreak ? 'On Break' : working ? 'Working' : onlineNow ? 'Online / Idle' : hasLogin ? 'Offline' : 'No Login';
    const lastSeenMs = onlineNow ? latestPresenceMs : (session.lastSeenMs || latestPresenceMs || 0);
    const lastSeen = onlineNow ? 'Live now' : (lastSeenMs && lastSeenMs > session.start ? formatClockTimeFromMs(lastSeenMs) : (hasLogin ? 'Offline' : 'No login today'));
    const alert = !hasLogin
      ? 'No login record'
      : (!onlineNow && isToday ? 'Heartbeat stale' : (totalLoggedInMinutes >= 60 && productiveMinutes === 0 ? 'No productive time recorded' : (idleMinutes >= 30 ? `${idleMinutes}m idle` : 'Stable')));

    return {
      ...rowBase,
      user,
      session,
      loginTime: getAttendanceFirstLoginLabel(rowBase, user),
      firstLoginLabel: getAttendanceFirstLoginLabel(rowBase, user),
      totalLoggedInMinutes,
      productiveMinutes,
      taskMinutes: productiveMinutes,
      activeMinutes: productiveMinutes,
      breakMinutes,
      breakEvents,
      breakCount: breakEvents.length,
      openBreak,
      lastBreak: breakEvents[0] || null,
      idleMinutes,
      productivePct,
      onlineNow,
      onBreak,
      activeTasks,
      status,
      lastSeen,
      lastSeenMs,
      alert,
      source: 'attendance-engine-v3'
    };
  }).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const summary = rows.reduce((acc, row) => {
    acc.present += row.session.start ? 1 : 0;
    acc.online += row.onlineNow ? 1 : 0;
    acc.working += row.status === 'Working' ? 1 : 0;
    acc.onBreak += row.onBreak ? 1 : 0;
    acc.totalLogged += row.totalLoggedInMinutes;
    acc.totalActive += row.productiveMinutes;
    acc.totalBreak += row.breakMinutes;
    return acc;
  }, { present: 0, online: 0, working: 0, onBreak: 0, totalLogged: 0, totalActive: 0, totalBreak: 0 });

  const mostProductive = rows.slice().sort((a, b) => b.productiveMinutes - a.productiveMinutes)[0] || null;
  return { rows, summary, mostProductive, dateKey, source: 'attendance-engine-v3' };
};
