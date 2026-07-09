import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];

const exists = (file) => fs.existsSync(path.join(root, file));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function walk(dir, out = []) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).replaceAll('\\', '/');
    if (['node_modules', '.git', 'dist', 'release', '.vite', '.turbo', '.cache'].includes(entry.name)) continue;
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const allFiles = walk('.');
const frontendFiles = allFiles.filter((p) => p.startsWith('frontend/src/'));
const appPath = 'frontend/src/App.jsx';
const serverPath = 'backend/src/server.js';

function requireFile(file) {
  if (!exists(file)) errors.push(`Missing required file: ${file}`);
}

function requireInFile(file, pattern, message) {
  if (!exists(file)) return errors.push(`Missing required file for check: ${file}`);
  const text = read(file);
  if (!pattern.test(text)) errors.push(message);
}

function warnIfInFile(file, pattern, message) {
  if (!exists(file)) return;
  const text = read(file);
  if (pattern.test(text)) warnings.push(message);
}

// Required structure.
['package.json', 'frontend/package.json', 'backend/package.json', appPath, serverPath].forEach(requireFile);

const activeAppCopies = allFiles.filter((p) => /(^|\/)src\/App\.jsx$/.test(p));
if (activeAppCopies.length !== 1 || activeAppCopies[0] !== appPath) {
  errors.push(`Expected exactly one active App.jsx at ${appPath}. Found: ${activeAppCopies.join(', ') || 'none'}`);
}

const rawEnvFiles = allFiles.filter((p) => /(^|\/)\.env$/.test(p));
if (rawEnvFiles.length) errors.push(`Raw .env files found in distributable package: ${rawEnvFiles.join(', ')}`);

const staleFiles = allFiles.filter((p) => !p.startsWith('docs/') && /(?:\.bak|\.old|\.orig|\.tmp|backup|copy)$/i.test(path.basename(p)));
if (staleFiles.length) warnings.push(`Stale/backup files remain: ${staleFiles.slice(0, 12).join(', ')}`);

// Task creation and sync guardrails.
requireFile('frontend/src/services/taskService.js');
requireInFile(appPath, /showNewLead\s*&&\s*\(\s*<PortalLayer/, 'Create Task must open through PortalLayer.');
requireInFile(appPath, /isSubmittingLead/, 'Create Task submit guard is missing.');
requireInFile(appPath, /createTaskApi/, 'Create Task must route through centralized createTaskApi service.');
requireInFile('frontend/src/services/taskService.js', /createTaskApi/, 'Task service must expose createTaskApi.');
requireInFile('frontend/src/services/taskService.js', /mergeTaskLists|mergeTaskRecord/, 'Task service must merge tasks instead of replacing them.');
requireInFile('frontend/src/services/taskService.js', /pending/i, 'Task service must protect pending/fresh tasks.');
warnIfInFile(appPath, /setProjects\(\s*backendProjects\s*\)/, 'Potential overwrite sync found: setProjects(backendProjects).');

// Overlay and modal foundation.
requireFile('frontend/src/components/ui/LayerPortal.jsx');
requireInFile('frontend/src/components/ui/LayerPortal.jsx', /lockScroll\s*=\s*true/, 'PortalLayer must support lockScroll defaulting to true.');
requireInFile('frontend/src/components/ui/LayerPortal.jsx', /previousActiveElement|restoreFocus/i, 'PortalLayer should restore focus after close.');
requireInFile('frontend/src/components/ui/LayerPortal.jsx', /Escape/, 'PortalLayer must support Escape key close.');
requireInFile(appPath, /<PortalLayer\s+isOpen=\{Boolean\(filePreview\)\}/, 'File preview must use one global PortalLayer.');

// Viewer guardrails.
requireInFile(appPath, /Fit Width/i, 'Preview viewer toolbar must include Fit Width.');
requireInFile(appPath, /Fit Page/i, 'Preview viewer toolbar must include Fit Page.');
requireInFile(appPath, /Rotate/i, 'Preview viewer toolbar must include Rotate.');
requireInFile(appPath, /zoom/i, 'Preview viewer must retain zoom controls.');

// Feedback foundation.
requireFile('frontend/src/components/ui/designSystem.jsx');
requireInFile('frontend/src/components/ui/designSystem.jsx', /ToastViewport/, 'Shared ToastViewport is missing.');
requireInFile('frontend/src/components/ui/designSystem.jsx', /lockScroll=\{false\}/, 'ToastViewport must not lock page scroll.');
requireInFile('frontend/src/components/ui/designSystem.jsx', /componentDidCatch|getDerivedStateFromError/, 'Global ErrorBoundary implementation is missing or incomplete.');

// Backend preview/task endpoints.
requireInFile(serverPath, /mode\s*===\s*['"]preview['"]|preview-data|\/preview/, 'Backend preview endpoint/mode is missing.');
requireInFile(serverPath, /Content-Disposition[\s\S]*inline|inline[\s\S]*Content-Disposition/, 'Backend preview endpoint must support inline disposition.');
requireInFile(serverPath, /Content-Disposition[\s\S]*attachment|attachment[\s\S]*Content-Disposition/, 'Backend download endpoint must support attachment disposition.');

// High risk duplicate source implementation checks.
const duplicateNamedSources = frontendFiles.filter((p) => /(?:App\.jsx|taskService\.js|LayerPortal\.jsx|designSystem\.jsx)$/.test(p));
const duplicateGroups = duplicateNamedSources.reduce((acc, file) => {
  const name = path.basename(file);
  acc[name] = acc[name] || [];
  acc[name].push(file);
  return acc;
}, {});
for (const [name, files] of Object.entries(duplicateGroups)) {
  if (name === 'App.jsx' && files.length !== 1) errors.push(`Duplicate App.jsx files: ${files.join(', ')}`);
}

// Browser-blocking alert checks are warnings for now, because some legacy paths still use final fallback alerts.
const alertFiles = frontendFiles.filter((file) => /\balert\s*\(/.test(read(file)));
if (alertFiles.length) warnings.push(`Legacy alert() calls remain: ${alertFiles.slice(0, 8).join(', ')}`);



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
  console.error('\nProduction regression audit failed:\n' + errors.map((e) => `- ${e}`).join('\n'));
  if (warnings.length) console.warn('\nWarnings:\n' + warnings.map((w) => `- ${w}`).join('\n'));
  process.exit(1);
}

console.log('Production regression audit passed.');
if (warnings.length) console.warn('\nWarnings:\n' + warnings.map((w) => `- ${w}`).join('\n'));
