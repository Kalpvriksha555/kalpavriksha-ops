import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  analyzeOperationalSameCountHashDrift,
  auditRelationalIntegrityMetadata,
  canonicalizeCurrentPhysicalIntegrity,
  classifyLegacyShadowIntegrityDrift,
  mergeVerifiedPhysicalCounts,
  reconcileRelationalIntegrityMetadata,
  rebaselineLegacyShadowIntegrity,
  rebaselineOperationalSameCountIntegrity,
  stateSnapshotHash
} from '../../backend/src/repositories/postgresStateRepository.js';

const emptyPersistedState = {
  users:[], cases:[], deletedProjectIds:[], payments:[], performanceRecords:[],
  notifications:[], teamChat:[], whatsappInbox:[], audit:[], attendanceLogs:[], files:[], chatReads:{}
};

const emptyCounts = {
  users:0, cases:0, payments:0, performanceRecords:0, notifications:0,
  teamChat:0, whatsappInbox:0, audit:0, attendanceLogs:0, files:0,
  deletedProjectIds:0, chatReads:0, misc:0
};

function auditPool(metadata) {
  const client = {
    async query(sql) {
      const text=String(sql);
      if (text.includes('FROM app_state_metadata')) return { rows:[metadata] };
      if (text.includes('FROM ops_deleted_projects')) return { rows:[] };
      if (text.includes('FROM ops_misc_state')) return { rows:[] };
      if (text.startsWith('SELECT ') && text.includes(' FROM ops_')) return { rows:[] };
      return { rows:[] };
    },
    release() {}
  };
  return { async connect(){ return client; } };
}

test('selected relational writes preserve unrelated metadata counts and replace touched counts with verified physical values',()=>{
  const merged=mergeVerifiedPhysicalCounts({
    metadataCounts:{...emptyCounts,files:1840,cases:428},
    calculatedCounts:{...emptyCounts,files:1842,cases:428},
    physicalCounts:{files:1842},
    selectedCollections:['files']
  });
  assert.equal(merged.files,1842);
  assert.equal(merged.cases,428);
});

test('relational writes fail closed when the in-memory shadow count differs from physical PostgreSQL rows',()=>{
  assert.throws(()=>mergeVerifiedPhysicalCounts({
    metadataCounts:{...emptyCounts,files:1840},
    calculatedCounts:{...emptyCounts,files:1840},
    physicalCounts:{files:1842},
    selectedCollections:['files']
  }),error=>error?.code==='RELATIONAL_SHADOW_DIVERGENCE' && error.collections.includes('files'));
});

test('count-only metadata drift is classified safe only when the canonical physical-row hash still matches',async()=>{
  const audit=await auditRelationalIntegrityMetadata(auditPool({
    state_version:437,
    entity_counts:{...emptyCounts,files:2},
    snapshot_hash:stateSnapshotHash(emptyPersistedState),
    source:'relational',
    updated_at:new Date().toISOString()
  }));
  assert.equal(audit.healthy,false);
  assert.equal(audit.safeCountMetadataDrift,true);
  assert.deepEqual(audit.countMismatches,['files']);
  assert.equal(audit.hashMatches,true);
});


test('reconciliation updates only entity-count metadata and records an auditable event',async()=>{
  const queries=[];
  const metadata={
    state_version:437,
    entity_counts:{...emptyCounts,files:2},
    snapshot_hash:stateSnapshotHash(emptyPersistedState),
    source:'relational',
    updated_at:new Date().toISOString()
  };
  const client={
    async query(sql,params=[]){
      const text=String(sql); queries.push({text,params});
      if(text.includes('FROM app_state_metadata')) return {rows:[metadata]};
      if(text.includes('FROM ops_deleted_projects')) return {rows:[]};
      if(text.includes('FROM ops_misc_state')) return {rows:[]};
      if(text.startsWith('SELECT ') && text.includes(' FROM ops_')) return {rows:[]};
      return {rows:[]};
    },
    release(){}
  };
  const result=await reconcileRelationalIntegrityMetadata({async connect(){return client;}},{
    allowedCollections:['files'],backupManifest:'/verified/backup.manifest.json'
  });
  assert.equal(result.reconciled,true);
  const update=queries.find(item=>item.text.includes('UPDATE app_state_metadata'));
  assert.ok(update);
  assert.match(update.text,/SET entity_counts=/);
  assert.doesNotMatch(update.text,/snapshot_hash=/);
  assert.doesNotMatch(update.text,/state_version=/);
  assert.equal(JSON.parse(update.params[1]).files,0);
  const event=queries.find(item=>item.text.includes('RELATIONAL_COUNT_METADATA_RECONCILED'));
  assert.ok(event);
});

