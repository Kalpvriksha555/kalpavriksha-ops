import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneBackups } from '../../backend/scripts/backup-lib.mjs';

test('automatic backup pruning does not remove recovery points, even when old', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalpa-safe-prune-'));
  try {
    const names = ['first.manifest.json', 'first.postgres.dump', 'second.manifest.json', 'second.postgres.dump'];
    for (const name of names) fs.writeFileSync(path.join(dir, name), name);
    const veryOld = new Date('2020-01-01T00:00:00Z');
    for (const name of names) fs.utimesSync(path.join(dir, name), veryOld, veryOld);
    assert.deepEqual(pruneBackups(dir, { retentionCount: 1, retentionDays: 1 }), []);
    for (const name of names) assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), name);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('failed verification cannot initiate automatic pruning', () => {
  const source = fs.readFileSync(new URL('../../backend/scripts/backup-create.mjs', import.meta.url), 'utf8');
  assert.match(source, /manifest\.ok\s*\?\s*pruneBackups\(/);
});
