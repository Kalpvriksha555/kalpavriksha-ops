import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../../frontend/src/components/chat/CommunicationHub.jsx', import.meta.url), 'utf8');
const profile = fs.readFileSync(new URL('../../frontend/src/components/profile/ProfileView.jsx', import.meta.url), 'utf8');
const command = fs.readFileSync(new URL('../../frontend/src/components/command-centre/CommandCentreView.jsx', import.meta.url), 'utf8');
const operations = fs.readFileSync(new URL('../../frontend/src/components/operations/ActiveOperationsView.jsx', import.meta.url), 'utf8');

test('live browser chat and notification collections are explicitly bounded', () => {
  assert.match(app, /const LIVE_CHAT_MEMORY_LIMIT = 1500/);
  assert.match(app, /sorted\.length > LIVE_CHAT_MEMORY_LIMIT \? sorted\.slice\(-LIVE_CHAT_MEMORY_LIMIT\)/);
  assert.match(app, /const LIVE_NOTIFICATION_MEMORY_LIMIT = 300/);
  assert.match(app, /next\.length > LIVE_NOTIFICATION_MEMORY_LIMIT \? next\.slice\(0, LIVE_NOTIFICATION_MEMORY_LIMIT\)/);
});

test('chat renders a progressive window and can retrieve older durable history', () => {
  assert.match(chat, /const CHAT_RENDER_BATCH = 250/);
  assert.match(chat, /const displayMessages = matchingMessages\.slice\(-visibleMessageLimit\)/);
  assert.match(chat, /Load older history/);
  assert.match(chat, /\/api\/chat\/history\?before=/);
  assert.match(chat, /setHistoryMessages/);
});

test('per-user hidden chat ids cannot grow forever', () => {
  assert.match(chat, /const HIDDEN_MESSAGE_ID_LIMIT = 500/);
  assert.match(chat, /\.slice\(-HIDDEN_MESSAGE_ID_LIMIT\)/);
});

test('global task search cannot render an unbounded result list', () => {
  assert.match(app, /const GLOBAL_CASE_SEARCH_LIMIT = 40/);
  assert.match(app, /\.slice\(0, GLOBAL_CASE_SEARCH_LIMIT\)/);
});

test('inactive or hidden dashboards suspend recurring display timers', () => {
  for (const source of [command, operations]) {
    assert.match(source, /if \(document\.hidden\) return/);
    assert.match(source, /document\.addEventListener\('visibilitychange', onVisibility\)/);
    assert.match(source, /document\.removeEventListener\('visibilitychange', onVisibility\)/);
  }
});

test('profile upload releases the temporary object URL after server confirmation', () => {
  assert.match(profile, /profilePhoto !== preview/);
  assert.match(profile, /URL\.revokeObjectURL\(preview\)/);
  assert.match(profile, /localPhotoPreviewRef\.current = ''/);
});
