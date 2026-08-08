import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FINANCE_OUTBOX_BACKUP_KEY,
  FINANCE_OUTBOX_STORAGE_KEY,
  advanceFinanceOutboxAfterConfirmation,
  getFinanceOutboxRecord,
  getFinanceOutboxRecords,
  getFinanceSyncSnapshot,
  markFinanceOutboxError,
  queueFinanceDraft,
} from '../../frontend/src/services/financeOutboxService.js';

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
  clear() { this.data.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = { dispatchEvent() {} };

const admin = { id:'admin-1', name:'Admin', role:'Admin' };
const draft = (amount) => ({ estimate:'1000', amountIn:String(amount), expenses:'', refund:'', date:'2026-08-02', receivedFrom:'Client', txnId:`TX-${amount}`, mode:'Bank', note:'', screenshot:null });

test.beforeEach(() => globalThis.localStorage.clear());

test('thirty separate payment drafts survive in the durable browser outbox', () => {
  for (let index = 1; index <= 30; index += 1) {
    const record = queueFinanceDraft({ project:{ id:`CASE-${index}`, financeVersion:0 }, draft:draft(index), user:admin });
    assert.ok(record?.mutationId);
  }
  assert.equal(getFinanceOutboxRecords('admin-1').length, 30);
  const raw = JSON.parse(globalThis.localStorage.getItem(FINANCE_OUTBOX_STORAGE_KEY));
  const backup = JSON.parse(globalThis.localStorage.getItem(FINANCE_OUTBOX_BACKUP_KEY));
  assert.equal(Object.keys(raw.records).length, 30);
  assert.equal(Object.keys(backup.records).length, 30);
  assert.equal(raw.generation, backup.generation);

  globalThis.localStorage.setItem(FINANCE_OUTBOX_STORAGE_KEY, '{corrupt');
  assert.equal(getFinanceOutboxRecords('admin-1').length, 30);
});


test('a stale mirror cannot resurrect a payment mutation already confirmed by the backend', () => {
  const record = queueFinanceDraft({ project:{ id:'CASE-MIRROR', financeVersion:2 }, draft:draft(250), user:admin });
  const stalePrimary = globalThis.localStorage.getItem(FINANCE_OUTBOX_STORAGE_KEY);
  advanceFinanceOutboxAfterConfirmation({ key:record.key, mutationId:record.mutationId, confirmedFinanceVersion:3 });
  assert.equal(getFinanceOutboxRecords('admin-1').length, 0);

  // Simulate an interrupted mirror write that leaves one older copy behind.
  globalThis.localStorage.setItem(FINANCE_OUTBOX_STORAGE_KEY, stalePrimary);
  assert.equal(getFinanceOutboxRecords('admin-1').length, 0);
});

test('reopening the same task restores the newest unsynced draft', () => {
  queueFinanceDraft({ project:{ id:'CASE-1', financeVersion:3 }, draft:draft(100), user:admin });
  const newest = queueFinanceDraft({ project:{ id:'CASE-1', financeVersion:3 }, draft:draft(700), user:admin });
  const restored = getFinanceOutboxRecord('CASE-1', 'admin-1');
  assert.equal(restored.draft.amountIn, '700');
  assert.equal(restored.mutationId, newest.mutationId);
  assert.equal(getFinanceOutboxRecords('admin-1').length, 1);
});

test('confirmation removes only the exact sent mutation and never a newer queued edit', () => {
  const first = queueFinanceDraft({ project:{ id:'CASE-1', financeVersion:4 }, draft:draft(100), user:admin });
  const newer = queueFinanceDraft({ project:{ id:'CASE-1', financeVersion:4 }, draft:draft(900), user:admin });
  const result = advanceFinanceOutboxAfterConfirmation({ key:first.key, mutationId:first.mutationId, confirmedFinanceVersion:5 });
  assert.equal(result.newerPending, true);
  const pending = getFinanceOutboxRecord('CASE-1', 'admin-1');
  assert.equal(pending.mutationId, newer.mutationId);
  assert.equal(pending.draft.amountIn, '900');
  assert.equal(pending.expectedFinanceVersion, 5);

  advanceFinanceOutboxAfterConfirmation({ key:pending.key, mutationId:pending.mutationId, confirmedFinanceVersion:6 });
  assert.equal(getFinanceOutboxRecords('admin-1').length, 0);
});

test('failed updates remain stored and are exposed by the sync summary', () => {
  const record = queueFinanceDraft({ project:{ id:'CASE-2', financeVersion:1 }, draft:draft(300), user:admin });
  markFinanceOutboxError(record.key, record.mutationId, new Error('offline'), { retryable:true });
  const snapshot = getFinanceSyncSnapshot('admin-1', 0);
  assert.equal(snapshot.total, 1);
  assert.equal(snapshot.errors, 1);
  assert.equal(snapshot.records[0].draft.amountIn, '300');
});

test('finance outbox records are isolated by signed-in actor', () => {
  queueFinanceDraft({ project:{ id:'CASE-3', financeVersion:0 }, draft:draft(20), user:admin });
  queueFinanceDraft({ project:{ id:'CASE-4', financeVersion:0 }, draft:draft(40), user:{ id:'admin-2', name:'Other Admin' } });
  assert.equal(getFinanceOutboxRecords('admin-1').length, 1);
  assert.equal(getFinanceOutboxRecords('admin-2').length, 1);
});

test('storage failure blocks the green safe-to-close state until a durable write succeeds', () => {
  class RejectingStorage extends MemoryStorage {
    setItem() { throw new Error('quota blocked'); }
  }
  globalThis.localStorage = new RejectingStorage();
  const rejected = queueFinanceDraft({ project:{ id:'CASE-STORAGE', financeVersion:0 }, draft:draft(500), user:admin });
  assert.equal(rejected, null);
  assert.equal(getFinanceSyncSnapshot('admin-1', 0).storageError, true);

  globalThis.localStorage = new MemoryStorage();
  const recovered = queueFinanceDraft({ project:{ id:'CASE-STORAGE', financeVersion:0 }, draft:draft(500), user:admin });
  assert.ok(recovered?.mutationId);
  assert.equal(getFinanceSyncSnapshot('admin-1', 0).storageError, false);
});

test('two corrupt payment mirrors cannot produce a green safe-to-close state', () => {
  globalThis.localStorage.setItem(FINANCE_OUTBOX_STORAGE_KEY, '{broken');
  globalThis.localStorage.setItem(FINANCE_OUTBOX_BACKUP_KEY, 'not-json');
  const snapshot = getFinanceSyncSnapshot('admin-1', 0);
  assert.equal(snapshot.storageError, true);
  assert.match(snapshot.storageErrorReason, /Do not close/i);
});

test('last-synced status is scoped to the signed-in finance actor', () => {
  const first = queueFinanceDraft({ project:{ id:'CASE-ACTOR-1', financeVersion:0 }, draft:draft(10), user:admin });
  const secondAdmin = { id:'admin-2', name:'Other Admin', role:'Admin' };
  const second = queueFinanceDraft({ project:{ id:'CASE-ACTOR-2', financeVersion:0 }, draft:draft(20), user:secondAdmin });
  advanceFinanceOutboxAfterConfirmation({ key:first.key, mutationId:first.mutationId, confirmedFinanceVersion:1, actorId:'admin-1' });
  assert.ok(getFinanceSyncSnapshot('admin-1',0).lastSyncedAt > 0);
  assert.equal(getFinanceSyncSnapshot('admin-2',0).lastSyncedAt, 0);
  advanceFinanceOutboxAfterConfirmation({ key:second.key, mutationId:second.mutationId, confirmedFinanceVersion:1, actorId:'admin-2' });
  assert.ok(getFinanceSyncSnapshot('admin-2',0).lastSyncedAt > 0);
});
