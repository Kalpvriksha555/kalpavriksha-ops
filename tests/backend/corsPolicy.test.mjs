import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCorsOriginPolicy,
  isLoopbackDevelopmentOrigin,
  parseCorsOrigins
} from '../../backend/src/config/corsPolicy.js';

test('development allows genuine loopback origins on dynamic Vite ports', () => {
  const allowed = createCorsOriginPolicy({
    configuredOrigins: parseCorsOrigins('https://ops.kalpvriksha.co.in'),
    production: false
  });
  assert.equal(allowed('http://localhost:5173'), true);
  assert.equal(allowed('http://localhost:5175'), true);
  assert.equal(allowed('http://127.0.0.1:5175'), true);
  assert.equal(allowed('http://[::1]:5175'), true);
  assert.equal(allowed('https://ops.kalpvriksha.co.in'), true);
});

test('loopback detection rejects lookalike and unsafe origins', () => {
  assert.equal(isLoopbackDevelopmentOrigin('http://localhost.evil.test:5175'), false);
  assert.equal(isLoopbackDevelopmentOrigin('http://127.0.0.1.evil.test:5175'), false);
  assert.equal(isLoopbackDevelopmentOrigin('file:///tmp/index.html'), false);
  assert.equal(isLoopbackDevelopmentOrigin('not-an-origin'), false);
});

test('production remains strict even for localhost', () => {
  const allowed = createCorsOriginPolicy({
    configuredOrigins: ['https://ops.kalpvriksha.co.in'],
    production: true
  });
  assert.equal(allowed(), true);
  assert.equal(allowed('https://ops.kalpvriksha.co.in'), true);
  assert.equal(allowed('http://localhost:5175'), false);
  assert.equal(allowed('https://evil.example'), false);
});
