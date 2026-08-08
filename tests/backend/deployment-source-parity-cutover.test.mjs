import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createReleaseCertificate, sourceTreeHash, verifyReleaseCertificate } from '../../backend/src/services/releaseCertificationService.js';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const deploy = fs.readFileSync(new URL('../../scripts/deploy-1.9.29-vps.sh', import.meta.url), 'utf8');
const cleaner = path.join(root, 'scripts/source-parity-clean.mjs');

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, value);
}

test('deployment proves exact permanent source parity after rsync and before the permanent release gate', () => {
  const rsyncIndex = deploy.indexOf('rsync -a --delete');
  const parityIndex = deploy.indexOf('source-parity-clean.mjs');
  const installIndex = deploy.indexOf('Installing production backend dependencies at the permanent path');
  const gateIndex = deploy.indexOf('Verifying the permanent live source against the release certificate before build-artifact switching');
  const switchIndex = deploy.indexOf('Preparing an atomic frontend build switch');
  const secondGateIndex = deploy.indexOf('Re-verifying the permanent source after the atomic frontend switch');
  assert.ok(rsyncIndex >= 0);
  assert.ok(parityIndex > rsyncIndex);
  assert.ok(installIndex > parityIndex);
  assert.ok(gateIndex > installIndex);
  assert.ok(switchIndex > gateIndex);
  assert.ok(secondGateIndex > switchIndex);
  assert.match(deploy, /permanent-source-parity\.json/);
  assert.match(deploy, /permanent-live-release-gate\.before-frontend-switch\.json/);
  assert.match(deploy, /permanent-live-release-gate\.after-frontend-switch\.json/);
});

test('source hash ignores explicitly preserved runtime data roots', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-source-hash-'));
  try {
    write(path.join(temp, 'package.json'), '{"name":"x"}\n');
    write(path.join(temp, 'backend/src/server.js'), 'console.log("x")\n');
    const before = sourceTreeHash(temp);
    write(path.join(temp, 'backend/data/runtime.json'), 'runtime');
    write(path.join(temp, 'data/cache.json'), 'runtime');
    write(path.join(temp, 'private-files/blob.bin'), 'runtime');
    write(path.join(temp, 'backups/manifest.json'), 'runtime');
    const after = sourceTreeHash(temp);
    assert.equal(after.hash, before.hash);
    assert.equal(after.fileCount, before.fileCount);
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});


test('atomic frontend dist.next and dist.previous artifacts cannot invalidate the certified source hash', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-source-build-artifacts-'));
  try {
    write(path.join(temp, 'package.json'), '{"name":"x"}\n');
    write(path.join(temp, 'backend/src/server.js'), 'console.log("x")\n');
    write(path.join(temp, 'frontend/src/main.jsx'), 'export default 1;\n');
    const certified = sourceTreeHash(temp);
    write(path.join(temp, 'frontend/dist/index.html'), 'current build\n');
    write(path.join(temp, 'frontend/dist.next/index.html'), 'next build\n');
    write(path.join(temp, 'frontend/dist.previous/index.html'), 'previous build\n');
    const afterBuildSwapArtifacts = sourceTreeHash(temp);
    assert.equal(afterBuildSwapArtifacts.hash, certified.hash);
    assert.equal(afterBuildSwapArtifacts.fileCount, certified.fileCount);
    const certificate = createReleaseCertificate({
      appVersion:'1.9.29-test',
      backendVersion:'2.9.29-test',
      sourceHash:certified.hash,
      sourceFileCount:certified.fileCount,
      checks:[{id:'test',status:'PASS'}],
      cleanInstall:{status:'PASS',sourceHash:certified.hash,sourceMatch:true}
    });
    assert.equal(verifyReleaseCertificate(certificate, {
      expectedAppVersion:'1.9.29-test',
      expectedSourceHash:afterBuildSwapArtifacts.hash,
      requireCleanInstall:true
    }).ok, true);
    write(path.join(temp, 'frontend/src/main.jsx'), 'export default 2;\n');
    assert.notEqual(sourceTreeHash(temp).hash, certified.hash);
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});

test('source parity cleaner removes stale nested project copies and obsolete source files without deleting ignored runtime storage', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-parity-'));
  const release = path.join(temp, 'release');
  const live = path.join(temp, 'live');
  try {
    write(path.join(release, 'package.json'), '{"name":"x"}\n');
    write(path.join(release, 'backend/src/server.js'), 'console.log("release")\n');
    write(path.join(release, 'scripts/tool.mjs'), 'export default 1;\n');
    fs.cpSync(release, live, { recursive:true });

    write(path.join(live, 'backend/backend/src/server.js'), 'stale nested source\n');
    write(path.join(live, 'backend/backend/node_modules/pkg/index.js'), 'stale dependency\n');
    write(path.join(live, 'obsolete-source.js'), 'old\n');
    write(path.join(live, 'private-files/keep.bin'), 'keep me\n');
    write(path.join(live, 'backend/data/keep.json'), 'keep me\n');

    const result = spawnSync(process.execPath, [cleaner, release, live], { encoding:'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.status, 'SOURCE_PARITY_VERIFIED');
    assert.ok(report.removedDuplicateRoots.includes('backend/backend'));
    assert.ok(report.removedObsoleteFiles.includes('obsolete-source.js'));
    assert.equal(fs.existsSync(path.join(live, 'backend/backend')), false);
    assert.equal(fs.readFileSync(path.join(live, 'private-files/keep.bin'), 'utf8'), 'keep me\n');
    assert.equal(fs.readFileSync(path.join(live, 'backend/data/keep.json'), 'utf8'), 'keep me\n');
    assert.equal(sourceTreeHash(live).hash, sourceTreeHash(release).hash);
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});
