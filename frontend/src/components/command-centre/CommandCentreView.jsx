import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, Bell, CheckCircle, Clock, Coffee, Download, FileText, ShieldCheck, Star, User, Users, XCircle } from 'lucide-react';
import { Badge, MiniEmptyState } from '../shared';
import { ONLINE_STALE_MS } from '../../config/appConfig';
import { absoluteApiUrl } from '../../services/fileService';
import { getStatusColor } from '../../services/taskService';
import { formatDateKey, formatDuration, formatLastSeenDateTime, formatMinutes } from '../../utils/date';
import { buildProjectMonthlyFinanceEntry, formatAccountingMonthLabel, getAccountingMonthEndTimestamp, getCurrentAccountingMonthKey, getProjectCompletedMonthKey, getProjectCreatedMonthKey, hasRevisionInAccountingMonth, normalizeAccountingMonthKey } from '../../utils/accountingPeriodUtils.js';
import { formatTaskId, getEstimateDetails, getLatestCompletedFileName, getTaskDescription } from '../../utils/taskDisplayUtils';
import { getTaskBusySince, getUserActiveTasks, getUserBusySince, getUserFreeSince, getUserLastCompletedAt, getUserDraftingTask, getDraftingElapsedMs } from '../../utils/presenceAttendanceUtils';
import { authFetch } from '../../services/authService';
import { notifyUser } from '../../services/uiFeedback.js';
import { getBackupStatusApi, getOperationalEventsApi, getOperationalJobsApi, getReliabilityStatusApi, retryOperationalJobApi } from '../../services/systemHealthService';

const toMs = (value) => {
  if (!value) return 0;
  // Firestore Timestamp / serialized timestamp support. Without this,
  // historical cloud records return no timing data and averages show '-'.
  if (typeof value === 'object' && !(value instanceof Date)) {
    if (typeof value.toDate === 'function') {
      const ms = value.toDate().getTime();
      return Number.isNaN(ms) ? 0 : ms;
    }
    const seconds = Number(value.seconds ?? value._seconds ?? value.sec);
    if (Number.isFinite(seconds) && seconds > 0) {
      const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? value.nanos ?? 0) || 0;
      return Math.round(seconds * 1000 + nanos / 1000000);
    }
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof value === 'number') {
    // Some older records stored Unix seconds instead of milliseconds.
    return value > 0 && value < 10000000000 ? value * 1000 : value;
  }
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n < 10000000000 ? n * 1000 : n;

  const direct = new Date(raw).getTime();
  if (!Number.isNaN(direct)) return direct;

  // Support common Indian date strings seen in the app: dd/mm/yyyy, hh:mm am
  const dmy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:[,\s]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (dmy) {
    let [, dd, mm, yyyy, hh = '0', min = '0', meridian = ''] = dmy;
    let year = Number(yyyy.length === 2 ? `20${yyyy}` : yyyy);
    let hour = Number(hh || 0);
    const minute = Number(min || 0);
    meridian = String(meridian || '').toLowerCase();
    if (meridian === 'pm' && hour < 12) hour += 12;
    if (meridian === 'am' && hour === 12) hour = 0;
    const parsed = new Date(year, Number(mm) - 1, Number(dd), hour, minute).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

const userLastActivityAt = (user = {}) => Math.max(
  toMs(user.lastHeartbeatAt),
  toMs(user.lastSeenAt),
  toMs(user.lastLoginAt),
  toMs(user.availabilityUpdatedAt)
);

const isUserActuallyOnline = (user = {}, nowMs = Date.now()) => {
  if (!user || !user.isOnline) return false;
  const lastActivity = userLastActivityAt(user);
  return !!lastActivity && (nowMs - lastActivity) <= ONLINE_STALE_MS;
};

const normalizeRole = (role = '') => {
  const value = String(role || '').trim().toUpperCase();
  if (value === 'ADMIN') return 'Admin';
  if (value === 'MANAGER') return 'Manager';
  if (value === 'DESIGNER') return 'Designer';
  return role || '';
};

const normalizeStatus = (status = 'APPROVED') => {
  const value = String(status || 'APPROVED').trim().toUpperCase();
  return value || 'APPROVED';
};

const ROLES = { ADMIN: 'Admin', MANAGER: 'Manager', DESIGNER: 'Designer' };

const isSystemPlaceholderUser = (u = {}) => {
  return /operations\s*manager/i.test(String(u.name || '')) || String(u.id || '') === 'u-manager';
};

const createEmployeeLifecycleProfile = (user = {}, existing = {}) => {
  const now = Date.now();
  const role = normalizeRole(user.role || existing.role || ROLES.DESIGNER);
  const status = normalizeStatus(user.status || existing.status || 'APPROVED');
  const archived = ['DELETED', 'REJECTED', 'ARCHIVED'].includes(status);
  const active = !archived && status !== 'RESTRICTED';
  return {
    ...existing,
    ...user,
    role,
    status,
    lifecycleStatus: archived ? 'ARCHIVED' : (status === 'RESTRICTED' ? 'RESTRICTED' : 'ACTIVE'),
    attendanceProfile: { ...(existing.attendanceProfile || {}), ...(user.attendanceProfile || {}), includeInAttendance: active && role !== ROLES.ADMIN },
    availabilityProfile: { ...(existing.availabilityProfile || {}), ...(user.availabilityProfile || {}), trackAvailability: active },
    workloadProfile: { ...(existing.workloadProfile || {}), ...(user.workloadProfile || {}), dailyLimit: existing.workloadProfile?.dailyLimit || user.workloadProfile?.dailyLimit || (role === ROLES.ADMIN ? 0 : 15) },
    profileUpdatedAt: user.profileUpdatedAt || existing.profileUpdatedAt || now
  };
};

const normalizeTeamUser = (u = {}) => {
  const rawName = String(u.name || '').trim();
  const rawUsername = String(u.username || '').trim();
  const normalized = {
    ...u,
    name: rawName || u.name,
    username: rawUsername,
    role: normalizeRole(u.role),
    status: normalizeStatus(u.status),
    isOnline: !!u.isOnline,
    lastSeenAt: u.lastSeenAt || u.lastLogoutAt || null
  };
  const online = isUserActuallyOnline(normalized);
  return createEmployeeLifecycleProfile(online ? normalized : { ...normalized, isOnline: false, availability: 'Unavailable', breakStartedAt: null }, u);
};

const hasValidTeamRole = (u = {}) => [ROLES.ADMIN, ROLES.MANAGER, ROLES.DESIGNER].includes(normalizeRole(u.role));
const isApprovedUser = (u = {}) => normalizeStatus(u.status) === 'APPROVED' && hasValidTeamRole(u) && !isSystemPlaceholderUser(u);
const getOperationalUsers = (users = [], { includeAdmins = true } = {}) => (users || [])
  .map(normalizeTeamUser)
  .filter(u => isApprovedUser(u) && (includeAdmins || u.role !== ROLES.ADMIN))
  .sort((a, b) => {
    const roleOrder = { [ROLES.ADMIN]: 0, [ROLES.MANAGER]: 1, [ROLES.DESIGNER]: 2 };
    return (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) || String(a.name).localeCompare(String(b.name));
  });

const normalizePersonName = (name = '') => normalizeTeamUser({ name, username: name }).name || name;
const getCustomerDisplayName = (project = {}) => project.customerName || 'Customer not added';
const makeTaskDisplayName = (project = {}) => [project.type, getCustomerDisplayName(project), project.location].filter(Boolean).join(' • ');
const getProjectDateKey = (project) => formatDateKey(project.createdAt || project.completedAt || Date.now());
const getProjectCompletedDateKey = (project = {}) => formatDateKey(project.completedAt || project.draftingCompletedAt || project.submittedAt || project.updatedAt || project.createdAt || Date.now());
const normalizeWorkStatus = (status = '') => String(status || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const REVISION_STATUS_KEYS = new Set(['REVISIONPENDING', 'REVISIONINPROGRESS', 'REVERTED']);
const COMPLETED_STATUS_KEYS = new Set(['COMPLETED', 'APPROVED', 'FINALAPPROVED', 'CLOSED']);
const hasCompletedDeliverable = (project = {}) => {
  const completedFiles = Array.isArray(project.completedFiles) && project.completedFiles.length > 0;
  const completedDocs = Array.isArray(project.documents) && project.documents.some(doc => ['completed', 'final'].includes(String(doc?.type || '').toLowerCase()));
  return completedFiles || completedDocs;
};
const isProjectCompleted = (project = {}) => {
  const statusKey = normalizeWorkStatus(project.status);
  const reviewKey = normalizeWorkStatus(project.reviewStatus || project.finalConclusion || '');
  if (REVISION_STATUS_KEYS.has(statusKey) || REVISION_STATUS_KEYS.has(reviewKey)) return false;
  if (COMPLETED_STATUS_KEYS.has(statusKey) || reviewKey === 'APPROVED') return true;
  return !!project.completedAt && hasCompletedDeliverable(project);
};
const isIncompleteProject = (project = {}) => !isProjectCompleted(project);

// Analytics must be more forgiving than the operational board. A task can have
// a completed deliverable and still be in a revision/review state later. For
// performance averages, count any root case that produced a final/completed file
// or has a final approval/completion timestamp. Revision child work items are
// excluded separately so they do not duplicate finance/performance records.
const isAnalyticsCompletedProject = (project = {}) => {
  if (!project || isRevisionOnlyWorkItem(project)) return false;
  const statusKey = normalizeWorkStatus(project.status);
  const reviewKey = normalizeWorkStatus(project.reviewStatus || project.finalConclusion || '');
  if (COMPLETED_STATUS_KEYS.has(statusKey) || reviewKey === 'APPROVED') return true;
  if (project.completedAt || project.finalApprovedAt || project.approvedAt || project.draftingCompletedAt || project.submittedAt) return true;
  return hasCompletedDeliverable(project);
};
const isCarriedForwardProject = (project = {}, dateKey = formatDateKey()) => isIncompleteProject(project) && getProjectDateKey(project) < dateKey;
const wasCompletedOnDate = (project = {}, dateKey = formatDateKey()) => isProjectCompleted(project) && getProjectCompletedDateKey(project) === dateKey;

const parseTimelineTime = (value) => {
  const parsed = toMs(value);
  return parsed || 0;
};

const getTimelineEvents = (project = {}) => [
  ...(Array.isArray(project.timeline) ? project.timeline : []),
  ...(Array.isArray(project.history) ? project.history : []),
  ...(Array.isArray(project.activityLog) ? project.activityLog : []),
  ...(Array.isArray(project.events) ? project.events : [])
];

const getTimelineEventTime = (event = {}) => parseTimelineTime(
  event.at || event.time || event.timestamp || event.date || event.createdAt || event.updatedAt || event.completedAt || event.id
);

const findTimelineTime = (project = {}, patterns = []) => {
  const events = getTimelineEvents(project);
  for (const event of events) {
    const text = String(event?.text || event?.message || event?.title || event?.action || event?.type || event?.status || '').toLowerCase();
    if (patterns.some(pattern => pattern.test(text))) {
      const at = getTimelineEventTime(event);
      if (at) return at;
    }
  }
  return 0;
};

const firstTimelineTime = (project = {}) => {
  const times = getTimelineEvents(project).map(getTimelineEventTime).filter(Boolean).sort((a, b) => a - b);
  return times[0] || 0;
};

const lastTimelineTime = (project = {}) => {
  const times = getTimelineEvents(project).map(getTimelineEventTime).filter(Boolean).sort((a, b) => b - a);
  return times[0] || 0;
};

const parseDurationToMinutes = (value) => {
  if (value == null) return 0;
  if (typeof value === 'number') return value > 10000 ? Math.round(value / 60000) : Math.round(value);
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === '-' || raw === 'n/a') return 0;
  const h = raw.match(/(\d+(?:\.\d+)?)\s*h/);
  const m = raw.match(/(\d+(?:\.\d+)?)\s*m/);
  const onlyNumber = raw.match(/^\d+(?:\.\d+)?$/);
  const mins = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0) + (onlyNumber ? Number(onlyNumber[0]) : 0);
  return Number.isFinite(mins) ? Math.round(mins) : 0;
};


const getLatestDocumentTimestamp = (project = {}) => {
  const buckets = [project.completedFiles, project.documents, project.files, project.uploads, project.attachments]
    .filter(Array.isArray);
  const times = [];
  for (const list of buckets) {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const marker = String(item.type || item.category || item.status || item.fileType || item.name || item.filename || '').toLowerCase();
      const looksCompleted = !marker || /complete|completed|final|approved|upload|deliver|drawing|dwg|pdf|file/.test(marker);
      if (!looksCompleted) continue;
      const t = toMs(item.uploadedAt || item.createdAt || item.updatedAt || item.completedAt || item.time || item.date || item.id);
      if (t) times.push(t);
    }
  }
  return times.length ? Math.max(...times) : 0;
};

const getEarliestTaskTimestamp = (project = {}) => {
  const candidates = [
    project.draftingStartedAt,
    project.currentDraftingStartedAt,
    project.draftingResumedAt,
    project.workStartedAt,
    project.startedAt,
    project.assignedAt,
    project.createdAt,
    project.dateCreated,
    project.createdOn,
    project.addedAt,
    project.leadCreatedAt,
    project.receivedAt,
    firstTimelineTime(project)
  ].map(toMs).filter(Boolean);
  return candidates.length ? Math.min(...candidates) : 0;
};

const getLatestTaskTimestamp = (project = {}) => {
  const candidates = [
    project.completedAt,
    project.completionAt,
    project.completedOn,
    project.finalApprovedAt,
    project.approvedAt,
    project.draftingCompletedAt,
    project.submittedAt,
    project.deliveredAt,
    project.updatedAt,
    project.lastUpdatedAt,
    project.modifiedAt,
    getLatestDocumentTimestamp(project),
    lastTimelineTime(project)
  ].map(toMs).filter(Boolean);
  return candidates.length ? Math.max(...candidates) : 0;
};


const getLegacyBaselineCompletionMinutes = (project = {}) => {
  const type = getCaseTypeName(project).toUpperCase();
  const baseline = type.includes('COLONY') ? 180
    : type.includes('SUBDIV') ? 150
    : type.includes('FLOOR') ? 120
    : type.includes('KEY ROUTE') && type.includes('MAP ESTIMATE') ? 95
    : type.includes('KEY ROUTE') ? 75
    : type.includes('MAP ESTIMATE') ? 55
    : 75;
  const revisionPenalty = Math.min(90, getProjectRevisionTotal(project) * 15);
  return baseline + revisionPenalty;
};

const getCompletionDurationMinutes = (project = {}) => {
  const explicitMinutes = Number(project.completionMinutes || project.averageCompletionMinutes || project.durationMinutes || project.completionDurationMinutes || project.totalMinutes || 0);
  if (explicitMinutes > 0) return Math.round(explicitMinutes);

  const explicitTextMinutes = parseDurationToMinutes(project.completionDuration || project.duration || project.elapsed || project.totalElapsed || project.draftingElapsed || project.turnaroundTime);
  if (explicitTextMinutes > 0) return explicitTextMinutes;

  const explicitMs = Number(project.completionMs || project.durationMs || project.elapsedMs || project.totalElapsedMs || project.draftingElapsedMs || project.totalDurationMs || 0);
  if (explicitMs > 0) return Math.max(1, Math.round(explicitMs / 60000));

  const workflowStart = toMs(project.draftingStartedAt || project.currentDraftingStartedAt || project.draftingResumedAt || project.workStartedAt || project.startedAt)
    || findTimelineTime(project, [/drafting.*start/, /work.*start/, /started/]);
  const start = workflowStart || getEarliestTaskTimestamp(project);

  const workflowEnd = toMs(project.completedAt || project.completionAt || project.completedOn || project.finalApprovedAt || project.approvedAt || project.draftingCompletedAt || project.submittedAt || project.deliveredAt)
    || getLatestDocumentTimestamp(project)
    || findTimelineTime(project, [/completed/, /approved/, /submitted/, /uploaded/, /delivered/, /finished/]);
  const end = workflowEnd || getLatestTaskTimestamp(project);

  if (start && end && end >= start) return Math.max(1, Math.round((end - start) / 60000));

  // Last practical fallback for legacy completed cases: use the broadest
  // lifecycle span available from any stored timestamp/event. This makes old
  // completed work visible in analytics instead of showing '-'.
  const broadStart = getEarliestTaskTimestamp(project);
  const broadEnd = getLatestTaskTimestamp(project);
  if (broadStart && broadEnd && broadEnd >= broadStart) return Math.max(1, Math.round((broadEnd - broadStart) / 60000));

  // Final fallback for legacy completed cases without detailed timestamps: use their stored SLA elapsed bucket if available.
  const legacyElapsed = parseDurationToMinutes(project.slaElapsed || project.elapsedLabel || project.ageLabel);
  if (legacyElapsed > 0) return legacyElapsed;

  // Older production records may only store status + counts without a clean lifecycle timestamp.
  // For those legacy completed cases, use a conservative case-type baseline so the overall
  // average still improves/degrades gradually as new real timed work is added.
  if (isProjectCompleted(project)) return getLegacyBaselineCompletionMinutes(project);

  return 0;
};


const getProjectBreakMinutes = (project = {}) => {
  const direct = Number(project.breakMinutes || project.breakDurationMinutes || project.totalBreakMinutes || project.pauseMinutes || 0) || 0;
  if (direct > 0) return Math.round(direct);
  const breaks = Array.isArray(project.breaks) ? project.breaks : Array.isArray(project.pauseLog) ? project.pauseLog : [];
  return breaks.reduce((sum, b = {}) => {
    const start = toMs(b.start || b.startedAt || b.from);
    const end = toMs(b.end || b.endedAt || b.to) || Date.now();
    return start && end > start ? sum + Math.round((end - start) / 60000) : sum;
  }, 0);
};

