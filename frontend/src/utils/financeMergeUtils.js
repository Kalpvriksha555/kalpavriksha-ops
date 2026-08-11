export const FINANCE_MERGE_FIELDS = Object.freeze([
  'estimate','estimateAmount','ledger','financeVersion','paymentTrackingStatus','paymentTrackingUpdatedAt','paymentTrackingUpdatedBy',
  'paymentStatus','paymentReceived','paymentAmountIn','refundAmount','payerName','transactionId',
  'paymentDate','paymentTime','paymentAuditTrail','financeAccountingPeriod','lastFinanceMutationId','lastFinanceMutationAt',
  'lastFinanceMutationFingerprint','lastFinanceMutationOperation','financeMutationReceipts'
]);

const toTime = (value) => {
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const getTaskFinanceTime = (task = {}) => Math.max(
  0,
  toTime(task?.financeVersion),
  toTime(task?.paymentTrackingUpdatedAt),
  toTime(task?.ledger?.updatedAt),
  toTime(task?.paymentUpdatedAt),
  toTime(task?.paymentDate),
  ...(Array.isArray(task?.paymentAuditTrail) ? task.paymentAuditTrail.map(item => toTime(item?.at || item?.updatedAt || item?.createdAt)) : [0])
);

const financeScore = (task = {}) => FINANCE_MERGE_FIELDS.reduce((score, field) => {
  const value = task?.[field];
  if (value === undefined || value === null || value === '') return score;
  if (Array.isArray(value)) return score + (value.length ? 2 : 0);
  if (typeof value === 'object') return score + (Object.keys(value).length ? 2 : 0);
  return score + 1;
}, 0);

export const taskFinanceVersion = (task = {}) => {
  const numeric = Number(task?.financeVersion || 0);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
};

export const applyFreshestTaskFinance = (target = {}, current = {}, incoming = {}) => {
  const currentVersion = taskFinanceVersion(current);
  const incomingVersion = taskFinanceVersion(incoming);
  let source;
  if (currentVersion !== incomingVersion && (currentVersion > 0 || incomingVersion > 0)) {
    source = incomingVersion > currentVersion ? incoming : current;
  } else {
    const currentTime = getTaskFinanceTime(current);
    const incomingTime = getTaskFinanceTime(incoming);
    source = incomingTime > currentTime
      ? incoming
      : currentTime > incomingTime
        ? current
        : (financeScore(incoming) > financeScore(current) ? incoming : current);
  }
  const next = { ...target };
  FINANCE_MERGE_FIELDS.forEach(field => {
    // Compact state deltas can legitimately omit unchanged finance fields.
    // Omission must not be interpreted as deletion; explicit null/empty values
    // still overwrite because the property is present on the chosen source.
    if (Object.prototype.hasOwnProperty.call(source || {}, field)) next[field] = structuredClone(source[field]);
  });
  return next;
};
