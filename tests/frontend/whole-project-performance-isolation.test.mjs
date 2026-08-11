import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const adaptiveSync = fs.readFileSync(new URL('../../frontend/src/hooks/useAdaptiveWorkspaceSync.js', import.meta.url), 'utf8');

test('adaptive sync collapses simultaneous focus, online and visibility refreshes', () => {
  assert.match(adaptiveSync, /let inFlight = null/);
  assert.match(adaptiveSync, /let queuedForce = false/);
  assert.match(adaptiveSync, /if \(inFlight\)/);
  assert.match(adaptiveSync, /clearTimer\(\)/);
  assert.match(adaptiveSync, /queuedForce = queuedForce \|\| force/);
});

test('production workspace refreshes are collection and row delta based', () => {
  assert.match(app, /sinceCollections:workspaceCollectionRevisionsRef\.current/);
  assert.match(app, /const rowDeltaIds = asRecord\(data\.rowDeltaIds\)/);
  assert.match(app, /React\.startTransition/);
  assert.match(app, /replaceIds:asArray\(rowDeltaIds\.cases\)/);
});

test('production presence uses one server writer and compact row reconciliation', () => {
  assert.match(app, /Backend mode: the server is the only writer for attendance counters/);
  assert.match(app, /const heartbeatTimer = setInterval\(sendHeartbeat, PRESENCE_HEARTBEAT_MS\)/);
  assert.match(app, /if \(data\?\.attendanceLog\)/);
  assert.doesNotMatch(app, /USE_BACKEND_STATE[\s\S]{0,120}setInterval\([^)]*25000/);
});

test('backend mode never serializes the complete operational workspace to localStorage', () => {
  assert.match(app, /if \(!isLocalMock\) return/);
  assert.match(app, /Whole-state browser writes are intentionally disabled/);
  assert.doesNotMatch(app, /if \(USE_BACKEND_STATE\)[^{]{0,80}localStorage\.setItem\('kalpa_projects'/);
});
