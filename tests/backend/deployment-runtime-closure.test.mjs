import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const deploy = fs.readFileSync(new URL('../../scripts/deploy-1.9.29-vps.sh', import.meta.url), 'utf8');
const launcher = fs.readFileSync(new URL('../../scripts/launch-deploy-1.9.29-vps.sh', import.meta.url), 'utf8');
const backup = fs.readFileSync(new URL('../../backend/scripts/backup-create.mjs', import.meta.url), 'utf8');
const reliability = fs.readFileSync(new URL('../../backend/src/services/operationalReliabilityService.js', import.meta.url), 'utf8');
const certify = fs.readFileSync(new URL('../../scripts/release-certify.mjs', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');

test('production deployment has an exclusive cross-release flock before any live mutation', () => {
  const lockIndex = deploy.indexOf('flock -n 8');
  const rollbackCaptureIndex = deploy.indexOf('Capturing the currently running backend for immutable rollback');
  const stopIndex = deploy.indexOf('pm2 stop "$PM2_NAME"');
  assert.ok(lockIndex >= 0, 'exclusive flock is missing');
  assert.ok(rollbackCaptureIndex > lockIndex, 'rollback capture must happen after exclusive lock');
  assert.ok(stopIndex > rollbackCaptureIndex, 'live backend stop must happen after lock and rollback capture');
  assert.match(deploy, /Another Kalpavriksha deployment is already running/);
  assert.match(deploy, /ROLLBACK_CAPTURED/);
  assert.match(deploy, /LIVE_MUTATED/);
  assert.match(deploy, /live runtime was modified; the current PM2 runtime was left untouched/);
});

test('deployment pauses automatic backup timers around exact pre/post deployment backups and restores them on rollback', () => {
  const pauseIndex = deploy.indexOf('pause_backup_timers');
  const preBackupIndex = deploy.indexOf('npm run backup:create | tee "$WORK/pre-deployment-backup.json"');
  const resumeIndex = deploy.lastIndexOf('resume_backup_timers');
  assert.ok(pauseIndex >= 0 && preBackupIndex > pauseIndex);
  assert.ok(resumeIndex > preBackupIndex);
  assert.match(deploy, /kalpavriksha-backup\.timer/);
  assert.match(deploy, /kalpavriksha-database-backup\.timer/);
  assert.match(deploy, /\.backup\.lock/);
  const rollback = deploy.slice(deploy.indexOf('restore_previous_runtime()'), deploy.indexOf('trap restore_previous_runtime'));
  assert.match(rollback, /resume_backup_timers/);
});

test('private-file backup archives a converged snapshot instead of the mutable live storage root', () => {
  assert.match(backup, /rsync-converged-snapshot/);
  assert.match(backup, /createStablePrivateFileSnapshot/);
  assert.match(backup, /--checksum/);
  assert.match(backup, /--dry-run/);
  assert.match(backup, /--itemize-changes/);
  assert.match(backup, /private file archive started from stable snapshot/);
  assert.match(backup, /'-C',snapshotRoot/);
  assert.doesNotMatch(backup, /'-C',storageRoot,'.'/);
  assert.match(backup, /KALPA_BACKUP_ROOT must not be inside KALPA_FILE_STORAGE_ROOT/);
  assert.match(backup, /fs\.rmSync\(snapshotRoot,\{recursive:true,force:true\}\)/);
});

test('a failed newest backup attempt does not hide a still-fresh verified recovery point', () => {
  assert.match(reliability, /latestVerified/);
  assert.match(reliability, /LATEST_BACKUP_ATTEMPT_FAILED/);
  assert.match(reliability, /ok: fresh/);
  assert.match(certify, /status\.latestVerified \|\| status\.latest/);
  assert.match(server, /latest backup attempt failed, but a recent verified recovery point remains available/i);
});

test('the operator launcher detaches deployment from SSH without Type=oneshot startup semantics', () => {
  assert.match(launcher, /systemd-run/);
  assert.match(launcher, /--property=Type=simple/);
  assert.match(launcher, /--property=TimeoutStartSec=0/);
  assert.doesNotMatch(launcher, /Type=oneshot/);
  assert.match(launcher, /kalpavriksha-deploy-last-unit/);
});

test('rollback restores the previous permanent live source as well as PM2 and frontend build', () => {
  const captureIndex = deploy.indexOf('Capturing the permanent live source tree for full rollback parity');
  const stopIndex = deploy.indexOf('pm2 stop "$PM2_NAME"');
  assert.ok(captureIndex >= 0, 'permanent live source rollback snapshot is missing');
  assert.ok(stopIndex > captureIndex, 'live source must be captured before application writes are stopped');
  assert.match(deploy, /LIVE_SOURCE_ROLLBACK="\$WORK\/previous-live-source"/);

  const rollback = deploy.slice(deploy.indexOf('restore_previous_runtime()'), deploy.indexOf('trap restore_previous_runtime'));
  assert.match(rollback, /Restoring the previous permanent live source tree/);
  assert.match(rollback, /rsync -a --delete "\$LIVE_SOURCE_ROLLBACK\/" "\$LIVE\/"/);
  assert.match(rollback, /rollback-source-parity\.json/);
  assert.match(rollback, /frontend\/dist\.next/);
  assert.match(rollback, /frontend\/dist\.previous/);
});

test('final deployment verification uses CLI database integrity and public health probes without anonymously calling protected db health', () => {
  const finalIndex = deploy.indexOf('Running final database integrity and public runtime health checks');
  assert.ok(finalIndex >= 0, 'final production verification block is missing');
  const finalBlock = deploy.slice(finalIndex, deploy.indexOf('Creating and verifying the first post-deployment backup', finalIndex));
  assert.match(finalBlock, /npm run db:integrity --prefix backend/);
  assert.match(finalBlock, /\/api\/health\/live/);
  assert.match(finalBlock, /\/api\/health\/ready/);
  assert.doesNotMatch(finalBlock, /curl[^\n]*\/api\/db\/health/);
  assert.match(server, /app\.get\('\/api\/db\/health', requireAdminSession/);
});

