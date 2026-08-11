import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const authSource = fs.readFileSync(path.join(root, 'frontend/src/services/authService.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'frontend/src/App.jsx'), 'utf8');
const meetingSource = fs.readFileSync(path.join(root, 'frontend/src/components/meetings/TeamMeetingRoom.jsx'), 'utf8');
const commandCentreSource = fs.readFileSync(path.join(root, 'frontend/src/components/command-centre/CommandCentreView.jsx'), 'utf8');
const chatSourceForPhase15 = fs.readFileSync(path.join(root, 'frontend/src/components/chat/CommunicationHub.jsx'), 'utf8');
const fileServiceSource = fs.readFileSync(path.join(root, 'frontend/src/services/fileService.js'), 'utf8');

async function loadAuthServiceForNode() {
  let source = authSource;
  source = source.replace("import { API_BASE } from '../config/appConfig';", "const API_BASE = '';");
  const requestControlUrl = pathToFileURL(path.resolve('frontend/src/services/requestControlService.js')).href;
  source = source.replace(
    "import { createRequestDeadline, markClientMutationStarted } from './requestControlService.js';",
    `import { createRequestDeadline, markClientMutationStarted } from ${JSON.stringify(requestControlUrl)};`
  );
  const apiContractUrl = pathToFileURL(path.resolve('frontend/src/services/apiContractService.js')).href;
  source = source.replace(
    "import { apiHttpError, readApiRecord } from './apiContractService.js';",
    `import { apiHttpError, readApiRecord } from ${JSON.stringify(apiContractUrl)};`
  );
  source += `\n// phase15-test-${Date.now()}-${Math.random()}\n`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const createStorage = () => {
  const map = new Map();
  return {
    getItem(key) { return map.has(String(key)) ? map.get(String(key)) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(String(key)); },
    clear() { map.clear(); },
    _map: map
  };
};

test('page ownership and safe-read session binding stop stale tabs before network access', async () => {
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const originalFetch = globalThis.fetch;
  const storage = createStorage();
  globalThis.localStorage = storage;
  globalThis.window = { localStorage: storage, addEventListener() {}, dispatchEvent() { return true; } };
  globalThis.BroadcastChannel = undefined;

  try {
    const auth = await loadAuthServiceForNode();
    const owned = auth.claimBrowserAuthContext({ state:'signed-out', reason:'test' });
    assert.equal(owned.ownerInstanceId, auth.getAuthPageInstanceId());
    assert.equal(auth.browserAuthContextOwnedByThisPage(), true);

    auth.setCsrfToken('page-token-123');
    let seenHeader = '';
    globalThis.fetch = async (_url, init = {}) => {
      seenHeader = new Headers(init.headers || {}).get('X-CSRF-Token') || '';
      return new Response(JSON.stringify({ ok:true }), { status:200, headers:{ 'Content-Type':'application/json' } });
    };
    const response = await auth.authFetch('https://example.invalid/api/state', { method:'GET', timeoutMs:1000 });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(seenHeader, 'page-token-123', 'safe GET requests must carry the page-bound session token');

    storage.setItem('kalpa_auth_page_context_v1', JSON.stringify({
      schemaVersion:1,
      generation:Number(owned.generation || 0) + 10,
      ownerInstanceId:'another-tab',
      state:'authenticated',
      userId:'other-user',
      changedAt:Date.now()
    }));
    let networkCalls = 0;
    globalThis.fetch = async () => { networkCalls += 1; return new Response('{}', { status:200 }); };
    await assert.rejects(
      auth.authFetch('https://example.invalid/api/state', { method:'GET', timeoutMs:1000 }),
      error => error?.code === 'AUTH_BROWSER_CONTEXT_CHANGED'
    );
    assert.equal(networkCalls, 0, 'a stale tab must be rejected before it can read with another tab\'s cookie');
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalStorage;
    globalThis.BroadcastChannel = originalBroadcastChannel;
    globalThis.fetch = originalFetch;
  }
});

test('responses started under an older auth generation are discarded before headers reach application state', async () => {
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const originalFetch = globalThis.fetch;
  const storage = createStorage();
  globalThis.localStorage = storage;
  globalThis.window = { localStorage: storage, addEventListener() {}, dispatchEvent() { return true; } };
  globalThis.BroadcastChannel = undefined;
  try {
    const auth = await loadAuthServiceForNode();
    auth.claimBrowserAuthContext({ state:'authenticated', userId:'first', reason:'test' });
    auth.setCsrfToken('old-token');
    let releaseFetch;
    globalThis.fetch = () => new Promise(resolve => { releaseFetch = resolve; });
    const pending = auth.authFetch('https://example.invalid/api/state', { method:'GET', timeoutMs:1000 });
    auth.setCsrfToken('new-token');
    releaseFetch(new Response(JSON.stringify({ ok:true }), { status:200, headers:{ 'Content-Type':'application/json' } }));
    await assert.rejects(pending, error => error?.code === 'AUTH_REQUEST_CONTEXT_STALE');
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalStorage;
    globalThis.BroadcastChannel = originalBroadcastChannel;
    globalThis.fetch = originalFetch;
  }
});

test('slow response bodies are discarded if logout or account replacement occurs after headers arrive', async () => {
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const originalFetch = globalThis.fetch;
  const storage = createStorage();
  globalThis.localStorage = storage;
  globalThis.window = { localStorage: storage, addEventListener() {}, dispatchEvent() { return true; } };
  globalThis.BroadcastChannel = undefined;
  try {
    const auth = await loadAuthServiceForNode();
    auth.claimBrowserAuthContext({ state:'authenticated', userId:'first', reason:'test' });
    auth.setCsrfToken('body-old-token');
    let releaseBody;
    const stream = new ReadableStream({
      start(controller) {
        releaseBody = () => { controller.enqueue(new TextEncoder().encode('{\"ok\":true}')); controller.close(); };
      }
    });
    globalThis.fetch = async () => new Response(stream, { status:200, headers:{ 'Content-Type':'application/json' } });
    const response = await auth.authFetch('https://example.invalid/api/state', { method:'GET', timeoutMs:1000 });
    const bodyPromise = response.text();
    await Promise.resolve();
    auth.setCsrfToken('body-new-token');
    releaseBody();
    await assert.rejects(bodyPromise, error => error?.code === 'AUTH_REQUEST_CONTEXT_STALE');
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalStorage;
    globalThis.BroadcastChannel = originalBroadcastChannel;
    globalThis.fetch = originalFetch;
  }
});

test('browser auth transitions are cross-tab visible without persisting CSRF secrets', () => {
  assert.match(authSource, /AUTH_CONTEXT_STORAGE_KEY = 'kalpa_auth_page_context_v1'/);
  assert.match(authSource, /new BroadcastChannel\(AUTH_CONTEXT_CHANNEL_NAME\)/);
  assert.match(authSource, /window\.addEventListener\('storage'/);
  assert.match(authSource, /claimBrowserAuthContext\(\{ state:'signed-out', reason:'page-boot' \}\)/);
  assert.match(authSource, /claimBrowserAuthContext\(\{ state:'authenticated',[\s\S]*reason:'login' \}\)/);
  assert.match(authSource, /claimBrowserAuthContext\(\{ state:'signed-out', reason:'logout' \}\)/);
  assert.doesNotMatch(authSource, /localStorage\.setItem\(CSRF_STORAGE_KEY/);
});

test('durable task retry state and browser-only notes cannot bleed across authenticated actors', () => {
  assert.match(appSource, /let activeOperationalActorScope = ''/);
  assert.match(appSource, /setOperationalActorScope\(null\);[\s\S]*setCurrentUser\(null\)/);
  assert.match(appSource, /setOperationalActorScope\(user\);[\s\S]*clearRoleScopedOperationalCaches\(user\)/);
  assert.match(appSource, /const getPendingCreatedRecords = \(actorId = activeOperationalActorScope\)/);
  assert.match(appSource, /if \(!actorKey\) return \[\];[\s\S]*Boolean\(record\.actorId\)/);
  assert.match(appSource, /const getPendingDeletedRecords = \(actorId = activeOperationalActorScope\)/);
  assert.match(appSource, /const getRecentCreatedProjects = \(actorId = activeOperationalActorScope\)/);
  assert.match(appSource, /recordActor && recordActor === actorKey/);
  assert.match(meetingSource, /kalpa_team_meeting_started_at::\$\{storageActorKey\}/);
  assert.match(meetingSource, /kalpa_team_meeting_notes::\$\{storageActorKey\}/);
  assert.match(commandCentreSource, /kalpa-production-qa-signoff-\$\{todayKey\}::\$\{String\(currentUser/);
});

test('chat transfers and voice capture stop when the authenticated workspace unmounts', () => {
  assert.match(chatSourceForPhase15, /useEffect\(\(\) => \(\) => \{[\s\S]*attachmentUploadAbortRef\.current\?\.abort\(\)[\s\S]*voiceCancelRef\.current = true[\s\S]*recorder\.stop\(\)/);
});

test('session replacement explains the sign-out instead of leaving a mixed-user workspace visible', () => {
  assert.match(appSource, /AUTH_BROWSER_CONTEXT_CHANGED/);
  assert.match(appSource, /AUTH_SESSION_CONTEXT_CHANGED/);
  assert.match(appSource, /signed out to prevent account data from mixing/);
  assert.match(appSource, /clearAuthenticatedWorkspace\(\{ clearCache: true \}\)/);
});

test('sign-out boundary clears user-derived transient UI and aborts in-flight task uploads', () => {
  const start = appSource.indexOf('const clearAuthenticatedWorkspace = useCallback');
  const end = appSource.indexOf('const [globalSearch, setGlobalSearch]', start);
  const block = appSource.slice(start, end);
  assert.match(block, /createdTaskUploadAbortRef\.current\.abort\(\)/);
  assert.match(block, /setWorkspaceFilePreview\(null\)/);
  assert.match(block, /URL\.revokeObjectURL\(current\.objectUrl\)/);
  assert.match(block, /setLeadFiles\(\[\]\)/);
  assert.match(block, /setGlobalSearch\(''\)/);
  assert.match(block, /setNotifSearch\(''\)/);
  assert.match(block, /setSavedGlobalFilters\(\[\]\)/);
  assert.match(block, /setArchiveViewState\(/);
  assert.match(block, /setFinanceViewState\(/);
  assert.match(block, /kalpa_team_meeting_started_at/);
  assert.match(block, /kalpa_team_meeting_notes/);
});


test('task-detail uploads are cancellable and cannot outlive an authenticated task view', () => {
  const detailStart = appSource.indexOf('const TaskDetailView =');
  const detailEnd = appSource.indexOf('const clearAuthenticatedWorkspace = useCallback', detailStart);
  const detail = appSource.slice(detailStart, detailEnd);
  assert.match(detail, /useEffect\(\(\) => \(\) => \{[\s\S]*fileTransferAbortRef\.current\?\.abort\(\)[\s\S]*fileTransferAbortRef\.current = null/);
  assert.match(detail, /handleFileUpload[\s\S]*const controller=new AbortController\(\)[\s\S]*signal:controller\.signal/);
  assert.match(detail, /uploadSupportingAttachments[\s\S]*const controller=new AbortController\(\)[\s\S]*signal:controller\.signal/);
  assert.match(detail, /handleLedgerScreenshot[\s\S]*const controller=new AbortController\(\)[\s\S]*signal:controller\.signal/);
  assert.match(detail, /fileTransferAbortRef\.current \|\| \(fileTransfer\.active/);
  assert.match(detail, /UPLOAD_CANCELLED/);
});

test('XHR uploads verify page ownership and surface authentication replacement immediately', () => {
  assert.match(fileServiceSource, /assertBrowserAuthContextOwnership\(\);[\s\S]*xhr\.open\('POST'/);
  assert.match(fileServiceSource, /X-CSRF-Token/);
  assert.match(fileServiceSource, /xhr\.status === 409[\s\S]*X-Auth-Session-Context[\s\S]*notifyBrowserAuthenticationRejected\('AUTH_SESSION_CONTEXT_CHANGED'\)/);
  assert.match(fileServiceSource, /xhr\.status === 401[\s\S]*notifyBrowserAuthenticationRejected/);
});

test('sign-out invalidates stale workspace reads in addition to clearing actor state', () => {
  const start = appSource.indexOf('const clearAuthenticatedWorkspace = useCallback');
  const end = appSource.indexOf('const [globalSearch, setGlobalSearch]', start);
  const block = appSource.slice(start, end);
  assert.match(block, /markClientMutationStarted\(\);[\s\S]*setOperationalActorScope\(null\)/);
});
