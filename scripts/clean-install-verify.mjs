import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sourceTreeHash } from '../backend/src/services/releaseCertificationService.js';

const root = process.cwd();
const output = path.resolve(process.env.CLEAN_INSTALL_REPORT || '.release/clean-install-report.json');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kalp-clean-install-'));
const copyRoot = path.join(tempRoot, 'project');
const startedAt = new Date().toISOString();
const commands = [];

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

function runNpm(label, args, cwd = copyRoot) {
  const invocation = resolveNpmInvocation(args);
  return run(label, invocation.command, invocation.args, cwd);
}

const ignore = (source) => {
  const relative = path.relative(root, source).replaceAll('\\', '/');
  return !/(^|\/)(?:node_modules|dist|release|\.release|coverage|test-results|playwright-report)(\/|$)/.test(relative)
    && !/(^|\/)backend\/src\/(?:data|uploads)(\/|$)/.test(relative)
    && !/(^|\/)\.env(?:\.|$)/.test(relative)
    && !/\.log$/i.test(relative);
};

function run(label, command, args, cwd = copyRoot) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: Number(process.env.CLEAN_INSTALL_COMMAND_TIMEOUT_MS || 600000)
  });
  const record = {
    id: label,
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'PASS' : 'FAIL',
    durationMs: Date.now() - started,
    exitCode: result.status,
    stdoutTail: String(result.stdout || '').slice(-4000),
    stderrTail: [String(result.stderr || ''), result.error ? String(result.error.stack || result.error.message || result.error) : ''].filter(Boolean).join('\n').slice(-4000)
  };
  commands.push(record);
  if (result.status !== 0) {
    const error = new Error(`${label} failed.\n${record.stderrTail || record.stdoutTail}`);
    error.record = record;
    throw error;
  }
}

let status = 'FAIL';
let errorMessage = '';
try {
  fs.cpSync(root, copyRoot, { recursive: true, filter: ignore });
  runNpm('root_npm_ci', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  runNpm('backend_npm_ci', ['ci', '--prefix', 'backend', '--no-audit', '--no-fund']);
  runNpm('frontend_npm_ci', ['ci', '--prefix', 'frontend', '--no-audit', '--no-fund']);
  runNpm('frontend_build', ['run', 'build']);
  run('backend_syntax', process.execPath, ['--check', 'backend/src/server.js']);
  status = 'PASS';
} catch (error) {
  errorMessage = error.message || String(error);
} finally {
  const originalHash = sourceTreeHash(root);
  const copiedHash = fs.existsSync(copyRoot) ? sourceTreeHash(copyRoot) : { hash: '', fileCount: 0 };
  const report = {
    schemaVersion: 1,
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    sourceHash: originalHash.hash,
    sourceFileCount: originalHash.fileCount,
    copiedSourceHash: copiedHash.hash,
    copiedSourceFileCount: copiedHash.fileCount,
    sourceMatch: originalHash.hash === copiedHash.hash,
    nodeVersion: process.version,
    npmVersion: (() => {
      const invocation = resolveNpmInvocation(['--version']);
      return spawnSync(invocation.command, invocation.args, { encoding: 'utf8' }).stdout?.trim() || '';
    })(),
    commands,
    error: errorMessage
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: status === 'PASS', report: output, ...report }, null, 2));
  if (status !== 'PASS' || !report.sourceMatch) process.exitCode = 1;
}
