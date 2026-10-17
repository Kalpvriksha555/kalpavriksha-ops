import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFileRetentionToState, caseRetentionAnchorMs, financialFileReferenceSets,
  isFinancialRetentionProtected, shouldExpireFile
} from '../../backend/src/services/storageRetentionService.js';

const NOW = Date.parse('2026-10-17T00:00:00Z');
const FILE = {id:'file-1',caseId:'case-1',storageKey:'objects/sample/hash',purpose:'SOURCE',
  uploadedAt:'2026-06-01T00:00:00Z',storageStatus:'AVAILABLE',url:'/download',previewUrl:'/preview'};
const completedCase = (changes={}) => ({
  id:'case-1',caseId:'K-123',status:'COMPLETED',completedAt:'2026-08-16T12:00:00Z',
  title:'Protected case details',history:[{action:'Completed'}],
  documents:[{id:FILE.id,storageKey:FILE.storageKey,url:'/download'}],...changes
});
const stateFor = (changes={}) => ({files:[{...FILE}],cases:[completedCase()],
  teamChat:[],payments:[],...changes});

test('two calendar months after completion: attachment expires, case and financial data remain',()=>{
  const state=stateFor({payments:[{id:'payment-1',amount:5000}]});
  const before=structuredClone(state.cases[0].history);
  const result=applyFileRetentionToState(state,{nowMs:NOW,retentionMonths:2});
  assert.deepEqual(result.expiredIds,['file-1']);
  assert.equal(state.files[0].storageStatus,'EXPIRED');
  assert.equal(state.files[0].url,'');
  assert.equal(state.cases[0].documents[0].storageStatus,'EXPIRED');
  assert.equal(state.cases[0].title,'Protected case details');
  assert.deepEqual(state.cases[0].history,before);
  assert.equal(state.payments[0].amount,5000);
});

test('dry run plans eligible removals without changing a single record',()=>{
  const state=stateFor();
  const before=structuredClone(state);
  const result=applyFileRetentionToState(state,{nowMs:NOW,dryRun:true});
  assert.deepEqual(result.expiredIds,['file-1']);
  assert.deepEqual(state,before);
});

test('active or reopened cases retain files regardless of upload age',()=>{
  for(const status of ['ASSIGNED','IN_PROGRESS','REOPENED_FOR_REVISION','REVISION_REQUIRED','MANAGER_REVIEW']){
    const state=stateFor({cases:[completedCase({status})]});
    assert.equal(shouldExpireFile(state.files[0],{state,nowMs:NOW}),false,status);
  }
});


test('archived marker cannot override an active or reopened status',()=>{
  for(const status of ['IN_PROGRESS','ASSIGNED','REOPENED_FOR_REVISION']){
    const state=stateFor({cases:[completedCase({status,archived:true,archivedAt:'2026-01-01T00:00:00Z'})]});
    assert.equal(shouldExpireFile(state.files[0],{state,nowMs:NOW}),false,status);
  }
});

test('completion/approval/archive without trustworthy timestamp does not expire',()=>{
  for(const record of [
    completedCase({completedAt:null}),completedCase({status:'APPROVED',completedAt:null,approvedAt:'2026-01-01T00:00:00Z'}),
    completedCase({status:'ARCHIVED',completedAt:null,archivedAt:null})
  ]) {
    const state=stateFor({cases:[record]});
    assert.equal(shouldExpireFile(state.files[0],{state,nowMs:NOW}),false);
  }
});

test('archive can start two-month clock; the later archive date wins',()=>{
  const state=stateFor({cases:[completedCase({archived:true,archivedAt:'2026-09-01T00:00:00Z'})]});
  assert.equal(shouldExpireFile(state.files[0],{state,nowMs:NOW}),false);
  assert.equal(shouldExpireFile(state.files[0],{state,nowMs:Date.parse('2026-11-01T00:00:00Z')}),true);
});

test('two calendar months respects month-end rather than fixed 60 days',()=>{
  const state=stateFor({cases:[completedCase({completedAt:'2026-12-31T12:00:00Z'})]});
  assert.equal(shouldExpireFile(state.files[0],{state,nowMs:Date.parse('2027-02-28T11:59:00Z')}),false);
  assert.equal(shouldExpireFile(state.files[0],{state,nowMs:Date.parse('2027-02-28T12:00:00Z')}),true);
});

test('recent uploads after case closure get two full calendar months',()=>{
  const state=stateFor({files:[{...FILE,uploadedAt:'2026-10-01T00:00:00Z'}]});
  assert.equal(shouldExpireFile(state.files[0],{state,nowMs:NOW}),false);
});

test('finance/payment/ledger and profile files remain protected',()=>{
  const state=stateFor({files:[
    {...FILE,id:'receipt',storageKey:'objects/f/receipt',purpose:'PAYMENT_RECEIPT'},
    {...FILE,id:'ledger',storageKey:'objects/f/ledger'},
    {...FILE,id:'profile',storageKey:'objects/f/profile',purpose:'PROFILE'}
  ],cases:[completedCase({ledger:{screenshot:{id:'ledger',storageKey:'objects/f/ledger'}}})],
  payments:[{id:'payment-1',receiptFileId:'receipt'}]});
  const refs=financialFileReferenceSets(state);
  assert.equal(isFinancialRetentionProtected(state.files[1],refs),true);
  assert.deepEqual(applyFileRetentionToState(state,{nowMs:NOW}).expiredIds,[]);
});

test('disputes, legal holds and active linked cases prevent expiry',()=>{
  const variants=[{legalHold:true},{disputeStatus:'OPEN'},{openDispute:true},{retentionHold:true}];
  for(const item of variants){
    const state=stateFor({cases:[completedCase(item)]});
    assert.equal(shouldExpireFile(state.files[0],{state,nowMs:NOW}),false,JSON.stringify(item));
  }
  const shared=stateFor({cases:[completedCase(),completedCase({id:'case-2',caseId:'case-2',status:'IN_PROGRESS',completedAt:null})]});
  assert.equal(shouldExpireFile(shared.files[0],{state:shared,nowMs:NOW}),false);
});

test('shared chat attachment and unassociated files are retained safely',()=>{
  const chat=stateFor({teamChat:[{id:'chat-1',files:[{id:'file-1',storageKey:FILE.storageKey}]}]});
  assert.equal(shouldExpireFile(chat.files[0],{state:chat,nowMs:NOW}),false);
  const unknown=stateFor({cases:[],files:[{...FILE,caseId:'missing-case'}]});
  assert.equal(shouldExpireFile(unknown.files[0],{state:unknown,nowMs:NOW}),false);
});

test('case anchor does not infer close time from generic updatedAt',()=>{
  assert.equal(caseRetentionAnchorMs({status:'CLOSED',updatedAt:'2026-01-01T00:00:00Z'}),0);
});

test('recoverable trash is purged only after its configured safety window',async()=>{
  const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
  const {createFileStorage}=await import('../../backend/src/services/fileStorageService.js');
  const day=24*60*60*1000;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalpa-retention-trash-'));
  try{
    const storage=createFileStorage({root,trashRetentionMs:day});
    const dated=path.join(storage.trashRoot,'2026-01-01');fs.mkdirSync(dated,{recursive:true});
    const payload=path.join(dated,'old-object.pdf');fs.writeFileSync(payload,'expired');
    const oldTime=new Date(NOW-2*day);fs.utimesSync(payload,oldTime,oldTime);
    const result=storage.pruneTrash(NOW);
    assert.equal(result.deletedFiles,1);
    assert.equal(fs.existsSync(payload),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
