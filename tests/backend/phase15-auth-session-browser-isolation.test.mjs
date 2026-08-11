import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');

test('stale page tokens fail closed on safe reads without clearing the newer shared cookie', () => {
  const start = server.indexOf('async function authenticationGate');
  const end = server.indexOf('function requireAdminSession', start);
  const gate = server.slice(start, end);
  assert.match(gate, /const suppliedSessionContext = String\(req\.get\?\.\('x-csrf-token'\)/);
  assert.match(gate, /const suppliedContextMismatch = Boolean/);
  assert.match(gate, /res\.setHeader\('X-Auth-Session-Context', 'changed'\)/);
  assert.match(gate, /status\(409\)[\s\S]*AUTH_SESSION_CONTEXT_CHANGED/);
  assert.ok(gate.indexOf('suppliedContextMismatch') < gate.indexOf('if (!isSafeMethod(req.method))'), 'safe reads must be session-context checked before the write-only CSRF branch');
  const mismatchBlock = gate.slice(gate.indexOf('if (suppliedContextMismatch)'), gate.indexOf('if (!isSafeMethod(req.method))'));
  assert.doesNotMatch(mismatchBlock, /clearSessionCookie|revokeAuthSession|revokeAllUserSessions/, 'a stale tab must not clear or revoke the newer tab\'s shared browser session');
});

test('legacy/direct safe resource requests stay compatible while unsafe requests still require CSRF', () => {
  const start = server.indexOf('async function authenticationGate');
  const end = server.indexOf('function requireAdminSession', start);
  const gate = server.slice(start, end);
  assert.match(gate, /if \(!isSafeMethod\(req\.method\)\) \{[\s\S]*if \(!suppliedSessionContext \|\| !expectedSessionContext\)/);
  assert.doesNotMatch(gate, /if \(isSafeMethod\(req\.method\)[\s\S]*CSRF_TOKEN_INVALID/);
});

test('CORS exposes the session-context replacement signal to approved cross-origin frontends', () => {
  assert.match(server, /exposedHeaders: \[[^\]]*'X-Request-Id'[^\]]*'X-Auth-Session-Context'/);
  assert.match(server, /allowedHeaders: \['Content-Type','X-CSRF-Token'/);
});


test('one account cannot retain two live sessions after concurrent or cross-device sign-in', () => {
  const start = server.indexOf('async function createAuthSession');
  const end = server.indexOf('async function cleanupExpiredAuthSessions', start);
  const block = server.slice(start, end);
  assert.match(block, /SELECT user_id FROM auth_credentials WHERE user_id=\$1 FOR UPDATE/);
  assert.match(block, /UPDATE auth_sessions SET revoked_at=COALESCE\(revoked_at,now\(\)\) WHERE user_id=\$1 AND revoked_at IS NULL/);
  assert.ok(block.indexOf('FOR UPDATE') < block.indexOf('INSERT INTO auth_sessions'), 'the per-user lock/revocation must happen before inserting the new session');
  assert.match(block, /store\.sessions = store\.sessions\.map\(item => String\(item\.user_id\) === session\.user_id && !item\.revoked_at/);
});


test('multipart mutations revalidate the original authenticated session after body parsing and before commit', () => {
  const start = server.indexOf('async function requireFreshAuthenticatedRequestAfterBody');
  const end = server.indexOf('function requireAdminSession', start);
  const block = server.slice(start, end);
  assert.ok(start >= 0 && end > start, 'fresh multipart session middleware must exist');
  assert.match(block, /const refreshed = await resolveRequestAuthentication\(req\)/);
  assert.match(block, /refreshedSessionHash !== originalSessionHash/);
  assert.match(block, /refreshedUserId !== originalUserId/);
  assert.match(block, /cleanupRequestTempUploads\(req\)/);
  assert.match(block, /AUTH_SESSION_EXPIRED_DURING_REQUEST/);
  assert.match(block, /X-Auth-Session-Context', 'changed'/);
  assert.match(block, /req\.auth = refreshed/);
});

test('every authenticated multipart write route revalidates session after upload middleware', () => {
  const requiredRoutes = [
    /app\.post\('\/api\/profile\/photo', profilePhotoUpload, requireFreshAuthenticatedRequestAfterBody,/,
    /app\.post\('\/api\/files\/upload', uploadAny, requireFreshAuthenticatedRequestAfterBody,/,
    /app\.post\('\/api\/cases', requireAnyRole\('ADMIN','MANAGER'\), uploadAny, requireFreshAuthenticatedRequestAfterBody, requireAnyRole\('ADMIN','MANAGER'\),/,
    /app\.post\('\/api\/cases\/:id\/upload-source',[\s\S]*?uploadAny, requireFreshAuthenticatedRequestAfterBody, requireAnyRole\('ADMIN','MANAGER'\), requireCaseAction/,
    /app\.post\('\/api\/cases\/:id\/upload-final',[\s\S]*?uploadAny, requireFreshAuthenticatedRequestAfterBody, requireCaseAction/,
    /app\.post\('\/whatsapp\/mock\/incoming',[\s\S]*?uploadAny, requireFreshAuthenticatedRequestAfterBody, requireAdminSession,/
  ];
  for (const pattern of requiredRoutes) assert.match(server, pattern);
});
