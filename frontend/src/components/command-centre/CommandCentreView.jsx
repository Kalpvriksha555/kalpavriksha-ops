import React, { useEffect, useState } from 'react';
import { BarChart3, Bell, Clock, Download, Star, User, Users } from 'lucide-react';
import { Badge, MiniEmptyState } from '../shared';
import { ONLINE_STALE_MS } from '../../config/appConfig';
import { absoluteApiUrl } from '../../services/fileService';
import { getStatusColor } from '../../services/taskService';
import { formatDateKey, formatDuration, formatLastSeenDateTime } from '../../utils/date';
import { getEstimateDetails, getLatestCompletedFileName, getTaskDescription } from '../../utils/taskDisplayUtils';
import { getTaskBusySince, getUserActiveTasks, getUserBusySince, getUserFreeSince, getUserLastCompletedAt } from '../../utils/presenceAttendanceUtils';

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
const isIncompleteProject = (project = {}) => project.status !== 'Completed';
const isCarriedForwardProject = (project = {}, dateKey = formatDateKey()) => isIncompleteProject(project) && getProjectDateKey(project) < dateKey;
const shouldShowOnOperationsDate = (project = {}, dateKey = formatDateKey()) => getProjectDateKey(project) === dateKey || (dateKey === formatDateKey() && isCarriedForwardProject(project, dateKey));

const getSlaInfo = (project = {}, now = Date.now()) => {
  const createdAt = project.createdAt || now;
  const assignedAt = project.assignedAt || project.assignedOn || (project.assignedTo && project.assignedTo !== 'Unassigned' ? createdAt : null);
  const draftStart = project.draftingStartedAt || (project.status === 'Drafting' ? assignedAt || createdAt : null);
  const submittedAt = project.submittedAt || project.draftingCompletedAt || null;
  const completedAt = project.completedAt || null;
  const totalEnd = completedAt || now;
  const draftingEnd = submittedAt || completedAt || now;
  const reviewStart = submittedAt || null;
  const reviewEnd = completedAt || now;
  const ageHours = Math.floor((totalEnd - createdAt) / 3600000);
  const isDelayed = project.status !== 'Completed' && ageHours >= 8;
  const isWarning = project.status !== 'Completed' && ageHours >= 4 && ageHours < 8;
  return {
    total: formatDuration(createdAt, totalEnd),
    drafting: draftStart ? formatDuration(draftStart, draftingEnd) : '-',
    review: reviewStart ? formatDuration(reviewStart, reviewEnd) : '-',
    ageHours,
    label: isDelayed ? 'Delayed' : isWarning ? 'Near SLA' : project.status === 'Completed' ? 'Completed' : 'On Track',
    colorClass: isDelayed ? 'bg-red-50 text-red-700 border-red-200' : isWarning ? 'bg-orange-50 text-orange-700 border-orange-200' : project.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-200'
  };
};

const getTodayMetrics = (projects = [], dateKey = formatDateKey()) => {
  const todays = projects.filter(p => getProjectDateKey(p) === dateKey);
  const carried = projects.filter(p => isCarriedForwardProject(p, dateKey));
  const activeToday = projects.filter(p => shouldShowOnOperationsDate(p, dateKey));
  const completedToday = projects.filter(p => p.status === 'Completed' && formatDateKey(p.completedAt || p.createdAt) === dateKey);
  const pendingCollections = projects.filter(p => (Number(p.estimate) || 0) > (Number(p.ledger?.amountIn) || 0));
  const paymentsToday = projects.filter(p => p.ledger?.updatedAt && formatDateKey(p.ledger.updatedAt) === dateKey);
  const revisions = activeToday.filter(p => (p.subTasks || []).some(st => st.status !== 'Done'));
  return {
    todays, carried, activeToday, completedToday, pendingCollections, paymentsToday, revisions,
    received: todays.length,
    carriedCount: carried.length,
    pending: activeToday.filter(p => p.status === 'Lead Received').length,
    drafting: activeToday.filter(p => p.status === 'Drafting').length,
    review: activeToday.filter(p => p.status === 'Internal Review').length,
    completed: completedToday.length,
    paymentReceived: paymentsToday.reduce((sum, p) => sum + (Number(p.ledger?.amountIn) || 0), 0),
    pendingAmount: pendingCollections.reduce((sum, p) => sum + Math.max(0, (Number(p.estimate) || 0) - (Number(p.ledger?.amountIn) || 0)), 0)
  };
};

