import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const layout = fs.readFileSync(new URL('../../frontend/src/components/layout.jsx', import.meta.url), 'utf8');

test('every browser page instance revokes the previous session before hydration', () => {
  assert.match(app, /clearBrowserSessionApi\(\)/);
  assert.match(app, /clearAuthenticatedWorkspace\(\{ clearCache: true \}\)/);
  assert.doesNotMatch(app, /getSessionApi\(\)/);
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

test('temporary-password API responses still open password change instead of an empty workspace', () => {
  assert.match(app, /err\?\.code === 'PASSWORD_CHANGE_REQUIRED'[\s\S]*setPasswordChangeSessionUser/);
  assert.match(app, /response\?\.user\?\.mustChangePassword/);
  assert.match(app, /passwordChangeSessionUser=\{passwordChangeSessionUser\}/);
  assert.match(app, /Current Password/);
});
