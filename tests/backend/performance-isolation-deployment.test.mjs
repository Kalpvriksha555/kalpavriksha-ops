import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../../scripts/deploy-performance-isolation-only-vps.sh', import.meta.url), 'utf8');

test('performance isolation deploy is frontend-only and rejects a mismatched backend baseline', () => {
  assert.match(script, /EXPECTED_BACKEND_SHA/);
  assert.match(script, /LIVE_BACKEND_SHA/);
  assert.match(script, /npm run test:frontend/);
  assert.match(script, /npm run verify:frontend-ux/);
  assert.match(script, /npm run verify:integration/);
  assert.match(script, /npm ci --prefix "\$STAGE\/frontend"/);
  assert.match(script, /mv "\$NEXT_DIST" "\$LIVE\/frontend\/dist"/);
  assert.match(script, /PERFORMANCE ISOLATION FRONTEND DEPLOYMENT COMPLETED/);
  assert.doesNotMatch(script, /pm2 (?:stop|restart|reload|start)/);
  assert.doesNotMatch(script, /deploy-1\.9\.24-vps\.sh/);
  assert.doesNotMatch(script, /verify:matrix|db:migrate|db:integrity:(?:repair|canonicalize|reconcile)|backup:create|npm ci --prefix "\$STAGE\/backend"/);
  assert.doesNotMatch(script, /cp -a "\$STAGE\/backend\/src/);
});
