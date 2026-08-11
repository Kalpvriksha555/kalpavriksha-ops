import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const findings = [];
const requirePattern = (file, pattern, message) => {
  const source = read(file);
  if (!pattern.test(source)) findings.push({ file, message, pattern:String(pattern) });
};
const forbidPattern = (file, pattern, message) => {
  const source = read(file);
  if (pattern.test(source)) findings.push({ file, message, pattern:String(pattern) });
};

for (const file of [
  'backend/src/services/presenceProtocolService.js',
  'backend/src/server.js',
  'frontend/src/config/presenceConfig.js',
  'frontend/src/config/appConfig.js',
  'frontend/src/App.jsx',
  'frontend/src/utils/presenceAttendanceUtils.js',
  'frontend/src/utils/chatUtils.js',
  'tests/backend/phase16-presence-attendance-closure.test.mjs',
  'tests/frontend/phase16-presence-attendance-closure.test.mjs'
]) {
  if (!fs.existsSync(path.join(root, file))) findings.push({ file, message:'Required Phase 16 source/test file is missing.' });
}

// One canonical heartbeat/staleness contract across browser consumers.
requirePattern('frontend/src/config/presenceConfig.js',/ONLINE_STALE_MS = 2 \* 60 \* 1000/,'Browser presence stale threshold must be two minutes.');
requirePattern('frontend/src/config/presenceConfig.js',/PRESENCE_HEARTBEAT_MS = 60 \* 1000/,'Browser heartbeat cadence must be one minute.');
requirePattern('frontend/src/config/presenceConfig.js',/ATTENDANCE_MAX_LIVE_GAP_MINUTES = 10/,'Browser attendance live-tail cap must remain ten minutes.');
requirePattern('frontend/src/config/appConfig.js',/export \{ ONLINE_STALE_MS, PRESENCE_HEARTBEAT_MS \}/,'App config must re-export the canonical presence threshold/cadence.');
requirePattern('frontend/src/utils/chatUtils.js',/presenceConfig\.js/,'Chat presence must consume the canonical presence threshold.');
requirePattern('frontend/src/utils/presenceAttendanceUtils.js',/ATTENDANCE_MAX_LIVE_GAP_MINUTES, ONLINE_STALE_MS/,'Attendance presence must consume the canonical presence contract.');
requirePattern('frontend/src/App.jsx',/setInterval\(sendHeartbeat, PRESENCE_HEARTBEAT_MS\)/,'App heartbeat timer must use the canonical cadence rather than a duplicated literal.');
requirePattern('backend/src/server.js',/PRESENCE_STALE_MS', 2 \* 60 \* 1000/,'Backend presence stale default must match the browser two-minute threshold.');
requirePattern('backend/src/server.js',/PRESENCE_ATTENDANCE_MAX_GAP_MS', 10 \* 60 \* 1000/,'Backend attendance gap cap must default to ten minutes.');

// Presence commands are ordered per browser epoch so late Break/Resume/heartbeat
// traffic cannot overwrite a newer action.
requirePattern('backend/src/services/presenceProtocolService.js',/normalizePresenceClientCommand/,'Presence command normalizer is missing.');
requirePattern('backend/src/services/presenceProtocolService.js',/command\.sequence <= storedSequence/,'Presence command ordering must reject stale or replayed sequence numbers.');
requirePattern('backend/src/services/presenceProtocolService.js',/action \|\| ''\)\.toLowerCase\(\) === 'login'/,'Only login may establish a new browser presence epoch.');
requirePattern('backend/src/server.js',/const presenceCommand = normalizePresenceClientCommand\(body\)/,'Presence endpoint must normalize the browser command identity.');
requirePattern('backend/src/server.js',/PRESENCE_CLIENT_EPOCH_STALE/,'Old presence epochs must fail closed explicitly.');
requirePattern('backend/src/server.js',/staleClientSequence:true/,'Replayed/out-of-order presence commands must return an idempotent stale-sequence acknowledgement.');
requirePattern('frontend/src/App.jsx',/presenceClientEpochRef = useRef/,'Each browser page needs a presence epoch.');
requirePattern('frontend/src/App.jsx',/clientPresenceSequence = \+\+presenceClientSequenceRef\.current/,'Each presence mutation needs a monotonic page sequence.');
requirePattern('frontend/src/App.jsx',/body: JSON\.stringify\(\{ action, user: identity, clientPresenceEpoch, clientPresenceSequence \}\)/,'Browser presence requests must carry epoch and sequence.');

// Heartbeats are liveness-only: they may never undo a later Break/Resume state.
requirePattern('backend/src/server.js',/Heartbeats are liveness-only/,'Heartbeat liveness-only invariant is missing.');
requirePattern('backend/src/server.js',/action === 'heartbeat'[\s\S]{0,900}authoritativeAvailability/,'Heartbeat must preserve authoritative availability/break state.');
forbidPattern('frontend/src/App.jsx',/prevOnlineFresh/,'Frontend must not preserve an older local online state over a newer authoritative server snapshot.');
forbidPattern('frontend/src/App.jsx',/incomingStaleOffline/,'Frontend must not reinterpret authoritative server offline rows through the old stale-offline override.');

// Attendance is India-date keyed and is accrued from bounded heartbeat deltas,
// never from unbounded login-to-now wall-clock time.
requirePattern('backend/src/services/presenceProtocolService.js',/\+05:30/,'Backend attendance clock parsing must be explicit India time.');
requirePattern('backend/src/services/presenceProtocolService.js',/elapsedMs > Math\.max\(60_000, Number\(maxGapMs\)/,'Long disconnected/suspended gaps must be excluded from attendance accrual.');
requirePattern('backend/src/services/presenceProtocolService.js',/remainderMs:totalMs % 60_000/,'Sub-minute heartbeat remainder must be preserved instead of lost each minute.');
requirePattern('backend/src/server.js',/const loginAt = toMs\(existing\?\.loginAt\) \|\| toMs\(existing\?\.firstLoginAt\) \|\| nowMs/,'A new India-day attendance row must not inherit yesterday\'s login timestamp.');
requirePattern('backend/src/server.js',/attendanceAccrualRemainderMs/,'Attendance rows must persist sub-minute remainder state.');
requirePattern('backend/src/server.js',/presenceGapMinutes/,'Ignored presence-gap diagnostics must remain visible in attendance rows.');
requirePattern('backend/src/server.js',/presenceSource: 'backend-heartbeat-v4'/,'Phase 16 backend-owned attendance rows must be explicitly versioned.');
requirePattern('frontend/src/App.jsx',/const today = getIndiaDateKey\(\)/,'Attendance browser rows must use the India calendar date.');
requirePattern('frontend/src/App.jsx',/if \(!USE_BACKEND_STATE\) updateTodayAttendance/,'Production/backend mode must keep attendance counters server-owned.');
requirePattern('frontend/src/utils/presenceAttendanceUtils.js',/backendPresence \? \(savedTotal \+ liveDelta\)/,'Backend attendance display must trust persisted counters plus only a bounded live tail.');

// Break events use bounded accrued minutes as well. A wall-clock start/end cannot
// resurrect an ignored laptop-sleep/network gap during Resume.
requirePattern('backend/src/server.js',/Break-event minutes are accumulated from the same bounded heartbeat delta/,'Break-event bounded accrual invariant is missing.');
requirePattern('backend/src/server.js',/ev\.minutes = Math\.max\(0, Math\.floor\(\(Number\.isFinite\(savedMinutes\) \? savedMinutes : 0\) \+ elapsed\)\)/,'Open break events must accrue the bounded heartbeat delta.');
forbidPattern('backend/src/server.js',/ev\.minutes = Math\.floor\(Math\.max\(0, nowMs - Number\(ev\.start\)\) \/ 60000\)/,'Completed backend break events must not be recomputed from raw wall-clock duration.');
requirePattern('frontend/src/utils/presenceAttendanceUtils.js',/backendPresence[\s\S]{0,1100}lastAccruedAt/,'Frontend break totals must respect backend accrued break-event minutes.');
requirePattern('tests/frontend/phase16-presence-attendance-closure.test.mjs',/backend-v4 open break ignores a long disconnected wall-clock gap/,'Regression coverage for long-gap break inflation is missing.');

// Backend activeMinutes is online/non-break time, not task productivity.
requirePattern('tests/frontend/phase16-presence-attendance-closure.test.mjs',/activeMinutes are not misreported as productive task minutes/,'Regression coverage for attendance productivity inflation is missing.');
requirePattern('frontend/src/utils/presenceAttendanceUtils.js',/backendPresenceRow = \/\^backend-heartbeat-v/,'Attendance engine must distinguish backend-owned presence rows.');

// Permanent release wiring.
requirePattern('package.json',/"verify:presence-attendance"\s*:\s*"node scripts\/phase-16-attendance-presence-live-sync-check\.mjs"/,'Phase 16 verifier is not registered in package.json.');
requirePattern('package.json',/npm run verify:session-isolation && npm run verify:presence-attendance/,'Phase 16 verifier must run after Phase 15 in the normal verification chain.');
requirePattern('scripts/full-release-verifier-matrix.mjs',/id:'attendance-presence-live-sync'[\s\S]*phase-16-attendance-presence-live-sync-check\.mjs/,'Phase 16 verifier is not part of the full release matrix.');

if (findings.length) {
  console.error(`Phase 16 attendance/presence/live-sync closure FAILED with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.message}`);
  process.exit(1);
}
console.log('Phase 16 attendance/presence/live-sync closure PASS (ordered commands, liveness-only heartbeat, bounded India-time accrual and break-gap protection present).');
