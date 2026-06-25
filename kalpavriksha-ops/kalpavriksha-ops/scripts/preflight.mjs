import { execSync } from 'node:child_process';
import fs from 'node:fs';

const run = (label, cmd, opts = {}) => {
  process.stdout.write(`\n[${label}] ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit', shell: true, ...opts });
};

try {
  run('Frontend build', 'npm run build');
  run('Smoke checks', 'npm run smoke');
  run('Frontend audit', 'npm audit --audit-level=high');
  if (fs.existsSync('backend/package.json')) {
    run('Backend install check', 'npm install --prefix backend');
    run('Backend syntax check', 'node --check backend/src/server.js');
    run('Backend audit', 'npm audit --prefix backend --audit-level=high');
  }
  console.log('\n✅ Production preflight completed successfully.');
} catch (error) {
  console.error('\n❌ Production preflight failed. Fix the error above before going live.');
  process.exit(1);
}
