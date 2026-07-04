import React from 'react';
import { Calendar, List, KanbanSquare, Plus, Flag, Users, Clock, MessageSquare } from 'lucide-react';
import { Badge } from '../shared';
import { formatDateTime, formatLastSeenDateTime, formatDuration, formatMinutes } from '../../utils/date';
import { getTaskDescription, getEstimateDetails, getLatestCompletedFileName } from '../../utils/taskDisplayUtils';
import { PAYMENT_TRACKING_OPTIONS, getPaymentTrackingStatus, getPaymentStatusBadgeClass } from '../../utils/paymentStatusUtils';
import { getTaskBusySince, getUserActiveTasks, getDraftingElapsedMs, getUserFreeSince } from '../../utils/presenceAttendanceUtils';
import { getStatusColor } from '../../services/taskService';

const isAdminUser = (user = {}) => String(user?.role || '').trim().toUpperCase() === 'ADMIN';
const getDisplayTaskId = (project = {}) => project.displayId || project.originalTaskId || project.id;
const isRevisionWorkItem = (project = {}) => project.isRevisionWorkItem === true || String(project.id || '').includes('__REV__');

const CompactTextPill = ({ label, value, tone = 'indigo' }) => {
  if (!value) return null;
  const toneClass = tone === 'amber'
    ? 'text-amber-700 bg-amber-50 border-amber-100'
    : 'text-indigo-700 bg-indigo-50 border-indigo-100';
  return (
    <p className={`kalpa-ops-line-summary ${toneClass}`} title={value}>
      <span className="font-black">{label}:</span> {value}
    </p>
  );
};

