import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rootPackage = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const backendPackage = JSON.parse(fs.readFileSync(new URL('../../backend/package.json', import.meta.url), 'utf8'));
const frontendPackage = JSON.parse(fs.readFileSync(new URL('../../frontend/package.json', import.meta.url), 'utf8'));
const deploy = fs.readFileSync(new URL('../../scripts/deploy-1.9.30-vps.sh', import.meta.url), 'utf8');
const launcher = fs.readFileSync(new URL('../../scripts/launch-deploy-1.9.30-vps.sh', import.meta.url), 'utf8');

test('1.9.30 is the only current production deployment entrypoint', () => {
  assert.equal(rootPackage.version, '1.9.30-runtime-persistence-recovery');
  assert.equal(backendPackage.version, '2.9.30-runtime-persistence-recovery');
  assert.equal(frontendPackage.version, '2.9.30-runtime-persistence-recovery');
  assert.equal(rootPackage.scripts['deploy:vps'], 'bash scripts/launch-deploy-1.9.30-vps.sh');
  assert.match(deploy, /EXPECTED_ROOT_VERSION="1\.9\.30-runtime-persistence-recovery"/);
  assert.match(deploy, /EXPECTED_BACKEND_VERSION="2\.9\.30-runtime-persistence-recovery"/);
  assert.match(deploy, /EXPECTED_FRONTEND_VERSION="2\.9\.30-runtime-persistence-recovery"/);
});

test('current deployment remains fail-closed, rollback-capable and verification gated', () => {
  assert.match(deploy, /\[\[ "\$RELEASE_ROOT" != "\$LIVE" \]\] \|\| fail/);
  assert.match(deploy, /flock -n 8/);
  assert.match(deploy, /restore_previous_runtime/);
  assert.match(deploy, /npm ci --include=dev --ignore-scripts --no-audit --no-fund/);
  assert.match(deploy, /npm ci --prefix backend --no-audit --no-fund/);
  assert.match(deploy, /npm ci --prefix frontend --include=dev --no-audit --no-fund/);
  assert.match(deploy, /npm run verify/);
  assert.match(deploy, /npm run release:clean-install/);
  assert.match(deploy, /npm run backup:create \| tee "\$WORK\/pre-deployment-backup\.json"/);
  assert.match(deploy, /npm run db:migrate --prefix backend/);
  assert.match(deploy, /npm run db:integrity --prefix backend/);
  assert.match(deploy, /npm run release:certify/);
  assert.match(deploy, /npm run release:gate/);
  assert.match(deploy, /source-parity-clean\.mjs/);
  assert.match(deploy, /\/api\/health\/live/);
  assert.match(deploy, /\/api\/health\/ready/);
  assert.match(deploy, /post-deployment-backup/);
});

test('current launcher is SSH-independent, overlap-protected and requires exact isolated candidate certification', () => {
  assert.match(launcher, /deploy-1\.9\.30-vps\.sh/);
  assert.match(launcher, /kalpavriksha-deploy-1930/);
  assert.match(launcher, /flock -n 7/);
  assert.match(launcher, /systemd-run/);
  assert.match(launcher, /kalpavriksha-deploy-last-unit/);
  assert.match(launcher, /kalpavriksha-certified-candidate\.commit/);
  assert.match(launcher, /CERTIFIED_FOR_GUARDED_DEPLOYMENT/);
  assert.match(launcher, /wrongTaskAttachmentPrevented/);
  assert.match(launcher, /GitHub main moved after candidate certification/);
});

test('obsolete two-file runtime hotfix entrypoints are not packaged as current deployers', () => {
  assert.equal(fs.existsSync(new URL('../../scripts/deploy-runtime-persistence-hotfix-vps.sh', import.meta.url)), false);
  assert.equal(fs.existsSync(new URL('../../scripts/Run-Runtime-Persistence-Hotfix.ps1', import.meta.url)), false);
});
