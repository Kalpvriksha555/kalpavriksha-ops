import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sourceTreeHash as canonicalSourceTreeHash } from '../backend/src/services/releaseCertificationService.js';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
};
const stableJson = (value) => JSON.stringify(stableValue(value));
const normalize = (value) => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');

const ignoredPath = (relative) => {
  const p = normalize(relative);
  return /(^|\/)(?:\.git|node_modules|dist|release|\.release|coverage|test-results|playwright-report)(\/|$)/.test(p)
    || /(^|\/)backend\/src\/(?:data|uploads)(\/|$)/.test(p)
    || /^(?:backend\/)?(?:data|uploads)(?:\/|$)/.test(p)
    || /^(?:private-files|backups)(?:\/|$)/.test(p)
    || /(^|\/)dist\.(?:next|previous)(\/|$)/.test(p)
    || /(^|\/)\.env(?:\.|$)/.test(p)
    || /(^|\/)release-certification\.json$/.test(p)
    || /\.log$/i.test(p);
};

export function hashFiles(rootPath, { include = () => true, ignore = ignoredPath } = {}) {
  const root = path.resolve(rootPath);
  const files = [];
  const walk = (directory, relative = '') => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes:true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (ignore(childRelative)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute, childRelative);
      else if (entry.isFile() && include(normalize(childRelative))) files.push(normalize(childRelative));
    }
  };
  walk(root);
  const hash = crypto.createHash('sha256');
  for (const relative of files) {
    hash.update(relative); hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, relative))); hash.update('\0');
  }
  return { hash:hash.digest('hex'), fileCount:files.length, files };
}

export function hashArtifactTree(directoryPath) {
  const directory = path.resolve(directoryPath);
  if (!fs.existsSync(directory)) return { hash:'', fileCount:0, files:[] };
  return hashFiles(directory, { ignore:() => false });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function scrubRootPackageRecord(record = {}) {
  const copy = { ...record };
  delete copy.name;
  delete copy.version;
  return copy;
}

export function dependencyLockHash(lockPath) {
  const absolute = path.resolve(lockPath);
  if (!fs.existsSync(absolute)) return '';
  const lock = readJson(absolute);
  const packages = Object.fromEntries(
    Object.entries(lock.packages || {})
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([key, value]) => [key, key === '' ? scrubRootPackageRecord(value) : value])
  );
  return sha256(stableJson({ lockfileVersion:lock.lockfileVersion || 0, packages }));
}

function packageContract(packagePath) {
  const pkg = readJson(packagePath);
  return {
    type:pkg.type || '',
    engines:pkg.engines || {},
    dependencies:pkg.dependencies || {},
    devDependencies:pkg.devDependencies || {},
    optionalDependencies:pkg.optionalDependencies || {},
    peerDependencies:pkg.peerDependencies || {},
    scripts:{
      build:pkg.scripts?.build || '',
      start:pkg.scripts?.start || '',
      verify:pkg.scripts?.verify || ''
    }
  };
}

export function dependencySignature(rootPath, relativePackageJson, relativeLock) {
  const root = path.resolve(rootPath);
  const packagePath = path.join(root, relativePackageJson);
  const lockPath = path.join(root, relativeLock);
  if (!fs.existsSync(packagePath) || !fs.existsSync(lockPath)) return '';
  return sha256(stableJson({ contract:packageContract(packagePath), lockHash:dependencyLockHash(lockPath) }));
}

const isDeploymentOnlyPath = (relative) => {
  const p = normalize(relative);
  return /^scripts\/(?:deploy-|launch-deploy-|candidate-certify-|certify-and-deploy-|phase-21-|deployment-receipt-utils\.mjs|source-parity-clean\.mjs)/.test(p)
    || p === 'PUSH_AND_DEPLOY.md'
    || /^DEPLOY_/.test(path.basename(p))
    || /^DEPLOYMENT_/.test(path.basename(p));
};
const isDocumentationPath = (relative) => /\.md$/i.test(relative);

