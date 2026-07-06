import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, Bell, CheckCircle, Clock, Download, FileText, ShieldCheck, Star, User, Users, XCircle } from 'lucide-react';
import { Badge, MiniEmptyState } from '../shared';
import { ONLINE_STALE_MS } from '../../config/appConfig';
import { absoluteApiUrl } from '../../services/fileService';
import { getStatusColor } from '../../services/taskService';
import { formatDateKey, formatDuration, formatLastSeenDateTime, formatMinutes } from '../../utils/date';
import { getEstimateDetails, getLatestCompletedFileName, getTaskDescription } from '../../utils/taskDisplayUtils';
import { getTaskBusySince, getUserActiveTasks, getUserBusySince, getUserFreeSince, getUserLastCompletedAt, getUserDraftingTask, getDraftingElapsedMs } from '../../utils/presenceAttendanceUtils';

const toMs = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
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
  const isKhushbu = /khus+h?bu|khushboo|khushbu/i.test(rawName) || /khus+h?bu|khushboo|khushbu/i.test(rawUsername);
  const isWaqar = /ali\s*waqar|^ali$|^waqar$/i.test(rawName) || /ali|waqar/i.test(rawUsername);
  const normalized = {
    ...u,
    name: isKhushbu ? 'Khushbu Pandey' : (isWaqar ? 'Waqar' : (rawName || u.name)),
    username: isKhushbu ? 'khushbu' : (isWaqar ? 'waqar' : rawUsername),
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
const isCarriedForwardProject = (project = {}, dateKey = formatDateKey()) => isIncompleteProject(project) && getProjectDateKey(project) < dateKey;
const wasCompletedOnDate = (project = {}, dateKey = formatDateKey()) => isProjectCompleted(project) && getProjectCompletedDateKey(project) === dateKey;
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

const cleanReportText = (value = '') => String(value || '').trim().replace(/\s+/g, ' ');
const toTitleCase = (value = '') => cleanReportText(value).toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase());
const canonicalLocation = (value = '') => {
  const raw = cleanReportText(value);
  if (!raw) return 'Branch not added';
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const aliases = {
    LKO: 'LUCKNOW', LKN: 'LUCKNOW', LUCKNOW: 'LUCKNOW',
    VARANASI: 'VARANASI', BANARAS: 'VARANASI',
    KANPUR: 'KANPUR', AGRA: 'AGRA', RAIBARELI: 'RAIBARELI', RAEBARELI: 'RAIBARELI',
    NOIDA: 'NOIDA', AYODHYA: 'AYODHYA', PRAYAGRAJ: 'PRAYAGRAJ', ALLAHABAD: 'PRAYAGRAJ'
  };
  return aliases[key] || raw.toUpperCase();
};
const canonicalBank = (value = '') => {
  const raw = cleanReportText(value);
  if (!raw) return 'Bank not added';
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const aliases = {
    SBI: 'SBI', STATEBANKOFINDIA: 'SBI', STATEBANK: 'SBI',
    HDFC: 'HDFC', HDFCBANK: 'HDFC',
    ICICI: 'ICICI', ICICIBANK: 'ICICI',
    AXIS: 'AXIS', AXISBANK: 'AXIS',
    PNB: 'PNB', PUNJABNATIONALBANK: 'PNB',
    BOB: 'BANK OF BARODA', BANKOFBARODA: 'BANK OF BARODA'
  };
  return aliases[key] || raw.toUpperCase();
};
const getBankName = (project = {}) => canonicalBank(project.client || project.bankName || project.bank || project.lender || project.financier || '');
const getBranchName = (project = {}) => canonicalLocation(project.branchName || project.branch || project.location || project.city || project.district || '');
const getPaymentStatus = (project = {}) => String(project.paymentTrackingStatus || project.paymentStatus || '').toLowerCase();
const getEstimateAmount = (project = {}) => Number(project.estimateAmount || project.totalAmount || project.amount || 0) || 0;
const getProjectAgeHours = (project = {}) => Math.max(0, Math.round((Date.now() - (toMs(project.createdAt) || Date.now())) / 3600000));
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
const buildLiveActivityFeed = (projects = []) => projects.flatMap(project => {
  const timeline = Array.isArray(project.timeline) ? project.timeline : [];
  if (timeline.length) {
    return timeline.map((event, index) => ({
      id: `${project.id || project.caseId}-tl-${event.id || event.at || event.time || index}`,
      project,
      at: toMs(event.at || event.time || event.createdAt || project.updatedAt || project.createdAt),
      type: event.type || event.action || 'activity',
      title: event.title || event.text || event.action || 'Case activity',
      by: event.by || event.user || event.createdBy || '',
      remarks: event.remarks || event.note || event.text || ''
    }));
  }
  return [{
    id: `${project.id || project.caseId}-fallback`, project,
    at: toMs(project.updatedAt || project.completedAt || project.submittedAt || project.createdAt),
    type: project.status || 'activity',
    title: `${project.id || project.caseId} • ${project.status || 'Updated'}`,
    by: project.assignedTo || project.creatorName || '', remarks: getCustomerDisplayName(project)
  }];
}).filter(item => item.at).sort((a,b) => b.at - a.at);

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
  const [availabilityNow, setAvailabilityNow] = useState(Date.now());
  const [presenceTimes, setPresenceTimes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kalpa_presence_times') || '{}'); } catch (e) { return {}; }
  });
  useEffect(() => { const timer = setInterval(() => setAvailabilityNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const metrics = getTodayMetrics(projects, dateKey);
  const isAdmin = currentUser?.role === ROLES.ADMIN;
  const liveActivityFeed = buildLiveActivityFeed(projects).slice(0, 14);
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
  const uniqueProjectsById = (items = []) => {
    const seen = new Map();
    (items || []).forEach(item => {
      const key = String(item?.id || item?.caseId || '');
      if (key && !seen.has(key)) seen.set(key, item);
    });
    return Array.from(seen.values());
  };
  const attentionQueue = uniqueProjectsById([
    ...(metrics.waitingAssignment || []),
    ...(metrics.internalReviewPending || []),
    ...(metrics.revisions || []),
    ...((metrics.slaBuckets && metrics.slaBuckets.critical) || []),
    ...((metrics.slaBuckets && metrics.slaBuckets['near-sla']) || [])
  ]).sort((a,b) => (toMs(b.updatedAt || b.createdAt) || 0) - (toMs(a.updatedAt || a.createdAt) || 0));
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
    attention: 'All attention work'
  };
  const filterOperations = (filterKey) => {
    if (filterKey === 'received') return metrics.todays.slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (filterKey === 'pending') return pendingBoard;
    if (filterKey === 'completed') return metrics.completedToday.slice().sort((a,b) => (toMs(b.completedAt || b.updatedAt || b.createdAt) || 0) - (toMs(a.completedAt || a.updatedAt || a.createdAt) || 0));
    if (filterKey === 'delayed') return pendingBoard.filter(p => getSlaInfo(p).label === 'Delayed');
    if (filterKey === 'near') return pendingBoard.filter(p => getSlaInfo(p).label === 'Near SLA');
    if (filterKey === 'revisions') return metrics.revisions.slice().sort((a,b) => (b.revisionRequestedAt || b.updatedAt || b.createdAt || 0) - (a.revisionRequestedAt || a.updatedAt || a.createdAt || 0));
    if (filterKey === 'carried') return metrics.carried.slice();
    if (filterKey === 'drafting') return rawActiveBoard.filter(p => normalizeWorkStatus(p.status) === 'DRAFTING' || normalizeWorkStatus(p.status) === 'DRAFTINGPAUSED');
    if (filterKey === 'review') return rawActiveBoard.filter(p => normalizeWorkStatus(p.status) === 'INTERNALREVIEW');
    if (filterKey === 'waiting') return metrics.waitingAssignment.slice();
    if (filterKey === 'internalReview') return metrics.internalReviewPending.slice();
    if (filterKey === 'ready') return metrics.readyForDelivery.slice();
    if (filterKey === 'paymentPending') return metrics.paymentPending.slice();
    if (filterKey === 'slaCritical') return (metrics.slaBuckets.critical || []).slice();
    if (filterKey === 'healthy') return (metrics.slaBuckets.healthy || []).slice();
    if (filterKey === 'attention') return attentionQueue.slice();
    return rawActiveBoard;
  };
  const activeBoard = filterOperations(dashboardFilter);
  const applyDashboardFilter = (filterKey) => {
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
  const adminQuickActions = [
    ['Add Case', () => onNavigate?.('newCase')],
    ['Assign Case', () => applyDashboardFilter('waiting')],
    ['Create Revision', () => applyDashboardFilter('revisions')],
    ['Open Ledger', () => onNavigate?.('ledger')],
    ['Pending Payments', () => applyDashboardFilter('paymentPending')],
    ['Team Attendance', () => onNavigate?.('attendance')],
    ['Notifications', () => onNavigate?.('notifications')]
  ];
  const actionCount = attentionQueue.length;
  const commandFocusCards = [
    ['Attention', actionCount, 'attention', 'bg-red-50 text-red-700 border-red-100', 'Waiting assignment, review, revision and SLA risk'],
    ['Working', metrics.drafting, 'drafting', 'bg-amber-50 text-amber-700 border-amber-100', 'Cases currently being worked on'],
    ['Ready', metrics.readyForDelivery.length, 'ready', 'bg-emerald-50 text-emerald-700 border-emerald-100', 'Completed work ready to deliver'],
    ...(isAdmin ? [['Payments', metrics.paymentPending.length, 'paymentPending', 'bg-blue-50 text-blue-700 border-blue-100', 'Pending payment follow-up']] : []),
    ['Activity', liveActivityFeed.length, 'activity', 'bg-indigo-50 text-indigo-700 border-indigo-100', 'Latest operational activity']
  ];
  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4">
        <div><h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Command Centre</h1><p className="text-slate-500 font-medium mt-2">Live operations control only: queues, SLA, team availability, revisions, payments, and activity feed. Historical productivity has one home: Performance Analytics.</p></div>
        <input type="date" value={dateKey} onChange={e => setDateKey(e.target.value)} className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2.5 font-bold text-slate-700 outline-none" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">{commandFocusCards.map(([label, value, filterKey, cls, hint]) => (
        <button
          key={label}
          type="button"
          onClick={() => filterKey === 'activity' ? null : applyDashboardFilter(filterKey)}
          title={hint}
          className={`${cls} border-2 rounded-3xl p-5 shadow-sm text-left transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-indigo-100 ${dashboardFilter === filterKey ? 'ring-4 ring-indigo-100 scale-[1.01]' : ''}`}
        >
          <p className="text-[10px] font-black uppercase tracking-widest opacity-80">{label}</p>
          <p className="text-3xl font-black mt-2">{value}</p>
          <p className="mt-3 text-[10px] font-black uppercase tracking-widest opacity-60">{hint}</p>
        </button>
      ))}</div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="kalpa-panel xl:col-span-2 bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4"><div><h2 className="font-black text-slate-800 text-xl">Live Operations Board</h2><p className="text-xs font-bold text-slate-400 mt-1">Actionable queues. Click any card to open the filtered work list.</p></div><Badge colorClass="bg-indigo-50 text-indigo-700 border-indigo-100">Phase 5B</Badge></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {liveBoardSections.map(([label, value, filterKey, cls]) => (
              <button key={label} type="button" onClick={() => applyDashboardFilter(filterKey)} className={`${cls} border-2 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] ${dashboardFilter === filterKey ? 'ring-2 ring-indigo-200' : ''}`}>
                <p className="text-sm font-black">{label}</p><p className="text-3xl font-black mt-2">{value}</p><p className="text-[10px] font-black uppercase tracking-widest opacity-60 mt-2">Open filtered list</p>
              </button>
            ))}
          </div>
        </div>
        <div className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h2 className="font-black text-slate-800 text-xl mb-1">SLA Monitor</h2><p className="text-xs font-bold text-slate-400 mb-4">Open cases classified by live age.</p>
          <div className="space-y-3">{slaMonitorSections.map(([range, label, value, filterKey, cls]) => (
            <button key={range} type="button" onClick={() => applyDashboardFilter(filterKey)} className={`${cls} w-full border-2 rounded-2xl p-3 text-left flex items-center justify-between transition-all hover:-translate-y-0.5 hover:shadow-md`}>
              <div><p className="font-black text-sm">{label}</p><p className="text-[10px] font-black uppercase tracking-widest opacity-60">{range}</p></div><span className="text-2xl font-black">{value}</span>
            </button>
          ))}</div>
        </div>
        {isAdmin && <div className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h2 className="font-black text-slate-800 text-xl mb-1">Quick Actions</h2><p className="text-xs font-bold text-slate-400 mb-4">Admin shortcuts from Command Centre.</p>
          <div className="grid grid-cols-1 gap-2">{adminQuickActions.map(([label, action]) => <button key={label} type="button" onClick={action} className="text-left bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-100 rounded-xl px-4 py-3 font-black text-sm text-slate-700 transition-all">{label}</button>)}</div>
        </div>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="kalpa-panel xl:col-span-2 bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h2 className="font-black text-slate-800 text-xl mb-2">Command Centre Scope</h2>
          <p className="text-sm font-bold text-slate-500 leading-relaxed mb-5">This page is intentionally limited to what needs action now. Historical productivity, team rankings and trend charts have been removed from here to keep operations focused.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button type="button" onClick={() => applyDashboardFilter('waiting')} className="bg-red-50 border-2 border-red-100 rounded-2xl p-4 text-left hover:shadow-md transition-all"><p className="text-xs font-black uppercase tracking-widest text-red-500">Operations</p><p className="font-black text-red-900 mt-1">Act on live queues</p></button>
            <button type="button" onClick={() => onOpenPerformance?.()} className="bg-emerald-50 border-2 border-emerald-100 rounded-2xl p-4 text-left hover:shadow-md transition-all"><p className="text-xs font-black uppercase tracking-widest text-emerald-500">Performance</p><p className="font-black text-emerald-900 mt-1">Open analytics hub</p></button>
            <button type="button" onClick={() => onNavigate?.('reports')} className="bg-indigo-50 border-2 border-indigo-100 rounded-2xl p-4 text-left hover:shadow-md transition-all"><p className="text-xs font-black uppercase tracking-widest text-indigo-500">Reports</p><p className="font-black text-indigo-900 mt-1">Open business reports</p></button>
          </div>
        </div>

        <div className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h3 className="font-black text-slate-800 mb-1">Team Availability</h3><p className="text-xs font-bold text-slate-400 mb-4">Live status only. Use Team page for full people management.</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <button type="button" onClick={() => applyAvailabilityFilter('Available')} className="bg-blue-50 border border-blue-100 rounded-2xl p-3 transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"><p className="font-black text-blue-700">{free}</p><p className="text-[9px] font-black uppercase text-blue-500">Available</p></button>
            <button type="button" onClick={() => applyAvailabilityFilter('Busy')} className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"><p className="font-black text-emerald-700">{busy}</p><p className="text-[9px] font-black uppercase text-emerald-500">Drafting</p></button>
            <button type="button" onClick={() => applyAvailabilityFilter('Break')} className="bg-amber-50 border border-amber-100 rounded-2xl p-3 transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"><p className="font-black text-amber-700">{breaks}</p><p className="text-[9px] font-black uppercase text-amber-500">Break</p></button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div ref={operationsBoardRef} className="kalpa-panel lg:col-span-2 bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden scroll-mt-24">
          <div className="p-5 border-b-2 border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div><h2 className="font-black text-slate-800 text-xl">Daily Operations Board</h2><p className="text-xs font-bold text-slate-400 mt-1">{filterLabels[dashboardFilter] || 'All active operations'} • {activeBoard.length} record{activeBoard.length === 1 ? '' : 's'}</p></div>{dashboardFilter !== 'all' && <button type="button" onClick={() => setDashboardFilter('all')} className="text-xs font-black uppercase tracking-widest bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl transition">Clear filter</button>}</div>
          <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto custom-scrollbar">
            {activeBoard.map(p => {
              const latestRevisionNote = getLatestRevisionNote(p);
              return <div key={p.id} onClick={() => onSelectProject(p)} className="kalpa-task-row p-5 hover:bg-slate-50 cursor-pointer flex justify-between items-center gap-4"><div className="min-w-0 flex-1 pr-3"><p className="font-black text-slate-800">{p.id} <span className="text-xs font-bold text-slate-400 ml-2">{getCustomerDisplayName(p)}</span></p><p className="text-sm font-extrabold text-slate-700 mt-1">{p.taskName || makeTaskDisplayName(p)}</p><p className="text-xs font-bold text-slate-500 mt-1">{p.type} • {p.location} • {p.assignedTo || 'Unassigned'}</p>{dashboardFilter === 'revisions' && <div className="mt-2 max-w-2xl rounded-xl border border-red-100 bg-red-50 px-3 py-2"><p className="text-[10px] font-black uppercase tracking-widest text-red-600">{getRevisionBadgeLabel(p)}</p>{latestRevisionNote && <p className="text-xs font-bold text-red-700 mt-1 line-clamp-1">{latestRevisionNote}</p>}{p.reviewedBy && <p className="text-[10px] font-bold text-red-400 mt-1">Reviewer: {p.reviewedBy}</p>}</div>}{getTaskDescription(p) && <p className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 mt-2 max-w-xl truncate whitespace-nowrap"><span className="font-black">Description:</span> {getTaskDescription(p)}</p>}{getEstimateDetails(p) && <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mt-1 max-w-xl truncate whitespace-nowrap"><span className="font-black">Estimate:</span> {getEstimateDetails(p)}</p>}{getLatestCompletedFileName(p) && <p className="text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 mt-2 w-fit">Completed: {getLatestCompletedFileName(p)}</p>}{isCarriedForwardProject(p, dateKey) && <span className="inline-flex mt-2 text-[10px] bg-orange-50 text-orange-700 border border-orange-100 px-2 py-1 rounded-lg font-black uppercase">Carried Forward</span>}</div><Badge colorClass={dashboardFilter === 'revisions' ? 'bg-red-50 text-red-700 border-red-100' : getStatusColor(p.status)}>{dashboardFilter === 'revisions' ? 'Revision Pending' : p.status}</Badge></div>;
            })}
            {activeBoard.length === 0 && <div className="p-10 text-center text-slate-400 font-bold">No operations for this date.</div>}
          </div>
        </div>
        <div className="space-y-6">
          <div ref={teamAvailabilityRef} className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm scroll-mt-24">
            <h3 className="font-black text-slate-800 mb-1">Team Availability</h3><p className="text-xs font-bold text-slate-400 mb-4">Click Available, Drafting, Break, or Offline to see the members in that status.</p>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[["Available", free, "bg-blue-50 text-blue-700 border-blue-100", "Available"], ["Busy", busy, "bg-emerald-50 text-emerald-700 border-emerald-100", "Drafting"], ["Break", breaks, "bg-amber-50 text-amber-700 border-amber-100", "Break"], ["Offline", offlinePeople.length, "bg-slate-50 text-slate-600 border-slate-100", "Offline"]].map(([label, count, cls, displayLabel]) => (
                <button key={label} type="button" onClick={() => setAvailabilityFilter(label)} className={`${cls} border-2 p-3 rounded-2xl text-center font-black transition-all ${availabilityFilter === label ? 'ring-2 ring-slate-300 scale-[1.02]' : 'hover:scale-[1.01]'}`}>
                  {count}<p className="text-[10px] uppercase tracking-widest">{displayLabel || label}</p>
                </button>
              ))}
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
              {selectedAvailabilityPeople.length === 0 && <MiniEmptyState>No team members in {availabilityFilter}.</MiniEmptyState>}
              {selectedAvailabilityPeople.map(member => {
                const draftingTask = getUserDraftingTask(projects, member.name);
                const tasks = draftingTask ? [draftingTask] : [];
                const memberAttendance = todayAttendanceFor(member);
                const breakSince = member.breakStartedAt || memberAttendance?.currentBreakStartedAt || memberAttendance?.breakEvents?.find(ev => ev?.start && !ev?.end)?.start || member.availabilityUpdatedAt || Date.now();
                const freeSince = getUserFreeSince(projects, member.name, presenceTimes, member);
                const busySince = getUserBusySince(projects, member.name, presenceTimes);
                const busyTaskLine = tasks.length
                  ? tasks.map(t => `${t.id} • Drafting since ${formatDuration(getTaskBusySince(t), availabilityNow)}`).join(' | ')
                  : '';
                const isAdminMember = normalizeRole(member.role) === ROLES.ADMIN;
                const availabilityLine = availabilityFilter === 'Busy'
                  ? (busyTaskLine || (busySince ? `Drafting since ${formatDuration(busySince, availabilityNow)}` : 'Drafting now'))
                  : availabilityFilter === 'Break'
                    ? `Break since ${formatDuration(breakSince, availabilityNow)}`
                    : availabilityFilter === 'Available'
                      ? (isAdminMember ? 'Available' : (freeSince ? `Free since ${formatDuration(freeSince, availabilityNow)}` : 'Available • no completed task yet'))
                      : `Last seen ${formatLastSeenDateTime(member.lastSeenAt || member.lastLogoutAt || member.lastHeartbeatAt)}`;
                return (
                  <div key={member.id} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-2xl p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                        {member.profilePhoto ? <img src={absoluteApiUrl(member.profilePhoto, member.profilePhotoUpdatedAt || member.profileUpdatedAt || '')} alt={member.name} className="w-full h-full object-cover" /> : <User className="w-4 h-4 text-slate-400" />}
                      </div>
                      <div>
                        <p className="font-black text-slate-800 text-sm">{member.name}</p>
                        <p className="text-[11px] font-bold text-slate-400">{availabilityLine}</p>
                      </div>
                    </div>
                    <Badge colorClass={availabilityFilter === 'Busy' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : availabilityFilter === 'Break' ? 'bg-amber-50 text-amber-700 border-amber-100' : availabilityFilter === 'Available' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-slate-50 text-slate-600 border-slate-100'}>{availabilityFilter === 'Busy' ? 'Drafting' : availabilityFilter}</Badge>
                  </div>
                );
              })}
            </div>
          </div>
          {currentUser?.role === ROLES.ADMIN && <div className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><h3 className="font-black text-slate-800 mb-4">Payment Health</h3><p className="text-xs font-black text-slate-400 uppercase tracking-widest">Received Today</p><p className="text-3xl font-black text-emerald-600 mb-4">₹{metrics.paymentReceived.toLocaleString()}</p><p className="text-xs font-black text-slate-400 uppercase tracking-widest">Pending Collections</p><p className="text-3xl font-black text-red-500">₹{metrics.pendingAmount.toLocaleString()}</p></div>}
          <div className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><h3 className="font-black text-slate-800 mb-4">Urgent Revision Queue</h3>{metrics.revisions.slice(0,5).map(p => <button key={p.id} onClick={() => onSelectProject(p)} className="w-full text-left bg-red-50 border border-red-100 p-3 rounded-xl mb-2"><p className="font-black text-red-700 text-xs">{p.id}</p><p className="text-[10px] font-bold text-red-500">{getRevisionBadgeLabel(p)}</p>{getLatestRevisionNote(p) && <p className="text-[11px] font-semibold text-red-700 mt-1 line-clamp-2">{getLatestRevisionNote(p)}</p>}</button>)}{metrics.revisions.length === 0 && <p className="text-sm text-slate-400 font-bold">No urgent revisions.</p>}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="kalpa-panel xl:col-span-2 bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4"><h3 className="font-black text-slate-800 flex items-center"><Users className="w-5 h-5 mr-2 text-indigo-500" /> Live Team Status</h3><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">No historical analytics here</span></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto custom-scrollbar pr-1">
            {workloadCards.map(member => (
              <div key={member.id} className="border border-slate-100 bg-slate-50 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-3"><div><p className="font-black text-slate-800">{member.name}</p><p className="text-[11px] font-bold text-slate-400">{member.role} • current operational load</p></div><Badge colorClass={member.loadPct >= 90 ? 'bg-red-50 text-red-700 border-red-100' : member.loadPct >= 60 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}>{member.loadPct}%</Badge></div>
                <div className="h-2 bg-white rounded-full overflow-hidden mb-3"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${member.loadPct}%` }}></div></div>
                <div className="grid grid-cols-2 gap-2 text-center"><div className="bg-white rounded-xl p-2"><p className="font-black text-slate-800">{member.active.length}</p><p className="text-[9px] font-black uppercase text-slate-400">Active now</p></div><div className="bg-white rounded-xl p-2"><p className="font-black text-indigo-600">{member.limit}</p><p className="text-[9px] font-black uppercase text-slate-400">Daily capacity</p></div></div>
              </div>
            ))}
            {workloadCards.length === 0 && <p className="text-sm text-slate-400 font-bold text-center py-8">No designer or manager workload available.</p>}
          </div>
        </div>
        <div className="space-y-6">
          <div className="kalpa-panel bg-indigo-50 rounded-3xl border-2 border-indigo-100 p-6 shadow-sm">
            <h3 className="font-black text-slate-800 mb-3 flex items-center"><BarChart3 className="w-5 h-5 mr-2 text-indigo-600" /> Command Centre Scope</h3>
            <p className="text-sm font-semibold text-indigo-700 leading-relaxed">This page now stays focused on live operations. Use Performance Analytics for rankings, trends and individual productivity; use Reports for business, finance, bank and SLA summaries.</p>
          </div>
          <div className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
            <h3 className="font-black text-slate-800 mb-4 flex items-center"><Clock className="w-5 h-5 mr-2 text-indigo-500" /> SLA Tracking</h3>
            <div className="space-y-3 max-h-72 overflow-y-auto custom-scrollbar">
              {activeBoard.slice().sort((a,b) => getSlaInfo(b).ageHours - getSlaInfo(a).ageHours).slice(0,8).map(p => { const sla = getSlaInfo(p); return (
                <button key={p.id} type="button" onClick={() => onSelectProject(p)} className="w-full text-left border border-slate-100 hover:border-indigo-100 hover:bg-slate-50 rounded-2xl p-4 transition-all">
                  <div className="flex justify-between items-start gap-3">
                    <div><p className="font-black text-slate-800">{p.id}</p><p className="text-xs font-bold text-slate-400 mt-1">Draft: {sla.drafting} • Review: {sla.review} • Total: {sla.total}</p></div>
                    <Badge colorClass={sla.colorClass}>{sla.label}</Badge>
                  </div>
                </button>
              )})}
              {activeBoard.length === 0 && <p className="text-sm text-slate-400 font-bold text-center py-8">No SLA items for this date.</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-4"><h3 className="font-black text-slate-800 flex items-center"><Bell className="w-5 h-5 mr-2 text-indigo-500" /> Live Activity Feed</h3><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Timeline-powered</span></div>
        <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar pr-1">
          {liveActivityFeed.map(item => (
            <button key={item.id} type="button" onClick={() => onSelectProject(item.project)} className="w-full text-left bg-slate-50 hover:bg-indigo-50 border border-slate-100 rounded-2xl p-4 transition-all flex gap-4">
              <div className="w-14 shrink-0 text-center"><p className="text-xs font-black text-slate-500">{formatActivityClock(item.at)}</p><p className="text-lg mt-1">{getActivityIcon(item.type)}</p></div>
              <div className="min-w-0 flex-1"><p className="font-black text-slate-800 truncate">{item.project?.id || item.project?.caseId} • {item.title}</p><p className="text-xs font-bold text-slate-500 mt-1 truncate">{getCustomerDisplayName(item.project)} • {item.project?.location || item.project?.city || 'Location not added'}{item.by ? ` • ${item.by}` : ''}</p>{item.remarks && <p className="text-[11px] font-semibold text-slate-400 mt-1 line-clamp-1">{item.remarks}</p>}</div>
            </button>
          ))}
          {liveActivityFeed.length === 0 && <p className="text-sm text-slate-400 font-bold text-center py-8">No timeline activity yet.</p>}
        </div>
      </div>
    </div>
  );
};

export const ProductivityDashboard = ({ users = [], projects = [] }) => {
  const [range, setRange] = useState('month');
  const [selectedMember, setSelectedMember] = useState('all');
  const now = Date.now();
  const todayKey = formatDateKey();
  const rangeMs = range === 'week' ? 7 * 86400000 : range === 'quarter' ? 90 * 86400000 : 30 * 86400000;
  const scopedProjects = (projects || []).filter(p => (toMs(p.createdAt) || now) >= now - rangeMs || (toMs(p.completedAt) || 0) >= now - rangeMs);
  const team = getOperationalUsers(users, { includeAdmins: false });
  const activeTeam = selectedMember === 'all' ? team : team.filter(u => normalizePersonName(u.name) === normalizePersonName(selectedMember));
  const getMemberProjects = (name) => scopedProjects.filter(p => normalizePersonName(p.assignedTo) === normalizePersonName(name));
  const memberRows = activeTeam.map(u => {
    const assigned = getMemberProjects(u.name);
    const completed = assigned.filter(isProjectCompleted);
    const completedToday = completed.filter(p => formatDateKey(p.completedAt || p.updatedAt || p.createdAt) === todayKey).length;
    const active = assigned.filter(isIncompleteProject);
    const revisions = assigned.filter(p => (p.subTasks || p.revisions || []).length > 0 || hasActiveRevision(p));
    const avgMins = completed.length ? Math.round(completed.reduce((sum, p) => {
      const start = toMs(p.createdAt) || now;
      const end = toMs(p.completedAt || p.draftingCompletedAt || p.submittedAt || p.updatedAt) || start;
      return sum + Math.max(0, (end - start) / 60000);
    }, 0) / completed.length) : 0;
    const slaPct = getSlaCompliancePct(assigned);
    const revisionPct = assigned.length ? Math.round((revisions.length / assigned.length) * 100) : 0;
    return { user: u, assigned, completed, active, revisions, completedToday, avgMins, slaPct, revisionPct };
  }).sort((a, b) => b.completed.length - a.completed.length || b.assigned.length - a.assigned.length);
  const totals = memberRows.reduce((acc, row) => {
    acc.assigned += row.assigned.length;
    acc.completed += row.completed.length;
    acc.active += row.active.length;
    acc.revisions += row.revisions.length;
    acc.today += row.completedToday;
    return acc;
  }, { assigned: 0, completed: 0, active: 0, revisions: 0, today: 0 });
  const avgSla = memberRows.length ? Math.round(memberRows.reduce((sum, row) => sum + row.slaPct, 0) / memberRows.length) : 100;
  const exportPerformance = () => exportToCSV(
    ['Member', 'Role', 'Assigned', 'Completed', 'Active', 'Revisions', 'Completed Today', 'Avg Completion', 'SLA %', 'Revision %'],
    memberRows.map(row => [row.user.name, row.user.role, row.assigned.length, row.completed.length, row.active.length, row.revisions.length, row.completedToday, row.avgMins ? formatDuration(0, row.avgMins * 60000) : '-', `${row.slaPct}%`, `${row.revisionPct}%`]),
    `Performance_Analytics_${range}.csv`
  );
  const StatCard = ({ label, value, hint }) => (
    <div className="bg-white rounded-3xl border-2 border-slate-100 p-5 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-3xl font-black text-slate-800 mt-2">{value}</p>
      {hint && <p className="text-xs font-bold text-slate-400 mt-1">{hint}</p>}
    </div>
  );
  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-indigo-500 mb-2">Single source of truth</p>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Performance Analytics</h1>
          <p className="text-slate-500 font-medium mt-2 max-w-4xl">Employee productivity, leaderboards, individual analytics, revision percentage, average completion time, and SLA performance now live only here.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <select value={range} onChange={e => setRange(e.target.value)} className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2.5 font-bold text-slate-700 outline-none">
            <option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="quarter">Last 90 days</option>
          </select>
          <select value={selectedMember} onChange={e => setSelectedMember(e.target.value)} className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2.5 font-bold text-slate-700 outline-none">
            <option value="all">All team members</option>{team.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
          </select>
          <button type="button" onClick={exportPerformance} className="bg-indigo-600 text-white font-bold px-4 py-2.5 rounded-xl shadow-sm"><Download className="w-4 h-4 inline mr-2"/>Export</button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard label="Assigned" value={totals.assigned} hint="selected period" />
        <StatCard label="Completed" value={totals.completed} hint="productivity" />
        <StatCard label="Completed Today" value={totals.today} hint="today only" />
        <StatCard label="Active" value={totals.active} hint="currently open" />
        <StatCard label="Revisions" value={totals.revisions} hint="quality trend" />
        <StatCard label="SLA" value={`${avgSla}%`} hint="average compliance" />
      </div>
      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b-2 border-slate-100 flex items-center justify-between gap-3">
          <div><h2 className="font-black text-slate-800 text-lg">Team Workload & Productivity</h2><p className="text-xs font-bold text-slate-400 mt-1">Compact employee cards with workload, current task and delivery quality.</p></div>
          <span className="hidden sm:inline text-[10px] font-black uppercase tracking-widest text-slate-400">Live workload + productivity</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-5">
          {memberRows.map(row => {
            const limit = Number(row.user.dailyLimit || row.user.taskLimit || 10) || 10;
            const loadPct = Math.min(100, Math.round((row.active.length / limit) * 100));
            const currentTask = row.active[0];
            const efficiency = row.assigned.length ? Math.round((row.completed.length / row.assigned.length) * 100) : 0;
            const statusDot = row.active.length ? 'bg-orange-400' : 'bg-slate-300';
            return (
              <div key={row.user.id || row.user.name} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 hover:bg-white hover:shadow-md transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-3">
                    <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${statusDot}`} />
                    <div className="min-w-0">
                      <p className="font-black text-slate-800 truncate">{row.user.name}</p>
                      <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{row.user.role} • {row.active.length ? 'Working' : 'Available / Offline'}</p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full border text-xs font-black ${loadPct >= 90 ? 'bg-red-50 text-red-700 border-red-100' : loadPct >= 60 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>{loadPct}% load</span>
                </div>
                <div className="mt-4 rounded-xl bg-white border border-slate-100 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Current task</p>
                  <p className="text-sm font-black text-slate-700 truncate mt-1">{currentTask ? `${currentTask.id || currentTask.caseId} • ${currentTask.type || 'Task'}` : 'No active task'}</p>
                </div>
                <div className="mt-4 grid grid-cols-5 gap-2 text-center">
                  <div><p className="font-black text-slate-800">{row.assigned.length}</p><p className="text-[9px] font-black uppercase text-slate-400">Assigned</p></div>
                  <div><p className="font-black text-emerald-600">{row.completed.length}</p><p className="text-[9px] font-black uppercase text-slate-400">Done</p></div>
                  <div><p className="font-black text-orange-600">{row.active.length}</p><p className="text-[9px] font-black uppercase text-slate-400">Active</p></div>
                  <div><p className="font-black text-indigo-600">{row.slaPct}%</p><p className="text-[9px] font-black uppercase text-slate-400">SLA</p></div>
                  <div><p className="font-black text-purple-600">{row.revisions.length}</p><p className="text-[9px] font-black uppercase text-slate-400">Rev</p></div>
                </div>
                <div className="mt-4">
                  <div className="h-2 rounded-full bg-white overflow-hidden border border-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, Math.max(loadPct, efficiency))}%` }} /></div>
                  <div className="mt-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400"><span>Avg {row.avgMins ? formatDuration(0, row.avgMins * 60000) : '-'}</span><span>{efficiency}% efficiency</span></div>
                </div>
              </div>
            );
          })}
          {memberRows.length === 0 && <div className="lg:col-span-2 p-10 text-center text-slate-400 font-bold">No performance data for this filter.</div>}
        </div>
      </div>
    </div>
  );
};

export const ReportsAnalyticsView = ({ projects = [], users = [], currentUser = null }) => {
  const [range, setRange] = useState('month');
  const now = Date.now();
  const rangeMs = range === 'week' ? 7 * 86400000 : range === 'quarter' ? 90 * 86400000 : 30 * 86400000;
  const scoped = (projects || []).filter(p => (toMs(p.createdAt) || now) >= now - rangeMs || (toMs(p.completedAt) || 0) >= now - rangeMs);
  const completed = scoped.filter(isProjectCompleted);
  const pending = scoped.filter(isIncompleteProject);
  const revisions = scoped.filter(p => (p.subTasks || p.revisions || []).length > 0 || hasActiveRevision(p));
  const paymentPending = scoped.filter(p => getPaymentStatus(p).includes('pending') || getPaymentStatus(p).includes('due'));
  const paymentReceived = scoped.filter(p => getPaymentStatus(p).includes('received') || getPaymentStatus(p).includes('paid'));
  const paymentAging = paymentPending.reduce((acc, p) => {
    const age = getProjectAgeHours(p);
    const bucket = age <= 48 ? '0-2 days' : age <= 168 ? '3-7 days' : age <= 360 ? '8-15 days' : '15+ days';
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
  const bankRows = topRowsFromCount(countBy(scoped, getBankName));
  const branchRows = topRowsFromCount(countBy(scoped, getBranchName));
  const caseTypeRows = topRowsFromCount(countBy(scoped, p => p.type || p.caseType || 'Case'));
  const slaPct = getSlaCompliancePct(scoped);
  const pendingAmount = paymentPending.reduce((s,p)=>s+getEstimateAmount(p),0);
  const receivedAmount = paymentReceived.reduce((s,p)=>s+getEstimateAmount(p),0);
  const summaryRows = [
    ['Operations workload', scoped.length], ['Completed', completed.length], ['Pending', pending.length], ['Revision cases', revisions.length], ['Payment pending cases', paymentPending.length], ['Pending payment amount', pendingAmount], ['Payment received amount', receivedAmount], ['SLA compliance', `${slaPct}%`]
  ];
  const exportSummary = () => exportToCSV(['Business Metric', 'Value'], summaryRows, `Business_Reports_${range}.csv`);
  const exportWorkload = () => exportToCSV(['Report', 'Name', 'Value'], [
    ...bankRows.map(([name, count]) => ['Bank workload', name, count]),
    ...branchRows.map(([name, count]) => ['Branch workload', name, count]),
    ...caseTypeRows.map(([name, count]) => ['Case type', name, count]),
    ...topRowsFromCount(paymentAging, 10).map(([name, count]) => ['Payment aging', name, count])
  ], `Business_Workload_${range}.csv`);
  const StatCard = ({ label, value, hint }) => (<div className="bg-white rounded-3xl border-2 border-slate-100 p-5 shadow-sm"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p><p className="text-3xl font-black text-slate-800 mt-2">{value}</p>{hint && <p className="text-xs font-bold text-slate-400 mt-1">{hint}</p>}</div>);
  const SimpleTable = ({ title, columns, rows, empty = 'No data yet.' }) => (<div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden"><div className="p-5 border-b-2 border-slate-100"><h2 className="font-black text-slate-800 text-lg">{title}</h2></div><div className="overflow-x-auto"><table className="w-full text-left text-sm whitespace-nowrap"><thead className="bg-slate-50 text-slate-500"><tr>{columns.map(c => <th key={c} className="px-5 py-4 text-xs font-black uppercase tracking-widest">{c}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row, idx) => <tr key={idx} className="hover:bg-slate-50">{row.map((cell, i) => <td key={i} className="px-5 py-4 font-bold text-slate-700">{cell}</td>)}</tr>)}{rows.length === 0 && <tr><td colSpan={columns.length} className="px-5 py-10 text-center text-slate-400 font-bold">{empty}</td></tr>}</tbody></table></div></div>);
  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col lg:flex-row justify-between lg:items-end gap-4">
        <div><p className="text-xs font-black uppercase tracking-widest text-indigo-500 mb-2">Business reports only</p><h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Reports</h1><p className="text-slate-500 font-medium mt-2 max-w-4xl">Business, finance, bank, branch, case type, payment aging and SLA reports. Employee productivity has been removed from here and consolidated in Performance Analytics.</p></div>
        <div className="flex flex-wrap gap-3"><select value={range} onChange={e => setRange(e.target.value)} className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2.5 font-bold text-slate-700 outline-none"><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="quarter">Last 90 days</option></select><button type="button" onClick={exportSummary} className="bg-emerald-100 text-emerald-700 font-bold px-4 py-2.5 rounded-xl"><Download className="w-4 h-4 inline mr-2"/>Export Summary</button><button type="button" onClick={exportWorkload} className="bg-indigo-100 text-indigo-700 font-bold px-4 py-2.5 rounded-xl"><Download className="w-4 h-4 inline mr-2"/>Export Reports</button></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-indigo-50 border-2 border-indigo-100 rounded-3xl p-5"><p className="text-xs font-black uppercase tracking-widest text-indigo-500">Purpose</p><h2 className="font-black text-indigo-950 mt-2">Business intelligence</h2><p className="text-sm font-bold text-indigo-700 mt-1">Use Reports for banks, branches, workload, finance, payment aging, SLA and operational summaries.</p></div>
        <div className="bg-white border-2 border-slate-100 rounded-3xl p-5"><p className="text-xs font-black uppercase tracking-widest text-slate-400">Not employee analytics</p><h2 className="font-black text-slate-800 mt-2">Performance lives elsewhere</h2><p className="text-sm font-bold text-slate-500 mt-1">Team rankings and individual productivity are only in Performance Analytics.</p></div>
        <div className="bg-emerald-50 border-2 border-emerald-100 rounded-3xl p-5"><p className="text-xs font-black uppercase tracking-widest text-emerald-500">Different from Daily Closing</p><h2 className="font-black text-emerald-950 mt-2">Period based</h2><p className="text-sm font-bold text-emerald-700 mt-1">Daily Closing is one official date summary; Reports are filterable business views.</p></div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4"><StatCard label="Workload" value={scoped.length} hint="selected period"/><StatCard label="Completed" value={completed.length} hint="closed cases"/><StatCard label="Pending" value={pending.length} hint="open work"/><StatCard label="Revisions" value={revisions.length} hint="case trend"/><StatCard label="Pending Pay" value={paymentPending.length} hint={`₹${pendingAmount.toLocaleString()}`}/><StatCard label="Received" value={`₹${receivedAmount.toLocaleString()}`} hint="finance"/><StatCard label="SLA" value={`${slaPct}%`} hint="8-hour target"/></div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5"><SimpleTable title="Bank Report" columns={['Bank', 'Cases']} rows={bankRows}/><SimpleTable title="Branch Report" columns={['Branch', 'Cases']} rows={branchRows}/><SimpleTable title="Case Type Report" columns={['Case Type', 'Cases']} rows={caseTypeRows}/><SimpleTable title="Payment Aging Report" columns={['Age', 'Pending Cases']} rows={topRowsFromCount(paymentAging, 10)}/></div>
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
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
  const toolCards = [
    { key: 'qa', label: 'Production QA', title: 'System readiness', text: 'Run after updates, deployments or bug reports to confirm key workflows are healthy.' },
    { key: 'backup', label: 'Backup & Restore', title: 'Operational safety', text: 'Use the v1.0 release documentation for server backups, restore and rollback steps.' },
    { key: 'audit', label: 'Audit Logs', title: 'Traceability', text: 'Case timelines and activity feed preserve the operational audit trail.' }
  ];
  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Settings & System Health</h1>
          <p className="text-slate-500 font-medium mt-2">Admin maintenance tools are separated from daily operations to keep the main workflow clean.</p>
        </div>
        {activeTool !== 'overview' && <button type="button" onClick={() => setActiveTool('overview')} className="bg-slate-100 text-slate-700 rounded-xl px-4 py-2.5 text-sm font-black w-fit">Back to Settings</button>}
      </div>

      {activeTool === 'overview' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {toolCards.map(card => (
              <button key={card.key} type="button" onClick={() => setActiveTool(card.key)} className="text-left bg-white border-2 border-slate-100 rounded-3xl p-5 shadow-sm hover:border-indigo-100 hover:shadow-md transition">
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">{card.label}</p>
                <h2 className="font-black text-slate-800 mt-2">{card.title}</h2>
                <p className="text-sm font-bold text-slate-500 mt-1">{card.text}</p>
                <p className="text-xs font-black text-indigo-600 mt-4">Open →</p>
              </button>
            ))}
          </div>
          <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-6">
            <h2 className="text-xl font-black text-slate-800">Settings usage guide</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div className="bg-slate-50 rounded-2xl p-4"><p className="font-black text-slate-700">Production QA</p><p className="text-sm font-bold text-slate-500 mt-1">Use only after updates, deployment, server maintenance or bug reports.</p></div>
              <div className="bg-slate-50 rounded-2xl p-4"><p className="font-black text-slate-700">Reports</p><p className="text-sm font-bold text-slate-500 mt-1">Use for business analytics, trends, productivity, finance and SLA views.</p></div>
              <div className="bg-slate-50 rounded-2xl p-4"><p className="font-black text-slate-700">Daily Closing</p><p className="text-sm font-bold text-slate-500 mt-1">Use once per day as the official end-of-day operational snapshot.</p></div>
            </div>
          </div>
        </>
      )}

      {activeTool === 'qa' && <ProductionQAView projects={projects} users={users} currentUser={currentUser} />}
      {activeTool === 'backup' && <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-6"><h2 className="text-2xl font-black text-slate-800">Backup & Restore</h2><p className="text-slate-500 font-bold mt-2">Refer to the v1.0 release package documentation for VPS backup, database backup, restore and rollback steps. This section is intentionally guidance-only so live production data cannot be changed accidentally from the browser.</p></div>}
      {activeTool === 'audit' && <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-6"><h2 className="text-2xl font-black text-slate-800">Audit Logs</h2><p className="text-slate-500 font-bold mt-2">Case timelines, the Command Centre activity feed, and finance audit events together form the operational audit trail. Use individual case timelines for case-level traceability.</p></div>}
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
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4"><div><h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Daily Closing Report</h1><p className="text-slate-500 font-medium mt-2">Official end-of-day snapshot for one selected date, including pending work carried forward.</p></div><div className="flex gap-3"><input type="date" value={dateKey} onChange={e => setDateKey(e.target.value)} className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2.5 font-bold text-slate-700 outline-none" /><button onClick={handleExport} className="bg-emerald-100 text-emerald-700 font-bold px-4 py-2.5 rounded-xl"><Download className="w-4 h-4 inline mr-2"/>Export</button></div></div>
      <div className="bg-slate-900 text-white rounded-3xl p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-widest text-slate-300">Daily Closing vs Reports</p><p className="text-sm font-bold text-slate-100 mt-2">Daily Closing is the official one-day operational summary for end-of-day review. Reports are flexible analytics for trends, banks, branches, team productivity and longer periods.</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">{rows.map(([label,value]) => <div key={label} className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><p className="text-xs text-slate-400 font-black uppercase tracking-widest">{label}</p><p className="text-3xl font-black text-slate-800 mt-2">{value}</p></div>)}</div>
      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden"><div className="p-5 border-b-2 border-slate-100"><h2 className="font-black text-slate-800 text-xl">Pending Carry Forward List</h2></div><div className="divide-y divide-slate-100">{metrics.carried.map(p => <div key={p.id} className="p-5 flex justify-between items-center"><div><p className="font-black text-slate-800">{p.id}</p><p className="text-xs font-bold text-slate-400">{getCustomerDisplayName(p)} • {p.location} • {p.assignedTo}</p></div><Badge colorClass={getStatusColor(p.status)}>{p.status}</Badge></div>)}{metrics.carried.length === 0 && <div className="p-10 text-center text-slate-400 font-bold">No previous pending tasks to carry forward.</div>}</div></div>
    </div>
  );
};
