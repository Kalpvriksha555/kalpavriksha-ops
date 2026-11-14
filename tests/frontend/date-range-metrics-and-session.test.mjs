import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {matchesDateRange,dateFilterKey,validDateKey,validDateRange,monthOverlapsDateRange} from '../../frontend/src/utils/dateRangeFilters.js';

const read=path=>fs.readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const app=read('frontend/src/App.jsx');
const archive=read('frontend/src/components/archive/HistoryArchiveView.jsx');
const command=read('frontend/src/components/command-centre/CommandCentreView.jsx');
const operations=read('frontend/src/components/operations/ActiveOperationsView.jsx');

test('inclusive date range includes the last chosen day and accepts reversed/empty bounds safely',()=>{
  assert.equal(validDateKey('2026-02-29'),'');
  assert.equal(validDateKey('2024-02-29'),'2024-02-29');
  assert.equal(validDateRange('2026-11-15','2026-11-14'),false);
  assert.equal(matchesDateRange('2026-11-14','2026-11-01','2026-11-14'),true);
  assert.equal(matchesDateRange('2026-11-15','2026-11-01','2026-11-14'),false);
  assert.equal(matchesDateRange('2026-11-01','2026-11-14','2026-11-01'),false);
  assert.equal(matchesDateRange(null,'2026-11-01','2026-11-14'),false);
  assert.equal(matchesDateRange(null),'true'==='true');
  assert.equal(monthOverlapsDateRange('2026-11','2026-10-15','2026-11-01'),true);
  assert.equal(monthOverlapsDateRange('2026-10','2026-11-01','2026-11-30'),false);
  assert.equal(dateFilterKey('2026-11-14'),'2026-11-14');
});

test('month changes preserve finance bank/location/status and archive selectors',()=>{
  assert.match(app,/const setSelectedMonth = \(value\) => updateFinanceViewState\(\{ selectedMonth: normalizeAccountingMonthKey\(value, selectedMonth\) \}\);/);
  assert.match(app,/const resetLedgerFilters = \(\) => updateFinanceViewState/);
  assert.match(app,/matchesDateRange\(entry\.activityAt, dateFrom, dateTo\)/);
  assert.match(app,/Month Summary|Month Summary|Month Summary/);
  assert.match(archive,/onChange\(\{ filterMonth: event\.target\.value, scrollTop: 0 \}\)/);
  assert.match(archive,/onChange\(\{ filterDate: event\.target\.value, scrollTop: 0 \}\)/);
  assert.match(archive,/getCompletedDateKey\(project\.completedAt\), state\.dateFrom, state\.dateTo/);
  assert.match(archive,/>Reset filters<\/button>/);
});

test('all requested views expose date range and an explicit reset action',()=>{
  assert.match(operations,/Case creation date range/);
  assert.match(operations,/Reset filters/);
  assert.match(app,/operationDateRange\.dateFrom/);
  assert.match(command,/Performance date range/);
  assert.match(command,/Report event date range/);
  assert.match(command,/resetPerformanceFilters/);
  assert.match(command,/setReportDateRange\(\{dateFrom:'',dateTo:''\}\)/);
});

test('temporary filters are in-memory only and clear on restored browser visit',()=>{
  assert.match(app,/window\.addEventListener\('pageshow',resetOnReturn\)/);
  assert.match(app,/if \(!event\.persisted\) return/);
  assert.match(app,/setViewVisitKey\(value=>value\+1\)/);
  assert.match(app,/workspace:\$\{viewVisitKey\}/);
  assert.doesNotMatch(app,/localStorage\.(?:getItem|setItem)\(['"](?:kalpa_finance_filters|kalpa_archive_filters|kalpa_operation_range)/);
});

test('performance scoreboard does not refill a reset zero with old local history',()=>{
  assert.match(command,/const backendLeaderboardReady = Array\.isArray\(leaderboard\?\.members\)/);
  assert.match(command,/const avgMins = backendLeaderboardReady \? summaryAvgCompletion/);
  assert.match(command,/const teamAvgMins = backendLeaderboardReady \? summaryTeamAvg/);
  assert.match(command,/historyCompletedCount: backendLeaderboardReady \?/);
  assert.match(command,/currentUser\?\.role\|\|''\)\.toUpperCase\(\)==='ADMIN'/);
  assert.match(command,/RESET ANALYTICS BASELINE/);
  assert.match(command,/requestConfirmation/);
  assert.match(command,/setLeaderboardRefreshKey\(key=>key\+1\)/);
});
