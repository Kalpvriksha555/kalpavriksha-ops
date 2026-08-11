import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  asArray,
  toArray,
  asRecord,
  firstArray,
  parseJsonArray,
  parseJsonRecord,
  normalizeArrayFields,
  safeObjectValues,
  safeObjectEntries,
} from '../../frontend/src/utils/runtimeShapeUtils.js';
import { buildActivityTimeline } from '../../frontend/src/utils/notificationUtils.js';
import { allProjectDocs } from '../../frontend/src/utils/taskDisplayUtils.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const appSource = fs.readFileSync(path.join(root, 'frontend/src/App.jsx'), 'utf8');
const taskServiceSource = fs.readFileSync(path.join(root, 'frontend/src/services/taskService.js'), 'utf8');
const chatHubSource = fs.readFileSync(path.join(root, 'frontend/src/components/chat/CommunicationHub.jsx'), 'utf8');
const chatUtilsSource = fs.readFileSync(path.join(root, 'frontend/src/utils/chatUtils.js'), 'utf8');

const malformedCollections = [null, undefined, '', 'Amit', 1, true, {}, { 0:'x', length:1 }];

test('array guards reject truthy non-arrays instead of allowing array-method crashes', () => {
  for (const value of malformedCollections) assert.deepEqual(asArray(value), []);
  const good = [{ id:1 }];
  assert.equal(asArray(good), good);
  assert.deepEqual(firstArray('bad', {}, good, ['later']), good);
});

test('iterable conversion is explicit and never treats strings as file collections', () => {
  assert.deepEqual(toArray(new Set(['a', 'b'])), ['a', 'b']);
  assert.deepEqual(toArray('ab'), []);
  assert.deepEqual(toArray({ length:2, 0:'a', 1:'b' }), []);
});

test('record guards reject arrays, scalars and null values', () => {
  for (const value of [null, undefined, '', 7, true, [], ['x']]) assert.deepEqual(asRecord(value), {});
  const record = { id:'x' };
  assert.equal(asRecord(record), record);
  assert.deepEqual(safeObjectValues('wrong-shape'), []);
  assert.deepEqual(safeObjectEntries([]), []);
});

test('JSON storage helpers reject valid JSON with the wrong structure', () => {
  assert.deepEqual(parseJsonArray('[1,2]'), [1,2]);
  assert.deepEqual(parseJsonArray('"Amit"'), []);
  assert.deepEqual(parseJsonArray('{"0":"x"}'), []);
  assert.deepEqual(parseJsonArray('null'), []);
  assert.deepEqual(parseJsonArray('{broken'), []);

  assert.deepEqual(parseJsonRecord('{"ok":true}'), { ok:true });
  assert.deepEqual(parseJsonRecord('[1,2]'), {});
  assert.deepEqual(parseJsonRecord('"text"'), {});
  assert.deepEqual(parseJsonRecord('null'), {});
  assert.deepEqual(parseJsonRecord('{broken'), {});
});

test('record normalization canonicalizes requested collection fields', () => {
  assert.deepEqual(normalizeArrayFields({ files:'bad', notes:[1], count:2 }, ['files', 'notes']), {
    files:[], notes:[1], count:2,
  });
});

test('pure display helpers remain safe when external collection payloads have wrong shapes', () => {
  for (const value of malformedCollections) {
    assert.doesNotThrow(() => buildActivityTimeline(value, value, value));
  }
  assert.deepEqual(buildActivityTimeline('bad', {}, 7), []);
  assert.deepEqual(allProjectDocs({ documents:'bad', completedFiles:{}, finalFiles:7 }), []);
  assert.match(chatUtilsSource, /getOperationalUsers = \(users = \[\], \{ includeAdmins = true \} = \{\}\) => asArray\(users\)/);
});

test('App canonicalizes project, chat and attendance nested collection shapes before render paths', () => {
  assert.match(appSource, /const PROJECT_ARRAY_FIELDS = Object\.freeze\(/);
  assert.match(appSource, /const normalizeProjectArrayShapes = \(project = \{\}\) =>/);
  assert.match(appSource, /PROJECT_ARRAY_FIELDS\.forEach\(field => \{ next\[field\] = asArray\(source\[field\]\); \}\)/);
  assert.match(appSource, /mentions: asArray\(sanitized\?\.mentions\)/);
  assert.match(appSource, /taskRefs: asArray\(sanitized\?\.taskRefs\)/);
  assert.match(appSource, /files: asArray\(sanitized\?\.files\)\.map/);
  assert.match(appSource, /reactions: asRecord\(sanitized\?\.reactions\)/);
  assert.match(appSource, /breakEvents: asArray\(source\.breakEvents\)/);
  assert.match(appSource, /activeTasks: asArray\(source\.activeTasks\)/);
});

test('task API normalization rejects wrong-shape roots and canonicalizes nested task arrays', () => {
  assert.match(taskServiceSource, /const source = asRecord\(task\)/);
  assert.match(taskServiceSource, /subTasks: asArray\(source\?\.subTasks\)/);
  assert.match(taskServiceSource, /paymentAuditTrail: asArray\(source\?\.paymentAuditTrail\)/);
  assert.match(taskServiceSource, /const parseJsonSafe = async \(response, operation = 'API request', options = \{\}\) => readApiRecord/);
});

test('chat storage uses structure-aware JSON parsers rather than trusting JSON validity', () => {
  assert.match(chatHubSource, /parseJsonRecord\(localStorage\.getItem\(localReadKey\)\)/);
  assert.match(chatHubSource, /parseJsonArray\(localStorage\.getItem\(hiddenKey\)\)\.map\(String\)/);
  assert.match(chatHubSource, /parseJsonArray\(localStorage\.getItem\(pinnedKey\)\)\.map\(String\)/);
});

test('release verification contains the dedicated Phase 11 runtime-shape gate', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const matrix = fs.readFileSync(path.join(root, 'scripts/full-release-verifier-matrix.mjs'), 'utf8');
  assert.equal(pkg.scripts['verify:runtime-shapes'], 'node scripts/phase-11-frontend-runtime-shape-check.mjs');
  assert.match(pkg.scripts.verify, /npm run test:frontend && npm run verify:runtime-shapes && npm run verify:api-contract && npm run verify:task-lifecycle && npm run verify:file-lifecycle && npm run verify:session-isolation && npm run verify:presence-attendance && npm run verify:finance-ledger && npm run verify:persistence-restart && npm run verify:long-session && npm run verify:diagnostics && npm run verify:deployment-resume && npm run verify:fault-soak && npm run verify:certification-local-postgres && npm run verify:operator-deploy && npm run verify:frontend-runtime/);
  assert.match(matrix, /id:'frontend-runtime-shapes'/);
});
