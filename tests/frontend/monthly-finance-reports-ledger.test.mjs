import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildProjectMonthlyFinanceEntry,
  formatAccountingMonthLabel,
  getPreviousAccountingMonthKey,
  getProjectCompletedMonthKey,
  getProjectCreatedMonthKey,
  hasRevisionInAccountingMonth,
  normalizeAccountingMonthKey
} from '../../frontend/src/utils/accountingPeriodUtils.js';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const reports = fs.readFileSync(new URL('../../frontend/src/components/command-centre/CommandCentreView.jsx', import.meta.url), 'utf8');

test('accounting month normalization uses exact calendar months', () => {
  assert.equal(normalizeAccountingMonthKey('2026-07-31T23:59:00+05:30'), '2026-07');
  assert.equal(normalizeAccountingMonthKey('2026-08-01T00:01:00+05:30'), '2026-08');
  assert.equal(getPreviousAccountingMonthKey('2026-01'), '2025-12');
  assert.equal(formatAccountingMonthLabel('2026-08'), 'August 2026');
});

test('payments added in a new month do not rewrite the previous month totals', () => {
  const project = {
    id:'CASE-1',
    createdAt:'2026-07-01T10:00:00+05:30',
    estimate:10000,
    financeAccountingPeriod:'2026-08',
    paymentAmountIn:10000,
    ledger:{ amountIn:10000, accountingPeriod:'2026-08', date:'2026-08-05' },
    paymentAuditTrail:[
      { id:'july', at:'2026-07-20T12:00:00+05:30', accountingPeriod:'2026-07', oldAmount:0, newAmount:4000, oldExpenses:0, newExpenses:200 },
      { id:'august', at:'2026-08-05T12:00:00+05:30', accountingPeriod:'2026-08', oldAmount:4000, newAmount:10000, oldExpenses:200, newExpenses:500 }
    ]
  };
  const july = buildProjectMonthlyFinanceEntry(project, '2026-07');
  const august = buildProjectMonthlyFinanceEntry(project, '2026-08');
  assert.equal(july.received, 4000);
  assert.equal(july.expenses, 200);
  assert.equal(july.closingReceived, 4000);
  assert.equal(july.pendingAtClose, 6000);
  assert.equal(august.received, 6000);
  assert.equal(august.expenses, 300);
  assert.equal(august.closingReceived, 10000);
  assert.equal(august.pendingAtClose, 0);
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
  assert.match(block, /Financial_Ledger_\$\{selectedMonth\}\.csv/);
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