const PaymentStatusControl = ({ project, currentUser, onPaymentStatusChange, compact = false }) => {
  if (!isAdminUser(currentUser)) return null;
  const status = getPaymentTrackingStatus(project);
  const handleChange = (event) => {
    event.stopPropagation();
    if (typeof onPaymentStatusChange === 'function') onPaymentStatusChange(project, event.target.value);
  };
  return (
    <label className={`kalpa-payment-control ${getPaymentStatusBadgeClass(status)}`} title={`Payment status: ${status}`} onClick={(event) => event.stopPropagation()}>
      <span className="kalpa-payment-dot" aria-hidden="true" />
      <select
        value={status}
        onClick={(event) => event.stopPropagation()}
        onChange={handleChange}
        className="kalpa-payment-select"
        aria-label={`Payment status for ${getDisplayTaskId(project)}`}
      >
        {PAYMENT_TRACKING_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
};

const OperationKanbanCard = ({ project, onSelectProject, getCustomerDisplayName, onDiscussTask, currentUser, onPaymentStatusChange }) => (
  <div onClick={() => onSelectProject(project)} className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-300 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group active:scale-[0.99]">
    <div className="flex justify-between items-start mb-2">
      <p className="font-extrabold text-slate-800 group-hover:text-indigo-600 transition-colors">{getDisplayTaskId(project)} {isRevisionWorkItem(project) && <span className="ml-2 bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded-lg text-[10px] font-black">{project.revisionCode || 'REV'}</span>}</p>
      {project.priority === 'Urgent' && <Flag className="w-4 h-4 text-red-500 animate-pulse" />}
    </div>
    <p className="text-sm font-bold text-slate-700 mb-1">{getCustomerDisplayName(project)}</p>
    <p className="text-xs text-slate-500 mb-3">{project.type} • {project.location}</p>
    <CompactTextPill label="Description" value={getTaskDescription(project)} />
    <CompactTextPill label="Estimate" value={getEstimateDetails(project)} tone="amber" />
    <PaymentStatusControl project={project} currentUser={currentUser} onPaymentStatusChange={onPaymentStatusChange} compact />
    {getLatestCompletedFileName(project) && (
      <p className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 mb-3 truncate">Completed: {getLatestCompletedFileName(project)}</p>
    )}
    <div className="flex justify-between items-center gap-2 pt-3 border-t border-slate-100">
      <Badge colorClass={project.assignedTo === 'Unassigned' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-700 border-slate-200'}>{project.assignedTo}</Badge>
      <div className="flex items-center gap-2">
        {project.subTasks?.length > 0 && <span className="text-[10px] text-red-600 bg-red-50 px-2 py-0.5 rounded font-black">{project.subTasks.length} Revs</span>}
        <button type="button" onClick={(e) => { e.stopPropagation(); if (typeof onDiscussTask === 'function') onDiscussTask(project); }} className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-lg hover:bg-indigo-100 flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Chat</button>
      </div>
    </div>
  </div>
);

const OperationsKanban = ({ projects, onSelectProject, getCustomerDisplayName, onDiscussTask, currentUser, onPaymentStatusChange }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6">
    {['Lead Received', 'Drafting', 'Drafting Paused', 'Completed'].map(statusCol => (
      <div key={statusCol} className="bg-slate-100/50 rounded-3xl p-3 sm:p-4 border-2 border-slate-100/50 min-h-[420px] sm:min-h-[500px] transition-colors duration-200">
        <h3 className="font-black text-slate-500 uppercase tracking-widest text-xs mb-4 px-2">{statusCol} <span className="ml-2 bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{projects.filter(p => p.status === statusCol).length}</span></h3>
        <div className="space-y-4">
          {projects.filter(p => p.status === statusCol).map(project => (
            <OperationKanbanCard key={project.id} project={project} onSelectProject={onSelectProject} getCustomerDisplayName={getCustomerDisplayName} onDiscussTask={onDiscussTask} currentUser={currentUser} onPaymentStatusChange={onPaymentStatusChange} />
          ))}
        </div>
      </div>
    ))}
  </div>
);

const OperationGridRow = ({ project, onSelectProject, getCustomerDisplayName, getDraftElapsed, nowTick, onDiscussTask, currentUser, onPaymentStatusChange }) => {
  const assigned = project.assignedTo || 'Unassigned';
  const elapsed = project.draftingStartedAt ? getDraftElapsed(project, nowTick) : '-';
  return (
    <div role="button" tabIndex={0} onClick={() => onSelectProject(project)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectProject(project); }} className="kalpa-ops-grid-row text-left group cursor-pointer">
      <div className="kalpa-ops-cell kalpa-ops-task-cell">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-extrabold text-slate-800 text-base truncate" title={getDisplayTaskId(project)}>{getDisplayTaskId(project)}</p>
          {project.priority === 'Urgent' && <Flag className="w-4 h-4 text-red-500 animate-pulse flex-shrink-0" />}
          {isRevisionWorkItem(project) && <span className="bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded-lg text-[10px] font-black whitespace-nowrap">{project.revisionCode || 'REVISION'}</span>}
        </div>
        <p className="text-slate-500 font-semibold text-xs mt-1 truncate">{getCustomerDisplayName(project)}</p>
        <p className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded mt-1.5 w-fit font-bold">Created: {project.createdAt ? formatDateTime(project.createdAt) : '-'}</p>
        {getLatestCompletedFileName(project) && <p className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded mt-1.5 max-w-full truncate font-black" title={getLatestCompletedFileName(project)}>Completed: {getLatestCompletedFileName(project)}</p>}
      </div>

      <div className="kalpa-ops-cell kalpa-ops-type-cell">
        <p className="font-bold text-slate-700 truncate" title={project.type}>{project.type}</p>
        <p className="text-slate-400 font-medium text-xs mt-1 truncate" title={project.location}>{project.location}</p>
        <CompactTextPill label="Estimate" value={getEstimateDetails(project)} tone="amber" />
      </div>

      <div className="kalpa-ops-cell kalpa-ops-assigned-cell">
        <span className="kalpa-mobile-label">Assigned</span>
        <Badge colorClass={assigned === 'Unassigned' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-700 border-slate-200'}>{assigned}</Badge>
      </div>

      <div className="kalpa-ops-cell kalpa-ops-elapsed-cell">
        <span className="kalpa-mobile-label">Elapsed</span>
        <span className="text-sm font-black text-slate-700 whitespace-nowrap">{elapsed}</span>
      </div>

      {isAdminUser(currentUser) && (
        <div className="kalpa-ops-cell kalpa-ops-payment-cell">
          <span className="kalpa-mobile-label">Payment</span>
          <PaymentStatusControl project={project} currentUser={currentUser} onPaymentStatusChange={onPaymentStatusChange} compact />
        </div>
      )}

      <div className="kalpa-ops-cell kalpa-ops-status-cell">
        <span className="kalpa-mobile-label">Status</span>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <Badge colorClass={`border-transparent ${getStatusColor(project.status)}`}>{project.status}</Badge>
          <button type="button" onClick={(e) => { e.stopPropagation(); if (typeof onDiscussTask === 'function') onDiscussTask(project); }} className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-lg hover:bg-indigo-100 flex items-center gap-1 w-fit"><MessageSquare className="w-3 h-3" /> Chat</button>
        </div>
      </div>
    </div>
  );
};

const OperationsTable = ({ projects, onSelectProject, getCustomerDisplayName, getDraftElapsed, nowTick, onDiscussTask, currentUser, onPaymentStatusChange }) => {
  const showPaymentColumn = isAdminUser(currentUser);
  return (
  <div className={`kalpa-ops-list ${showPaymentColumn ? 'kalpa-ops-list-has-payment' : ''} bg-white rounded-3xl shadow-sm border-2 border-slate-100 overflow-hidden transition-shadow duration-200 hover:shadow-md`}>
    <div className="kalpa-ops-grid-header bg-slate-50 text-slate-500 border-b-2 border-slate-100">
      <div>Task ID</div>
      <div>Type & Location</div>
      <div>Assigned</div>
      <div>Elapsed</div>
      {showPaymentColumn && <div>Payment</div>}
      <div>Status</div>
    </div>
    <div className="divide-y divide-slate-100">
      {projects.map(project => (
        <OperationGridRow key={project.id} project={project} onSelectProject={onSelectProject} getCustomerDisplayName={getCustomerDisplayName} getDraftElapsed={getDraftElapsed} nowTick={nowTick} onDiscussTask={onDiscussTask} currentUser={currentUser} onPaymentStatusChange={onPaymentStatusChange} />
      ))}
      {projects.length === 0 && (
        <div className="px-6 py-16 text-center text-slate-400 font-bold">No active projects found for this date.</div>
      )}
    </div>
  </div>
  );
};

const TeamActivityPanel = ({ users, projects, nowTick, ROLES, onSelectProject, getOperationalUsers, isUserActuallyOnline }) => (
  <div className="lg:col-span-1 space-y-6">
    <h3 className="text-xl font-extrabold text-slate-800 flex items-center tracking-tight"><Users className="w-6 h-6 mr-3 text-indigo-500" /> Team Activity</h3>
    <div className="bg-white rounded-3xl p-6 shadow-sm border-2 border-slate-100 space-y-5">
      {getOperationalUsers(users, { includeAdmins: false }).filter(u => u.role === ROLES.DESIGNER || u.role === ROLES.MANAGER).map(designer => {
        const designerOnline = isUserActuallyOnline(designer, nowTick);
        const activeTasks = designerOnline ? getUserActiveTasks(projects, designer.name) : [];
        const pausedTasks = projects.filter(p => p.assignedTo === designer.name && p.status === 'Drafting Paused');
        const todayStart = new Date().setHours(0,0,0,0);
        const submittedToday = projects.filter(p => {
          if (p.assignedTo !== designer.name) return false;
          if (p.completedAt && p.completedAt >= todayStart) return true;
          if (p.submittedAt && p.submittedAt >= todayStart) return true;
          return false;
        }).length;

        let idleStatus = designerOnline ? 'Available' : `Unavailable${designer.lastSeenAt || designer.lastLogoutAt || designer.lastHeartbeatAt ? ` - Last seen ${formatLastSeenDateTime(designer.lastSeenAt || designer.lastLogoutAt || designer.lastHeartbeatAt)}` : ''}`;
        if (designerOnline && designer.availability === 'Break') {
          idleStatus = `On break${designer.breakStartedAt ? ` for ${formatDuration(designer.breakStartedAt, nowTick)}` : ''}`;
        } else if (designerOnline && activeTasks.length === 0) {
          const freeSince = getUserFreeSince(projects, designer.name, {}, designer);
          idleStatus = freeSince ? `Free since ${formatDuration(freeSince, nowTick)}` : 'Available';
        }

        return (
          <div key={designer.id} className="border-b-2 border-slate-50 pb-5 last:border-0 last:pb-0">
            <div className="flex justify-between items-start mb-3">
              <p className="font-extrabold text-slate-800 text-base flex items-center">
                {!designerOnline ? (
                  <span title="Unavailable" className="w-2.5 h-2.5 rounded-full mr-3 shadow-sm bg-slate-300"></span>
                ) : designer.availability === 'Break' ? (
                  <span title="On Break" className="w-2.5 h-2.5 rounded-full mr-3 shadow-sm bg-amber-500 animate-pulse"></span>
                ) : activeTasks.length > 0 ? (
                  <span title="Drafting" className="w-2.5 h-2.5 rounded-full mr-3 shadow-sm bg-emerald-500 animate-pulse"></span>
                ) : (
                  <span title="Available" className="w-2.5 h-2.5 rounded-full mr-3 shadow-sm bg-blue-500"></span>
                )}
                {designer.name}
              </p>
              <span className="text-[10px] bg-indigo-50 border border-indigo-100 text-indigo-700 px-2.5 py-1 rounded-lg font-black uppercase tracking-wider">{submittedToday} done today</span>
            </div>
            {designerOnline && designer.availability !== 'Break' && activeTasks.length > 0 ? (
              <div className="ml-5 space-y-2">
                {activeTasks.map(activeTask => {
                  const pendingRevs = (activeTask.subTasks || []).filter(st => st.status === 'Pending').length;
                  const totalRevs = (activeTask.subTasks || []).length;
                  return (
                    <div key={activeTask.id} className="text-xs font-bold bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex justify-between items-center group cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => onSelectProject(activeTask)}>
                      <span className="text-slate-700 truncate mr-2">{getDisplayTaskId(activeTask)}{isRevisionWorkItem(activeTask) ? ` ${activeTask.revisionCode || 'REV'}` : ''}<span className="block text-[10px] text-slate-400 font-black mt-0.5">Drafting since {formatDuration(getTaskBusySince(activeTask), nowTick)}</span></span>
                      {totalRevs > 0 && <span className="text-[10px] text-red-600 font-black bg-red-50 border border-red-100 px-2 py-0.5 rounded-md whitespace-nowrap uppercase tracking-wider">{pendingRevs} pending</span>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 font-semibold ml-5 italic flex items-center"><Clock className="w-3 h-3 mr-1.5" />{idleStatus}</p>
            )}
            {pausedTasks.length > 0 && (
              <div className="ml-5 mt-3 space-y-2">
                {pausedTasks.map(task => (
                  <button key={task.id} type="button" onClick={() => onSelectProject(task)} className="w-full text-left bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 hover:bg-amber-100 transition">
                    <span className="block text-xs font-black text-amber-800">{task.id}</span>
                    <span className="block text-[10px] font-bold text-amber-600">Drafting paused at {formatMinutes(Math.floor(getDraftingElapsedMs(task, nowTick) / 60000))}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

export const ActiveOperationsView = ({
  activeTab,
  canManage,
  selectedBoardDate,
  setSelectedBoardDate,
  boardViewMode,
  setBoardViewMode,
  setLeadFiles,
  setShowNewLead,
  displayedProjects,
  projects,
  activeUsers,
  setSelectedProject,
  nowTick,
  ROLES,
  getCustomerDisplayName,
  getDraftElapsed,
  getOperationalUsers,
  isUserActuallyOnline,
  onDiscussTask,
  currentUser,
  onPaymentStatusChange,
}) => (
  <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">{activeTab === 'my_tasks' ? 'My Tasks' : (canManage ? 'Active Operations' : 'My Workspace')}</h1>
      </div>
      <div className="flex flex-wrap gap-3">
        {(activeTab === 'board' || activeTab === 'my_tasks') && (
          <div className="bg-white border-2 border-slate-100 rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-sm">
            <Calendar className="w-4 h-4 text-indigo-500" />
            <input type="date" value={selectedBoardDate} onChange={(e) => setSelectedBoardDate(e.target.value)} className="text-xs font-bold text-slate-700 bg-transparent outline-none" />
          </div>
        )}
        {(activeTab === 'board' || activeTab === 'my_tasks') && (
          <div className="bg-slate-100 p-1 rounded-xl flex items-center shadow-inner">
            <button onClick={() => setBoardViewMode('list')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center ${boardViewMode === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><List className="w-4 h-4 mr-1.5" /> List</button>
            <button onClick={() => setBoardViewMode('kanban')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center ${boardViewMode === 'kanban' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><KanbanSquare className="w-4 h-4 mr-1.5" /> Board</button>
          </div>
        )}
        {canManage && (
          <button type="button" onClick={() => { setLeadFiles([]); setShowNewLead(true); }} className="bg-slate-800 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-700 transition-all shadow-xl shadow-slate-200 flex items-center w-full sm:w-auto justify-center hover:scale-105 transform">
            <Plus className="w-5 h-5 mr-2" /> Log New Case
          </button>
        )}
      </div>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5 sm:gap-8">
      <div className="w-full min-w-0">
        {boardViewMode === 'kanban' ? (
          <OperationsKanban projects={displayedProjects} onSelectProject={setSelectedProject} getCustomerDisplayName={getCustomerDisplayName} onDiscussTask={onDiscussTask} currentUser={currentUser} onPaymentStatusChange={onPaymentStatusChange} />
        ) : (
          <OperationsTable projects={displayedProjects} onSelectProject={setSelectedProject} getCustomerDisplayName={getCustomerDisplayName} getDraftElapsed={getDraftElapsed} nowTick={nowTick} onDiscussTask={onDiscussTask} currentUser={currentUser} onPaymentStatusChange={onPaymentStatusChange} />
        )}
      </div>

      <TeamActivityPanel users={activeUsers} projects={projects} nowTick={nowTick} ROLES={ROLES} onSelectProject={setSelectedProject} getOperationalUsers={getOperationalUsers} isUserActuallyOnline={isUserActuallyOnline} />
    </div>
  </div>
);

export default ActiveOperationsView;
