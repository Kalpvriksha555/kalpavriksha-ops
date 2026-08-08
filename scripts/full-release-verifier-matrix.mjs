import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const root = process.cwd();
const reportPath = path.resolve(process.env.KALPA_VERIFY_MATRIX_REPORT || path.join(os.tmpdir(), 'kalpavriksha-full-verifier-matrix.json'));
const defaultTimeoutMs = Math.max(60_000, Number(process.env.KALPA_VERIFY_STEP_TIMEOUT_MS || 10 * 60 * 1000));
const outputLimit = Math.max(100_000, Number(process.env.KALPA_VERIFY_OUTPUT_LIMIT || 2 * 1024 * 1024));
const only = new Set(String(process.env.KALPA_VERIFY_MATRIX_ONLY || '').split(',').map(value => value.trim()).filter(Boolean));
const includeDeploymentGates = String(process.env.KALPA_VERIFY_INCLUDE_DEPLOYMENT_GATES || '').trim().toLowerCase() === 'true';

const testFiles = (directory) => fs.readdirSync(path.join(root, directory))
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
  .map(name => path.join(directory, name));

const steps = [
  { id:'security-package-audit', label:'Security package audit', args:['scripts/security-package-audit.mjs'] },
  { id:'doctor', label:'Project doctor', args:['scripts/doctor.mjs'] },
  { id:'regression-guard', label:'Regression guard', args:['scripts/regression-guard.mjs'] },
  { id:'production-audit', label:'Production regression audit', args:['scripts/production-regression-audit.mjs'] },
  { id:'frontend-tests', label:'Frontend tests', args:['--test', ...testFiles('tests/frontend')] },
  { id:'frontend-runtime-bootstrap', label:'Signed-out React runtime bootstrap', args:['scripts/frontend-runtime-bootstrap-check.mjs'] },
  { id:'backend-tests', label:'Backend tests', args:['--test', ...testFiles('tests/backend')] },
  { id:'finance', label:'Finance durability', args:['scripts/phase-2-finance-durability-check.mjs'] },
  { id:'authentication', label:'Authentication', args:['scripts/phase-3-authentication-check.mjs'] },
  { id:'authorization', label:'Authorization and API protection', args:['scripts/phase-4-authorization-check.mjs'] },
  { id:'database', label:'Database integrity', args:['scripts/phase-5-database-integrity-check.mjs'] },
  { id:'files', label:'Private file storage', args:['scripts/phase-6-file-storage-check.mjs'] },
  { id:'reliability', label:'Operational reliability', args:['scripts/phase-7-reliability-check.mjs'] },
  { id:'release', label:'Release certification', args:['scripts/phase-8-release-certification-check.mjs'] },
  { id:'frontend-ux', label:'Frontend UX', args:['scripts/phase-9-frontend-ux-check.mjs'] },
  { id:'integration', label:'Frontend/backend contract', args:['scripts/frontend-backend-contract-check.mjs'] },
  { id:'build', label:'Production frontend build', args:['node_modules/vite/bin/vite.js', 'build', 'frontend'], timeoutMs:15 * 60 * 1000 },
  ...(includeDeploymentGates ? [
    { id:'clean-install', label:'Isolated clean install', args:['scripts/clean-install-verify.mjs'], timeoutMs:30 * 60 * 1000 },
    { id:'production-environment', label:'Production environment', args:['scripts/production-environment-check.mjs'] },
    { id:'production-integrity-audit', label:'Production relational integrity classification', args:['backend/scripts/db-integrity-audit.mjs'], env:{ KALPA_ALLOW_LEGACY_SHADOW_REBASELINE:'true' }, timeoutMs:10 * 60 * 1000 },
    { id:'backup-create', label:'Pre-deployment backup creation', args:['backend/scripts/backup-create.mjs'], timeoutMs:30 * 60 * 1000 },
    { id:'backup-verify', label:'Pre-deployment backup verification', args:['backend/scripts/backup-verify.mjs'], timeoutMs:15 * 60 * 1000 },
    { id:'backup-status', label:'Pre-deployment backup status', args:['backend/scripts/backup-status.mjs'], timeoutMs:10 * 60 * 1000 }
  ] : [])
].filter(step => !only.size || only.has(step.id));

if (!steps.length) {
  console.error('No release-verifier matrix steps were selected.');
  process.exit(2);
}

const appendTail = (current, chunk) => {
  const next = `${current}${chunk}`;
  return next.length > outputLimit ? next.slice(-outputLimit) : next;
};

const killTree = (child, signal = 'SIGTERM') => {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch {}
  }
};

const runStep = (step) => new Promise((resolve) => {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let settled = false;

  console.log(`\n=== ${step.label} [${step.id}] ===`);
  const child = spawn(process.execPath, step.args, {
    cwd:root,
    env:{ ...process.env, ...(step.env || {}) },
    detached:process.platform !== 'win32',
    stdio:['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    stdout = appendTail(stdout, text);
    process.stdout.write(text);
  });
  child.stderr.on('data', chunk => {
    const text = chunk.toString();
    stderr = appendTail(stderr, text);
    process.stderr.write(text);
  });

  const timeoutMs = Math.max(60_000, Number(step.timeoutMs || defaultTimeoutMs));
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`\n${step.id} exceeded ${timeoutMs} ms; terminating its process group.`);
    killTree(child, 'SIGTERM');
    setTimeout(() => killTree(child, 'SIGKILL'), 3000).unref();
  }, timeoutMs);
  timer.unref();

  const finish = (code, signal, spawnError = '') => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const record = {
      id:step.id,
      label:step.label,
      status:code === 0 && !timedOut && !spawnError ? 'PASS' : 'FAIL',
      exitCode:Number.isInteger(code) ? code : null,
      signal:signal || '',
      timedOut,
      timeoutMs,
      durationMs:Date.now() - started,
      startedAt,
      completedAt:new Date().toISOString(),
      command:[process.execPath, ...step.args].join(' '),
      stdoutTail:stdout.slice(-12_000),
      stderrTail:[stderr, spawnError].filter(Boolean).join('\n').slice(-12_000)
    };
    console.log(`\n--- ${step.id}: ${record.status} (${record.durationMs} ms) ---`);
    resolve(record);
  };

  child.on('error', error => finish(null, '', error.stack || error.message || String(error)));
  child.on('exit', (code, signal) => finish(code, signal));
});

const startedAt = new Date().toISOString();
const results = [];
for (const step of steps) results.push(await runStep(step));

const failures = results.filter(item => item.status !== 'PASS');
const report = {
  schemaVersion:1,
  ok:failures.length === 0,
  startedAt,
  completedAt:new Date().toISOString(),
  nodeVersion:process.version,
  selectedSteps:steps.map(step => step.id),
  passed:results.length - failures.length,
  failed:failures.length,
  total:results.length,
  results
};
fs.mkdirSync(path.dirname(reportPath), { recursive:true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log('\n============================================================');
console.log(`FULL RELEASE VERIFIER MATRIX: ${report.ok ? 'PASS' : 'FAIL'}`);
console.log(`Passed ${report.passed}/${report.total}; failed ${report.failed}.`);
console.log(`Report: ${reportPath}`);
if (failures.length) {
  console.error('\nAll failing gates:');
  for (const failure of failures) {
    console.error(`\n[${failure.id}] ${failure.label}`);
    console.error(failure.stderrTail || failure.stdoutTail || `Exit code ${failure.exitCode}`);
  }
}
console.log('============================================================');

if (!report.ok) process.exitCode = 1;
