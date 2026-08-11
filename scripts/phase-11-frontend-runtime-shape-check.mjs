import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const frontendRoot = path.join(root, 'frontend', 'src');
const extensions = new Set(['.js', '.jsx']);

const walk = (directory) => fs.readdirSync(directory, { withFileTypes:true }).flatMap(entry => {
  const full = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});

const files = walk(frontendRoot).filter(file => extensions.has(path.extname(file)));
const findings = [];
const checks = [
  {
    id:'truthy-array-fallback-method',
    pattern:/\([A-Za-z_$][\w$?.\[\]'\"]*\s*\|\|\s*\[\]\)\s*\.(?:map|filter|some|every|find|findIndex|forEach|reduce|flatMap|slice|includes|join|sort)\s*\(/g,
    message:'Array methods must not depend on truthiness fallback; validate with asArray()/firstArray().',
  },
  {
    id:'storage-json-array-method',
    pattern:/JSON\.parse\([^\n;]*(?:localStorage|sessionStorage)[^\n;]*\)\s*\.(?:map|filter|some|every|find|findIndex|forEach|reduce|flatMap|slice|includes|join|sort)\s*\(/g,
    message:'Parsed browser storage must be shape-validated before array operations.',
  },
];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const check of checks) {
    for (const match of source.matchAll(check.pattern)) {
      const before = source.slice(0, match.index);
      const line = before.split('\n').length;
      findings.push({ check:check.id, file:path.relative(root, file), line, excerpt:match[0].slice(0, 220), message:check.message });
    }
  }
}

const required = [
  ['frontend/src/utils/runtimeShapeUtils.js', /export const asArray/],
  ['frontend/src/utils/runtimeShapeUtils.js', /export const parseJsonArray/],
  ['frontend/src/utils/runtimeShapeUtils.js', /export const parseJsonRecord/],
  ['frontend/src/App.jsx', /normalizeProjectArrayShapes/],
  ['frontend/src/App.jsx', /sanitizeChatMessageForCache/],
  ['frontend/src/services/taskService.js', /const source = asRecord\(task\)/],
  ['frontend/src/components/chat/CommunicationHub.jsx', /parseJsonRecord\(localStorage\.getItem\(localReadKey\)\)/],
];
for (const [relative, pattern] of required) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  if (!pattern.test(source)) findings.push({ check:'required-guard-missing', file:relative, line:0, excerpt:String(pattern), message:'Required Phase 11 structural guard is missing.' });
}

if (findings.length) {
  console.error('Phase 11 frontend runtime-shape verification failed.');
  for (const finding of findings) console.error(`${finding.file}:${finding.line || '?'} [${finding.check}] ${finding.message}\n  ${finding.excerpt}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok:true,
  check:'phase-11-frontend-runtime-shapes',
  scannedFiles:files.length,
  forbiddenPatterns:checks.length,
  requiredGuards:required.length,
}, null, 2));
