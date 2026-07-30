import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const errors = [];
const requireFile = (file) => { if (!fs.existsSync(path.join(root, file))) errors.push(`Missing ${file}`); };
const requirePattern = (file, pattern, message) => { if (!pattern.test(read(file))) errors.push(message); };

[
  'frontend/src/components/ui/FeedbackHost.jsx',
  'frontend/src/services/uiFeedback.js',
  'frontend/src/hooks/useAdaptiveWorkspaceSync.js',
  'frontend/src/utils/archiveUtils.js',
  'frontend/src/components/archive/HistoryArchiveView.jsx',
  'frontend/src/styles/phase9.css',
  'tests/frontend/phase9-ux.test.mjs',
].forEach(requireFile);

const frontendFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel);
    else if (/\.(js|jsx)$/.test(entry.name)) frontendFiles.push(rel);
  }
};
walk('frontend/src');
const browserBlocking = frontendFiles.filter((file) => /(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(read(file)));
if (browserBlocking.length) errors.push(`Browser-blocking dialogs remain: ${browserBlocking.join(', ')}`);

const app = read('frontend/src/App.jsx');
if (/from ['"]firebase\//.test(app)) errors.push('Firebase production imports remain in App.jsx.');
if (/AIza|firebaseapp\.com|firebasestorage/.test(app)) errors.push('Hard-coded Firebase configuration remains.');
if (/dangerouslySetInnerHTML=\{\{__html:\s*`/.test(app)) errors.push('Large inline runtime CSS remains in App.jsx.');
if (/setInterval\(refreshPresence,\s*10000\)/.test(app)) errors.push('Legacy ten-second full-state polling remains.');
if (/setProjects\(\s*(?:\[|filterDeletedProjects|nextProjects)/.test(app)) errors.push('Direct project-array replacement remains.');
requirePattern('frontend/src/App.jsx', /useAdaptiveWorkspaceSync\(/, 'Adaptive workspace synchronisation is not wired.');
requirePattern('frontend/src/App.jsx', /React\.lazy/, 'Route-level lazy loading is missing.');
requirePattern('frontend/src/App.jsx', /kalpa-skip-link/, 'Skip-to-content accessibility link is missing.');
requirePattern('frontend/src/components/archive/HistoryArchiveView.jsx', /openLocations/, 'Archive open-group state is missing.');
requirePattern('frontend/src/components/archive/HistoryArchiveView.jsx', /Expand all/, 'Archive expand-all control is missing.');
requirePattern('frontend/src/components/archive/HistoryArchiveView.jsx', /kalpa-archive-mobile-card/, 'Archive mobile cards are missing.');
requirePattern('frontend/src/styles/phase9.css', /prefers-reduced-motion/, 'Reduced-motion accessibility rules are missing.');

const pkg = JSON.parse(read('package.json'));
if (pkg.dependencies?.firebase) errors.push('Firebase dependency remains in package.json.');
if (!String(pkg.scripts?.verify || '').includes('verify:frontend-ux')) errors.push('Phase 9 verifier is not part of npm run verify.');

if (errors.length) {
  console.error('Phase 9 frontend/UX verification failed:\n' + errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log('Phase 9 frontend/UX verification passed.');
