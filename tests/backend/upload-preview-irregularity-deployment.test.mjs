import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const deploy = fs.readFileSync(new URL('../../scripts/deploy-upload-preview-irregularity-closure-only-vps.sh', import.meta.url), 'utf8');

const indexOf = (needle) => {
  const index = deploy.indexOf(needle);
  assert.notEqual(index, -1, `Missing deployment marker: ${needle}`);
  return index;
};

test('upload and preview deployment is pinned, isolated, targeted and preflighted before downtime', () => {
  assert.match(deploy, /DEPLOYMENT_ID="upload-preview-irregularity-closure-safe-cutover-v2"/);
  assert.match(deploy, /flock -n 9/);
  assert.match(deploy, /retry 3 3 git -C "\$LIVE" fetch --prune origin main/);
  assert.match(deploy, /rev-parse origin\/main/);
  assert.match(deploy, /git -C "\$LIVE" archive "\$TARGET_COMMIT"/);
  assert.match(deploy, /Unexpected root version/);
  assert.match(deploy, /Unexpected backend version/);
  assert.match(deploy, /Incremental deployment would omit changed backend runtime files/);
  assert.match(deploy, /Backend dependency mismatch/);
  assert.match(deploy, /unset DATABASE_URL KALPA_DATABASE_URL/);
  assert.match(deploy, /tests\/frontend\/upload-preview-hardening\.test\.mjs/);
  assert.match(deploy, /tests\/backend\/upload-preview-hardening\.test\.mjs/);
  assert.match(deploy, /phase-4-authorization-check\.mjs/);
  assert.match(deploy, /phase-6-file-storage-check\.mjs/);
  assert.match(deploy, /phase-9-frontend-ux-check\.mjs/);
  assert.match(deploy, /frontend-backend-contract-check\.mjs/);
  assert.match(deploy, /npm ci --prefix "\$STAGE\/frontend" --include=dev --offline/);
  assert.match(deploy, /--prefer-offline/);
  assert.match(deploy, /validate_frontend_dist "\$STAGE\/frontend\/dist"/);
  const build = indexOf('VITE_API_URL="https://api.kalpvriksha.co.in" npm run build');
  const cutoverStop = deploy.indexOf('pm2 stop "$PM2_NAME"', indexOf('log "Stopping the backend for the short runtime cutover"'));
  assert.ok(build < cutoverStop);
  assert.doesNotMatch(deploy, /verify:matrix|db:migrate|db:integrity:repair|backup:create|npm ci --prefix "\$STAGE\/backend"/);
});

test('same target is idempotent and preflight-only mode changes no live runtime', () => {
  assert.match(deploy, /The exact target runtime is already deployed and healthy/);
  assert.match(deploy, /No cutover was required/);
  assert.match(deploy, /KALPA_PREFLIGHT_ONLY/);
  assert.match(deploy, /Preflight-only mode completed successfully; no live file was changed/);
});
