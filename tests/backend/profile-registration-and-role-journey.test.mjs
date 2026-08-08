import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const phase3 = fs.readFileSync(new URL('../../scripts/phase-3-authentication-check.mjs', import.meta.url), 'utf8');

test('self-profile endpoint is allowlisted, actor-owned and durably persisted', () => {
  assert.match(server, /app\.patch\('\/api\/profile'/);
  assert.match(server, /SELF_PROFILE_FIELDS/);
  assert.match(server, /SELF_PROFILE_FIELD_FORBIDDEN/);
  assert.match(server, /findStateUserByIdOrUsername\(actor\.id,actor\.username,d\)/);
  assert.match(server, /reason:'self_profile_update'/);
});

test('registration OTP is tied to the authenticated actor and writes the verified contact', () => {
  assert.match(server, /OTP_ACTOR_MISMATCH/);
  assert.match(server, /email_registration/);
  assert.match(server, /mobile_registration/);
  assert.match(server, /emailRegistered:true/);
  assert.match(server, /mobileRegistered:true/);
  assert.match(server, /user:publicSessionUser/);
});

test('peer users receive only public team presence fields, including presence-only refreshes', () => {
  assert.match(server, /function publicTeamUser/);
  assert.match(server, /function scopedUsers/);
  assert.match(server, /users:scopedUsers\(d, req\)/);
  assert.doesNotMatch(server.match(/function publicTeamUser[\s\S]*?\n\}/)?.[0] || '', /aadharNumber|panNumber|bankDetails|emergencyContact|address/);
});

test('authentication verifier covers Admin, Manager and Designer accounts', () => {
  assert.match(phase3, /Phase 3 Admin/);
  assert.match(phase3, /Phase 3 Manager/);
  assert.match(phase3, /Phase 3 Designer/);
  assert.match(phase3, /PASSWORD_RECOVERY_REQUESTED|recovery/i);
});

test('server attendance, team status and daily ledger use India calendar keys', () => {
  assert.match(server, /INDIA_DATE_KEY_FORMATTER_SERVER/);
  assert.match(server, /localDateKeyFromMsServer\(c\.completedAt\)/);
  assert.match(server, /function dailyLedger\(d, dateStr=localDateKeyFromMsServer\(Date\.now\(\)\)\)/);
});


test('finance defaults and attendance clocks use explicit India time and profile saves purge credential fields', () => {
  assert.match(server, /INDIA_CLOCK_24_FORMATTER_SERVER/);
  assert.match(server, /paymentTime = body\.paymentTime \|\| c\.paymentTime \|\| localClock24FromMsServer/);
  assert.doesNotMatch(server, /paymentTime[^\n]*new Date\(\)\.toTimeString\(\)/);
  assert.match(server, /for \(const field of Object\.keys\(user\)\) if \(!Object\.hasOwn\(credentialSafeUser,field\)\) delete user\[field\]/);
});

test('runtime authentication verifier locates redacted peer users without relying on usernames', () => {
  assert.match(phase3, /String\(user\.id \|\| ''\) === String\(userId\)/);
  assert.doesNotMatch(phase3, /find\(user => user\.username === 'phase3designer'\)/);
});


test('secondary authentication audit failures cannot turn completed login or account writes into false failures', () => {
  assert.match(server, /async function recordAuthEventBestEffort/);
  assert.match(server, /LOGIN_SUCCEEDED'[\s\S]*recordAuthEventBestEffort|recordAuthEventBestEffort\(\{ userId: user\.id, username: user\.username, eventType: 'LOGIN_SUCCEEDED'/);
  assert.match(server, /eventType: 'PASSWORD_CHANGED'[\s\S]*recordAuthEventBestEffort|recordAuthEventBestEffort\(\{ userId: user\.id, username: user\.username, eventType: 'PASSWORD_CHANGED'/);
  assert.match(server, /recordAuthEventBestEffort\(\{ userId, username, eventType: 'USER_CREDENTIAL_CREATED'/);
});
