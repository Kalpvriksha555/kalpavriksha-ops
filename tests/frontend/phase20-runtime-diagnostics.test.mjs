import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRuntimeDiagnostic, classifyRuntimeMessage, sanitizeDiagnosticOperation, sanitizeDiagnosticRoute } from '../../frontend/src/utils/runtimeDiagnosticsUtils.js';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../../frontend/src/services/authService.js', import.meta.url), 'utf8');
const apiContract = fs.readFileSync(new URL('../../frontend/src/services/apiContractService.js', import.meta.url), 'utf8');
const diagnostics = fs.readFileSync(new URL('../../frontend/src/services/runtimeDiagnosticsService.js', import.meta.url), 'utf8');
const commandCentre = fs.readFileSync(new URL('../../frontend/src/components/command-centre/CommandCentreView.jsx', import.meta.url), 'utf8');
const communicationHub = fs.readFileSync(new URL('../../frontend/src/components/chat/CommunicationHub.jsx', import.meta.url), 'utf8');
const designSystem = fs.readFileSync(new URL('../../frontend/src/components/ui/designSystem.jsx', import.meta.url), 'utf8');

test('diagnostic routes strip query strings and business identifiers', () => {
  assert.equal(sanitizeDiagnosticRoute('https://ops.example/api/cases/CASE-12345/files/987?customer=Secret'), '/api/cases/:id/files/:id');
  assert.equal(sanitizeDiagnosticRoute('/api/chat/history?before=123456'), '/api/chat/history');
});

test('diagnostic operations redact ids and quoted values', () => {
  const sanitized = sanitizeDiagnosticOperation('PATCH /api/cases/CASE-12345 note "Private customer note"');
  assert.equal(sanitized.includes('CASE-12345'), false);
  assert.equal(sanitized.includes('Private customer note'), false);
  assert.match(sanitized, /PATCH \/api\/cases\/:id/);
});

test('runtime diagnostic records only an error class and fingerprint, not the raw runtime message', () => {
  const error = new TypeError('Customer Amit: notifications.some is not a function');
  error.stack = 'TypeError: Customer Amit\n    at NotificationPanel (https://ops.example/assets/app-abcd.js:321:18)';
  const diagnostic = buildRuntimeDiagnostic({
    error,
    source:'app-error-boundary',
    componentStack:'\n    at NotificationPanel\n    at AppShell',
    route:'/api/cases/CASE-12345?customer=Amit',
    operation:'Open case CASE-12345',
    context:{ stateVersion:712, dataRevision:901, presenceGeneration:44, authState:'authenticated', authOwned:true, role:'Designer', online:true, visibility:'visible', viewport:'desktop' },
    appVersion:'2.9.30-ssh-independent-certify-deploy-closure'
  });
  assert.equal(diagnostic.messageClass, 'TYPE_NOT_FUNCTION');
  assert.equal(diagnostic.route, '/api/cases/:id');
  assert.equal(JSON.stringify(diagnostic).includes('Customer Amit'), false);
  assert.equal(JSON.stringify(diagnostic).includes('notifications.some'), false);
  assert.match(diagnostic.diagnosticId, /^KD-[A-F0-9]{12}$/);
  assert.equal(diagnostic.stateVersion, 712);
  assert.deepEqual(diagnostic.componentPath, ['NotificationPanel','AppShell']);
});

test('network and browser runtime classes remain deterministic', () => {
  assert.equal(classifyRuntimeMessage({ error:new TypeError('Failed to fetch') }), 'NETWORK_UNAVAILABLE');
  assert.equal(classifyRuntimeMessage({ error:new TypeError('x.some is not a function') }), 'TYPE_NOT_FUNCTION');
  assert.equal(classifyRuntimeMessage({ error:new Error('Cannot read properties of undefined') }), 'NULLISH_PROPERTY_ACCESS');
});

test('every authFetch request gets a correlatable request id and emits safe failure metadata', () => {
  assert.match(auth, /headers\.set\('X-Request-Id', requestId\)/);
  assert.match(auth, /attachResponseRequestMeta\(response, requestMeta\)/);
  assert.match(auth, /emitApiDiagnostic\(\{ source:'api-http'/);
  assert.match(auth, /source:'api-network'/);
  assert.match(auth, /X-Error-Fingerprint/);
});

test('API contract errors carry request route, operation and server fingerprint', () => {
  assert.match(apiContract, /error\.route = String\(requestMeta\?\.route/);
  assert.match(apiContract, /error\.operation = operation \|\| requestMeta\?\.operation/);
  assert.match(apiContract, /error\.errorFingerprint = errorFingerprintFromResponse/);
  assert.match(apiContract, /kalpa-api-contract-diagnostic/);
});

test('runtime boundaries use the sanitized diagnostic service and show a diagnostic id', () => {
  for (const source of [app, communicationHub, designSystem]) {
    assert.match(source, /recordRuntimeDiagnostic|recordClientRuntimeError/);
    assert.match(source, /Diagnostic ID/);
  }
  assert.doesNotMatch(app, /localStorage\.setItem\('kalpa_last_error'/);
  assert.doesNotMatch(communicationHub, /localStorage\.setItem\('kd-error-logs'/);
  assert.match(diagnostics, /kalpa_client_runtime_errors_v3/);
  assert.match(diagnostics, /CLIENT_RUNTIME_ERROR_LOG_LIMIT = 30/);
});

test('admin operational events show sanitized client diagnostic metadata', () => {
  assert.match(commandCentre, /CLIENT_RUNTIME_DIAGNOSTIC/);
  assert.match(commandCentre, /Diagnostic \{details\.diagnosticId/);
  assert.match(commandCentre, /details\.stateVersion/);
  assert.match(commandCentre, /details\.componentPath/);
});
