import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applyPresenceClientCommandMetadata,
  classifyPresenceClientCommand,
  computeAttendanceAccrual,
  normalizePresenceClientCommand,
  parseIndiaAttendanceClock,
} from '../../backend/src/services/presenceProtocolService.js';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');

test('India attendance clock parser is independent of VPS/server timezone', () => {
  assert.equal(parseIndiaAttendanceClock('2026-08-10', '01:06 PM'), Date.parse('2026-08-10T13:06:00+05:30'));
  assert.equal(parseIndiaAttendanceClock('2026-08-10', '15:21'), Date.parse('2026-08-10T15:21:00+05:30'));
  assert.equal(parseIndiaAttendanceClock('2026-08-10', '25:00'), 0);
});

test('presence client commands reject out-of-order and old-epoch actions', () => {
  const user = { presenceClientEpoch:'tab-a', presenceClientSequence:7 };
  const stale = classifyPresenceClientCommand(user, 'break', normalizePresenceClientCommand({clientPresenceEpoch:'tab-a', clientPresenceSequence:6}));
  assert.equal(stale.stale, true);
  const oldEpoch = classifyPresenceClientCommand(user, 'resume', normalizePresenceClientCommand({clientPresenceEpoch:'tab-b', clientPresenceSequence:1}));
  assert.equal(oldEpoch.epochMismatch, true);
  const login = classifyPresenceClientCommand(user, 'login', normalizePresenceClientCommand({clientPresenceEpoch:'tab-b', clientPresenceSequence:1}));
  assert.equal(login.accept, true);
  assert.equal(login.newEpoch, true);
});

test('accepted presence command metadata advances monotonically on the stored user', () => {
  const user = {};
  const command = normalizePresenceClientCommand({clientPresenceEpoch:'epoch-1', clientPresenceSequence:3});
  applyPresenceClientCommandMetadata(user, command);
  assert.equal(user.presenceClientEpoch, 'epoch-1');
  assert.equal(user.presenceClientSequence, 3);
});

test('attendance accrual preserves sub-minute remainder and refuses long suspended gaps', () => {
  const short = computeAttendanceAccrual({lastTick:1_000_000, nowMs:1_059_000, remainderMs:30_000, maxGapMs:600_000});
  assert.equal(short.wholeMinutes, 1);
  assert.equal(short.remainderMs, 29_000);
  const long = computeAttendanceAccrual({lastTick:1_000_000, nowMs:1_900_000, remainderMs:30_000, maxGapMs:600_000});
  assert.equal(long.wholeMinutes, 0);
  assert.equal(long.remainderMs, 0);
  assert.equal(long.ignoredGapMinutes, 15);
});

test('server heartbeat is liveness-only and cannot overwrite break/resume availability', () => {
  assert.match(server, /Heartbeats are liveness-only/);
  assert.match(server, /action === 'heartbeat'[\s\S]{0,800}authoritativeAvailability/);
  assert.match(server, /normalizePresenceClientCommand\(body\)/);
  assert.match(server, /PRESENCE_CLIENT_EPOCH_STALE/);
  assert.match(server, /staleClientSequence:true/);
});

test('server attendance uses bounded gap accrual and daily rows do not inherit yesterday login', () => {
  assert.match(server, /PRESENCE_ATTENDANCE_MAX_GAP_MS/);
  assert.match(server, /computeAttendanceAccrual\(/);
  assert.match(server, /const loginAt = toMs\(existing\?\.loginAt\) \|\| toMs\(existing\?\.firstLoginAt\) \|\| nowMs/);
  assert.match(server, /presenceSource: 'backend-heartbeat-v4'/);
  assert.match(server, /attendanceAccrualRemainderMs/);
  assert.match(server, /presenceGapMinutes/);
  assert.match(server, /ev\.minutes = Math\.max\(0, Math\.floor\(\(Number\.isFinite\(savedMinutes\) \? savedMinutes : 0\) \+ elapsed\)\)/);
  assert.doesNotMatch(server, /ev\.minutes = Math\.floor\(Math\.max\(0, nowMs - Number\(ev\.start\)\) \/ 60000\)/);
});
