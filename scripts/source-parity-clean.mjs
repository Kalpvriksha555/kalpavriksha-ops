import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sourceTreeHash } from '../backend/src/services/releaseCertificationService.js';

const releaseRoot = path.resolve(process.argv[2] || process.cwd());
const liveRoot = path.resolve(process.argv[3] || '');

if (!liveRoot || releaseRoot === liveRoot) {
  throw new Error('Usage: node scripts/source-parity-clean.mjs <release-root> <live-root>; roots must differ.');
}
if (!fs.existsSync(path.join(releaseRoot, 'package.json'))) throw new Error(`Release root is invalid: ${releaseRoot}`);
if (!fs.existsSync(path.join(liveRoot, 'package.json'))) throw new Error(`Live root is invalid: ${liveRoot}`);

const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const release = sourceTreeHash(releaseRoot);
const releaseFiles = new Set(release.files);
const removed = [];
const removedDuplicateRoots = [];

// These paths can only be accidental nested copies of a project root. They are
// not valid runtime storage locations and were observed in production as
// backend/backend/src after an earlier failed synchronization.
for (const relative of ['backend/backend', 'frontend/frontend', 'scripts/scripts', 'docs/docs']) {
  const liveCandidate = path.resolve(liveRoot, relative);
  const releaseCandidate = path.resolve(releaseRoot, relative);
  if (!inside(liveRoot, liveCandidate) || fs.existsSync(releaseCandidate) || !fs.existsSync(liveCandidate)) continue;
  fs.rmSync(liveCandidate, { recursive:true, force:true });
  removedDuplicateRoots.push(relative);
}

let live = sourceTreeHash(liveRoot);
for (const relative of live.files) {
  if (releaseFiles.has(relative)) continue;
  const candidate = path.resolve(liveRoot, relative);
  if (!inside(liveRoot, candidate)) throw new Error(`Refusing to remove path outside live root: ${relative}`);
  fs.rmSync(candidate, { force:true });
  removed.push(relative);
}

// Remove only empty parent directories created by obsolete source files. Never
// recurse here: ignored runtime directories such as node_modules/uploads/data
// are deliberately left untouched.
for (const relative of [...removed].sort((a,b) => b.length - a.length)) {
  let directory = path.dirname(path.resolve(liveRoot, relative));
  while (directory !== liveRoot && inside(liveRoot, directory)) {
    try {
      if (fs.readdirSync(directory).length) break;
      fs.rmdirSync(directory);
      directory = path.dirname(directory);
    } catch {
      break;
    }
  }
}

live = sourceTreeHash(liveRoot);
const missing = release.files.filter((relative) => !live.files.includes(relative));
const extra = live.files.filter((relative) => !releaseFiles.has(relative));
const changed = [];
for (const relative of release.files) {
  if (!live.files.includes(relative)) continue;
  const a = path.join(releaseRoot, relative);
  const b = path.join(liveRoot, relative);
  if (sha256File(a) !== sha256File(b)) changed.push(relative);
}

const ok = missing.length === 0 && extra.length === 0 && changed.length === 0 && live.hash === release.hash && live.fileCount === release.fileCount;
const result = {
  ok,
  status: ok ? 'SOURCE_PARITY_VERIFIED' : 'SOURCE_PARITY_FAILED',
  releaseRoot,
  liveRoot,
  releaseHash: release.hash,
  liveHash: live.hash,
  releaseFileCount: release.fileCount,
  liveFileCount: live.fileCount,
  removedDuplicateRoots,
  removedObsoleteFiles: removed,
  missing: missing.slice(0, 100),
  extra: extra.slice(0, 100),
  changed: changed.slice(0, 100)
};
console.log(JSON.stringify(result, null, 2));
if (!ok) process.exitCode = 1;
