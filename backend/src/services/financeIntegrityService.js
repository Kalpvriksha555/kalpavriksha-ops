import crypto from 'node:crypto';

export const FINANCE_FIELDS = Object.freeze([
  'estimate',
  'estimateAmount',
  'ledger',
  'financeVersion',
  'paymentTrackingStatus',
  'paymentTrackingUpdatedAt',
  'paymentTrackingUpdatedBy',
  'paymentStatus',
  'paymentReceived',
  'paymentAmountIn',
  'refundAmount',
  'payerName',
  'transactionId',
  'paymentDate',
  'paymentTime',
  'paymentAuditTrail',
  'financeAccountingPeriod',
  'lastFinanceMutationId',
  'lastFinanceMutationAt',
  'lastFinanceMutationFingerprint',
  'lastFinanceMutationOperation',
  'financeMutationReceipts'
]);

export const toTimestamp = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const collectionNewestTimestamp = (items = []) => Math.max(
  0,
  ...(Array.isArray(items) ? items : []).map((item) => toTimestamp(item?.at || item?.updatedAt || item?.createdAt || item?.time))
);

export const financeFreshness = (record = {}) => Math.max(
  0,
  toTimestamp(record?.financeVersion),
  toTimestamp(record?.paymentTrackingUpdatedAt),
  toTimestamp(record?.ledger?.updatedAt),
  toTimestamp(record?.paymentUpdatedAt),
  toTimestamp(record?.paymentDate),
  collectionNewestTimestamp(record?.paymentAuditTrail)
);

export const financeCompletenessScore = (record = {}) => {
  let score = 0;
  for (const field of FINANCE_FIELDS) {
    const value = record?.[field];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) score += value.length ? 2 : 0;
    else if (typeof value === 'object') score += Object.keys(value).length ? 2 : 0;
    else score += 1;
  }
  return score;
};

export const financeVersion = (record = {}) => {
  const numeric = Number(record?.financeVersion || 0);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
};

export const chooseFreshestFinanceSource = (existing = {}, incoming = {}) => {
  // financeVersion is the authoritative concurrency clock. Timestamps are only
  // a legacy/equal-version tie breaker; a stale browser clock must never make a
  // lower financeVersion win merely because its updatedAt is later.
  const existingVersion = financeVersion(existing);
  const incomingVersion = financeVersion(incoming);
  if (incomingVersion !== existingVersion && (incomingVersion > 0 || existingVersion > 0)) {
    return incomingVersion > existingVersion ? incoming : existing;
  }
  const existingFreshness = financeFreshness(existing);
  const incomingFreshness = financeFreshness(incoming);
  if (incomingFreshness > existingFreshness) return incoming;
  if (existingFreshness > incomingFreshness) return existing;
  return financeCompletenessScore(incoming) > financeCompletenessScore(existing) ? incoming : existing;
};

export const copyFinanceFields = (target = {}, source = {}) => {
  const next = { ...(target || {}) };
  for (const field of FINANCE_FIELDS) {
    // A compact/legacy finance patch may omit fields it did not touch. Missing
    // is not deletion; explicit null/empty values still overwrite because the
    // property is present. This prevents partial responses from erasing durable
    // finance metadata, receipt links or audit state during case merges.
    if (Object.prototype.hasOwnProperty.call(source || {}, field)) next[field] = structuredClone(source[field]);
  }
  return next;
};

export const applyFreshestFinance = (base = {}, existing = {}, incoming = {}) =>
  copyFinanceFields(base, chooseFreshestFinanceSource(existing, incoming));

export const buildFinanceSnapshot = (record = {}) => {
  const snapshot = {};
  for (const field of FINANCE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record || {}, field)) snapshot[field] = structuredClone(record[field]);
  }
  return snapshot;
};

const stableSort = (value) => {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSort(value[key])]));
};

export const financeSnapshotHash = (snapshot = {}) => crypto
  .createHash('sha256')
  .update(JSON.stringify(stableSort(snapshot)))
  .digest('hex');



const FINANCE_MUTATION_FINGERPRINT_IGNORED_FIELDS = new Set([
  'mutationId',
  'clientMutationId',
  'expectedFinanceVersion',
  'lastFinanceMutationId',
  'lastFinanceMutationAt',
  'lastFinanceMutationFingerprint',
  'lastFinanceMutationOperation',
  'financeMutationReceipts',
  'updatedAt',
  'syncVersion'
]);

const canonicalFinanceMutationValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalFinanceMutationValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => !FINANCE_MUTATION_FINGERPRINT_IGNORED_FIELDS.has(key))
      .map((key) => [key, canonicalFinanceMutationValue(value[key])])
  );
};

export const financeMutationFingerprint = (operation = 'payment-status', payload = {}) => crypto
  .createHash('sha256')
  .update(JSON.stringify({
    operation:String(operation || 'payment-status').trim().toLowerCase(),
    payload:canonicalFinanceMutationValue(payload || {})
  }))
  .digest('hex');

export const findFinanceMutationReceipt = (record = {}, mutationId = '') => {
  const target = String(mutationId || '').trim();
  if (!target) return null;
  const receipts = Array.isArray(record?.financeMutationReceipts) ? record.financeMutationReceipts : [];
  const found = receipts.find((receipt) => String(receipt?.mutationId || '').trim() === target);
  if (found) return found;
  if (String(record?.lastFinanceMutationId || '').trim() === target) {
    return {
      mutationId:target,
      fingerprint:String(record?.lastFinanceMutationFingerprint || '').trim(),
      operation:String(record?.lastFinanceMutationOperation || '').trim().toLowerCase(),
      financeVersion:financeVersion(record),
      committedAt:record?.lastFinanceMutationAt || '',
      legacy:true
    };
  }
  return null;
};

export const rememberFinanceMutationReceipt = (record = {}, receipt = {}, limit = 64) => {
  const mutationId = String(receipt?.mutationId || '').trim().slice(0, 200);
  if (!mutationId) return record;
  const safeLimit = Math.max(8, Math.min(256, Number(limit || 64)));
  const nextReceipt = {
    mutationId,
    fingerprint:String(receipt?.fingerprint || '').trim().slice(0, 128),
    operation:String(receipt?.operation || 'payment-status').trim().toLowerCase().slice(0, 80),
    financeVersion:Math.max(0, Number(receipt?.financeVersion ?? financeVersion(record)) || 0),
    paymentId:String(receipt?.paymentId || '').trim().slice(0, 200),
    committedAt:receipt?.committedAt || new Date().toISOString()
  };
  const previous = Array.isArray(record?.financeMutationReceipts) ? record.financeMutationReceipts : [];
  record.financeMutationReceipts = [
    nextReceipt,
    ...previous.filter((item) => String(item?.mutationId || '').trim() !== mutationId)
  ].slice(0, safeLimit);
  record.lastFinanceMutationId = mutationId;
  record.lastFinanceMutationAt = nextReceipt.committedAt;
  record.lastFinanceMutationFingerprint = nextReceipt.fingerprint;
  record.lastFinanceMutationOperation = nextReceipt.operation;
  return record;
};

export const mergePaymentRecords = (existingPayments = [], incomingPayments = []) => {
  const byId = new Map();
  const anonymous = [];
  for (const payment of [...(Array.isArray(existingPayments) ? existingPayments : []), ...(Array.isArray(incomingPayments) ? incomingPayments : [])]) {
    if (!payment || typeof payment !== 'object') continue;
    const key = String(payment.id || [payment.caseId, payment.caseNo, payment.source, payment.createdAt].filter(Boolean).join('|')).trim();
    if (!key) {
      anonymous.push(payment);
      continue;
    }
    const previous = byId.get(key);
    if (!previous) {
      byId.set(key, payment);
      continue;
    }
    const previousTime = Math.max(toTimestamp(previous.updatedAt), toTimestamp(previous.createdAt), toTimestamp(previous.paymentDate));
    const incomingTime = Math.max(toTimestamp(payment.updatedAt), toTimestamp(payment.createdAt), toTimestamp(payment.paymentDate));
    byId.set(key, incomingTime >= previousTime ? { ...previous, ...payment } : { ...payment, ...previous });
  }
  return [...byId.values(), ...anonymous]
    .filter(Boolean)
    .sort((a, b) => Math.max(toTimestamp(b.updatedAt), toTimestamp(b.createdAt), toTimestamp(b.paymentDate)) - Math.max(toTimestamp(a.updatedAt), toTimestamp(a.createdAt), toTimestamp(a.paymentDate)));
};
