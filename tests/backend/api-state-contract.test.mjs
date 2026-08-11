import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.join(process.cwd(), 'backend/src/server.js'), 'utf8');

test('workspace sync descriptor carries every revision marker required by the browser contract', () => {
  assert.match(source, /stateVersion:Number\(stateVersion\s*\|\|\s*0\)/);
  assert.match(source, /dataRevision:Number\(workspaceDataRevision\s*\|\|\s*0\)/);
  assert.match(source, /presenceGeneration:Number\(presenceMutationGeneration\s*\|\|\s*0\)/);
  assert.match(source, /collectionRevisions:\{ \.\.\.workspaceCollectionRevisions \}/);
  assert.match(source, /syncToken:`\$\{Number\(workspaceDataRevision \|\| 0\)\}\.\$\{Number\(presenceMutationGeneration \|\| 0\)\}`/);
});

test('state endpoint includes the same sync descriptor in unchanged, presence and workspace partial responses', () => {
  assert.match(source, /unchanged:true,[\s\S]{0,320}\.\.\.sync/);
  assert.match(source, /partial:'presence',[\s\S]{0,520}\.\.\.sync/);
  assert.match(source, /partial:'workspace',[\s\S]{0,900}\.\.\.sync/);
  assert.match(source, /changedCollections,[\s\S]{0,700}scopedStateCollections/);
});


test('chat create success and idempotent replay use one explicit confirmed response envelope', () => {
  assert.match(source, /existingMessage\) return res\.json\(\{ok:true,idempotent:true,message:existingMessage\}\)/);
  assert.match(source, /chat_message_create[\s\S]{0,220}res\.status\(201\)\.json\(\{ok:true,message:msg\}\)/);
});
