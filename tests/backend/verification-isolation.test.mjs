import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const verifierFiles = [
  'scripts/phase-2-finance-durability-check.mjs',
  'scripts/phase-3-authentication-check.mjs',
  'scripts/phase-4-authorization-check.mjs',
  'scripts/phase-6-file-storage-check.mjs',
  'scripts/phase-7-reliability-check.mjs',
  'scripts/phase-8-release-certification-check.mjs'
];

test('runtime verification servers cannot inherit the production DATABASE_URL', () => {
  for (const file of verifierFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /DATABASE_URL\s*:\s*['"]['"]/u, `${file} must explicitly blank DATABASE_URL`);
  }
});

test('finance durability verifier uses isolated runtime storage', () => {
  const source = fs.readFileSync('scripts/phase-2-finance-durability-check.mjs', 'utf8');
  assert.match(source, /KALPA_DATA_DIR:\s*tempDir/u);
  assert.match(source, /KALPA_FILE_STORAGE_ROOT:\s*path\.join\(tempDir, ['"]private-files['"]\)/u);
  assert.match(source, /KALPA_BACKUP_ROOT:\s*path\.join\(tempDir, ['"]backups['"]\)/u);
});

test('reliability verifier disables inherited production release-certificate gating', () => {
  const source = fs.readFileSync('scripts/phase-7-reliability-check.mjs', 'utf8');
  assert.match(source, /RELEASE_CERTIFICATE_REQUIRED:\s*['"]false['"]/u);
  assert.match(source, /RELEASE_VALIDATE_PRODUCTION_ENV:\s*['"]false['"]/u);
  assert.match(source, /RELEASE_REQUIRE_BACKUP:\s*['"]false['"]/u);
  assert.match(source, /RELEASE_CERTIFICATE_PATH:\s*path\.join\(temp,\s*['"]release-certification\.json['"]\)/u);
});

test('clean-install verification includes build-time dev dependencies under production NODE_ENV', () => {
  for (const file of ['scripts/clean-install-verify.mjs', 'clean-install-verify.mjs']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(
      source,
      /runNpm\('root_npm_ci',\s*\['ci',\s*'--include=dev'/u,
      `${file} must install root build tooling even when NODE_ENV=production`
    );
    assert.match(
      source,
      /runNpm\('frontend_npm_ci',\s*\['ci',\s*'--prefix',\s*'frontend',\s*'--include=dev'/u,
      `${file} must install frontend PostCSS/Tailwind build tooling even when NODE_ENV=production`
    );
  }
});
