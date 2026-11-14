import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const server=fs.readFileSync(new URL('../../backend/src/server.js',import.meta.url),'utf8');
const resetStart=server.indexOf("app.post('/api/performance/baselines/reset'");
const resetEnd=server.indexOf("\napp.post('/api/performance/rebuild'",resetStart);
assert.ok(resetStart>0 && resetEnd>resetStart,'analytics reset route must exist before performance rebuild');
const resetRoute=server.slice(resetStart,resetEnd);
const helperStart=server.indexOf('function validPerformanceDateKey(');
const helperEnd=server.indexOf('function performanceBaselineDetails(',helperStart);
const eventStart=server.indexOf('function performanceEventMatchesScope(');
const eventEnd=server.indexOf('function latestPerformanceDocumentTime(',eventStart);
assert.ok(helperStart>0&&helperEnd>helperStart&&eventStart>helperEnd&&eventEnd>eventStart,'performance scope date helpers not found');
const sandbox={
  Date,Number,Math,String,Boolean,
  serverTodayKey:(ms)=>new Date(ms+330*60000).toISOString().slice(0,10),
  serverMonthKey:(ms=Date.now())=>new Date(ms+330*60000).toISOString().slice(0,7),
  normalizePerformanceMonthKey:(key)=>key||'2026-11',
  performanceRangeMs:key=>key==='week'?7*86400000:30*86400000,
  parseDateMs:(at)=>new Date(at).getTime()
};
vm.createContext(sandbox);
vm.runInContext(server.slice(helperStart,helperEnd)+server.slice(eventStart,eventEnd),sandbox);
test('custom performance range is inclusive of the selected ending day in India',()=>{
  const scope=sandbox.performanceScopeConfig({scope:'custom',from:'2026-11-01',to:'2026-11-14'});
  assert.equal(scope.scope,'custom');
  assert.equal(sandbox.performanceEventMatchesScope('2026-11-01T00:00:00+05:30',scope),true);
  assert.equal(sandbox.performanceEventMatchesScope('2026-11-14T23:59:59+05:30',scope),true);
  assert.equal(sandbox.performanceEventMatchesScope('2026-11-15T00:00:00+05:30',scope),false);
  assert.equal(sandbox.performanceEventMatchesScope('2026-10-31T23:59:59+05:30',scope),false);
});
test('invalid and reversed date ranges fail closed',()=>{
  for(const input of [
    {from:'2026-11-14',to:'2026-11-01'},
    {from:'2026-02-30',to:'2026-11-14'},
    {from:'',to:'2026-11-14'}
  ])assert.throws(()=>sandbox.performanceScopeConfig({scope:'custom',...input}),/Invalid custom performance date range/);
  assert.match(server,/PERFORMANCE_DATE_RANGE_INVALID/);
});
test('analytics reset is admin-only, explicit, auditable and cannot erase critical collections',()=>{
  assert.match(resetRoute,/requireAdminSession/);
  assert.match(resetRoute,/RESET ANALYTICS BASELINE/);
  assert.match(resetRoute,/scope === 'all' \? approved/);
  assert.match(resetRoute,/Manager','Designer/);
  assert.match(resetRoute,/scoreBaselineAt:stamp/);
  assert.match(resetRoute,/collections:\['users','audit'\]/);
  assert.match(resetRoute,/addAudit\(/);
  assert.match(resetRoute,/performance_baseline_reset/);
  assert.match(resetRoute,/skipRevisionSnapshot:true/);
  for(const protectedCollection of ['cases','payments','attendanceLogs','files','performanceRecords','chatMessages']){
    assert.doesNotMatch(resetRoute,new RegExp('d\\.'+protectedCollection+'\\s*='));
  }
  assert.doesNotMatch(resetRoute,/deleteCase|deletePayment|deleteFile|truncate|drop table|rmSync|DELETE FROM/i);
});
