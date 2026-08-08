import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const deploy = fs.readFileSync(new URL('../../scripts/deploy-login-experience-only-vps.sh', import.meta.url), 'utf8');

test('login experience deploy runs focused role journeys and switches only login runtime files', () => {
  assert.match(deploy, /git -C "\$LIVE" archive "\$TARGET_COMMIT"/);
  assert.match(deploy, /login-experience-hardening\.test\.mjs/);
  assert.match(deploy, /phase-3-authentication-check\.mjs/);
  assert.match(deploy, /phase-4-authorization-check\.mjs/);
  assert.match(deploy, /phase-9-frontend-ux-check\.mjs/);
  assert.match(deploy, /frontend-backend-contract-check\.mjs/);
  assert.match(deploy, /npm ci --prefix "\$STAGE\/frontend"/);
  assert.match(deploy, /cp -a "\$STAGE\/backend\/src\/server\.js" "\$LIVE\/backend\/src\/server\.js"/);
  assert.match(deploy, /mv "\$NEXT_DIST" "\$LIVE\/frontend\/dist"/);
  assert.match(deploy, /Restoring the previous login backend and frontend/);
  assert.match(deploy, /LOGIN EXPERIENCE LATEST-CHANGES DEPLOYMENT COMPLETED/);
  assert.doesNotMatch(deploy, /deploy-1\.9\.24-vps\.sh/);
  assert.doesNotMatch(deploy, /verify:matrix|db:migrate|db:integrity:(?:repair|canonicalize|reconcile)|backup:create|npm ci --prefix "\$STAGE\/backend"/);
  assert.doesNotMatch(deploy, /cp -a "\$STAGE\/backend\/src\/repositories/);
});
