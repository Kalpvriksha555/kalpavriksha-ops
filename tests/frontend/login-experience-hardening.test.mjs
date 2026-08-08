import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../../frontend/src/services/authService.js', import.meta.url), 'utf8');

const loginStart = app.indexOf('const LoginScreen =');
const loginEnd = app.indexOf('const TeamPerformanceView', loginStart);
const login = app.slice(loginStart, loginEnd);

test('public authentication failures do not expire an unrelated workspace session', () => {
  assert.match(auth, /notifyAuthExpired = true/);
  assert.match(auth, /response\.status === 401 && notifyAuthExpired/);
  assert.match(auth, /loginApi[\s\S]*notifyAuthExpired: false/);
  assert.match(auth, /changePasswordApi[\s\S]*notifyAuthExpired: false/);
  assert.match(auth, /requestPasswordRecoveryApi[\s\S]*notifyAuthExpired: false/);
  assert.match(auth, /resetPasswordRecoveryApi[\s\S]*notifyAuthExpired: false/);
});

test('authentication requests use bounded action-specific deadlines and friendly retry errors', () => {
  assert.match(auth, /AUTH_REQUEST_TIMEOUTS = Object\.freeze/);
  assert.match(auth, /boot: 5_000/);
  assert.match(auth, /login: 20_000/);
  assert.match(auth, /passwordChange: 35_000/);
  assert.match(auth, /recoverySend: 40_000/);
  assert.match(auth, /AUTH_REQUEST_TIMEOUT/);
  assert.match(auth, /AUTH_NETWORK_UNAVAILABLE/);
  assert.match(auth, /timeoutMessageForAuthAction/);
  assert.match(auth, /Password change confirmation took too long/);
  assert.match(auth, /Password reset confirmation took too long/);
  assert.match(auth, /retryAfterSeconds/);
  assert.match(auth, /requestId/);
  assert.match(auth, /if \(response\.status === 401\)/);
  assert.match(auth, /if \(!response\.ok\) return throwAuthError\(response, 'Secure session verification failed\.'/);
});

test('login and recovery submissions are single-flight and remain usable after errors', () => {
  assert.match(login, /loginInFlightRef/);
  assert.match(login, /passwordChangeInFlightRef/);
  assert.match(login, /recoverySendInFlightRef/);
  assert.match(login, /recoveryResetInFlightRef/);
  assert.match(login, /if \(loginInFlightRef\.current\) return/);
  assert.match(login, /finally \{[\s\S]*loginInFlightRef\.current = false/);
  assert.match(login, /recoveryCooldown/);
  assert.match(login, /Resend available in \$\{recoveryCooldown\}s/);
});

test('login UI normalizes usernames, detects offline and Caps Lock states, and exposes progress accessibly', () => {
  assert.match(login, /trim\(\)\.toLowerCase\(\)/);
  assert.match(login, /navigator\.onLine/);
  assert.match(login, /window\.addEventListener\('online'/);
  assert.match(login, /window\.addEventListener\('offline'/);
  assert.match(login, /getModifierState\?\.\('CapsLock'\)/);
  assert.match(login, /Caps Lock is on/);
  assert.match(login, /aria-busy=\{isSubmitting\}/);
  assert.match(login, /aria-live="polite"/);
  assert.match(login, /Verifying securely…/);
  assert.match(login, /autoCapitalize="none"/);
  assert.match(login, /spellCheck=\{false\}/);
  assert.match(login, /enterKeyHint="go"/);
  assert.match(login, /forcedNewPasswordInputRef/);
  assert.match(login, /<form className="space-y-3"[\s\S]*handlePasswordRecovery/);
});

test('password policy is checked before temporary-password and recovery requests leave the browser', () => {
  assert.match(login, /const passwordPolicyErrors/);
  assert.match(login, /Password must be at least 10 characters/);
  assert.match(login, /Password cannot contain spaces/);
  assert.match(login, /const policyErrors = passwordPolicyErrors\(forcedNewPassword\)/);
  assert.match(login, /const policyErrors = passwordPolicyErrors\(recoveryNewPass\)/);
  assert.match(login, /recoveryOtp\.length !== 6/);
});

test('sign-in boot and workspace hydration communicate distinct progress states', () => {
  assert.match(app, /authBootWarning/);
  assert.match(app, /Preparing secure sign-in/);
  assert.match(app, /Clearing any stale browser session/);
  assert.match(app, /Loading your authorised workspace/);
  assert.match(login, /bootWarning/);
  assert.match(login, /You can retry sign-in now/);
  assert.match(app, /USE_BACKEND_STATE \? \[\] : INITIAL_USERS/, 'Production sign-in must not show seeded fallback users while the authoritative workspace is empty.');
});
