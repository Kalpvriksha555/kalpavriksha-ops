import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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

test('payment ledger typing remains local until the explicit durable save', () => {
  assert.match(detail, /const \[ledgerDraft, setLedgerDraft\]/);
  assert.match(updateLedgerBlock, /setLedgerDraft/);
  assert.doesNotMatch(updateLedgerBlock, /onUpdateProject/);
  assert.match(detail, /Save Payment Details/);
  assert.match(saveLedgerBlock, /onUpdateProject\(updatedProject, project, \{/);
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

test('unsaved finance data is protected when leaving the page', () => {
  assert.match(detail, /beforeunload/);
  assert.match(detail, /Discard finance changes/);
  assert.match(detail, /onClick=\{handleTaskBack\}/);
});
