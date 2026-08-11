import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  reloadRelationalState,
  getRelationalHealth,
  stateSnapshotHash
} from '../../backend/src/repositories/postgresStateRepository.js';
import {
  classifyPersistenceFailure,
  persistenceCommitEvidenceMatches,
  runtimeRecoveryCanRun
} from '../../backend/src/services/persistenceBackpressureService.js';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../../backend/src/repositories/postgresStateRepository.js', import.meta.url), 'utf8');
const deployScript = fs.readFileSync(new URL('../../scripts/deploy-1.9.30-vps.sh', import.meta.url), 'utf8');

const emptyState = () => ({
  users:[],
  cases:[],
  deletedProjectIds:[],
  payments:[],
  performanceRecords:[],
  notifications:[],
  teamChat:[],
  whatsappInbox:[],
  audit:[],
  attendanceLogs:[],
  files:[],
  chatReads:{}
});

const emptyCounts = () => ({
  users:0,
  cases:0,
  payments:0,
  performanceRecords:0,
  notifications:0,
  teamChat:0,
  whatsappInbox:0,
  audit:0,
  attendanceLogs:0,
  files:0,
  deletedProjectIds:0,
  chatReads:0,
  misc:0
});

function fakeReadPool({ version = 77 } = {}) {
  const queries = [];
  let released = false;
  const state = emptyState();
  const metadata = {
    key:'main',
    state_version:version,
    snapshot_hash:stateSnapshotHash(state),
    entity_counts:emptyCounts(),
    source:'relational',
    updated_at:new Date('2026-08-10T18:00:00.000Z')
  };
  const client = {
    async query(sql) {
      queries.push(String(sql));
      if (/SELECT \* FROM app_state_metadata/.test(sql)) return { rows:[metadata], rowCount:1 };
      if (/SELECT now\(\) AS now/.test(sql)) return { rows:[{ now:new Date('2026-08-10T18:00:00.000Z') }] };
      if (/SELECT version,name,checksum,applied_at FROM schema_migrations/.test(sql)) return { rows:[] };
      if (/SELECT count\(\*\)::int AS count,max\(state_version\)/.test(sql)) return { rows:[{ count:0, latest_version:null, latest_at:null }] };
      return { rows:[], rowCount:0 };
    },
    release() { released = true; }
  };
  return {
    pool:{ connect:async()=>client },
    queries,
    released:()=>released,
    metadata
  };
}

