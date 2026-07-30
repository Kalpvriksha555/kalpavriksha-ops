import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  applyFinanceRecoveryPlanToCases,
  buildFinanceRecoveryPlan,
  createReleaseCertificate,
  sourceTreeHash,
  validateProductionEnvironment,
  verifyFinanceRecoveryPlan,
  verifyReleaseCertificate
} from '../backend/src/services/releaseCertificationService.js';

const root = process.cwd();
const requiredFiles = [
  'scripts/clean-install-verify.mjs',
  'scripts/release-certify.mjs',
  'scripts/release-gate.mjs',
  'backend/scripts/finance-recovery-plan.mjs',
  'backend/scripts/finance-recovery-apply.mjs',
  'tests/frontend/core-utils.test.mjs'
];
for (const file of requiredFiles) assert.ok(fs.existsSync(path.join(root, file)), `Missing Phase 8 file: ${file}`);

const repositorySource = fs.readFileSync(path.join(root, 'backend/src/repositories/postgresStateRepository.js'), 'utf8');
for (const token of ["migration('008.001'", 'release_certifications', 'finance_recovery_runs', 'metadata.financeEvents']) {
  assert.ok(repositorySource.includes(token), `Missing Phase 8 database protection: ${token}`);
}
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const backendPackageJson = JSON.parse(fs.readFileSync(path.join(root, 'backend/package.json'), 'utf8'));
for (const script of ['release:clean-install', 'release:certify', 'release:gate', 'verify:release', 'finance-recovery:plan', 'finance-recovery:apply', 'test:frontend']) {
  assert.ok(packageJson.scripts?.[script], `Missing package script: ${script}`);
}

const safeEnvironment = validateProductionEnvironment({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example.com:5432/kalpavriksha',
  ALLOW_JSON_FALLBACK: 'false',
  CORS_ORIGIN: 'https://ops.kalpvriksha.co.in',
  KALPA_FILE_STORAGE_ROOT: '/srv/kalpavriksha/files',
  FILE_STORAGE_PERSISTENT: 'true',
  KALPA_BACKUP_ROOT: '/srv/kalpavriksha/backups',
  BACKUP_REQUIRED: 'true',
  BACKUP_STORAGE_PERSISTENT: 'true',
  BOOTSTRAP_ADMIN_PASSWORD: '',
  ALLOW_LOCAL_EMAIL_OTP: 'false',
  RELEASE_CERTIFICATE_PATH: '/srv/kalpavriksha/release-certification.json',
  SESSION_COOKIE_NAME: 'kv_session',
  SESSION_TTL_HOURS: '12',
  MAX_UPLOAD_SIZE_MB: '100'
});
assert.equal(safeEnvironment.ok, true, JSON.stringify(safeEnvironment.errors));
assert.equal(validateProductionEnvironment({ NODE_ENV: 'production' }).ok, false);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kalp-release-hash-'));
fs.writeFileSync(path.join(temp, 'a.txt'), 'one');
const firstHash = sourceTreeHash(temp);
fs.writeFileSync(path.join(temp, 'a.txt'), 'two');
const secondHash = sourceTreeHash(temp);
assert.notEqual(firstHash.hash, secondHash.hash);
fs.rmSync(temp, { recursive: true, force: true });

const cleanInstall = { status: 'PASS', sourceHash: 'source-hash', sourceMatch: true };
const certificate = createReleaseCertificate({
  appVersion: '1.0.0',
  backendVersion: '1.0.0',
  sourceHash: 'source-hash',
  sourceFileCount: 10,
  checks: [{ id: 'tests', status: 'PASS' }],
  cleanInstall,
  backup: { status: 'VERIFIED', ok: true },
  maxAgeHours: 24
});
assert.equal(verifyReleaseCertificate(certificate, { expectedAppVersion: '1.0.0', expectedSourceHash: 'source-hash', requireBackup: true }).ok, true);
const tampered = structuredClone(certificate);
tampered.sourceHash = 'tampered';
assert.equal(verifyReleaseCertificate(tampered, { expectedAppVersion: '1.0.0' }).ok, false);

