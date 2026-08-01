import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCorsOrigins, createCorsOriginPolicy } from '../../backend/src/config/corsPolicy.js';

test('production CORS canonicalizes harmless trailing slashes and default ports', () => {
  const origins = parseCorsOrigins('https://ops.kalpvriksha.co.in/, https://ops.kalpvriksha.co.in:443, invalid-value');
  assert.deepEqual(origins, ['https://ops.kalpvriksha.co.in']);
  const allowed = createCorsOriginPolicy({ configuredOrigins:origins, production:true });
  assert.equal(allowed('https://ops.kalpvriksha.co.in'), true);
  assert.equal(allowed('https://evil.example'), false);
});

test('frontend and backend connection verification scripts are part of the release gate', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const smoke = fs.readFileSync('scripts/smoke-check.mjs', 'utf8');
  const contract = fs.readFileSync('scripts/frontend-backend-contract-check.mjs', 'utf8');
  assert.equal(pkg.scripts['verify:integration'], 'node scripts/frontend-backend-contract-check.mjs');
  assert.equal(pkg.scripts['verify:live-stack'], 'node scripts/live-stack-check.mjs');
  assert.match(pkg.scripts.verify, /verify:integration/);
  assert.match(smoke, /same-origin Vite proxy/);
  assert.match(contract, /Authenticated frontend requests include cookies/);
});