test('runtime reload reads metadata and rows from one repeatable-read PostgreSQL snapshot', async () => {
  const fake = fakeReadPool({ version:91 });
  const loaded = await reloadRelationalState(fake.pool, { normalizeState:value=>value });
  assert.equal(loaded.stateVersion, 91);
  assert.equal(loaded.snapshotHash, fake.metadata.snapshot_hash);
  assert.equal(fake.queries[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.ok(fake.queries.findIndex(sql => /app_state_metadata/.test(sql)) > 0);
  assert.equal(fake.queries.at(-1), 'COMMIT');
  assert.equal(fake.released(), true);
});

test('relational health verifies full snapshot hash inside the same consistent read boundary', async () => {
  const fake = fakeReadPool({ version:92 });
  const health = await getRelationalHealth(fake.pool);
  assert.equal(health.stateVersion, 92);
  assert.equal(health.integrity.ok, true);
  assert.equal(health.integrity.hashMatches, true);
  assert.equal(health.integrity.actualHash, fake.metadata.snapshot_hash);
  assert.equal(fake.queries[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(fake.queries.at(-1), 'COMMIT');
});

test('ambiguous COMMIT acknowledgement is accepted only for exact recovered version and hash', () => {
  const error = {
    commitOutcomeUnknown:true,
    commitEvidence:{ stateVersion:123, snapshotHash:'abc123' }
  };
  assert.equal(persistenceCommitEvidenceMatches(error, { stateVersion:123, snapshotHash:'abc123' }), true);
  assert.equal(persistenceCommitEvidenceMatches(error, { stateVersion:124, snapshotHash:'abc123' }), false);
  assert.equal(persistenceCommitEvidenceMatches(error, { stateVersion:123, snapshotHash:'different' }), false);
  assert.equal(persistenceCommitEvidenceMatches({ ...error, commitOutcomeUnknown:false }, { stateVersion:123, snapshotHash:'abc123' }), false);
});

test('foreground fallback shadow remains fail-closed until PostgreSQL itself is reloaded', () => {
  const outcome = classifyPersistenceFailure({
    reason:'task_update',
    recoverySucceeded:false,
    verifiedFallbackRestored:true,
    usePostgres:true
  });
  assert.equal(outcome.deferred, false);
  assert.equal(outcome.safelyRecovered, false);
  assert.equal(outcome.critical, true);
});

test('runtime reconnect cannot reinitialize state while writes are queued or in flight', () => {
  assert.equal(runtimeRecoveryCanRun({ queueDepth:1 }), false);
  assert.equal(runtimeRecoveryCanRun({ inFlight:1 }), false);
  assert.equal(runtimeRecoveryCanRun({ activeForegroundWrites:1 }), false);
  assert.equal(runtimeRecoveryCanRun({ queueDepth:0, inFlight:0, activeForegroundWrites:0 }), true);
});

test('server restores the verified shadow before exposing read-only runtime state after foreground reload failure', () => {
  assert.match(server, /restoreVerifiedShadowAfterPersistenceFailure\(expectedVersion\)/);
  assert.match(server, /runtime_state_recovery_read_only_shadow/);
  assert.match(server, /startupFailure=\{[\s\S]{0,520}phase:'runtime'/);
  assert.match(server, /runtimeReadOnly = startupFailure\.phase === 'runtime' && memoryState && isSafeMethod/);
});

test('server reconciles response-loss COMMITs and catches runtime memory back up as queued commits drain', () => {
  assert.match(server, /persistenceCommitEvidenceMatches\(error, recoveredState\)/);
  assert.match(server, /relational_commit_ack_reconciled/);
  assert.match(server, /commitConfirmedAfterReconnect:true/);
  assert.match(server, /Number\(stateVersion\) < Number\(targetVersion\)[\s\S]{0,420}publishCommittedState/);
});

test('repository captures commit evidence before COMMIT and independently verifies an ambiguous outcome', () => {
  assert.match(repository, /commitEvidence = \{[\s\S]{0,180}stateVersion:Number\(targetVersion\)[\s\S]{0,120}snapshotHash:hash/);
  assert.match(repository, /commitAttempted = true;\s*await client\.query\('COMMIT'\)/);
  assert.match(repository, /confirmRelationalCommitEvidence\(pool, commitEvidence\)/);
  assert.match(repository, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(repository, /commitConfirmedAfterReconnect:true/);
});

test('runtime recovery drains the persistence pipeline and reloads instead of resetting initStore state', () => {
  const start = server.indexOf('async function attemptStartupRecovery()');
  const end = server.indexOf('function scheduleStartupRecovery()', start);
  const block = server.slice(start, end);
  assert.match(block, /runtimeRecoveryCanRun/);
  assert.match(block, /await ensurePostgres\(\);\s*await reloadCommittedState\(\);/);
  assert.match(block, /if \(recoveryPhase === 'runtime' && memoryState\)/);
  assert.match(block, /presenceMutationGeneration > persistedPresenceGeneration/);
});

test('graceful shutdown still flushes deferred presence and waits for persistence before closing PostgreSQL', () => {
  const start = server.indexOf('async function gracefulShutdown');
  const end = server.indexOf('async function startServer()', start);
  const block = server.slice(start, end);
  const flush = block.indexOf('flushPresenceHeartbeatBatch');
  const queue = block.indexOf('await persistenceQueue.catch');
  const closePool = block.indexOf('await pool.end');
  assert.ok(flush >= 0 && queue > flush && closePool > queue);
});


test('PM2 starts preserve enough time for the backend graceful shutdown ceiling', () => {
  assert.match(server, /GRACEFUL_SHUTDOWN_TIMEOUT_MS',15000,5000,120000/);
  assert.match(deployScript, /PM2_KILL_TIMEOUT_MS="\$\{PM2_KILL_TIMEOUT_MS:-125000\}"/);
  const starts = deployScript.match(/pm2 start [^\n]+/g) || [];
  assert.ok(starts.length >= 3, 'expected staging, permanent and rollback PM2 starts');
  for (const command of starts) assert.match(command, /--kill-timeout "\$PM2_KILL_TIMEOUT_MS"/);
  assert.match(deployScript, /PM2_KILL_TIMEOUT_MS >= 125000/);
});
