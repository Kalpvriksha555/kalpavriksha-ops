import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../../frontend/src/services/authService.js', import.meta.url), 'utf8');
const tasks = fs.readFileSync(new URL('../../frontend/src/services/taskService.js', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../../frontend/src/components/command-centre/CommandCentreView.jsx', import.meta.url), 'utf8');

test('refresh does not restore authentication or persist CSRF credentials', () => {
  assert.match(app, /clearBrowserSessionApi\(\)/);
  assert.doesNotMatch(app, /getSessionApi\(\)/);
  assert.match(auth, /window\.localStorage\.removeItem\(CSRF_STORAGE_KEY\)/);
  assert.doesNotMatch(auth, /localStorage\.setItem\(CSRF_STORAGE_KEY/);
  assert.match(auth, /clear-browser-session[\s\S]*timeoutMs: 8_000/);
});

test('workspace hydration stays lightweight and performance loads only on the analytics page', () => {
  assert.match(tasks, /compact: compact \? '1' : '0'/);
  assert.match(tasks, /performance: includePerformance \? '1' : '0'/);
  assert.doesNotMatch(app, /includePerformance:true, compact:true/);
  assert.match(app, /includePerformance:false, compact:true/);
  assert.match(dashboard, /\/api\/performance\/leaderboard\?\$\{query\}/);
  assert.match(dashboard, /scope=custom&from=\$\{encodeURIComponent\(dateRange\.dateFrom\)\}&to=\$\{encodeURIComponent\(dateRange\.dateTo\)\}/);
  assert.match(dashboard, /range=\$\{encodeURIComponent\(range\)\}/);
});

test('adaptive sync uses data and presence revisions to avoid full unchanged workspace downloads', () => {
  assert.match(tasks, /sinceDataRevision/);
  assert.match(tasks, /sincePresence/);
  assert.match(app, /workspaceDataRevisionRef/);
  assert.match(app, /if \(data\.unchanged\) return/);
  assert.match(app, /data\.partial === 'presence'/);
});

test('designer analytics merge aggregate leaderboard members for team comparison', () => {
  assert.match(dashboard, /leaderboardMembers/);
  assert.match(dashboard, /leaderboardByName/);
  assert.match(dashboard, /assignedCount/);
  assert.match(dashboard, /approved team for transparent comparison/);
});

test('production backend mode avoids repeated full workspace localStorage serialization', () => {
  assert.match(app, /persistCache = !USE_BACKEND_STATE/);
  assert.match(app, /if \(USE_BACKEND_STATE\) \{\s*broadcastProjectsSync\(normalized\);\s*return normalized;/s);
  assert.match(app, /if \(!USE_BACKEND_STATE\).*kalpa_chats/s);
});

test('global live clock pauses on non-operational screens', () => {
  assert.match(app, /const nonLiveTabs = new Set/);
  assert.match(app, /if \(selectedProject \|\| nonLiveTabs\.has\(activeTab\)\) return undefined/);
});

test('manual performance rebuild refreshes the range-specific team leaderboard', () => {
  assert.match(dashboard, /leaderboardRefreshKey/);
  assert.match(dashboard, /\[range, dateRange\.dateFrom, dateRange\.dateTo, leaderboardRefreshKey\]/);
  assert.match(dashboard, /setLeaderboardRefreshKey\(value => value \+ 1\)/);
});

test('adaptive sync carries collection revisions so chat-only changes avoid full project downloads', () => {
  assert.match(tasks, /sinceCollections/);
  assert.match(tasks, /JSON\.stringify\(sinceCollections\)/);
  assert.match(app, /workspaceCollectionRevisionsRef/);
  assert.match(app, /sinceCollections:workspaceCollectionRevisionsRef\.current/);
});


test('unavailable or stale server leaderboard cannot restore pre-reset scorecards', () => {
  assert.match(dashboard, /resolvedLeaderboardQuery === leaderboardQueryKey/);
  assert.match(dashboard, /setResolvedLeaderboardQuery\(leaderboardQueryKey\)/);
  assert.match(dashboard, /setLeaderboard\(null\);\s*setResolvedLeaderboardQuery\(''\);/);
  assert.match(dashboard, /if \(!backendLeaderboardReady\) return \(/);
  assert.match(dashboard, /Loading verified scores and average completion times for this period/);
});
