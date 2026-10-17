const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_FILE_RETENTION_DAYS = 90;
export const DEFAULT_TRASH_RETENTION_DAYS = 1;

function timestampMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  const normalizeEpoch = (numeric) => {
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    // Legacy/browser payloads occasionally persisted Unix seconds while the
    // current application stores milliseconds/ISO timestamps. Treat plausible
    // epoch-second values as seconds instead of accidentally expiring them as
    // dates in 1970 under the 90-day retention job.
    if (numeric >= 1_000_000_000 && numeric < 100_000_000_000) return numeric * 1000;
    return numeric;
  };
  if (typeof value === 'number') return normalizeEpoch(value);
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return normalizeEpoch(numeric);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function filePurpose(doc = {}) {
  return String(doc?.purpose || doc?.type || doc?.folder || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
}

export function financialFileReferenceSets(state = {}) {
  const ids = new Set();
  const storageKeys = new Set();
  const visit = (value, depth = 0) => {
    if (!value || depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = String(key).toLowerCase();
      if (['id','fileid','receiptfileid'].includes(normalizedKey) && typeof item === 'string' && item.trim()) ids.add(item.trim());
      if (['storagekey','storedname','stored_name'].includes(normalizedKey) && typeof item === 'string' && item.trim()) storageKeys.add(item.trim());
      if (item && typeof item === 'object') visit(item, depth + 1);
    }
  };

  // Payment rows and per-case ledger objects are financial records and are
  // permanently exempt from ordinary 90-day attachment retention.
  visit(Array.isArray(state.payments) ? state.payments : []);
  for (const record of (Array.isArray(state.cases) ? state.cases : [])) {
    visit(record?.ledger || null);
    visit(record?.finance || null);
    visit(record?.paymentLedger || null);
  }
  return { ids, storageKeys };
}

export function isFinancialRetentionProtected(doc = {}, references = { ids:new Set(), storageKeys:new Set() }) {
  const purpose = filePurpose(doc);
  if (purpose === 'PAYMENT_RECEIPT' || purpose === 'FINANCE' || purpose === 'FINANCIAL' || purpose === 'BANK_LEDGER' || purpose === 'LEDGER') return true;
  const id = String(doc?.id || doc?.fileId || '').trim();
  const storageKey = String(doc?.storageKey || doc?.storedName || doc?.stored_name || '').trim();
  return Boolean((id && references.ids?.has(id)) || (storageKey && references.storageKeys?.has(storageKey)));
}

export function isPermanentFileProtected(doc = {}, references) {
  const purpose = filePurpose(doc);
  if (purpose === 'PROFILE' || purpose === 'PROFILE_PHOTO' || purpose === 'AVATAR') return true;
  return isFinancialRetentionProtected(doc, references);
}

// Two calendar months after the last qualifying completion/archive event.
// Never use upload age alone to expire an active case's attachments.
export const DEFAULT_FILE_RETENTION_MONTHS = 2;
const CASE_ATTACHMENT_FIELDS = ['documents','completedFiles','sourceFiles','workFiles','files','uploads','attachments'];
const TERMINAL_STATUSES = new Set(['COMPLETED','CLOSED','APPROVED','FINAL_APPROVED','ARCHIVED']);
const HOLDS = ['legalHold','litigationHold','disputeHold','retentionHold','complianceHold','auditHold','preservationHold','openDispute','disputed','underDispute'];
const normalizeStatus = value => String(value || '').trim().toUpperCase().replace(/[\s-]+/g,'_');
const fileId = d => String(d?.id || d?.fileId || '').trim();
const storageKey = d => String(d?.storageKey || d?.storedName || d?.stored_name || '').trim();
const caseKeys = c => [c?.id,c?.caseId,c?.displayId,c?.projectId].map(v=>String(v || '').trim()).filter(Boolean);

function addCalendarMonthsUtc(startMs, months = DEFAULT_FILE_RETENTION_MONTHS) {
  const date = new Date(startMs);
  if (!Number.isFinite(date.getTime())) return 0;
  const target = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+Math.max(1,Math.round(Number(months)||2)),1,
    date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds(),date.getUTCMilliseconds()));
  const monthEnd = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth()+1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(),monthEnd));
  return target.getTime();
}
export function fileAgeAnchorMs(doc = {}) {
  return timestampMs(doc?.uploadedAt || doc?.storedAt || doc?.createdAt || doc?.timestamp || 0);
}
export function caseRetentionAnchorMs(record = {}) {
  const status = normalizeStatus(record.status || record.reviewStatus);
  if (status.includes('REOPEN') || status.includes('REVISION') || status.includes('PROGRESS') ||
      (status && !TERMINAL_STATUSES.has(status))) return 0;
  const archived = record.archived === true || record.isArchived === true || status === 'ARCHIVED';
  const closed = TERMINAL_STATUSES.has(status) && status !== 'ARCHIVED';
  if (!archived && !closed) return 0;
  if (HOLDS.some(key => record[key] === true)) return 0;
  const disputeStatus = normalizeStatus(record.disputeStatus || record.legalStatus || '');
  if (['OPEN','PENDING','DISPUTED','UNDER_REVIEW','IN_PROGRESS','ON_HOLD'].includes(disputeStatus)) return 0;
  // Approval by itself is not case completion; demand a dated completion/closure event.
  const completedAt = closed ? Math.max(timestampMs(record.completedAt),timestampMs(record.closedAt)) : 0;
  const archivedAt = archived ? Math.max(
    timestampMs(record.archivedAt),timestampMs(record.archivedOn)
  ) : 0;
  // A status alone (or updatedAt) does not establish a trustworthy end date.
  return Math.max(completedAt, archivedAt);
}
function buildFileOwners(state = {}) {
  const caseByAlias = new Map(), idOwners = new Map(), keyOwners = new Map();
  const addOwner = (map, key, c) => {
    if (!key) return;
    if (!map.has(key)) map.set(key,new Set());
    map.get(key).add(c);
  };
  for (const c of (Array.isArray(state.cases) ? state.cases : [])) {
    for (const key of caseKeys(c)) {
      if (!caseByAlias.has(key)) caseByAlias.set(key,new Set());
      caseByAlias.get(key).add(c);
    }
    const docs = CASE_ATTACHMENT_FIELDS.flatMap(field=>Array.isArray(c?.[field])?c[field]:[]);
    if (c?.file) docs.push(c.file);
    for (const doc of docs) {
      addOwner(idOwners,fileId(doc),c);
      addOwner(keyOwners,storageKey(doc),c);
    }
  }
  const chatIds=new Set(),chatKeys=new Set();
  for (const message of (Array.isArray(state.teamChat)?state.teamChat:[])) {
    const docs=[...(Array.isArray(message.files)?message.files:[]),
      ...(Array.isArray(message.attachments)?message.attachments:[]),...(message.file?[message.file]:[])];
    for (const doc of docs) {
      if (fileId(doc)) chatIds.add(fileId(doc));
      if (storageKey(doc)) chatKeys.add(storageKey(doc));
    }
  }
  return {caseByAlias,idOwners,keyOwners,chatIds,chatKeys};
}
function eligibility(doc, {state={},nowMs=Date.now(),retentionMonths=DEFAULT_FILE_RETENTION_MONTHS,references,owners}={}) {
  if (!doc || typeof doc !== 'object') return {eligible:false,reason:'INVALID'};
  if (['DELETED','EXPIRED'].includes(normalizeStatus(doc.storageStatus))) return {eligible:false,reason:'ALREADY_REMOVED'};
  if (isPermanentFileProtected(doc,references || financialFileReferenceSets(state))) return {eligible:false,reason:'PERMANENT'};
  if (HOLDS.some(key=>doc[key]===true)) return {eligible:false,reason:'LEGAL_HOLD'};
  const index=owners || buildFileOwners(state),id=fileId(doc),key=storageKey(doc);
  if ((id && index.chatIds.has(id)) || (key && index.chatKeys.has(key))) return {eligible:false,reason:'SHARED_CHAT_REFERENCE'};
  const associated=new Set([...(id?index.idOwners.get(id)||[]:[]),...(key?index.keyOwners.get(key)||[]:[])]);
  const claimed=String(doc.caseId || doc.projectId || '').trim();
  if (claimed) {
    const matches=index.caseByAlias.get(claimed);
    if (!matches || !matches.size) return {eligible:false,reason:'UNKNOWN_CASE'};
    for (const c of matches) associated.add(c);
  }
  if (!associated.size) return {eligible:false,reason:'UNASSOCIATED'};
  let latestAnchor=0;
  for (const record of associated) {
    const end=caseRetentionAnchorMs(record);
    if (!end) return {eligible:false,reason:'ACTIVE_OR_UNVERIFIED_CASE'};
    latestAnchor=Math.max(latestAnchor,end);
  }
  // If a file was added after case closure, do not delete it before two months
  // have elapsed since the later upload, even if completion is already old.
  latestAnchor=Math.max(latestAnchor,fileAgeAnchorMs(doc));
  if (!latestAnchor) return {eligible:false,reason:'UNKNOWN_AGE'};
  const dueAtMs=addCalendarMonthsUtc(latestAnchor,retentionMonths);
  return {eligible:Number(nowMs)>=dueAtMs,reason:Number(nowMs)>=dueAtMs?'DUE':'NOT_YET_DUE',dueAtMs};
}
export function shouldExpireFile(doc = {}, options = {}) {
  return eligibility(doc,options).eligible;
}
export function expirationPatch({nowMs=Date.now(),retentionMonths=DEFAULT_FILE_RETENTION_MONTHS,actor='storage-retention'}={}) {
  return {
    storageStatus:'EXPIRED',
    expiredAt:new Date(nowMs).toISOString(),
    expiredBy:actor,
    retentionMonths:Number(retentionMonths),
    expiryReason:'Automatic ' + Number(retentionMonths) + '-calendar-month post-case retention',
    url:'',previewUrl:'',downloadUrl:''
  };
}
function patchMatchingDocs(list, ids, patch) {
  if (!Array.isArray(list)) return false;
  let changed=false;
  for (const doc of list) {
    if (!doc || !ids.has(fileId(doc))) continue;
    Object.assign(doc,patch);changed=true;
  }
  return changed;
}
export function applyFileRetentionToState(state={}, {
  nowMs=Date.now(),retentionMonths=DEFAULT_FILE_RETENTION_MONTHS,
  actor='storage-retention',dryRun=false
}={}) {
  const references=financialFileReferenceSets(state);
  const owners=buildFileOwners(state);
  const expiredIds=new Set(),expiredStorageKeys=new Set();
  const protectedIds=[],unknownAgeIds=[],skippedByReason={};
  const patch=expirationPatch({nowMs,retentionMonths,actor});
  for (const doc of (Array.isArray(state.files)?state.files:[])) {
    if (!doc || !fileId(doc)) continue;
    const result=eligibility(doc,{state,nowMs,retentionMonths,references,owners});
    if (!result.eligible) {
      skippedByReason[result.reason]=(skippedByReason[result.reason]||0)+1;
      if (['PERMANENT','LEGAL_HOLD','SHARED_CHAT_REFERENCE','ACTIVE_OR_UNVERIFIED_CASE'].includes(result.reason)) protectedIds.push(fileId(doc));
      if (['UNKNOWN_AGE','UNASSOCIATED','UNKNOWN_CASE'].includes(result.reason)) unknownAgeIds.push(fileId(doc));
      continue;
    }
    if (!dryRun) Object.assign(doc,patch);
    expiredIds.add(fileId(doc));
    if (storageKey(doc)) expiredStorageKeys.add(storageKey(doc));
  }
  const changedCaseIds=[],changedMessageIds=[];
  if (!dryRun && expiredIds.size) {
    for (const record of (Array.isArray(state.cases)?state.cases:[])) {
      let changed=false;
      for (const field of CASE_ATTACHMENT_FIELDS) changed=patchMatchingDocs(record?.[field],expiredIds,patch)||changed;
      if (record?.file && expiredIds.has(fileId(record.file))) {Object.assign(record.file,patch);changed=true;}
      if (changed) changedCaseIds.push(String(record.id||record.caseId||''));
    }
    for (const message of (Array.isArray(state.teamChat)?state.teamChat:[])) {
      let changed=false;
      changed=patchMatchingDocs(message?.files,expiredIds,patch)||changed;
      changed=patchMatchingDocs(message?.attachments,expiredIds,patch)||changed;
      if (message.file && expiredIds.has(fileId(message.file))) {Object.assign(message.file,patch);changed=true;}
      if (changed) changedMessageIds.push(String(message.id||''));
    }
  }
  return {dryRun,expiredIds:[...expiredIds],expiredStorageKeys:[...expiredStorageKeys],
    changedCaseIds:changedCaseIds.filter(Boolean),changedMessageIds:changedMessageIds.filter(Boolean),
    protectedIds,unknownAgeIds,skippedByReason,retentionMonths:Number(retentionMonths)};
}
