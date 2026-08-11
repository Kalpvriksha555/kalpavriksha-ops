import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeClientDiagnostic, publicApiErrorPayload, sanitizeOperationalPath, serverErrorFingerprint } from '../../backend/src/services/runtimeDiagnosticsService.js';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const reliability = fs.readFileSync(new URL('../../backend/src/services/operationalReliabilityService.js', import.meta.url), 'utf8');

test('server diagnostic normalization keeps only known safe metadata', () => {
  const normalized = normalizeClientDiagnostic({
    diagnosticId:'KD-ABCDEF123456', fingerprint:'abcdef1234567890', source:'app-error-boundary',
    message:'Customer Amit secret note', stack:'very secret stack', customer:'Amit', password:'secret',
    operation:'PATCH /api/cases/CASE-12345 "Private note"', route:'/api/cases/CASE-12345?customer=Amit',
    relatedRequestId:'req-12345678', method:'PATCH', status:500, messageClass:'TYPE_NOT_FUNCTION',
    componentPath:['NotificationPanel','AppShell'], stateVersion:712, dataRevision:900, presenceGeneration:22,
    authState:'authenticated', authOwned:true, viewport:'desktop', visibility:'visible'
  });
  assert.equal(normalized.route, '/api/cases/:id');
  assert.equal(normalized.operation.includes('CASE-12345'), false);
  assert.equal(normalized.operation.includes('Private note'), false);
  assert.equal(Object.hasOwn(normalized, 'message'), false);
  assert.equal(Object.hasOwn(normalized, 'stack'), false);
  assert.equal(Object.hasOwn(normalized, 'customer'), false);
  assert.equal(Object.hasOwn(normalized, 'password'), false);
});

test('server paths drop queries and redact business-like ids', () => {
  assert.equal(sanitizeOperationalPath('/api/cases/CASE-12345/files/987?token=secret'), '/api/cases/:id/files/:id');
});

test('500 error payloads hide internal messages while returning a correlation fingerprint', () => {
  const error = Object.assign(new Error('password=secret database failure at /var/lib/postgresql/private'), { code:'DB_BROKEN' });
  const fingerprint = serverErrorFingerprint(error, { method:'GET', path:'/api/db/health', code:error.code });
  const payload = publicApiErrorPayload({ error, status:500, fallback:'Database health check failed.', requestId:'request-12345678', fingerprint });
  assert.equal(payload.error, 'Database health check failed.');
  assert.equal(JSON.stringify(payload).includes('password=secret'), false);
  assert.equal(payload.errorFingerprint, fingerprint);
  assert.match(payload.errorFingerprint, /^[a-f0-9]{16}$/);
});

test('expected 4xx validation messages remain actionable', () => {
  const error = Object.assign(new Error('Task version changed. Refresh and retry.'), { code:'TASK_VERSION_CONFLICT' });
  const payload = publicApiErrorPayload({ error, status:409, fallback:'Task update failed.', requestId:'request-12345678' });
  assert.equal(payload.error, 'Task version changed. Refresh and retry.');
  assert.equal(payload.code, 'TASK_VERSION_CONFLICT');
  assert.equal(Object.hasOwn(payload, 'errorFingerprint'), false);
});

test('backend exposes a rate-limited authenticated diagnostic sink with duplicate suppression', () => {
  assert.match(server, /clientDiagnosticRateLimiter = createRateLimiter/);
  assert.match(server, /app\.post\('\/api\/client-diagnostics', clientDiagnosticRateLimiter/);
  assert.match(server, /normalizeClientDiagnostic\(req\.body \|\| \{\}\)/);
  assert.match(server, /CLIENT_RUNTIME_DIAGNOSTIC/);
  assert.match(server, /recentClientDiagnosticReports/);
  assert.match(server, /recorded:false,duplicate:true/);
  assert.match(server, /actor:`client-\$\{String\(actor\.role/);
});

test('all centralized 5xx API failures return request id and an error fingerprint without raw internal details', () => {
  assert.match(server, /function sendApiFailure/);
  assert.match(server, /res\.setHeader\('X-Error-Fingerprint', fingerprint\)/);
  assert.match(server, /publicApiErrorPayload/);
  assert.match(server, /app\.use\(\(err, req, res, _next\) => \{[\s\S]*sendApiFailure\(res, req, err, 'Unexpected server error\.'\)/);
  assert.doesNotMatch(server, /res\.status\((?:500|503)\)[^\n]*error:(?:e|err|error)\.message/);
});

test('structured HTTP logs use sanitized paths instead of raw query strings', () => {
  assert.match(reliability, /sanitizeOperationalPath\(req\.originalUrl \|\| req\.url\)/);
  assert.match(server, /details: \{ code, method: req\.method, path: sanitizeOperationalPath/);
});
