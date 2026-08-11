import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const fileService = fs.readFileSync(new URL('../../frontend/src/services/fileService.js', import.meta.url), 'utf8');
const taskService = fs.readFileSync(new URL('../../frontend/src/services/taskService.js', import.meta.url), 'utf8');

test('heartbeat requests cannot overlap and hidden tabs stop sending beats', () => {
  assert.match(app, /heartbeatRequestInFlightRef = useRef\(false\)/);
  assert.match(app, /action === 'heartbeat' && heartbeatRequestInFlightRef\.current/);
  assert.match(app, /heartbeatRequestInFlightRef\.current = false/);
  assert.match(app, /document\.visibilityState === 'hidden'/);
  assert.match(app, /setInterval\(sendHeartbeat, PRESENCE_HEARTBEAT_MS\)/);
});

test('workspace refreshes and pending task retries have in-flight backpressure', () => {
  assert.match(app, /workspaceRefreshInFlightRef\.current/);
  assert.match(app, /pendingCreateFlushInFlightRef\.current/);
  assert.match(app, /workspaceRefreshInFlightRef\.current = false/);
  assert.match(app, /pendingCreateFlushInFlightRef\.current = false/);
});


test('new tasks are persisted before source files are uploaded', () => {
  const createStart = app.indexOf('const filesToAttach = [...leadFiles]');
  const createRequest = app.indexOf('const saveData = await createTaskApi', createStart);
  const uploadRequest = app.indexOf("uploadProjectFile(file,confirmedProject.id || confirmedProject.caseId,'source'", createStart);
  assert.ok(createStart > 0 && createRequest > createStart && uploadRequest > createRequest);
  assert.match(app.slice(createStart, uploadRequest), /projectConfirmedByBackend/);
});

test('task writes and post-upload server processing have finite response deadlines', () => {
  assert.match(fileService, /UPLOAD_RESPONSE_TIMEOUT_MS = 5 \* 60 \* 1000/);
  assert.match(fileService, /processing took too long/);
  assert.match(taskService, /TASK_WRITE_TIMEOUT_MS = 2 \* 60 \* 1000/);
  assert.match(taskService, /TASK_SAVE_TIMEOUT/);
});

test('state conflicts are retried and are never misclassified as permanent task deletion', () => {
  assert.doesNotMatch(app, /e\?\.status === 409 \|\| e\?\.code === 'PROJECT_DELETED'/);
  assert.match(app, /isProjectDeletedError\(e\)/);
  assert.match(taskService, /isProjectDeletedError/);
});

test('uploaded task attachments are linked atomically by the upload response', () => {
  assert.match(fileService, /_serverCase: payload\.case \|\| payload\.project \|\| null/);
  assert.match(app, /if \(uploaded\?\._serverCase\) \{[\s\S]*applyProjectSnapshot\(\[confirmedProject\]/);
  assert.doesNotMatch(app, /create-files-pending-confirmation/);
  assert.doesNotMatch(app, /rememberPendingCreatedProject\(projectWithFiles\)/);
});

test('portable request deadlines are routed through authFetch instead of AbortSignal.timeout', () => {
  const authService = fs.readFileSync(new URL('../../frontend/src/services/authService.js', import.meta.url), 'utf8');
  const requestControl = fs.readFileSync(new URL('../../frontend/src/services/requestControlService.js', import.meta.url), 'utf8');
  assert.match(authService, /timeoutMs = DEFAULT_AUTH_FETCH_TIMEOUT_MS/);
  assert.match(requestControl, /new AbortController\(\)/);
  assert.match(taskService, /timeoutMs:TASK_WRITE_TIMEOUT_MS/);
  assert.doesNotMatch(taskService, /AbortSignal\.timeout/);
});


test('all authenticated API calls have a finite default deadline while large uploads get longer windows', () => {
  const authService = fs.readFileSync(new URL('../../frontend/src/services/authService.js', import.meta.url), 'utf8');
  const chat = fs.readFileSync(new URL('../../frontend/src/components/chat/CommunicationHub.jsx', import.meta.url), 'utf8');
  const profile = fs.readFileSync(new URL('../../frontend/src/services/profileService.js', import.meta.url), 'utf8');
  const files = fs.readFileSync(new URL('../../frontend/src/services/fileService.js', import.meta.url), 'utf8');
  assert.match(authService, /DEFAULT_AUTH_FETCH_TIMEOUT_MS = 90_000/);
  assert.match(authService, /timeoutMs = DEFAULT_AUTH_FETCH_TIMEOUT_MS/);
  assert.match(chat, /timeoutMs:30 \* 60 \* 1000/);
  assert.match(profile, /timeoutMs:5 \* 60 \* 1000/);
  assert.match(files, /UPLOAD_RESPONSE_TIMEOUT_MS = 5 \* 60 \* 1000/);
});

test('large downloads and previews keep response-body deadlines long enough for slow connections', () => {
  assert.match(fileService, /FILE_PREVIEW_TIMEOUT_MS = 5 \* 60 \* 1000/);
  assert.match(fileService, /FILE_DOWNLOAD_TIMEOUT_MS = 35 \* 60 \* 1000/);
  assert.match(fileService, /authFetch\(url, \{ cache: 'no-store', timeoutMs:FILE_DOWNLOAD_TIMEOUT_MS \}\)/);
  assert.match(fileService, /timeoutMs:FILE_PREVIEW_TIMEOUT_MS/);
});
