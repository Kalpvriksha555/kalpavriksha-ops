import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const findings = [];
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const requireFile = file => {
  if (!fs.existsSync(path.join(root, file))) findings.push({ file, message:'Required Phase 18 source/test file is missing.' });
};
const requirePattern = (file, pattern, message) => {
  if (!fs.existsSync(path.join(root, file))) return;
  if (!pattern.test(read(file))) findings.push({ file, message, pattern:String(pattern) });
};
const forbidPattern = (file, pattern, message) => {
  if (!fs.existsSync(path.join(root, file))) return;
  if (pattern.test(read(file))) findings.push({ file, message, pattern:String(pattern) });
};

for (const file of [
  'backend/src/server.js',
  'backend/src/repositories/postgresStateRepository.js',
  'backend/src/services/persistenceBackpressureService.js',
  'scripts/deploy-1.9.30-vps.sh',
  'tests/backend/runtime-persistence-recovery.test.mjs',
  'tests/backend/phase18-runtime-persistence-restart-closure.test.mjs'
]) requireFile(file);

// Metadata, row data and hash verification must describe one PostgreSQL MVCC
// snapshot. Autocommit metadata + row reads can manufacture a false integrity
// mismatch if a concurrent writer commits between them.
requirePattern('backend/src/repositories/postgresStateRepository.js', /async function reloadRelationalState[\s\S]*BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY[\s\S]*verifyPersistedRelationalSnapshot/, 'Runtime reload must verify metadata and rows inside one repeatable-read read-only transaction.');
requirePattern('backend/src/repositories/postgresStateRepository.js', /export async function loadRelationalState[\s\S]*BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/, 'Normal relational load must use a consistent repeatable-read snapshot once metadata exists.');
requirePattern('backend/src/repositories/postgresStateRepository.js', /export async function getRelationalHealth[\s\S]*BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY[\s\S]*actualHash[\s\S]*hashMatches/, 'Relational health must verify the full state hash inside a consistent snapshot.');

