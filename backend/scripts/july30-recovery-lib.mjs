import crypto from 'crypto';

const MIN_TIMESTAMP = Date.UTC(2000, 0, 1);
const DEFAULT_CUTOFF = Date.parse('2026-07-29T07:30:00.000Z');
const DEFAULT_EXPECTED_EXPORT = '2026-07-30T09:04:09.534Z';
const DEFAULT_EXPECTED_COUNT = 404;
const DEFAULT_EXPECTED_FRESH_COUNT = 34;
const MAX_EXPORT_CLOCK_SKEW_MS = 5 * 60 * 1000;

const TOP_LEVEL_TIME_FIELDS = [
  'createdAt', 'updatedAt', 'assignedAt', 'submittedAt', 'draftingStartedAt',
  'currentDraftingStartedAt', 'draftingResumedAt', 'draftingPausedAt',
  'draftingCompletedAt', 'internalReviewStartedAt', 'approvedAt', 'completedAt',
  'revisionAssignedAt', 'revisionRequestedAt', 'reportSentAt',
  'paymentTrackingUpdatedAt'
];

const NESTED_COLLECTION_FIELDS = [
  'timeline', 'history', 'reassignmentHistory', 'caseEditHistory', 'deliveryLog',
  'reviewHistory', 'revisionHistory', 'paymentAuditTrail', 'documents',
  'completedFiles', 'comments', 'revisions', 'subTasks'
];

const NESTED_TIME_FIELDS = [
  'at', 'time', 'timestamp', 'createdAt', 'updatedAt', 'date', 'uploadedAt',
  'completedAt', 'assignedAt', 'requestedAt', 'approvedAt'
];

export const FINANCE_FIELDS = [
  'ledger', 'paymentDate', 'paymentStatus', 'paymentAmountIn', 'paymentReceived',
  'paymentTrackingStatus', 'paymentTrackingUpdatedAt', 'paymentTrackingUpdatedBy',
  'paymentAuditTrail', 'excludeFromLedger', 'isFinanceExcluded'
];

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex');
}

function epochMilliseconds(value) {
  let numeric = null;
  if (typeof value === 'number') numeric = value;
  else if (typeof value === 'string' && /^[+-]?\d{10,19}(?:\.\d+)?$/.test(value.trim())) numeric = Number(value.trim());
  if (!Number.isFinite(numeric)) return 0;
  const magnitude = Math.abs(numeric);
  if (magnitude >= 1e17) numeric /= 1e6;
  else if (magnitude >= 1e14) numeric /= 1e3;
  else if (magnitude > 0 && magnitude < 1e11) numeric *= 1e3;
  return Math.trunc(numeric);
}

function localIndiaTimeToUtc(year, month, day, hour, minute, second) {
  return Date.UTC(year, month - 1, day, hour - 5, minute - 30, second);
}

export function recoveryTimestamp(value, { maxTimestamp = Number.POSITIVE_INFINITY } = {}) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'object') {
    const seconds = Number(value.seconds ?? value._seconds ?? value.sec);
    if (Number.isFinite(seconds)) return recoveryTimestamp(seconds, { maxTimestamp });
    return 0;
  }

  const epoch = epochMilliseconds(value);
  if (epoch) return epoch >= MIN_TIMESTAMP && epoch <= maxTimestamp ? epoch : 0;

  const raw = String(value).trim();
  const legacy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[,\s]+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?)?$/i);
  let timestamp = 0;
  if (legacy) {
    let [, first, second, year, hour = '0', minute = '0', seconds = '0', meridian = ''] = legacy;
    let day = Number(first);
    let month = Number(second);
    const normalizedMeridian = meridian.toLowerCase();

    // Legacy UI output mixed Indian 24-hour DD/MM with browser-locale
    // 12-hour MM/DD. Values over 12 are authoritative; AM/PM breaks ties.
    if (day <= 12 && (month > 12 || normalizedMeridian)) {
      month = Number(first);
      day = Number(second);
    }

    let normalizedHour = Number(hour);
    if (normalizedMeridian === 'pm' && normalizedHour < 12) normalizedHour += 12;
    if (normalizedMeridian === 'am' && normalizedHour === 12) normalizedHour = 0;
    const normalizedYear = Number(year.length === 2 ? `20${year}` : year);
    timestamp = localIndiaTimeToUtc(
      normalizedYear,
      month,
      day,
      normalizedHour,
      Number(minute),
      Number(seconds)
    );
  } else {
    timestamp = Date.parse(raw);
  }

  return Number.isFinite(timestamp) && timestamp >= MIN_TIMESTAMP && timestamp <= maxTimestamp ? timestamp : 0;
}

