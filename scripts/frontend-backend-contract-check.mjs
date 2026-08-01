import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const pass = [];
const assert = (condition, message) => {
  if (condition) pass.push(message);
  else failures.push(message);
};

const server = read('backend/src/server.js');
const corsPolicy = read('backend/src/config/corsPolicy.js');
const authService = read('frontend/src/services/authService.js');
const appConfig = read('frontend/src/config/appConfig.js');
const viteConfig = read('frontend/vite.config.js');
const sourceFiles = [];
const walk = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) sourceFiles.push(full);
  }
};
walk(path.join(root, 'frontend/src'));
const frontendSource = sourceFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');

const backendRoutes = new Set();
for (const match of server.matchAll(/app\.(get|post|put|patch|delete)\(\s*(['"])(.*?)\2/gms)) {
  backendRoutes.add(`${match[1].toUpperCase()} ${match[3]}`);
}

const requiredContracts = [
  ['POST','/api/auth/clear-browser-session'],
  ['POST','/api/auth/login'],
  ['GET','/api/auth/session'],
  ['POST','/api/auth/logout'],
  ['POST','/api/auth/logout-all'],
  ['POST','/api/auth/change-password'],
  ['POST','/api/auth/recovery/request'],
  ['POST','/api/auth/recovery/reset'],
  ['POST','/api/auth/users'],
  ['PATCH','/api/auth/users/:id'],
  ['POST','/api/auth/users/:id/reset-password'],
  ['GET','/api/state'],
  ['POST','/api/state'],
  ['POST','/api/state/projects'],
  ['DELETE','/api/state/projects/:id'],
  ['POST','/api/state/projects/:id/payment-status'],
  ['POST','/api/presence'],
  ['POST','/api/files/upload'],
  ['GET','/api/files/:id'],
  ['GET','/api/files/:id/preview-data'],
  ['GET','/api/files/:id/preview'],
  ['GET','/api/files/:id/download'],
  ['DELETE','/api/files/:id'],
  ['POST','/api/chat'],
  ['PATCH','/api/chat/:id'],
  ['DELETE','/api/chat/:id'],
  ['POST','/api/chat/read'],
  ['POST','/api/notifications'],
  ['POST','/api/notifications/:id/read'],
  ['POST','/api/notifications/read-all'],
  ['POST','/api/profile/photo'],
  ['GET','/api/profile/photo/:filename'],
  ['POST','/api/otp/send'],
  ['POST','/api/otp/verify'],
  ['GET','/api/performance/leaderboard'],
  ['PATCH','/api/performance/baseline/:id'],
  ['POST','/api/performance/rebuild'],
  ['GET','/api/finance/history/:id'],
  ['GET','/api/system/reliability'],
  ['GET','/api/system/backups'],
  ['GET','/api/system/jobs'],
  ['POST','/api/system/jobs/:id/retry'],
  ['GET','/api/system/events'],
  ['GET','/api/health/live'],
  ['GET','/api/health/ready']
];
for (const [method, route] of requiredContracts) {
  assert(backendRoutes.has(`${method} ${route}`), `Backend exposes ${method} ${route}`);
}

const frontendMarkers = [
  '/api/auth/login', '/api/auth/session', '/api/state?', '/api/state/projects',
  '/payment-status', '/api/presence', '/api/files/upload', '/api/chat',
  '/api/notifications', '/api/profile/photo', '/api/performance/leaderboard',
  '/api/performance/baseline', '/api/performance/rebuild', '/api/finance/history', '/api/system/reliability'
];
for (const marker of frontendMarkers) {
  assert(frontendSource.includes(marker), `Frontend calls ${marker}`);
}

assert(authService.includes("credentials: 'include'"), 'Authenticated frontend requests include cookies');
assert(authService.includes("X-CSRF-Token"), 'Authenticated frontend writes include CSRF protection');
assert(authService.includes('DEFAULT_AUTH_FETCH_TIMEOUT_MS'), 'Frontend API calls have a default deadline');
assert(appConfig.includes("import.meta.env.PROD") && appConfig.includes('configuredApiBase'), 'Production frontend uses the explicit API base');
assert(appConfig.includes("allowExternalDevelopmentApi ? configuredApiBase : ''"), 'Development frontend uses the same-origin proxy by default');
assert(viteConfig.includes("target: localApiTarget") && viteConfig.includes("'/api'") && viteConfig.includes("'/uploads'"), 'Vite proxies API and upload paths to the backend');
assert(viteConfig.includes('Production build blocked: set VITE_API_URL'), 'Production build fails closed without an API URL');
assert(server.includes('credentials: true'), 'Backend CORS allows credentialed requests');
assert(corsPolicy.includes('normalizeCorsOrigin'), 'Backend canonicalizes configured CORS origins');
assert(server.includes("routePath === '/auth/login'") && server.includes("routePath === '/health/live'"), 'Login and health endpoints are public');
assert(server.includes("const PORT=boundedEnvNumber('PORT',8080"), 'Backend and Vite proxy share port 8080 by default');
assert(server.includes("sameSite: 'lax'") && server.includes('secure: IS_PRODUCTION'), 'Session cookie is HTTPS-only in production and valid across same-site subdomains');
assert(server.includes("app.use('/api', authenticationGate)"), 'Protected backend routes require authentication');
assert(server.includes("app.use(cors(corsOptions))"), 'CORS middleware runs before API authentication');

for (const message of pass) console.log(`PASS - ${message}`);
for (const message of failures) console.error(`FAIL - ${message}`);
if (failures.length) {
  console.error(`Frontend/backend contract verification failed with ${failures.length} issue(s).`);
  process.exit(1);
}
console.log(`Frontend/backend contract verification passed (${pass.length} checks, ${backendRoutes.size} backend routes).`);