// PostgreSQL can commit and then lose the socket before Node receives the COMMIT
// acknowledgement. Exact version+hash evidence is required before reporting that
// ambiguous transaction as durable.
requirePattern('backend/src/repositories/postgresStateRepository.js', /commitEvidence = \{[\s\S]{0,220}stateVersion:Number\(targetVersion\)[\s\S]{0,180}snapshotHash:hash/, 'Persistence must capture exact commit evidence before COMMIT.');
requirePattern('backend/src/repositories/postgresStateRepository.js', /commitAttempted = true;\s*await client\.query\('COMMIT'\)/, 'Persistence must mark COMMIT acknowledgement as ambiguous only after COMMIT is attempted.');
requirePattern('backend/src/repositories/postgresStateRepository.js', /async function confirmRelationalCommitEvidence[\s\S]*BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY[\s\S]*verifyPersistedRelationalSnapshot/, 'Ambiguous COMMIT confirmation must independently re-read and verify physical relational state.');
requirePattern('backend/src/services/persistenceBackpressureService.js', /export function persistenceCommitEvidenceMatches[\s\S]*commitOutcomeUnknown[\s\S]*stateVersion[\s\S]*snapshotHash/, 'Server reconciliation must require an explicitly ambiguous outcome plus exact stateVersion and snapshotHash.');
requirePattern('backend/src/server.js', /persistenceCommitEvidenceMatches\(error, recoveredState\)[\s\S]{0,500}relational_commit_ack_reconciled/, 'Server must reconcile exact durable COMMIT evidence after response loss.');

// A failed foreground optimistic mutation may never remain visible merely because
// PostgreSQL is temporarily unavailable. Restore the last verified shadow for
// reads, but keep writes fail-closed until a real relational reload succeeds.
requirePattern('backend/src/server.js', /restoreVerifiedShadowAfterPersistenceFailure\(expectedVersion\)/, 'All persistence failures must be able to restore the last verified relational shadow.');
requirePattern('backend/src/server.js', /runtime_state_recovery_read_only_shadow/, 'Foreground recovery failure must expose only verified read-only shadow state.');
requirePattern('backend/src/services/persistenceBackpressureService.js', /const safelyRecovered = Boolean\(recoverySucceeded \|\| \(deferred && verifiedFallbackRestored\)\)/, 'A foreground shadow fallback must remain critical until PostgreSQL itself is reloaded.');
forbidPattern('backend/src/server.js', /restoreVerifiedShadowAfterDeferredFailure/, 'The old deferred-only shadow recovery helper must not return.');

// Runtime reconnect must not reset mutable bookkeeping while writes are queued.
requirePattern('backend/src/services/persistenceBackpressureService.js', /export function runtimeRecoveryCanRun[\s\S]*queueDepth[\s\S]*inFlight[\s\S]*activeForegroundWrites/, 'Runtime recovery must be gated on a completely drained persistence/write pipeline.');
const server = fs.existsSync(path.join(root, 'backend/src/server.js')) ? read('backend/src/server.js') : '';
const recoveryStart = server.indexOf('async function attemptStartupRecovery()');
const recoveryEnd = server.indexOf('function scheduleStartupRecovery()', Math.max(0, recoveryStart));
const recoveryBlock = recoveryStart >= 0 && recoveryEnd > recoveryStart ? server.slice(recoveryStart, recoveryEnd) : '';
if (!/runtimeRecoveryCanRun/.test(recoveryBlock) || !/await ensurePostgres\(\);\s*await reloadCommittedState\(\);/.test(recoveryBlock)) {
  findings.push({ file:'backend/src/server.js', message:'Runtime recovery must wait for drain, reconnect PostgreSQL and reload committed state.' });
}
const runtimeBranchStart = recoveryBlock.indexOf("if (recoveryPhase === 'runtime' && memoryState)");
const coldElseStart = recoveryBlock.indexOf('} else {', Math.max(0, runtimeBranchStart));
const runtimeBranch = runtimeBranchStart >= 0 && coldElseStart > runtimeBranchStart ? recoveryBlock.slice(runtimeBranchStart, coldElseStart) : '';
if (!runtimeBranch || /await initStore\(\)/.test(runtimeBranch)) {
  findings.push({ file:'backend/src/server.js', message:'Runtime recovery must not reset state through initStore().' });
}
requirePattern('backend/src/server.js', /Number\(stateVersion\) < Number\(targetVersion\)[\s\S]{0,500}publishCommittedState/, 'Later queued commits must republish verified state if a recovery reload temporarily moved runtime state behind PostgreSQL.');

// Shutdown ordering and PM2 timing must give the backend enough time to stop
// intake, flush deferred presence, drain persistence, and then close PostgreSQL.
requirePattern('backend/src/server.js', /async function gracefulShutdown[\s\S]*flushPresenceHeartbeatBatch[\s\S]*await persistenceQueue\.catch[\s\S]*await pool\.end/, 'Graceful shutdown must flush presence and drain persistence before closing PostgreSQL.');
requirePattern('backend/src/server.js', /GRACEFUL_SHUTDOWN_TIMEOUT_MS',15000,5000,120000/, 'Backend graceful shutdown ceiling must remain explicit and bounded.');
requirePattern('scripts/deploy-1.9.30-vps.sh', /PM2_KILL_TIMEOUT_MS="\$\{PM2_KILL_TIMEOUT_MS:-125000\}"/, 'Deployment must give PM2 more time than the backend maximum graceful-shutdown window.');
const deploy = fs.existsSync(path.join(root, 'scripts/deploy-1.9.30-vps.sh')) ? read('scripts/deploy-1.9.30-vps.sh') : '';
const starts = deploy.match(/pm2 start [^\n]+/g) || [];
if (starts.length < 3 || starts.some(command => !/--kill-timeout "\$PM2_KILL_TIMEOUT_MS"/.test(command))) {
  findings.push({ file:'scripts/deploy-1.9.30-vps.sh', message:'Rollback, staged and permanent PM2 starts must all persist the extended kill timeout.' });
}

// Regression and permanent release wiring.
requirePattern('tests/backend/phase18-runtime-persistence-restart-closure.test.mjs', /ambiguous COMMIT acknowledgement is accepted only for exact recovered version and hash/, 'Ambiguous COMMIT regression coverage is missing.');
requirePattern('tests/backend/phase18-runtime-persistence-restart-closure.test.mjs', /runtime reconnect cannot reinitialize state while writes are queued or in flight/, 'Runtime drain-gate regression coverage is missing.');
requirePattern('tests/backend/phase18-runtime-persistence-restart-closure.test.mjs', /PM2 starts preserve enough time for the backend graceful shutdown ceiling/, 'PM2 graceful-stop regression coverage is missing.');
requirePattern('package.json', /"verify:persistence-restart"\s*:\s*"node scripts\/phase-18-runtime-persistence-restart-check\.mjs"/, 'Phase 18 verifier is not registered in package.json.');
requirePattern('package.json', /npm run verify:finance-ledger && npm run verify:persistence-restart && npm run verify:long-session && npm run verify:diagnostics && npm run verify:deployment-resume && npm run verify:fault-soak && npm run verify:certification-local-postgres && npm run verify:operator-deploy && npm run verify:frontend-runtime/, 'Phase 18 verifier must run immediately after Phase 17 in the normal verification chain.');
requirePattern('scripts/full-release-verifier-matrix.mjs', /id:'runtime-persistence-restart'[\s\S]*phase-18-runtime-persistence-restart-check\.mjs/, 'Phase 18 verifier is not part of the full release matrix.');

if (findings.length) {
  console.error(`Phase 18 PostgreSQL runtime persistence/restart closure FAILED with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.message}`);
  process.exit(1);
}

console.log('Phase 18 PostgreSQL runtime persistence/restart closure PASS (consistent MVCC reads, ambiguous-COMMIT proof, fail-closed shadow recovery, drained runtime reconnect and graceful PM2 shutdown present).');
