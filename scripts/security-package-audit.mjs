import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];
// Installed dependencies are expected to exist when this audit runs from a
// developer or deployment checkout. Clean-install packaging independently
// excludes node_modules, so walking these directories here only creates false
// "bundled dependency" failures after a legitimate npm install.
const ignoredDirectories = new Set(['.git', 'node_modules']);

function walk(relative = '.') {
  const absolute = path.join(root, relative);
  const output = [];
  if (!fs.existsSync(absolute)) return output;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const child = path.join(relative, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) output.push(...walk(child));
    else output.push(child.replace(/^\.\//, ''));
  }
  return output;
}

const files = walk();
const forbiddenExact = new Set([
  '.env', 'frontend/.env', 'backend/.env',
  'backend/src/data/db.json',
  'vite-localhost.log', 'vite-localhost-error.log'
]);
for (const file of files) {
  if (forbiddenExact.has(file)) errors.push(`Private/runtime file is bundled: ${file}`);
  if (/(^|\/)node_modules\//.test(file)) errors.push(`Dependency directory is bundled: ${file}`);
  if (/(^|\/)dist\//.test(file)) errors.push(`Generated build output is bundled: ${file}`);
  if (/\.log$/i.test(file)) errors.push(`Runtime log is bundled: ${file}`);
  if (/^backend\/(?:src\/)?uploads\//.test(file) && !file.endsWith('/.gitkeep')) errors.push(`Uploaded document is bundled: ${file}`);
  if (/(^|\/)\.release\//.test(file)) errors.push(`Generated release evidence is bundled: ${file}`);
  if (/(^|\/)release-certification\.json$/i.test(file)) errors.push(`Generated release certificate is bundled: ${file}`);
  if (/(^|\/)finance-recovery-plan.*\.json$/i.test(file) || /\.applied\.json$/i.test(file) || /\.recovery-receipt\.json$/i.test(file)) errors.push(`Sensitive finance recovery evidence is bundled: ${file}`);
}

const lockPairs = [
  ['package-lock.json', 'package.json'],
  ['frontend/package-lock.json', 'frontend/package.json'],
  ['backend/package-lock.json', 'backend/package.json']
];
const resolveLockedDependency = (packages, fromKey, dependencyName) => {
  const candidates = [];
  if (!fromKey) candidates.push(`node_modules/${dependencyName}`);
  else {
    let base = fromKey;
    while (true) {
      candidates.push(`${base}/node_modules/${dependencyName}`);
      const index = base.lastIndexOf('/node_modules/');
      if (index < 0) break;
      base = base.slice(0, index);
    }
    candidates.push(`node_modules/${dependencyName}`);
  }
  return candidates.find(candidate => packages[candidate]);
};
for (const [lockFile, manifestFile] of lockPairs) {
  const text = fs.readFileSync(path.join(root, lockFile), 'utf8');
  const lock = JSON.parse(text);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestFile), 'utf8'));
  if (text.includes('packages.applied-caas-gateway1.internal.api.openai.org')) errors.push(`Private package registry remains in ${lockFile}`);
  if (!text.includes('https://registry.npmjs.org/')) warnings.push(`${lockFile} does not contain official npm registry URLs.`);
  for (const section of ['dependencies', 'devDependencies']) {
    const expected = manifest[section] || {};
    const locked = lock.packages?.['']?.[section] || {};
    if (JSON.stringify(expected) !== JSON.stringify(locked)) errors.push(`${lockFile} root ${section} does not match ${manifestFile}.`);
  }
  for (const [packageKey, packageInfo] of Object.entries(lock.packages || {})) {
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const dependencyName of Object.keys(packageInfo?.[section] || {})) {
        if (!resolveLockedDependency(lock.packages, packageKey, dependencyName)) errors.push(`${lockFile} is missing ${dependencyName} required by ${packageKey || '<root>'}.`);
      }
    }
  }
}

for (const manifest of ['package.json', 'frontend/package.json', 'backend/package.json']) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8'));
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(pkg[section] || {})) {
      if (version === 'latest' || version === '*') errors.push(`Unpinned ${section} dependency in ${manifest}: ${name}@${version}`);
    }
  }
}

const sourceFiles = files.filter(file => /^(?:frontend|backend)\/src\/.*\.(?:js|jsx|mjs|cjs)$/.test(file));
for (const file of sourceFiles) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (/password\s*:\s*['\"]123['\"]/.test(source)) errors.push(`Hard-coded default password remains in source: ${file}`);
}
const server = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
if (!server.includes("IS_PRODUCTION && !USE_POSTGRES")) errors.push('Production PostgreSQL startup guard is missing.');
if (server.includes('starting with the bundled JSON snapshot')) errors.push('Silent production JSON fallback remains enabled.');

if (errors.length) {
  console.error('Security package audit failed:\n' + errors.map(error => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log('Security package audit passed.');
if (warnings.length) console.warn(warnings.map(warning => `- ${warning}`).join('\n'));
