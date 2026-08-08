import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getArchiveBank,
  getArchiveLocation,
  matchesArchiveSearch,
  groupArchivedByLocation,
} from '../../frontend/src/utils/archiveUtils.js';
import {
  getPaymentEstimateAmount,
  getPaymentReceivedAmount,
  derivePaymentTrackingStatusFromData,
  getPaymentTrackingStatus,
  buildPaymentTrackingUpdate,
} from '../../frontend/src/utils/paymentStatusUtils.js';
import {
  allProjectDocs,
  getTaskDescription,
  getEstimateDetails,
  getLatestCompletedFileName,
} from '../../frontend/src/utils/taskDisplayUtils.js';
import {
  getNotificationCategory,
  getNotificationPriority,
  isNotificationReadByUser,
  addNotificationReadUser,
  mergeNotificationRecords,
  isNotificationForUser,
} from '../../frontend/src/utils/notificationUtils.js';
import {
  getAttendanceSessionStartMs,
  getAttendanceSessionEndMs,
  getAttendanceFirstLoginLabel,
  deriveAttendanceSession,
  getBreakMinutesFromLog,
  getDraftingElapsedMs,
  getTaskBusySince,
  getTaskFinishedAt,
} from '../../frontend/src/utils/presenceAttendanceUtils.js';
import { buildJitsiUrl } from '../../frontend/src/utils/meeting.js';
import {
  getProjectFinanceMonthKey,
  getFinanceEventMonthKey,
  buildProjectMonthlyFinanceEntry,
  hasRevisionInAccountingMonth,
} from '../../frontend/src/utils/accountingPeriodUtils.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const archiveSource = fs.readFileSync(path.resolve(here, '../../frontend/src/components/archive/HistoryArchiveView.jsx'), 'utf8');
const chatSource = fs.readFileSync(path.resolve(here, '../../frontend/src/components/chat/CommunicationHub.jsx'), 'utf8');
const appSource = fs.readFileSync(path.resolve(here, '../../frontend/src/App.jsx'), 'utf8');
const commandCentreSource = fs.readFileSync(path.resolve(here, '../../frontend/src/components/command-centre/CommandCentreView.jsx'), 'utf8');
const viewerSource = fs.readFileSync(path.resolve(here, '../../frontend/src/components/files/UnifiedFileViewer.jsx'), 'utf8');
const fileServiceSource = fs.readFileSync(path.resolve(here, '../../frontend/src/services/fileService.js'), 'utf8');
const taskServiceSource = fs.readFileSync(path.resolve(here, '../../frontend/src/services/taskService.js'), 'utf8');
const chatUtilsSource = fs.readFileSync(path.resolve(here, '../../frontend/src/utils/chatUtils.js'), 'utf8');

test('historical task, finance, archive, notification and attendance helpers tolerate explicit null records', () => {
  assert.doesNotThrow(() => getArchiveBank(null));
  assert.doesNotThrow(() => getArchiveLocation(null));
  assert.equal(matchesArchiveSearch(null, ''), true);
  assert.deepEqual(groupArchivedByLocation(null), []);

  assert.equal(getPaymentEstimateAmount(null), 0);
  assert.equal(getPaymentReceivedAmount(null), 0);
  assert.equal(derivePaymentTrackingStatusFromData(null), 'Not Updated');
  assert.equal(getPaymentTrackingStatus(null), 'Not Updated');
  assert.doesNotThrow(() => buildPaymentTrackingUpdate(null, 'Not Updated', null, null));

  assert.deepEqual(allProjectDocs(null), []);
  assert.equal(getTaskDescription(null), '');
  assert.equal(getEstimateDetails(null), '');
  assert.equal(getLatestCompletedFileName(null), '');

  assert.doesNotThrow(() => getNotificationCategory(null));
  assert.doesNotThrow(() => getNotificationPriority(null));
  assert.equal(isNotificationReadByUser(null, null), false);
  assert.equal(addNotificationReadUser(null, null), null);
  assert.doesNotThrow(() => mergeNotificationRecords(null, null));
  assert.equal(isNotificationForUser(null, null), false);

  assert.doesNotThrow(() => getAttendanceSessionStartMs(null, null));
  assert.doesNotThrow(() => getAttendanceSessionEndMs(null, null));
  assert.doesNotThrow(() => getAttendanceFirstLoginLabel(null, null));
  assert.doesNotThrow(() => deriveAttendanceSession(null, null));
  assert.doesNotThrow(() => getBreakMinutesFromLog(null, Date.now(), null));
  assert.doesNotThrow(() => getDraftingElapsedMs(null));
  assert.doesNotThrow(() => getTaskBusySince(null));
  assert.doesNotThrow(() => getTaskFinishedAt(null));

  assert.doesNotThrow(() => getProjectFinanceMonthKey(null));
  assert.doesNotThrow(() => getFinanceEventMonthKey(null, null));
  assert.doesNotThrow(() => buildProjectMonthlyFinanceEntry(null, '2026-08'));
  assert.doesNotThrow(() => hasRevisionInAccountingMonth(null, '2026-08'));
});

test('archive view normalizes corrupt persisted array fields before render-time joins and length checks', () => {
  assert.match(archiveSource, /selectedBanks: Array\.isArray\(rawState\?\.selectedBanks\) \? rawState\.selectedBanks : \[\]/);
  assert.match(archiveSource, /selectedLocations: Array\.isArray\(rawState\?\.selectedLocations\) \? rawState\.selectedLocations : \[\]/);
  assert.match(archiveSource, /openLocations: Array\.isArray\(rawState\?\.openLocations\) \? rawState\.openLocations : \[\]/);
});

