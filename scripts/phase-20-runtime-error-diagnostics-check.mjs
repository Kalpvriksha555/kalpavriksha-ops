import fs from 'node:fs';

const findings = [];
const read = file => fs.readFileSync(file, 'utf8');
const requirePattern = (file, pattern, message) => {
  const source = read(file);
  if (!pattern.test(source)) findings.push({ file, message });
};
const rejectPattern = (file, pattern, message) => {
  const source = read(file);
  if (pattern.test(source)) findings.push({ file, message });
};

for (const file of [
  'frontend/src/utils/runtimeDiagnosticsUtils.js',
  'frontend/src/services/runtimeDiagnosticsService.js',
  'backend/src/services/runtimeDiagnosticsService.js',
  'tests/frontend/phase20-runtime-diagnostics.test.mjs',
  'tests/backend/phase20-runtime-diagnostics-closure.test.mjs'
]) {
  if (!fs.existsSync(file)) findings.push({ file, message:'Phase 20 required file is missing.' });
}

requirePattern('frontend/src/services/authService.js', /headers\.set\('X-Request-Id', requestId\)/, 'Browser API requests do not carry a client-generated correlation id.');
requirePattern('frontend/src/services/authService.js', /X-Error-Fingerprint/, 'Browser API boundary does not capture server error fingerprints.');
requirePattern('frontend/src/services/apiContractService.js', /kalpa-api-contract-diagnostic/, 'API contract failures are not emitted to the diagnostic boundary.');
requirePattern('frontend/src/App.jsx', /CLIENT_RUNTIME_DIAGNOSTIC_EVENT/, 'Global API diagnostics are not wired into the application shell.');
requirePattern('frontend/src/App.jsx', /Diagnostic ID/, 'Primary error screen does not expose a safe diagnostic id.');
requirePattern('frontend/src/components/ui/designSystem.jsx', /Diagnostic ID/, 'Root UI error boundary does not expose a safe diagnostic id.');
requirePattern('frontend/src/components/chat/CommunicationHub.jsx', /Diagnostic ID/, 'Communication Hub local boundary does not expose a safe diagnostic id.');
rejectPattern('frontend/src/App.jsx', /localStorage\.setItem\('kalpa_last_error'/, 'Raw runtime errors are still persisted in the legacy localStorage log.');
rejectPattern('frontend/src/components/chat/CommunicationHub.jsx', /localStorage\.setItem\('kd-error-logs'/, 'Communication Hub still persists raw error messages/stacks.');

requirePattern('backend/src/server.js', /app\.post\('\/api\/client-diagnostics', clientDiagnosticRateLimiter/, 'Authenticated client diagnostic sink is missing.');
requirePattern('backend/src/server.js', /CLIENT_RUNTIME_DIAGNOSTIC/, 'Client diagnostics are not written to operational events.');
requirePattern('backend/src/server.js', /X-Error-Fingerprint/, 'Server failures do not expose a safe error fingerprint.');
requirePattern('backend/src/server.js', /function sendApiFailure/, 'Central safe API failure response helper is missing.');
rejectPattern('backend/src/server.js', /res\.status\((?:500|503)\)[^\n]*error:(?:e|err|error)\.message/, 'A 5xx route still exposes an internal error message.');
requirePattern('backend/src/services/operationalReliabilityService.js', /sanitizeOperationalPath\(req\.originalUrl \|\| req\.url\)/, 'Structured request logs still use raw request URLs.');
requirePattern('frontend/src/components/command-centre/CommandCentreView.jsx', /CLIENT_RUNTIME_DIAGNOSTIC[\s\S]{0,1600}details\.stateVersion/, 'Admin system events do not surface diagnostic correlation metadata.');

requirePattern('package.json', /"verify:diagnostics":\s*"node scripts\/phase-20-runtime-error-diagnostics-check\.mjs"/, 'Phase 20 verification script is not registered.');
requirePattern('package.json', /npm run verify:long-session && npm run verify:diagnostics && npm run verify:deployment-resume && npm run verify:fault-soak && npm run verify:certification-local-postgres && npm run verify:operator-deploy && npm run verify:frontend-runtime/, 'Phase 20 verifier is not ordered after the Phase 19 long-session gate.');
requirePattern('scripts/full-release-verifier-matrix.mjs', /id:'runtime-error-diagnostics'[\s\S]*phase-20-runtime-error-diagnostics-check\.mjs/, 'Phase 20 verifier is missing from the full release matrix.');

if (findings.length) {
  console.error(`Phase 20 runtime error diagnostics closure FAILED with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.message}`);
  process.exit(1);
}
console.log('Phase 20 runtime error diagnostics closure PASS (request correlation, sanitized client fingerprints, safe 5xx responses, persistent operational diagnostics, bounded local logs and admin traceability present).');
