import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  authorizationActor,
  hasCapability,
  canAccessCase,
  filterCasesForUser,
  canMutateCase,
  notificationBelongsToUser,
  canAccessFileDocument,
  canDeleteFileDocument,
} from '../../backend/src/services/authorizationService.js';
import {
  decomposeState,
  recomposeState,
  verifyPersistedRelationalSnapshot,
} from '../../backend/src/repositories/postgresStateRepository.js';
import { extractCasesFromRecoverySource } from '../../backend/src/services/releaseCertificationService.js';

test('authorization boundaries fail closed for explicit null users, cases, files and malformed rows', () => {
  assert.deepEqual(authorizationActor(null), { id:'', username:'', name:'Team member', role:'' });
  assert.equal(hasCapability(null, 'state:read'), false);
  assert.equal(canAccessCase(null, null), false);
  assert.deepEqual(filterCasesForUser([null, { id:'CASE-1' }], null), []);
  assert.equal(canMutateCase(null, null, 'update'), false);
  assert.equal(notificationBelongsToUser(null, null), false);
  assert.equal(canAccessFileDocument(null, null, [null]), false);
  assert.equal(canDeleteFileDocument(null, null, [null]), false);
});

test('relational persistence rejects null structural state explicitly instead of crashing or treating it as empty data', () => {
  for (const operation of [
    () => decomposeState(null),
    () => decomposeState({ cases:{} }),
    () => decomposeState({ users:'corrupt' }),
    () => decomposeState({ chatReads:[] }),
    () => recomposeState(null),
    () => recomposeState({ cases:{} }),
    () => recomposeState({ misc:[] }),
    () => verifyPersistedRelationalSnapshot({}, null),
  ]) {
    assert.throws(operation, (error) => error?.code === 'RELATIONAL_STATE_INVALID');
  }
});

test('release recovery and runtime event/timeline boundaries normalize explicit null input safely', () => {
  assert.deepEqual(extractCasesFromRecoverySource(null), []);
  const timelineSource = fs.readFileSync(new URL('../../backend/src/services/timelineService.js', import.meta.url), 'utf8');
  const reliabilitySource = fs.readFileSync(new URL('../../backend/src/services/operationalReliabilityService.js', import.meta.url), 'utf8');
  const fileStorageSource = fs.readFileSync(new URL('../../backend/src/services/fileStorageService.js', import.meta.url), 'utf8');
  assert.match(timelineSource, /event = event && typeof event === 'object' \? event : \{\}/);
  assert.match(timelineSource, /fallback = fallback && typeof fallback === 'object' \? fallback : \{\}/);
  assert.match(reliabilitySource, /event = event && typeof event === 'object' \? event : \{\}/);
  assert.match(fileStorageSource, /options = options && typeof options === 'object' \? options : \{\}/);
});
