import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildAttendanceEngineV3,
  deriveAttendanceSession,
  getBreakMinutesFromLog,
  isPresenceUserOnline,
} from '../../frontend/src/utils/presenceAttendanceUtils.js';
import { ONLINE_STALE_MS, PRESENCE_HEARTBEAT_MS } from '../../frontend/src/config/presenceConfig.js';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const appConfig = fs.readFileSync(new URL('../../frontend/src/config/appConfig.js', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../../frontend/src/utils/chatUtils.js', import.meta.url), 'utf8');
const attendance = fs.readFileSync(new URL('../../frontend/src/utils/presenceAttendanceUtils.js', import.meta.url), 'utf8');

test('all browser presence consumers share one two-minute stale threshold with a one-minute heartbeat', () => {
  assert.equal(PRESENCE_HEARTBEAT_MS, 60_000);
  assert.equal(ONLINE_STALE_MS, 120_000);
  assert.match(appConfig, /export \{ ONLINE_STALE_MS, PRESENCE_HEARTBEAT_MS \}/);
  assert.match(chat, /presenceConfig\.js/);
  assert.match(attendance, /presenceConfig\.js/);
  assert.match(app, /setInterval\(sendHeartbeat, PRESENCE_HEARTBEAT_MS\)/);
});

test('presence online classification goes stale consistently after the shared threshold', () => {
  const now = 2_000_000;
  assert.equal(isPresenceUserOnline({isOnline:true,lastHeartbeatAt:now - ONLINE_STALE_MS + 1}, now), true);
  assert.equal(isPresenceUserOnline({isOnline:true,lastHeartbeatAt:now - ONLINE_STALE_MS - 1}, now), false);
});

test('open break time is not double-counted on top of server accrued break minutes', () => {
  const now = Date.parse('2026-08-10T10:10:00+05:30');
  const start = Date.parse('2026-08-10T10:00:00+05:30');
  const lastTick = Date.parse('2026-08-10T10:05:00+05:30');
  const minutes = getBreakMinutesFromLog({
    totalBreakMinutes:5,
    currentBreakStartedAt:start,
    lastTick,
    breakEvents:[{start}]
  }, now, {availability:'Break',breakStartedAt:start});
  assert.equal(minutes, 10);
});


test('backend-v4 open break ignores a long disconnected wall-clock gap', () => {
  const now = Date.parse('2026-08-10T13:00:00+05:30');
  const lastTick = Date.parse('2026-08-10T10:05:00+05:30');
  const start = Date.parse('2026-08-10T10:00:00+05:30');
  const minutes = getBreakMinutesFromLog({
    totalBreakMinutes:5,
    currentBreakStartedAt:start,
    lastTick,
    presenceSource:'backend-heartbeat-v4',
    breakEvents:[{start,minutes:5,lastAccruedAt:lastTick}]
  }, now, {availability:'Break',breakStartedAt:start});
  assert.equal(minutes, 5);
});

test('backend attendance rows do not inflate a long suspended gap after heartbeat resumes', () => {
  const now = Date.parse('2026-08-10T13:00:00+05:30');
  const session = deriveAttendanceSession({
    date:'2026-08-10',
    loginAt:Date.parse('2026-08-10T09:00:00+05:30'),
    totalLoggedInMinutes:60,
    activeMinutes:55,
    totalBreakMinutes:5,
    lastTick:now - 5 * 60_000,
    presenceSource:'backend-heartbeat-v4'
  }, {isOnline:true,lastHeartbeatAt:now,availability:'Available'}, now);
  assert.equal(session.totalLoggedInMinutes, 65);
});

test('backend non-break activeMinutes are not misreported as productive task minutes', () => {
  const now = Date.parse('2026-08-10T11:00:00+05:30');
  const user = {id:'u1',name:'Designer One',role:'Designer',status:'APPROVED',isOnline:false,lastSeenAt:now - 1};
  const row = buildAttendanceEngineV3({
    users:[user],
    projects:[],
    dateKey:'2026-08-10',
    now,
    attendanceLogs:[{
      id:'u1_2026-08-10', userId:'u1', name:'Designer One', role:'Designer', date:'2026-08-10',
      loginAt:Date.parse('2026-08-10T10:00:00+05:30'), lastTick:now, logoutAt:now,
      totalLoggedInMinutes:60, activeMinutes:60, totalBreakMinutes:0, presenceSource:'backend-heartbeat-v4'
    }]
  }).rows[0];
  assert.equal(row.productiveMinutes, 0);
  assert.equal(row.idleMinutes, 60);
});

test('frontend sends ordered presence commands and trusts newer authoritative offline state', () => {
  assert.match(app, /clientPresenceSequence = \+\+presenceClientSequenceRef\.current/);
  assert.match(app, /clientPresenceEpoch, clientPresenceSequence/);
  assert.doesNotMatch(app, /prevOnlineFresh/);
  assert.doesNotMatch(app, /incomingStaleOffline/);
});

test('backend mode keeps attendance counters server-owned and India-date keyed', () => {
  assert.match(app, /if \(!USE_BACKEND_STATE\) updateTodayAttendance/);
  assert.match(app, /const today = getIndiaDateKey\(\)/);
  assert.match(app, /const todayKey = getIndiaDateKey\(nowMs\)/);
});
