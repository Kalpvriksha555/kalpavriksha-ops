import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyFileRetentionToState } from '../../backend/src/services/storageRetentionService.js';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const storage = fs.readFileSync(new URL('../../backend/src/services/fileStorageService.js', import.meta.url), 'utf8');

const DAY = 24 * 60 * 60 * 1000;

test('90-day retention interprets legacy Unix-second upload timestamps safely', () => {
  const now = Date.parse('2026-08-10T00:00:00Z');
  const thirtyDaysAgoSeconds = Math.floor((now - 30 * DAY) / 1000);
  const ninetyOneDaysAgoSeconds = Math.floor((now - 91 * DAY) / 1000);
  const state = {
    files:[
      { id:'young-seconds', purpose:'SOURCE', uploadedAt:thirtyDaysAgoSeconds, storageStatus:'AVAILABLE' },
      { id:'old-seconds', purpose:'SOURCE', uploadedAt:String(ninetyOneDaysAgoSeconds), storageStatus:'AVAILABLE' }
    ],
    cases:[], teamChat:[], payments:[]
  };
  const result = applyFileRetentionToState(state, { nowMs:now, retentionDays:90 });
  assert.deepEqual(result.expiredIds, ['old-seconds']);
  assert.equal(state.files[0].storageStatus, 'AVAILABLE');
  assert.equal(state.files[1].storageStatus, 'EXPIRED');
});

test('canonical upload registry persists replay actor, type and voice-note identity', () => {
  const start = server.indexOf('function addFileRegistryEntry');
  const end = server.indexOf('function allKnownFileDocs', start);
  const block = server.slice(start, end);
  assert.match(block, /uploadedById: doc\.uploadedById \|\| ''/);
  assert.match(block, /uploadedByUsername: doc\.uploadedByUsername \|\| ''/);
  assert.match(block, /type: doc\.type \|\| doc\.folder \|\| ''/);
  assert.match(block, /folder: doc\.folder \|\| doc\.type \|\| ''/);
  assert.match(block, /isVoiceNote: Boolean\(doc\.isVoiceNote\)/);
});

test('response-loss upload replay is verified after secure hashing and mismatched mutation reuse fails closed', () => {
  const start = server.indexOf("app.post('/api/files/upload'");
  const end = server.indexOf('function getStoredFilePreviewDescriptor', start);
  const block = server.slice(start, end);
  const validation = block.indexOf('preparedUploads=await prepareSecureUploads(req,purpose)');
  const replay = block.indexOf('const concurrentUpload=findCommittedUpload(d,req.file)');
  assert.ok(validation >= 0 && replay > validation, 'replay must occur after signature validation/hash creation');
  assert.match(block, /const sameSha=!incomingSha \|\| !item\?\.sha256 \|\| String\(item\.sha256\)===incomingSha/);
  assert.match(block, /error\.code='UPLOAD_MUTATION_ID_REUSE'/);
  assert.match(block, /error\.statusCode=409/);
  assert.doesNotMatch(block, /const priorUpload=findCommittedUpload\(initialState\)/);
});

test('case attachment aliases participate in resolution, deletion and garbage-collection liveness', () => {
  const allKnownStart = server.indexOf('function allKnownFileDocs');
  const allKnownEnd = server.indexOf('function fileStorageKey', allKnownStart);
  const allKnown = server.slice(allKnownStart, allKnownEnd);
  assert.match(allKnown, /Array\.isArray\(c\.uploads\)/);
  assert.match(allKnown, /Array\.isArray\(c\.attachments\)/);
  assert.match(allKnown, /c\.file \? \[c\.file\] : \[\]/);

  const resolveStart = server.indexOf('function resolveFileById');
  const resolveEnd = server.indexOf('function resolveAuthorizedFile', resolveStart);
  const resolve = server.slice(resolveStart, resolveEnd);
  assert.match(resolve, /Array\.isArray\(c\.uploads\)/);
  assert.match(resolve, /Array\.isArray\(c\.attachments\)/);
  assert.match(resolve, /c\.file \? \[c\.file\] : \[\]/);

  const deleteStart = server.indexOf("app.delete('/api/files/:id'");
  const deleteEnd = server.indexOf("app.get('/api/system/files/storage-health'", deleteStart);
  const deletion = server.slice(deleteStart, deleteEnd);
  assert.match(deletion, /'uploads','attachments'/);
  assert.match(deletion, /if \(c\.file && matches\(c\.file\)\) \{ delete c\.file/);
});

test('inline preview type is extension-bound instead of trusting legacy active MIME metadata', () => {
  const start = server.indexOf('function getStoredFilePreviewDescriptor');
  const end = server.indexOf('function contentDispositionValue', start);
  const block = server.slice(start, end);
  assert.match(block, /extension === '\.pdf' \? 'pdf'/);
  assert.match(block, /: extensionKind;/);
  assert.doesNotMatch(block, /mime\.startsWith\('image\/'\) \? 'image'/);
  assert.match(storage, /ACTIVE_OR_EXECUTABLE_EXTENSIONS/);
  assert.match(storage, /'\.svg'/);
});
