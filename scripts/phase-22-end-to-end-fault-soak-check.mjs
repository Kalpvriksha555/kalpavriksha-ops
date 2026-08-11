#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  workspaceSyncMarkersFromPayload,
  advanceWorkspaceSyncMarkers,
  classifyWorkspaceResponseFreshness,
} from '../frontend/src/utils/workspaceSyncUtils.js';
import { applyFreshestTaskFinance, taskFinanceVersion } from '../frontend/src/utils/financeMergeUtils.js';

import {
  normalizePresenceClientCommand,
  classifyPresenceClientCommand,
  applyPresenceClientCommandMetadata,
  computeAttendanceAccrual,
} from '../backend/src/services/presenceProtocolService.js';
import {
  persistenceCommitEvidenceMatches,
  classifyPersistenceFailure,
} from '../backend/src/services/persistenceBackpressureService.js';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const json = relative => JSON.parse(read(relative));
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const requiredHiddenFiles = ['.gitattributes','.gitignore','.npmrc','backend/.env.example'];
const ignoredDirNames = new Set(['.git','node_modules','dist','release','.release','__pycache__','.pytest_cache']);

const walk = (absolute = root, prefix = '') => {
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes:true })) {
    // Git linked worktrees expose .git as a regular metadata file rather than
    // a directory. Exclude ignored metadata names before checking entry type so
    // release manifests are portable between linked worktrees and normal clones.
    if (ignoredDirNames.has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(path.join(absolute, entry.name), relative));
    else if (relative !== 'RELEASE_FILE_MANIFEST.sha256') files.push(relative.replaceAll('\\','/'));
  }
  return files.sort();
};

const parseManifest = () => {
  const rows = read('RELEASE_FILE_MANIFEST.sha256').split(/\r?\n/).filter(Boolean);
  const map = new Map();
  for (const row of rows) {
    const match = row.match(/^([a-f0-9]{64})  (.+)$/);
    assert.ok(match, `Malformed release manifest row: ${row}`);
    const [, hash, file] = match;
    assert.equal(map.has(file), false, `Duplicate release manifest path: ${file}`);
    assert.equal(file.startsWith('/') || file.includes('../'), false, `Unsafe manifest path: ${file}`);
    assert.equal(/(^|\/)\.git(?:\/|$)/.test(file), false, `Git metadata must never be release-manifest content: ${file}`);
    map.set(file, hash);
  }
  return map;
};

const pkg = json('package.json');
const backendPkg = json('backend/package.json');
const frontendPkg = json('frontend/package.json');
assert.equal(pkg.version, '1.9.30-ssh-independent-certify-deploy-closure');
assert.equal(backendPkg.version, '2.9.30-ssh-independent-certify-deploy-closure');
assert.equal(frontendPkg.version, '2.9.30-ssh-independent-certify-deploy-closure');
assert.equal(pkg.scripts['verify:fault-soak'], 'node scripts/phase-22-end-to-end-fault-soak-check.mjs');
assert.match(pkg.scripts.verify, /verify:deployment-resume && npm run verify:fault-soak && npm run verify:certification-local-postgres && npm run verify:operator-deploy && npm run verify:frontend-runtime/);

