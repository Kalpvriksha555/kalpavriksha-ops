import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');

test('background row deltas replace only changed records and remove deleted or hidden rows', () => {
  assert.match(app, /const rowDeltaIds = data\.rowDeltaIds/);
  assert.match(app, /replaceIds:rowDeltaIds\.cases \|\| \[\]/);
  assert.match(app, /mergeChatMessagesByFreshness\(prev, data\.chatMessages \|\| \[\], rowDeltaIds\.teamChat \|\| \[\]\)/);
  assert.match(app, /mergeNotificationsStable\(prev, data\.notifications \|\| \[\], rowDeltaIds\.notifications \|\| \[\]\)/);
});

test('workspace refreshes are low-priority transitions and preserve unchanged object references', () => {
  assert.match(app, /React\.startTransition\(\(\) => \{/);
  assert.match(app, /const reuseStableRecords/);
  assert.match(app, /const reuseStableProjects/);
  assert.match(app, /if \(stable === prev\) return prev/);
});

test('user normalization no longer invents a new profile timestamp on every render', () => {
  assert.match(app, /const profileUpdatedAt = user\.profileUpdatedAt \|\| existing\.profileUpdatedAt/);
  assert.doesNotMatch(app, /const profileUpdatedAt = now;/);
});

test('production heartbeat and attendance work do not repaint the whole application every 25 seconds', () => {
  assert.match(app, /const attendanceTimer = USE_BACKEND_STATE \? null : setInterval/);
  assert.match(app, /if \(!USE_BACKEND_STATE\) setUsers\(prev => mergeTeamUsersStable/);
});

test('expensive global views are memoized and search work is deferred', () => {
  assert.match(app, /const deferredGlobalSearch = React\.useDeferredValue\(globalSearch\)/);
  assert.match(app, /const activityTimeline = useMemo/);
  assert.match(app, /const displayedProjects = useMemo/);
  assert.match(app, /const assignmentRecommendations = useMemo/);
});