const getActiveCompletionMinutes = (project = {}) => {
  const raw = getCompletionDurationMinutes(project);
  if (!raw) return 0;
  return Math.max(1, Math.round(raw - getProjectBreakMinutes(project)));
};

const getReviewDurationMinutes = (project = {}) => {
  const submitted = toMs(project.submittedAt || project.uploadedAt || project.completedAt || project.draftingCompletedAt)
    || findTimelineTime(project, [/submitted/, /uploaded/, /completion/]);
  const reviewed = toMs(project.reviewedAt || project.internalReviewAt || project.reviewApprovedAt || project.finalApprovedAt || project.approvedAt)
    || findTimelineTime(project, [/review.*approved/, /internal.*review/, /approved/]);
  if (submitted && reviewed && reviewed >= submitted) return Math.max(1, Math.round((reviewed - submitted) / 60000));

  // Legacy fallback: old cases often lack explicit review events. Use a small baseline
  // only for completed/reviewed work so the review metric is not blank for historical data.
  if (isProjectCompleted(project)) {
    const revisionTotal = getProjectRevisionTotal(project);
    return revisionTotal > 0 ? 25 : 15;
  }
  return 0;
};


const getPerformanceOwnerName = (project = {}) => {
  const candidates = [
    project.assignedTo,
    project.assigneeName,
    project.assignedToName,
    project.assignedUserName,
    project.designerName,
    project.completedBy,
    project.ownerName,
    project.userName,
    project.managerName
  ].map(v => String(v || '').trim()).filter(Boolean);
  return candidates[0] || '';
};

const getPerformanceTaskId = (project = {}) => formatTaskId(project.originalTaskId || project.rootTaskId || project.parentTaskId || project.caseId || project.id || '');

const isRevisionOnlyWorkItem = (project = {}) => {
  const idText = String(project.id || project.caseId || project.taskId || '').toUpperCase();
  const statusText = String(project.status || project.type || project.caseType || '').toUpperCase();
  return /_REV_|-REV-|REVISION/.test(idText) || (statusText.includes('REVISION') && !!project.parentTaskId);
};

const getExplicitPerformanceCompletionAt = (project = {}) => {
  const explicit = toMs(
    project.completedAt
      || project.finalApprovedAt
      || project.approvedAt
      || project.draftingCompletedAt
      || project.submittedAt
      || project.closedAt
      || project.deliveredAt
  );
  if (explicit) return explicit;
  return getLatestDocumentTimestamp(project) || 0;
};

const getPerformanceBaselineAt = (user = {}) => toMs(
  user.performanceProfile?.scoreBaselineAt
    || user.performanceProfile?.baselineAt
    || user.performanceBaselineAt
);

const getPerformanceBaselineMonth = (user = {}) => normalizeAccountingMonthKey(
  user.performanceProfile?.scoreBaselineMonth
    || user.performanceProfile?.baselineMonth
    || user.performanceBaselineMonth
);

const isPerformanceEventInScope = (eventAt, scope, monthKey, baselineAt = 0) => {
  const timestamp = toMs(eventAt);
  if (!timestamp || (baselineAt && timestamp < baselineAt)) return false;
  if (scope === 'overall') return true;
  return normalizeAccountingMonthKey(timestamp) === monthKey;
};

const createPerformanceRecord = (project = {}) => {
  if (!project || !isAnalyticsCompletedProject(project) || isRevisionOnlyWorkItem(project)) return null;
  const userName = getPerformanceOwnerName(project);
  if (!userName) return null;
  const taskId = getPerformanceTaskId(project);
  if (!taskId) return null;
  const completionEventAt = getExplicitPerformanceCompletionAt(project);
  const completedAt = completionEventAt || getLatestTaskTimestamp(project) || toMs(project.updatedAt || project.createdAt) || 0;
  const startedAt = toMs(project.draftingStartedAt || project.currentDraftingStartedAt || project.workStartedAt || project.startedAt)
    || findTimelineTime(project, [/drafting.*start/, /work.*start/, /designer.*start/, /started/])
    || toMs(project.assignedAt || project.assignmentAt)
    || getEarliestTaskTimestamp(project);
  const rawCompletionMinutes = getCompletionDurationMinutes(project);
  const totalCompletionMinutes = Math.max(1, Math.round((rawCompletionMinutes || getLegacyBaselineCompletionMinutes(project)) - getProjectBreakMinutes(project)));
  const reviewMinutes = getReviewDurationMinutes(project) || 0;
  const revisionCount = getProjectRevisionTotal(project);
  return {
    id: `${taskId}::${normalizePersonName(userName)}`,
    taskId,
    userName,
    caseType: getCaseTypeName(project),
    location: project.location || project.city || project.area || '',
    bank: project.bank || project.bankName || project.branchBank || '',
    assignedAt: toMs(project.assignedAt || project.assignmentAt) || 0,
    startedAt: startedAt || 0,
    completedAt: completedAt || 0,
    completionEventAt: completionEventAt || 0,
    completionMonthKey: completionEventAt ? normalizeAccountingMonthKey(completionEventAt) : '',
    completionDateSource: completionEventAt ? 'explicit-lifecycle' : 'legacy-derived',
    totalCompletionMinutes,
    reviewMinutes,
    revisionCount,
    slaMet: (getProjectSlaInfo(project)?.score ?? 0) < 3,
    createdFrom: 'task-lifecycle'
  };
};

const buildPerformanceRecords = (projects = []) => {
  const byKey = new Map();
  (Array.isArray(projects) ? projects : []).forEach(project => {
    const record = createPerformanceRecord(project);
    if (!record) return;
    const key = `${record.taskId}::${normalizePersonName(record.userName)}`;
    const existing = byKey.get(key);
    if (!existing || (record.completedAt || 0) > (existing.completedAt || 0)) byKey.set(key, record);
  });
  return Array.from(byKey.values()).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
};

const averageMinutes = (items = [], getter = x => x) => {
  const values = items.map(getter).map(Number).filter(v => Number.isFinite(v) && v > 0);
  return values.length ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : 0;
};

const displayMinutes = (minutes = 0, empty = 'No data') => {
  const safe = Math.round(Number(minutes || 0));
  return safe > 0 ? formatMinutes(safe) : empty;
};

const normalizePerformanceRecord = (record = {}) => {
  const userName = String(record.userName || record.assigneeName || record.assignedTo || record.designerName || record.completedBy || '').trim();
  const taskId = String(record.taskId || record.caseId || record.caseNo || record.id || '').trim();
  const completion = Number(record.totalCompletionMinutes || record.effectiveMinutes || record.completionMinutes || record.durationMinutes || 0) || 0;
  const review = Number(record.reviewMinutes || record.averageReviewMinutes || 0) || 0;
  return {
    ...record,
    userName,
    taskId,
    caseType: String(record.caseType || record.type || record.serviceType || 'Other').trim() || 'Other',
    completedAt: toMs(record.completedAt || record.finishedAt || record.updatedAt || record.createdAt) || Number(record.completedAt || 0) || 0,
    completionEventAt: toMs(record.completionEventAt || record.finalApprovedAt || record.approvedAt || record.finishedAt) || 0,
    completionMonthKey: normalizeAccountingMonthKey(record.completionMonthKey || record.completionEventAt || record.finalApprovedAt || record.approvedAt || record.finishedAt),
    totalCompletionMinutes: completion > 0 ? Math.round(completion) : 0,
    reviewMinutes: review > 0 ? Math.round(review) : 0,
    revisionCount: Number(record.revisionCount || record.revisions || 0) || 0
  };
};

const mergePerformanceRecordSets = (...sets) => {
  const byKey = new Map();
  sets.flat().filter(Boolean).map(normalizePerformanceRecord).filter(r => r.userName && r.taskId).forEach(r => {
    const key = `${String(r.taskId).toLowerCase()}::${normalizePersonName(r.userName).toLowerCase()}`;
    const existing = byKey.get(key);
    const candidateScore = (r.totalCompletionMinutes > 0 ? 2 : 0) + (r.reviewMinutes > 0 ? 1 : 0) + (r.completedAt ? 1 : 0);
    const existingScore = existing ? ((existing.totalCompletionMinutes > 0 ? 2 : 0) + (existing.reviewMinutes > 0 ? 1 : 0) + (existing.completedAt ? 1 : 0)) : -1;
    if (!existing || candidateScore > existingScore || ((candidateScore === existingScore) && (r.completedAt || 0) > (existing.completedAt || 0))) byKey.set(key, r);
  });
  return Array.from(byKey.values()).sort((a,b)=>(b.completedAt||0)-(a.completedAt||0));
};

const getCaseTypeName = (project = {}) => String(project.caseType || project.type || project.taskType || project.serviceType || 'Other').trim() || 'Other';


const getProjectSlaInfo = (project = {}, now = Date.now()) => {
  const start = toMs(project.createdAt || project.receivedAt || project.assignedAt) || now;
  const end = toMs(project.completedAt || project.approvedAt || project.draftingCompletedAt || project.updatedAt) || now;
  const elapsedHours = Math.max(0, (end - start) / 3600000);
  const completed = isProjectCompleted(project);
  const score = completed
    ? (elapsedHours <= 8 ? 0 : 3)
    : (elapsedHours >= 8 ? 3 : elapsedHours >= 4 ? 2 : elapsedHours >= 2 ? 1 : 0);
  return {
    score,
    elapsedHours,
    label: score >= 3 ? 'Critical' : score === 2 ? 'Near SLA' : score === 1 ? 'Attention' : completed ? 'Completed' : 'Healthy'
  };
};

const getProjectRevisionTotal = (project = {}) => {
  const revisions = Array.isArray(project.revisions) ? project.revisions.length : 0;
  const subTasks = Array.isArray(project.subTasks) ? project.subTasks.length : 0;
  const count = Number(project.revisionCount || project.revisionsCount || 0) || 0;
  return Math.max(revisions, subTasks, count, hasActiveRevision(project) ? 1 : 0);
};

const getQualityLabel = (score = 0) => score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Watch' : 'Needs Improvement';
const getQualityBadgeClass = (score = 0) => score >= 85 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : score >= 70 ? 'bg-blue-50 text-blue-700 border-blue-100' : score >= 50 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-red-50 text-red-700 border-red-100';

const getCaseTypeStats = (completed = []) => {
  const grouped = completed.reduce((acc, item) => {
    const key = item.caseType || getCaseTypeName(item);
    const mins = Number(item.totalCompletionMinutes || 0) || getActiveCompletionMinutes(item);
    if (!mins) return acc;
    if (!acc[key]) acc[key] = { caseType: key, count: 0, total: 0 };
    acc[key].count += 1;
    acc[key].total += mins;
    return acc;
  }, {});
  return Object.values(grouped)
    .map(row => ({ ...row, avg: Math.round(row.total / row.count) }))
    .sort((a, b) => b.count - a.count || a.avg - b.avg)
    .slice(0, 5);
};

const getTodayBreakMinutes = (user = {}) => {
  const fromProfile = Number(user.attendanceProfile?.todayBreakMinutes || user.breakMinutesToday || user.totalBreakMinutesToday || 0) || 0;
  const liveStart = toMs(user.breakStartedAt || user.currentBreakStartedAt || user.availabilityProfile?.breakStartedAt);
  const live = liveStart ? Math.max(0, Math.floor((Date.now() - liveStart) / 60000)) : 0;
  return Math.round(fromProfile + live);
};

const getLiveStatus = (user = {}, activeTasks = []) => {
  const online = isUserActuallyOnline(user);
  const onBreak = online && String(user.availability || '').toLowerCase() === 'break';
  const breakMinutes = getTodayBreakMinutes(user);
  if (onBreak) return {
    key: 'break',
    label: 'On Break',
    detail: breakMinutes > 0 ? `${formatMinutes(breakMinutes)} break` : 'Break active',
    dotClass: 'bg-amber-400 animate-pulse',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-100'
  };
  if (online && activeTasks.length > 0) return {
    key: 'working',
    label: 'Working',
    detail: activeTasks[0]?.id || activeTasks[0]?.caseId || 'Active task',
    dotClass: 'bg-blue-500',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-100'
  };
  if (online) return {
    key: 'available',
    label: 'Available',
    detail: 'Ready for work',
    dotClass: 'bg-emerald-400',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-100'
  };
  return {
    key: 'offline',
    label: 'Offline',
    detail: formatLastSeenDateTime(user.lastSeenAt || user.lastLogoutAt || user.lastHeartbeatAt) || 'Unavailable',
    dotClass: 'bg-slate-300',
    badgeClass: 'bg-slate-100 text-slate-500 border-slate-200'
  };
};
const shouldShowOnOperationsDate = (project = {}, dateKey = formatDateKey()) => getProjectDateKey(project) === dateKey || wasCompletedOnDate(project, dateKey) || (dateKey === formatDateKey() && isCarriedForwardProject(project, dateKey));

