import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(path.resolve(here, '../../backend/src/server.js'), 'utf8');

test('backend notification reads are actor-specific arrays and never persist scalar readBy strings', () => {
  assert.match(serverSource, /function normalizeReadByEntries\(value\)/);
  assert.match(serverSource, /function readByIncludesActor\(value, actor = \{\}\)/);
  assert.match(serverSource, /function appendReadByActor\(value, actor = \{\}, readAt = now\(\)\)/);
  assert.match(serverSource, /\.map\(normalizeNotificationForClient\)/);
  assert.doesNotMatch(serverSource, /notification\.readBy\s*=\s*actor\.name/);
  assert.doesNotMatch(serverSource, /notification\.readBy\s*=\s*requestActor\(req\)\.name/);
});

test('read-all selection is based on the current actor read marker instead of shared notification status', () => {
  assert.match(serverSource, /!readByIncludesActor\(notification\.readBy, actor\)/);
});

test('bootstrap and chat recipient checks defend non-array persisted collection shapes before .some()', () => {
  assert.match(serverSource, /Array\.isArray\(message\?\.mentions\) \? message\.mentions : \[\]\)\.some/);
  assert.match(serverSource, /Array\.isArray\(d\.users\) \? d\.users : \[\]\)\.some/);
});

test('new notifications initialize the canonical readBy array', () => {
  const initializers = serverSource.match(/status:'UNREAD',readBy:\[\]/g) || [];
  assert.ok(initializers.length >= 2);
});
