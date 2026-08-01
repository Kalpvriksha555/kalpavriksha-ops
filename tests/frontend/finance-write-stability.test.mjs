import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { derivePaymentTrackingStatusFromData } from '../../frontend/src/utils/paymentStatusUtils.js';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const taskService = fs.readFileSync(new URL('../../frontend/src/services/taskService.js', import.meta.url), 'utf8');

const detailStart = app.indexOf('const TaskDetailView');
const detailEnd = app.indexOf('class AppErrorBoundary', detailStart);
const detail = app.slice(detailStart, detailEnd);
const updateLedgerStart = detail.indexOf('const updateLedger');
const saveLedgerStart = detail.indexOf('const handleSaveLedger', updateLedgerStart);
const updateLedgerBlock = detail.slice(updateLedgerStart, saveLedgerStart);
const saveLedgerEnd = detail.indexOf('const handlePrintReceipt', saveLedgerStart);
const saveLedgerBlock = detail.slice(saveLedgerStart, saveLedgerEnd);

const updateProjectStart = app.indexOf('const handleUpdateProject');
const paymentStatusStart = app.indexOf('const handlePaymentStatusChange', updateProjectStart);
const updateProjectBlock = app.slice(updateProjectStart, paymentStatusStart);

test('automatic ledger status follows estimate and received amount', () => {
  assert.equal(derivePaymentTrackingStatusFromData({ estimate:5000, ledger:{ amountIn:0 } }), 'Pending');
  assert.equal(derivePaymentTrackingStatusFromData({ estimate:5000, ledger:{ amountIn:2500 } }), 'Pending');
  assert.equal(derivePaymentTrackingStatusFromData({ estimate:5000, ledger:{ amountIn:5000 } }), 'Paid');
  assert.equal(derivePaymentTrackingStatusFromData({ estimate:5000, ledger:{ amountIn:6500 } }), 'Paid');
});

test('payment ledger auto-saves after a short pause and flushes on field exit', () => {
  assert.match(app, /const FINANCE_AUTOSAVE_DELAY_MS = 650/);
  assert.match(detail, /ledgerAutosaveTimerRef/);
  assert.match(detail, /setTimeout\(\(\) => \{/);
  assert.match(detail, /handleSaveLedger\(\{ reason:'automatic' \}\)/);
  assert.match(detail, /onBlur=\{flushFinanceAutosave\}/);
  assert.match(detail, /Automatic save/);
  assert.doesNotMatch(detail, /Save Payment Details/);
  assert.match(saveLedgerBlock, /onUpdateProject\(updatedProject, baseProject, \{/);
  assert.match(saveLedgerBlock, /financeOnly:true/);
});

test('finance-only saves do not perform a second full task write', () => {
  const financeReturn = updateProjectBlock.indexOf('if (financeOnly)');
  const generalTaskSave = updateProjectBlock.indexOf('createTaskApi');
  assert.ok(financeReturn >= 0, 'finance-only return branch is required');
  assert.ok(generalTaskSave > financeReturn, 'full task save must occur only after finance-only branch');
  assert.match(updateProjectBlock, /return updatedProject;/);
  assert.match(updateProjectBlock, /financeSaveInFlightRef/);
});

test('finance API uses one mutation id and a bounded deadline without parallel retries', () => {
  assert.match(taskService, /const FINANCE_WRITE_TIMEOUT_MS = 45 \* 1000/);
  assert.match(taskService, /mutationId/);
  assert.match(taskService, /FINANCE_SAVE_TIMEOUT/);
  assert.doesNotMatch(taskService, /for \(let attempt = 0; attempt < 2/);
});

test('payment receipt uses private file upload instead of embedding base64 in the task', () => {
  const screenshotStart = detail.indexOf('const handleLedgerScreenshot');
  const screenshotEnd = detail.indexOf('const handleAddSubTask', screenshotStart);
  const screenshotBlock = detail.slice(screenshotStart, screenshotEnd);
  assert.match(screenshotBlock, /uploadProjectFile/);
  assert.doesNotMatch(screenshotBlock, /fileToBase64/);
  assert.match(detail, /isUploadingLedgerReceipt/);
});

test('payment navigation never waits for finance and completes queued saves in the background', () => {
  assert.doesNotMatch(detail, /beforeunload/);
  assert.match(detail, /ledgerNavigationDetachedRef/);
  assert.match(detail, /finishFinanceInBackground/);
  assert.match(detail, /handleSaveLedger\(\{ reason:'background-navigation' \}\)/);
  assert.match(detail, /onBack\(\);\s*void Promise\.resolve\(\)\.then\(finishFinanceInBackground\);/);
  assert.doesNotMatch(detail, /Discard finance changes/);
  assert.match(saveLedgerBlock, /backgroundFinanceRef:ledgerNavigationDetachedRef/);
  assert.match(updateProjectBlock, /const isBackgroundFinance = \(\) => options\?\.backgroundFinance === true \|\| options\?\.backgroundFinanceRef\?\.current === true/);
  assert.match(updateProjectBlock, /if \(!isBackgroundFinance\(\)\)/);
  assert.match(updateProjectBlock, /setSelectedProject\(current => current && String\(current\.id \|\| current\.caseId\) === financeTaskKey \? updatedProject : current\)/);
  assert.match(updateProjectBlock, /if \(previousProject && !financeOnly && !isBackgroundFinance\(\)\)/);
  assert.doesNotMatch(updateProjectBlock, /if \(previousProject && !options\?\.backgroundFinance\)/);
  assert.doesNotMatch(updateProjectBlock, /applyProjectSnapshot\(\[previousProject\][\s\S]{0,160}if \(!options\?\.backgroundFinance\)/);
});
