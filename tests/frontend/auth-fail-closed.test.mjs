import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const layout = fs.readFileSync(new URL('../../frontend/src/components/layout.jsx', import.meta.url), 'utf8');

test('session bootstrap clears stale workspace when unauthenticated', () => {
  assert.match(app, /else \{\s*clearAuthenticatedWorkspace\(\{ clearCache: true \}\);\s*\}/s);
  assert.match(app, /catch\(\(\) => \{\s*if \(!cancelled\) clearAuthenticatedWorkspace\(\{ clearCache: true \}\);/s);
});

test('workspace clear removes stale operational state and banner', () => {
  assert.match(app, /setCurrentUser\(null\)/);
  assert.match(app, /setProjects\(\(\) => \[\]\)/);
  assert.match(app, /setShowLocalBanner\(false\)/);
});

test('local banner accurately describes isolated sandbox', () => {
  assert.match(layout, /Local sandbox mode/);
  assert.doesNotMatch(layout, /bundled offline snapshot/);
});

test('temporary-password sessions return to password change instead of an empty workspace', () => {
  assert.match(app, /session\.user\.mustChangePassword[\s\S]*setPasswordChangeSessionUser\(session\.user\)[\s\S]*setCurrentUser\(null\)/);
  assert.match(app, /err\?\.code === 'PASSWORD_CHANGE_REQUIRED'[\s\S]*setPasswordChangeSessionUser/);
  assert.match(app, /passwordChangeSessionUser=\{passwordChangeSessionUser\}/);
  assert.match(app, /Current Password/);
});
