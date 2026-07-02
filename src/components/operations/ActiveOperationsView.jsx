import React from 'react';
import { Calendar, List, KanbanSquare, Plus, Flag, Users, Clock } from 'lucide-react';
import { Badge } from '../shared';
import { formatDateTime, formatLastSeenDateTime, formatDuration, formatMinutes } from '../../utils/date';
import { getTaskDescription, getEstimateDetails, getLatestCompletedFileName } from '../../utils/taskDisplayUtils';
import { getTaskBusySince, getUserActiveTasks, getDraftingElapsedMs } from '../../utils/presenceAttendanceUtils';
import { getStatusColor } from '../../services/taskService';

const OperationKanbanCard = ({ project, onSelectProject, getCustomerDisplayName }) => (
  <div onClick={() => onSelectProject(project)} className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-300 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group active:scale-[0.99]">
    <div className="flex justify-between items-start mb-2">
      <p className="font-extrabold text-slate-800 group-hover:text-indigo-600 transition-colors">{project.id}</p>
      {project.priority === 'Urgent' && <Flag className="w-4 h-4 text-red-500 animate-pulse" />}
    </div>
    <p className="text-sm font-bold text-slate-700 mb-1">{getCustomerDisplayName(project)}</p>
    <p className="text-xs text-slate-500 mb-3">{project.type} • {project.location}</p>
    {getTaskDescription(project) && (
      <p className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 mb-2 line-clamp-2"><span className="font-black">Description:</span> {getTaskDescription(project)}</p>
    )}
    {getEstimateDetails(project) && (
      <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mb-3 line-clamp-2"><span className="font-black">Estimate:</span> {getEstimateDetails(project)}</p>
    )}
    {getLatestCompletedFileName(project) && (
      <p className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 mb-3 truncate">Completed: {getLatestCompletedFileName(project)}</p>
    )}
    <div className="flex justify-between items-center pt-3 border-t border-slate-100">
      <Badge colorClass={project.assignedTo === 'Unassigned' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-700 border-slate-200'}>{project.assignedTo}</Badge>
      {project.subTasks?.length > 0 && <span className="text-[10px] text-red-600 bg-red-50 px-2 py-0.5 rounded font-black">{project.subTasks.length} Revs</span>}
    </div>
  </div>
);

const OperationsKanban = ({ projects, onSelectProject, getCustomerDisplayName }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6">
    {['Lead Received', 'Drafting', 'Drafting Paused', 'Completed'].map(statusCol => (
      <div key={statusCol} className="bg-slate-100/50 rounded-3xl p-3 sm:p-4 border-2 border-slate-100/50 min-h-[420px] sm:min-h-[500px] transition-colors duration-200">
        <h3 className="font-black text-slate-500 uppercase tracking-widest text-xs mb-4 px-2">{statusCol} <span className="ml-2 bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{projects.filter(p => p.status === statusCol).length}</span></h3>
        <div className="space-y-4">
          {projects.filter(p => p.status === statusCol).map(project => (
            <OperationKanbanCard key={project.id} project={project} onSelectProject={onSelectProject} getCustomerDisplayName={getCustomerDisplayName} />
          ))}
        </div>
      </div>
    ))}
  </div>
);

const OperationTableRow = ({ project, onSelectProject, getCustomerDisplayName, getDraftElapsed, nowTick }) => (
  <tr onClick={() => onSelectProject(project)} className="hover:bg-slate-50 cursor-pointer transition-colors group">
    <td className="px-6 py-5">
      <div className="flex items-center gap-2">
        <p className="font-extrabold text-slate-800 text-base">{project.id}</p>
        {project.priority === 'Urgent' && <Flag className="w-4 h-4 text-red-500 animate-pulse" />}
      </div>
      <p className="text-slate-500 font-semibold text-xs mt-1">{getCustomerDisplayName(project)}</p>
      <p className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded mt-1.5 w-fit font-bold">Created: {project.createdAt ? formatDateTime(project.createdAt) : '-'}</p>
      {getLatestCompletedFileName(project) && <p className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded mt-1.5 w-fit font-black">Completed: {getLatestCompletedFileName(project)}</p>}
    </td>
    <td className="px-6 py-5">
      <p className="font-bold text-slate-700">{project.type}</p>
      <p className="text-slate-400 font-medium text-xs mt-1">{project.location}</p>
      {getTaskDescription(project) && <p className="text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 font-semibold text-xs mt-2 max-w-xs whitespace-normal line-clamp-2"><span className="font-black">Description:</span> {getTaskDescription(project)}</p>}
      {getEstimateDetails(project) && <p className="text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 font-semibold text-xs mt-1 max-w-xs whitespace-normal line-clamp-2"><span className="font-black">Estimate:</span> {getEstimateDetails(project)}</p>}
    </td>
    <td className="px-6 py-5">
      <Badge colorClass={project.assignedTo === 'Unassigned' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-700 border-slate-200'}>{project.assignedTo}</Badge>
    </td>
    <td className="px-6 py-5 font-bold text-slate-600">{project.draftingStartedAt ? getDraftElapsed(project, nowTick) : '-'}</td>
    <td className="px-6 py-5">
      <Badge colorClass={`border-transparent ${getStatusColor(project.status)}`}>{project.status}</Badge>
    </td>
  </tr>
);

const OperationsTable = ({ projects, onSelectProject, getCustomerDisplayName, getDraftElapsed, nowTick }) => (
  <div className="bg-white rounded-3xl shadow-sm border-2 border-slate-100 overflow-hidden transition-shadow duration-200 hover:shadow-md">
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
          <tr>
            <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Task ID</th>
            <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Type & Location</th>
            <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Assigned To</th>
            <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Elapsed</th>
            <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {projects.map(project => (
            <OperationTableRow key={project.id} project={project} onSelectProject={onSelectProject} getCustomerDisplayName={getCustomerDisplayName} getDraftElapsed={getDraftElapsed} nowTick={nowTick} />
          ))}
          {projects.length === 0 && (
            <tr><td colSpan={5} className="px-6 py-16 text-center text-slate-400 font-bold">No active projects found for this date.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

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
          const recentlyCompleted = projects.filter(p => p.assignedTo === designer.name && (p.completedAt || p.submittedAt)).sort((a,b) => ((b.completedAt||b.submittedAt)||0) - ((a.completedAt||a.submittedAt)||0))[0];
          if (recentlyCompleted) idleStatus = `Free since ${formatDuration((recentlyCompleted.completedAt||recentlyCompleted.submittedAt), nowTick)}`;
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
                      <span className="text-slate-700 truncate mr-2">{activeTask.id}<span className="block text-[10px] text-slate-400 font-black mt-0.5">Drafting since {formatDuration(getTaskBusySince(activeTask), nowTick)}</span></span>
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

    <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 sm:gap-8">
      <div className="lg:col-span-3 w-full">
        {boardViewMode === 'kanban' ? (
          <OperationsKanban projects={displayedProjects} onSelectProject={setSelectedProject} getCustomerDisplayName={getCustomerDisplayName} />
        ) : (
          <OperationsTable projects={displayedProjects} onSelectProject={setSelectedProject} getCustomerDisplayName={getCustomerDisplayName} getDraftElapsed={getDraftElapsed} nowTick={nowTick} />
        )}
      </div>

      <TeamActivityPanel users={activeUsers} projects={projects} nowTick={nowTick} ROLES={ROLES} onSelectProject={setSelectedProject} getOperationalUsers={getOperationalUsers} isUserActuallyOnline={isUserActuallyOnline} />
    </div>
  </div>
);

export default ActiveOperationsView;
