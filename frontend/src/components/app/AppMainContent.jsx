import React from 'react';
import { Search } from 'lucide-react';
import { EmptyState } from '../shared';
import { MobileSearchBar, MainTabNavigation } from '../layout';

/**
 * Main application tab router.
 *
 * This component intentionally stays presentation-only. It receives all feature
 * modules, handlers, state, and helpers from App.jsx so Phase 10 can reduce the
 * main file without changing business logic or data flow.
 */
export const AppMainContent = ({
  globalSearch,
  setGlobalSearch,
  selectedProject,
  displayedProjects,
  getCustomerDisplayName,
  getTaskDescription,
  getEstimateDetails,
  setSelectedProject,
  currentUser,
  ROLES,
  activeTab,
  setActiveTab,
  TaskDetailView,
  handleUpdateProject,
  activeUsers,
  handleDeleteTask,
  CommandCentreView,
  projects,
  ProductivityDashboard,
  DailyClosingReport,
  LedgerView,
  HistoryArchiveView,
  TeamPerformanceView,
  handleUpdateUser,
  AttendanceView,
  attendanceLogs,
  ProfileView,
  setCurrentUser,
  fileToBase64,
  sendRealOtp,
  verifyRealOtp,
  CalculatorView,
  TeamMeetingRoom,
  safeAppId,
  ActiveOperationsView,
  canManage,
  selectedBoardDate,
  setSelectedBoardDate,
  boardViewMode,
  setBoardViewMode,
  setLeadFiles,
  setShowNewLead,
  nowTick,
  getDraftElapsed,
  getOperationalUsers,
  isUserActuallyOnline
}) => (
  <main className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-8 animate-in fade-in duration-300">
    <MobileSearchBar globalSearch={globalSearch} setGlobalSearch={setGlobalSearch} />

    {globalSearch.trim() && !selectedProject && (
      <div className="bg-white border-2 border-indigo-100 rounded-3xl p-4 sm:p-5 mb-6 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="font-black text-slate-800">Search Results</h2>
            <p className="text-xs font-bold text-slate-400">Showing matching cases for: {globalSearch}</p>
          </div>
          <button type="button" onClick={() => setGlobalSearch('')} className="text-xs font-black bg-slate-100 text-slate-600 px-3 py-2 rounded-xl">Clear</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayedProjects.slice(0, 12).map(p => (
            <button key={p.id} type="button" onClick={() => setSelectedProject(p)} className="kalpa-task-row text-left bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-100 rounded-2xl p-4 transition-all">
              <p className="font-black text-slate-800">{p.id}</p>
              <p className="text-xs font-bold text-slate-500 mt-1">{getCustomerDisplayName(p)} • {p.location}</p>
              <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">{p.type} • {p.assignedTo || 'Unassigned'} • {p.status}</p>
              {getTaskDescription(p) && <p className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 mt-2 line-clamp-2"><span className="font-black">Description:</span> {getTaskDescription(p)}</p>}
              {getEstimateDetails(p) && <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mt-1 line-clamp-2"><span className="font-black">Estimate:</span> {getEstimateDetails(p)}</p>}
            </button>
          ))}
          {displayedProjects.length === 0 && <div className="col-span-full"><EmptyState icon={Search} title="No matching cases found" description="Try a customer name, bank, branch, location, task ID, or designer name." compact /></div>}
        </div>
      </div>
    )}

    {!selectedProject && (
      <MainTabNavigation currentUser={currentUser} ROLES={ROLES} activeTab={activeTab} setActiveTab={setActiveTab} />
    )}

    {selectedProject ? (
      <TaskDetailView project={selectedProject} user={currentUser} onBack={() => setSelectedProject(null)} onUpdateProject={handleUpdateProject} users={activeUsers} onDeleteTask={handleDeleteTask} />
    ) : activeTab === 'command' ? (
      <CommandCentreView projects={projects} users={activeUsers} currentUser={currentUser} onSelectProject={(p) => { setActiveTab('board'); setSelectedProject(p); }} />
    ) : activeTab === 'productivity' ? (
      <ProductivityDashboard users={activeUsers} projects={projects} />
    ) : activeTab === 'closing' && currentUser.role === ROLES.ADMIN ? (
      <DailyClosingReport projects={projects} />
    ) : activeTab === 'ledger' && currentUser.role === ROLES.ADMIN ? (
      <LedgerView projects={projects} onSelectProject={(p) => { setActiveTab('board'); setSelectedProject(p); }} />
    ) : activeTab === 'archive' ? (
      <HistoryArchiveView projects={projects} onSelectProject={(p) => { setActiveTab('board'); setSelectedProject(p); }} />
    ) : activeTab === 'team' ? (
      <TeamPerformanceView users={activeUsers} projects={projects} onUpdateUser={handleUpdateUser} currentUser={currentUser} />
    ) : activeTab === 'attendance' ? (
      <AttendanceView attendanceLogs={attendanceLogs} users={activeUsers} />
    ) : activeTab === 'profile' ? (
      <ProfileView currentUser={currentUser} onUpdateUser={handleUpdateUser} setCurrentUser={setCurrentUser} fileToBase64={fileToBase64} sendRealOtp={sendRealOtp} verifyRealOtp={verifyRealOtp} />
    ) : activeTab === 'calculator' ? (
      <CalculatorView />
    ) : activeTab === 'meeting' ? (
      <TeamMeetingRoom currentUser={currentUser} safeAppId={safeAppId} />
    ) : (
      <ActiveOperationsView
        activeTab={activeTab}
        canManage={canManage}
        selectedBoardDate={selectedBoardDate}
        setSelectedBoardDate={setSelectedBoardDate}
        boardViewMode={boardViewMode}
        setBoardViewMode={setBoardViewMode}
        setLeadFiles={setLeadFiles}
        setShowNewLead={setShowNewLead}
        displayedProjects={displayedProjects}
        projects={projects}
        activeUsers={activeUsers}
        setSelectedProject={setSelectedProject}
        nowTick={nowTick}
        ROLES={ROLES}
        getCustomerDisplayName={getCustomerDisplayName}
        getDraftElapsed={getDraftElapsed}
        getOperationalUsers={getOperationalUsers}
        isUserActuallyOnline={isUserActuallyOnline}
      />
    )}
  </main>
);

export default AppMainContent;