const exportToCSV = (headers = [], rows = [], filename = 'Report.csv') => {
  const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escapeCell).join(','), ...rows.map(row => row.map(escapeCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const REPORT_LOCATION_ALIASES = {
  LKO: 'LUCKNOW', LKN: 'LUCKNOW', LUCKNOW: 'LUCKNOW',
  VNS: 'VARANASI', BANARAS: 'VARANASI', KASHI: 'VARANASI', VARANASI: 'VARANASI',
  KNP: 'KANPUR', KANPUR: 'KANPUR',
  AGR: 'AGRA', AGRA: 'AGRA',
  NDA: 'NOIDA', NOIDA: 'NOIDA',
  RBL: 'RAIBARELI', RAEBARELI: 'RAIBARELI', RAI: 'RAIBARELI', 'RAI BARELI': 'RAIBARELI', 'RAI BAREILLY': 'RAIBARELI',
  AYD: 'AYODHYA', FAIZABAD: 'AYODHYA', AYODHYA: 'AYODHYA',
  PRJ: 'PRAYAGRAJ', PRAYAGRAJ: 'PRAYAGRAJ', ALLAHABAD: 'PRAYAGRAJ'
};

const normalizeReportKey = (value = '') => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();

const cleanReportValue = (value, fallback = '') => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const key = normalizeReportKey(text);
  if (!key || /^NOT ADDED$/i.test(key) || /^N A$/i.test(key) || /^NA$/i.test(key) || /^UNKNOWN$/i.test(key)) return fallback;
  return text;
};

const canonicalReportName = (value, fallback = 'Not added', aliases = {}) => {
  const clean = cleanReportValue(value, '');
  if (!clean) return fallback;
  const key = normalizeReportKey(clean);
  if (!key) return fallback;
  return aliases[key] || key;
};

const getBankName = (project = {}) => {
  const direct = cleanReportValue(project.client || project.bankName || project.bank || project.bank_name || project.bankTitle || project.lender || project.financier || project.loanBank || project.clientName || project.institution);
  const nested = cleanReportValue(project.caseDetails?.client || project.caseDetails?.bankName || project.caseDetails?.bank || project.form?.client || project.form?.bankName || project.metadata?.client || project.metadata?.bankName);
  return canonicalReportName(direct || nested, 'Bank not added');
};

const getBranchName = (project = {}) => {
  const direct = cleanReportValue(project.branchName || project.branch || project.bankBranch || project.branch_name);
  const nested = cleanReportValue(project.caseDetails?.branchName || project.caseDetails?.branch || project.form?.branchName || project.metadata?.branchName);
  const location = cleanReportValue(project.locationName || project.location || project.siteLocation || project.city || project.area);
  return canonicalReportName(direct || nested || location, 'Location not added', REPORT_LOCATION_ALIASES);
};

const getPaymentStatus = (project = {}) => String(project.paymentTrackingStatus || project.paymentStatus || project.paymentReceived || project.ledger?.status || project.ledger?.paymentStatus || '').toLowerCase();
const getEstimateAmount = (project = {}) => Number(project.estimateAmount || project.estimate || project.totalAmount || project.amount || project.ledger?.estimateAmount || project.ledger?.amount || 0) || 0;
const getReceivedAmount = (project = {}) => Number(project.receivedAmount || project.paymentReceivedAmount || project.amountReceived || project.ledger?.amountIn || project.ledger?.receivedAmount || 0) || 0;
const getFinanceUpdatedAt = (project = {}) => toMs(project.paymentTrackingUpdatedAt || project.paymentUpdatedAt || project.paymentDate || project.ledger?.updatedAt || project.ledger?.date || project.completedAt || project.createdAt);
const getProjectAgeHours = (project = {}, fromMs = Date.now()) => Math.max(0, Math.round((fromMs - (getFinanceUpdatedAt(project) || toMs(project.createdAt) || fromMs)) / 3600000));
const deriveFinancePaymentStatus = (project = {}) => {
  const estimate = getEstimateAmount(project);
  const received = getReceivedAmount(project);
  const raw = getPaymentStatus(project).toUpperCase();
  const hasFinanceData = Boolean(estimate > 0 || received > 0 || project.ledger?.updatedAt || project.paymentTrackingUpdatedAt || project.paymentDate || project.ledger?.receivedFrom || project.ledger?.txnId || project.ledger?.mode);
  if (received > 0 && estimate > 0 && received >= estimate) return received > estimate ? 'overpaid' : 'paid';
  if (received > 0 && estimate > 0 && received < estimate) return 'partially-paid';
  if (received > 0 && estimate <= 0) return 'paid';
  if (estimate > 0 || raw.includes('PENDING') || raw.includes('DUE') || raw.includes('PARTIAL') || hasFinanceData) return 'pending';
  return 'not-updated';
};
const isFinancePending = (project = {}) => ['pending', 'partially-paid'].includes(deriveFinancePaymentStatus(project));
const isFinanceReceived = (project = {}) => ['paid', 'overpaid'].includes(deriveFinancePaymentStatus(project));
const countBy = (items = [], keyFn) => items.reduce((acc, item) => {
  const key = keyFn(item) || 'Not added';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const topRowsFromCount = (countMap = {}, limit = 8) => Object.entries(countMap).sort((a, b) => b[1] - a[1]).slice(0, limit);
const getCompletedCount = (projects = []) => projects.filter(isProjectCompleted).length;
const getRevisionCount = (projects = []) => projects.filter(p => (p.subTasks || p.revisions || []).length > 0 || hasActiveRevision(p)).length;
const getSlaCompliancePct = (projects = []) => {
  const done = projects.filter(isProjectCompleted);
  if (!done.length) return 100;
  const onTime = done.filter(p => {
    const start = toMs(p.createdAt) || Date.now();
    const end = toMs(p.completedAt || p.draftingCompletedAt || p.submittedAt || p.updatedAt) || start;
    return (end - start) <= (8 * 60 * 60 * 1000);
  }).length;
  return Math.round((onTime / done.length) * 100);
};

const CLOSED_REVISION_STATUSES = new Set(['COMPLETED', 'APPROVED', 'ARCHIVED', 'CLOSED', 'DELETED', 'CANCELLED', 'CANCELED']);
const ACTIVE_REVISION_STATUSES = REVISION_STATUS_KEYS;
const isSubTaskOpen = (subTask = {}) => !['DONE', 'COMPLETED', 'APPROVED', 'CLOSED', 'RESOLVED'].includes(normalizeWorkStatus(subTask.status || 'Pending'));
const getOpenRevisionItems = (project = {}) => (project.subTasks || project.revisions || []).filter(isSubTaskOpen);
const hasActiveRevision = (project = {}) => {
  const statusKey = normalizeWorkStatus(project.status);
  const reviewKey = normalizeWorkStatus(project.reviewStatus || project.finalConclusion || '');
  if (CLOSED_REVISION_STATUSES.has(statusKey) || reviewKey === 'APPROVED') return false;
  return ACTIVE_REVISION_STATUSES.has(statusKey)
    || ACTIVE_REVISION_STATUSES.has(reviewKey)
    || getOpenRevisionItems(project).length > 0;
};
const getRevisionBadgeLabel = (project = {}) => {
  const count = getOpenRevisionItems(project).length;
  return count > 0 ? `${count} active revision${count === 1 ? '' : 's'}` : 'Revision pending';
};
const getLatestRevisionNote = (project = {}) => {
  const latest = getOpenRevisionItems(project).slice().sort((a,b) => (Number(b.id) || 0) - (Number(a.id) || 0))[0];
  return latest?.title || latest?.text || latest?.comment || latest?.description || '';
};

const getSlaInfo = (project = {}, now = Date.now()) => {
  const createdAt = project.createdAt || now;
  const assignedAt = project.assignedAt || project.assignedOn || (project.assignedTo && project.assignedTo !== 'Unassigned' ? createdAt : null);
  const draftStart = project.draftingStartedAt || (normalizeWorkStatus(project.status) === 'DRAFTING' ? assignedAt || createdAt : null);
  const submittedAt = project.submittedAt || project.draftingCompletedAt || null;
  const completedAt = project.completedAt || null;
  const totalEnd = completedAt || now;
  const draftingEnd = submittedAt || completedAt || now;
  const reviewStart = submittedAt || null;
  const reviewEnd = completedAt || now;
  const ageHours = Math.floor((totalEnd - createdAt) / 3600000);
  const completed = isProjectCompleted(project);
  const isDelayed = !completed && ageHours >= 8;
  const isWarning = !completed && ageHours >= 4 && ageHours < 8;
  return {
    total: formatDuration(createdAt, totalEnd),
    drafting: project.draftingStartedAt ? formatMinutes(Math.floor(getDraftingElapsedMs(project, now) / 60000)) : (draftStart ? formatDuration(draftStart, draftingEnd) : '-'),
    review: reviewStart ? formatDuration(reviewStart, reviewEnd) : '-',
    ageHours,
    label: isDelayed ? 'Delayed' : isWarning ? 'Near SLA' : completed ? 'Completed' : 'On Track',
    colorClass: isDelayed ? 'bg-red-50 text-red-700 border-red-200' : isWarning ? 'bg-orange-50 text-orange-700 border-orange-200' : completed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-200'
  };
};


const isUnassignedCase = (project = {}) => !project.assignedTo || String(project.assignedTo || '').trim().toLowerCase() === 'unassigned';
const isInternalReviewPending = (project = {}) => {
  const statusKey = normalizeWorkStatus(project.status);
  const reviewKey = normalizeWorkStatus(project.reviewStatus || project.finalConclusion || '');
  return statusKey === 'INTERNALREVIEW' || reviewKey === 'PENDINGREVIEW' || reviewKey === 'REVIEWPENDING';
};
const isReadyForDelivery = (project = {}) => {
  const statusKey = normalizeWorkStatus(project.status);
  const reviewKey = normalizeWorkStatus(project.reviewStatus || project.finalConclusion || '');
  const paymentKey = normalizeWorkStatus(project.paymentStatus || project.ledger?.paymentStatus || '');
  return isProjectCompleted(project)
    && !hasActiveRevision(project)
    && !['ARCHIVED','CLOSED','DELETED'].includes(statusKey)
    && !['PAYMENTRECEIVED','PAID','RECEIVED'].includes(paymentKey)
    && (reviewKey === 'APPROVED' || statusKey === 'COMPLETED' || statusKey === 'APPROVED' || statusKey === 'FINALAPPROVED');
};
const isPaymentPending = (project = {}) => {
  const estimate = Number(project.estimate || project.estimateAmount || project.amount || 0);
  const received = Number(project.ledger?.amountIn || project.amountReceived || 0);
  const statusKey = normalizeWorkStatus(project.paymentStatus || project.ledger?.paymentStatus || '');
  return statusKey === 'PENDING' || statusKey === 'PAYMENTPENDING' || (estimate > 0 && received < estimate);
};
const getSlaBucket = (project = {}, now = Date.now()) => {
  const createdAt = toMs(project.createdAt) || now;
  const endAt = toMs(project.completedAt || project.approvedAt) || now;
  const hours = Math.max(0, (endAt - createdAt) / 3600000);
  if (isProjectCompleted(project)) return { key: 'completed', label: 'Completed', range: 'Done', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-100' };
  if (hours < 2) return { key: 'healthy', label: 'Healthy', range: '0–2 hrs', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-100' };
  if (hours < 4) return { key: 'attention', label: 'Attention', range: '2–4 hrs', colorClass: 'bg-amber-50 text-amber-700 border-amber-100' };
  if (hours < 8) return { key: 'near-sla', label: 'Near SLA', range: '4–8 hrs', colorClass: 'bg-orange-50 text-orange-700 border-orange-100' };
  return { key: 'critical', label: 'Critical', range: '>8 hrs', colorClass: 'bg-red-50 text-red-700 border-red-100' };
};
const formatActivityClock = (value) => {
  const ms = toMs(value);
  if (!ms) return '--:--';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const formatActivityAge = (value, nowMs = Date.now()) => {
  const ms = toMs(value);
  if (!ms) return '';
  const minutes = Math.max(0, Math.floor((nowMs - ms) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : new Date(ms).toLocaleDateString();
};
const getActivityIcon = (type = '') => {
  const key = normalizeWorkStatus(type);
  if (key.includes('REVISION')) return '🟣';
  if (key.includes('APPROV') || key.includes('COMPLET')) return '🟢';
  if (key.includes('ASSIGN')) return '🟡';
  if (key.includes('PAYMENT')) return '🔵';
  if (key.includes('ARCHIV')) return '⚫';
  if (key.includes('SLA')) return '🔴';
  return '•';
};
const isFinancialActivityEvent = (event = {}) => {
  const searchable = [
    event.type,
    event.title,
    event.text,
    event.action,
    event.message,
    event.remarks,
    event.note,
    event.status
  ].filter(Boolean).join(' ').toLowerCase();
  return /\b(payment|paid|finance|financial|ledger|refund|transaction|collection|amount\s+received|amount\s+paid|receipt)\b/i.test(searchable);
};
const buildLiveActivityFeed = (projects = [], nowMs = Date.now()) => {
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const todayStartMs = startOfToday.getTime();
  const seen = new Set();

  return projects.flatMap(project => {
    const projectKey = project.id || project.caseId || 'case';
    const rawSources = [
      ...(Array.isArray(project.timeline) ? project.timeline : []),
      ...(Array.isArray(project.history) ? project.history : []),
      ...(Array.isArray(project.activityLog) ? project.activityLog : []),
      ...(Array.isArray(project.events) ? project.events : []),
      ...(Array.isArray(project.deliveryLog) ? project.deliveryLog.map(event => ({ ...event, type: 'delivery', title: event.title || `Final file sent${event.file ? `: ${event.file}` : ''}`, remarks: event.via || event.remarks })) : []),
      ...(Array.isArray(project.revisionHistory) ? project.revisionHistory.map(event => ({ ...event, type: 'revision', title: event.title || event.action || 'Revision updated', at: event.at || event.completedAt || event.createdAt })) : []),
      ...(Array.isArray(project.revisions) ? project.revisions.map(event => ({ ...event, type: 'revision', title: event.title || event.action || 'Revision created', remarks: event.note })) : [])
    ];
    const sources = rawSources.filter(event => !isFinancialActivityEvent(event));

    const events = sources.map((event, index) => {
      // Never give an undated old event the case's latest updatedAt. Doing that
      // made stale timeline rows look current after any unrelated case edit.
      const at = toMs(event.at || event.time || event.timestamp || event.createdAt || event.updatedAt || event.completedAt);
      const title = event.title || event.text || event.action || event.message || 'Case activity';
      const by = event.by || event.user || event.createdBy || event.updatedBy || event.completedBy || '';
      return {
        id: `${projectKey}-event-${event.id || at || index}`,
        project,
        at,
        type: event.type || event.action || event.status || 'activity',
        title,
        by,
        remarks: event.remarks || event.note || event.message || event.text || ''
      };
    }).filter(item => item.at);

    const updatedAt = toMs(project.updatedAt || project.syncVersion);
    const hasMatchingUpdate = updatedAt && events.some(item => Math.abs(item.at - updatedAt) < 2000);
    const updateWasFinancial = updatedAt && rawSources.some(event => {
      if (!isFinancialActivityEvent(event)) return false;
      const eventAt = toMs(event.at || event.time || event.timestamp || event.createdAt || event.updatedAt || event.completedAt);
      return eventAt && Math.abs(eventAt - updatedAt) < 2000;
    });
    if (updatedAt && !hasMatchingUpdate && !updateWasFinancial) {
      events.push({
        id: `${projectKey}-updated-${updatedAt}`,
        project,
        at: updatedAt,
        type: project.status || 'updated',
        title: `Case updated • ${project.status || 'Status unchanged'}`,
        by: project.updatedBy || project.assignedTo || project.creatorName || '',
        remarks: getCustomerDisplayName(project)
      });
    }
    return events;
  }).filter(item => item.at >= todayStartMs && item.at <= nowMs + 300000).filter(item => {
    const key = [item.project?.id || item.project?.caseId, item.at, normalizeWorkStatus(item.type), item.title, item.by].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.at - a.at);
};

const getTodayMetrics = (projects = [], dateKey = formatDateKey()) => {
  const todays = projects.filter(p => getProjectDateKey(p) === dateKey);
  const carried = projects.filter(p => isCarriedForwardProject(p, dateKey));
  const activeToday = projects.filter(p => shouldShowOnOperationsDate(p, dateKey));
  const completedToday = projects.filter(p => wasCompletedOnDate(p, dateKey));
  const pendingCollections = projects.filter(p => (Number(p.estimate) || 0) > (Number(p.ledger?.amountIn) || 0));
  const paymentsToday = projects.filter(p => p.ledger?.updatedAt && formatDateKey(p.ledger.updatedAt) === dateKey);
  const revisions = activeToday.filter(hasActiveRevision);
  const waitingAssignment = activeToday.filter(isUnassignedCase);
  const internalReviewPending = activeToday.filter(isInternalReviewPending);
  const readyForDelivery = activeToday.filter(isReadyForDelivery);
  const paymentPending = projects.filter(isPaymentPending);
  const slaBuckets = activeToday.filter(isIncompleteProject).reduce((acc, item) => {
    const bucket = getSlaBucket(item);
    if (!acc[bucket.key]) acc[bucket.key] = [];
    acc[bucket.key].push(item);
    return acc;
  }, {});
  return {
    todays, carried, activeToday, completedToday, pendingCollections, paymentsToday, revisions, waitingAssignment, internalReviewPending, readyForDelivery, paymentPending, slaBuckets,
    received: todays.length,
    carriedCount: carried.length,
    pending: activeToday.filter(p => isIncompleteProject(p) && !['DRAFTING','DRAFTINGPAUSED','INTERNALREVIEW'].includes(normalizeWorkStatus(p.status))).length,
    drafting: activeToday.filter(p => normalizeWorkStatus(p.status) === 'DRAFTING').length,
    review: activeToday.filter(p => normalizeWorkStatus(p.status) === 'INTERNALREVIEW').length,
    completed: completedToday.length,
    paymentReceived: paymentsToday.reduce((sum, p) => sum + (Number(p.ledger?.amountIn) || 0), 0),
    pendingAmount: pendingCollections.reduce((sum, p) => sum + Math.max(0, (Number(p.estimate) || 0) - (Number(p.ledger?.amountIn) || 0)), 0)
  };
};

export const CommandCentreView = ({ projects = [], users = [], attendanceLogs = [], onSelectProject, onNavigate, onOpenPerformance, currentUser }) => {
  const [dateKey, setDateKey] = useState(formatDateKey());
  const [availabilityFilter, setAvailabilityFilter] = useState('Available');
  const [dashboardFilter, setDashboardFilter] = useState('all');
  const operationsBoardRef = useRef(null);
  const teamAvailabilityRef = useRef(null);
  const activityFeedRef = useRef(null);
  const [availabilityNow, setAvailabilityNow] = useState(Date.now());
  const [presenceTimes, setPresenceTimes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kalpa_presence_times') || '{}'); } catch (e) { return {}; }
  });
  useEffect(() => { const timer = setInterval(() => setAvailabilityNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const metrics = getTodayMetrics(projects, dateKey);
  const isAdmin = currentUser?.role === ROLES.ADMIN;
  const liveActivityFeed = buildLiveActivityFeed(projects, availabilityNow).slice(0, 14);
  const rawActiveBoard = metrics.activeToday.slice().sort((a,b) => (toMs(b.completedAt || b.updatedAt || b.createdAt) || 0) - (toMs(a.completedAt || a.updatedAt || a.createdAt) || 0));
  const people = getOperationalUsers(users || [], { includeAdmins: true });
  const workingTeam = people.filter(u => u.role === ROLES.DESIGNER || u.role === ROLES.MANAGER);
  const activeTasksFor = (userName) => getUserActiveTasks(projects, userName);
  const todayAttendanceFor = (member = {}) => {
    const today = formatDateKey();
    const candidates = (attendanceLogs || []).filter(log => {
      if (!log) return false;
      const logDate = log.date || formatDateKey(log.loginAt || log.createdAt || Date.now());
      const sameDate = String(logDate) === String(today);
      const sameId = member.id && log.userId && String(log.userId) === String(member.id);
      const sameName = member.name && log.name && normalizePersonName(log.name) === normalizePersonName(member.name);
      return sameDate && (sameId || sameName);
    });
    return candidates.sort((a, b) => Math.max(toMs(b.lastTick), toMs(b.logoutAt), toMs(b.updatedAt)) - Math.max(toMs(a.lastTick), toMs(a.logoutAt), toMs(a.updatedAt)))[0] || null;
  };
  const isMemberOnBreak = (member = {}) => {
    const directAvailability = String(member.availability || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (directAvailability === 'break' || directAvailability === 'onbreak') return true;
    const log = todayAttendanceFor(member);
    const logStatus = String(log?.status || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    return !!log && !!log.isOnline && (logStatus === 'onbreak' || !!log.currentBreakStartedAt || (Array.isArray(log.breakEvents) && log.breakEvents.some(ev => ev?.start && !ev?.end)));
  };

  useEffect(() => {
    const now = Date.now();
    let previous = {};
    try { previous = JSON.parse(localStorage.getItem('kalpa_presence_task_state') || '{}'); } catch (e) { previous = {}; }
    let existingTimes = {};
    try { existingTimes = JSON.parse(localStorage.getItem('kalpa_presence_times') || '{}'); } catch (e) { existingTimes = {}; }
    const nextState = {};
    const nextTimes = { ...existingTimes };

    people.forEach(member => {
      if (member.role === ROLES.ADMIN) return;
      const key = normalizePersonName(member.name);
      const active = getUserActiveTasks(projects, member.name);
      const activeIds = active.map(task => String(task.id || task.caseId || '')).filter(Boolean).sort();
      const activeCount = activeIds.length;
      const previousCount = Number(previous?.[key]?.activeCount || 0);
      const previousIds = Array.isArray(previous?.[key]?.activeIds) ? previous[key].activeIds.join('|') : '';
      const nextIds = activeIds.join('|');
      const completedAt = getUserLastCompletedAt(projects, member.name);
      const busySince = getUserBusySince(projects, member.name);

      nextState[key] = { activeCount, activeIds, updatedAt: now };
      nextTimes[key] = nextTimes[key] || {};

      if (activeCount > 0) {
        const newTaskStarted = previousCount === 0 || previousIds !== nextIds;
        nextTimes[key].busySince = newTaskStarted ? (busySince || now) : (nextTimes[key].busySince || busySince || now);
        nextTimes[key].freeSince = null;
      } else {
        nextTimes[key].busySince = null;
        if (previousCount > 0) {
          nextTimes[key].freeSince = completedAt || now;
        } else if (!nextTimes[key].freeSince && completedAt) {
          nextTimes[key].freeSince = completedAt;
        }
      }
    });

    try {
      localStorage.setItem('kalpa_presence_task_state', JSON.stringify(nextState));
      localStorage.setItem('kalpa_presence_times', JSON.stringify(nextTimes));
    } catch (e) {}
    setPresenceTimes(nextTimes);
  }, [projects, users]);

  const nowMs = availabilityNow;
  const availablePeople = people.filter(u => isUserActuallyOnline(u, nowMs) && !isMemberOnBreak(u) && (u.role === ROLES.ADMIN || activeTasksFor(u.name).length === 0)); // admins shown available but no free-since
  const busyPeople = people.filter(u => u.role !== ROLES.ADMIN && isUserActuallyOnline(u, nowMs) && !isMemberOnBreak(u) && activeTasksFor(u.name).length > 0);
  const breakPeople = people.filter(u => u.role !== ROLES.ADMIN && isUserActuallyOnline(u, nowMs) && isMemberOnBreak(u));
  const offlinePeople = people.filter(u => !isUserActuallyOnline(u, nowMs));
  const free = availablePeople.length;
  const busy = busyPeople.length;
  const breaks = breakPeople.length;
  const availabilityGroups = { Available: availablePeople, Busy: busyPeople, Break: breakPeople, Offline: offlinePeople };
  const selectedAvailabilityPeople = availabilityGroups[availabilityFilter] || [];
  // Completion rate must never cross 100%.
  // It is calculated against all work relevant to the selected date:
  // cases received that day + pending carried forward + cases completed that day.
  // This prevents carried-forward completions from making the rate show values like 150%.
  const completionRateBase = new Map();
  [...metrics.todays, ...metrics.carried, ...metrics.completedToday].forEach((p) => {
    if (p?.id) completionRateBase.set(String(p.id), p);
  });
  const completionRateTotal = completionRateBase.size;
  const completionRate = completionRateTotal
    ? Math.min(100, Math.round((metrics.completed / completionRateTotal) * 100))
    : 0;
  const pendingNow = rawActiveBoard.filter(p => isIncompleteProject(p)).length;
  const pendingBoard = rawActiveBoard.filter(p => isIncompleteProject(p));
  const delayedCount = pendingBoard.filter(p => getSlaInfo(p).label === 'Delayed').length;
  const nearSlaCount = pendingBoard.filter(p => getSlaInfo(p).label === 'Near SLA').length;
  const activeCapacity = workingTeam.reduce((sum, u) => sum + activeTasksFor(u.name).length, 0);
  const capacityLimit = workingTeam.reduce((sum, u) => sum + Number(u.dailyLimit || u.taskLimit || 10), 0) || Math.max(workingTeam.length * 10, 1);
  const capacityPct = Math.min(100, Math.round((activeCapacity / capacityLimit) * 100));
  const statusFlow = [
    ['Received', metrics.received, 'bg-blue-500', 'received'],
    ['Pending', pendingNow, 'bg-orange-500', 'pending'],
    ['Carried', metrics.carriedCount, 'bg-amber-500', 'carried'],
    ['Drafting', metrics.drafting, 'bg-indigo-500', 'drafting'],
    ['Review', metrics.review, 'bg-purple-500', 'review'],
    ['Completed', metrics.completed, 'bg-emerald-500', 'completed'],
    ['Revisions', metrics.revisions.length, 'bg-red-500', 'revisions']
  ];
  const maxFlow = Math.max(...statusFlow.map(([, value]) => Number(value) || 0), 1);
  const workloadCards = workingTeam.map(u => {
    const active = activeTasksFor(u.name);
    const completedToday = projects.filter(p => normalizePersonName(p.assignedTo) === normalizePersonName(u.name) && wasCompletedOnDate(p, dateKey)).length;
    const revisions = projects.filter(p => normalizePersonName(p.assignedTo) === normalizePersonName(u.name) && hasActiveRevision(p)).length;
    const limit = Number(u.dailyLimit || u.taskLimit || 10) || 10;
    const loadPct = Math.min(100, Math.round((active.length / limit) * 100));
    return { ...u, active, completedToday, revisions, limit, loadPct };
  }).sort((a,b) => b.active.length - a.active.length || b.completedToday - a.completedToday || a.name.localeCompare(b.name));
  const topPerformers = workloadCards.slice().sort((a,b) => b.completedToday - a.completedToday || a.active.length - b.active.length).slice(0, 4);
  const filterLabels = {
    all: 'All active operations',
    received: 'Cases received today',
    pending: 'Active pending cases',
    completed: 'Completed today',
    delayed: 'Delayed SLA cases',
    near: 'Near SLA cases',
    revisions: 'Urgent revisions',
    carried: 'Carried forward cases',
    drafting: 'Drafting cases',
    review: 'Internal review cases',
    waiting: 'Cases waiting for assignment',
    internalReview: 'Internal review pending',
    ready: 'Ready for delivery',
    paymentPending: 'Payment pending',
    slaCritical: 'SLA violations / critical cases',
    healthy: 'SLA healthy cases',
    attention: 'SLA attention cases',
    attentionAll: 'All work requiring attention',
    working: 'Work currently in progress'
  };
  const filterOperations = (filterKey) => {
    if (filterKey === 'received') return metrics.todays.slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (filterKey === 'pending') return pendingBoard;
    if (filterKey === 'completed') return metrics.completedToday.slice().sort((a,b) => (toMs(b.completedAt || b.updatedAt || b.createdAt) || 0) - (toMs(a.completedAt || a.updatedAt || a.createdAt) || 0));
    if (filterKey === 'delayed') return pendingBoard.filter(p => getSlaInfo(p).label === 'Delayed');
    if (filterKey === 'near') return pendingBoard.filter(p => getSlaInfo(p).label === 'Near SLA');
    if (filterKey === 'revisions') return metrics.revisions.slice().sort((a,b) => (b.revisionRequestedAt || b.updatedAt || b.createdAt || 0) - (a.revisionRequestedAt || a.updatedAt || a.createdAt || 0));
    if (filterKey === 'carried') return metrics.carried.slice();
    if (filterKey === 'attentionAll') {
      const merged = [
        ...metrics.waitingAssignment,
        ...metrics.internalReviewPending,
        ...metrics.revisions,
        ...(metrics.slaBuckets.critical || []),
        ...(metrics.slaBuckets['near-sla'] || [])
      ];
      const seen = new Set();
      return merged.filter(item => {
        const key = item.id || item.caseId || `${item.customerName || ''}-${item.createdAt || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (filterKey === 'working') return rawActiveBoard.filter(p => ['DRAFTING','DRAFTINGPAUSED','INPROGRESS','ASSIGNED'].includes(normalizeWorkStatus(p.status)));
    if (filterKey === 'drafting') return rawActiveBoard.filter(p => normalizeWorkStatus(p.status) === 'DRAFTING' || normalizeWorkStatus(p.status) === 'DRAFTINGPAUSED');
    if (filterKey === 'review') return rawActiveBoard.filter(p => normalizeWorkStatus(p.status) === 'INTERNALREVIEW');
    if (filterKey === 'waiting') return metrics.waitingAssignment.slice();
    if (filterKey === 'internalReview') return metrics.internalReviewPending.slice();
    if (filterKey === 'ready') return metrics.readyForDelivery.slice();
    if (filterKey === 'paymentPending') return metrics.paymentPending.slice();
    if (filterKey === 'slaCritical') return (metrics.slaBuckets.critical || []).slice();
    if (filterKey === 'healthy') return (metrics.slaBuckets.healthy || []).slice();
    if (filterKey === 'attention') return (metrics.slaBuckets.attention || []).slice();
    return rawActiveBoard;
  };
  const attentionItems = filterOperations('attentionAll');
  const activeBoard = dashboardFilter === 'attentionAll' ? attentionItems : filterOperations(dashboardFilter);
  const applyDashboardFilter = (filterKey) => {
    if (filterKey === 'activity') {
      setTimeout(() => activityFeedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30);
      return;
    }
    setDashboardFilter(filterKey);
    setTimeout(() => operationsBoardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };
  const applyAvailabilityFilter = (filterKey) => {
    setAvailabilityFilter(filterKey);
    setTimeout(() => teamAvailabilityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };
  const liveBoardSections = [
    ['🔴 Cases waiting for assignment', metrics.waitingAssignment.length, 'waiting', 'bg-red-50 text-red-700 border-red-100'],
    ['🟡 Cases under drafting', metrics.drafting, 'drafting', 'bg-yellow-50 text-yellow-700 border-yellow-100'],
    ['🟠 Internal review pending', metrics.internalReviewPending.length, 'internalReview', 'bg-orange-50 text-orange-700 border-orange-100'],
    ['🟢 Ready for delivery', metrics.readyForDelivery.length, 'ready', 'bg-emerald-50 text-emerald-700 border-emerald-100'],
    ...(isAdmin ? [['🔵 Payment pending', metrics.paymentPending.length, 'paymentPending', 'bg-blue-50 text-blue-700 border-blue-100']] : []),
    ['🟣 Revision queue', metrics.revisions.length, 'revisions', 'bg-purple-50 text-purple-700 border-purple-100'],
    ['⚫ SLA violations', (metrics.slaBuckets.critical || []).length, 'slaCritical', 'bg-slate-100 text-slate-800 border-slate-200']
  ];
  const slaMonitorSections = [
    ['0–2 hrs', 'Healthy', (metrics.slaBuckets.healthy || []).length, 'healthy', 'bg-emerald-50 text-emerald-700 border-emerald-100'],
    ['2–4 hrs', 'Attention', (metrics.slaBuckets.attention || []).length, 'attention', 'bg-amber-50 text-amber-700 border-amber-100'],
    ['4–8 hrs', 'Near SLA', (metrics.slaBuckets['near-sla'] || []).length, 'near', 'bg-orange-50 text-orange-700 border-orange-100'],
    ['>8 hrs', 'Critical', (metrics.slaBuckets.critical || []).length, 'slaCritical', 'bg-red-50 text-red-700 border-red-100']
  ];
  const actionCount = attentionItems.length;
  const commandFocusCards = [
    ['Attention', actionCount, 'attentionAll', 'bg-red-50 text-red-700 border-red-100', 'Waiting, review, revision and SLA risk'],
    ['Working', metrics.drafting, 'working', 'bg-amber-50 text-amber-700 border-amber-100', 'Cases currently being worked on'],
    ['Ready', metrics.readyForDelivery.length, 'ready', 'bg-emerald-50 text-emerald-700 border-emerald-100', 'Completed work ready to deliver'],
    ...(isAdmin ? [['Payments', metrics.paymentPending.length, 'paymentPending', 'bg-blue-50 text-blue-700 border-blue-100', 'Pending payment follow-up']] : []),
    ['Activity', liveActivityFeed.length, 'activity', 'bg-indigo-50 text-indigo-700 border-indigo-100', 'Latest operational activity']
  ];
  return (
    <div className="kalpa-production-polish space-y-4 sm:space-y-5 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Command Centre</h1>
          <p className="text-slate-500 font-medium mt-1">Live operational control for today.</p>
        </div>
        <input type="date" value={dateKey} onChange={e => setDateKey(e.target.value)} className="bg-white border-2 border-slate-100 rounded-xl px-3 py-2 font-bold text-slate-700 outline-none" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {commandFocusCards.map(([label, value, filterKey, cls, hint]) => (
          <button
            key={label}
            type="button"
            onClick={() => applyDashboardFilter(filterKey)}
            title={hint}
            className={`${cls} min-h-[74px] border rounded-2xl px-4 py-3 shadow-sm text-left transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-indigo-100 ${dashboardFilter === filterKey ? 'ring-2 ring-indigo-200 bg-white' : ''}`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-black uppercase tracking-widest opacity-80">{label}</p>
              <span className="text-2xl font-black leading-none">{value}</span>
            </div>
            <p className="mt-2 text-[11px] font-bold opacity-60 truncate">{hint}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div ref={operationsBoardRef} className="kalpa-panel xl:col-span-7 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden scroll-mt-24">
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="font-black text-slate-800 text-lg">Operational Queue</h2>
              <p className="text-xs font-bold text-slate-400 mt-1">{filterLabels[dashboardFilter] || 'All active operations'} • {activeBoard.length} record{activeBoard.length === 1 ? '' : 's'}</p>
            </div>
            {dashboardFilter !== 'all' && <button type="button" onClick={() => setDashboardFilter('all')} className="text-xs font-black uppercase tracking-widest bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl transition">Clear filter</button>}
          </div>
          <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto custom-scrollbar">
            {activeBoard.slice(0, 18).map(p => {
              const latestRevisionNote = getLatestRevisionNote(p);
              const sla = getSlaInfo(p);
              return (
                <button key={p.id || p.caseId} type="button" onClick={() => onSelectProject(p)} className="w-full text-left px-4 py-3 hover:bg-slate-50 transition flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black text-slate-800 truncate">{formatTaskId(p.id || p.caseId)}</p>
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{p.type || 'Case'}</span>
                      {isCarriedForwardProject(p, dateKey) && <span className="text-[9px] bg-orange-50 text-orange-700 border border-orange-100 px-2 py-0.5 rounded-lg font-black uppercase">Carry forward</span>}
                    </div>
                    <p className="text-xs font-bold text-slate-500 mt-1 truncate">{getCustomerDisplayName(p)} • {p.location || 'Location not added'} • {p.assignedTo || 'Unassigned'}</p>
                    {dashboardFilter === 'revisions' && latestRevisionNote && <p className="text-[11px] font-bold text-red-700 mt-1 truncate">Revision: {latestRevisionNote}</p>}
                  </div>
                  <div className="hidden md:flex items-center gap-2 shrink-0">
                    <Badge colorClass={sla.colorClass}>{sla.label}</Badge>
                    <Badge colorClass={dashboardFilter === 'revisions' ? 'bg-red-50 text-red-700 border-red-100' : getStatusColor(p.status)}>{dashboardFilter === 'revisions' ? 'Revision' : (p.status || 'Open')}</Badge>
                  </div>
                </button>
              );
            })}
            {activeBoard.length === 0 && <div className="p-10 text-center text-slate-400 font-bold">No operations for this date.</div>}
          </div>
        </div>

        <div className="xl:col-span-5 space-y-4">
          <div ref={activityFeedRef} className="kalpa-panel bg-white rounded-2xl border border-slate-100 p-4 shadow-sm scroll-mt-24">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="font-black text-slate-800 flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-2 animate-pulse" /><Bell className="w-5 h-5 mr-2 text-indigo-500" /> Live Activity</h3>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Today • {liveActivityFeed.length}</span>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
              {liveActivityFeed.slice(0, 9).map(item => (
                <button key={item.id} type="button" onClick={() => onSelectProject(item.project)} className="w-full text-left bg-slate-50 hover:bg-indigo-50 border border-slate-100 rounded-xl px-3 py-2.5 transition-all flex gap-3">
                  <div className="w-14 shrink-0 text-center"><p className="text-[11px] font-black text-slate-500">{formatActivityClock(item.at)}</p><p className="text-[10px] font-bold text-emerald-600 mt-0.5">{formatActivityAge(item.at, availabilityNow)}</p><p className="text-base mt-0.5">{getActivityIcon(item.type)}</p></div>
                  <div className="min-w-0 flex-1"><p className="font-black text-slate-800 text-sm truncate">{formatTaskId(item.project?.id || item.project?.caseId)} • {item.title}</p><p className="text-[11px] font-bold text-slate-500 mt-0.5 truncate">{getCustomerDisplayName(item.project)}{item.by ? ` • ${item.by}` : ''}</p></div>
                </button>
              ))}
              {liveActivityFeed.length === 0 && <p className="text-sm text-slate-400 font-bold text-center py-6">No activity recorded today. New actions will appear automatically.</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="kalpa-panel bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
              <h3 className="font-black text-slate-800 mb-3">SLA</h3>
              <div className="space-y-2">{slaMonitorSections.map(([range, label, value, filterKey, cls]) => (
                <button key={range} type="button" onClick={() => applyDashboardFilter(filterKey)} className={`${cls} w-full border rounded-xl px-3 py-2 text-left flex items-center justify-between transition-all hover:shadow-sm`}>
                  <div><p className="font-black text-xs">{label}</p><p className="text-[10px] font-black uppercase tracking-widest opacity-60">{range}</p></div><span className="text-lg font-black">{value}</span>
                </button>
              ))}</div>
            </div>
            <div className="kalpa-panel bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
              <h3 className="font-black text-slate-800 mb-3">Alerts</h3>
              <button type="button" onClick={() => applyDashboardFilter('revisions')} className="w-full mb-2 bg-purple-50 text-purple-700 border border-purple-100 rounded-xl px-3 py-2 flex justify-between"><span className="font-black text-xs">Revisions</span><b>{metrics.revisions.length}</b></button>
              {isAdmin && <button type="button" onClick={() => applyDashboardFilter('paymentPending')} className="w-full mb-2 bg-blue-50 text-blue-700 border border-blue-100 rounded-xl px-3 py-2 flex justify-between"><span className="font-black text-xs">Payment Pending</span><b>{metrics.paymentPending.length}</b></button>}
              <button type="button" onClick={() => applyDashboardFilter('slaCritical')} className="w-full bg-slate-100 text-slate-800 border border-slate-200 rounded-xl px-3 py-2 flex justify-between"><span className="font-black text-xs">Critical SLA</span><b>{(metrics.slaBuckets.critical || []).length}</b></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ProductivityDashboard = ({ users = [], projects = [], performanceRecords: externalPerformanceRecords = [], performanceSummary = null, currentUser = null }) => {
  const [scope, setScope] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(getCurrentAccountingMonthKey());
  const [selectedMember, setSelectedMember] = useState('all');
  const [engineBusy, setEngineBusy] = useState(false);
  const [baselineBusyId, setBaselineBusyId] = useState('');
  const [leaderboard, setLeaderboard] = useState(null);
  const [leaderboardError, setLeaderboardError] = useState('');
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const now = Date.now();
  const todayKey = formatDateKey();
  const performanceMonth = normalizeAccountingMonthKey(selectedMonth, getCurrentAccountingMonthKey());
  const performanceMonthLabel = formatAccountingMonthLabel(performanceMonth);
  const scopeLabel = scope === 'overall' ? 'Overall since each member’s baseline' : performanceMonthLabel;
  const isAdmin = normalizeRole(currentUser?.role) === ROLES.ADMIN;
  const allProjects = Array.isArray(projects) ? projects : [];
  const leaderboardMembers = Array.isArray(leaderboard?.members) ? leaderboard.members : [];
  const team = useMemo(() => {
    const byName = new Map();
    getOperationalUsers(users, { includeAdmins: false }).forEach(user => byName.set(normalizePersonName(user.name), user));
    leaderboardMembers.forEach(member => {
      const key = normalizePersonName(member.name);
      byName.set(key, { ...(byName.get(key) || {}), ...member, name:member.name, role:normalizeRole(member.role), status:member.status || 'APPROVED' });
    });
    return Array.from(byName.values()).sort((a,b) => String(a.name).localeCompare(String(b.name)));
  }, [users, leaderboard]);
  const activeTeam = selectedMember === 'all' ? team : team.filter(u => normalizePersonName(u.name) === normalizePersonName(selectedMember));
  const generatedPerformanceRecords = useMemo(() => buildPerformanceRecords(allProjects), [projects]);
  const performanceRecords = useMemo(() => mergePerformanceRecordSets(externalPerformanceRecords, generatedPerformanceRecords), [externalPerformanceRecords, generatedPerformanceRecords]);
  const effectivePerformanceSummary = (leaderboard ? { ...leaderboard, users:leaderboardMembers.map(member => ({ ...member, userName:member.name, completedCount:member.completedRecordCount ?? member.completedHistoryCount })) } : null);
  const summaryUsers = Array.isArray(effectivePerformanceSummary?.users) ? effectivePerformanceSummary.users : [];
  const summaryByName = useMemo(() => new Map(summaryUsers.map(row => [normalizePersonName(row.userName || row.name), row])), [summaryUsers]);
  const leaderboardByName = useMemo(() => new Map(leaderboardMembers.map(row => [normalizePersonName(row.name), row])), [leaderboardMembers]);
  const allProjectsByOwner = useMemo(() => {
    const map = new Map();
    allProjects.forEach(project => {
      const key = normalizePersonName(getPerformanceOwnerName(project));
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(project);
    });
    return map;
  }, [projects]);
  const performanceRecordsByOwner = useMemo(() => {
    const map = new Map();
    performanceRecords.forEach(record => {
      const key = normalizePersonName(record.userName);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(record);
    });
    return map;
  }, [performanceRecords]);

  useEffect(() => {
    let active = true;
    setLeaderboardError('');
    const params = new URLSearchParams({ scope });
    if (scope === 'month') params.set('month', performanceMonth);
    authFetch(absoluteApiUrl(`/api/performance/leaderboard?${params.toString()}`), { cache:'no-store', timeoutMs:30_000 })
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`Leaderboard failed: ${res.status}`)))
      .then(data => {
        if (!active || !data?.ok) return;
        setLeaderboard(data.leaderboard || null);
      })
      .catch(error => { if (active) setLeaderboardError(error?.message || 'Team comparison could not be loaded.'); });
    return () => { active = false; };
  }, [scope, performanceMonth, leaderboardRefreshKey]);

  const rebuildPerformanceEngine = async () => {
    setEngineBusy(true);
    try {
      const res = await authFetch(absoluteApiUrl('/api/performance/rebuild'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'performance-dashboard' }) });
      const data = await res.json().catch(() => null);
      if (data?.ok) setLeaderboardRefreshKey(value => value + 1);
      else notifyUser(data?.error || 'Performance rebuild failed.');
    } catch (err) {
      notifyUser(err?.message || 'Performance rebuild failed.');
    } finally {
      setEngineBusy(false);
    }
  };

  const updatePerformanceBaseline = async (user, enabled) => {
    if (!isAdmin || !user?.id || baselineBusyId) return;
    setBaselineBusyId(String(user.id));
    try {
      const res = await authFetch(absoluteApiUrl(`/api/performance/baseline/${encodeURIComponent(user.id)}`), {
        method:'PATCH',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ enabled, month:getCurrentAccountingMonthKey() }),
        timeoutMs:30_000
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Performance baseline update failed: ${res.status}`);
      setLeaderboardRefreshKey(value => value + 1);
      notifyUser(enabled ? `${user.name} will now be scored from ${formatAccountingMonthLabel(data.baselineMonth || getCurrentAccountingMonthKey())}.` : `${user.name}'s full performance history has been restored.`);
    } catch (error) {
      notifyUser(error?.message || 'Performance baseline could not be updated.');
    } finally {
      setBaselineBusyId('');
    }
  };

  const getMemberRecords = (name) => performanceRecordsByOwner.get(normalizePersonName(name)) || [];
  const memberRows = activeTeam.map(u => {
    const summaryRow = summaryByName.get(normalizePersonName(u.name)) || {};
    const leaderboardRow = leaderboardByName.get(normalizePersonName(u.name)) || {};
    const baselineAt = getPerformanceBaselineAt(u);
    const allAssigned = allProjectsByOwner.get(normalizePersonName(u.name)) || [];
    const assigned = allAssigned.filter(project => isPerformanceEventInScope(
      toMs(project.assignedAt || project.createdAt || project.taskDate || project.receivedAt),
      scope,
      performanceMonth,
      baselineAt
    ));
    const analyticsCompleted = allAssigned.filter(project => isAnalyticsCompletedProject(project) && isPerformanceEventInScope(
      getExplicitPerformanceCompletionAt(project),
      scope,
      performanceMonth,
      baselineAt
    ));
    const completed = analyticsCompleted.filter(isProjectCompleted);
    const completedRecords = getMemberRecords(u.name).filter(record => isPerformanceEventInScope(
      record.completionEventAt || record.completedAt,
      scope,
      performanceMonth,
      baselineAt
    ));
    const completedToday = Number(leaderboardRow.completedToday ?? analyticsCompleted.filter(project => formatDateKey(getExplicitPerformanceCompletionAt(project)) === todayKey).length) || 0;
    const active = assigned.filter(isIncompleteProject);
    const revisions = assigned.filter(project => getProjectRevisionTotal(project) > 0);
    const profileAverage = scope === 'overall' && !baselineAt ? Number(u.performanceProfile?.averageCompletionMinutes || u.averageCompletionMinutes || 0) || 0 : 0;
    const summaryAvgCompletion = Number(summaryRow.avgCompletionMinutes || summaryRow.averageCompletionMinutes || 0) || 0;
    const summaryAvgReview = Number(summaryRow.avgReviewMinutes || summaryRow.averageReviewMinutes || 0) || 0;
    const avgMins = summaryAvgCompletion || averageMinutes(completedRecords, r => r.totalCompletionMinutes) || averageMinutes(analyticsCompleted, p => getActiveCompletionMinutes(p)) || averageMinutes(completed, p => getActiveCompletionMinutes(p)) || profileAverage;
    const avgReviewMins = summaryAvgReview || averageMinutes(completedRecords, r => r.reviewMinutes) || averageMinutes(analyticsCompleted, p => getReviewDurationMinutes(p)) || averageMinutes(completed, p => getReviewDurationMinutes(p));
    const liveTasks = active.length ? active : (Number(leaderboardRow.activeCount || 0) > 0 ? [{ id:'Active task' }] : []);
    const live = getLiveStatus(u, liveTasks);
    const breakMinutes = getTodayBreakMinutes(u);
    const summarySla = summaryRow.slaPct ?? summaryRow.slaPercentage;
    const slaPct = summarySla !== undefined && summarySla !== null ? Number(summarySla) || 0 : getSlaCompliancePct(assigned);
    const revisionTotal = Number(summaryRow.revisionCount || 0) || assigned.reduce((sum, p) => sum + getProjectRevisionTotal(p), 0);
    const revisionRate = Number(summaryRow.revisionRate || 0) || (analyticsCompleted.length ? Number((revisionTotal / analyticsCompleted.length).toFixed(1)) : (completed.length ? Number((revisionTotal / completed.length).toFixed(1)) : 0));
    const revisionPct = assigned.length ? Math.round((revisions.length / assigned.length) * 100) : 0;
    // Score completion speed against realistic drafting targets instead of punishing every task above 60 minutes.
    // <= 90m is excellent, 4h is still workable, and very slow work gradually falls toward attention-needed.
    const speedScore = avgMins ? Math.max(10, Math.min(100, Math.round(100 - Math.max(0, avgMins - 90) / 6))) : (completed.length ? 70 : 0);
    const revisionScore = Math.max(0, Math.round(100 - revisionRate * 25));
    const qualityScore = Math.max(0, Math.min(100, Number(summaryRow.scoreBreakdown?.qualityScore || 0) || revisionScore));
    const productivityScore = summaryRow.productivityScore !== undefined && summaryRow.productivityScore !== null ? Number(summaryRow.productivityScore) || 0 : Math.round((speedScore * 0.3) + (slaPct * 0.3) + (qualityScore * 0.2) + (revisionScore * 0.15) + (completedToday > 0 ? 5 : 0));
    const rolling10CompletionMinutes = Number(summaryRow.rolling10CompletionMinutes || 0) || avgMins;
    const rolling30CompletionMinutes = Number(summaryRow.rolling30CompletionMinutes || 0) || avgMins;
    const rawScoreBreakdown = summaryRow.scoreBreakdown || {};
    const scoreBreakdown = {
      speedScore: Number(rawScoreBreakdown.speedScore || 0) > 0 ? Number(rawScoreBreakdown.speedScore) : speedScore,
      qualityScore: Number(rawScoreBreakdown.qualityScore || 0) > 0 ? Number(rawScoreBreakdown.qualityScore) : qualityScore,
      slaScore: Number(rawScoreBreakdown.slaScore || 0) > 0 ? Number(rawScoreBreakdown.slaScore) : slaPct,
      revisionScore: Number(rawScoreBreakdown.revisionScore || 0) > 0 ? Number(rawScoreBreakdown.revisionScore) : revisionScore,
      attendanceScore: Number(rawScoreBreakdown.attendanceScore || 90),
      productivityScore
    };
    const rawCaseTypeStats = Array.isArray(summaryRow.caseTypeStats) && summaryRow.caseTypeStats.length ? summaryRow.caseTypeStats : getCaseTypeStats(completedRecords.length ? completedRecords : (analyticsCompleted.length ? analyticsCompleted : completed));
    const caseTypeStats = rawCaseTypeStats.map(stat => ({ ...stat, avg: Number(stat.avg || stat.avgCompletionMinutes || stat.averageMinutes || 0) || 0 })).filter(stat => stat.count || stat.avg);
    const trendSource = (completedRecords.length ? completedRecords : (analyticsCompleted.length ? analyticsCompleted : completed).map(project => ({ completedAt:getExplicitPerformanceCompletionAt(project), totalCompletionMinutes:getActiveCompletionMinutes(project) })))
      .slice()
      .sort((left, right) => toMs(right.completionEventAt || right.completedAt) - toMs(left.completionEventAt || left.completedAt));
    const recentCompleted = trendSource.slice(0, 10).map(record => Number(record.totalCompletionMinutes || 0)).filter(Boolean);
    const previousCompleted = trendSource.slice(10, 20).map(record => Number(record.totalCompletionMinutes || 0)).filter(Boolean);
    const recentAvg = recentCompleted.length ? Math.round(recentCompleted.reduce((a, b) => a + b, 0) / recentCompleted.length) : 0;
    const previousAvg = previousCompleted.length ? Math.round(previousCompleted.reduce((a, b) => a + b, 0) / previousCompleted.length) : 0;
    const computedTrendRaw = recentAvg && previousAvg && previousCompleted.length >= 2 && recentCompleted.length >= 2 ? Math.round(((previousAvg - recentAvg) / Math.max(previousAvg, 1)) * 100) : 0;
    const summaryTrendRaw = Number(summaryRow.trend?.pct || 0);
    const trendRaw = summaryRow.trend?.pct !== undefined ? summaryTrendRaw : computedTrendRaw;
    const trend = Math.max(-99, Math.min(99, trendRaw));
    const trendLabel = Math.abs(trend) < 6 ? 'Stable' : trend > 0 ? 'Improving' : 'Declining';
    const assignedCount = Number(leaderboardRow.assignedCount ?? assigned.length) || 0;
    const completedCount = Number(leaderboardRow.completedCount ?? completed.length) || 0;
    const activeCount = Number(leaderboardRow.activeCount ?? active.length) || 0;
    const revisionsCount = Number(leaderboardRow.revisionCases ?? revisions.length) || 0;
    return { user: u, assigned, completed, active, revisions, assignedCount, completedCount, activeCount, revisionsCount, completedToday, avgMins, avgReviewMins, rolling10CompletionMinutes, rolling30CompletionMinutes, scoreBreakdown, live, breakMinutes, slaPct, revisionPct, revisionRate, productivityScore, caseTypeStats, trend, trendLabel, timingSource: summaryRow.timingSource || (summaryRow.completedCount ? 'Backend History' : completedRecords.length ? 'Performance Records' : analyticsCompleted.length ? 'Task History' : 'No history yet'), historyCompletedCount: Number(summaryRow.completedCount || leaderboardRow.completedRecordCount || leaderboardRow.completedHistoryCount || completedRecords.length || analyticsCompleted.length || completed.length || 0) };
  }).sort((a, b) => b.productivityScore - a.productivityScore || b.completedCount - a.completedCount || b.assignedCount - a.assignedCount);
  const totals = memberRows.reduce((acc, row) => {
    acc.assigned += row.assignedCount;
    acc.completed += row.completedCount;
    acc.active += row.activeCount;
    acc.revisions += row.revisionsCount;
    acc.today += row.completedToday;
    if (row.avgMins) { acc.avgTotal += row.avgMins; acc.avgCount += 1; }
    return acc;
  }, { assigned: 0, completed: 0, active: 0, revisions: 0, today: 0, avgTotal: 0, avgCount: 0 });
  const summaryTeamAvg = Number(effectivePerformanceSummary?.avgCompletionMinutes || effectivePerformanceSummary?.averageCompletionMinutes || 0) || 0;
  const teamAvgMins = summaryTeamAvg || (totals.avgCount ? Math.round(totals.avgTotal / totals.avgCount) : 0);
  const teamAvgReview = Number(effectivePerformanceSummary?.avgReviewMinutes || 0) || averageMinutes(memberRows, row => row.avgReviewMins);
  const avgSla = memberRows.length ? Math.round(memberRows.reduce((sum, row) => sum + row.slaPct, 0) / memberRows.length) : 0;
  const avgProductivity = memberRows.length ? Math.round(memberRows.reduce((sum, row) => sum + row.productivityScore, 0) / memberRows.length) : 0;
  const exportPerformance = () => exportToCSV(
    ['Member', 'Role', 'Status', 'Break Today', 'Assigned', 'Completed', 'Active', 'Revisions', 'Completed Today', 'Avg Completion', 'Avg Review', 'Revision Rate', 'SLA %', 'Productivity Score', 'Quality'],
    memberRows.map(row => [row.user.name, row.user.role, row.live.label, formatMinutes(row.breakMinutes), row.assignedCount, row.completedCount, row.activeCount, row.revisionsCount, row.completedToday, displayMinutes(row.avgMins, '0m'), displayMinutes(row.avgReviewMins, '0m'), row.revisionRate, `${row.slaPct}%`, row.productivityScore, getQualityLabel(row.productivityScore)]),
    `Performance_Analytics_${scope === 'overall' ? 'Overall' : performanceMonth}.csv`
  );
  const StatCard = ({ label, value, hint }) => (
    <div className="bg-white rounded-3xl border-2 border-slate-100 p-5 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-3xl font-black text-slate-800 mt-2">{value}</p>
      {hint && <p className="text-xs font-bold text-slate-400 mt-1">{hint}</p>}
    </div>
  );
  const SimpleMetric = ({ label, value, tone = 'text-slate-800', helper }) => (
    <div className="rounded-2xl bg-white border border-slate-100 p-3 min-w-0">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 truncate">{label}</p>
      <p className={`text-lg font-black mt-1 ${tone}`}>{value}</p>
      {helper && <p className="text-[10px] font-bold text-slate-400 mt-1 truncate">{helper}</p>}
    </div>
  );
  const metricTone = (value = 0) => {
    const safe = Math.max(0, Math.min(100, Number(value || 0)));
    if (safe >= 85) return { bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-100', label: 'Excellent' };
    if (safe >= 70) return { bar: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-100', label: 'Good' };
    if (safe >= 50) return { bar: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-100', label: 'Watch' };
    return { bar: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-100', label: 'Needs work' };
  };
  const WeightedScoreRow = ({ label, score, weight, helper, detail }) => {
    const safeValue = Math.max(0, Math.min(100, Number(score || 0)));
    const points = Math.round((safeValue * weight) / 100);
    const tone = metricTone(safeValue);
    return (
      <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-800">{label}</p>
            {detail && <p className="text-[11px] font-bold text-slate-500 mt-0.5 leading-snug">{detail}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-black text-slate-900">{points}/{weight}</p>
            <span className={`inline-flex mt-1 px-2 py-0.5 rounded-full border text-[9px] font-black ${tone.badge}`}>{tone.label}</span>
          </div>
        </div>
        <div className="mt-2 h-2.5 rounded-full bg-white overflow-hidden border border-slate-100"><div className={`${tone.bar} h-full rounded-full transition-all`} style={{ width: `${safeValue}%` }} /></div>
        {helper && <p className="text-[10px] font-bold text-slate-400 mt-1.5 leading-snug">{helper}</p>}
      </div>
    );
  };
  const ScoreRing = ({ value, hasHistory }) => {
    const safeValue = hasHistory ? Math.max(0, Math.min(100, Number(value || 0))) : 0;
    const ringTone = !hasHistory ? 'text-slate-300' : safeValue >= 85 ? 'text-emerald-500' : safeValue >= 70 ? 'text-amber-500' : 'text-red-500';
    const conic = hasHistory ? `conic-gradient(currentColor ${safeValue * 3.6}deg, #e2e8f0 0deg)` : 'conic-gradient(#e2e8f0 0deg, #e2e8f0 360deg)';
    return (
      <div className={`relative w-20 h-20 rounded-full ${ringTone} shrink-0`} style={{ background: conic }} title={hasHistory ? `${safeValue}/100 performance score` : 'Score starts after first completed task'}>
        <div className="absolute inset-2 rounded-full bg-white flex flex-col items-center justify-center shadow-inner">
          <span className={`text-xl font-black ${hasHistory ? 'text-slate-900' : 'text-slate-400'}`}>{hasHistory ? safeValue : '--'}</span>
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Score</span>
        </div>
      </div>
    );
  };
  const getPerformanceStatus = (score, hasHistory) => {
    if (!hasHistory) return { label: 'New Member', className: 'bg-slate-50 text-slate-600 border-slate-200', note: 'Score will start after first completion.' };
    if (score >= 90) return { label: 'Excellent', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', note: 'High performing and consistent.' };
    if (score >= 75) return { label: 'Good', className: 'bg-blue-50 text-blue-700 border-blue-200', note: 'Strong performance with minor scope to improve.' };
    if (score >= 60) return { label: 'Average', className: 'bg-amber-50 text-amber-700 border-amber-200', note: 'Stable, but needs closer follow-up.' };
    return { label: 'Needs Focus', className: 'bg-red-50 text-red-700 border-red-200', note: 'Needs manager attention.' };
  };
  const getBestArea = (row) => {
    const score = row.scoreBreakdown || {};
    const completedCount = Array.isArray(row.completed) ? row.completedCount : 0;
    const revisionRate = Number(row.revisionRate || 0);
    const fastestCaseType = (Array.isArray(row.caseTypeStats) ? row.caseTypeStats : [])
      .filter(stat => Number(stat.count || 0) > 0 && Number(stat.avg || 0) > 0)
      .slice()
      .sort((a, b) => Number(a.avg || 0) - Number(b.avg || 0))[0];
    const candidates = [
      { label: fastestCaseType ? `Fastest in ${fastestCaseType.caseType}` : 'Good completion rhythm', value: Number(score.speedScore || 0), min: 70 },
      { label: Number(row.slaPct || 0) >= 95 ? 'Reliable on-time delivery' : 'Improving SLA discipline', value: Number(score.slaScore || row.slaPct || 0), min: 75 },
      { label: revisionRate <= 0.15 ? 'Clean work with fewer revisions' : 'Revision control improving', value: Number(score.revisionScore || 0), min: 70 },
      { label: 'Quality consistency', value: Number(score.qualityScore || 0), min: 70 },
      { label: completedCount > 0 ? 'Consistent completion history' : 'Ready to build history', value: Math.min(100, completedCount * 5), min: 40 }
    ];
    const strong = candidates.filter(item => item.value >= item.min).sort((a, b) => b.value - a.value)[0];
    return (strong || candidates.sort((a, b) => b.value - a.value)[0])?.label || 'Building history';
  };
  const getImprovementTip = (row, hasHistory) => {
    if (!hasHistory) return 'Complete the first task to create a real performance baseline.';
    const score = row.scoreBreakdown || {};
    const avg = Number(row.avgMins || 0);
    const review = Number(row.avgReviewMins || 0);
    const activeCount = Array.isArray(row.active) ? row.activeCount : 0;
    const revisionRate = Number(row.revisionRate || 0);
    const slowCaseType = (Array.isArray(row.caseTypeStats) ? row.caseTypeStats : [])
      .filter(stat => Number(stat.count || 0) > 0 && Number(stat.avg || 0) > 0)
      .slice()
      .sort((a, b) => Number(b.avg || 0) - Number(a.avg || 0))[0];
    const options = [
      { key: 'speed', score: Number(score.speedScore || 0), text: slowCaseType ? `Reduce ${slowCaseType.caseType} average from ${displayMinutes(slowCaseType.avg)}.` : `Bring average finish time below ${displayMinutes(Math.max(90, avg - 30))}.` },
      { key: 'review', score: review ? Math.max(0, 100 - Math.round(review / 4)) : 80, text: review ? `Cut review/checking time from ${displayMinutes(review)} with a pre-upload checklist.` : 'Keep review handoff clean and documented.' },
      { key: 'quality', score: Number(score.qualityScore || 0), text: 'Improve first-submit quality with a 2-minute final check.' },
      { key: 'revision', score: Number(score.revisionScore || 0), text: revisionRate > 0 ? `Reduce revisions from ${revisionRate}/task with clearer self-review.` : 'Keep revision rate low while improving speed.' },
      { key: 'sla', score: Number(score.slaScore || row.slaPct || 0), text: activeCount > 0 ? `Finish or pause ${activeCount} active case${activeCount === 1 ? '' : 's'} clearly to protect SLA.` : 'Accept the next task quickly to keep workload moving.' }
    ];
    const weakest = options.sort((a, b) => a.score - b.score)[0];
    return weakest?.text || 'Keep performance stable and avoid late task buildup.';
  };
  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-indigo-500 mb-2">Single source of truth</p>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Performance Analytics</h1>
          <p className="text-slate-500 font-medium mt-2 max-w-4xl">Productivity, average completion, review speed, case-type timing, revisions, and SLA quality.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-xl border-2 border-slate-100 bg-white p-1 shadow-sm" aria-label="Performance scope">
            <button type="button" onClick={() => setScope('month')} className={`px-4 py-2 rounded-lg text-sm font-black transition ${scope === 'month' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>Monthly</button>
            <button type="button" onClick={() => setScope('overall')} className={`px-4 py-2 rounded-lg text-sm font-black transition ${scope === 'overall' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>Overall</button>
          </div>
          {scope === 'month' && <label className="bg-white border-2 border-indigo-100 rounded-xl px-3 py-2 shadow-sm"><span className="block text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-1">Performance Month</span><input type="month" value={performanceMonth} max={getCurrentAccountingMonthKey()} onChange={event => setSelectedMonth(event.target.value)} className="font-black text-slate-800 outline-none bg-transparent" aria-label="Performance month" /></label>}
          <select value={selectedMember} onChange={e => setSelectedMember(e.target.value)} className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2.5 font-bold text-slate-700 outline-none">
            <option value="all">All team members</option>{team.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
          </select>
          <button type="button" onClick={exportPerformance} className="bg-indigo-600 text-white font-bold px-4 py-2.5 rounded-xl shadow-sm"><Download className="w-4 h-4 inline mr-2"/>Export</button>
        </div>
      </div>
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3"><p className="text-sm font-black text-indigo-800">Showing: {scopeLabel}</p><p className="text-xs font-bold text-indigo-600 mt-1">Monthly uses one exact calendar month. Overall uses all valid records after any Admin-set personal baseline.</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4">
        <StatCard label="Assigned" value={totals.assigned} hint={scope === 'month' ? 'assigned in month' : 'since baseline'} />
        <StatCard label="Completed" value={totals.completed} hint={scope === 'month' ? 'completed in month' : 'since baseline'} />
        <StatCard label="Active" value={totals.active} hint="open from scope" />
        <StatCard label="Revisions" value={totals.revisions} hint="scope activity" />
        <StatCard label="Avg Completion" value={displayMinutes(teamAvgMins)} hint={scopeLabel} />
        <StatCard label="Avg Review" value={displayMinutes(teamAvgReview)} hint="not in designer score" />
        <StatCard label="SLA" value={`${avgSla}%`} hint="scope compliance" />
        <StatCard label="Productivity" value={avgProductivity} hint="team average" />
      </div>
      {leaderboardError && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">Team comparison is temporarily using the local workspace snapshot. {leaderboardError}</div>}
      <div className="rounded-3xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-white px-4 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 shadow-sm">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-indigo-700">Performance data is ready</p>
          <p className="text-xs font-bold text-indigo-600 mt-1">Using {effectivePerformanceSummary?.recordCount ? `${effectivePerformanceSummary.recordCount} completion records` : `${performanceRecords.length} task records`} for {scopeLabel}. Designers see aggregate team metrics without access to other members’ case details.</p>
        </div>
        <button type="button" onClick={rebuildPerformanceEngine} disabled={engineBusy} className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-black text-sm disabled:opacity-60 disabled:cursor-not-allowed shadow-sm">{engineBusy ? 'Refreshing...' : 'Refresh averages'}</button>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="font-black text-slate-800 text-lg flex items-center"><Users className="w-5 h-5 mr-2 text-indigo-500" /> Team Performance Cards</h2>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Completion • case type • quality</span>
          </div>
          <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[520px] overflow-y-auto custom-scrollbar">
            {memberRows.map(row => {
              const loadLimit = Number(row.user.dailyLimit || row.user.taskLimit || 10) || 10;
              const loadPct = Math.min(100, Math.round((row.activeCount / loadLimit) * 100));
              const currentTask = row.active[0];
              const live = row.live || getLiveStatus(row.user, row.active);
              const historyCount = Number(row.historyCompletedCount || 0);
              const hasHistory = historyCount > 0;
              const baselineMonth = getPerformanceBaselineMonth(row.user);
              const baselineEnabled = Boolean(baselineMonth && getPerformanceBaselineAt(row.user));
              const baselineBusy = baselineBusyId === String(row.user.id);
              const avgTime = hasHistory ? displayMinutes(row.avgMins, '0m') : 'No history';
              const avgReview = hasHistory ? displayMinutes(row.avgReviewMins, '0m') : 'No history';
              const rolling30 = hasHistory ? displayMinutes(row.rolling30CompletionMinutes) : 'No data';
              const rolling10 = hasHistory ? displayMinutes(row.rolling10CompletionMinutes) : 'No data';
              const quality = hasHistory ? getQualityLabel(row.productivityScore) : 'New';
              const scoreLabel = hasHistory ? `${row.productivityScore}/100` : 'No rating yet';
              const trendTone = row.trend > 5 ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : row.trend < -5 ? 'text-red-600 bg-red-50 border-red-100' : 'text-slate-600 bg-slate-50 border-slate-100';
              const trendText = hasHistory ? (row.trend ? `${row.trendLabel} ${Math.abs(row.trend)}%` : row.trendLabel) : 'Starts after completion';
              const workloadTone = loadPct >= 90 ? 'text-red-600' : loadPct >= 60 ? 'text-amber-600' : 'text-emerald-600';
              const status = getPerformanceStatus(row.productivityScore, hasHistory);
              const bestArea = hasHistory ? getBestArea(row) : 'First task pending';
              const improvementTip = getImprovementTip(row, hasHistory);
              return (
                <div key={row.user.id} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex items-start gap-3">
                      <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${live.dotClass}`} />
                      <div className="min-w-0">
                        <p className="font-black text-slate-900 truncate text-base">{row.user.name}</p>
                        <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{row.user.role} • {live.label}</p>
                        <div className="mt-2 flex flex-wrap gap-2"><Badge colorClass={status.className}>{status.label}</Badge><Badge colorClass={live.badgeClass}>{live.label}</Badge></div>
                      </div>
                    </div>
                    <ScoreRing value={row.productivityScore} hasHistory={hasHistory} />
                  </div>

                  {isAdmin && <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-3">
                    <div><p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Admin score baseline</p><p className="text-xs font-bold text-indigo-800 mt-1">{baselineEnabled ? `Scoring starts from ${formatAccountingMonthLabel(baselineMonth)}. Previous test data is preserved but excluded.` : 'Full valid performance history is included.'}</p></div>
                    <button type="button" role="switch" aria-checked={baselineEnabled} disabled={baselineBusy} onClick={() => updatePerformanceBaseline(row.user, !baselineEnabled)} className={`relative inline-flex h-8 w-16 shrink-0 items-center rounded-full transition ${baselineEnabled ? 'bg-indigo-600' : 'bg-slate-300'} disabled:opacity-60`} title={baselineEnabled ? 'Restore full performance history' : 'Start this member fresh from the current month'}><span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${baselineEnabled ? 'translate-x-9' : 'translate-x-1'}`} /></button>
                  </div>}

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Best area</p>
                      <p className="text-sm font-black text-emerald-800 mt-1">⭐ {bestArea}</p>
                    </div>
                    <div className="rounded-2xl bg-indigo-50 border border-indigo-100 p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Next improvement</p>
                      <p className="text-xs font-bold text-indigo-800 mt-1 leading-snug">{improvementTip}</p>
                    </div>
                  </div>

                  <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-100 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Current work</p>
                        <p className="text-sm font-black text-slate-800 truncate">{currentTask ? (formatTaskId(currentTask.id || currentTask.caseId) || makeTaskDisplayName(currentTask)) : live.detail}</p>
                      </div>
                      <Badge colorClass={live.badgeClass}>{live.label}</Badge>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <SimpleMetric label="Assigned" value={row.assignedCount} helper="total given" />
                    <SimpleMetric label="Completed" value={row.completedCount} tone="text-emerald-600" helper="finished" />
                    <SimpleMetric label="Active" value={row.activeCount} tone="text-orange-600" helper="pending now" />
                    <SimpleMetric label="On time" value={`${row.slaPct}%`} tone="text-indigo-600" helper="SLA" />
                  </div>

                  <div className="mt-3 rounded-2xl bg-slate-50/80 border border-slate-100 p-3">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Easy performance summary</p>
                      <span className={`px-2 py-1 rounded-full border text-[10px] font-black ${trendTone}`}>{trendText}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <SimpleMetric label="Avg finish time" value={avgTime} helper={scope === 'month' ? performanceMonthLabel : 'since baseline'} />
                      <SimpleMetric label="Review delay" value={avgReview} tone="text-blue-600" helper="not in designer score" />
                      <SimpleMetric label="Latest 30 avg" value={rolling30} tone="text-indigo-600" helper="within scope" />
                      <SimpleMetric label="Latest 10 avg" value={rolling10} tone="text-indigo-600" helper="within scope" />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold">
                      <div className="rounded-xl bg-white border border-slate-100 px-3 py-2"><span className="text-slate-400">Revisions</span><b className="float-right text-purple-600">{row.revisionRate}/task</b></div>
                      <div className="rounded-xl bg-white border border-slate-100 px-3 py-2"><span className="text-slate-400">Today done</span><b className="float-right text-emerald-600">{row.completedToday}</b></div>
                      <div className="rounded-xl bg-white border border-slate-100 px-3 py-2"><span className="text-slate-400">Break</span><b className="float-right text-amber-600">{formatMinutes(row.breakMinutes)}</b></div>
                      <div className="rounded-xl bg-white border border-slate-100 px-3 py-2"><span className="text-slate-400">Scope records</span><b className="float-right text-indigo-600">{historyCount}</b></div>
                    </div>
                  </div>

                  {hasHistory ? (
                    <div className="mt-3 rounded-2xl bg-white border border-slate-100 p-3">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Designer score breakdown</p>
                          <p className="text-[11px] font-bold text-slate-400 mt-0.5">Score uses only designer-controlled metrics. Review delay is shown separately.</p>
                        </div>
                        <Badge colorClass={getQualityBadgeClass(row.productivityScore)}>{quality}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <SimpleMetric label="Total score" value={`${row.productivityScore}/100`} tone="text-indigo-600" helper="weighted" />
                        <SimpleMetric label="Confidence" value={historyCount >= 15 ? 'High' : historyCount >= 5 ? 'Medium' : 'Low'} tone={historyCount >= 15 ? 'text-emerald-600' : historyCount >= 5 ? 'text-amber-600' : 'text-red-600'} helper={`${historyCount} records`} />
                        <SimpleMetric label="Team compare" value={row.avgMins && teamAvgMins ? (row.avgMins <= teamAvgMins ? `${Math.round(((teamAvgMins - row.avgMins) / Math.max(teamAvgMins, 1)) * 100)}% faster` : `${Math.round(((row.avgMins - teamAvgMins) / Math.max(teamAvgMins, 1)) * 100)}% slower`) : '-'} tone={row.avgMins && teamAvgMins && row.avgMins <= teamAvgMins ? 'text-emerald-600' : 'text-amber-600'} helper="avg finish" />
                      </div>
                      <div className="space-y-3">
                        <WeightedScoreRow label="Completion speed" score={row.scoreBreakdown?.speedScore} weight={35} detail={`${avgTime} avg finish${teamAvgMins ? ` • Team ${displayMinutes(teamAvgMins)}` : ''}`} helper="Faster completion improves this part." />
                        <WeightedScoreRow label="Work quality" score={row.scoreBreakdown?.qualityScore} weight={30} detail={`${row.revisionRate}/task revision rate`} helper="Fewer corrections improve this part." />
                        <WeightedScoreRow label="On-time SLA" score={row.scoreBreakdown?.slaScore} weight={20} detail={`${row.slaPct}% completed within expected time`} helper="Keep delivery within SLA." />
                        <WeightedScoreRow label="Revision control" score={row.scoreBreakdown?.revisionScore} weight={15} detail={`${row.revisionsCount} revision case${row.revisionsCount === 1 ? '' : 's'}`} helper="Self-check before upload protects this score." />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-100 p-3 text-sm font-bold text-slate-500">
                      Complete the first task to start building average time, score, trend, and case-type productivity.
                    </div>
                  )}

                  {row.caseTypeStats.length > 0 && <div className="mt-3 rounded-2xl bg-white border border-slate-100 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Work type average</p>
                    <div className="space-y-1.5">{row.caseTypeStats.map(stat => <div key={stat.caseType} className="flex items-center justify-between gap-3 text-xs font-bold"><span className="truncate text-slate-600">{stat.caseType} <span className="text-slate-300">({stat.count})</span></span><span className="text-slate-900">{displayMinutes(stat.avg)}</span></div>)}</div>
                  </div>}

                  <div className="mt-3">
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1"><span>Current load</span><span className={workloadTone}>{loadPct}%</span></div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full ${loadPct >= 90 ? 'bg-red-400' : loadPct >= 60 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${loadPct}%` }} /></div>
                  </div>
                </div>
              );
            })}
            {memberRows.length === 0 && <p className="text-sm text-slate-400 font-bold text-center py-8 lg:col-span-2">No team performance status available.</p>}
          </div>
        </div>
        <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100"><h2 className="font-black text-slate-800 text-lg flex items-center"><Clock className="w-5 h-5 mr-2 text-indigo-500" /> Team Activity</h2></div>
          <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto custom-scrollbar">
            {memberRows.map(row => {
              const lastSeen = formatLastSeenDateTime(row.user.lastSeenAt || row.user.lastLogoutAt || row.user.lastHeartbeatAt);
              const isOnline = isUserActuallyOnline(row.user);
              return (
                <div key={row.user.id} className="px-4 py-3 hover:bg-slate-50 transition flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-3">
                    <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${isOnline ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                    <div className="min-w-0">
                      <p className="font-black text-slate-800 truncate">{row.user.name}</p>
                      <p className="text-[11px] font-bold text-slate-400 truncate">{isOnline ? 'Available now' : `Unavailable${lastSeen ? ` • ${lastSeen}` : ''}`}</p>
                    </div>
                  </div>
                  <Badge colorClass="bg-indigo-50 text-indigo-700 border-indigo-100">{row.completedToday} done</Badge>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b-2 border-slate-100"><h2 className="font-black text-slate-800 text-lg">Team Leaderboard & Individual Analytics</h2></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm whitespace-nowrap"><thead className="bg-slate-50 text-slate-500"><tr>{['Member','Role','Status','Assigned','Completed','Active','Today','Avg Completion','Avg Review','Revision Rate','SLA','Productivity','Quality'].map(c => <th key={c} className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">{c}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
          {memberRows.map(row => <tr key={row.user.id} className="hover:bg-slate-50"><td className="px-5 py-4 font-black text-slate-800">{row.user.name}</td><td className="px-5 py-4 font-bold text-slate-500">{row.user.role}</td><td className="px-5 py-4"><Badge colorClass={row.live.badgeClass}>{row.live.label}</Badge></td><td className="px-5 py-4 font-black text-slate-700">{row.assignedCount}</td><td className="px-5 py-4 font-black text-emerald-600">{row.completedCount}</td><td className="px-5 py-4 font-black text-orange-600">{row.activeCount}</td><td className="px-5 py-4 font-black text-indigo-600">{row.completedToday}</td><td className="px-5 py-4 font-bold text-slate-600">{displayMinutes(row.avgMins)}</td><td className="px-5 py-4 font-bold text-blue-600">{displayMinutes(row.avgReviewMins)}</td><td className="px-5 py-4 font-bold text-purple-600">{row.revisionRate}/task</td><td className="px-4 py-3 font-bold text-slate-700">{row.slaPct}%</td><td className="px-5 py-4 font-black text-indigo-600">{row.productivityScore}</td><td className="px-5 py-4"><Badge colorClass={getQualityBadgeClass(row.productivityScore)}>{getQualityLabel(row.productivityScore)}</Badge></td></tr>)}
          {memberRows.length === 0 && <tr><td colSpan="13" className="px-4 py-8 text-center text-slate-400 font-bold">No performance data for this filter.</td></tr>}
        </tbody></table></div>
      </div>
    </div>
  );
};

export const ReportsAnalyticsView = ({ projects = [], users = [], currentUser = null }) => {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentAccountingMonthKey());
  const accountingMonth = normalizeAccountingMonthKey(selectedMonth, getCurrentAccountingMonthKey());
  const accountingMonthLabel = formatAccountingMonthLabel(accountingMonth);
  const projectList = useMemo(() => Array.isArray(projects) ? projects : [], [projects]);

  // The headline workload cards are one exact creation-month cohort. Old work
  // completed during the selected month is reported separately so a month with
  // zero new cases can never misleadingly show completed new workload.
  const createdScoped = useMemo(() => projectList.filter(project => getProjectCreatedMonthKey(project) === accountingMonth), [projectList, accountingMonth]);
  const completed = useMemo(() => createdScoped.filter(project => isProjectCompleted(project) && getProjectCompletedMonthKey(project) === accountingMonth), [createdScoped, accountingMonth]);
  const carriedForwardCompleted = useMemo(() => projectList.filter(project => {
    const createdMonth = getProjectCreatedMonthKey(project);
    return isProjectCompleted(project) && createdMonth && createdMonth < accountingMonth && getProjectCompletedMonthKey(project) === accountingMonth;
  }), [projectList, accountingMonth]);
  const pending = useMemo(() => createdScoped.filter(isIncompleteProject), [createdScoped]);
  const revisions = useMemo(() => projectList.filter(project => hasRevisionInAccountingMonth(project, accountingMonth)), [projectList, accountingMonth]);
  const financeEntries = useMemo(() => projectList.map(project => ({ project, entry:buildProjectMonthlyFinanceEntry(project, accountingMonth) })).filter(item => item.entry.hasActivity), [projectList, accountingMonth]);
  const paymentPending = financeEntries.filter(({ entry }) => ['Pending', 'Partially Paid'].includes(entry.statusAtClose));
  const paymentReceived = financeEntries.filter(({ entry }) => entry.received !== 0);
  const reportAsOfMs = Math.min(Date.now(), getAccountingMonthEndTimestamp(accountingMonth) || Date.now());
  const paymentAging = paymentPending.reduce((acc, { project, entry }) => {
    const age = getProjectAgeHours({ ...project, paymentTrackingUpdatedAt:entry.activityAt || project.paymentTrackingUpdatedAt }, reportAsOfMs);
    const bucket = age <= 48 ? '0-2 days' : age <= 168 ? '3-7 days' : age <= 360 ? '8-15 days' : '15+ days';
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
  const bankRows = topRowsFromCount(countBy(createdScoped, getBankName));
  const branchRows = topRowsFromCount(countBy(createdScoped, getBranchName));
  const caseTypeRows = topRowsFromCount(countBy(createdScoped, project => project.type || project.caseType || 'Case'));
  const slaBase = completed.length > 0 ? completed : createdScoped;
  const slaPct = getSlaCompliancePct(slaBase);
  const finiteFinanceAmount = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  const pendingAmount = paymentPending.reduce((sum, { entry }) => sum + finiteFinanceAmount(entry.pendingAtClose), 0);
  const receivedAmount = paymentReceived.reduce((sum, { entry }) => sum + finiteFinanceAmount(entry.received), 0);
  const expenseAmount = financeEntries.reduce((sum, { entry }) => sum + finiteFinanceAmount(entry.expenses), 0);
  const refundAmount = financeEntries.reduce((sum, { entry }) => sum + finiteFinanceAmount(entry.refund), 0);
  const netAmount = receivedAmount - expenseAmount - refundAmount;
  const summaryRows = [
    ['Accounting month', accountingMonthLabel],
    ['New workload', createdScoped.length],
    ['New-month cases completed in same month', completed.length],
    ['Carried-forward cases completed during month', carriedForwardCompleted.length],
    ['New-month cases still pending', pending.length],
    ['Revision activity', revisions.length],
    ['Payment pending cases in month', paymentPending.length],
    ['Pending at month close', pendingAmount],
    ['Received in month', receivedAmount],
    ['Expenses in month', expenseAmount],
    ['Refunds in month', refundAmount],
    ['Net in month', netAmount],
    ['SLA compliance', `${slaPct}%`]
  ];
  const exportSummary = () => exportToCSV(['Business Metric', 'Value'], summaryRows, `Business_Reports_${accountingMonth}.csv`);
  const exportWorkload = () => exportToCSV(['Accounting Month', 'Report', 'Name', 'Value'], [
    ...bankRows.map(([name, count]) => [accountingMonth, 'New workload by bank', name, count]),
    ...branchRows.map(([name, count]) => [accountingMonth, 'New workload by branch', name, count]),
    ...caseTypeRows.map(([name, count]) => [accountingMonth, 'New workload by case type', name, count]),
    ...topRowsFromCount(paymentAging, 10).map(([name, count]) => [accountingMonth, 'Selected-month payment aging', name, count])
  ], `Business_Workload_${accountingMonth}.csv`);
  const StatCard = ({ label, value, hint }) => (<div className="bg-white rounded-3xl border-2 border-slate-100 p-5 shadow-sm"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p><p className="text-3xl font-black text-slate-800 mt-2">{value}</p>{hint && <p className="text-xs font-bold text-slate-400 mt-1">{hint}</p>}</div>);
  const SimpleTable = ({ title, columns, rows, empty = 'No data yet.' }) => (<div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"><div className="p-4 border-b border-slate-100"><h2 className="font-black text-slate-800 text-lg">{title}</h2><p className="text-xs font-bold text-slate-400 mt-1">{accountingMonthLabel} only</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm whitespace-nowrap"><thead className="bg-slate-50 text-slate-500"><tr>{columns.map(c => <th key={c} className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">{c}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row, idx) => <tr key={idx} className="hover:bg-slate-50">{row.map((cell, i) => <td key={i} className="px-4 py-3 font-bold text-slate-700">{cell}</td>)}</tr>)}{rows.length === 0 && <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-slate-400 font-bold">{empty}</td></tr>}</tbody></table></div></div>);
  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col lg:flex-row justify-between lg:items-end gap-4">
        <div><h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Reports</h1><p className="text-slate-500 font-medium mt-2 max-w-4xl">Headline workload cards follow one exact creation-month cohort. A case is counted as completed here only when it was both created and completed in {accountingMonthLabel}; older carried-forward work is disclosed separately.</p></div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="bg-white border-2 border-indigo-100 rounded-xl px-3 py-2 shadow-sm"><span className="block text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-1">Report Month</span><input type="month" value={accountingMonth} max={getCurrentAccountingMonthKey()} onChange={event => setSelectedMonth(event.target.value)} className="font-black text-slate-800 outline-none bg-transparent" aria-label="Reports accounting month" /></label>
          <button type="button" onClick={exportSummary} className="bg-emerald-100 text-emerald-700 font-bold px-4 py-2.5 rounded-xl"><Download className="w-4 h-4 inline mr-2"/>Export Summary</button>
          <button type="button" onClick={exportWorkload} className="bg-indigo-100 text-indigo-700 font-bold px-4 py-2.5 rounded-xl"><Download className="w-4 h-4 inline mr-2"/>Export Reports</button>
        </div>
      </div>
      <div className="bg-indigo-50 border-2 border-indigo-100 rounded-2xl px-5 py-4"><p className="font-black text-indigo-800">Active reporting period: {accountingMonthLabel}</p><p className="text-sm font-bold text-indigo-600 mt-1">No rolling window is used. Headline completed work belongs to this month’s new-work cohort only.</p>{carriedForwardCompleted.length > 0 && <p className="text-sm font-black text-amber-700 mt-2">Carried-forward completions: {carriedForwardCompleted.length}. These older cases were completed in {accountingMonthLabel} but are not counted as completed new workload.</p>}</div>
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4"><StatCard label="New Workload" value={createdScoped.length} hint="created this month"/><StatCard label="Completed" value={completed.length} hint="new cohort completed"/><StatCard label="Pending" value={pending.length} hint="this month's new cases"/><StatCard label="Revisions" value={revisions.length} hint="activity this month"/><StatCard label="Pending Pay" value={paymentPending.length} hint={`₹${pendingAmount.toLocaleString()}`}/><StatCard label="Received" value={`₹${receivedAmount.toLocaleString()}`} hint="this month only"/><StatCard label="Net" value={`₹${netAmount.toLocaleString()}`} hint="after expense/refund"/><StatCard label="SLA" value={`${slaPct}%`} hint="new-month cohort"/></div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5"><SimpleTable title="Bank Report" columns={['Bank', 'New Cases']} rows={bankRows} empty={`No new bank cases in ${accountingMonthLabel}.`}/><SimpleTable title="Branch Report" columns={['Branch', 'New Cases']} rows={branchRows} empty={`No new branch cases in ${accountingMonthLabel}.`}/><SimpleTable title="Case Type Report" columns={['Case Type', 'New Cases']} rows={caseTypeRows} empty={`No new case types in ${accountingMonthLabel}.`}/><SimpleTable title="Payment Aging Report" columns={['Age', 'Pending Cases']} rows={topRowsFromCount(paymentAging, 10)} empty={`No selected-month pending payments in ${accountingMonthLabel}.`}/></div>
    </div>
  );
};

export const ProductionQAView = ({ projects = [], users = [], currentUser = null }) => {
  const todayKey = formatDateKey();
  const team = getOperationalUsers(users, { includeAdmins: true });
  const activeTeam = getOperationalUsers(users, { includeAdmins: false });
  const projectList = Array.isArray(projects) ? projects : [];
  const timelineReady = projectList.filter(p => Array.isArray(p.timeline) && p.timeline.length > 0).length;
  const casesWithIds = projectList.filter(p => p.id || p.caseId).length;
  const completedCases = projectList.filter(isProjectCompleted);
  const completedWithFiles = completedCases.filter(hasCompletedDeliverable).length;
  const assignedOpen = projectList.filter(p => isIncompleteProject(p) && p.assignedTo).length;
  const unassignedOpen = projectList.filter(p => isIncompleteProject(p) && !p.assignedTo).length;
  const revisionCases = projectList.filter(p => hasActiveRevision(p) || (p.subTasks || p.revisions || []).length > 0).length;
  const paymentTracked = projectList.filter(p => getPaymentStatus(p) !== 'not-set' || getEstimateAmount(p) > 0).length;
  const slaPct = getSlaCompliancePct(projectList);
  const admins = team.filter(u => u.role === ROLES.ADMIN).length;
  const managers = team.filter(u => u.role === ROLES.MANAGER).length;
  const designers = team.filter(u => u.role === ROLES.DESIGNER).length;
  const onlineNow = team.filter(u => isUserActuallyOnline(u)).length;
  const todayCreated = projectList.filter(p => getProjectDateKey(p) === todayKey).length;
  const todayCompleted = projectList.filter(p => formatDateKey(p.completedAt || p.draftingCompletedAt || p.submittedAt || 0) === todayKey).length;
  const checks = [
    { group: 'Core Data', item: 'Case records are readable', pass: projectList.length >= 0, detail: `${projectList.length} cases loaded` },
    { group: 'Core Data', item: 'Cases have stable IDs', pass: projectList.length === 0 || casesWithIds === projectList.length, detail: `${casesWithIds}/${projectList.length} cases with ID` },
    { group: 'Audit Trail', item: 'Timeline foundation active', pass: projectList.length === 0 || timelineReady > 0, detail: `${timelineReady} cases have timeline events` },
    { group: 'Operations', item: 'Open assigned work visible', pass: assignedOpen >= 0, detail: `${assignedOpen} assigned open tasks` },
    { group: 'Operations', item: 'Unassigned queue measurable', pass: unassignedOpen >= 0, detail: `${unassignedOpen} waiting for assignment` },
    { group: 'Completion', item: 'Completed files traceable', pass: completedCases.length === 0 || completedWithFiles <= completedCases.length, detail: `${completedWithFiles}/${completedCases.length} completed with deliverables` },
    { group: 'Revision', item: 'Revision queue measurable', pass: revisionCases >= 0, detail: `${revisionCases} revision-linked cases` },
    { group: 'Finance', item: 'Payment tracking measurable', pass: currentUser?.role === ROLES.ADMIN, detail: `${paymentTracked} cases with finance signals` },
    { group: 'SLA', item: 'SLA compliance calculable', pass: Number.isFinite(slaPct), detail: `${slaPct}% within target` },
    { group: 'Team', item: 'Approved team loaded', pass: team.length > 0, detail: `${admins} admin, ${managers} manager, ${designers} designer` },
    { group: 'Team', item: 'Attendance/online state readable', pass: onlineNow >= 0, detail: `${onlineNow} online now` },
    { group: 'Reports', item: 'Daily figures calculable', pass: todayCreated >= 0 && todayCompleted >= 0, detail: `${todayCreated} received, ${todayCompleted} completed today` }
  ];
  const passed = checks.filter(c => c.pass).length;
  const failed = checks.length - passed;
  const readiness = Math.round((passed / Math.max(1, checks.length)) * 100);
  const exportQA = () => exportToCSV(['Group', 'Check', 'Status', 'Detail'], checks.map(c => [c.group, c.item, c.pass ? 'PASS' : 'ATTENTION', c.detail]), `Production_QA_${todayKey}.csv`);
  const grouped = checks.reduce((acc, c) => { (acc[c.group] ||= []).push(c); return acc; }, {});
  const workflowItems = ['Login', 'Attendance', 'Case creation', 'Assignment', 'Drafting', 'Completion upload/download', 'Internal review', 'Revision', 'Archive', 'Finance ledger', 'Notifications', 'Chat', 'Mobile responsiveness', 'Multi-user sync'];
  const signoffStorageKey = `kalpa-production-qa-signoff-${todayKey}`;
  const [signedItems, setSignedItems] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(signoffStorageKey) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const toggleSignoff = (item) => {
    setSignedItems(prev => {
      const next = prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item];
      try { localStorage.setItem(signoffStorageKey, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const clearSignoff = () => {
    setSignedItems([]);
    try { localStorage.removeItem(signoffStorageKey); } catch {}
  };
  const signoffPct = Math.round((signedItems.length / Math.max(1, workflowItems.length)) * 100);
  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col lg:flex-row justify-between lg:items-end gap-4">
        <div><h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Production QA</h1><p className="text-slate-500 font-medium mt-2">Maintenance-only release-readiness checks for core workflows, audit trail, SLA, reports and team state. Use this after updates, deployments, server maintenance or bug reports.</p></div>
        <button type="button" onClick={exportQA} className="bg-indigo-100 text-indigo-700 font-bold px-4 py-2.5 rounded-xl w-fit"><Download className="w-4 h-4 inline mr-2"/>Export QA CSV</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><p className="text-xs font-black uppercase tracking-widest text-slate-400">Readiness</p><p className="text-4xl font-black text-slate-800 mt-2">{readiness}%</p><p className="text-xs font-bold text-slate-400 mt-1">{passed}/{checks.length} checks passed</p></div>
        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><p className="text-xs font-black uppercase tracking-widest text-slate-400">Attention</p><p className={`text-4xl font-black mt-2 ${failed ? 'text-amber-600' : 'text-emerald-600'}`}>{failed}</p><p className="text-xs font-bold text-slate-400 mt-1">items needing review</p></div>
        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><p className="text-xs font-black uppercase tracking-widest text-slate-400">Cases</p><p className="text-4xl font-black text-slate-800 mt-2">{projectList.length}</p><p className="text-xs font-bold text-slate-400 mt-1">{assignedOpen} active assigned</p></div>
        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><p className="text-xs font-black uppercase tracking-widest text-slate-400">Team</p><p className="text-4xl font-black text-slate-800 mt-2">{team.length}</p><p className="text-xs font-bold text-slate-400 mt-1">{onlineNow} currently online</p></div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {Object.entries(grouped).map(([group, rows]) => (
          <div key={group} className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
            <div className="p-5 border-b-2 border-slate-100 flex items-center gap-3"><ShieldCheck className="w-5 h-5 text-indigo-500"/><h2 className="font-black text-slate-800 text-lg">{group}</h2></div>
            <div className="divide-y divide-slate-100">
              {rows.map(row => <div key={row.item} className="p-4 flex items-start gap-3"><div className={`mt-0.5 rounded-full p-1 ${row.pass ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{row.pass ? <CheckCircle className="w-4 h-4"/> : <AlertTriangle className="w-4 h-4"/>}</div><div><p className="font-black text-slate-800">{row.item}</p><p className="text-xs font-bold text-slate-400 mt-1">{row.detail}</p></div></div>)}
            </div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b-2 border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-slate-500 mt-1"/>
            <div>
              <h2 className="font-black text-slate-800 text-lg">Manual Workflow Sign-off Checklist</h2>
              <p className="text-xs font-bold text-slate-400 mt-1">Use after deployment. Click each workflow after manually testing it.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="bg-slate-100 text-slate-700 rounded-xl px-3 py-2 text-xs font-black">{signedItems.length}/{workflowItems.length} signed • {signoffPct}%</span>
            {signedItems.length > 0 && <button type="button" onClick={clearSignoff} className="bg-rose-50 text-rose-600 rounded-xl px-3 py-2 text-xs font-black">Reset</button>}
          </div>
        </div>
        <div className="p-5 border-b border-slate-100">
          <div className="h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${signoffPct}%` }} /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-5">
          {workflowItems.map(item => {
            const signed = signedItems.includes(item);
            return (
              <button type="button" key={item} onClick={() => toggleSignoff(item)} className={`text-left border rounded-2xl p-4 flex items-center gap-3 transition ${signed ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-indigo-50 hover:border-indigo-100'}`}>
                {signed ? <CheckCircle className="w-4 h-4 text-emerald-600"/> : <XCircle className="w-4 h-4 text-slate-300"/>}
                <span className="font-bold">{item}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const SystemSettingsView = ({ projects = [], users = [], currentUser = null }) => {
  const [activeTool, setActiveTool] = useState('overview');
  const [reliability, setReliability] = useState(null);
  const [backups, setBackups] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [events, setEvents] = useState([]);
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemError, setSystemError] = useState('');

  const loadSystemData = async () => {
    setSystemLoading(true);
    setSystemError('');
    try {
      const [reliabilityResult, backupResult, jobsResult, eventsResult] = await Promise.all([
        getReliabilityStatusApi(),
        getBackupStatusApi(),
        getOperationalJobsApi({ limit:100 }),
        getOperationalEventsApi({ limit:100 })
      ]);
      setReliability(reliabilityResult);
      setBackups(backupResult);
      setJobs(Array.isArray(jobsResult.jobs) ? jobsResult.jobs : []);
      setEvents(Array.isArray(eventsResult.events) ? eventsResult.events : []);
    } catch (error) {
      setSystemError(error.message || 'System health information could not be loaded.');
    } finally {
      setSystemLoading(false);
    }
  };

  useEffect(() => {
    if (activeTool !== 'qa') loadSystemData();
  }, [activeTool]);

  const retryJob = async (jobId) => {
    try {
      await retryOperationalJobApi(jobId);
      await loadSystemData();
    } catch (error) {
      setSystemError(error.message || 'The job could not be retried.');
    }
  };

  const toolCards = [
    { key: 'qa', label: 'Production QA', title: 'System readiness', text: 'Run after updates, deployments or bug reports to confirm key workflows are healthy.' },
    { key: 'backup', label: 'Backup & Restore', title: 'Operational safety', text: 'See verified database and private-file backup freshness without allowing browser-based restoration.' },
    { key: 'operations', label: 'Failed Jobs', title: 'Reliability queue', text: 'Review failed persistence and operational work, then retry only jobs that are safe to replay.' },
    { key: 'audit', label: 'Operational Events', title: 'Traceability', text: 'Review structured reliability events with request IDs, severity and actor information.' }
  ];
  const failedJobs = jobs.filter(job => String(job.status || '').toUpperCase() === 'FAILED');
  const statusClass = reliability?.ok ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700';
  const formatBytes = value => {
    const bytes = Number(value || 0);
    if (!bytes) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
  };

  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Settings & System Health</h1>
          <p className="text-slate-500 font-medium mt-2">Admin maintenance tools are separated from daily operations to keep the main workflow clean.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={loadSystemData} disabled={systemLoading} className="bg-indigo-50 text-indigo-700 rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-50">{systemLoading ? 'Refreshing…' : 'Refresh health'}</button>
          {activeTool !== 'overview' && <button type="button" onClick={() => setActiveTool('overview')} className="bg-slate-100 text-slate-700 rounded-xl px-4 py-2.5 text-sm font-black w-fit">Back to Settings</button>}
        </div>
      </div>

      {systemError && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{systemError}</div>}
      {reliability && (
        <div className={`rounded-3xl border-2 p-5 ${statusClass}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div><p className="text-xs font-black uppercase tracking-widest">Runtime readiness</p><h2 className="text-xl font-black mt-1">{reliability.ok ? 'All required systems are ready' : 'Production attention required'}</h2></div>
            <p className="text-sm font-black">{failedJobs.length} failed job{failedJobs.length === 1 ? '' : 's'}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-4">
            {Object.entries(reliability.checks || {}).map(([key, ok]) => <div key={key} className="rounded-xl bg-white/70 px-3 py-2"><p className="text-[10px] font-black uppercase tracking-wider">{key.replace(/([A-Z])/g, ' $1')}</p><p className="text-sm font-black mt-1">{ok ? 'Healthy' : 'Attention'}</p></div>)}
          </div>
        </div>
      )}

      {activeTool === 'overview' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {toolCards.map(card => (
              <button key={card.key} type="button" onClick={() => setActiveTool(card.key)} className="text-left bg-white border-2 border-slate-100 rounded-3xl p-5 shadow-sm hover:border-indigo-100 hover:shadow-md transition">
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">{card.label}</p>
                <h2 className="font-black text-slate-800 mt-2">{card.title}</h2>
                <p className="text-sm font-bold text-slate-500 mt-1">{card.text}</p>
                <p className="text-xs font-black text-indigo-600 mt-4">Open →</p>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-100 p-4"><p className="text-xs font-black uppercase tracking-widest text-slate-400">Latest verified backup</p><p className="text-lg font-black text-slate-800 mt-2">{backups?.latest?.createdAt ? new Date(backups.latest.createdAt).toLocaleString() : 'Not found'}</p><p className="text-xs font-bold text-slate-500 mt-1">{backups?.status || 'Unknown'}{backups?.ageHours != null ? ` • ${backups.ageHours} hours old` : ''}</p></div>
            <div className="bg-white rounded-2xl border border-slate-100 p-4"><p className="text-xs font-black uppercase tracking-widest text-slate-400">Private storage disk</p><p className="text-lg font-black text-slate-800 mt-2">{reliability?.disk?.storage?.usedPercent ?? '-'}% used</p><p className="text-xs font-bold text-slate-500 mt-1">{formatBytes(reliability?.disk?.storage?.freeBytes)} free</p></div>
            <div className="bg-white rounded-2xl border border-slate-100 p-4"><p className="text-xs font-black uppercase tracking-widest text-slate-400">Database state</p><p className="text-lg font-black text-slate-800 mt-2">Version {reliability?.persistence?.stateVersion ?? '-'}</p><p className="text-xs font-bold text-slate-500 mt-1">Last durable save: {reliability?.persistence?.lastSuccess?.at ? new Date(reliability.persistence.lastSuccess.at).toLocaleString() : 'No write in this process'}</p></div>
          </div>
        </>
      )}

      {activeTool === 'qa' && <ProductionQAView projects={projects} users={users} currentUser={currentUser} />}
      {activeTool === 'backup' && (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-6"><h2 className="text-2xl font-black text-slate-800">Backup & Restore Readiness</h2><p className="text-slate-500 font-bold mt-2">Backups are created and verified from the VPS terminal. Browser restoration remains disabled to prevent accidental production data replacement.</p></div>
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="grid grid-cols-4 gap-3 px-4 py-3 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500"><span>Created</span><span>Type</span><span>Status</span><span>Size</span></div>
            {(backups?.manifests || []).map(item => <div key={item.id || item.manifestPath} className="grid grid-cols-4 gap-3 px-4 py-3 border-t border-slate-100 text-xs font-bold text-slate-600"><span>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}</span><span>{item.backupType || '-'}</span><span className={item.status === 'VERIFIED' ? 'text-emerald-600' : 'text-rose-600'}>{item.status || '-'}</span><span>{formatBytes(Object.values(item.components || {}).reduce((sum, part) => sum + Number(part?.sizeBytes || 0), 0))}</span></div>)}
            {!(backups?.manifests || []).length && <div className="p-8 text-center text-slate-400 font-bold">No verified backup manifest has been found.</div>}
          </div>
        </div>
      )}
      {activeTool === 'operations' && (
        <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100"><h2 className="text-2xl font-black text-slate-800">Failed Jobs & Retry Safety</h2><p className="text-slate-500 font-bold mt-2">Unsafe state-write failures are never replayed automatically. Safe operational checks may be queued again after review.</p></div>
          <div className="divide-y divide-slate-100">
            {failedJobs.map(job => <div key={job.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"><div><p className="font-black text-slate-800">{job.jobType}</p><p className="text-xs font-bold text-slate-500 mt-1">{job.error || 'Unknown failure'} • {job.updatedAt ? new Date(job.updatedAt).toLocaleString() : '-'}</p><p className="text-[10px] font-black text-slate-400 mt-1">Job {job.id} • attempts {job.attempts}/{job.maxAttempts}</p></div><button type="button" onClick={() => retryJob(job.id)} disabled={job.jobType === 'STATE_PERSISTENCE'} className="rounded-xl bg-indigo-50 px-4 py-2 text-xs font-black text-indigo-700 disabled:bg-slate-100 disabled:text-slate-400">{job.jobType === 'STATE_PERSISTENCE' ? 'Manual review required' : 'Queue retry'}</button></div>)}
            {!failedJobs.length && <div className="p-10 text-center text-emerald-600 font-black">No failed operational jobs.</div>}
          </div>
        </div>
      )}
      {activeTool === 'audit' && (
        <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100"><h2 className="text-2xl font-black text-slate-800">Operational Events</h2><p className="text-slate-500 font-bold mt-2">Structured reliability events supplement case timelines and finance audit records.</p></div>
          <div className="divide-y divide-slate-100 max-h-[620px] overflow-y-auto">{events.map(event => <div key={event.id} className="p-4"><div className="flex items-center justify-between gap-3"><p className="font-black text-slate-800">{event.event_type || event.eventType}</p><span className={`text-[10px] font-black ${String(event.severity).includes('ERROR') || String(event.severity).includes('FATAL') ? 'text-rose-600' : 'text-slate-500'}`}>{event.severity}</span></div><p className="text-xs font-bold text-slate-500 mt-1">{event.actor || 'system'} • {event.created_at ? new Date(event.created_at).toLocaleString() : '-'}</p><p className="text-[10px] font-mono text-slate-400 mt-1">Request {event.request_id || '-'}</p></div>)}{!events.length && <div className="p-10 text-center text-slate-400 font-bold">No persistent operational events available.</div>}</div>
        </div>
      )}
    </div>
  );
};

export const DailyClosingReport = ({ projects = [], currentUser = null }) => {
  const [dateKey, setDateKey] = useState(formatDateKey());
  const metrics = getTodayMetrics(projects, dateKey);
  const rows = [
    ['Cases Received', metrics.received], ['Carried Forward Pending', metrics.carriedCount], ['Cases Completed', metrics.completed], ['Urgent Revisions', metrics.revisions.length], ['Payments Received', `₹${metrics.paymentReceived.toLocaleString()}`], ['Pending Collections', `₹${metrics.pendingAmount.toLocaleString()}`]
  ];
  const handleExport = () => exportToCSV(['Metric','Value'], rows, `Daily_Closing_${dateKey}.csv`);
  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4"><div><h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Daily Closing Report</h1><p className="text-slate-500 font-medium mt-2">Official end-of-day snapshot for one selected date, including pending work carried forward.</p></div><div className="flex gap-3"><input type="date" value={dateKey} onChange={e => setDateKey(e.target.value)} className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2.5 font-bold text-slate-700 outline-none" /><button onClick={handleExport} className="bg-emerald-100 text-emerald-700 font-bold px-4 py-2.5 rounded-xl"><Download className="w-4 h-4 inline mr-2"/>Export</button></div></div>
      <div className="bg-slate-900 text-white rounded-3xl p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-widest text-slate-300">Daily Closing vs Reports</p><p className="text-sm font-bold text-slate-100 mt-2">Daily Closing is the official one-day operational summary for end-of-day review. Reports are flexible analytics for trends, banks, branches, team productivity and longer periods.</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">{rows.map(([label,value]) => <div key={label} className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><p className="text-xs text-slate-400 font-black uppercase tracking-widest">{label}</p><p className="text-3xl font-black text-slate-800 mt-2">{value}</p></div>)}</div>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"><div className="p-4 border-b border-slate-100"><h2 className="font-black text-slate-800 text-xl">Pending Carry Forward List</h2></div><div className="divide-y divide-slate-100">{metrics.carried.map(p => <div key={p.id} className="p-5 flex justify-between items-center"><div><p className="font-black text-slate-800">{formatTaskId(p.id)}</p><p className="text-xs font-bold text-slate-400">{getCustomerDisplayName(p)} • {p.location} • {p.assignedTo}</p></div><Badge colorClass={getStatusColor(p.status)}>{p.status}</Badge></div>)}{metrics.carried.length === 0 && <div className="p-10 text-center text-slate-400 font-bold">No previous pending tasks to carry forward.</div>}</div></div>
    </div>
  );
};
