#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { computeDeploymentFingerprints } from './deployment-receipt-utils.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative));
const requireFile = (relative) => assert.ok(fs.existsSync(path.join(root, relative)), `Missing ${relative}`);

for (const file of [
  'scripts/deployment-receipt-utils.mjs',
  'scripts/phase-21-deployment-receipt.mjs',
  'scripts/deploy-1.9.30-vps.sh',
  'scripts/launch-deploy-1.9.30-vps.sh',
  'scripts/candidate-certify-1.9.30-vps.sh',
  'scripts/certify-and-deploy-1.9.30-vps.sh',
  'scripts/release-certify.mjs',
  'backend/src/server.js'
]) requireFile(file);

const pkg = json('package.json');
const backendPkg = json('backend/package.json');
const frontendPkg = json('frontend/package.json');
assert.equal(pkg.version, '1.9.30-ssh-independent-certify-deploy-closure');
assert.equal(backendPkg.version, '2.9.30-ssh-independent-certify-deploy-closure');
assert.equal(frontendPkg.version, '2.9.30-ssh-independent-certify-deploy-closure');
assert.equal(pkg.scripts['verify:deployment-resume'], 'node scripts/phase-21-resume-aware-deployment-check.mjs');
assert.match(pkg.scripts.verify, /verify:diagnostics && npm run verify:deployment-resume && npm run verify:fault-soak && npm run verify:certification-local-postgres && npm run verify:operator-deploy && npm run verify:frontend-runtime/);

const matrix = read('scripts/full-release-verifier-matrix.mjs');
assert.match(matrix, /resume-aware-atomic-deployment/);

const candidate = read('scripts/candidate-certify-1.9.30-vps.sh');
assert.match(candidate, /DEPENDENCIES_REUSED=0/);
assert.match(candidate, /Existing dependency trees are complete; npm ci is skipped/);
assert.match(candidate, /phase-21-deployment-receipt\.mjs candidate-snapshot/);
assert.match(candidate, /phaseReceipts/);
assert.match(candidate, /deploymentMayReuseCertifiedVerification/);

const deploy = read('scripts/deploy-1.9.30-vps.sh');
assert.match(deploy, /phase-21-deployment-receipt\.mjs" verify-candidate/);
assert.match(deploy, /DATABASE_SOURCE_UNCHANGED/);
assert.match(deploy, /BACKEND_DEPS_UNCHANGED/);
assert.match(deploy, /candidate-phase-verification\.after-dependency-check/);
assert.doesNotMatch(deploy, /npm run verify(?:\s|$)/m);
assert.doesNotMatch(deploy, /npm run release:clean-install/);
assert.doesNotMatch(deploy, /rm -rf "\$RELEASE_ROOT\/node_modules"/);
assert.match(deploy, /KALPA_RESUME_AWARE_CANDIDATE_RECEIPT/);
assert.match(deploy, /KALPA_REUSE_DATABASE_INTEGRITY=true/);
assert.match(deploy, /Backend dependency fingerprint is unchanged and the permanent dependency tree is complete; production npm ci is skipped/);
assert.match(deploy, /frontend\/dist\.next/);
assert.match(deploy, /NEW_FRONTEND_DIST_HASH/);
assert.match(deploy, /Prepared frontend artifact does not match the certified candidate build/);
assert.match(deploy, /write-deployment-state/);
assert.match(deploy, /ALREADY_DEPLOYED_NOOP/);
assert.match(deploy, /FAILED_BUT_ROLLBACK_VERIFIED/);
assert.match(deploy, /ROLLBACK_FAILED_REQUIRES_OPERATOR/);
assert.match(deploy, /exit 97/);
assert.match(deploy, /assert_backend_version/);

const certify = read('scripts/release-certify.mjs');
assert.match(certify, /KALPA_RESUME_AWARE_CANDIDATE_RECEIPT/);
assert.match(certify, /validateCandidateReceipt/);
assert.match(certify, /candidate_full_verification_receipt/);
assert.match(certify, /KALPA_REUSE_DATABASE_INTEGRITY/);
assert.match(certify, /database_integrity_resume_receipt/);
assert.match(certify, /KALPA_CURRENT_RUNTIME_READY_PROOF/);

const orchestrator = read('scripts/certify-and-deploy-1.9.30-vps.sh');
assert.match(orchestrator, /REUSE_CERTIFIED_CANDIDATE/);
assert.match(orchestrator, /Exact candidate receipt, clean-install artifact and frontend build are unchanged/);
assert.match(orchestrator, /phase-21-deployment-receipt\.mjs" verify-candidate/);
assert.doesNotMatch(orchestrator, /rm -f \/root\/kalpavriksha-certified-candidate\.commit/);

const launcher = read('scripts/launch-deploy-1.9.30-vps.sh');
assert.match(launcher, /phase-21-deployment-receipt\.mjs" verify-candidate/);
assert.match(launcher, /--property=Type=exec/);
assert.match(launcher, /--no-block/);
assert.match(launcher, /--property=TimeoutStartSec=infinity/);
assert.match(launcher, /systemctl show .*ActiveState/s);
assert.match(launcher, /--property=TimeoutStopSec=180/);
assert.match(launcher, /--property=KillMode=control-group/);
assert.match(launcher, /--property=Restart=no/);
assert.match(launcher, /LAST_UNIT_TMP/);

const server = read('backend/src/server.js');
assert.match(server, /app\.get\('\/api\/health\/live'/);
assert.ok((server.match(/backendVersion:BACKEND_PACKAGE_VERSION/g) || []).length >= 2, 'Health/live and readiness payloads must carry exact backend version.');

const fingerprints = computeDeploymentFingerprints(root);
for (const key of [
  'sourceTreeHash','backendInputHash','frontendInputHash','databaseInputHash','deploymentInputHash',
  'candidateVerificationInputHash','candidateE2eInputHash','cleanInstallInputHash','frontendBuildInputHash'
]) assert.match(fingerprints[key], /^[0-9a-f]{64}$/, `${key} must be SHA-256`);
for (const key of ['root','backend','frontend']) assert.match(fingerprints.dependencyHashes[key], /^[0-9a-f]{64}$/, `${key} dependency hash must be SHA-256`);

console.log('Phase 21 resume-aware atomic deployment closure PASS (content-hash phase receipts, candidate/dependency reuse, source-aware database work, artifact-hash frontend switch, exact backend version proof, idempotent no-op and verified rollback escalation present).');