test('deployment reconciles only hash-verified count metadata after backup and before strict integrity',()=>{
  const deploy=fs.readFileSync(new URL('../../scripts/deploy-1.9.24-vps.sh',import.meta.url),'utf8');
  const matrix=fs.readFileSync(new URL('../../scripts/full-release-verifier-matrix.mjs',import.meta.url),'utf8');
  const repairScript=fs.readFileSync(new URL('../../backend/scripts/db-integrity-repair.mjs',import.meta.url),'utf8');
  const backendPkg=JSON.parse(fs.readFileSync(new URL('../../backend/package.json',import.meta.url),'utf8'));
  assert.match(matrix,/id:'production-integrity-audit'/);
  assert.match(repairScript,/REPAIR VERIFIED LEGACY INTEGRITY METADATA/);
  assert.match(repairScript,/verifyManifest\(manifestPath, \{ verifyContents:true \}\)/);
  assert.match(repairScript,/before\.legacyShadowRebaselineSafe/);
  assert.match(repairScript,/recent verified full backup/);
  assert.equal(backendPkg.scripts['db:integrity:audit'],'node scripts/db-integrity-audit.mjs');
  assert.equal(backendPkg.scripts['db:integrity:repair'],'node scripts/db-integrity-repair.mjs');
  const migrate=deploy.indexOf('npm run db:migrate --prefix backend');
  const repair=deploy.indexOf('npm run db:integrity:repair --prefix backend');
  const strict=deploy.indexOf('npm run db:integrity --prefix backend');
  assert.ok(migrate>=0 && repair>migrate && strict>repair);
  assert.match(deploy,/ROLLBACK_SCRIPT="\$ROLLBACK_CWD\/\$OLD_RELATIVE_SCRIPT"/);
});


test('known legacy normalized-shadow drift is narrowly classified for guarded rebaseline',()=>{
  assert.equal(classifyLegacyShadowIntegrityDrift({
    expectedCounts:{...emptyCounts,files:1914,performanceRecords:416},
    actualCounts:{...emptyCounts,files:1842,performanceRecords:368},
    countMismatches:['files','performanceRecords'],
    expectedHash:'old-hash',actualHash:'physical-hash',source:'relational'
  }),true);
  assert.equal(classifyLegacyShadowIntegrityDrift({
    expectedCounts:{...emptyCounts,cases:429},actualCounts:{...emptyCounts,cases:428},
    countMismatches:['cases'],expectedHash:'a',actualHash:'b',source:'relational'
  }),false);
});


test('legacy shadow rebaseline changes only metadata, revision evidence, and audit event',async()=>{
  const queries=[];
  const metadata={
    state_version:437,
    entity_counts:{...emptyCounts,files:72,performanceRecords:48},
    snapshot_hash:'legacy-normalized-shadow-hash',
    source:'relational',
    updated_at:new Date().toISOString()
  };
  const client={
    async query(sql,params=[]){
      const text=String(sql); queries.push({text,params});
      if(text.includes('FROM app_state_metadata')) return {rows:[metadata]};
      if(text.includes('FROM ops_deleted_projects')) return {rows:[]};
      if(text.includes('FROM ops_misc_state')) return {rows:[]};
      if(text.startsWith('SELECT ') && text.includes(' FROM ops_')) return {rows:[]};
      return {rows:[]};
    },
    release(){}
  };
  const result=await rebaselineLegacyShadowIntegrity({async connect(){return client;}},{backupManifest:'/verified/full.manifest.json'});
  assert.equal(result.rebaselined,true);
  assert.equal(result.previousStateVersion,437);
  assert.equal(result.stateVersion,438);
  assert.deepEqual(result.countMismatches.sort(),['files','performanceRecords']);
  const revision=queries.find(item=>item.text.includes('INSERT INTO state_revisions'));
  assert.ok(revision);
  const update=queries.find(item=>item.text.includes('UPDATE app_state_metadata'));
  assert.ok(update);
  assert.match(update.text,/state_version=\$2/);
  assert.match(update.text,/snapshot_hash=\$3/);
  assert.equal(update.params[1],438);
  const event=queries.find(item=>item.text.includes('RELATIONAL_LEGACY_SHADOW_REBASELINED'));
  assert.ok(event);
});


