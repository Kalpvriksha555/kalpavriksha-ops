const ACCOUNTING_TIME_ZONE = 'Asia/Kolkata';
const MONTH_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

const finiteNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const cleaned = typeof value === 'string' ? value.replace(/[^0-9.-]/g, '') : value;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
};

const toTimestamp = (value) => {
  if (!value) return 0;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') return toTimestamp(value.toDate());
    const seconds = Number(value.seconds ?? value._seconds ?? value.sec);
    if (Number.isFinite(seconds) && seconds > 0) {
      const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? value.nanos ?? 0) || 0;
      return Math.round(seconds * 1000 + nanos / 1_000_000);
    }
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};


const TASK_DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const getIndiaDateKey = (value = Date.now()) => {
  const timestamp = toTimestamp(value) || Date.now();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: ACCOUNTING_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(timestamp));
    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;
    const day = parts.find(part => part.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : '';
  } catch {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
};

const isValidTaskDateKey = (value) => {
  const candidate = String(value || '').trim().slice(0, 10);
  if (!TASK_DATE_PATTERN.test(candidate)) return false;
  const parsed = new Date(`${candidate}T12:00:00+05:30`);
  return Number.isFinite(parsed.getTime()) && getIndiaDateKey(parsed) === candidate;
};

export const normalizeTaskDateKey = (value, fallback = getIndiaDateKey()) => {
  const fallbackRaw = String(fallback || '').trim().slice(0, 10);
  const fallbackTimestamp = toTimestamp(fallback);
  const safeFallback = isValidTaskDateKey(fallbackRaw)
    ? fallbackRaw
    : (fallbackTimestamp ? getIndiaDateKey(fallbackTimestamp) : getIndiaDateKey());
  const raw = String(value || '').trim().slice(0, 10);
  if (TASK_DATE_PATTERN.test(raw)) return isValidTaskDateKey(raw) ? raw : safeFallback;
  const timestamp = toTimestamp(value);
  return timestamp ? getIndiaDateKey(timestamp) : safeFallback;
};

export const getTaskDateTimestamp = (taskDate, now = Date.now()) => {
  const nowTimestamp = toTimestamp(now) || Date.now();
  const today = getIndiaDateKey(nowTimestamp);
  const normalized = normalizeTaskDateKey(taskDate, today);
  if (normalized === today) return nowTimestamp;
  const timestamp = new Date(`${normalized}T12:00:00+05:30`).getTime();
  return Number.isFinite(timestamp) ? timestamp : nowTimestamp;
};

const zonedYearMonth = (value) => {
  const timestamp = toTimestamp(value);
  if (!timestamp) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: ACCOUNTING_TIME_ZONE,
      year: 'numeric',
      month: '2-digit'
    }).formatToParts(new Date(timestamp));
    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;
    return year && month ? `${year}-${month}` : '';
  } catch {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
};

export const normalizeAccountingMonthKey = (value, fallback = '') => {
  const raw = String(value || '').trim();
  const direct = raw.slice(0, 7);
  if (MONTH_KEY_PATTERN.test(direct)) return direct;
  const parsed = zonedYearMonth(value);
  if (MONTH_KEY_PATTERN.test(parsed)) return parsed;
  return MONTH_KEY_PATTERN.test(String(fallback || '').trim()) ? String(fallback).trim() : '';
};

export const getCurrentAccountingMonthKey = (now = Date.now()) => normalizeAccountingMonthKey(now);

export const getAccountingMonthKey = (value, fallback = '') => {
  if (typeof value === 'string') {
    const direct = value.trim().slice(0, 7);
    if (MONTH_KEY_PATTERN.test(direct)) return direct;
  }
  return normalizeAccountingMonthKey(value, fallback);
};

export const formatAccountingMonthLabel = (monthKey) => {
  const normalized = normalizeAccountingMonthKey(monthKey);
  if (!normalized) return 'Unknown month';
  const [year, month] = normalized.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: ACCOUNTING_TIME_ZONE })
    .format(new Date(Date.UTC(year, month - 1, 15, 12)));
};

