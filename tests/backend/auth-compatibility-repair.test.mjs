import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileLegacyCredential } from '../../backend/src/services/authService.js';

test('legacy password migration keeps approved established users operational', () => {
  const result = reconcileLegacyCredential({
    credential: {
      user_id: 'manager-1',
      username: 'amit',
      role: 'MANAGER',
      status: 'APPROVED',
      must_change_password: true,
      failed_attempts: 5,
      locked_until: '2026-07-31T06:00:00.000Z',
      password_changed_at: null
    },
    user: { id: 'manager-1', username: 'amit', role: 'Manager', status: 'APPROVED' },
    legacyCandidate: { id: 'manager-1', username: 'amit', password: 'existing-password' }
  });

  assert.equal(result.repairedLegacyMigration, true);
  assert.equal(result.credential.must_change_password, false);
  assert.equal(result.credential.failed_attempts, 0);
  assert.equal(result.credential.locked_until, null);
  assert.equal(result.credential.role, 'MANAGER');
  assert.equal(result.credential.status, 'APPROVED');
});

test('administrator-issued temporary password remains mandatory after a reset', () => {
  const result = reconcileLegacyCredential({
    credential: {
      user_id: 'designer-1',
      username: 'faraz',
      role: 'DESIGNER',
      status: 'APPROVED',
      must_change_password: true,
      password_changed_at: '2026-07-31T05:00:00.000Z'
    },
    user: { id: 'designer-1', username: 'faraz', role: 'Designer', status: 'APPROVED' },
    legacyCandidate: { id: 'designer-1', username: 'faraz', password: 'old-password' }
  });

  assert.equal(result.repairedLegacyMigration, false);
  assert.equal(result.credential.must_change_password, true);
});

test('intentionally restricted legacy account is not automatically re-enabled', () => {
  const result = reconcileLegacyCredential({
    credential: {
      user_id: 'designer-2',
      username: 'restricted-user',
      role: 'DESIGNER',
      status: 'RESTRICTED',
      must_change_password: true,
      password_changed_at: null
    },
    user: { id: 'designer-2', username: 'restricted-user', role: 'Designer', status: 'RESTRICTED' },
    legacyCandidate: { id: 'designer-2', username: 'restricted-user', password: 'old-password' }
  });

  assert.equal(result.repairedLegacyMigration, false);
  assert.equal(result.credential.status, 'RESTRICTED');
  assert.equal(result.credential.must_change_password, true);
});
