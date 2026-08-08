import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { financeActorKey, financeTaskKey } from '../../frontend/src/services/financeOutboxService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(here, '../../frontend/src/App.jsx');
const appSource = fs.readFileSync(appPath, 'utf8');

test('signed-out browser bootstrap accepts null identity values', () => {
  assert.equal(financeActorKey(null), '');
  assert.equal(financeActorKey(undefined), '');
  assert.equal(financeTaskKey(null), '');
  assert.equal(financeTaskKey(undefined), '');
});

test('App signed-out render helpers are null-safe before LoginScreen is returned', () => {
  assert.match(appSource, /const operationalActorKey = \(user = \{\}\) => String\(user\?\.id \|\| user\?\.username \|\| user\?\.name \|\| ''\)/);
  assert.match(appSource, /const \[currentUser, setCurrentUser\] = useState\(null\)/);
  assert.match(appSource, /financeActorKey\(currentUser\)/);
  assert.match(appSource, /operationalActorKey\(currentUser\)/);
});

test('role-scoped cache helper also tolerates null during logout transitions', () => {
  assert.match(appSource, /String\(user\?\.id \|\| user\?\.username \|\| ''\)/);
  assert.match(appSource, /String\(user\?\.role \|\| ''\)/);
});

test('runtime verifier distinguishes the initial secure boot screen from the post-boot login screen', () => {
  const verifier = fs.readFileSync(path.resolve(here, '../../scripts/frontend-runtime-bootstrap-check.mjs'), 'utf8');
  assert.match(appSource, /export const LoginScreen =/);
  assert.match(verifier, /Preparing secure sign-in/);
  assert.match(verifier, /React\.createElement\(appModule\.LoginScreen/);
  assert.match(verifier, /LoginScreen runtime verification did not render authentication controls/);
  assert.doesNotMatch(verifier, /Signed-out App bootstrap did not render an authentication surface\./);
});
