import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  readApiRecord,
  validateWorkspaceStatePayload,
} from '../../frontend/src/services/apiContractService.js';
import {
  advanceWorkspaceSyncMarkers,
  classifyWorkspaceResponseFreshness,
} from '../../frontend/src/utils/workspaceSyncUtils.js';
import {
  getClientMutationGeneration,
  markClientMutationStarted,
} from '../../frontend/src/services/requestControlService.js';

const root = process.cwd();
const collections = {
  users:10,
  cases:11,
  deletedProjectIds:12,
  teamChat:13,
  notifications:14,
  attendanceLogs:15,
};

const mockResponse = ({ ok = true, status = ok ? 200 : 500, body = '{}', headers = {} } = {}) => ({
  ok,
  status,
  headers:{ get(name) { return headers[String(name).toLowerCase()] || headers[name] || null; } },
  async text() { return body; },
});

const fullWorkspace = (overrides = {}) => ({
  ok:true,
  stateVersion:100,
  dataRevision:80,
  presenceGeneration:20,
  collectionRevisions:{ ...collections },
  syncToken:'80.20',
  users:[],
  projects:[],
  deletedProjectIds:[],
  chatMessages:[],
  notifications:[],
  attendanceLogs:[],
  ...overrides,
});

test('successful API bodies must be JSON records with explicit ok confirmation when required', async () => {
  const good = await readApiRecord(mockResponse({ body:JSON.stringify({ ok:true, result:1 }) }), { operation:'test', requireOk:true });
  assert.equal(good.result, 1);

  for (const [body, code] of [
    ['', 'API_EMPTY_SUCCESS_RESPONSE'],
    ['not-json', 'API_INVALID_JSON_RESPONSE'],
    ['[]', 'API_INVALID_ROOT_RESPONSE'],
    ['"yes"', 'API_INVALID_ROOT_RESPONSE'],
    [JSON.stringify({ result:1 }), 'API_SUCCESS_NOT_CONFIRMED'],
  ]) {
    await assert.rejects(
      () => readApiRecord(mockResponse({ body }), { operation:'test', requireOk:true }),
      error => error?.code === code,
    );
  }
});

test('error HTTP responses remain readable without pretending malformed error bodies are successful', async () => {
  const payload = await readApiRecord(mockResponse({ ok:false, status:503, body:'temporarily unavailable' }), { operation:'test', requireOk:true });
  assert.match(payload.error, /temporarily unavailable/);
});

test('workspace full and partial payload contracts reject missing or wrong collection shapes', () => {
  const valid = validateWorkspaceStatePayload(fullWorkspace());
  assert.equal(valid.syncToken, '80.20');

  assert.throws(() => validateWorkspaceStatePayload(fullWorkspace({ users:{} })), /users must be an array/i);
  assert.throws(() => validateWorkspaceStatePayload(fullWorkspace({ collectionRevisions:{ ...collections, users:undefined } })), /collectionRevisions\.users marker/i);
  assert.throws(() => validateWorkspaceStatePayload(fullWorkspace({ syncToken:'79.20' })), /inconsistent revision markers/i);

  const partial = validateWorkspaceStatePayload(fullWorkspace({
    partial:'workspace',
    changedCollections:['cases'],
    projects:[{ id:'P-1' }],
    rowDeltaIds:{ cases:['P-1'] },
  }));
  assert.deepEqual(partial.changedCollections, ['cases']);

  assert.throws(() => validateWorkspaceStatePayload(fullWorkspace({
    partial:'workspace', changedCollections:['cases'], projects:{},
  })), /array field projects/i);
  assert.throws(() => validateWorkspaceStatePayload(fullWorkspace({
    partial:'workspace', changedCollections:['unknownCollection'],
  })), /unknown collection/i);

  const presence = validateWorkspaceStatePayload(fullWorkspace({
    partial:'presence', users:[], attendanceLogs:[],
  }));
  assert.equal(presence.partial, 'presence');
});

test('workspace markers can only advance and stale responses are classified before application', () => {
  const current = fullWorkspace();
  const older = fullWorkspace({
    stateVersion:99,
    dataRevision:79,
    presenceGeneration:19,
    collectionRevisions:{ ...collections, cases:9 },
    syncToken:'79.19',
  });
  const classified = classifyWorkspaceResponseFreshness(older, current);
  assert.equal(classified.stale, true);
  assert.ok(classified.reasons.includes('state-version-regressed'));
  assert.ok(classified.reasons.includes('data-revision-regressed'));
  assert.ok(classified.reasons.includes('presence-generation-regressed'));
  assert.ok(classified.reasons.includes('collection-cases-regressed'));

  const advanced = advanceWorkspaceSyncMarkers(current, older);
  assert.equal(advanced.stateVersion, 100);
  assert.equal(advanced.dataRevision, 80);
  assert.equal(advanced.presenceGeneration, 20);
  assert.equal(advanced.collectionRevisions.cases, 11);
});

test('any browser-side mutation invalidates a workspace GET that started before it', () => {
  const before = getClientMutationGeneration();
  const after = markClientMutationStarted();
  assert.equal(after, before + 1);
  const result = classifyWorkspaceResponseFreshness(fullWorkspace(), fullWorkspace(), { clientMutationAdvanced:true });
  assert.equal(result.stale, true);
  assert.ok(result.reasons.includes('client-mutation-advanced'));
});

test('Phase 12 source wiring rejects stale workspace data before applying it and protects write/read boundaries', () => {
  const app = fs.readFileSync(path.join(root, 'frontend/src/App.jsx'), 'utf8');
  const task = fs.readFileSync(path.join(root, 'frontend/src/services/taskService.js'), 'utf8');
  const auth = fs.readFileSync(path.join(root, 'frontend/src/services/authService.js'), 'utf8');
  const command = fs.readFileSync(path.join(root, 'frontend/src/components/command-centre/CommandCentreView.jsx'), 'utf8');
  const chat = fs.readFileSync(path.join(root, 'frontend/src/services/chatService.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  const hydrationFreshnessIndex = app.indexOf('const hydrationFreshness = classifyWorkspaceResponseFreshness');
  const firstHydrationApplyIndex = app.indexOf("applyProjectSnapshot(data.projects, { source: 'backend-hydrate' })", hydrationFreshnessIndex);
  assert.ok(hydrationFreshnessIndex >= 0 && firstHydrationApplyIndex > hydrationFreshnessIndex, 'hydration must classify freshness before applying projects');
  assert.match(app, /_staleAfterClientMutation === true/);
  assert.match(app, /needsFreshFollowUp = true/);
  assert.match(app, /window\.setTimeout\(\(\) => void refreshWorkspaceSnapshot\(\), 0\)/);
  assert.doesNotMatch(app, /Array\.fromasArray/);
  assert.match(app, /toArray\(files\)\.filter\(Boolean\)/);

  assert.match(task, /clientMutationGenerationAtStart = getClientMutationGeneration\(\)/);
  assert.match(task, /validateWorkspaceStatePayload/);
  assert.match(task, /_staleAfterClientMutation/);
  assert.match(auth, /if \(!safeMethod\(method\)\) markClientMutationStarted\(\)/);
  assert.match(command, /readApiRecord\(res, \{ operation:'Performance leaderboard'/);
  assert.doesNotMatch(command, /res\.ok\s*\?\s*res\.json/);
  assert.match(chat, /const saved = asRecord\(payload\.message\)/);
  assert.match(chat, /CHAT_CONFIRMATION_MISSING/);

  assert.equal(pkg.scripts['verify:api-contract'], 'node scripts/phase-12-api-contract-stale-response-check.mjs');
});
