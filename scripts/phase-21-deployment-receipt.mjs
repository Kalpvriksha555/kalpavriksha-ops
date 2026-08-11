#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCandidatePhaseSnapshot,
  buildDeploymentState,
  computeDeploymentFingerprints,
  hashArtifactTree,
  validateCandidateReceipt,
  validateDeploymentState
} from './deployment-receipt-utils.mjs';

const args = process.argv.slice(2);
const command = args.shift() || '';
const value = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const root = path.resolve(value('--root', process.cwd()));
const output = value('--output', '');
const commit = value('--commit', '');
const receiptPath = value('--receipt', '');
const statePath = value('--state', '');
const distPath = value('--frontend-dist', path.join(root, 'frontend/dist'));
const write = (payload) => {
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive:true });
    const temp = `${path.resolve(output)}.tmp-${process.pid}`;
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2));
    fs.renameSync(temp, path.resolve(output));
  }
  console.log(JSON.stringify(payload, null, 2));
};
const load = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

try {
  if (command === 'fingerprint') {
    write({ ok:true, fingerprints:computeDeploymentFingerprints(root) });
  } else if (command === 'artifact-hash') {
    write({ ok:true, artifact:hashArtifactTree(distPath) });
  } else if (command === 'candidate-snapshot') {
    write(buildCandidatePhaseSnapshot(root, {
      commit,
      proofs:{ dependencyInstall:true, frontendRuntime:true, fullVerify:true, cleanInstall:true, candidateE2E:true }
    }));
  } else if (command === 'verify-candidate') {
    if (!receiptPath) throw new Error('--receipt is required.');
    const result = validateCandidateReceipt(root, load(receiptPath), { commit, requireArtifacts:value('--require-artifacts', 'true') !== 'false' });
    write(result);
    if (!result.ok) process.exitCode = 1;
  } else if (command === 'write-deployment-state') {
    if (!receiptPath) throw new Error('--receipt is required.');
    const state = buildDeploymentState(root, load(receiptPath), { commit, frontendDistPath:distPath });
    write(state);
  } else if (command === 'verify-deployment-state') {
    if (!statePath) throw new Error('--state is required.');
    const result = validateDeploymentState(root, load(statePath), { commit, frontendDistPath:distPath });
    write(result);
    if (!result.ok) process.exitCode = 1;
  } else {
    throw new Error('Usage: phase-21-deployment-receipt.mjs <fingerprint|artifact-hash|candidate-snapshot|verify-candidate|write-deployment-state|verify-deployment-state> [options]');
  }
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}
