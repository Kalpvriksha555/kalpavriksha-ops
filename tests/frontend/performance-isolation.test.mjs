import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  invalidateFinanceOutboxStorageCache,
  queueFinanceDraft,
} from '../../frontend/src/services/financeOutboxService.js';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const commandCentre = fs.readFileSync(new URL('../../frontend/src/components/command-centre/CommandCentreView.jsx', import.meta.url), 'utf8');
const operations = fs.readFileSync(new URL('../../frontend/src/components/operations/ActiveOperationsView.jsx', import.meta.url), 'utf8');
const financeOutbox = fs.readFileSync(new URL('../../frontend/src/services/financeOutboxService.js', import.meta.url), 'utf8');
const communicationHub = fs.readFileSync(new URL('../../frontend/src/components/chat/CommunicationHub.jsx', import.meta.url), 'utf8');
const meetingRoom = fs.readFileSync(new URL('../../frontend/src/components/meetings/TeamMeetingRoom.jsx', import.meta.url), 'utf8');

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
  clear() { this.data.clear(); }
}

test('assignment reconciliation is parsed once and committed once per project batch', () => {
  assert.match(app, /let assignmentLedgerCache = null/);
  assert.match(app, /const recordAssignmentLedgerBatch = \(projects = \[\]\)/);
  assert.match(app, /const ledger = recordAssignmentLedgerBatch\(merged\)/);
  assert.doesNotMatch(app, /map\(applyAssignmentLedgerToProject\)/);
  const mergeStart = app.indexOf('const mergeProjectRecordSafely');
  const mergeEnd = app.indexOf('const mergeProjectsByFreshness', mergeStart);
  assert.doesNotMatch(app.slice(mergeStart, mergeEnd), /recordAssignmentLedger/);
});

test('finance outbox reuses its parsed mirrored generation between edits', () => {
  assert.match(financeOutbox, /let cachedEnvelope = null/);
  assert.match(financeOutbox, /primaryRaw === cachedPrimaryRaw && backupRaw === cachedBackupRaw/);
  assert.match(financeOutbox, /invalidateFinanceOutboxStorageCache/);

  globalThis.localStorage = new MemoryStorage();
  globalThis.window = { dispatchEvent() {} };
  invalidateFinanceOutboxStorageCache();
  const user = { id:'admin-cache', name:'Admin' };
  queueFinanceDraft({ project:{ id:'CASE-CACHE', financeVersion:0 }, draft:{ estimate:'100', amountIn:'10' }, user });

  const originalParse = JSON.parse;
  let parses = 0;
  JSON.parse = (...args) => { parses += 1; return originalParse(...args); };
  try {
    queueFinanceDraft({ project:{ id:'CASE-CACHE', financeVersion:0 }, draft:{ estimate:'100', amountIn:'20' }, user });
  } finally {
    JSON.parse = originalParse;
  }
  assert.equal(parses, 0, 'a same-tab edit should not reparse both complete outbox mirrors');
});

test('large browser cache cleanup is deferred and skipped in production backend mode', () => {
  assert.doesNotMatch(app, /compactLargeLocalStoragePayloads\(\);\s*\n\s*let lastProjectsBroadcastAt/);
  assert.match(app, /if \(USE_BACKEND_STATE\) return undefined;[\s\S]*requestIdleCallback\(compact/);
});

test('idle finance synchronization stays read-only and does not repaint the application every fifteen seconds', () => {
  assert.match(app, /if \(!records\.length\) return false/);
  assert.match(app, /const timer = setInterval\(flush, 15000\)/);
  assert.doesNotMatch(app, /setFinanceSyncRevision/);
  assert.doesNotMatch(app, /financeSyncSnapshot\.total/);
});

test('backend project synchronization sends row deltas and never reads stale task caches', () => {
  assert.match(app, /Array\.isArray\(options\?\.changedProjects\)/);
  assert.match(app, /changedProjects:projectsToSave/);
  assert.match(app, /removedProjectIds:deleteIds/);
  assert.match(app, /replaceIds:options\?\.replaceIds \|\| \[\]/);
  assert.match(app, /if \(USE_BACKEND_STATE\) \{\s*void refreshWorkspaceSnapshot\(\)/s);
  assert.match(app, /if \(!opsBroadcast\)/);
});

test('operations timer and command-centre business scans are isolated and memoized', () => {
  assert.match(operations, /const \[nowTick, setNowTick\] = useState\(Date\.now\(\)\)/);
  assert.doesNotMatch(app, /const \[nowTick, setNowTick\]/);
  assert.match(commandCentre, /const metrics = useMemo\(\(\) => getTodayMetrics/);
  assert.match(commandCentre, /const activeTasksByPerson = useMemo/);
  assert.match(commandCentre, /const latestAttendanceByPerson = useMemo/);
  assert.match(commandCentre, /const workloadStatsByPerson = useMemo/);
  assert.match(commandCentre, /const memberRows = useMemo\(\(\) => activeTeam\.map/);
  assert.match(commandCentre, /const activityDayKey = formatDateKey\(availabilityNow\)/);
  assert.match(commandCentre, /formatDateKey\(item\.at\) === todayKey/);
});


test('closed chat and inactive meetings do not run one-second repaint loops', () => {
  assert.match(communicationHub, /if \(!isOpen \|\| !isCalling \|\| !callStartedAt/);
  assert.match(communicationHub, /if \(!isOpen \|\| !isRecordingVoice/);
  assert.match(communicationHub, /if \(!isOpen \|\| typeof document === 'undefined'\) return undefined/);
  assert.match(communicationHub, /const unreadMessages = React\.useMemo/);
  assert.match(communicationHub, /const unreadSummary = React\.useMemo/);
  assert.match(communicationHub, /const channelMessages = React\.useMemo/);
  assert.match(communicationHub, /if \(!isOpen\) return \[\]/);
  assert.doesNotMatch(communicationHub, /chatUsers\.reduce\(\(sum, u\) => sum \+ getDirectUnreadCountForUser/);
  assert.match(communicationHub, /URL\.revokeObjectURL\(previewUrl\)/);
  assert.doesNotMatch(communicationHub, /setInterval\(\(\) => setCallNow\(Date\.now\(\)\), 1000\)/);
  assert.match(meetingRoom, /if \(!meetingStartedAt \|\| typeof document === 'undefined'\) return undefined/);
  assert.doesNotMatch(meetingRoom, /setInterval\(\(\) => setMeetingNow\(Date\.now\(\)\), 1000\)/);
});
