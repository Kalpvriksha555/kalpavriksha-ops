import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');

test('closed notification panel does not rebuild notification views or activity timeline', () => {
  assert.match(app, /if \(!showNotifs\) return \{\};/);
  assert.match(app, /if \(!showNotifs\) return \[\];/);
  assert.match(app, /showNotifs \? buildActivityTimeline\(projects, chatMessages, notifications\) : \[\]/);
});

test('inactive screens do not sort tasks or calculate assignment recommendations', () => {
  assert.match(app, /if \(activeTab !== 'board' && activeTab !== 'my_tasks'\) return \[\];/);
  assert.match(app, /showNewLead \? getAssignmentRecommendations\(activeUsers, projects\) : \[\]/);
});

test('designer tab correction is an effect rather than a render side effect', () => {
  assert.match(app, /useEffect\(\(\) => \{\s*if \(currentUser\?\.role === ROLES\.DESIGNER && activeTab === 'board'\) setActiveTab\('command'\);/);
  assert.doesNotMatch(app, /setTimeout\(\(\) => setActiveTab\('command'\), 0\)/);
});
