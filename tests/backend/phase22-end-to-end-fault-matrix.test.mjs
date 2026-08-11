import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizePresenceClientCommand,
  classifyPresenceClientCommand,
  applyPresenceClientCommandMetadata,
} from '../../backend/src/services/presenceProtocolService.js';
import {
  persistenceCommitEvidenceMatches,
  classifyPersistenceFailure,
  runtimeRecoveryCanRun,
} from '../../backend/src/services/persistenceBackpressureService.js';
import { normalizeClientDiagnostic, publicApiErrorPayload, serverErrorFingerprint } from '../../backend/src/services/runtimeDiagnosticsService.js';

const root = new URL('../../', import.meta.url);

test('fault soak: duplicate and out-of-order presence commands never replace a newer accepted sequence', () => {
  const user = {};
  let accepted = 0;
  for (let sequence = 1; sequence <= 10_000; sequence += 1) {
    const command = normalizePresenceClientCommand({clientPresenceEpoch:'page-a',clientPresenceSequence:sequence});
    const decision = classifyPresenceClientCommand(user, sequence === 1 ? 'login' : 'heartbeat', command);
    assert.equal(decision.accept, true);
    applyPresenceClientCommandMetadata(user, command);
    accepted = sequence;
    if (sequence > 1) {
      const stale = normalizePresenceClientCommand({clientPresenceEpoch:'page-a',clientPresenceSequence:sequence - 1});
      const staleDecision = classifyPresenceClientCommand(user, 'heartbeat', stale);
      assert.equal(staleDecision.accept, false);
      assert.equal(staleDecision.stale, true);
      assert.equal(user.presenceClientSequence, accepted);
    }
  }
  assert.equal(user.presenceClientSequence, 10_000);
});

test('fault matrix: obsolete presence epoch fails closed while a fresh login can deliberately claim a new epoch', () => {
  const user = {presenceClientEpoch:'page-new',presenceClientSequence:9};
  const oldHeartbeat = normalizePresenceClientCommand({clientPresenceEpoch:'page-old',clientPresenceSequence:99});
  const rejected = classifyPresenceClientCommand(user, 'heartbeat', oldHeartbeat);
  assert.equal(rejected.accept, false);
  assert.equal(rejected.epochMismatch, true);
  const newLogin = normalizePresenceClientCommand({clientPresenceEpoch:'page-next',clientPresenceSequence:1});
  const accepted = classifyPresenceClientCommand(user, 'login', newLogin);
  assert.equal(accepted.accept, true);
  assert.equal(accepted.newEpoch, true);
});

test('fault matrix: ambiguous PostgreSQL COMMIT is accepted only with exact independent version/hash evidence', () => {
  const error = {commitOutcomeUnknown:true,commitEvidence:{stateVersion:77,snapshotHash:'a'.repeat(64)}};
  assert.equal(persistenceCommitEvidenceMatches(error,{stateVersion:77,snapshotHash:'a'.repeat(64)}), true);
  assert.equal(persistenceCommitEvidenceMatches(error,{stateVersion:76,snapshotHash:'a'.repeat(64)}), false);
  assert.equal(persistenceCommitEvidenceMatches(error,{stateVersion:77,snapshotHash:'b'.repeat(64)}), false);
  assert.equal(persistenceCommitEvidenceMatches({commitOutcomeUnknown:false,commitEvidence:error.commitEvidence},{stateVersion:77,snapshotHash:'a'.repeat(64)}), false);
});

test('fault matrix: foreground persistence failure remains critical while deferred presence can use a verified shadow', () => {
  assert.equal(classifyPersistenceFailure({reason:'task_update',recoverySucceeded:false,verifiedFallbackRestored:true,usePostgres:true}).critical, true);
  const presence = classifyPersistenceFailure({reason:'presence_heartbeat',recoverySucceeded:false,verifiedFallbackRestored:true,usePostgres:true});
  assert.equal(presence.deferred, true);
  assert.equal(presence.safelyRecovered, true);
  assert.equal(presence.critical, false);
  assert.equal(runtimeRecoveryCanRun({queueDepth:1,inFlight:0,activeForegroundWrites:0}), false);
  assert.equal(runtimeRecoveryCanRun({queueDepth:0,inFlight:0,activeForegroundWrites:0}), true);
});

test('fault matrix: public 5xx diagnostics keep request correlation without leaking internal exception text', () => {
  const error = Object.assign(new Error('password=SECRET database host 10.0.0.9 failed'), {code:'DB_INTERNAL'});
  const fingerprint = serverErrorFingerprint(error,{method:'POST',path:'/api/cases/123456'});
  const payload = publicApiErrorPayload({error,status:500,fallback:'The request could not be completed.',requestId:'req-22',fingerprint});
  assert.equal(payload.ok, false);
  assert.equal(payload.requestId, 'req-22');
  assert.equal(payload.error, 'The request could not be completed.');
  assert.match(payload.errorFingerprint, /^[a-f0-9]{16}$/);
  assert.doesNotMatch(JSON.stringify(payload), /SECRET|10\.0\.0\.9/);
});

test('fault matrix: client diagnostic whitelist drops raw message, stack, password and arbitrary payload fields', () => {
  const diagnostic = normalizeClientDiagnostic({
    diagnosticId:'KD-ABCDEF123456',fingerprint:'abcdef1234567890',source:'runtime',messageClass:'TYPE_NOT_FUNCTION',
    operation:'save task "Customer Name"',route:'/api/cases/123456?token=SECRET',method:'POST',relatedRequestId:'req-1',
    message:'SECRET raw error',stack:'SECRET stack',password:'dont-store',payload:{customer:'Private'},authState:'authenticated'
  });
  assert.equal(diagnostic.route, '/api/cases/:id');
  assert.equal(Object.hasOwn(diagnostic,'message'), false);
  assert.equal(Object.hasOwn(diagnostic,'stack'), false);
  assert.equal(Object.hasOwn(diagnostic,'password'), false);
  assert.equal(Object.hasOwn(diagnostic,'payload'), false);
  assert.doesNotMatch(JSON.stringify(diagnostic), /SECRET|dont-store|Private|Customer Name/);
});

test('source package includes the safe environment template required by clean-package regression tests', () => {
  const envUrl = new URL('backend/.env.example', root);
  assert.equal(fs.existsSync(envUrl), true);
  const text = fs.readFileSync(envUrl, 'utf8');
  assert.match(text, /^NODE_ENV=development$/m);
  assert.doesNotMatch(text, /ops\.kalpvriksha\.co\.in|api\.kalpvriksha\.co\.in/);
});