test('frozen current physical canonicalization trusts verified PostgreSQL rows without rewriting business collections',async()=>{
  const queries=[];
  const metadata={
    state_version:451,
    entity_counts:{...emptyCounts},
    snapshot_hash:'stale-runtime-hash',
    source:'relational',
    updated_at:new Date().toISOString()
  };
  const client={
    async query(sql,params=[]){
      const text=String(sql); queries.push({text,params});
      if(text.includes('FROM app_state_metadata')) return {rows:[metadata]};
      if(text.includes('count(*)::int FROM ops_')) return {rows:[{...emptyCounts}]};
      if(text.includes('FROM ops_deleted_projects')) return {rows:[]};
      if(text.includes('FROM ops_misc_state')) return {rows:[]};
      if(text.startsWith('SELECT ') && text.includes(' FROM ops_')) return {rows:[]};
      return {rows:[]};
    },
    release(){}
  };
  const result=await canonicalizeCurrentPhysicalIntegrity(
    {async connect(){return client;}},
    {backupManifest:'/verified/current-full.manifest.json',expectedStateVersion:451}
  );
  assert.equal(result.canonicalized,true);
  assert.equal(result.previousStateVersion,451);
  assert.equal(result.stateVersion,452);
  assert.equal(result.operationalRowsChanged,false);
  assert.equal(result.snapshotHash,stateSnapshotHash(emptyPersistedState));
  assert.ok(queries.some(item=>item.text.includes('LOCK TABLE ops_users')));
  assert.ok(queries.some(item=>item.text.includes('current_physical_integrity_canonicalization')));
  assert.ok(queries.some(item=>item.text.includes('relational_current_physical_canonicalized')));
  assert.ok(queries.some(item=>item.text.includes('RELATIONAL_CURRENT_PHYSICAL_CANONICALIZED')));
  const businessWrites=queries.filter(item=>/^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+ops_/i.test(item.text));
  assert.deepEqual(businessWrites,[]);
});

test('same-count hash drift is repairable only when verified revision differences are presence, current-day attendance, and append-only audit',()=>{
  const nowMs = new Date('2026-08-01T20:05:00.000Z').getTime();
  const revisionState = {
    ...emptyPersistedState,
    users:[{ id:'u1', name:'Designer', role:'Designer', status:'APPROVED', isOnline:false, availability:'Unavailable', lastSeenAt:nowMs - 600000 }],
    attendanceLogs:[{ id:'u1_2026-08-02', userId:'u1', name:'Designer', role:'Designer', date:'2026-08-02', loginAt:nowMs - 1800000, activeMinutes:10, lastTick:nowMs - 600000 }],
    audit:[{ id:'a1', at:'2026-08-01T19:30:00.000Z', by:'system', action:'Existing event', entity:'u1' }]
  };
  const currentState = structuredClone(revisionState);
  Object.assign(currentState.users[0], { isOnline:true, availability:'Available', lastSeenAt:nowMs, lastHeartbeatAt:nowMs, availabilityUpdatedAt:nowMs });
  Object.assign(currentState.attendanceLogs[0], { activeMinutes:20, totalLoggedInMinutes:20, lastTick:nowMs, logoutAt:nowMs, status:'Online', isOnline:true });
  currentState.audit.unshift({ id:'a2', at:'2026-08-01T20:02:29.840Z', by:'Admin', action:'Presence-safe event', entity:'u1' });
  const counts = { ...emptyCounts, users:1, attendanceLogs:1, audit:2 };
  const revisionCounts = { ...emptyCounts, users:1, attendanceLogs:1, audit:1 };
  const safe = analyzeOperationalSameCountHashDrift({
    expectedCounts:counts,
    actualCounts:counts,
    countMismatches:[],
    expectedHash:'stale-metadata-hash',
    actualHash:stateSnapshotHash(currentState),
    source:'relational',
    currentState,
    currentVersion:441,
    revisionState,
    revisionVersion:438,
    revisionHash:stateSnapshotHash(revisionState),
    revisionCounts,
    revisionCreatedAt:'2026-08-01T19:35:26.611Z',
    nowMs
  });
  assert.equal(safe.safe,true);
  assert.equal(safe.addedAuditRows,1);

  const staleRevisionCountMetadata = analyzeOperationalSameCountHashDrift({
    expectedCounts:counts,
    actualCounts:counts,
    countMismatches:[],
    expectedHash:'stale-metadata-hash',
    actualHash:stateSnapshotHash(currentState),
    source:'relational',
    currentState,
    currentVersion:441,
    revisionState,
    revisionVersion:438,
    revisionHash:stateSnapshotHash(revisionState),
    revisionCounts:{ ...revisionCounts, audit:999, performanceRecords:41 },
    revisionCreatedAt:'2026-08-01T19:35:26.611Z',
    nowMs
  });
  assert.equal(staleRevisionCountMetadata.safe,true);
  assert.deepEqual(staleRevisionCountMetadata.revisionCountMetadataMismatches.sort(),['audit','performanceRecords']);
  assert.equal(staleRevisionCountMetadata.verifiedRevisionCounts.audit,1);

  const financeRevision = structuredClone(revisionState);
  financeRevision.cases = [{ id:'case-1', caseId:'KV-1', status:'Completed', client:'Client', financeVersion:1, ledger:{ amountIn:0 }, history:[], timeline:[], paymentAuditTrail:[] }];
  financeRevision.payments = [{ id:'pay-1', source:'INLINE_PAYMENT_STATUS', caseId:'case-1', paymentAmountIn:0 }];
  const financeCurrent = structuredClone(financeRevision);
  Object.assign(financeCurrent.cases[0], {
    financeVersion:2,
    paymentTrackingStatus:'Paid',
    paymentAmountIn:5000,
    paymentStatus:'YES',
    paymentReceived:'YES',
    ledger:{ amountIn:5000, financeLedgerId:'pay-1', status:'Paid' },
    history:[{ id:'h2', action:'Finance updated for 2026-08: Paid' }],
    timeline:[{ id:'t2', type:'payment_updated', title:'Payment Paid' }],
    paymentAuditTrail:[{ id:'pa2', action:'Payment status updated', newAmount:5000 }]
  });
  Object.assign(financeCurrent.payments[0], { paymentAmountIn:5000, updatedAt:'2026-08-01T20:02:29.840Z' });
  financeCurrent.audit = [...financeRevision.audit, { id:'a-fin', action:'Finance updated for 2026-08: Paid' }];
  const financeCounts = { ...counts, cases:1, payments:1 };
  const financeRevisionCounts = { ...revisionCounts, cases:1, payments:1 };
  const financeSafe = analyzeOperationalSameCountHashDrift({
    expectedCounts:financeCounts,
    actualCounts:financeCounts,
    countMismatches:[],
    expectedHash:'stale-finance-hash',
    actualHash:stateSnapshotHash(financeCurrent),
    source:'relational',
    currentState:financeCurrent,
    currentVersion:441,
    revisionState:financeRevision,
    revisionVersion:438,
    revisionHash:stateSnapshotHash(financeRevision),
    revisionCounts:financeRevisionCounts,
    revisionCreatedAt:'2026-08-01T19:35:26.611Z',
    nowMs
  });
  assert.equal(financeSafe.safe,true);
  assert.deepEqual(financeSafe.financeCaseRows,['case-1']);

  const unsafeState = structuredClone(currentState);
  unsafeState.cases.push({ id:'case-unsafe', status:'Completed' });
  const unsafe = analyzeOperationalSameCountHashDrift({
    expectedCounts:{...counts,cases:1},
    actualCounts:{...counts,cases:1},
    countMismatches:[],
    expectedHash:'stale-metadata-hash',
    actualHash:stateSnapshotHash(unsafeState),
    source:'relational',
    currentState:unsafeState,
    currentVersion:441,
    revisionState,
    revisionVersion:438,
    revisionHash:stateSnapshotHash(revisionState),
    revisionCounts,
    revisionCreatedAt:'2026-08-01T19:35:26.611Z',
    nowMs
  });
  assert.equal(unsafe.safe,false);
  assert.equal(unsafe.reason,'non-finance-case-data-changed');
});

