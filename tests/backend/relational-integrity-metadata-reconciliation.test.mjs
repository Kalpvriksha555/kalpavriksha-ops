import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  auditRelationalIntegrityMetadata,
  mergeVerifiedPhysicalCounts,
  reconcileRelationalIntegrityMetadata,
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
  const reconcile=fs.readFileSync(new URL('../../backend/scripts/db-integrity-reconcile.mjs',import.meta.url),'utf8');
  const backendPkg=JSON.parse(fs.readFileSync(new URL('../../backend/package.json',import.meta.url),'utf8'));
  assert.match(matrix,/id:'production-integrity-audit'/);
  assert.match(reconcile,/RECONCILE COUNT METADATA ONLY/);
  assert.match(reconcile,/verifyManifest\(manifestPath, \{ verifyContents:true \}\)/);
  assert.match(reconcile,/before\.safeCountMetadataDrift/);
  assert.match(reconcile,/recent verified full backup/);
  assert.equal(backendPkg.scripts['db:integrity:audit'],'node scripts/db-integrity-audit.mjs');
  assert.equal(backendPkg.scripts['db:integrity:reconcile'],'node scripts/db-integrity-reconcile.mjs');
  const migrate=deploy.indexOf('npm run db:migrate --prefix backend');
  const repair=deploy.indexOf('npm run db:integrity:reconcile --prefix backend');
  const strict=deploy.indexOf('npm run db:integrity --prefix backend');
  assert.ok(migrate>=0 && repair>migrate && strict>repair);
  assert.match(deploy,/ROLLBACK_SCRIPT="\$ROLLBACK_CWD\/\$OLD_RELATIVE_SCRIPT"/);
});
