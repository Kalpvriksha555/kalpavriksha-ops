import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { setTimeout as delay } from 'timers/promises';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const requireText = (file, pattern, message) => {
  const text = read(file);
  if (!pattern.test(text)) throw new Error(`${message} (${file})`);
};

requireText('backend/src/services/authService.js', /scrypt-v1/, 'Scrypt password hashing is missing.');
requireText('backend/src/services/authService.js', /timingSafeEqual/, 'Timing-safe password verification is missing.');
requireText('backend/src/server.js', /httpOnly:\s*true/, 'HTTP-only session cookie is missing.');
requireText('backend/src/server.js', /X-CSRF-Token|x-csrf-token/i, 'CSRF validation is missing.');
requireText('backend/src/server.js', /auth_credentials/, 'Credential store is missing.');
requireText('backend/src/server.js', /auth_sessions/, 'Session store is missing.');
requireText('backend/src/server.js', /auth_events/, 'Authentication audit store is missing.');
requireText('backend/src/server.js', /migrateLegacyCredentials/, 'Legacy credential migration is missing.');
requireText('backend/src/server.js', /PASSWORD_RECOVERY_REQUESTED/, 'Password recovery audit coverage is missing.');
requireText('frontend/src/services/authService.js', /credentials:\s*'include'/, 'Frontend cookie transport is missing.');
requireText('frontend/src/App.jsx', /clearBrowserSessionApi\(\)/, 'Fresh-login browser bootstrap is missing.');
requireText('backend/src/server.js', /app\.post\('\/api\/auth\/clear-browser-session'/, 'Browser-session revocation endpoint is missing.');
requireText('frontend/src/App.jsx', /kalpa-auth-expired/, 'Frontend session-expiry cleanup is missing.');
if (/X-User-Role|X-User-Name/.test(read('frontend/src/App.jsx'))) throw new Error('Client-supplied role/name trust headers remain in App.jsx.');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalp-auth-check-'));
const dbFile = path.join(tempDir, 'db.json');
const authFile = path.join(tempDir, 'auth.json');
const uploadDir = path.join(tempDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
fs.writeFileSync(dbFile, JSON.stringify({ users: [{ id: 'legacy-admin', name: 'Phase 3 Admin', username: 'phase3admin', password: '123', role: 'Admin', status: 'APPROVED' }], cases: [], projects: [], payments: [], teamChat: [], notifications: [], attendanceLogs: [], audit: [] }));

const port = 19000 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
let child;

const start = async (bootstrap = false) => {
  child = spawn(process.execPath, ['backend/src/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: '',
      DB_SSL: 'false',
      ALLOW_JSON_FALLBACK: 'true',
      PORT: String(port),
      KALPA_DB_FILE: dbFile,
      KALPA_AUTH_FILE: authFile,
      KALPA_LEGACY_UPLOAD_DIR: uploadDir,
      KALPA_FILE_STORAGE_ROOT: path.join(tempDir, 'private-files'),
      ...(bootstrap ? {
        BOOTSTRAP_ADMIN_USERNAME: 'phase3admin',
        BOOTSTRAP_ADMIN_PASSWORD: 'StrongAdmin123',
        BOOTSTRAP_ADMIN_NAME: 'Phase 3 Admin'
      } : {
        BOOTSTRAP_ADMIN_USERNAME: '',
        BOOTSTRAP_ADMIN_PASSWORD: ''
      })
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`Authentication test server exited early.\n${output}`);
    try {
      const response = await fetch(`${base}/api/auth/session`);
      if (response.status === 401) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Authentication test server did not start.\n${output}`);
};

const stop = async () => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    delay(2000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); })
  ]);
};

const jsonRequest = async (pathname, { method = 'GET', body, cookie = '', csrf = '' } = {}) => {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  const setCookie = response.headers.get('set-cookie') || '';
  const nextCookie = setCookie ? setCookie.split(';')[0] : cookie;
  return { response, payload, cookie: nextCookie };
};

const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  await start(false);

  const anonymous = await jsonRequest('/api/state');
  assert(anonymous.response.status === 401 && anonymous.payload.code === 'AUTH_REQUIRED', 'Unauthenticated state access was not blocked.');

  const legacyLogin = await jsonRequest('/api/auth/login', {
    method: 'POST', body: { username: 'phase3admin', password: '123' }
  });
  assert(legacyLogin.response.ok && legacyLogin.payload.user?.role === 'Admin', 'Legacy Admin credential migration failed.');
  assert(legacyLogin.payload.user?.mustChangePassword === false, 'Established legacy password was incorrectly treated as temporary.');
  const adminCookie = legacyLogin.cookie;
  const adminCsrf = legacyLogin.payload.csrfToken;

  const adminState = await jsonRequest('/api/state', { cookie: adminCookie });
  assert(adminState.response.ok, 'Authenticated state access failed.');
  assert(!JSON.stringify(adminState.payload.users || []).match(/password_hash|"password"/i), 'Credential fields leaked through state API.');

  const noCsrf = await jsonRequest('/api/auth/users', {
    method: 'POST', cookie: adminCookie,
    body: { name: 'No CSRF', username: 'nocsrf', password: 'StrongPass123', role: 'DESIGNER' }
  });
  assert(noCsrf.response.status === 403 && noCsrf.payload.code === 'CSRF_TOKEN_INVALID', 'CSRF protection did not block a mutation.');

  const created = await jsonRequest('/api/auth/users', {
    method: 'POST', cookie: adminCookie, csrf: adminCsrf,
    body: { name: 'Phase 3 Designer', username: 'phase3designer', password: 'TempSecure123', role: 'DESIGNER' }
  });
  assert(created.response.status === 201 && created.payload.user?.mustChangePassword === true, 'Temporary employee account creation failed.');
  const userId = created.payload.user.id;

  const managerCreated = await jsonRequest('/api/auth/users', {
    method: 'POST', cookie: adminCookie, csrf: adminCsrf,
    body: { name: 'Phase 3 Manager', username: 'phase3manager', password: 'ManagerTemp123', role: 'MANAGER' }
  });
  assert(managerCreated.response.status === 201 && managerCreated.payload.user?.role === 'Manager', 'Manager account creation failed.');
  const managerId = managerCreated.payload.user.id;
  const managerLogin = await jsonRequest('/api/auth/login', {
    method: 'POST', body: { username: 'phase3manager', password: 'ManagerTemp123' }
  });
  assert(managerLogin.response.ok && managerLogin.payload.user?.role === 'Manager', 'Manager login failed.');
  const managerChanged = await jsonRequest('/api/auth/change-password', {
    method: 'POST', cookie: managerLogin.cookie, csrf: managerLogin.payload.csrfToken,
    body: { currentPassword: 'ManagerTemp123', newPassword: 'ManagerPermanent456' }
  });
  assert(managerChanged.response.ok && managerChanged.payload.user?.mustChangePassword === false, 'Manager password replacement failed.');
  const managerState = await jsonRequest('/api/state', { cookie: managerChanged.cookie });
  assert(managerState.response.ok, 'Manager state access failed.');
  const peerDesigner = (managerState.payload.users || []).find(user => String(user.id || '') === String(userId));
  assert(peerDesigner && String(peerDesigner.id || '') === String(userId), 'Manager could not locate the Designer peer by immutable user id.');
  assert(!(peerDesigner.aadharNumber || peerDesigner.panNumber || peerDesigner.bankDetails || peerDesigner.emergencyContact || peerDesigner.address), 'Peer profile private fields leaked to Manager state.');
  assert(String(managerId || '').length > 0, 'Manager id was not assigned.');

  const tempLogin = await jsonRequest('/api/auth/login', {
    method: 'POST', body: { username: 'phase3designer', password: 'TempSecure123' }
  });
  assert(tempLogin.response.ok && tempLogin.payload.user?.mustChangePassword === true, 'Temporary login did not require password replacement.');

  const blocked = await jsonRequest('/api/state', { cookie: tempLogin.cookie });
  assert(blocked.response.status === 428 && blocked.payload.code === 'PASSWORD_CHANGE_REQUIRED', 'Temporary-password session accessed operational state.');

  const changed = await jsonRequest('/api/auth/change-password', {
    method: 'POST', cookie: tempLogin.cookie, csrf: tempLogin.payload.csrfToken,
    body: { currentPassword: 'TempSecure123', newPassword: 'Permanent456' }
  });
  assert(changed.response.ok && changed.payload.user?.mustChangePassword === false, 'Password replacement failed.');
  const changedCookie = changed.cookie;

  const userState = await jsonRequest('/api/state', { cookie: changedCookie });
  assert(userState.response.ok, 'Changed-password session could not access state.');
  assert(!Object.hasOwn(userState.payload, 'payments'), 'Non-Admin session received the payments collection.');

  await stop();
  await start(false);

  const oldPassword = await jsonRequest('/api/auth/login', {
    method: 'POST', body: { username: 'phase3designer', password: 'TempSecure123' }
  });
  assert(oldPassword.response.status === 401, 'Old temporary password worked after restart.');

  const persistedLogin = await jsonRequest('/api/auth/login', {
    method: 'POST', body: { username: 'phase3designer', password: 'Permanent456' }
  });
  assert(persistedLogin.response.ok && persistedLogin.payload.user?.mustChangePassword === false, 'Changed password did not survive restart.');

  const adminAgain = await jsonRequest('/api/auth/login', {
    method: 'POST', body: { username: 'phase3admin', password: '123' }
  });
  const restricted = await jsonRequest(`/api/auth/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH', cookie: adminAgain.cookie, csrf: adminAgain.payload.csrfToken,
    body: { status: 'RESTRICTED' }
  });
  assert(restricted.response.ok && restricted.payload.user?.status === 'RESTRICTED', 'Account restriction failed.');

  const revoked = await jsonRequest('/api/state', { cookie: persistedLogin.cookie });
  assert(revoked.response.status === 401, 'Restricting an account did not revoke its active session.');

  const storedDb = fs.readFileSync(dbFile, 'utf8');
  const storedAuth = fs.readFileSync(authFile, 'utf8');
  for (const secret of ['\"password\":\"123\"', 'TempSecure123', 'Permanent456', 'ManagerTemp123']) {
    assert(!storedDb.includes(secret) && !storedAuth.includes(secret), 'A plaintext password was written to persistent storage.');
  }
  const authStore = JSON.parse(storedAuth);
  assert((authStore.credentials || []).every(item => String(item.password_hash || '').startsWith('scrypt-v1$')), 'Stored password hashes are not scrypt-v1.');

  console.log('Phase 3 authentication verification passed.');
  console.log('Verified: legacy credential compatibility, temporary-password enforcement, HTTP-only sessions, CSRF, restart persistence, role-safe payloads, restriction revocation and no plaintext credential storage.');
} finally {
  await stop();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
