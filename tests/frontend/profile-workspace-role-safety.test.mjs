import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const profile = fs.readFileSync(new URL('../../frontend/src/components/profile/ProfileView.jsx', import.meta.url), 'utf8');
const profileService = fs.readFileSync(new URL('../../frontend/src/services/profileService.js', import.meta.url), 'utf8');
const otpService = fs.readFileSync(new URL('../../frontend/src/services/otpService.js', import.meta.url), 'utf8');
const layout = fs.readFileSync(new URL('../../frontend/src/components/layout.jsx', import.meta.url), 'utf8');
const date = fs.readFileSync(new URL('../../frontend/src/utils/date.js', import.meta.url), 'utf8');
const attendance = fs.readFileSync(new URL('../../frontend/src/utils/presenceAttendanceUtils.js', import.meta.url), 'utf8');

test('profile changes wait for backend confirmation and photos do not trust client identity fields', () => {
  assert.match(profileService, /PATCH/);
  assert.match(profileService, /\/api\/profile/);
  assert.doesNotMatch(profileService, /form\.append\(['"]userId/);
  assert.doesNotMatch(profileService, /form\.append\(['"]username/);
  assert.match(profile, /backend did not confirm/i);
  assert.match(app, /const handleSaveOwnProfile = async/);
  assert.match(app, /updateProfileApi\(patch\)/);
});

test('profile OTP consumes the authoritative updated backend user and hides developer instructions', () => {
  assert.match(profile, /mergeConfirmedUser\(response\.user\)/);
  assert.match(profile, /autoComplete="one-time-code"/);
  assert.match(profile, /mobileSending/);
  assert.doesNotMatch(otpService, /npm run dev:all|port 8080/);
});

test('workspace loading failures fail closed and never recommend insecure Firebase rules', () => {
  assert.match(app, /setBackendStateReady\(false\);\s*setIsDbReady\(false\);/);
  assert.match(app, /<SecureWorkspaceErrorScreen/);
  assert.match(layout, /No cached production records are being shown/);
  assert.doesNotMatch(layout, /allow read, write: if true/);
});

test('saved filters are actor scoped and every role is redirected away from forbidden tabs', () => {
  assert.match(app, /kalpa_saved_global_filters::/);
  assert.match(app, /ADMIN_ONLY_TABS/);
  assert.match(app, /isTabAllowedForRole\(activeTab, currentUser\.role\)/);
  assert.match(app, /isTabAllowedForRole\(filter\.tab, currentUser\?\.role\)/);
});

test('company date and attendance helpers use the explicit India timezone', () => {
  assert.match(date, /Asia\/Kolkata/);
  assert.match(attendance, /Asia\/Kolkata/);
  assert.match(attendance, /\+05:30/);
  assert.doesNotMatch(attendance, /new Date\(\)\.toLocaleDateString\('en-CA'\)/);
});

test('recovery controls are busy-safe and use browser credential semantics', () => {
  assert.match(app, /recoverySending/);
  assert.match(app, /recoveryResetting/);
  assert.match(app, /autoComplete="new-password"/);
  assert.match(app, /autoComplete="one-time-code"/);
});


test('remaining operational date and cache helpers are India-safe and actor scoped', () => {
  const operations = fs.readFileSync(new URL('../../frontend/src/components/operations/ActiveOperationsView.jsx', import.meta.url), 'utf8');
  const archive = fs.readFileSync(new URL('../../frontend/src/components/archive/HistoryArchiveView.jsx', import.meta.url), 'utf8');
  const archiveUtils = fs.readFileSync(new URL('../../frontend/src/utils/archiveUtils.js', import.meta.url), 'utf8');
  const commandCentre = fs.readFileSync(new URL('../../frontend/src/components/command-centre/CommandCentreView.jsx', import.meta.url), 'utf8');
  assert.match(operations, /formatDateKey\(p\.completedAt \|\| p\.submittedAt\) === todayKey/);
  assert.doesNotMatch(operations, /new Date\(\)\.setHours\(0,0,0,0\)/);
  assert.match(archive, /formatMonthLabel\(project\.completedAt\)/);
  assert.match(archiveUtils, /formatDateKey\(completedAt\)/);
  assert.match(commandCentre, /kalpa_presence_times::\$\{cacheActorKey\}/);
  assert.match(commandCentre, /kalpa_presence_task_state::\$\{cacheActorKey\}/);
});


test('private downloaded-file caches are actor scoped and browser clients never seed shared users', () => {
  const fileService = fs.readFileSync(new URL('../../frontend/src/services/fileService.js', import.meta.url), 'utf8');
  assert.match(fileService, /kalpavriksha_downloaded_file_index_v2/);
  assert.match(fileService, /activeFileCacheActor/);
  assert.match(fileService, /`\$\{activeFileCacheActor\}::\$\{resourceKey\}`/);
  assert.match(app, /setProjectFileCacheActor\(currentUser \|\| \{\}\)/);
  assert.doesNotMatch(app, /INITIAL_USERS\.forEach\(u => \{\s*setDoc\(doc\(db,[\s\S]*?'users'/);
  assert.match(app, /Never seed or overwrite shared user records from a browser client/);
});


test('account creation and recovery dialogs prevent duplicate actions and expose accessible close controls', () => {
  assert.match(app, /const \[isCreatingUser, setIsCreatingUser\] = useState\(false\)/);
  assert.match(app, /disabled=\{isCreatingUser\}[\s\S]*Creating…/);
  assert.match(app, /aria-label="Close password recovery"/);
  assert.match(app, /aria-label="Close new employee form"/);
});
