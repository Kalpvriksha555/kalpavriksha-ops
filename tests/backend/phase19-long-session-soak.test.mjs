import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');

test('compact operational state bounds chat and notification payloads without deleting durable records', () => {
  assert.match(server, /WORKSPACE_COMPACT_CHAT_LIMIT/);
  assert.match(server, /WORKSPACE_COMPACT_NOTIFICATION_LIMIT/);
  assert.match(server, /compact \? fullChatMessages\.slice\(0, WORKSPACE_COMPACT_CHAT_LIMIT\) : fullChatMessages/);
  assert.match(server, /compact \? fullNotifications\.slice\(0, WORKSPACE_COMPACT_NOTIFICATION_LIMIT\) : fullNotifications/);
  const scopedStart = server.indexOf('function scopedState(');
  const scopedEnd = server.indexOf('function filterCollectionRows', scopedStart);
  const scoped = server.slice(scopedStart, scopedEnd);
  assert.doesNotMatch(scoped, /\.splice\(|\.pop\(|\.shift\(|=\s*fullChatMessages\.slice|=\s*fullNotifications\.slice/);
});

test('older chat remains available through an authenticated bounded history endpoint', () => {
  const start = server.indexOf("app.get('/api/chat/history'");
  const end = server.indexOf("app.post('/api/chat'", start);
  assert.ok(start > 0 && end > start);
  const route = server.slice(start, end);
  assert.match(route, /requireCapability\('state:read'\)/);
  assert.match(route, /Math\.min\(250/);
  assert.match(route, /scopedTeamChat\(readDb\(\),req\)/);
  assert.match(route, /before/);
  assert.match(route, /hasMore/);
});

test('workspace response exposes live-window diagnostics for long-session troubleshooting', () => {
  assert.match(server, /liveWindow:\{/);
  assert.match(server, /chatReturned:chatMessages\.length/);
  assert.match(server, /chatTotal:fullChatMessages\.length/);
  assert.match(server, /notificationsReturned:notifications\.length/);
  assert.match(server, /notificationsTotal:fullNotifications\.length/);
});