for (const file of requiredHiddenFiles) assert.ok(fs.existsSync(path.join(root, file)), `Required source/package file is missing: ${file}`);
const envExample = read('backend/.env.example');
assert.match(envExample, /^NODE_ENV=development$/m);
assert.match(envExample, /^DATABASE_URL=postgresql:\/\//m);
assert.doesNotMatch(envExample, /ops\.kalpvriksha\.co\.in|api\.kalpvriksha\.co\.in|187\.127\.189\.38/);

const manifest = parseManifest();
const actual = walk();
const manifested = [...manifest.keys()].sort();
assert.deepEqual(manifested, actual, 'Release manifest must cover the complete distributable source tree, including required dotfiles.');
for (const [file, expected] of manifest.entries()) assert.equal(hashFile(file), expected, `Release manifest hash mismatch: ${file}`);
for (const file of requiredHiddenFiles) assert.ok(manifest.has(file), `Release manifest omitted required hidden file: ${file}`);

const matrix = read('scripts/full-release-verifier-matrix.mjs');
assert.match(matrix, /end-to-end-fault-matrix-final-soak/);
const doctor = read('scripts/doctor.mjs');
assert.match(doctor, /backend\/\.env\.example/);
const candidate = read('scripts/candidate-certify-1.9.30-vps.sh');
assert.match(candidate, /sha256sum -c RELEASE_FILE_MANIFEST\.sha256/);
const deploy = read('scripts/deploy-1.9.30-vps.sh');
assert.match(deploy, /EXPECTED_BACKEND_VERSION="2\.9\.30-ssh-independent-certify-deploy-closure"/);
assert.match(deploy, /FAILED_BUT_ROLLBACK_VERIFIED/);
assert.match(deploy, /ROLLBACK_FAILED_REQUIRES_OPERATOR/);

// Deterministic cross-phase soak: stale browser reads, compact finance deltas,
// ordered presence and attendance gaps are exercised together for enough
// iterations to catch monotonicity/shape regressions without external services.
const collections = ['users','cases','deletedProjectIds','teamChat','notifications','attendanceLogs'];
const revisions = value => Object.fromEntries(collections.map(key => [key, value]));
let markers = workspaceSyncMarkersFromPayload({stateVersion:1,dataRevision:1,presenceGeneration:1,collectionRevisions:revisions(1)});
let finance = {financeVersion:1,transactionId:'TXN-STABLE',paymentAuditTrail:[{at:1}],paymentAmountIn:1};
const presenceUser = {};
let attendanceLastTick = Date.parse('2026-08-10T09:00:00+05:30');
let attendanceRemainder = 0;
let attendanceMinutes = 0;
for (let i = 2; i <= 25_000; i += 1) {
  const incomingMarker = i % 7 === 0 ? i - 3 : i;
  const incoming = {stateVersion:incomingMarker,dataRevision:incomingMarker,presenceGeneration:incomingMarker,collectionRevisions:revisions(incomingMarker)};
  const freshness = classifyWorkspaceResponseFreshness(incoming, markers, {clientMutationAdvanced:i % 101 === 0});
  if (!freshness.stale) markers = advanceWorkspaceSyncMarkers(markers, incoming);

  const financeIncoming = i % 13 === 0
    ? {financeVersion:Math.max(1, taskFinanceVersion(finance) - 1),paymentAmountIn:i}
    : {financeVersion:taskFinanceVersion(finance) + 1,paymentAmountIn:i};
  finance = applyFreshestTaskFinance({...finance,...financeIncoming}, finance, financeIncoming);
  assert.equal(finance.transactionId, 'TXN-STABLE');

  const command = normalizePresenceClientCommand({clientPresenceEpoch:'phase22-soak',clientPresenceSequence:i});
  const decision = classifyPresenceClientCommand(presenceUser, i === 2 ? 'login' : 'heartbeat', command);
  assert.equal(decision.accept, true);
  applyPresenceClientCommandMetadata(presenceUser, command);

  if (i <= 482) {
    const nextTick = attendanceLastTick + 60_000;
    const accrued = computeAttendanceAccrual({lastTick:attendanceLastTick,loginAt:attendanceLastTick,nowMs:nextTick,remainderMs:attendanceRemainder});
    attendanceMinutes += accrued.wholeMinutes;
    attendanceRemainder = accrued.remainderMs;
    attendanceLastTick = nextTick;
  }
}
assert.ok(markers.stateVersion > 24_900, 'Workspace soak did not progress to the expected fresh state.');
assert.ok(taskFinanceVersion(finance) > 20_000, 'Finance soak did not retain forward progress.');
assert.equal(presenceUser.presenceClientSequence, 25_000);
assert.equal(attendanceMinutes, 481);
const suspended = computeAttendanceAccrual({lastTick:attendanceLastTick,loginAt:attendanceLastTick,nowMs:attendanceLastTick + 4 * 60 * 60_000,remainderMs:attendanceRemainder});
assert.equal(suspended.wholeMinutes, 0);
assert.equal(suspended.ignoredGapMinutes, 240);

const commitError = {commitOutcomeUnknown:true,commitEvidence:{stateVersion:91,snapshotHash:'c'.repeat(64)}};
assert.equal(persistenceCommitEvidenceMatches(commitError,{stateVersion:91,snapshotHash:'c'.repeat(64)}), true);
assert.equal(persistenceCommitEvidenceMatches(commitError,{stateVersion:91,snapshotHash:'d'.repeat(64)}), false);
assert.equal(classifyPersistenceFailure({reason:'task_update',recoverySucceeded:false,verifiedFallbackRestored:true,usePostgres:true}).critical, true);
assert.equal(classifyPersistenceFailure({reason:'presence_heartbeat',recoverySucceeded:false,verifiedFallbackRestored:true,usePostgres:true}).critical, false);

console.log(`Phase 22 end-to-end fault matrix/final soak PASS (${actual.length} manifest-controlled source files; 25,000 deterministic cross-phase iterations; package dotfiles, monotonic workspace/finance/presence, attendance-gap and persistence fail-closed invariants verified).`);