export function caseFreshness(caseRecord = {}, { maxTimestamp = Number.POSITIVE_INFINITY } = {}) {
  const timestamps = TOP_LEVEL_TIME_FIELDS.map(field => recoveryTimestamp(caseRecord[field], { maxTimestamp }));
  for (const collection of NESTED_COLLECTION_FIELDS) {
    for (const item of Array.isArray(caseRecord[collection]) ? caseRecord[collection] : []) {
      for (const field of NESTED_TIME_FIELDS) {
        timestamps.push(recoveryTimestamp(item?.[field], { maxTimestamp }));
      }
    }
  }
  return Math.max(0, ...timestamps);
}

function recordId(record = {}) {
  return String(record.id || record.caseId || record.projectId || '').trim();
}

function mergeArray(primary = [], secondary = []) {
  const result = [];
  const seenIds = new Set();
  const seenHashes = new Set();
  for (const item of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    const explicit = item && typeof item === 'object'
      ? String(item.id || item.fileId || item.documentId || item.revisionId || '').trim()
      : '';
    const hash = sha256(item);
    if ((explicit && seenIds.has(explicit)) || seenHashes.has(hash)) continue;
    if (explicit) seenIds.add(explicit);
    seenHashes.add(hash);
    result.push(item);
  }
  return result;
}

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

export function mergeCaseRecords(liveCase, recoveryCase, { maxTimestamp } = {}) {
  if (!liveCase) return structuredClone(recoveryCase);
  const liveFreshness = caseFreshness(liveCase, { maxTimestamp: Date.now() + MAX_EXPORT_CLOCK_SKEW_MS });
  const recoveryFreshness = caseFreshness(recoveryCase, { maxTimestamp });
  const recoveryIsFresher = recoveryFreshness > liveFreshness;
  const primary = recoveryIsFresher ? recoveryCase : liveCase;
  const secondary = recoveryIsFresher ? liveCase : recoveryCase;
  const merged = structuredClone(primary);

  for (const [key, value] of Object.entries(secondary || {})) {
    if (NESTED_COLLECTION_FIELDS.includes(key) || FINANCE_FIELDS.includes(key)) continue;
    if (isBlank(merged[key]) && !isBlank(value)) merged[key] = structuredClone(value);
  }

  for (const key of NESTED_COLLECTION_FIELDS) {
    merged[key] = mergeArray(primary?.[key], secondary?.[key]);
  }

  // Live finance wins whenever the field exists. This prevents recovery of
  // operational history from rolling back money entered after the export.
  for (const key of FINANCE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(liveCase, key)) merged[key] = structuredClone(liveCase[key]);
    else if (Object.prototype.hasOwnProperty.call(recoveryCase, key)) merged[key] = structuredClone(recoveryCase[key]);
  }

  return {
    merged,
    liveFreshness,
    recoveryFreshness,
    source: recoveryIsFresher ? 'recovery' : 'live'
  };
}

