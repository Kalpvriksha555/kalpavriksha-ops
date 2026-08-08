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