export const CommandCentreView = ({ projects = [], users = [], onSelectProject, currentUser }) => {
  const [dateKey, setDateKey] = useState(formatDateKey());
  const [availabilityFilter, setAvailabilityFilter] = useState('Available');
  const [availabilityNow, setAvailabilityNow] = useState(Date.now());
  const [presenceTimes, setPresenceTimes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kalpa_presence_times') || '{}'); } catch (e) { return {}; }
  });
  useEffect(() => { const timer = setInterval(() => setAvailabilityNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const metrics = getTodayMetrics(projects, dateKey);
  const activeBoard = metrics.activeToday.slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
  const people = getOperationalUsers(users || [], { includeAdmins: true });
  const workingTeam = people.filter(u => u.role === ROLES.DESIGNER || u.role === ROLES.MANAGER);
  const activeTasksFor = (userName) => getUserActiveTasks(projects, userName);

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
  const availablePeople = people.filter(u => isUserActuallyOnline(u, nowMs) && (u.role === ROLES.ADMIN || (u.availability !== 'Break' && activeTasksFor(u.name).length === 0))); // admins shown available but no free-since
  const busyPeople = people.filter(u => u.role !== ROLES.ADMIN && isUserActuallyOnline(u, nowMs) && u.availability !== 'Break' && activeTasksFor(u.name).length > 0);
  const breakPeople = people.filter(u => u.role !== ROLES.ADMIN && isUserActuallyOnline(u, nowMs) && u.availability === 'Break');
  const offlinePeople = people.filter(u => !isUserActuallyOnline(u, nowMs));
  const free = availablePeople.length;
  const busy = busyPeople.length;
  const breaks = breakPeople.length;
  const availabilityGroups = { Available: availablePeople, Busy: busyPeople, Break: breakPeople, Offline: offlinePeople };
  const selectedAvailabilityPeople = availabilityGroups[availabilityFilter] || [];
  const completionRate = metrics.received ? Math.round((metrics.completed / metrics.received) * 100) : 0;
  const pendingNow = activeBoard.filter(p => p.status !== 'Completed').length;
  const delayedCount = activeBoard.filter(p => getSlaInfo(p).label === 'Delayed').length;
  const nearSlaCount = activeBoard.filter(p => getSlaInfo(p).label === 'Near SLA').length;
  const activeCapacity = workingTeam.reduce((sum, u) => sum + activeTasksFor(u.name).length, 0);
  const capacityLimit = workingTeam.reduce((sum, u) => sum + Number(u.dailyLimit || u.taskLimit || 10), 0) || Math.max(workingTeam.length * 10, 1);
  const capacityPct = Math.min(100, Math.round((activeCapacity / capacityLimit) * 100));
  const statusFlow = [
    ['Received', metrics.received, 'bg-blue-500'],
    ['Carried', metrics.carriedCount, 'bg-orange-500'],
    ['Drafting', metrics.drafting, 'bg-indigo-500'],
    ['Review', metrics.review, 'bg-purple-500'],
    ['Completed', metrics.completed, 'bg-emerald-500'],
    ['Revisions', metrics.revisions.length, 'bg-red-500']
  ];
  const maxFlow = Math.max(...statusFlow.map(([, value]) => Number(value) || 0), 1);
  const workloadCards = workingTeam.map(u => {
    const active = activeTasksFor(u.name);
    const completedToday = projects.filter(p => normalizePersonName(p.assignedTo) === normalizePersonName(u.name) && p.status === 'Completed' && formatDateKey(p.completedAt || p.createdAt) === dateKey).length;
    const revisions = projects.filter(p => normalizePersonName(p.assignedTo) === normalizePersonName(u.name) && (p.subTasks || []).some(st => st.status !== 'Done')).length;
    const limit = Number(u.dailyLimit || u.taskLimit || 10) || 10;
    const loadPct = Math.min(100, Math.round((active.length / limit) * 100));
    return { ...u, active, completedToday, revisions, limit, loadPct };
  }).sort((a,b) => b.active.length - a.active.length || b.completedToday - a.completedToday || a.name.localeCompare(b.name));
  const topPerformers = workloadCards.slice().sort((a,b) => b.completedToday - a.completedToday || a.active.length - b.active.length).slice(0, 4);
  const stats = [
    ['Cases Received', metrics.received, 'bg-blue-50 text-blue-700 border-blue-100'],
    ['Active Pending', pendingNow, 'bg-orange-50 text-orange-700 border-orange-100'],
    ['Completion Rate', `${completionRate}%`, 'bg-emerald-50 text-emerald-700 border-emerald-100'],
    ['Delayed SLA', delayedCount, 'bg-red-50 text-red-700 border-red-100'],
    ['Near SLA', nearSlaCount, 'bg-amber-50 text-amber-700 border-amber-100'],
    ['Urgent Revisions', metrics.revisions.length, 'bg-purple-50 text-purple-700 border-purple-100']
  ];
  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4">
        <div><h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Command Centre</h1><p className="text-slate-500 font-medium mt-2">Live operations snapshot with workload, SLA, productivity, and carried-forward work.</p></div>
        <input type="date" value={dateKey} onChange={e => setDateKey(e.target.value)} className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2.5 font-bold text-slate-700 outline-none" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">{stats.map(([label, value, cls]) => <div key={label} className={`kalpa-stat-card ${cls} border-2 rounded-3xl p-5 shadow-sm`}><p className="text-[10px] font-black uppercase tracking-widest opacity-80">{label}</p><p className="text-3xl font-black mt-2">{value}</p></div>)}</div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="kalpa-panel xl:col-span-2 bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div><h2 className="font-black text-slate-800 text-xl flex items-center"><BarChart3 className="w-5 h-5 mr-2 text-indigo-500" /> Operations Flow</h2><p className="text-xs font-bold text-slate-400 mt-1">Pending vs completed trend for the selected day.</p></div>
            <Badge colorClass={completionRate >= 70 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : completionRate >= 40 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-red-50 text-red-700 border-red-100'}>{completionRate}% Done</Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {statusFlow.map(([label, value, color]) => (
              <div key={label} className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                <div className="h-28 flex items-end justify-center">
                  <div className={`${color} rounded-t-xl w-full max-w-[42px] transition-all`} style={{ height: `${Math.max(8, (Number(value || 0) / maxFlow) * 100)}%` }}></div>
                </div>
                <p className="text-center text-2xl font-black text-slate-800 mt-3">{value}</p>
                <p className="text-center text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h3 className="font-black text-slate-800 mb-1">Active Workload</h3><p className="text-xs font-bold text-slate-400 mb-4">Current assigned load across managers/designers.</p>
          <div className="flex items-end justify-between mb-3"><p className="text-4xl font-black text-slate-800">{activeCapacity}</p><p className="text-xs font-black text-slate-400 uppercase tracking-widest">of {capacityLimit} capacity</p></div>
          <div className="h-4 bg-slate-100 rounded-full overflow-hidden mb-4"><div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${capacityPct}%` }}></div></div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3"><p className="font-black text-blue-700">{free}</p><p className="text-[9px] font-black uppercase text-blue-500">Available</p></div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3"><p className="font-black text-emerald-700">{busy}</p><p className="text-[9px] font-black uppercase text-emerald-500">Busy</p></div>
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3"><p className="font-black text-amber-700">{breaks}</p><p className="text-[9px] font-black uppercase text-amber-500">Break</p></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="kalpa-panel lg:col-span-2 bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
          <div className="p-5 border-b-2 border-slate-100"><h2 className="font-black text-slate-800 text-xl">Daily Operations Board</h2><p className="text-xs font-bold text-slate-400 mt-1">Includes today's tasks plus older pending tasks carried forward.</p></div>
          <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto custom-scrollbar">
            {activeBoard.map(p => <div key={p.id} onClick={() => onSelectProject(p)} className="kalpa-task-row p-5 hover:bg-slate-50 cursor-pointer flex justify-between items-center gap-4"><div><p className="font-black text-slate-800">{p.id} <span className="text-xs font-bold text-slate-400 ml-2">{getCustomerDisplayName(p)}</span></p><p className="text-sm font-extrabold text-slate-700 mt-1">{p.taskName || makeTaskDisplayName(p)}</p><p className="text-xs font-bold text-slate-500 mt-1">{p.type} • {p.location} • {p.assignedTo || 'Unassigned'}</p>{getTaskDescription(p) && <p className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 mt-2 line-clamp-2 max-w-2xl"><span className="font-black">Description:</span> {getTaskDescription(p)}</p>}{getEstimateDetails(p) && <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mt-1 line-clamp-2 max-w-2xl"><span className="font-black">Estimate:</span> {getEstimateDetails(p)}</p>}{getLatestCompletedFileName(p) && <p className="text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 mt-2 w-fit">Completed: {getLatestCompletedFileName(p)}</p>}{isCarriedForwardProject(p, dateKey) && <span className="inline-flex mt-2 text-[10px] bg-orange-50 text-orange-700 border border-orange-100 px-2 py-1 rounded-lg font-black uppercase">Carried Forward</span>}</div><Badge colorClass={getStatusColor(p.status)}>{p.status}</Badge></div>)}
            {activeBoard.length === 0 && <div className="p-10 text-center text-slate-400 font-bold">No operations for this date.</div>}
          </div>
        </div>
        <div className="space-y-6">
          <div className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
            <h3 className="font-black text-slate-800 mb-1">Team Availability</h3><p className="text-xs font-bold text-slate-400 mb-4">Click Available, Busy, Break, or Offline to see the members in that status.</p>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[["Available", free, "bg-blue-50 text-blue-700 border-blue-100"], ["Busy", busy, "bg-emerald-50 text-emerald-700 border-emerald-100"], ["Break", breaks, "bg-amber-50 text-amber-700 border-amber-100"], ["Offline", offlinePeople.length, "bg-slate-50 text-slate-600 border-slate-100"]].map(([label, count, cls]) => (
                <button key={label} type="button" onClick={() => setAvailabilityFilter(label)} className={`${cls} border-2 p-3 rounded-2xl text-center font-black transition-all ${availabilityFilter === label ? 'ring-2 ring-slate-300 scale-[1.02]' : 'hover:scale-[1.01]'}`}>
                  {count}<p className="text-[10px] uppercase tracking-widest">{label}</p>
                </button>
              ))}
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
              {selectedAvailabilityPeople.length === 0 && <MiniEmptyState>No team members in {availabilityFilter}.</MiniEmptyState>}
              {selectedAvailabilityPeople.map(member => {
                const tasks = activeTasksFor(member.name);
                const breakSince = member.breakStartedAt || member.availabilityUpdatedAt || Date.now();
                const freeSince = getUserFreeSince(projects, member.name, presenceTimes, member);
                const busySince = getUserBusySince(projects, member.name, presenceTimes);
                const busyTaskLine = tasks.length
                  ? tasks.slice().sort((a, b) => getTaskBusySince(b) - getTaskBusySince(a)).slice(0, 2).map(t => `${t.id} • ${formatDuration(getTaskBusySince(t), availabilityNow)}`).join(' | ')
                  : '';
                const isAdminMember = normalizeRole(member.role) === ROLES.ADMIN;
                const availabilityLine = availabilityFilter === 'Busy'
                  ? (busyTaskLine || (busySince ? `Busy since ${formatDuration(busySince, availabilityNow)}` : 'Busy now'))
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
                    <Badge colorClass={availabilityFilter === 'Busy' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : availabilityFilter === 'Break' ? 'bg-amber-50 text-amber-700 border-amber-100' : availabilityFilter === 'Available' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-slate-50 text-slate-600 border-slate-100'}>{availabilityFilter}</Badge>
                  </div>
                );
              })}
            </div>
          </div>
          {currentUser?.role === ROLES.ADMIN && <div className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><h3 className="font-black text-slate-800 mb-4">Payment Health</h3><p className="text-xs font-black text-slate-400 uppercase tracking-widest">Received Today</p><p className="text-3xl font-black text-emerald-600 mb-4">₹{metrics.paymentReceived.toLocaleString()}</p><p className="text-xs font-black text-slate-400 uppercase tracking-widest">Pending Collections</p><p className="text-3xl font-black text-red-500">₹{metrics.pendingAmount.toLocaleString()}</p></div>}
          <div className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><h3 className="font-black text-slate-800 mb-4">Urgent Revision Queue</h3>{metrics.revisions.slice(0,5).map(p => <button key={p.id} onClick={() => onSelectProject(p)} className="w-full text-left bg-red-50 border border-red-100 p-3 rounded-xl mb-2"><p className="font-black text-red-700 text-xs">{p.id}</p><p className="text-[10px] font-bold text-red-500">{p.subTasks?.length || 0} revision items</p></button>)}{metrics.revisions.length === 0 && <p className="text-sm text-slate-400 font-bold">No urgent revisions.</p>}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="kalpa-panel xl:col-span-2 bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4"><h3 className="font-black text-slate-800 flex items-center"><Users className="w-5 h-5 mr-2 text-indigo-500" /> Designer Performance Cards</h3><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Active workload</span></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto custom-scrollbar pr-1">
            {workloadCards.map(member => (
              <div key={member.id} className="border border-slate-100 bg-slate-50 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-3"><div><p className="font-black text-slate-800">{member.name}</p><p className="text-[11px] font-bold text-slate-400">{member.role} • {member.active.length}/{member.limit} active</p></div><Badge colorClass={member.loadPct >= 90 ? 'bg-red-50 text-red-700 border-red-100' : member.loadPct >= 60 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}>{member.loadPct}%</Badge></div>
                <div className="h-2 bg-white rounded-full overflow-hidden mb-3"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${member.loadPct}%` }}></div></div>
                <div className="grid grid-cols-3 gap-2 text-center"><div className="bg-white rounded-xl p-2"><p className="font-black text-slate-800">{member.active.length}</p><p className="text-[9px] font-black uppercase text-slate-400">Active</p></div><div className="bg-white rounded-xl p-2"><p className="font-black text-emerald-600">{member.completedToday}</p><p className="text-[9px] font-black uppercase text-slate-400">Done</p></div><div className="bg-white rounded-xl p-2"><p className="font-black text-red-500">{member.revisions}</p><p className="text-[9px] font-black uppercase text-slate-400">Revisions</p></div></div>
              </div>
            ))}
            {workloadCards.length === 0 && <p className="text-sm text-slate-400 font-bold text-center py-8">No designer or manager workload available.</p>}
          </div>
        </div>
        <div className="space-y-6">
          <div className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
            <h3 className="font-black text-slate-800 mb-4 flex items-center"><Star className="w-5 h-5 mr-2 text-amber-500" /> Top Today</h3>
            <div className="space-y-3">
              {topPerformers.map((member, idx) => <div key={member.id} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-2xl p-3"><div><p className="font-black text-slate-800 text-sm">{idx + 1}. {member.name}</p><p className="text-[11px] font-bold text-slate-400">{member.completedToday} completed • {member.active.length} active</p></div><Badge colorClass="bg-amber-50 text-amber-700 border-amber-100">{member.role}</Badge></div>)}
              {topPerformers.length === 0 && <p className="text-sm text-slate-400 font-bold">No completion data yet.</p>}
            </div>
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
        <h3 className="font-black text-slate-800 mb-4 flex items-center"><Bell className="w-5 h-5 mr-2 text-indigo-500" /> Latest Activity</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto custom-scrollbar">
          {projects.slice().sort((a,b) => (b.updatedAt || b.completedAt || b.submittedAt || b.createdAt || 0) - (a.updatedAt || a.completedAt || a.submittedAt || a.createdAt || 0)).slice(0,10).map(p => (
            <button key={p.id} type="button" onClick={() => onSelectProject(p)} className="w-full text-left bg-slate-50 hover:bg-indigo-50 border border-slate-100 rounded-2xl p-4 transition-all">
              <p className="font-black text-slate-800">{p.id} • {p.status}</p>
              <p className="text-xs font-bold text-slate-500 mt-1">{getCustomerDisplayName(p)} • {p.location} • {p.assignedTo || 'Unassigned'}</p>
            </button>
          ))}
          {projects.length === 0 && <p className="text-sm text-slate-400 font-bold text-center py-8">No recent activity yet.</p>}
        </div>
      </div>
    </div>
  );
};

