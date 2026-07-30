import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 19000 + Math.floor(Math.random() * 500);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalpa-p2-'));
const dbFile = path.join(tempDir, 'db.json');
const authFile = path.join(tempDir, 'auth.json');
const base = `http://127.0.0.1:${port}`;
let authCookie = '';
let csrfToken = '';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const request = async (url, options = {}) => {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (authCookie) headers.Cookie = authCookie;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(`${base}${url}`, { ...options, method, headers });
  const payload = await response.json().catch(() => ({}));
  const setCookie = response.headers.get('set-cookie') || '';
  if (setCookie) authCookie = setCookie.split(';')[0];
  return { response, payload };
};

const login = async () => {
  authCookie = '';
  csrfToken = '';
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'phase2admin', password: 'StrongPhase2123' })
  });
  if (!result.response.ok || !result.payload?.csrfToken) throw new Error('Phase 2 verifier could not establish its secure Admin session.');
  csrfToken = result.payload.csrfToken;
};

const start = () => spawn(process.execPath, ['backend/src/server.js'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    ALLOW_JSON_FALLBACK: 'true',
    KALPA_DB_FILE: dbFile,
    KALPA_AUTH_FILE: authFile,
    BOOTSTRAP_ADMIN_USERNAME: 'phase2admin',
    BOOTSTRAP_ADMIN_PASSWORD: 'StrongPhase2123',
    BOOTSTRAP_ADMIN_NAME: 'Phase 2 Verifier',
    PORT: String(port)
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

const waitForServer = async () => {
  for (let i = 0; i < 120; i += 1) {
    if (child?.exitCode !== null) throw new Error('Backend exited before becoming live.');
    try {
      const response = await fetch(`${base}/api/health/live`);
      if (response.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error('Backend did not start for Phase 2 verification.');
};

let child = start();
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString(); });

try {
  await waitForServer();
  await login();

  const created = await request('/api/state/projects', {
    method: 'POST',
    body: JSON.stringify({ currentUserRole: 'ADMIN', project: { id: 'P2-FIN-01', caseId: 'P2-FIN-01', customerName: 'Durability test', estimate: 5000, updatedAt: 1000, syncVersion: 1000 } })
  });
  if (!created.response.ok || Number(created.payload?.persistence?.stateVersion || 0) < 1) throw new Error('Project creation did not receive persistence confirmation.');

  const finance = await request('/api/state/projects/P2-FIN-01/payment-status', {
    method: 'POST',
    body: JSON.stringify({ paymentTrackingStatus: 'Paid', expectedFinanceVersion: 0, by: 'Verifier', amountIn: 5000, paymentDate: '2026-07-28', mode: 'UPI', transactionId: 'VERIFY-1' })
  });
  if (!finance.response.ok || finance.payload?.project?.paymentAmountIn !== 5000 || finance.payload?.financeVersion !== 1 || finance.payload?.project?.ledger?.mode !== 'UPI' || finance.payload?.project?.ledger?.txnId !== 'VERIFY-1') throw new Error('Finance update was not durably confirmed with its payment details.');

  const stale = await request('/api/state/projects', {
    method: 'POST',
    body: JSON.stringify({ currentUserRole: 'ADMIN', project: { id: 'P2-FIN-01', caseId: 'P2-FIN-01', customerName: 'Newer operational edit', updatedAt: 9999999999999, syncVersion: 9999999999999, paymentTrackingStatus: 'Not Updated', paymentTrackingUpdatedAt: 10, paymentAmountIn: 0, ledger: { status: 'Not Updated', updatedAt: 10 } } })
  });
  if (!stale.response.ok || stale.payload?.project?.paymentAmountIn !== 5000 || stale.payload?.project?.paymentTrackingStatus !== 'Paid') throw new Error('Stale operational edit overwrote finance fields.');

  const conflict = await request('/api/state/projects/P2-FIN-01/payment-status', {
    method: 'POST',
    body: JSON.stringify({ paymentTrackingStatus: 'Pending', expectedFinanceVersion: 0, by: 'Verifier' })
  });
  if (conflict.response.status !== 409 || conflict.payload?.code !== 'FINANCE_VERSION_CONFLICT') throw new Error('Stale finance version was not rejected.');

  child.kill('SIGTERM');
  await wait(300);
  child = start();
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  await waitForServer();
  await login();

  const afterRestart = await request('/api/state');
  const project = afterRestart.payload?.projects?.find(item => item.id === 'P2-FIN-01');
  if (!afterRestart.response.ok || project?.paymentAmountIn !== 5000 || project?.paymentTrackingStatus !== 'Paid') throw new Error('Finance data did not survive backend restart.');

  const health = await request('/api/finance/health');
  if (!health.response.ok || health.payload?.durableWrites !== true || health.payload?.staleFinanceProtection !== true) throw new Error('Finance health protections are not active.');

  console.log('Phase 2 finance durability verification passed.');
} finally {
  child?.kill('SIGTERM');
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (stderr.trim()) console.error(stderr.trim());
}
