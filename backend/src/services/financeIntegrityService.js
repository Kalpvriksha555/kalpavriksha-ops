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
  'lastFinanceMutationAt'
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
  toTimestamp(record.financeVersion),
  toTimestamp(record.paymentTrackingUpdatedAt),
  toTimestamp(record.ledger?.updatedAt),
  toTimestamp(record.paymentUpdatedAt),
  toTimestamp(record.paymentDate),
  collectionNewestTimestamp(record.paymentAuditTrail)
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

export const chooseFreshestFinanceSource = (existing = {}, incoming = {}) => {
  const existingFreshness = financeFreshness(existing);
  const incomingFreshness = financeFreshness(incoming);
  if (incomingFreshness > existingFreshness) return incoming;
  if (existingFreshness > incomingFreshness) return existing;
  return financeCompletenessScore(incoming) > financeCompletenessScore(existing) ? incoming : existing;
};

export const copyFinanceFields = (target = {}, source = {}) => {
  const next = { ...(target || {}) };
  for (const field of FINANCE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source || {}, field)) next[field] = structuredClone(source[field]);
    else delete next[field];
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