export const ProductivityDashboard = ({ users = [], projects = [] }) => {
  const todayKey = formatDateKey();
  const weekStart = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const monthKey = todayKey.slice(0,7);
  const team = (users || []).filter(u => (u.role === ROLES.DESIGNER || u.role === ROLES.MANAGER) && u.status === 'APPROVED');
  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div><h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Productivity Dashboard</h1><p className="text-slate-500 font-medium mt-2">Designer and manager performance, visible to the whole team.</p></div>
      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-left text-sm whitespace-nowrap"><thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100"><tr><th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Member</th><th className="px-6 py-5 text-center font-bold uppercase tracking-wider text-xs">Today</th><th className="px-6 py-5 text-center font-bold uppercase tracking-wider text-xs">Week</th><th className="px-6 py-5 text-center font-bold uppercase tracking-wider text-xs">Month</th><th className="px-6 py-5 text-center font-bold uppercase tracking-wider text-xs">Active</th><th className="px-6 py-5 text-center font-bold uppercase tracking-wider text-xs">Avg SLA</th><th className="px-6 py-5 text-center font-bold uppercase tracking-wider text-xs">Revision %</th></tr></thead><tbody className="divide-y divide-slate-100">{team.map(u => { const userTasks = projects.filter(p => p.assignedTo === u.name); const completed = userTasks.filter(p => p.status === 'Completed'); const today = completed.filter(p => formatDateKey(p.completedAt || p.createdAt) === todayKey).length; const week = completed.filter(p => (p.completedAt || 0) >= weekStart).length; const month = completed.filter(p => formatDateKey(p.completedAt || p.createdAt).slice(0,7) === monthKey).length; const active = userTasks.filter(p => p.status !== 'Completed').length; const revs = userTasks.filter(p => (p.subTasks || []).length > 0).length; const revPct = userTasks.length ? Math.round((revs / userTasks.length) * 100) : 0; const avgMins = completed.length ? Math.round(completed.reduce((sum,p) => sum + Math.max(0, ((p.completedAt || p.submittedAt || p.createdAt || Date.now()) - (p.createdAt || Date.now()))/60000), 0) / completed.length) : 0; return <tr key={u.id} className="hover:bg-slate-50"><td className="px-6 py-5"><p className="font-black text-slate-800">{u.name}</p><p className="text-xs font-bold text-slate-400">{u.role}</p></td><td className="px-6 py-5 text-center font-black text-emerald-600">{today}</td><td className="px-6 py-5 text-center font-black text-indigo-600">{week}</td><td className="px-6 py-5 text-center font-black text-slate-800">{month}</td><td className="px-6 py-5 text-center"><span className="bg-orange-50 text-orange-700 px-3 py-1 rounded-lg font-black text-xs">{active}</span></td><td className="px-6 py-5 text-center font-bold text-slate-600">{avgMins ? formatDuration(0, avgMins * 60000) : '-'}</td><td className="px-6 py-5 text-center font-bold text-red-500">{revPct}%</td></tr> })}</tbody></table></div></div>
    </div>
  );
};

