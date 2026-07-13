import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production');
const npmCommand = 'npm';
const children = new Set();
let shuttingDown = false;

const parseEnvFile = file => {
  const values = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
};

const configurationCandidates = [
  path.join(root, 'backend', '.env'),
  path.resolve(root, '..', 'kalpavriksha-ops-main', 'kalpavriksha-ops-main', 'backend', '.env'),
  path.resolve(root, '..', 'kalpavriksha-ops-main', 'backend', '.env')
];
const configurationFile = configurationCandidates.find(file => fs.existsSync(file));
const configuredEnvironment = configurationFile ? parseEnvFile(configurationFile) : {};
// Explicit shell variables always win, including an intentionally empty DATABASE_URL.
const runtimeEnvironment = { ...configuredEnvironment, ...process.env };

const run = (name, args, cwd) => {
  const child = spawn(npmCommand, args, {
    cwd,
    shell: process.platform === 'win32',
    stdio: ['inherit', 'pipe', 'pipe'],
    env: runtimeEnvironment
  });
  children.add(child);
  child.stdout.on('data', data => process.stdout.write(`[${name}] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[${name}] ${data}`));
  child.on('error', error => {
    console.error(`[${name}] failed to start: ${error.message}`);
    shutdown(1);
  });
  child.on('exit', code => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[${name}] stopped unexpectedly with code ${code ?? 1}`);
      shutdown(code ?? 1);
    }
  });
  return child;
};

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 100);
};

run('backend', ['run', production ? 'start' : 'dev'], path.join(root, 'backend'));
run('frontend', ['run', production ? 'preview' : 'dev:frontend'], root);

console.log(`Kalpavriksha full stack starting in ${production ? 'production preview' : 'development'} mode.`);
console.log('Frontend: http://localhost:5173');
console.log('Backend:  http://localhost:8080');
console.log(configurationFile
  ? 'Existing backend configuration detected; live shared data will be used when reachable.'
  : 'No backend configuration detected; using the bundled backend/src/data/db.json snapshot.');

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
