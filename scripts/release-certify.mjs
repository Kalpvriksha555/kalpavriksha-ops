import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createReleaseCertificate, sourceTreeHash, validateProductionEnvironment } from '../backend/src/services/releaseCertificationService.js';
import { inspectBackupManifests } from '../backend/src/services/operationalReliabilityService.js';
import { validateCandidateReceipt } from './deployment-receipt-utils.mjs';

const root = process.cwd();
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const backendPackage = JSON.parse(fs.readFileSync(path.join(root, 'backend/package.json'), 'utf8'));
const cleanReportPath = path.resolve(process.env.CLEAN_INSTALL_REPORT || '.release/clean-install-report.json');
const certificatePath = path.resolve(process.env.RELEASE_CERTIFICATE_PATH || 'release-certification.json');
const maxAgeHours = Math.max(1, Number(process.env.RELEASE_CERTIFICATE_MAX_AGE_HOURS || 24));
const requireProductionEnvironment = String(process.env.RELEASE_VALIDATE_PRODUCTION_ENV || process.env.NODE_ENV === 'production').toLowerCase() === 'true';
const requireBackup = String(process.env.RELEASE_REQUIRE_BACKUP || process.env.NODE_ENV === 'production').toLowerCase() === 'true';
const checks = [];
const resumeAwareReceiptPath = String(process.env.KALPA_RESUME_AWARE_CANDIDATE_RECEIPT || '').trim();

function resolveNpmInvocation(args = []) {
  const candidates = [
    String(process.env.npm_execpath || '').trim(),
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (npmCli) return { command: process.execPath, args: [npmCli, ...args] };
  if (process.platform === 'win32') {
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'npm', ...args] };
  }
  return { command: 'npm', args };
}

function runNpm(id, args) {
  const invocation = resolveNpmInvocation(args);
  return run(id, invocation.command, invocation.args);
}

function run(id, command, args) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: Number(process.env.RELEASE_CHECK_TIMEOUT_MS || 600000)
  });
  const record = {
    id,
    status: result.status === 0 ? 'PASS' : 'FAIL',
    durationMs: Date.now() - started,
    details: {
      command: [command, ...args].join(' '),
      exitCode: result.status,
      stdoutTail: String(result.stdout || '').slice(-2000),
      stderrTail: [String(result.stderr || ''), result.error ? String(result.error.stack || result.error.message || result.error) : ''].filter(Boolean).join('\n').slice(-2000)
    }
  };
  checks.push(record);
  if (result.status !== 0) throw new Error(`${id} failed.\n${record.details.stderrTail || record.details.stdoutTail}`);
}

if (!fs.existsSync(cleanReportPath)) throw new Error(`Clean-install report is missing: ${cleanReportPath}. Run npm run release:clean-install first.`);
const cleanInstall = JSON.parse(fs.readFileSync(cleanReportPath, 'utf8'));
const source = sourceTreeHash(root);
if (cleanInstall.status !== 'PASS' || cleanInstall.sourceHash !== source.hash || cleanInstall.sourceMatch !== true) {
  throw new Error('The clean-install report is not PASS or no longer matches the current source tree. Run npm run release:clean-install again.');
}

const gitCommitResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const gitCommit = gitCommitResult.status === 0 ? String(gitCommitResult.stdout || '').trim() : '';

let resumeAwareCandidate = null;
if (resumeAwareReceiptPath) {
  const receipt = JSON.parse(fs.readFileSync(path.resolve(resumeAwareReceiptPath), 'utf8'));
  const validation = validateCandidateReceipt(root, receipt, { commit:gitCommit, requireArtifacts:true });
  if (!validation.ok) throw new Error(`Resume-aware candidate receipt is invalid: ${validation.errors.join(' ')}`);
  resumeAwareCandidate = validation;
}

if (resumeAwareCandidate) {
  for (const id of [
    'candidate_full_verification_receipt',
    'candidate_frontend_runtime_receipt',
    'candidate_frontend_build_receipt',
    'candidate_clean_install_receipt'
  ]) {
    checks.push({ id, status:'PASS', durationMs:0, details:{ reused:true, sourceHash:source.hash } });
  }
} else {
  for (const script of [
    'security:package-audit', 'doctor', 'guard', 'audit:production',
    'verify:finance', 'verify:auth', 'verify:authorization', 'verify:database',
    'verify:files', 'verify:reliability', 'verify:release', 'build'
  ]) runNpm(script, ['run', script]);
}

let environment = null;
if (requireProductionEnvironment) {
  environment = validateProductionEnvironment(process.env);
  if (!environment.ok) throw new Error(`Production environment validation failed: ${environment.errors.map((item) => item.message).join(' ')}`);
}

let backup = null;
if (requireBackup) {
  const backupRoot = String(process.env.KALPA_BACKUP_ROOT || '').trim();
  if (!backupRoot) throw new Error('KALPA_BACKUP_ROOT is required for release certification.');
  const status = inspectBackupManifests(backupRoot, { maxAgeHours: Number(process.env.BACKUP_MAX_AGE_HOURS || 26) });
  if (!status.ok) throw new Error(`Verified backup is not ready: ${status.status}.`);
  const verifiedBackup = status.latestVerified || status.latest;
  backup = { id: verifiedBackup?.id || '', status: verifiedBackup?.status || '', ok: status.ok, createdAt: verifiedBackup?.createdAt || '', manifestPath: verifiedBackup?.manifestPath || '' };
}

let database = null;
if (/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ''))) {
  const reuseDatabaseIntegrity = String(process.env.KALPA_REUSE_DATABASE_INTEGRITY || '').toLowerCase() === 'true';
  if (reuseDatabaseIntegrity) {
    const currentInputHash = String(process.env.KALPA_DATABASE_INPUT_HASH || '').trim();
    const deployedInputHash = String(process.env.KALPA_DEPLOYED_DATABASE_INPUT_HASH || '').trim();
    const runtimeReady = String(process.env.KALPA_CURRENT_RUNTIME_READY_PROOF || '').toLowerCase() === 'true';
    if (!currentInputHash || currentInputHash !== deployedInputHash || !runtimeReady) {
      throw new Error('Database integrity reuse requires identical database input hashes and a current READY runtime proof.');
    }
    checks.push({ id:'database_integrity_resume_receipt', status:'PASS', durationMs:0, details:{ reused:true, databaseInputHash:currentInputHash } });
    database = { status:'PASS', checkedAt:new Date().toISOString(), reused:true, databaseInputHash:currentInputHash };
  } else {
    runNpm('database_integrity', ['run', 'db:integrity', '--prefix', 'backend']);
    database = { status: 'PASS', checkedAt: new Date().toISOString(), reused:false };
  }
}

const certificate = createReleaseCertificate({
  appVersion: rootPackage.version,
  backendVersion: backendPackage.version,
  sourceHash: source.hash,
  sourceFileCount: source.fileCount,
  gitCommit,
  checks,
  cleanInstall,
  backup,
  database,
  environment,
  maxAgeHours
});
fs.writeFileSync(certificatePath, JSON.stringify(certificate, null, 2));
if (certificate.status === 'CERTIFIED' && /^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ''))) {
  try {
    run('record_release_certificate', process.execPath, ['backend/scripts/release-record.mjs']);
  } catch (error) {
    fs.rmSync(certificatePath, { force:true });
    throw error;
  }
}
console.log(JSON.stringify({ ok: certificate.status === 'CERTIFIED', certificatePath, certificate }, null, 2));
if (certificate.status !== 'CERTIFIED') process.exitCode = 1;
