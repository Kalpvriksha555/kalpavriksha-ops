import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../../backend/src/repositories/postgresStateRepository.js', import.meta.url), 'utf8');
const backupCreate = fs.readFileSync(new URL('../../backend/scripts/backup-create.mjs', import.meta.url), 'utf8');
const backupLib = fs.readFileSync(new URL('../../backend/scripts/backup-lib.mjs', import.meta.url), 'utf8');

test('runtime recovery verifies physical row counts and canonical hash before adopting database state', () => {
  assert.match(repository, /reloadRelationalState[\s\S]*verifyPersistedRelationalSnapshot\(parts, metadata\.rows\[0\]\)/);
  assert.match(server, /await reloadCommittedState\(\)/);
  assert.match(server, /runtime_state_recovery_blocked/);
});

test('relational writes cannot wedge the persistence queue indefinitely', () => {
  assert.match(repository, /SET LOCAL lock_timeout = '15s'/);
  assert.match(repository, /SET LOCAL statement_timeout = '120s'/);
  assert.match(repository, /SET LOCAL idle_in_transaction_session_timeout = '120s'/);
  assert.match(server, /query_timeout: boundedEnvNumber\('DB_QUERY_TIMEOUT_MS'/);
});

test('database pool failures are observed instead of becoming uncaught PM2 crash loops', () => {
  assert.match(server, /pool\.on\('error', error =>/);
  assert.match(server, /database_pool_error/);
  assert.match(server, /server_startup_maintenance/);
  assert.match(server, /BACKEND_STARTUP_MAINTENANCE/);
  assert.match(server, /status:shuttingDown \? 'SHUTTING_DOWN' : startupFailure \? 'DEGRADED' : 'ALIVE'/);
  assert.match(server, /res\.status\(healthy \? 200 : 503\)/);
});

test('local fallback writes are atomic and corrupted authentication data is never replaced silently', () => {
  assert.match(server, /function writeJsonAtomic/);
  assert.match(server, /fs\.fsyncSync\(fd\)/);
  assert.match(server, /fs\.renameSync\(temp,target\)/);
  assert.match(server, /writeJsonAtomic\(AUTH_FILE,store\)/);
  assert.match(server, /LOCAL_AUTH_STORE_CORRUPT/);
  assert.match(server, /existing file was preserved and startup was blocked instead of replacing credentials/);
});

test('ephemeral authentication state is bounded without deleting operational business data', () => {
  assert.match(server, /OTP_STORE_MAX/);
  assert.match(server, /pruneOtpChallenges/);
  assert.match(server, /DELETE FROM auth_sessions[\s\S]*interval '30 days'/);
  assert.doesNotMatch(server, /DELETE FROM ops_cases[\s\S]*cleanupExpiredAuthSessions/);
});

test('generated task references use the current India year and remain collision safe after deletions', () => {
  assert.match(server, /function nextCaseNo\(d, city='Lucknow', referenceTime=Date\.now\(\)\)/);
  assert.match(server, /const year=indiaDateKey\(referenceTime\)\.slice\(0,4\)/);
  assert.match(server, /while \(used\.has\(candidate\.toUpperCase\(\)\)\)/);
  assert.doesNotMatch(server, /d\.cases\.length\+1/);
});

test('chat notification file and WhatsApp creates have retry idempotency', () => {
  assert.match(server, /Message mutation id/);
  assert.match(server, /Notification mutation id/);
  assert.match(server, /uploadMutationId/);
  assert.match(server, /DUPLICATE_UPLOAD_MUTATION/);
  assert.match(server, /WhatsApp source message id/);
  assert.match(server, /idempotent:true,sourceMessageId/);
});

test('revision restore cannot overwrite newer work and always preserves a pre-restore safety snapshot', () => {
  assert.match(server, /expectedCurrentVersion/);
  assert.match(server, /RESTORE_VERSION_MISMATCH/);
  assert.match(server, /RESTORE_WRITE_ACTIVITY/);
  assert.match(repository, /pre_restore_safety_/);
  assert.match(repository, /ON CONFLICT \(state_version\) DO NOTHING/);
});

test('repeated unhandled failures trigger a controlled restart instead of leaving a corrupted process alive', () => {
  assert.match(server, /unhandledRejectionTimes/);
  assert.match(server, /REPEATED_UNHANDLED_REJECTION/);
  assert.match(server, /gracefulShutdown\('UNCAUGHT_EXCEPTION',1\)/);
});


test('backup commands have progress, stale-lock recovery, bounded deadlines, and partial cleanup', () => {
  assert.match(backupCreate, /BACKUP_STALE_LOCK_MS/);
  assert.match(backupCreate, /database export started/);
  assert.match(backupCreate, /private file archive started from stable snapshot/);
  assert.match(backupCreate, /rsync-converged-snapshot/);
  assert.match(backupCreate, /BACKUP_FILE_SNAPSHOT_ATTEMPTS/);
  assert.match(backupCreate, /--dry-run/);
  assert.match(backupCreate, /--itemize-changes/);
  assert.match(backupCreate, /BACKUP_DATABASE_TIMEOUT_MS/);
  assert.match(backupCreate, /BACKUP_FILES_TIMEOUT_MS/);
  assert.match(backupCreate, /\.postgres\.dump\.partial/);
  assert.match(backupLib, /BACKUP_COMMAND_TIMEOUT/);
  assert.match(backupLib, /killSignal:'SIGTERM'/);
  assert.match(backupLib, /stdio:'ignore'.*BACKUP_VERIFY_FILES_TIMEOUT_MS/s);
});
