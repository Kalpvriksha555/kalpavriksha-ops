import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCandidatePhaseSnapshot,
  buildDeploymentState,
  computeDeploymentFingerprints,
  validateCandidateReceipt,
  validateDeploymentState
} from '../../scripts/deployment-receipt-utils.mjs';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kalp-phase21-'));
  const packageRecord = (name, version, dependency = '1.0.0') => ({
    name, version, type:'module', scripts:{ build:'echo build', start:'node src.js', verify:'echo verify' }, dependencies:{ dep:dependency }
  });
  const lockRecord = (name, version, dependency = '1.0.0') => ({
    name, version, lockfileVersion:3, packages:{ '':{ name, version, dependencies:{ dep:dependency } }, 'node_modules/dep':{ version:dependency } }
  });
  writeJson(path.join(root, 'package.json'), packageRecord('root-app', '1.0.0'));
  writeJson(path.join(root, 'package-lock.json'), lockRecord('root-app', '1.0.0'));
  writeJson(path.join(root, 'backend/package.json'), packageRecord('backend-app', '2.0.0'));
  writeJson(path.join(root, 'backend/package-lock.json'), lockRecord('backend-app', '2.0.0'));
  writeJson(path.join(root, 'frontend/package.json'), packageRecord('frontend-app', '2.0.0'));
  writeJson(path.join(root, 'frontend/package-lock.json'), lockRecord('frontend-app', '2.0.0'));
  fs.mkdirSync(path.join(root, 'backend/src'), { recursive:true });
  fs.mkdirSync(path.join(root, 'frontend/src'), { recursive:true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive:true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive:true });
  fs.writeFileSync(path.join(root, 'backend/src/server.js'), 'export const backend = 1;\n');
  fs.writeFileSync(path.join(root, 'frontend/src/app.js'), 'export const frontend = 1;\n');
  fs.writeFileSync(path.join(root, 'scripts/release-certify.mjs'), 'export const verify = 1;\n');
  fs.writeFileSync(path.join(root, 'scripts/deploy-example.sh'), '#!/bin/sh\necho deploy\n');
  fs.writeFileSync(path.join(root, 'tests/example.test.mjs'), 'export const testValue = 1;\n');
  fs.writeFileSync(path.join(root, 'RELEASE_FILE_MANIFEST.sha256'), 'fixture-manifest\n');
  return root;
}
function changeVersion(root, relativePackage, relativeLock, version) {
  const pkgPath = path.join(root, relativePackage);
  const lockPath = path.join(root, relativeLock);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); pkg.version = version; writeJson(pkgPath, pkg);
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); lock.version = version; lock.packages[''].version = version; writeJson(lockPath, lock);
}
function certifiedReceipt(root, commit = 'abc123') {
  fs.mkdirSync(path.join(root, 'frontend/dist'), { recursive:true });
  fs.writeFileSync(path.join(root, 'frontend/dist/index.html'), '<!doctype html><div id="root"></div>');
  fs.mkdirSync(path.join(root, '.release'), { recursive:true });
  const source = computeDeploymentFingerprints(root);
  writeJson(path.join(root, '.release/clean-install-report.json'), { status:'PASS', sourceHash:source.sourceTreeHash, sourceMatch:true });
  const phaseReceipts = buildCandidatePhaseSnapshot(root, {
    commit,
    proofs:{ dependencyInstall:true, frontendRuntime:true, fullVerify:true, cleanInstall:true, candidateE2E:true }
  });
  return { ok:true, status:'CERTIFIED_FOR_GUARDED_DEPLOYMENT', commit, phaseReceipts };
}

test('dependency/database fingerprints ignore package version-only bumps', () => {
  const root = makeFixture();
  try {
    const before = computeDeploymentFingerprints(root);
    changeVersion(root, 'package.json', 'package-lock.json', '1.0.1');
    changeVersion(root, 'backend/package.json', 'backend/package-lock.json', '2.0.1');
    changeVersion(root, 'frontend/package.json', 'frontend/package-lock.json', '2.0.1');
    const after = computeDeploymentFingerprints(root);
    assert.equal(after.databaseInputHash, before.databaseInputHash);
    assert.equal(after.frontendInputHash, before.frontendInputHash);
    assert.deepEqual(after.dependencyHashes, before.dependencyHashes);
    assert.notEqual(after.sourceTreeHash, before.sourceTreeHash);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('frontend-only and deployment-only changes do not invalidate database work', () => {
  const root = makeFixture();
  try {
    const before = computeDeploymentFingerprints(root);
    fs.appendFileSync(path.join(root, 'frontend/src/app.js'), 'export const uiOnly = 2;\n');
    const frontendChanged = computeDeploymentFingerprints(root);
    assert.equal(frontendChanged.databaseInputHash, before.databaseInputHash);
    assert.notEqual(frontendChanged.frontendInputHash, before.frontendInputHash);
    fs.appendFileSync(path.join(root, 'scripts/deploy-example.sh'), 'echo more\n');
    const deployChanged = computeDeploymentFingerprints(root);
    assert.equal(deployChanged.databaseInputHash, frontendChanged.databaseInputHash);
    assert.notEqual(deployChanged.deploymentInputHash, frontendChanged.deploymentInputHash);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('backend source changes invalidate database/runtime input hash', () => {
  const root = makeFixture();
  try {
    const before = computeDeploymentFingerprints(root);
    fs.appendFileSync(path.join(root, 'backend/src/server.js'), 'export const changed = 2;\n');
    const after = computeDeploymentFingerprints(root);
    assert.notEqual(after.backendInputHash, before.backendInputHash);
    assert.notEqual(after.databaseInputHash, before.databaseInputHash);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('candidate receipt is bound to clean-install source and exact frontend artifact bytes', () => {
  const root = makeFixture();
  try {
    const receipt = certifiedReceipt(root);
    assert.equal(validateCandidateReceipt(root, receipt, { commit:'abc123', requireArtifacts:true }).ok, true);
    fs.appendFileSync(path.join(root, 'frontend/dist/index.html'), '<!-- tampered -->');
    const tampered = validateCandidateReceipt(root, receipt, { commit:'abc123', requireArtifacts:true });
    assert.equal(tampered.ok, false);
    assert.ok(tampered.errors.some((item) => item.includes('frontend build artifact hash')));
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('deployment state proves exact live source and frontend artifact and rejects drift', () => {
  const root = makeFixture();
  try {
    const receipt = certifiedReceipt(root);
    const state = buildDeploymentState(root, receipt, { commit:'abc123', frontendDistPath:path.join(root, 'frontend/dist') });
    assert.equal(validateDeploymentState(root, state, { commit:'abc123' }).ok, true);
    fs.appendFileSync(path.join(root, 'backend/src/server.js'), '// drift\n');
    const drift = validateDeploymentState(root, state, { commit:'abc123' });
    assert.equal(drift.ok, false);
    assert.ok(drift.errors.some((item) => item.includes('source hash')));
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});
