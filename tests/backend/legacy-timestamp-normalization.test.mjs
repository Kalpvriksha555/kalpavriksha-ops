import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeEpochMilliseconds, timestampValue } from '../../backend/src/repositories/postgresStateRepository.js';

test('legacy microsecond timestamps are normalized to milliseconds', () => {
  const legacyMicroseconds = 1782968923198498;
  const milliseconds = normalizeEpochMilliseconds(legacyMicroseconds);
  assert.equal(milliseconds, 1782968923198);
  assert.equal(timestampValue(legacyMicroseconds), '2026-07-02T05:08:43.198Z');
});

test('seconds, milliseconds and nanoseconds normalize to the same operational instant', () => {
  assert.equal(timestampValue(1782968923), '2026-07-02T05:08:43.000Z');
  assert.equal(timestampValue(1782968923000), '2026-07-02T05:08:43.000Z');
  assert.equal(timestampValue(1782968923000000000), '2026-07-02T05:08:43.000Z');
});

test('out-of-range extended-year timestamps fail closed instead of blocking PostgreSQL import', () => {
  assert.equal(timestampValue('+058470-01-13T09:19:58.498Z'), null);
  assert.equal(timestampValue('not-a-date'), null);
});

test('server freshness parsing uses shared epoch-unit normalization', () => {
  const source = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
  assert.match(source, /normalizeEpochMilliseconds\(value\)/);
  assert.match(source, /normalizeEpochMilliseconds\(raw\)/);
});
