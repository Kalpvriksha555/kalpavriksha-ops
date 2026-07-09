import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];

const exists = (p) => fs.existsSync(path.join(root, p));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function walk(dir, out = []) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).replaceAll('\\', '/');
    if (['node_modules', '.git', 'dist', 'release'].includes(entry.name)) continue;
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

for (const p of ['frontend/src/App.jsx', 'frontend/src/main.jsx', 'backend/src/server.js']) {
  if (!exists(p)) errors.push(`Missing required file: ${p}`);
}

const forbidden = walk('.').filter(p => /(^|\/)(node_modules|dist|\.git)(\/|$)/.test(p));
if (forbidden.length) errors.push(`Build/cache folders must not be committed: ${forbidden.slice(0, 8).join(', ')}`);

const envFiles = ['.env', 'frontend/.env', 'backend/.env'].filter(exists);
if (envFiles.length) errors.push(`Raw .env files found in distributable ZIP: ${envFiles.join(', ')}. Use .env.example only.`);

const backupFiles = walk('.').filter(p => !p.startsWith('docs/') && /\.(bak|old|orig|tmp)$|backup|copy/i.test(path.basename(p)));
if (backupFiles.length) warnings.push(`Backup/stale files found: ${backupFiles.slice(0, 12).join(', ')}`);

const srcAppFiles = walk('.').filter(p => /(^|\/)src\/App\.jsx$/.test(p));
if (srcAppFiles.length !== 1 || srcAppFiles[0] !== 'frontend/src/App.jsx') {
  errors.push(`Expected exactly one active App.jsx at frontend/src/App.jsx, found: ${srcAppFiles.join(', ') || 'none'}`);
}

if (exists('frontend/src/App.jsx')) {
  const app = read('frontend/src/App.jsx');
  const createModalCount = (app.match(/showNewLead\s*&&\s*createPortal/g) || []).length;
  if (createModalCount !== 1) errors.push(`Expected one Create Task portal, found ${createModalCount}.`);
  const submitGuardCount = (app.match(/isSubmittingLead/g) || []).length;
  if (submitGuardCount < 3) warnings.push('Create Task submit guard appears weak.');
  const rawAlertCreate = /alert\(`Task could not be created/.test(app);
  if (rawAlertCreate) warnings.push('Create Task still uses browser alert for final fallback errors. Prefer inline error UI in next UX phase.');
}

if (exists('tailwind.config.js')) {
  const tw = read('tailwind.config.js');
  if (!tw.includes('./frontend/src/**/*')) errors.push('Root tailwind.config.js does not scan frontend/src.');
}

// Runtime duplicate-name checks intentionally avoid normal barrel files like index.js.
if (errors.length) {
  console.error('\nProject doctor failed:\n' + errors.map(e => `- ${e}`).join('\n'));
  if (warnings.length) console.warn('\nWarnings:\n' + warnings.map(w => `- ${w}`).join('\n'));
  process.exit(1);
}

console.log('Project doctor passed.');
if (warnings.length) console.warn('\nWarnings:\n' + warnings.map(w => `- ${w}`).join('\n'));
