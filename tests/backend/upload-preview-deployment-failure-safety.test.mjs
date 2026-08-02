import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const deploy = fs.readFileSync(new URL('../../scripts/deploy-upload-preview-irregularity-closure-only-vps.sh', import.meta.url), 'utf8');

const pos = (needle) => {
  const value = deploy.indexOf(needle);
  assert.notEqual(value, -1, `Missing deployment marker: ${needle}`);
  return value;
};

test('rollback copy is complete and verified before PM2 downtime', () => {
  const backup = pos('log "Creating and verifying the runtime rollback copy"');
  const backupServer = deploy.indexOf('cp -a "$LIVE/backend/src/server.js" "$BACKUP/server.js"', backup);
  const backupService = deploy.indexOf('cp -a "$LIVE/backend/src/services/fileStorageService.js" "$BACKUP/fileStorageService.js"', backup);
  const backupDist = deploy.indexOf('cp -a "$LIVE/frontend/dist" "$BACKUP/dist"', backup);
  const stop = deploy.indexOf('pm2 stop "$PM2_NAME"', pos('log "Stopping the backend for the short runtime cutover"'));
  for (const [label, value] of Object.entries({ backupServer, backupService, backupDist, stop })) assert.notEqual(value, -1, `Missing ${label}`);
  assert.ok(backup < backupServer && backupServer < stop);
  assert.ok(backupService < stop && backupDist < stop);
  assert.match(deploy, /tree_hash "\$BACKUP\/dist"/);
});

test('any partial cutover restores both backend files and the complete previous frontend', () => {
  const cutoverFlag = pos('CUTOVER_STARTED=1');
  const serverMove = pos('mv -f "$NEXT_SERVER" "$LIVE/backend/src/server.js"');
  const serviceMove = pos('mv -f "$NEXT_FILE_SERVICE" "$LIVE/backend/src/services/fileStorageService.js"');
  const oldDistMove = pos('mv "$LIVE/frontend/dist" "$OLD_DIST"');
  const newDistMove = pos('mv "$NEXT_DIST" "$LIVE/frontend/dist"');
  assert.ok(cutoverFlag < serverMove);
  assert.ok(serverMove < serviceMove && serviceMove < oldDistMove && oldDistMove < newDistMove);

  assert.match(deploy, /if \[\[ "\$CUTOVER_STARTED" == "1" \]\]/);
  assert.match(deploy, /cp -a "\$BACKUP\/server\.js" "\$LIVE\/backend\/src\/server\.js"/);
  assert.match(deploy, /cp -a "\$BACKUP\/fileStorageService\.js" "\$LIVE\/backend\/src\/services\/fileStorageService\.js"/);
  assert.match(deploy, /if \[\[ -d "\$OLD_DIST" \]\]/);
  assert.match(deploy, /elif \[\[ -d "\$BACKUP\/dist" \]\]/);
  assert.match(deploy, /restart_previous_backend/);
});

test('successful restart proves permanent PM2 path, working directory, health and changed process generation', () => {
  assert.match(deploy, /PM2 is not running the permanent live backend path/);
  assert.match(deploy, /PM2 watch mode must be disabled/);
  assert.match(deploy, /PM2 working directory is not/);
  assert.match(deploy, /New backend did not become READY within 90 seconds/);
  assert.match(deploy, /PM2 restarted a non-live script path/);
  assert.match(deploy, /PM2 restarted with the wrong working directory/);
  assert.match(deploy, /PM2 did not report a new process identity or restart generation/);
});

test('release evidence is hash-pinned and written atomically only after health succeeds', () => {
  const ready = pos('wait_ready "/tmp/kalpavriksha-ready-${STAMP}.json" || fail "New backend did not become READY within 90 seconds"');
  const record = pos('log "Recording the successful pinned deployment atomically"');
  const move = pos('mv -f "$RELEASE_TMP" "$RELEASE_RECORD"');
  assert.ok(ready < record && record < move);
  assert.match(deploy, /"serverSha256": "\$TARGET_SERVER_HASH"/);
  assert.match(deploy, /"fileStorageServiceSha256": "\$TARGET_FILE_SERVICE_HASH"/);
  assert.match(deploy, /"frontendTreeSha256": "\$TARGET_DIST_HASH"/);
});
