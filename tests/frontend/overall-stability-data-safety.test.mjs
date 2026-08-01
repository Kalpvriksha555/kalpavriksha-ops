import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chatService = fs.readFileSync(new URL('../../frontend/src/services/chatService.js', import.meta.url), 'utf8');
const fileService = fs.readFileSync(new URL('../../frontend/src/services/fileService.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');

test('chat and notification retries carry stable mutation identities', () => {
  assert.match(chatService, /const transientMutationIds = new WeakMap\(\)/);
  assert.match(chatService, /mutationId:mutationIdFor\(message,'chat',\{useRecordId:true\}\)/);
  assert.match(chatService, /mutationId:mutationIdFor\(notification,'notification'\)/);
  assert.match(chatService, /crypto\?\.randomUUID/);
});

test('file response-loss retries reuse one upload mutation id and clear it only after success', () => {
  assert.match(fileService, /const uploadMutationIds = new WeakMap\(\)/);
  assert.match(fileService, /form\.append\('mutationId', mutationId\)/);
  const successIndex=fileService.indexOf('uploadMutationIds.delete(file)');
  const catchIndex=fileService.indexOf('} catch (error)', successIndex);
  assert.ok(successIndex > 0 && catchIndex > successIndex);
});

test('a single feature render failure is isolated from the navigation shell', () => {
  assert.match(app, /<AppErrorBoundary key=\{`workspace:\$\{activeTab\}:\$\{selectedProject\?\.id/);
  assert.match(app, /<React\.Suspense fallback=\{<PageLoadingScreen/);
  assert.match(app, /<\/React\.Suspense>\s*<\/AppErrorBoundary>/);
});