const sourceCases = [
  { id: 'CASE-1', customerName: 'Do not replace', financeVersion: 200, paymentAmountIn: 5000, paymentTrackingStatus: 'Paid', ledger: { amountIn: 5000, updatedAt: 200 } },
  { id: 'CASE-2', financeVersion: 100, paymentAmountIn: 1000, paymentTrackingStatus: 'Pending', ledger: { amountIn: 1000, updatedAt: 100 } },
  { id: 'MISSING', financeVersion: 300, paymentAmountIn: 7000 }
];
const targetCases = [
  { id: 'CASE-1', customerName: 'Live customer', status: 'Completed', financeVersion: 100, paymentAmountIn: 0, paymentTrackingStatus: 'Pending', ledger: { amountIn: 0, updatedAt: 100 } },
  { id: 'CASE-2', status: 'Completed', financeVersion: 300, paymentAmountIn: 3000, paymentTrackingStatus: 'Paid', ledger: { amountIn: 3000, updatedAt: 300 } }
];
const plan = buildFinanceRecoveryPlan({ sourceCases, targetCases, targetStateVersion: 41, targetDatabaseFingerprint: 'db-fingerprint' });
assert.equal(plan.summary.recover, 1);
assert.equal(plan.summary.skipped, 2);
assert.equal(verifyFinanceRecoveryPlan(plan, { targetStateVersion: 41, targetDatabaseFingerprint: 'db-fingerprint' }).ok, true);
assert.equal(verifyFinanceRecoveryPlan(plan, { targetStateVersion: 42, targetDatabaseFingerprint: 'db-fingerprint' }).ok, false);
assert.throws(() => applyFinanceRecoveryPlanToCases(targetCases, plan, { confirmation: 'wrong' }), /Confirmation must exactly match/);
const applied = applyFinanceRecoveryPlanToCases(targetCases, plan, { confirmation: `APPLY FINANCE RECOVERY ${plan.id}`, actor: 'Admin', now: 1000 });
assert.equal(applied.recoveredCount, 1);
const recovered = applied.updatedCases.find((item) => item.id === 'CASE-1');
assert.equal(recovered.paymentAmountIn, 5000);
assert.equal(recovered.customerName, 'Live customer');
assert.equal(recovered.status, 'Completed');
assert.equal(applied.updatedCases.find((item) => item.id === 'CASE-2').paymentAmountIn, 3000);

const staleTargets = structuredClone(targetCases);
staleTargets[0].paymentAmountIn = 123;
assert.throws(() => applyFinanceRecoveryPlanToCases(staleTargets, plan, { confirmation: `APPLY FINANCE RECOVERY ${plan.id}`, actor: 'Admin', now: 1000 }), (error) => error.code === 'FINANCE_RECOVERY_TARGET_CHANGED');

