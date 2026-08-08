import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const deploy=fs.readFileSync(new URL('../../scripts/deploy-end-to-end-hardening-only-vps.sh',import.meta.url),'utf8');

test('end-to-end hardening deploy is latest-changes-only with rollback and role journeys',()=>{
  assert.match(deploy,/git -C "\$LIVE" archive "\$TARGET_COMMIT"/);
  assert.match(deploy,/phase-3-authentication-check\.mjs/);
  assert.match(deploy,/phase-4-authorization-check\.mjs/);
  assert.match(deploy,/profile-workspace-role-safety\.test\.mjs/);
  assert.match(deploy,/cp -a "\$STAGE\/backend\/src\/server\.js"/);
  assert.match(deploy,/mv "\$NEXT_DIST" "\$LIVE\/frontend\/dist"/);
  assert.match(deploy,/Restoring previous backend and frontend/);
  assert.doesNotMatch(deploy,/verify:matrix|db:migrate|backup:create|db:integrity:repair|npm ci --prefix "\$STAGE\/backend"/);
});
