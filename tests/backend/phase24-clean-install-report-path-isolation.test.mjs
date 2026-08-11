import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const releaseCertify = read('scripts/release-certify.mjs');
const deploy = read('scripts/deploy-1.9.30-vps.sh');

test('resume-aware release certification cannot be redirected to a stale production CLEAN_INSTALL_REPORT path', () => {
  const receiptIndex = releaseCertify.indexOf("const resumeAwareReceiptPath = String(process.env.KALPA_RESUME_AWARE_CANDIDATE_RECEIPT || '').trim();");
  const reportIndex = releaseCertify.indexOf('const cleanReportPath = resumeAwareReceiptPath');
  assert.ok(receiptIndex >= 0 && reportIndex > receiptIndex, 'resume-aware receipt must be resolved before the clean report path');
  assert.match(releaseCertify, /const cleanReportPath = resumeAwareReceiptPath\s*\? path\.join\(root, '\.release\/clean-install-report\.json'\)\s*:\s*path\.resolve\(process\.env\.CLEAN_INSTALL_REPORT \|\| '\.release\/clean-install-report\.json'\)/s);
});

test('production deploy binds certification to the exact candidate-local clean-install report in both database branches', () => {
  assert.match(deploy, /CANDIDATE_CLEAN_INSTALL_REPORT="\$RELEASE_ROOT\/\.release\/clean-install-report\.json"/);
  const bindings = deploy.match(/CLEAN_INSTALL_REPORT="\$CANDIDATE_CLEAN_INSTALL_REPORT"/g) || [];
  assert.equal(bindings.length, 2, 'both release-certification branches must override the inherited production env path');
  assert.match(deploy, /Certified candidate clean-install report is missing/);
});

test('candidate receipt and artifact hashes are re-proved after backup and immediately before production certification', () => {
  const backupStatus = deploy.indexOf('npm run backup:status | tee "$WORK/pre-deployment-backup-status.json"');
  const beforeCertReceipt = deploy.indexOf('candidate-phase-verification.before-production-certification.json');
  const releaseCert = deploy.indexOf('npm run release:certify | tee "$WORK/release-certification.json"', beforeCertReceipt);
  assert.ok(backupStatus >= 0 && beforeCertReceipt > backupStatus && releaseCert > beforeCertReceipt,
    'artifact receipt proof must run after the fresh backup and before release certification');
  assert.match(deploy, /--require-artifacts true/);
});