test('chat persisted state rejects corrupt object and array shapes instead of carrying them into render logic', () => {
  assert.match(chatSource, /!Array\.isArray\(saved\) \? saved : \{\}/);
  assert.match(chatSource, /Array\.isArray\(saved\) \? saved\.map\(String\) : \[\]/);
});

test('public file, task, chat-presence and meeting boundaries defend explicit null option records', () => {
  assert.match(fileServiceSource, /validateProjectUploadSelection = \(files, options = \{\}\) => \{\s*options = options && typeof options === 'object' \? options : \{\}/);
  assert.match(fileServiceSource, /fetchProjectFilePreview = async \(doc = \{\}, options = \{\}\) => \{\s*doc = doc && typeof doc === 'object' \? doc : \{\}/);
  assert.match(fileServiceSource, /normalizeProjectFileRecord = \(doc = \{\}\) => \{\s*doc = doc && typeof doc === 'object' \? doc : \{\}/);
  assert.match(fileServiceSource, /downloadProjectFile = async \(doc = \{\}, onProgress, options = \{\}\) => \{\s*doc = doc && typeof doc === 'object' \? doc : \{\}/);
  assert.match(taskServiceSource, /toTime\(task\?\.financeVersion\)/);
  assert.match(chatUtilsSource, /toMs\(user\?\.lastHeartbeatAt\)/);
  assert.equal(buildJitsiUrl('room', 'User', null).includes('meet.jit.si'), true);
});

test('browser cache boundaries normalize malformed legacy storage instead of trusting JSON shape', () => {
  assert.match(appSource, /const parseStoredArray = \(raw, fallback = \[\]\) =>/);
  assert.match(appSource, /Array\.isArray\(parsed\) \? parsed : fallback/);
  assert.match(commandCentreSource, /saved && typeof saved === 'object' && !Array\.isArray\(saved\) \? saved : \{\}/);
  assert.match(commandCentreSource, /nextTimes\[key\] && typeof nextTimes\[key\] === 'object' && !Array\.isArray\(nextTimes\[key\]\)/);
  assert.match(viewerSource, /typeof saved !== 'object' \|\| Array\.isArray\(saved\)/);
});

test('chat read markers use component-local refs and never mutate the currentUser prop object', () => {
  assert.match(chatSource, /lastMentionReadRef/);
  assert.match(chatSource, /lastChatReadRef/);
  assert.doesNotMatch(chatSource, /currentUser\.(?:lastMentionRead|lastChatRead)\s*=/);
});

test('release verify executes an actual signed-out React runtime bootstrap after dependency installation', () => {
  const root = path.resolve(here, '../..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const runtimeVerifier = fs.readFileSync(path.join(root, 'scripts/frontend-runtime-bootstrap-check.mjs'), 'utf8');
  assert.equal(pkg.scripts['verify:frontend-runtime'], 'node scripts/frontend-runtime-bootstrap-check.mjs');
  assert.match(pkg.scripts.verify, /npm run test:frontend && npm run verify:frontend-runtime && npm run test:backend/);
  const matrix = fs.readFileSync(path.join(root, 'scripts/full-release-verifier-matrix.mjs'), 'utf8');
  assert.match(matrix, /id:'frontend-runtime-bootstrap'/);
  assert.match(runtimeVerifier, /viteServer\.ssrLoadModule\('\/src\/App\.jsx'\)/);
  assert.match(runtimeVerifier, /Object\.defineProperty\(globalThis, key/);
  assert.doesNotMatch(runtimeVerifier, /Object\.assign\(globalThis/);
  assert.match(runtimeVerifier, /createRequire\(path\.join\(frontendRoot, 'package\.json'\)\)/);
  assert.match(runtimeVerifier, /importFrontendDependency\('react'\)/);
  assert.match(runtimeVerifier, /importFrontendDependency\('react-dom\/server'\)/);
  assert.match(runtimeVerifier, /resolve: \{ dedupe: \['react', 'react-dom'\] \}/);
  assert.doesNotMatch(runtimeVerifier, /\bimport\('react'\)/);
  assert.doesNotMatch(runtimeVerifier, /\bimport\('react-dom\/server'\)/);
  assert.match(runtimeVerifier, /ReactDOMServer\.renderToString/);
  assert.match(runtimeVerifier, /Preparing secure sign-in/);
  assert.match(runtimeVerifier, /appModule\?\.LoginScreen/);
  assert.match(runtimeVerifier, /React\.createElement\(appModule\.LoginScreen/);
  assert.match(runtimeVerifier, /LoginScreen runtime verification did not render authentication controls/);
  assert.match(runtimeVerifier, /fatal error boundary/);
});


test('client runtime diagnostics capture render, window and async failures without storing workspace data', () => {
  assert.match(appSource, /CLIENT_RUNTIME_ERROR_LOG_KEY = 'kalpa_client_runtime_errors_v2'/);
  assert.match(appSource, /CLIENT_RUNTIME_ERROR_LOG_LIMIT = 20/);
  assert.match(appSource, /window\.addEventListener\('error', captureError\)/);
  assert.match(appSource, /window\.addEventListener\('unhandledrejection', captureRejection\)/);
  assert.match(appSource, /source:'app-error-boundary'/);
  assert.match(appSource, /componentStack: info\?\.componentStack \|\| ''/);
});