export function computeDeploymentFingerprints(rootPath) {
  const root = path.resolve(rootPath);
  const sourceTree = canonicalSourceTreeHash(root);
  const backendCodeTree = hashFiles(root, { include:(p) => p.startsWith('backend/') && !/^backend\/package(?:-lock)?\.json$/.test(p) });
  const frontendCodeTree = hashFiles(root, { include:(p) => p.startsWith('frontend/') && !/^frontend\/package(?:-lock)?\.json$/.test(p) });
  const testsTree = hashFiles(root, { include:(p) => p.startsWith('tests/') });
  const verificationTree = hashFiles(root, { include:(p) => p.startsWith('scripts/') && !isDeploymentOnlyPath(p) });
  const applicationVerification = hashFiles(root, {
    include:(p) => !isDocumentationPath(p) && !isDeploymentOnlyPath(p) && p !== 'RELEASE_FILE_MANIFEST.sha256'
  });
  const deploymentTree = hashFiles(root, {
    include:(p) => isDeploymentOnlyPath(p) || p === 'scripts/release-certify.mjs' || p === 'scripts/release-gate.mjs'
  });

  const rootDependencyHash = dependencySignature(root, 'package.json', 'package-lock.json');
  const backendDependencyHash = dependencySignature(root, 'backend/package.json', 'backend/package-lock.json');
  const frontendDependencyHash = dependencySignature(root, 'frontend/package.json', 'frontend/package-lock.json');

  const combined = (object) => sha256(stableJson(object));
  const backendFunctionalHash = combined({ backendCodeTree:backendCodeTree.hash, backendDependencyHash });
  const frontendFunctionalHash = combined({ frontendCodeTree:frontendCodeTree.hash, rootDependencyHash, frontendDependencyHash });
  const databaseInputHash = backendFunctionalHash;
  const frontendBuildInputHash = frontendFunctionalHash;
  const candidateVerificationInputHash = combined({
    applicationVerification:applicationVerification.hash,
    backendFunctionalHash,
    frontendFunctionalHash,
    testsTree:testsTree.hash,
    verificationTree:verificationTree.hash,
    rootDependencyHash,
    backendDependencyHash,
    frontendDependencyHash
  });
  const candidateE2eInputHash = combined({ backendFunctionalHash, frontendFunctionalHash });
  const cleanInstallInputHash = combined({ backendFunctionalHash, frontendFunctionalHash, rootDependencyHash, backendDependencyHash, frontendDependencyHash });
  const sourceManifestPath = path.join(root, 'RELEASE_FILE_MANIFEST.sha256');

  return {
    schemaVersion:1,
    sourceTreeHash:sourceTree.hash,
    sourceFileCount:sourceTree.fileCount,
    backendInputHash:backendFunctionalHash,
    frontendInputHash:frontendFunctionalHash,
    databaseInputHash,
    deploymentInputHash:deploymentTree.hash,
    candidateVerificationInputHash,
    candidateE2eInputHash,
    cleanInstallInputHash,
    frontendBuildInputHash,
    dependencyHashes:{ root:rootDependencyHash, backend:backendDependencyHash, frontend:frontendDependencyHash },
    sourceManifestSha256:fs.existsSync(sourceManifestPath) ? sha256(fs.readFileSync(sourceManifestPath)) : ''
  };
}

export function buildCandidatePhaseSnapshot(rootPath, { commit = '', proofs = {} } = {}) {
  const root = path.resolve(rootPath);
  const fingerprints = computeDeploymentFingerprints(root);
  const dist = hashArtifactTree(path.join(root, 'frontend/dist'));
  const cleanReportPath = path.join(root, '.release/clean-install-report.json');
  let cleanInstall = null;
  if (fs.existsSync(cleanReportPath)) {
    const report = readJson(cleanReportPath);
    cleanInstall = {
      status:String(report.status || ''),
      sourceHash:String(report.sourceHash || ''),
      sourceMatch:report.sourceMatch === true,
      reportSha256:sha256(fs.readFileSync(cleanReportPath))
    };
  }
  return {
    schemaVersion:1,
    commit:String(commit || ''),
    generatedAt:new Date().toISOString(),
    fingerprints,
    artifacts:{ frontendDistHash:dist.hash, frontendDistFileCount:dist.fileCount, cleanInstall },
    proofs:{
      dependencyInstall:proofs.dependencyInstall === true,
      frontendRuntime:proofs.frontendRuntime === true,
      fullVerify:proofs.fullVerify === true,
      cleanInstall:proofs.cleanInstall === true,
      candidateE2E:proofs.candidateE2E === true
    }
  };
}

