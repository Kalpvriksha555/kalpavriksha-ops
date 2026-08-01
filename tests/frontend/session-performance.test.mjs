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
  assert.match(dashboard, /\/api\/performance\/leaderboard\?\$\{params\.toString\(\)\}/);
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
  assert.match(dashboard, /Designers see aggregate team metrics/);
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

test('manual performance rebuild refreshes the selected monthly or overall leaderboard', () => {
  assert.match(dashboard, /leaderboardRefreshKey/);
  assert.match(dashboard, /\[scope, performanceMonth, leaderboardRefreshKey\]/);
  assert.match(dashboard, /setLeaderboardRefreshKey\(value => value \+ 1\)/);
});

test('performance analytics offers exact monthly and overall scopes with admin baselines', () => {
  assert.match(dashboard, /setScope\('month'\)/);
  assert.match(dashboard, /setScope\('overall'\)/);
  assert.match(dashboard, /type="month" value=\{performanceMonth\}/);
  assert.match(dashboard, /\/api\/performance\/baseline\/\$\{encodeURIComponent\(user\.id\)\}/);
  assert.match(dashboard, /role="switch" aria-checked=\{baselineEnabled\}/);
  assert.match(app, /currentUser=\{currentUser\}/);
});

test('adaptive sync carries collection revisions so chat-only changes avoid full project downloads', () => {
  assert.match(tasks, /sinceCollections/);
  assert.match(tasks, /JSON\.stringify\(sinceCollections\)/);
  assert.match(app, /workspaceCollectionRevisionsRef/);
  assert.match(app, /sinceCollections:workspaceCollectionRevisionsRef\.current/);
});