export const compareAccountingMonths = (left, right) => String(left || '').localeCompare(String(right || ''));

export const getPreviousAccountingMonthKey = (monthKey) => {
  const normalized = normalizeAccountingMonthKey(monthKey);
  if (!normalized) return '';
  const [year, month] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 15, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const isInAccountingMonth = (value, monthKey) => {
  const normalized = normalizeAccountingMonthKey(monthKey);
  return !!normalized && getAccountingMonthKey(value) === normalized;
};

export const getProjectTaskMonthKey = (project = {}, fallback = '') => normalizeAccountingMonthKey(
  project?.taskAccountingPeriod
    || project?.taskDate
    || project?.operationalDate
    || project?.createdAt
    || project?.createdOn
    || project?.loggedAt
    || project?.date,
  fallback
);

export const getProjectFinanceMonthKey = (project = {}, fallback = '') => {
  // Finance belongs to the task's operational month. A payment entered later
  // updates that original month instead of moving the task into the entry month.
  const taskMonth = getProjectTaskMonthKey(project);
  if (taskMonth) return taskMonth;
  return normalizeAccountingMonthKey(
    project?.financeAccountingPeriod
      || project?.ledger?.accountingPeriod
      || project?.paymentDate
      || project?.ledger?.date
      || project?.paymentTrackingUpdatedAt
      || project?.ledger?.updatedAt
      || project?.paymentUpdatedAt
      || project?.completedAt,
    fallback
  );
};

export const getProjectCreatedMonthKey = (project = {}, fallback = '') => getProjectTaskMonthKey(project, fallback);

export const getProjectCompletedMonthKey = (project = {}, fallback = '') => normalizeAccountingMonthKey(
  project?.completedAt || project?.draftingCompletedAt || project?.submittedAt || project?.closedAt,
  fallback
);

export const getFinanceEventMonthKey = (event = {}, project = {}, fallback = '') => {
  const taskMonth = getProjectFinanceMonthKey(project);
  if (taskMonth) return taskMonth;
  return normalizeAccountingMonthKey(
    event?.accountingPeriod || event?.paymentDate || event?.date || event?.at || event?.updatedAt || event?.createdAt || event?.time,
    fallback
  );
};

const projectEstimateValue = (project = {}) => finiteNumber(
  project?.estimate ?? project?.estimateAmount ?? project?.amount ?? project?.totalAmount ?? project?.ledger?.expectedAmount
);
const projectReceivedValue = (project = {}) => finiteNumber(
  project?.ledger?.amountIn ?? project?.paymentAmountIn ?? project?.amountReceived ?? project?.receivedAmount
);
const projectExpensesValue = (project = {}) => finiteNumber(project?.ledger?.expenses);
const projectRefundValue = (project = {}) => finiteNumber(project?.ledger?.refund ?? project?.refundAmount);

const projectEstimate = (project = {}) => Math.max(0, projectEstimateValue(project) || 0);
const projectReceived = (project = {}) => Math.max(0, projectReceivedValue(project) || 0);
const projectExpenses = (project = {}) => Math.max(0, projectExpensesValue(project) || 0);
const projectRefund = (project = {}) => Math.max(0, projectRefundValue(project) || 0);

const eventTimestamp = (event = {}) => toTimestamp(event?.at || event?.updatedAt || event?.createdAt || event?.time || event?.paymentDate);

const eventNumericPair = (event, previousFields, nextFields) => {
  const previous = previousFields.map(field => finiteNumber(event?.[field])).find(value => value !== null);
  const next = nextFields.map(field => finiteNumber(event?.[field])).find(value => value !== null);
  return { previous, next, hasPair: previous !== null && next !== null };
};

export const getAccountingMonthEndTimestamp = (monthKey) => {
  const normalized = normalizeAccountingMonthKey(monthKey);
  if (!normalized) return 0;
  const [year, month] = normalized.split('-').map(Number);
  // 18:29:59.999 UTC is 23:59:59.999 IST on the final calendar day.
  return Date.UTC(year, month, 0, 18, 29, 59, 999);
};

const deriveStatus = (estimate, received, explicit = '') => {
  if (received > 0 && estimate > 0 && received > estimate) return 'Overpaid';
  if (received > 0 && estimate > 0 && received === estimate) return 'Paid';
  if (received > 0 && estimate > 0 && received < estimate) return 'Partially Paid';
  if (received > 0) return 'Paid';
  const normalized = String(explicit || '').trim().toLowerCase();
  if (estimate > 0 || normalized.includes('pending') || normalized.includes('partial')) return 'Pending';
  return 'Not Updated';
};

export const buildProjectMonthlyFinanceEntry = (project = {}, monthKey) => {
  const normalizedMonth = normalizeAccountingMonthKey(monthKey);
  const projectMonth = getProjectFinanceMonthKey(project);
  const allEvents = (Array.isArray(project?.paymentAuditTrail) ? project?.paymentAuditTrail : [])
    .filter(Boolean)
    .map(event => ({ ...event, _monthKey:getFinanceEventMonthKey(event, project), _timestamp:eventTimestamp(event) }))
    .sort((a, b) => a._timestamp - b._timestamp);
  const monthEvents = allEvents.filter(event => event?._monthKey === normalizedMonth);
  const hasActivity = projectMonth === normalizedMonth || monthEvents.length > 0;
  const estimate = projectEstimate(project);

  let receivedMovement = 0;
  let expenseMovement = 0;
  let refundMovement = 0;
  let hasReceivedDelta = false;
  let hasExpenseDelta = false;
  let hasRefundDelta = false;

  for (const event of monthEvents) {
    const amountPair = eventNumericPair(event, ['oldAmount', 'previousAmount', 'previousAmountIn'], ['newAmount', 'amount', 'paymentAmountIn', 'nextAmount']);
    if (amountPair.hasPair) {
      receivedMovement += amountPair.next - amountPair.previous;
      hasReceivedDelta = true;
    }
    const expensePair = eventNumericPair(event, ['oldExpenses', 'previousExpenses'], ['newExpenses', 'expenses']);
    if (expensePair.hasPair) {
      expenseMovement += expensePair.next - expensePair.previous;
      hasExpenseDelta = true;
    }
    const refundPair = eventNumericPair(event, ['oldRefund', 'previousRefund'], ['newRefund', 'refund', 'refundAmount']);
    if (refundPair.hasPair) {
      refundMovement += refundPair.next - refundPair.previous;
      hasRefundDelta = true;
    } else {
      const directRefund = finiteNumber(event?.refundAmount);
      if (directRefund !== null && directRefund !== 0) {
        refundMovement += directRefund;
        hasRefundDelta = true;
      }
    }
  }

  if (projectMonth === normalizedMonth) {
    // A task has one immutable finance month. Its current saved finance state is
    // authoritative for that month. For older records where a current field is
    // absent, use the latest surviving audit value instead of treating a lone
    // correction as a negative movement.
    const latestEvent = monthEvents[monthEvents.length - 1] || null;
    const latestAmount = latestEvent
      ? eventNumericPair(latestEvent, ['oldAmount', 'previousAmount', 'previousAmountIn'], ['newAmount', 'amount', 'paymentAmountIn', 'nextAmount']).next
      : null;
    const latestExpenses = latestEvent
      ? eventNumericPair(latestEvent, ['oldExpenses', 'previousExpenses'], ['newExpenses', 'expenses']).next
      : null;
    const latestRefund = latestEvent
      ? eventNumericPair(latestEvent, ['oldRefund', 'previousRefund'], ['newRefund', 'refund', 'refundAmount']).next
      : null;
    receivedMovement = Math.max(0, projectReceivedValue(project) ?? latestAmount ?? receivedMovement ?? 0);
    expenseMovement = Math.max(0, projectExpensesValue(project) ?? latestExpenses ?? expenseMovement ?? 0);
    refundMovement = Math.max(0, projectRefundValue(project) ?? latestRefund ?? refundMovement ?? 0);
  }

  const periodEnd = getAccountingMonthEndTimestamp(normalizedMonth);
  // Accounting-period corrections may be recorded after month end. The latest
  // event assigned to this task month is therefore the closing state for that
  // month, regardless of the later audit timestamp.
  const closingEvent = monthEvents[monthEvents.length - 1]
    || [...allEvents].reverse().find(event => event?._timestamp > 0 && event?._timestamp <= periodEnd);
  const closingPair = closingEvent
    ? eventNumericPair(closingEvent, ['oldAmount', 'previousAmount'], ['newAmount', 'amount', 'paymentAmountIn'])
    : { next:null };
  let closingReceived = projectMonth === normalizedMonth
    ? Math.max(0, projectReceivedValue(project) ?? closingPair.next ?? receivedMovement ?? 0)
    : closingPair.next;
  if (closingReceived === null || closingReceived === undefined) {
    closingReceived = projectMonth && compareAccountingMonths(projectMonth, normalizedMonth) <= 0 ? projectReceived(project) : 0;
  }
  closingReceived = Math.max(0, Number(closingReceived) || 0);
  const latestMonthEvent = monthEvents[monthEvents.length - 1] || null;
  const currentProjectStatus = project?.paymentTrackingStatus || project?.paymentStatus || project?.paymentReceived || project?.ledger?.status || '';
  const statusAtClose = deriveStatus(
    estimate,
    closingReceived,
    projectMonth === normalizedMonth
      ? currentProjectStatus
      : latestMonthEvent?.newStatus || latestMonthEvent?.status || ''
  );
  const activityAt = latestMonthEvent?._timestamp
    || toTimestamp(project?.paymentDate || project?.ledger?.date || project?.paymentTrackingUpdatedAt || project?.ledger?.updatedAt || project?.completedAt || project?.createdAt);

  const received = Number.isFinite(receivedMovement) ? receivedMovement : 0;
  const expenses = Number.isFinite(expenseMovement) ? expenseMovement : 0;
  const refund = Number.isFinite(refundMovement) ? refundMovement : 0;
  const safeEstimate = Number.isFinite(estimate) ? estimate : 0;
  const safeClosingReceived = Number.isFinite(closingReceived) ? closingReceived : 0;

  return {
    monthKey:normalizedMonth,
    projectMonth,
    hasActivity,
    events:monthEvents.map(({ _monthKey, _timestamp, ...event }) => event),
    activityAt,
    estimate:safeEstimate,
    received,
    expenses,
    refund,
    net:received - expenses - refund,
    closingReceived:safeClosingReceived,
    pendingAtClose:Math.max(0, safeEstimate - safeClosingReceived),
    statusAtClose
  };
};

export const getAvailableFinanceMonthKeys = (projects = [], fallbackMonth = getCurrentAccountingMonthKey()) => {
  const keys = new Set([normalizeAccountingMonthKey(fallbackMonth)]);
  for (const project of Array.isArray(projects) ? projects : []) {
    const projectMonth = getProjectFinanceMonthKey(project);
    if (projectMonth) keys.add(projectMonth);
    for (const event of Array.isArray(project?.paymentAuditTrail) ? project?.paymentAuditTrail : []) {
      const eventMonth = getFinanceEventMonthKey(event, project);
      if (eventMonth) keys.add(eventMonth);
    }
  }
  return [...keys].filter(Boolean).sort((a, b) => compareAccountingMonths(b, a));
};

export const hasRevisionInAccountingMonth = (project = {}, monthKey) => {
  const normalized = normalizeAccountingMonthKey(monthKey);
  const revisionItems = [
    ...(Array.isArray(project?.revisions) ? project?.revisions : []),
    ...(Array.isArray(project?.subTasks) ? project?.subTasks : [])
  ];
  if (revisionItems.some(item => getAccountingMonthKey(item?.createdAt || item?.at || item?.updatedAt || item?.time) === normalized)) return true;
  return revisionItems.length > 0 && getProjectCreatedMonthKey(project) === normalized;
};
