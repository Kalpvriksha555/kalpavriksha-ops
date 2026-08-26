import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../frontend/src/style.css', import.meta.url), 'utf8');
const layer = fs.readFileSync(new URL('../../frontend/src/components/ui/LayerPortal.jsx', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../../frontend/src/services/authService.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');

const loginStart = app.indexOf('export const LoginScreen');
const loginEnd = app.indexOf('const TeamPerformanceView', loginStart);
const login = app.slice(loginStart, loginEnd);
const recoveryRequestStart = server.indexOf("app.post('/api/auth/recovery/request'");
const recoveryResetStart = server.indexOf("app.post('/api/auth/recovery/reset'", recoveryRequestStart);
const recoveryRequest = server.slice(recoveryRequestStart, recoveryResetStart);
const recoveryResetEnd = server.indexOf("app.get('/api/auth/health'", recoveryResetStart);
const recoveryReset = server.slice(recoveryResetStart, recoveryResetEnd);

test('forgot-password trigger stays in the visible login stacking context and advertises a dialog', () => {
  assert.match(login, /kalpa-forgot-password-action relative z-20/);
  assert.match(login, /aria-haspopup="dialog"/);
  assert.match(css, /\.kalpa-forgot-password-action\s*\{[\s\S]*z-index:\s*20\s*!important/);
});

test('password-recovery portal uses the canonical modal layer instead of an ungenerated arbitrary z utility', () => {
  assert.match(app, /import \{ PortalLayer, LAYER_Z \} from '\.\/components\/ui\/LayerPortal'/);
  assert.match(login, /className="kalpa-password-recovery-layer fixed inset-0/);
  assert.match(login, /style=\{\{ zIndex: LAYER_Z\.modal \}\}/);
  assert.doesNotMatch(login, /z-\[1000\]/);
  assert.match(layer, /modal:\s*2147483000/);
  assert.match(css, /\.kalpa-password-recovery-layer\s*\{[\s\S]*--kalpa-z-modal[\s\S]*overflow-y:\s*auto/);
});

test('recovery dialog remains usable on short and mobile viewports', () => {
  assert.match(login, /kalpa-password-recovery-card/);
  assert.match(css, /\.kalpa-password-recovery-card\s*\{[\s\S]*max-height:\s*calc\(100dvh[\s\S]*overflow-y:\s*auto/);
  assert.match(login, /lockScrollClass="kalpa-password-recovery-open"/);
  assert.match(login, /onEscape=\{\(\) => setShowRecovery\(false\)\}/);
  assert.match(login, /initialFocusSelector="input"/);
});

test('switching recovery channel invalidates any stale OTP challenge', () => {
  assert.match(login, /const selectRecoveryMethod = \(method\) =>/);
  assert.match(login, /setOtpSent\(false\)/);
  assert.match(login, /setRecoveryChallengeId\(''\)/);
  assert.match(login, /setRecoveryOtp\(''\)/);
  assert.match(login, /selectRecoveryMethod\('email'\)/);
  assert.match(login, /selectRecoveryMethod\('mobile'\)/);
});

test('recovery request validates username and selected recovery detail before the network call', () => {
  assert.match(login, /normalizedRecoveryUser = recoveryUser\.trim\(\)\.toLowerCase\(\)/);
  assert.match(login, /normalizedRecoveryEmail = recoveryEmail\.trim\(\)\.toLowerCase\(\)/);
  assert.match(login, /normalizedRecoveryMobile = recoveryMobile\.replace\(\/\\D\/g, ''\)/);
  assert.match(login, /Enter your registered email address\./);
  assert.match(login, /Enter your registered mobile number\./);
  assert.match(login, /onRequestRecovery\(\{[\s\S]*username: normalizedRecoveryUser/);
});

test('frontend recovery APIs call the public request and reset contracts without expiring an unrelated session', () => {
  assert.match(auth, /requestPasswordRecoveryApi[\s\S]*\/api\/auth\/recovery\/request[\s\S]*notifyAuthExpired:\s*false/);
  assert.match(auth, /resetPasswordRecoveryApi[\s\S]*\/api\/auth\/recovery\/reset[\s\S]*notifyAuthExpired:\s*false/);
});

test('backend recovery request verifies registered profile details and creates a bounded OTP challenge', () => {
  assert.match(recoveryRequest, /findCredentialByUsername\(username\)/);
  assert.match(recoveryRequest, /emailRegistered/);
  assert.match(recoveryRequest, /mobileRegistered/);
  assert.match(recoveryRequest, /sendOtpEmail\(registeredEmail, otp\)/);
  assert.match(recoveryRequest, /sendOtpSms\(registeredMobile, otp\)/);
  assert.match(recoveryRequest, /purpose:\s*'password_recovery'/);
  assert.match(recoveryRequest, /Date\.now\(\) \+ 5 \* 60 \* 1000/);
});

test('backend recovery reset enforces expiry, attempt limit and password policy, then revokes old sessions', () => {
  assert.match(recoveryReset, /RECOVERY_SESSION_INVALID/);
  assert.match(recoveryReset, /OTP_EXPIRED/);
  assert.match(recoveryReset, /record\.attempts > 5/);
  assert.match(recoveryReset, /OTP_INVALID/);
  assert.match(recoveryReset, /passwordPolicyErrors\(newPassword\)/);
  assert.match(recoveryReset, /updateCredentialPassword\(record\.userId, await hashPassword\(newPassword\), false\)/);
  assert.match(recoveryReset, /revokeAllUserSessions\(record\.userId\)/);
  assert.match(recoveryReset, /otpStore\.delete\(challengeId\)/);
  assert.match(recoveryReset, /PASSWORD_RECOVERED/);
});
