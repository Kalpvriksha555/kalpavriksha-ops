import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const findings = [];
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const requireFile = file => {
  if (!fs.existsSync(path.join(root, file))) findings.push({ file, message:'Required Phase 17 source/test file is missing.' });
};
const requirePattern = (file, pattern, message) => {
  if (!fs.existsSync(path.join(root, file))) return;
  if (!pattern.test(read(file))) findings.push({ file, message, pattern:String(pattern) });
};
const forbidPattern = (file, pattern, message) => {
  if (!fs.existsSync(path.join(root, file))) return;
  if (pattern.test(read(file))) findings.push({ file, message, pattern:String(pattern) });
};

for (const file of [
  'backend/src/services/financeIntegrityService.js',
  'backend/src/server.js',
  'backend/src/repositories/postgresStateRepository.js',
  'frontend/src/utils/financeMergeUtils.js',
  'frontend/src/services/taskService.js',
  'frontend/src/services/financeOutboxService.js',
  'frontend/src/App.jsx',
  'tests/backend/phase17-finance-ledger-invariants.test.mjs',
  'tests/frontend/phase17-finance-sync-invariants.test.mjs',
  'tests/frontend/finance-outbox-durability.test.mjs'
]) requireFile(file);

// financeVersion is the authoritative concurrency clock. Browser/server clocks
// are only equal-version or legacy tie breakers and can never promote an older
// finance state over a newer committed version.
requirePattern('backend/src/services/financeIntegrityService.js', /if \(incomingVersion !== existingVersion[\s\S]{0,240}incomingVersion > existingVersion \? incoming : existing/, 'Backend finance merge must choose by financeVersion before timestamps.');
requirePattern('frontend/src/utils/financeMergeUtils.js', /if \(currentVersion !== incomingVersion[\s\S]{0,260}incomingVersion > currentVersion \? incoming : current/, 'Frontend finance merge must choose by financeVersion before timestamps.');
requirePattern('frontend/src/utils/financeMergeUtils.js', /'estimate','estimateAmount','ledger','financeVersion'/, 'Frontend finance merge must preserve estimateAmount as finance state.');

// Compact/delta finance records may omit unchanged fields. Omission is not a
// deletion instruction on either side of the API boundary.
requirePattern('backend/src/services/financeIntegrityService.js', /hasOwnProperty\.call\(source \|\| \{\}, field\)/, 'Backend finance merge must only overwrite finance fields that are present in the selected source.');
requirePattern('frontend/src/utils/financeMergeUtils.js', /hasOwnProperty\.call\(source \|\| \{\}, field\)/, 'Frontend finance merge must only overwrite finance fields that are present in the selected source.');
requirePattern('tests/backend/phase17-finance-ledger-invariants.test.mjs', /partial finance patches cannot erase durable fields they omit/, 'Backend regression coverage for compact finance patches is missing.');
requirePattern('tests/frontend/phase17-finance-sync-invariants.test.mjs', /compact finance delta cannot erase omitted receipt or audit fields/, 'Frontend regression coverage for compact finance patches is missing.');

// Idempotency must be payload/operation bound and retain a bounded history of
// committed receipts, not merely the most recent mutation ID.
requirePattern('backend/src/services/financeIntegrityService.js', /financeMutationFingerprint/, 'Finance mutation fingerprinting is missing.');
requirePattern('backend/src/services/financeIntegrityService.js', /financeMutationReceipts/, 'Bounded finance mutation receipt history is missing.');
requirePattern('backend/src/services/financeIntegrityService.js', /\.slice\(0, safeLimit\)/, 'Finance mutation receipt history must remain bounded.');
requirePattern('backend/src/server.js', /FINANCE_MUTATION_ID_REUSE/, 'Finance mutation-ID reuse with different content must fail closed.');
requirePattern('backend/src/server.js', /assertFinanceMutationReplayMatches/, 'Finance replay must validate mutation fingerprint and operation.');
requirePattern('backend/src/server.js', /async function resolveCommittedFinanceReplay/, 'Committed finance replay resolver is missing.');
requirePattern('backend/src/server.js', /const pendingQueue = persistenceQueue;[\s\S]{0,120}await pendingQueue\.catch/, 'An identical retry arriving during persistence must wait for the already-existing queue before rechecking commit state.');
requirePattern('backend/src/server.js', /const committedState = USE_POSTGRES \? relationalShadowState : readDb\(\)/, 'Idempotent replay must be resolved against committed state, never uncommitted memory state.');

const server = fs.existsSync(path.join(root, 'backend/src/server.js')) ? read('backend/src/server.js') : '';
const canonicalStart = server.indexOf("app.post('/api/state/projects/:id/payment-status'");
const legacyStart = server.indexOf("app.post('/api/cases/:id/payment'", Math.max(0, canonicalStart));
const historyStart = server.indexOf("app.get('/api/finance/history/:id'", Math.max(0, legacyStart));
const canonicalRoute = canonicalStart >= 0 && legacyStart > canonicalStart ? server.slice(canonicalStart, legacyStart) : '';
const legacyRoute = legacyStart >= 0 && historyStart > legacyStart ? server.slice(legacyStart, historyStart) : '';
if (!/resolveCommittedFinanceReplay/.test(canonicalRoute) || !/financeMutationFingerprint/.test(canonicalRoute)) findings.push({ file:'backend/src/server.js', message:'Canonical payment-status route must use fingerprinted committed replay.' });
if (!/resolveCommittedFinanceReplay/.test(legacyRoute) || !/rememberFinanceMutationReceipt/.test(legacyRoute)) findings.push({ file:'backend/src/server.js', message:'Legacy payment-ledger route must use the same committed replay/receipt invariant.' });
if (!/INVALID_PAYMENT_DATE/.test(legacyRoute) || !/PAYMENT_DATE_IN_FUTURE/.test(legacyRoute) || !/REFUND_EXCEEDS_RECEIVED/.test(legacyRoute) || !/PAYMENT_AMOUNT_REQUIRED/.test(legacyRoute)) findings.push({ file:'backend/src/server.js', message:'Legacy payment-ledger route must enforce canonical date, future-date, refund and positive-payment validation.' });

// The browser outbox keeps exact IDs for retryable response loss but must allow
// a user to intentionally re-submit the same business values after a terminal
// concurrency conflict against a newer authoritative version.
requirePattern('frontend/src/services/financeOutboxService.js', /FINANCE_VERSION_CONFLICT/, 'Finance outbox must recognize terminal finance-version conflicts.');
requirePattern('frontend/src/services/financeOutboxService.js', /FINANCE_MUTATION_ID_REUSE/, 'Finance outbox must recognize terminal mutation-ID reuse conflicts.');
requirePattern('frontend/src/services/financeOutboxService.js', /const reusePreviousMutation = sameDraft[\s\S]{0,420}const nextMutationId = reusePreviousMutation/, 'Finance outbox must distinguish retryable same-draft replay from a new post-conflict mutation.');
requirePattern('frontend/src/services/financeOutboxService.js', /record\.expectedFinanceVersion = Math\.max\(/, 'Late finance confirmations must not move a newer pending expected version backwards.');
requirePattern('frontend/src/services/financeOutboxService.js', /record\.confirmedFinanceVersion = Math\.max\(/, 'Confirmed finance versions must advance monotonically.');
requirePattern('tests/frontend/finance-outbox-durability.test.mjs', /same draft keeps its mutation id for retryable response loss/, 'Retryable response-loss idempotency regression coverage is missing.');
requirePattern('tests/frontend/finance-outbox-durability.test.mjs', /same draft can be intentionally resubmitted after a finance-version conflict/, 'Post-conflict finance rebase regression coverage is missing.');
requirePattern('tests/frontend/finance-outbox-durability.test.mjs', /older confirmation can never move a newer queued finance version backwards/, 'Monotonic confirmation regression coverage is missing.');

// Both task merge paths must use the same finance-aware merge helper.
requirePattern('frontend/src/services/taskService.js', /applyFreshestTaskFinance/, 'Task service must apply finance-version-aware merging.');
requirePattern('frontend/src/App.jsx', /applyFreshestTaskFinance\(base, a, b\)/, 'App project merge must apply finance-version-aware merging too.');

// Financial audit history is append-only. Automatic retention/GC may not remove
// durable finance history rows.
requirePattern('backend/src/repositories/postgresStateRepository.js', /CREATE TABLE IF NOT EXISTS finance_history/, 'Permanent PostgreSQL finance history table is missing.');
requirePattern('backend/src/repositories/postgresStateRepository.js', /INSERT INTO finance_history\(/, 'Finance writes must append immutable PostgreSQL finance history.');
requirePattern('backend/src/repositories/postgresStateRepository.js', /const FINANCE_CASE_KEYS[\s\S]{0,700}lastFinanceMutationFingerprint[\s\S]{0,240}financeMutationReceipts/, 'Relational finance-only classification must recognize Phase 17 mutation receipt metadata.');
forbidPattern('backend/src/repositories/postgresStateRepository.js', /(?:DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+finance_history/i, 'Automatic repository code must not delete or truncate finance history.');

// Monthly reporting keeps finance attached to the task operational month; later
// entry timestamps do not silently move historical work into a different report.
requirePattern('frontend/src/utils/accountingPeriodUtils.js', /const taskMonth = getProjectTaskMonthKey\(project\);[\s\S]{0,120}if \(taskMonth\) return taskMonth;/, 'Finance reports must keep the task operational month authoritative.');
requirePattern('tests/frontend/monthly-finance-reports-ledger.test.mjs', /later payment updates remain in the task creation month/, 'Monthly finance regression coverage for late payment entry is missing.');

// Permanent release wiring.
requirePattern('package.json', /"verify:finance-ledger"\s*:\s*"node scripts\/phase-17-finance-ledger-invariants-check\.mjs"/, 'Phase 17 verifier is not registered in package.json.');
requirePattern('package.json', /npm run verify:presence-attendance && npm run verify:finance-ledger && npm run verify:persistence-restart && npm run verify:long-session && npm run verify:diagnostics && npm run verify:deployment-resume && npm run verify:fault-soak && npm run verify:certification-local-postgres && npm run verify:operator-deploy && npm run verify:frontend-runtime/, 'Phase 17 verifier must run after Phase 16 in the normal verification chain.');
requirePattern('scripts/full-release-verifier-matrix.mjs', /id:'finance-ledger-invariants'[\s\S]*phase-17-finance-ledger-invariants-check\.mjs/, 'Phase 17 verifier is not part of the full release matrix.');

if (findings.length) {
  console.error(`Phase 17 finance/reports/ledger invariants closure FAILED with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.message}`);
  process.exit(1);
}

console.log('Phase 17 finance/reports/ledger invariants closure PASS (version-first merges, partial-patch preservation, committed replay receipts, conflict-safe outbox and append-only finance history present).');
