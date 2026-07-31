import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const fileService = fs.readFileSync(new URL('../../frontend/src/services/fileService.js', import.meta.url), 'utf8');

test('file deletion rejects non-success responses instead of silently removing the local card', () => {
  assert.match(fileService, /if \(!response\.ok\) \{/);
  assert.match(fileService, /throw error;/);
  const start = app.indexOf('const handleFileDelete = async');
  const end = app.indexOf('const handleLedgerScreenshot', start);
  const block = app.slice(start, end);
  assert.match(block, /try \{[\s\S]*await deleteProjectFileFromServer\(docToDelete\);[\s\S]*\} catch \(error\) \{[\s\S]*return;[\s\S]*\}/);
  assert.ok(block.indexOf('await deleteProjectFileFromServer') < block.indexOf('const updatedProject'));
});