export function validateRecoveryExport(payload, {
  expectedExportedAt = DEFAULT_EXPECTED_EXPORT,
  expectedCount = DEFAULT_EXPECTED_COUNT,
  expectedFreshCount = DEFAULT_EXPECTED_FRESH_COUNT,
  cutoff = DEFAULT_CUTOFF
} = {}) {
  const exportedAt = String(payload?.exportedAt || '');
  const cases = payload?.projectsBackup || payload?.projects || payload?.cases;
  if (!Array.isArray(cases)) throw new Error('Recovery export does not contain a project/task array.');
  if (exportedAt !== expectedExportedAt) throw new Error(`Unexpected recovery export timestamp: ${exportedAt || 'missing'}.`);
  if (cases.length !== expectedCount) throw new Error(`Unexpected recovery case count: ${cases.length}; expected ${expectedCount}.`);

  const ids = cases.map(recordId);
  if (ids.some(id => !id)) throw new Error('Recovery export contains a task without an ID.');
  if (new Set(ids).size !== ids.length) throw new Error('Recovery export contains duplicate task IDs.');

  const maxTimestamp = Date.parse(exportedAt) + MAX_EXPORT_CLOCK_SKEW_MS;
  const freshness = cases.map(item => caseFreshness(item, { maxTimestamp }));
  const freshCount = freshness.filter(value => value > cutoff).length;
  const latestTimestamp = Math.max(0, ...freshness);
  if (freshCount !== expectedFreshCount) {
    throw new Error(`Recovery freshness evidence mismatch: ${freshCount} tasks after cutoff; expected ${expectedFreshCount}.`);
  }
  if (latestTimestamp < Date.parse('2026-07-30T08:45:00.000Z') || latestTimestamp > maxTimestamp) {
    throw new Error(`Recovery latest activity is outside the expected July 30 window: ${new Date(latestTimestamp).toISOString()}.`);
  }

  return {
    exportedAt,
    cases,
    caseCount: cases.length,
    freshCount,
    latestTimestamp,
    latestActivityAt: new Date(latestTimestamp).toISOString(),
    maxTimestamp,
    sourceHash: sha256(payload)
  };
}

export function mergeRecoveryIntoState(liveState, recoveryPayload, options = {}) {
  const evidence = validateRecoveryExport(recoveryPayload, options);
  const liveCases = Array.isArray(liveState?.cases)
    ? liveState.cases
    : (Array.isArray(liveState?.projects) ? liveState.projects : []);
  const deletedIds = new Set((liveState?.deletedProjectIds || []).map(String));
  const liveById = new Map(liveCases.filter(Boolean).map(item => [recordId(item), item]));
  const recoveryById = new Map(evidence.cases.map(item => [recordId(item), item]));
  const mergedCases = [];
  const summary = {
    liveBefore: liveCases.length,
    recoverySource: evidence.caseCount,
    added: 0,
    recoveryFresher: 0,
    liveFresherOrEqual: 0,
    skippedDeleted: 0
  };

  for (const liveCase of liveCases) {
    const id = recordId(liveCase);
    const recoveryCase = recoveryById.get(id);
    if (!recoveryCase) {
      mergedCases.push(structuredClone(liveCase));
      continue;
    }
    const result = mergeCaseRecords(liveCase, recoveryCase, { maxTimestamp: evidence.maxTimestamp });
    mergedCases.push(result.merged);
    if (result.source === 'recovery') summary.recoveryFresher += 1;
    else summary.liveFresherOrEqual += 1;
  }

  for (const recoveryCase of evidence.cases) {
    const id = recordId(recoveryCase);
    if (liveById.has(id)) continue;
    if (deletedIds.has(id)) {
      summary.skippedDeleted += 1;
      continue;
    }
    mergedCases.push(structuredClone(recoveryCase));
    summary.added += 1;
  }

  summary.mergedTotal = mergedCases.length;
  const state = structuredClone(liveState || {});
  state.cases = mergedCases;
  delete state.projects;

  return { state, evidence, summary };
}

export function nonCaseStateHash(state = {}) {
  const copy = structuredClone(state);
  delete copy.cases;
  delete copy.projects;
  return sha256(copy);
}

export function attendanceHash(state = {}) {
  return sha256(Array.isArray(state.attendanceLogs) ? state.attendanceLogs : []);
}
