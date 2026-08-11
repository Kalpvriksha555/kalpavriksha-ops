import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeNotificationReadBy,
  isNotificationReadByUser,
  addNotificationReadUser,
  mergeNotificationRecords,
} from '../../frontend/src/utils/notificationUtils.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.resolve(here, '../../frontend/src/App.jsx'), 'utf8');
const chatSource = fs.readFileSync(path.resolve(here, '../../frontend/src/utils/chatUtils.js'), 'utf8');
const hubSource = fs.readFileSync(path.resolve(here, '../../frontend/src/components/chat/CommunicationHub.jsx'), 'utf8');

const user = { id:'u-1', username:'amit', name:'Amit', role:'Designer' };

test('legacy scalar notification readBy is treated as a one-entry list, not as an array-like assumption', () => {
  assert.deepEqual(normalizeNotificationReadBy('Amit'), ['Amit']);
  assert.deepEqual(normalizeNotificationReadBy({ name:'Amit' }), [{ name:'Amit' }]);
  assert.deepEqual(normalizeNotificationReadBy(null), []);
  assert.equal(isNotificationReadByUser({ readBy:'Amit' }, user), true);
  assert.equal(isNotificationReadByUser({ readBy:{ name:'Amit' } }, user), true);
  assert.equal(isNotificationReadByUser({ readBy:'Other' }, user), false);
});

test('read marker updates preserve legacy markers while producing a canonical array', () => {
  const updated = addNotificationReadUser({ id:'n1', readBy:'Other' }, user);
  assert.ok(Array.isArray(updated.readBy));
  assert.deepEqual(updated.readBy, ['Other', 'Amit']);
  const merged = mergeNotificationRecords({ id:'n1', readBy:'Other' }, { id:'n1', readBy:{ name:'Amit' } });
  assert.ok(Array.isArray(merged.readBy));
  assert.equal(merged.readBy.length, 2);
});

test('App and chat render paths do not call array methods directly on unchecked readBy values', () => {
  assert.match(appSource, /normalizeRuntimeReadBy\(m\.readBy\)\.some/);
  assert.match(appSource, /isNotificationReadByUser\(notification, currentUser \|\| \{\}\)/);
  assert.doesNotMatch(appSource, /\(notification\.readBy \|\| \[\]\)\.includes/);
  assert.doesNotMatch(appSource, /\(n\.readBy \|\| \[\]\)\.includes/);
  assert.match(chatSource, /normalizeChatReadBy\(message\?\.readBy\)\.some/);
  assert.match(hubSource, /normalizeChatReadBy\(message\?\.readBy\)\.some/);
  assert.doesNotMatch(appSource, /project\?\.subTasks \|\| project\?\.revisions \|\| \[\]\)\.some/);
  assert.match(appSource, /const revisionItems = Array\.isArray\(project\?\.subTasks\)/);
});
