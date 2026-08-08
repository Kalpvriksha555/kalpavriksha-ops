import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildProjectMonthlyFinanceEntry,
  formatAccountingMonthLabel,
  getIndiaDateKey,
  getPreviousAccountingMonthKey,
  getProjectCompletedMonthKey,
  getProjectCreatedMonthKey,
  getProjectFinanceMonthKey,
  getTaskDateTimestamp,
  hasRevisionInAccountingMonth,
  normalizeAccountingMonthKey,
  normalizeTaskDateKey
} from '../../frontend/src/utils/accountingPeriodUtils.js';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const reports = fs.readFileSync(new URL('../../frontend/src/components/command-centre/CommandCentreView.jsx', import.meta.url), 'utf8');

test('accounting month normalization uses exact calendar months', () => {
  assert.equal(normalizeAccountingMonthKey('2026-07-31T23:59:00+05:30'), '2026-07');
  assert.equal(normalizeAccountingMonthKey('2026-08-01T00:01:00+05:30'), '2026-08');
  assert.equal(getPreviousAccountingMonthKey('2026-01'), '2025-12');
  assert.equal(formatAccountingMonthLabel('2026-08'), 'August 2026');
});

test('task date defaults to India today and supports a valid previous date', () => {
  const now = new Date('2026-08-01T09:30:00Z').getTime();
  assert.equal(getIndiaDateKey(now), '2026-08-01');
  assert.equal(normalizeTaskDateKey('', getIndiaDateKey(now)), '2026-08-01');
  assert.equal(normalizeTaskDateKey('2026-07-29', getIndiaDateKey(now)), '2026-07-29');
  assert.equal(normalizeTaskDateKey('2026-02-31', getIndiaDateKey(now)), '2026-08-01');
  assert.equal(normalizeTaskDateKey(new Date('2026-07-29T10:00:00+05:30').getTime(), getIndiaDateKey(now)), '2026-07-29');
  assert.equal(getIndiaDateKey(getTaskDateTimestamp('2026-07-29', now)), '2026-07-29');
});

test('malformed finance values never render NaN totals', () => {
  const entry = buildProjectMonthlyFinanceEntry({
    taskDate:'2026-07-10',
    estimate:'not-a-number',
    ledger:{ amountIn:'₹bad', expenses:'NaN', refund:'undefined' },
    paymentAuditTrail:[{ at:'2026-08-01T10:00:00+05:30', oldAmount:'bad', newAmount:'bad' }]
  }, '2026-07');
  for (const value of [entry.estimate, entry.received, entry.expenses, entry.refund, entry.net, entry.pendingAtClose]) {
    assert.equal(Number.isFinite(value), true);
  }
});

test('later payment updates remain in the task creation month', () => {
  const project = {
    id:'CASE-1',
    taskDate:'2026-07-01',
    createdAt:'2026-07-01T10:00:00+05:30',
    estimate:10000,
    financeAccountingPeriod:'2026-08',
    paymentAmountIn:10000,
    ledger:{ amountIn:10000, accountingPeriod:'2026-08', date:'2026-08-05' },
    paymentAuditTrail:[
      { id:'july', at:'2026-07-20T12:00:00+05:30', accountingPeriod:'2026-07', oldAmount:0, newAmount:4000, oldExpenses:0, newExpenses:200 },
      { id:'august-entry', at:'2026-08-05T12:00:00+05:30', accountingPeriod:'2026-08', oldAmount:4000, newAmount:10000, oldExpenses:200, newExpenses:500 }
    ]
  };
  assert.equal(getProjectFinanceMonthKey(project), '2026-07');
  const july = buildProjectMonthlyFinanceEntry(project, '2026-07');
  const august = buildProjectMonthlyFinanceEntry(project, '2026-08');
  assert.equal(july.hasActivity, true);
  assert.equal(july.received, 10000);
  assert.equal(july.expenses, 500);
  assert.equal(july.closingReceived, 10000);
  assert.equal(july.pendingAtClose, 0);
  assert.equal(august.hasActivity, false);
  assert.equal(august.received, 0);
  assert.equal(august.expenses, 0);
});

test('a late legacy correction without its first audit event still replaces the task-month total', () => {
  const project = {
    id:'CASE-LEGACY',
    createdAt:'2026-07-10T10:00:00+05:30',
    estimate:1000,
    ledger:{ amountIn:400, expenses:50, refund:0, date:'2026-08-02' },
    paymentAuditTrail:[
      { id:'late-only', at:'2026-08-02T12:00:00+05:30', oldAmount:500, newAmount:400, oldExpenses:0, newExpenses:50 }
    ]
  };
  const july = buildProjectMonthlyFinanceEntry(project, '2026-07');
  const august = buildProjectMonthlyFinanceEntry(project, '2026-08');
  assert.equal(july.received, 400);
  assert.equal(july.expenses, 50);
  assert.equal(july.pendingAtClose, 600);
  assert.equal(august.hasActivity, false);
});

test('reports assign creation completion and revision activity to their own month', () => {
  const project = {
    createdAt:'2026-07-31T23:30:00+05:30',
    completedAt:'2026-08-01T09:00:00+05:30',
    revisions:[{ createdAt:'2026-08-02T09:00:00+05:30' }]
  };
  assert.equal(getProjectCreatedMonthKey(project), '2026-07');
  assert.equal(getProjectCompletedMonthKey(project), '2026-08');
  assert.equal(hasRevisionInAccountingMonth(project, '2026-08'), true);
});

test('payment ledger performs cached monthly derivation and bounded rendering', () => {
  const start = app.indexOf('const LedgerView');
  const end = app.indexOf('const TaskDetailView', start);
  const block = app.slice(start, end);
  assert.match(block, /const baseLedgerProjects = useMemo/);
  assert.match(block, /const financeEntryCache = useMemo\(\(\) => new WeakMap\(\)/);
  assert.match(block, /if \(activeTab !== 'audit'\) return \[\]/);
  assert.match(block, /if \(activeTab !== 'monthly'\) return \{\}/);
  assert.match(block, /const ledgerPageSize = 50/);
  assert.match(block, /pagedLedgerProjects/);
  assert.match(block, /Previous-month outstanding is kept separate/);
  assert.match(app, /const finiteLedgerAmount = \(value\) =>/);
  assert.match(block, /Financial_Ledger_\$\{selectedMonth\}\.csv/);
});

test('create-task form defaults task date to today and permits only previous dates', () => {
  const start = app.indexOf('Log New Case');
  const block = app.slice(start);
  assert.match(block, /name="taskDate"/);
  assert.match(block, /defaultValue=\{getIndiaDateKey\(\)\}/);
  assert.match(block, /max=\{getIndiaDateKey\(\)\}/);
  assert.match(block, /taskAccountingPeriod/);
  assert.match(block, /Task date cannot be in the future/);
});

test('reports use one selected month and contain no rolling 30-day scope', () => {
  const start = reports.indexOf('export const ReportsAnalyticsView');
  const end = reports.indexOf('export const ProductionQAView', start);
  const block = reports.slice(start, end);
  assert.match(block, /useState\(getCurrentAccountingMonthKey\(\)\)/);
  assert.match(block, /type="month"/);
  assert.match(block, /getProjectCreatedMonthKey\(project\) === accountingMonth/);
  assert.match(block, /getProjectCompletedMonthKey\(project\) === accountingMonth/);
  assert.match(block, /getAccountingMonthEndTimestamp\(accountingMonth\)/);
  assert.doesNotMatch(block, /30 \* 86400000/);
  assert.match(block, /previous-month data is never mixed/);
});