export function validateCandidateReceipt(rootPath, receipt, { commit = '', requireArtifacts = true } = {}) {
  const errors = [];
  const root = path.resolve(rootPath);
  if (!receipt || typeof receipt !== 'object') errors.push('Candidate receipt is missing or invalid.');
  if (receipt?.ok !== true || receipt?.status !== 'CERTIFIED_FOR_GUARDED_DEPLOYMENT') errors.push('Candidate receipt status is not certified.');
  if (commit && String(receipt?.commit || '') !== String(commit)) errors.push('Candidate receipt commit does not match the requested commit.');
  const phase = receipt?.phaseReceipts;
  if (!phase || Number(phase.schemaVersion) !== 1) errors.push('Phase receipt payload is missing or unsupported.');
  const current = computeDeploymentFingerprints(root);
  const expected = phase?.fingerprints || {};
  for (const key of ['sourceTreeHash','backendInputHash','frontendInputHash','databaseInputHash','deploymentInputHash','candidateVerificationInputHash','candidateE2eInputHash','cleanInstallInputHash','frontendBuildInputHash','sourceManifestSha256']) {
    if (!expected[key] || expected[key] !== current[key]) errors.push(`Candidate phase fingerprint mismatch: ${key}.`);
  }
  for (const key of ['root','backend','frontend']) {
    if (!expected.dependencyHashes?.[key] || expected.dependencyHashes[key] !== current.dependencyHashes[key]) errors.push(`Candidate dependency fingerprint mismatch: ${key}.`);
  }
  for (const proof of ['dependencyInstall','frontendRuntime','fullVerify','cleanInstall','candidateE2E']) {
    if (phase?.proofs?.[proof] !== true) errors.push(`Candidate proof is missing: ${proof}.`);
  }
  const clean = phase?.artifacts?.cleanInstall;
  if (!clean || clean.status !== 'PASS' || clean.sourceMatch !== true || clean.sourceHash !== current.sourceTreeHash) {
    errors.push('Candidate clean-install proof does not match the current source tree.');
  }
  const cleanReportPath = path.join(root, '.release/clean-install-report.json');
  if (requireArtifacts) {
    if (!fs.existsSync(cleanReportPath)) errors.push('Current clean-install report artifact is missing.');
    else if (clean?.reportSha256 !== sha256(fs.readFileSync(cleanReportPath))) errors.push('Current clean-install report artifact hash does not match the candidate receipt.');
    const dist = hashArtifactTree(path.join(root, 'frontend/dist'));
    if (!dist.hash || dist.hash !== phase?.artifacts?.frontendDistHash) errors.push('Current frontend build artifact hash does not match the candidate receipt.');
    if (Number(phase?.artifacts?.frontendDistFileCount || 0) !== dist.fileCount) errors.push('Current frontend build artifact file count does not match the candidate receipt.');
  }
  return { ok:errors.length === 0, errors, fingerprints:current, phaseReceipts:phase };
}

export function buildDeploymentState(rootPath, receipt, { commit = '', frontendDistPath = '', status = 'DEPLOYED', extra = {} } = {}) {
  const validation = validateCandidateReceipt(rootPath, receipt, { commit, requireArtifacts:false });
  if (!validation.ok) throw new Error(validation.errors.join(' '));
  const dist = hashArtifactTree(frontendDistPath || path.join(rootPath, 'frontend/dist'));
  return {
    schemaVersion:1,
    status,
    commit:String(commit || receipt.commit || ''),
    recordedAt:new Date().toISOString(),
    appVersion:readJson(path.join(rootPath, 'package.json')).version || '',
    backendVersion:readJson(path.join(rootPath, 'backend/package.json')).version || '',
    frontendVersion:readJson(path.join(rootPath, 'frontend/package.json')).version || '',
    fingerprints:validation.fingerprints,
    frontendDistHash:dist.hash,
    frontendDistFileCount:dist.fileCount,
    ...extra
  };
}

export function validateDeploymentState(rootPath, state, { commit = '', frontendDistPath = '' } = {}) {
  const errors = [];
  if (!state || Number(state.schemaVersion) !== 1 || state.status !== 'DEPLOYED') errors.push('Deployment state receipt is missing or invalid.');
  if (commit && String(state?.commit || '') !== String(commit)) errors.push('Deployment state commit mismatch.');
  const current = computeDeploymentFingerprints(rootPath);
  if (state?.fingerprints?.sourceTreeHash !== current.sourceTreeHash) errors.push('Live source hash does not match the deployment receipt.');
  const dist = hashArtifactTree(frontendDistPath || path.join(rootPath, 'frontend/dist'));
  if (!dist.hash || state?.frontendDistHash !== dist.hash || Number(state?.frontendDistFileCount || 0) !== dist.fileCount) errors.push('Live frontend artifact does not match the deployment receipt.');
  return { ok:errors.length === 0, errors, fingerprints:current, frontendDist:dist };
}

export { sha256, stableJson };
