import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

function walk(dir, out = []) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).replaceAll('\\', '/');
    if (['node_modules', '.git', 'dist', 'release', '.vite'].includes(entry.name)) continue;
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const allFiles = walk('.');
const frontendFiles = allFiles.filter((p) => p.startsWith('frontend/src/'));

const activeAppCopies = allFiles.filter((p) => /(^|\/)src\/App\.jsx$/.test(p));
if (activeAppCopies.length !== 1 || activeAppCopies[0] !== 'frontend/src/App.jsx') {
  errors.push(`Expected exactly one active App.jsx. Found: ${activeAppCopies.join(', ') || 'none'}`);
}

const unexpectedFrontendSources = allFiles.filter((p) => /(^|\/)src\//.test(p) && !p.startsWith('frontend/src/') && !p.startsWith('backend/src/'));
if (unexpectedFrontendSources.length) {
  errors.push(`Unexpected source files outside frontend/src or backend/src: ${unexpectedFrontendSources.slice(0, 10).join(', ')}`);
}

const stale = allFiles.filter((p) => !p.startsWith('docs/') && /(?:\.bak|\.old|\.orig|\.tmp|backup|copy)$/i.test(path.basename(p)));
if (stale.length) warnings.push(`Stale/backup files found: ${stale.slice(0, 10).join(', ')}`);

if (exists('frontend/src/components/ui/LayerPortal.jsx')) {
  const layer = read('frontend/src/components/ui/LayerPortal.jsx');
  if (!/lockScroll\s*=\s*true/.test(layer)) errors.push('PortalLayer must support explicit lockScroll defaulting to true.');
  if (!/useBodyScrollLock\(Boolean\(isOpen && lockScroll\)/.test(layer)) errors.push('PortalLayer scroll lock must be controlled by lockScroll, not by isOpen alone.');
}

if (exists('frontend/src/components/ui/designSystem.jsx')) {
  const ui = read('frontend/src/components/ui/designSystem.jsx');
  if (!/ToastViewport[\s\S]*lockScroll=\{false\}/.test(ui)) errors.push('ToastViewport must not lock body scroll.');
}

if (exists('frontend/src/App.jsx')) {
  const app = read('frontend/src/App.jsx');
  const createPortalCount = (app.match(/showNewLead\s*&&\s*\(\s*<PortalLayer/g) || []).length;
  if (createPortalCount !== 1) errors.push(`Expected one Create Task PortalLayer, found ${createPortalCount}.`);

  const previewPortalCount = (app.match(/<PortalLayer\s+isOpen=\{Boolean\(filePreview\)\}/g) || []).length;
  if (previewPortalCount !== 1) errors.push(`Expected one file preview PortalLayer, found ${previewPortalCount}.`);

  const directTaskListSetters = (app.match(/setProjects\(\s*\[/g) || []).length;
  if (directTaskListSetters > 1) warnings.push(`Multiple direct setProjects array replacements found (${directTaskListSetters}). Prefer TaskService merge path.`);

  if (/localStorage\.setItem\(['"]projects['"]/.test(app)) warnings.push('Direct projects localStorage writes remain in App.jsx; keep them behind task service in future phases.');
}

const rawAlertFiles = frontendFiles.filter((file) => /\balert\s*\(/.test(read(file)));
if (rawAlertFiles.length) warnings.push(`Browser alert() still used in: ${rawAlertFiles.slice(0, 8).join(', ')}`);



// File subsystem guardrails.
if (exists('frontend/src/services/fileService.js')) {
  const fileService = read('frontend/src/services/fileService.js');
  if (!/normalizeProjectFileRecord/.test(fileService)) errors.push('File service must normalize mixed legacy file records.');
  if (!/getProjectFileActionState/.test(fileService)) errors.push('File service must expose one shared file action state resolver.');
  if (!/previewUrl/.test(fileService) || !/downloadUrl/.test(fileService)) errors.push('File service must preserve separate preview and download URLs.');
}
if (exists('frontend/src/App.jsx')) {
  const app = read('frontend/src/App.jsx');
  if (/doc\.url\s*\?\s*\(\s*renderFileActionButtons/.test(app) || /doc\.url\s*&&\s*\(\s*renderFileActionButtons/.test(app)) {
    errors.push('File rows must not depend only on doc.url before showing actions; use getProjectFileActionState.');
  }
  if (/Unavailable<\/button>/.test(app)) warnings.push('Legacy file Unavailable buttons remain. Prefer shared Link missing state.');
  if (/â/.test(app)) warnings.push('Possible UTF-8 mojibake remains in App.jsx.');
}

if (errors.length) {
  console.error('\nRegression guard failed:\n' + errors.map((e) => `- ${e}`).join('\n'));
  if (warnings.length) console.warn('\nWarnings:\n' + warnings.map((w) => `- ${w}`).join('\n'));
  process.exit(1);
}

console.log('Regression guard passed.');
if (warnings.length) console.warn('\nWarnings:\n' + warnings.map((w) => `- ${w}`).join('\n'));
