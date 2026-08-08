import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const loginStart = server.indexOf("app.post('/api/auth/login'");
const loginEnd = server.indexOf("app.get('/api/auth/session'", loginStart);
const login = server.slice(loginStart, loginEnd);

test('unknown usernames use a valid dummy scrypt hash to avoid account timing disclosure', () => {
  assert.match(server, /DUMMY_LOGIN_PASSWORD_HASH = 'scrypt-v1\$/);
  assert.match(login, /verifyPassword\(password, credential\?\.password_hash \|\| DUMMY_LOGIN_PASSWORD_HASH\)/);
  assert.match(login, /Invalid username or password/);
});

test('successful login avoids redundant credential writes and lookups', () => {
  const clearStart = server.indexOf('async function clearLoginFailures');
  const clearEnd = server.indexOf('async function updateCredentialPassword', clearStart);
  const clear = server.slice(clearStart, clearEnd);
  assert.match(clear, /alreadyClear/);
  assert.match(clear, /if \(alreadyClear\) return cleared/);
  assert.match(clear, /return cleared/);
  assert.doesNotMatch(login, /findCredentialByUserId\(credential\.user_id\)/);
  assert.match(login, /refreshedCredential = await clearLoginFailures\(refreshedCredential\)/);
});

test('login replaces any stale browser session and records success without delaying the response', () => {
  assert.match(login, /previousRawToken/);
  assert.match(login, /revokeAuthSession\(tokenHash\(previousRawToken\)\)/);
  assert.match(login, /setSessionCookie\(res, session\.rawToken\)/);
  const responseIndex = login.indexOf('res.json({ ok: true');
  const auditIndex = login.indexOf("eventType: 'LOGIN_SUCCEEDED'");
  assert.ok(responseIndex >= 0 && auditIndex > responseIndex, 'LOGIN_SUCCEEDED audit must run after the response is committed.');
  assert.match(login, /void recordAuthEventBestEffort/);
});

test('login failures are bounded, observable and do not leak internal server errors', () => {
  assert.match(login, /Server-Timing/);
  assert.match(login, /structuredLog\('error','login_request_failed'/);
  assert.match(login, /LOGIN_TEMPORARILY_UNAVAILABLE/);
  assert.match(login, /requestId:req\.requestId/);
  assert.doesNotMatch(login, /LOGIN_ERROR'[\s\S]*error\.message/);
  assert.match(server, /'Server-Timing'/);
});


test('password replacement avoids redundant scrypt and credential reads while failures stay generic', () => {
  const changeStart = server.indexOf("app.post('/api/auth/change-password'");
  const changeEnd = server.indexOf("app.post('/api/auth/recovery/request'", changeStart);
  const change = server.slice(changeStart, changeEnd);
  assert.match(change, /newPassword === currentPassword/);
  assert.doesNotMatch(change, /verifyPassword\(newPassword, credential\.password_hash\)/);
  assert.match(change, /updateCredentialPassword\(req\.auth\.user\.id, await hashPassword\(newPassword\), false, credential\)/);
  const responseIndex = change.indexOf('res.json({ ok: true');
  const auditIndex = change.indexOf("eventType: 'PASSWORD_CHANGED'");
  assert.ok(responseIndex >= 0 && auditIndex > responseIndex, 'Password-change audit must not delay the successful response.');
  assert.match(server, /SESSION_CHECK_UNAVAILABLE/);
  assert.match(server, /password_recovery_send_failed/);
  assert.match(server, /password_recovery_reset_failed/);
  assert.doesNotMatch(change, /error:error\.message \|\| 'Password could not be changed.'/);
});