export const DailyClosingReport = ({ projects = [] }) => {
  const [dateKey, setDateKey] = useState(formatDateKey());
  const metrics = getTodayMetrics(projects, dateKey);
  const rows = [
    ['Cases Received', metrics.received], ['Carried Forward Pending', metrics.carriedCount], ['Cases Completed', metrics.completed], ['Urgent Revisions', metrics.revisions.length], ['Payments Received', `₹${metrics.paymentReceived.toLocaleString()}`], ['Pending Collections', `₹${metrics.pendingAmount.toLocaleString()}`]
  ];
  const handleExport = () => exportToCSV(['Metric','Value'], rows, `Daily_Closing_${dateKey}.csv`);
  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4"><div><h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Daily Closing Report</h1><p className="text-slate-500 font-medium mt-2">End-of-day summary with pending work carried forward.</p></div><div className="flex gap-3"><input type="date" value={dateKey} onChange={e => setDateKey(e.target.value)} className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2.5 font-bold text-slate-700 outline-none" /><button onClick={handleExport} className="bg-emerald-100 text-emerald-700 font-bold px-4 py-2.5 rounded-xl"><Download className="w-4 h-4 inline mr-2"/>Export</button></div></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">{rows.map(([label,value]) => <div key={label} className="kalpa-panel bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><p className="text-xs text-slate-400 font-black uppercase tracking-widest">{label}</p><p className="text-3xl font-black text-slate-800 mt-2">{value}</p></div>)}</div>
      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden"><div className="p-5 border-b-2 border-slate-100"><h2 className="font-black text-slate-800 text-xl">Pending Carry Forward List</h2></div><div className="divide-y divide-slate-100">{metrics.carried.map(p => <div key={p.id} className="p-5 flex justify-between items-center"><div><p className="font-black text-slate-800">{p.id}</p><p className="text-xs font-bold text-slate-400">{getCustomerDisplayName(p)} • {p.location} • {p.assignedTo}</p></div><Badge colorClass={getStatusColor(p.status)}>{p.status}</Badge></div>)}{metrics.carried.length === 0 && <div className="p-10 text-center text-slate-400 font-bold">No previous pending tasks to carry forward.</div>}</div></div>
    </div>
  );
};