// Runtime certification/readiness check in the isolated JSON sandbox.
let runtimeReadinessCertificateGate = false;
const backendRuntimeAvailable = fs.existsSync(path.join(root, 'backend/node_modules/dotenv/package.json'));
if (backendRuntimeAvailable) {
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kalp-phase8-runtime-'));
const runtimeData = path.join(runtimeRoot, 'data');
const backupRoot = path.join(runtimeRoot, 'backups');
const fileRoot = path.join(runtimeRoot, 'files');
fs.mkdirSync(runtimeData, { recursive:true });
fs.mkdirSync(backupRoot, { recursive:true });
fs.writeFileSync(path.join(runtimeData, 'db.json'), JSON.stringify({ users:[], cases:[], payments:[], teamChat:[], notifications:[], attendanceLogs:[], audit:[], files:[] }));
const backupFile = path.join(backupRoot, 'phase8.dump');
fs.writeFileSync(backupFile, 'phase8 verified backup');
const backupSha = crypto.createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex');
fs.writeFileSync(path.join(backupRoot, 'phase8.manifest.json'), JSON.stringify({
  schemaVersion:1,id:'phase8-backup',backupType:'DATABASE',status:'VERIFIED',ok:true,createdAt:new Date().toISOString(),verifiedAt:new Date().toISOString(),
  components:{ database:{ file:'phase8.dump',sizeBytes:fs.statSync(backupFile).size,sha256:backupSha } },verification:{ok:true,checks:[{component:'database',ok:true}]}
}, null, 2));
const runtimeCertificatePath = path.join(runtimeRoot, 'release-certification.json');
const runtimeCertificate = createReleaseCertificate({
  appVersion:packageJson.version,
  backendVersion:backendPackageJson.version,
  sourceHash:'runtime-source',
  sourceFileCount:1,
  checks:[{id:'runtime',status:'PASS'}],
  cleanInstall:{status:'PASS',sourceHash:'runtime-source',sourceMatch:true},
  backup:{status:'VERIFIED',ok:true},
  maxAgeHours:24
});
fs.writeFileSync(runtimeCertificatePath, JSON.stringify(runtimeCertificate, null, 2));
const runtimePort = 28000 + (process.pid % 1000);
const runtimeBase = `http://127.0.0.1:${runtimePort}`;
let runtimeChild;
let runtimeOutput = '';
const startRuntime = async () => {
  runtimeChild = spawn(process.execPath, ['backend/src/server.js'], {
    cwd:root,
    env:{...process.env,NODE_ENV:'development',DATABASE_URL:'',DB_SSL:'false',ALLOW_JSON_FALLBACK:'true',BACKUP_REQUIRED:'true',RELEASE_CERTIFICATE_REQUIRED:'true',DISK_WARNING_PERCENT:'98',DISK_CRITICAL_PERCENT:'100',PORT:String(runtimePort),KALPA_DATA_DIR:runtimeData,KALPA_DB_FILE:path.join(runtimeData,'db.json'),KALPA_AUTH_FILE:path.join(runtimeData,'auth.json'),KALPA_FILE_STORAGE_ROOT:fileRoot,KALPA_BACKUP_ROOT:backupRoot,RELEASE_CERTIFICATE_PATH:runtimeCertificatePath,BOOTSTRAP_ADMIN_USERNAME:'phase8admin',BOOTSTRAP_ADMIN_PASSWORD:'StrongAdmin123',BOOTSTRAP_ADMIN_NAME:'Phase 8 Admin',API_WRITE_RATE_LIMIT:'1000'},
    stdio:['ignore','pipe','pipe']
  });
  runtimeChild.stdout.on('data', (chunk) => { runtimeOutput += chunk.toString(); });
  runtimeChild.stderr.on('data', (chunk) => { runtimeOutput += chunk.toString(); });
  for (let index=0; index<100; index+=1) {
    if (runtimeChild.exitCode !== null) throw new Error(`Phase 8 runtime server exited early.\n${runtimeOutput}`);
    try { if ((await fetch(`${runtimeBase}/api/health/live`)).ok) return; } catch {}
    await delay(100);
  }
  throw new Error(`Phase 8 runtime server did not start.\n${runtimeOutput}`);
};
const stopRuntime = async () => {
  if (!runtimeChild || runtimeChild.exitCode !== null) return;
  runtimeChild.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => runtimeChild.once('exit', resolve)), delay(3000).then(() => runtimeChild.exitCode === null && runtimeChild.kill('SIGKILL'))]);
};
const runtimeRequest = async (pathname, { method='GET', body, session } = {}) => {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session?.cookie) headers.Cookie = session.cookie;
  if (session?.csrf && !['GET','HEAD','OPTIONS'].includes(method)) headers['X-CSRF-Token'] = session.csrf;
  const response = await fetch(`${runtimeBase}${pathname}`, { method,headers,body:body===undefined?undefined:JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  return { response,payload,cookie:(response.headers.get('set-cookie') || '').split(';')[0] || session?.cookie || '' };
};
try {
  await startRuntime();
  const ready = await runtimeRequest('/api/health/ready');
  assert.equal(ready.response.status, 200, JSON.stringify(ready.payload));
  assert.equal(ready.payload.checks.releaseCertificate, true);
  const login = await runtimeRequest('/api/auth/login', { method:'POST',body:{username:'phase8admin',password:'StrongAdmin123'} });
  assert.equal(login.response.ok, true, JSON.stringify(login.payload));
  const session = { cookie:login.cookie,csrf:login.payload.csrfToken };
  const status = await runtimeRequest('/api/system/release-certification', { session });
  assert.equal(status.response.status, 200, JSON.stringify(status.payload));
  assert.equal(status.payload.status, 'VALID');
  const editedCertificate = structuredClone(runtimeCertificate);
  editedCertificate.sourceHash = 'tampered-after-certification';
  fs.writeFileSync(runtimeCertificatePath, JSON.stringify(editedCertificate, null, 2));
  const blocked = await runtimeRequest('/api/health/ready');
  assert.equal(blocked.response.status, 503);
  assert.equal(blocked.payload.checks.releaseCertificate, false);
} finally {
  await stopRuntime();
  fs.rmSync(runtimeRoot, { recursive:true,force:true });
}
runtimeReadinessCertificateGate = true;
} else if (String(process.env.PHASE8_REQUIRE_RUNTIME || '').toLowerCase() === 'true') {
  throw new Error('Phase 8 runtime verification requires backend dependencies. Run npm ci first.');
}

console.log(JSON.stringify({
  ok: true,
  phase: 8,
  releaseCertificateIntegrity: true,
  cleanInstallGate: true,
  productionEnvironmentGate: true,
  selectiveFinanceRecovery: true,
  staleRecoveryProtection: true,
  runtimeReadinessCertificateGate,
  migration: '008.001'
}, null, 2));
