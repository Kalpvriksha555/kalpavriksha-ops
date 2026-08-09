import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFileRetentionToState,
  financialFileReferenceSets,
  isFinancialRetentionProtected,
  shouldExpireFile
} from '../../backend/src/services/storageRetentionService.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-09T00:00:00Z');
const OLD = NOW - 91 * DAY;
const NEW = NOW - 30 * DAY;

test('ordinary uploaded files expire after 90 days while parent records remain', () => {
  const state={
    files:[{id:'old-pdf',storageKey:'objects/a/old',purpose:'SOURCE',uploadedAt:OLD,storageStatus:'AVAILABLE',url:'/x',previewUrl:'/p',downloadUrl:'/d'}],
    cases:[{id:'case-1',documents:[{id:'old-pdf',storageKey:'objects/a/old',purpose:'SOURCE',uploadedAt:OLD,storageStatus:'AVAILABLE',url:'/x'}]}],
    teamChat:[],payments:[]
  };
  const result=applyFileRetentionToState(state,{nowMs:NOW,retentionDays:90});
  assert.deepEqual(result.expiredIds,['old-pdf']);
  assert.equal(state.files[0].storageStatus,'EXPIRED');
  assert.equal(state.files[0].url,'');
  assert.equal(state.cases.length,1);
  assert.equal(state.cases[0].documents.length,1);
  assert.equal(state.cases[0].documents[0].storageStatus,'EXPIRED');
});

test('finance and bank-ledger evidence never expires under ordinary file retention', () => {
  const state={
    files:[
      {id:'receipt',storageKey:'objects/f/receipt',purpose:'PAYMENT_RECEIPT',uploadedAt:OLD,storageStatus:'AVAILABLE'},
      {id:'ledger-linked',storageKey:'objects/f/ledger',purpose:'SOURCE',uploadedAt:OLD,storageStatus:'AVAILABLE'},
      {id:'ordinary',storageKey:'objects/o/ordinary',purpose:'SOURCE',uploadedAt:OLD,storageStatus:'AVAILABLE'}
    ],
    cases:[{id:'case-1',ledger:{screenshot:{id:'ledger-linked',storageKey:'objects/f/ledger'}}}],
    payments:[{id:'payment-1',receiptFileId:'receipt'}],teamChat:[]
  };
  const refs=financialFileReferenceSets(state);
  assert.equal(isFinancialRetentionProtected(state.files[0],refs),true);
  assert.equal(isFinancialRetentionProtected(state.files[1],refs),true);
  const result=applyFileRetentionToState(state,{nowMs:NOW,retentionDays:90});
  assert.deepEqual(result.expiredIds,['ordinary']);
  assert.equal(state.files[0].storageStatus,'AVAILABLE');
  assert.equal(state.files[1].storageStatus,'AVAILABLE');
});

test('profile images and young or unknown-age files are retained', () => {
  const state={files:[
    {id:'profile',purpose:'PROFILE',uploadedAt:OLD,storageStatus:'AVAILABLE'},
    {id:'young',purpose:'SOURCE',uploadedAt:NEW,storageStatus:'AVAILABLE'},
    {id:'unknown',purpose:'SOURCE',storageStatus:'AVAILABLE'}
  ],cases:[],payments:[],teamChat:[]};
  const result=applyFileRetentionToState(state,{nowMs:NOW,retentionDays:90});
  assert.equal(result.expiredIds.length,0);
  assert.equal(result.unknownAgeIds.includes('unknown'),true);
  assert.equal(shouldExpireFile(state.files[1],{nowMs:NOW,retentionDays:90,references:financialFileReferenceSets(state)}),false);
});

test('recoverable trash is permanently purged only after its safety window', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createFileStorage } = await import('../../backend/src/services/fileStorageService.js');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kv-retention-trash-'));
  try {
    const storage=createFileStorage({root,trashRetentionMs:DAY});
    const dated=path.join(storage.trashRoot,'2026-01-01');
    fs.mkdirSync(dated,{recursive:true});
    const payload=path.join(dated,'old-object.pdf');
    fs.writeFileSync(payload,'expired');
    const oldTime=new Date(NOW - 2 * DAY);
    fs.utimesSync(payload,oldTime,oldTime);
    const result=storage.pruneTrash(NOW);
    assert.equal(result.deletedFiles,1);
    assert.equal(fs.existsSync(payload),false);
    assert.ok(result.freedBytes > 0);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
