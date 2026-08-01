import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getRequestStateSnapshot } from '../../backend/src/services/requestStateService.js';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');

test('middleware and handlers receive the exact same mutable request state snapshot', () => {
  const req = {};
  let factoryCalls = 0;
  const first = getRequestStateSnapshot(req, () => {
    factoryCalls += 1;
    return { cases:[{ id:'case-1', status:'ASSIGNED' }] };
  });
  first.cases[0].status = 'IN_PROGRESS';
  const second = getRequestStateSnapshot(req, () => {
    factoryCalls += 1;
    return { cases:[] };
  });
  assert.equal(first, second);
  assert.equal(second.cases[0].status, 'IN_PROGRESS');
  assert.equal(factoryCalls, 1);
  assert.equal(Object.keys(req).includes('kalpaStateSnapshot'), false);
});

test('case authorisation and mutation handlers use the shared request snapshot', () => {
  assert.match(server, /function requireCaseAction\(action = 'read', snapshotOptions = \{\}\) \{[\s\S]*const d = requestTaskDb\(req,snapshotOptions\);[\s\S]*req\.caseRecord = caseRecord;/);
  for (const route of ['assign', 'start', 'manager-complete', 'revision', 'timeline']) {
    const marker = route === 'timeline' ? "app.post('/api/cases/:id/timeline'" : `app.post('/api/cases/:id/${route}'`;
    const start = server.indexOf(marker);
    assert.ok(start > 0, `route ${route} must exist`);
    const end = server.indexOf('\n});', start);
    const block = server.slice(start, end > start ? end : start + 2500);
    assert.match(block, /requestDb\(req\)/, `route ${route} must persist the authorised request snapshot`);
  }
});

test('long case uploads parse the multipart body before pinning a state snapshot', () => {
  assert.match(server, /app\.post\('\/api\/cases\/:id\/upload-source', requireAnyRole\('ADMIN','MANAGER'\), preauthorizeCaseAction\('update'\), uploadAny, requireCaseAction\('update',\{files:true,notifications:true\}\)/);
  assert.match(server, /app\.post\('\/api\/cases\/:id\/upload-final', preauthorizeCaseAction\('upload-final'\), uploadAny, requireCaseAction\('upload-final',\{files:true,notifications:true,audit:true\}\)/);
  assert.match(server, /prepareSecureUploads\(req, 'SOURCE'\)[\s\S]*taskDb\(req\.params\.id,\{files:true,notifications:true\}\)/);
  assert.match(server, /prepareSecureUploads\(req, isRevision \? 'REVISION_FINAL' : 'FINAL'\)[\s\S]*taskDb\(req\.params\.id,\{files:true,notifications:true,audit:true\}\)/);
});

test('profile updates mutate the cloned state row and failed stored uploads are rolled back', () => {
  assert.match(server, /findStateUserByIdOrUsername\(actor\.id, actor\.username, d\)/);
  assert.match(server, /PROFILE_PHOTO_PERSISTENCE_FAILED/);
  assert.match(server, /CASE_CREATE_PERSISTENCE_FAILED/);
  assert.match(server, /CASE_SOURCE_UPLOAD_PERSISTENCE_FAILED/);
  assert.match(server, /CASE_FINAL_UPLOAD_PERSISTENCE_FAILED/);
  assert.match(server, /FILE_REGISTRY_PERSISTENCE_FAILED/);
  assert.match(server, /WHATSAPP_CASE_PERSISTENCE_FAILED/);
});

test('logical file deletion commits before any physical cleanup decision', () => {
  const routeStart = server.indexOf("app.delete('/api/files/:id'");
  const routeEnd = server.indexOf("app.get('/api/system/files/storage-health'", routeStart);
  const route = server.slice(routeStart, routeEnd);
  const saveIndex = route.indexOf("reason:'file_delete'");
  const physicalIndex = route.indexOf("physicalAction =");
  assert.ok(saveIndex > 0 && physicalIndex > saveIndex);
  assert.doesNotMatch(route, /fileStorage\.softDelete\(targetKey/);
  assert.match(route, /retained-for-safe-gc/);
});


test('failed content-addressed uploads are retained as safe-GC candidates instead of racing concurrent deduplication', () => {
  const start = server.indexOf('function rollbackPreparedUploads');
  const end = server.indexOf('async function prepareSecureUploads', start);
  const block = server.slice(start, end);
  assert.doesNotMatch(block, /fileStorage\.softDelete/);
  assert.match(block, /UPLOAD_ORPHAN_CANDIDATE/);
  assert.match(block, /retained-for-safe-gc/);
});


test('large case uploads are authorised before transfer and reauthorised against a fresh snapshot afterward', () => {
  assert.match(server, /function preauthorizeCaseAction\(action = 'read'\)/);
  assert.match(server, /preauthorizeCaseAction\('update'\), uploadAny, requireCaseAction\('update',\{files:true,notifications:true\}\)/);
  assert.match(server, /preauthorizeCaseAction\('upload-final'\), uploadAny, requireCaseAction\('upload-final',\{files:true,notifications:true,audit:true\}\)/);
  assert.match(server, /cleanupIncomingUploads\(req\.files \|\| \(req\.file \? \[req\.file\] : \[\]\)\)/);
});

test('multipart temporary files are removed on validation, authorization, and persistence failures', () => {
  assert.match(server, /function cleanupRequestTempUploads\(req = \{\}\)/);
  assert.match(server, /PROFILE_PHOTO_TOO_LARGE[\s\S]*cleanupRequestTempUploads\(req\)/);
  assert.match(server, /SINGLE_FILE_REQUIRED[\s\S]*cleanupRequestTempUploads\(req\)/);
  assert.match(server, /FILE_PURPOSE_INVALID[\s\S]*cleanupRequestTempUploads\(req\)/);
  assert.match(server, /CASE_CREATE_PERSISTENCE_FAILED/);
  const cleanupCalls = (server.match(/cleanupRequestTempUploads\(req\)/g) || []).length;
  assert.ok(cleanupCalls >= 12, `expected broad upload cleanup coverage, found ${cleanupCalls}`);
});

test('multipart middleware cleans temporary files on parser errors and client disconnects', () => {
  const start = server.indexOf('function uploadAny');
  const end = server.indexOf("const roles =", start);
  const block = server.slice(start, end);
  assert.match(block, /if \(err\) \{[\s\S]*cleanupRequestTempUploads\(req\)/);
  assert.match(block, /res\.once\('finish', cleanup\)/);
  assert.match(block, /res\.once\('close', cleanup\)/);
});