test('deployment repair includes evidence-bounded same-count operational rebaseline',()=>{
  const auditScript=fs.readFileSync(new URL('../../backend/scripts/db-integrity-audit.mjs',import.meta.url),'utf8');
  const repairScript=fs.readFileSync(new URL('../../backend/scripts/db-integrity-repair.mjs',import.meta.url),'utf8');
  const deploy=fs.readFileSync(new URL('../../scripts/deploy-1.9.24-vps.sh',import.meta.url),'utf8');
  assert.match(auditScript,/OPERATIONAL_SAME_COUNT_REBASELINE_REQUIRED/);
  assert.match(repairScript,/rebaselineOperationalSameCountIntegrity/);
  assert.match(repairScript,/before\.operationalSameCountRebaselineSafe/);
  assert.match(deploy,/operationalSameCountRebaselineSafe/);
  assert.equal(typeof rebaselineOperationalSameCountIntegrity,'function');
});

test('selected relational writes verify exact physical payloads before integrity metadata is committed',()=>{
  const repository=fs.readFileSync(new URL('../../backend/src/repositories/postgresStateRepository.js',import.meta.url),'utf8');
  const syncIndex=repository.indexOf('await syncRelationalParts');
  const verifyIndex=repository.indexOf('await verifySelectedRowsPhysicallyPersisted',syncIndex);
  const metadataIndex=repository.indexOf('UPDATE app_state_metadata',verifyIndex);
  assert.ok(syncIndex >= 0 && verifyIndex > syncIndex && metadataIndex > verifyIndex);
  assert.match(repository,/RELATIONAL_SELECTED_ROW_MISMATCH/);
  assert.match(repository,/JSON\.parse\(JSON\.stringify\(expected\.payload\)\)/);
});

