import fs from 'fs';
import path from 'path';
import assert from 'assert/strict';
import { fileURLToPath } from 'url';
import {
  RELATIONAL_MIGRATIONS,
  decomposeState,
  recomposeState,
  stableStringify,
  stateSnapshotHash
} from '../backend/src/repositories/postgresStateRepository.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverSource = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
const repositorySource = fs.readFileSync(path.join(root, 'backend/src/repositories/postgresStateRepository.js'), 'utf8');

const sample = {
  users: [{ id:'u2', username:'beta', role:'DESIGNER' }, { id:'u1', username:'admin', role:'ADMIN' }],
  cases: [
    { id:'c2', caseId:'KV-002', status:'ASSIGNED', financeVersion:4, ledger:{received:1200} },
    { id:'c1', caseId:'KV-001', status:'COMPLETED', documents:[{id:'f1'}] }
  ],
  payments: [{ caseId:'c2', amount:1200, paymentDate:'2026-07-28T10:00:00.000Z' }, null],
  performanceRecords: [{ userId:'u2', period:'2026-07', completed:1 }],
  notifications: [{ id:'n2', to:'u2' }, { id:'n1', to:'ADMIN' }],
  teamChat: [{ id:'m2', sender:'beta', recipient:'global' }, { id:'m1', sender:'admin', recipient:'beta' }],
  whatsappInbox: [{ id:'w1', from:'banker' }],
  audit: [{ at:'2026-07-30T00:00:00.000Z', by:'admin', action:'test' }],
  attendanceLogs: [{ userId:'u2', date:'2026-07-30', status:'PRESENT' }],
  files: [{ id:'f1', caseId:'c1', storedName:'safe.pdf' }],
  deletedProjectIds:['old-2','old-1'],
  chatReads:{ ADMIN:['m2'], DESIGNER:['m1'] },
  customSettings:{ featureFlag:true, nested:{ b:2, a:1 } }
};

const parts = decomposeState(sample);
assert.equal(parts.payments.length, 1, 'null payment records must not enter relational storage');
assert.deepEqual(parts.users.map(row => row.payload.id), ['u2','u1'], 'collection order must be retained');
assert.equal(new Set(parts.audit.map(row => row.id)).size, parts.audit.length, 'generated relational ids must be unique');
const rebuilt = recomposeState(parts);
assert.equal(stateSnapshotHash(rebuilt), stateSnapshotHash({ ...sample, payments:sample.payments.filter(Boolean) }), 'relational round trip must preserve the canonical state hash');
assert.equal(stableStringify({b:2,a:1}), stableStringify({a:1,b:2}), 'hash serialization must be key-order independent');

assert.equal(RELATIONAL_MIGRATIONS.length >= 4, true, 'Phase 5 migration set is incomplete');
assert.equal(new Set(RELATIONAL_MIGRATIONS.map(item => item.version)).size, RELATIONAL_MIGRATIONS.length, 'migration versions must be unique');
assert.equal(new Set(RELATIONAL_MIGRATIONS.map(item => item.checksum)).size, RELATIONAL_MIGRATIONS.length, 'migration checksums must be unique');
for (const item of RELATIONAL_MIGRATIONS) {
  assert.match(item.version, /^\d{3}\.\d{3}$/);
  assert.match(item.checksum, /^[a-f0-9]{64}$/);
}

for (const table of [
  'schema_migrations','app_state_metadata','ops_users','ops_cases','ops_payments',
  'ops_notifications','ops_chat_messages','ops_attendance_logs','ops_audit_events',
  'ops_performance_records','ops_whatsapp_inbox','ops_files','ops_deleted_projects',
  'ops_chat_reads','ops_misc_state','state_revisions'
]) assert.ok(repositorySource.includes(table), `Missing relational table: ${table}`);

for (const integration of ['loadRelationalState','persistRelationalState','reloadRelationalState','getRelationalHealth','restoreRelationalRevision']) {
  assert.ok(serverSource.includes(integration), `Server is not integrated with ${integration}`);
}
assert.ok(!serverSource.includes("UPDATE app_state SET value="), 'The legacy app_state row must not remain the authoritative write path');
assert.ok(repositorySource.includes('MIGRATION_CHECKSUM_MISMATCH'), 'Migration checksum drift must block startup');
assert.ok(repositorySource.includes('RELATIONAL_STATE_INTEGRITY_FAILURE'), 'Relational count/hash mismatch must block startup');
assert.ok(repositorySource.includes('STATE_VERSION_CONFLICT'), 'Optimistic concurrency protection is required');
assert.ok(repositorySource.includes('enforce_known_ops_case_reference'), 'Future payment/file case-reference guards are missing');
assert.ok(serverSource.includes('RESTORE ${revisionId}'), 'Revision restoration must require explicit confirmation');

console.log(JSON.stringify({
  ok:true,
  phase:5,
  migrations:RELATIONAL_MIGRATIONS.map(item => ({version:item.version,name:item.name,checksum:item.checksum})),
  roundTripHash:stateSnapshotHash(rebuilt),
  tablesVerified:16
}, null, 2));
