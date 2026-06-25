import { spawn } from 'node:child_process';
import process from 'node:process';

const run = (name, cmd, args, cwd) => {
  const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32', stdio: 'pipe' });
  child.stdout.on('data', d => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', d => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', code => console.log(`[${name}] exited with code ${code}`));
  return child;
};

const backend = run('backend', 'npm', ['run', 'dev'], 'backend');
const frontend = run('frontend', 'npm', ['run', 'dev'], '.');

const shutdown = () => {
  backend.kill();
  frontend.kill();
  process.exit();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
