import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../../frontend/src/App.jsx',import.meta.url),'utf8');
const fileService=fs.readFileSync(new URL('../../frontend/src/services/fileService.js',import.meta.url),'utf8');

test('task detail uploads force a pending create to receive server confirmation before bytes are sent',()=>{
  assert.match(app,/const prepareProjectForUpload = useCallback/);
  assert.match(app,/getPendingCreatedRecords\(actorKey\)\.find/);
  assert.match(app,/operation === 'create'/);
  assert.match(app,/source:'pre-upload-task-confirmed'/);
  const detail=app.slice(app.indexOf('const TaskDetailView'),app.indexOf('function AppShell'));
  const prepare=detail.indexOf('await prepareProjectUploadTarget');
  const upload=detail.indexOf('uploadProjectFile(',prepare);
  assert.ok(prepare >= 0 && upload > prepare);
  assert.match(detail,/TASK_SERVER_CONFIRMATION_PENDING/);
});

test('file upload carries task create identity and preserves structured server failure codes',()=>{
  assert.match(fileService,/form\.append\('taskMutationId', String\(options\.taskMutationId\)\)/);
  assert.match(fileService,/makeFileError\(payload\?\.code \|\| `UPLOAD_HTTP_\$\{xhr\.status\}`/);
  assert.match(fileService,/error\.payload = payload/);
});

test('background server ID replacement also replaces an already-open optimistic task detail',()=>{
  const start=app.indexOf('const applyProjectSnapshot = useCallback');
  const end=app.indexOf('const prepareProjectForUpload = useCallback',start);
  const block=app.slice(start,end);
  assert.match(block,/selectedIds\.some\(value=>replacementIds\.has\(value\)\)/);
  assert.match(block,/const canonicalIncoming=incoming\.find/);
  assert.match(block,/return stable\.find\(project=>String\(project\.id\)===String\(canonicalIncoming\.id\)\) \|\| canonicalIncoming/);
});
