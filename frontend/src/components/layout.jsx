import React from 'react';
import { Bell, Briefcase, Check, CheckCircle, Flag, LayoutDashboard, LogOut, Search, User, Video, X } from 'lucide-react';

export const LocalModeBanner = ({ onClose }) => (
  <div className="bg-amber-100 border-b border-amber-200 text-amber-800 p-2.5 text-center text-xs font-bold flex flex-wrap justify-center items-center gap-2 shadow-sm z-50 relative">
    <span>⚠️ Local Mode: Data is saved locally. Cloud features disconnected.</span>
    <button type="button" onClick={onClose} className="sm:ml-2 p-1 hover:bg-amber-200 rounded-md transition-colors"><X className="w-4 h-4" /></button>
  </div>
);

export const DatabasePermissionBanner = () => (
  <div className="bg-red-600 border-b-4 border-red-800 text-white p-4 text-center text-sm shadow-xl z-50 relative">
    <p className="font-black text-lg mb-1">⚠️ FIREBASE DATABASE IS LOCKED ⚠️</p>
    <p className="font-medium max-w-4xl mx-auto">
      Your database is currently rejecting read/write access. To fix this:<br/>
      1. Go to Firebase Console &rarr; <b>Firestore Database</b> &rarr; <b>Rules</b> tab.<br/>
      2. Change <code className="bg-red-800/50 px-2 py-0.5 rounded mx-1">allow read, write: if false;</code> to <code className="bg-emerald-500 px-2 py-0.5 rounded font-mono mx-1 shadow-sm">allow read, write: if true;</code><br/>
      3. Click "Publish", wait 30 seconds, and refresh this page.
    </p>
  </div>
);

export const TopNavigation = ({
  currentUser,
  ROLES,
  darkMode,
  setDarkMode,
  globalSearch,
  setGlobalSearch,
  showNotifs,
  setShowNotifs,
  markNotifsAsRead,
  unreadNotifs,
  myNotifs,
  toggleBreak,
  setShowProfilePanel,
  handleLogout
}) => (
  <nav className="bg-white/95 backdrop-blur border-b-2 border-slate-100 sticky top-0 z-40 shadow-sm">
    <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8 flex justify-between h-16 sm:h-[72px]">
      <div className="flex items-center">
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center mr-2.5 sm:mr-4 shadow-md shrink-0 transition-transform duration-200 hover:scale-105">
          <LayoutDashboard className="text-white w-5 h-5" />
        </div>
        <span className="font-extrabold text-base sm:text-2xl text-slate-800 tracking-tight truncate max-w-[170px] sm:max-w-none">Kalpvriksha Designs <span className="text-indigo-600">Ops</span></span>
      </div>
      <div className="hidden lg:flex flex-1 max-w-xl mx-8">
        <div className="relative w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search cases, customer, bank, branch, location, designer..." className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl pl-12 pr-10 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-indigo-400 transition-all" />
          {globalSearch && <button type="button" onClick={() => setGlobalSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-4 lg:gap-6">
        <button type="button" onClick={() => setDarkMode(v => !v)} title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} className="p-2 sm:p-2.5 rounded-xl bg-slate-50 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-100 transition-all duration-200 active:scale-95">
          <span className="text-lg leading-none">{darkMode ? '☀️' : '🌙'}</span>
        </button>
        <div className="relative">
          <button type="button" onClick={() => { setShowNotifs(!showNotifs); if(!showNotifs) markNotifsAsRead(); }} className="p-2 sm:p-2.5 relative text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all duration-200 active:scale-95">
            <Bell className="w-6 h-6" />
            {unreadNotifs > 0 && <span className="absolute top-2 right-2 w-3 h-3 bg-red-500 rounded-full border-2 border-white shadow-sm animate-pulse"></span>}
          </button>
          {showNotifs && (
            <div className="absolute right-0 mt-3 w-80 bg-white rounded-3xl shadow-2xl border-2 border-slate-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-4">
              <div className="p-4 bg-slate-50 border-b border-slate-100">
                <div className="font-extrabold text-sm text-slate-800 uppercase tracking-widest flex justify-between items-center">
                  Notification Centre
                  {unreadNotifs === 0 && <Check className="w-4 h-4 text-emerald-500" />}
                </div>
                <div className="flex gap-2 mt-3 text-[10px] font-black uppercase tracking-widest">
                  <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700">Tasks</span>
                  <span className="px-2 py-1 rounded-lg bg-red-50 text-red-700">Urgent</span>
                  <span className="px-2 py-1 rounded-lg bg-purple-50 text-purple-700">Mentions</span>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {myNotifs.length === 0 && <p className="text-xs text-slate-400 font-bold text-center py-6">All caught up!</p>}
                {myNotifs.map(n => (
                  <div key={n.id} className={`p-3.5 rounded-2xl flex items-start transition-colors ${!(n.readBy||[]).includes(currentUser.name) ? 'bg-indigo-50/50 border border-indigo-100' : 'bg-white hover:bg-slate-50 border border-transparent'}`}>
                    {n.type === 'success' && <CheckCircle className="w-5 h-5 text-emerald-500 mr-3 mt-0.5 shrink-0"/>}
                    {n.type === 'mention' && <div className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs mr-3 mt-0.5 shrink-0">@</div>}
                    {n.type === 'urgent' && <Flag className="w-5 h-5 text-red-500 mr-3 mt-0.5 shrink-0"/>}
                    {n.type === 'info' && <Briefcase className="w-5 h-5 text-blue-500 mr-3 mt-0.5 shrink-0"/>}
                    <div>
                      <p className={`text-sm text-slate-800 ${!(n.readBy||[]).includes(currentUser.name) ? 'font-extrabold' : 'font-semibold'}`}>{n.title}</p>
                      <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">{n.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {currentUser.role !== ROLES.ADMIN && (
          <button type="button" onClick={toggleBreak} className={`px-3 py-2 rounded-xl text-xs font-black border transition-colors ${currentUser.availability === 'Break' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
            {currentUser.availability === 'Break' ? 'On Break' : 'Take Break'}
          </button>
        )}
        <button type="button" onClick={() => setShowProfilePanel(true)} className="hidden sm:flex items-center gap-3 border-l-2 border-slate-100 pl-6 hover:bg-slate-50 rounded-xl pr-3 py-1 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
            {currentUser.profilePhoto ? <img src={currentUser.profilePhoto} alt={currentUser.name} className="w-full h-full object-cover" /> : <User className="w-5 h-5 text-slate-400" />}
          </div>
          <div className="text-right">
            <p className="text-sm font-extrabold text-slate-800">{currentUser.name}</p>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{currentUser.role} • {currentUser.emailRegistered ? 'Email Registered' : (currentUser.mobileRegistered ? 'Mobile Registered' : 'Recovery Unregistered')}</p>
          </div>
        </button>
        <button type="button" onClick={handleLogout} className="p-2 sm:p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all duration-200 active:scale-95" title="Log out">
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </div>
  </nav>
);

export const MobileSearchBar = ({ globalSearch, setGlobalSearch }) => (
  <div className="lg:hidden mb-4 sm:mb-5 animate-in fade-in slide-in-from-top-2 duration-200">
    <div className="relative">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
      <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search cases..." className="w-full bg-white border-2 border-slate-100 rounded-2xl pl-12 pr-10 py-3 text-sm font-bold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 transition-all" />
      {globalSearch && <button type="button" onClick={() => setGlobalSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>}
    </div>
  </div>
);

export const MainTabNavigation = ({ currentUser, ROLES, activeTab, setActiveTab }) => (
  <div className="flex gap-2 mb-6 sm:mb-8 bg-white p-1.5 rounded-2xl shadow-sm border-2 border-slate-100 w-full sm:w-fit max-w-full overflow-x-auto sm:flex-wrap custom-scrollbar">
    <button type="button" onClick={() => setActiveTab('command')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 ${activeTab === 'command' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>Command Centre</button>
    {currentUser.role === ROLES.DESIGNER && (
      <button type="button" onClick={() => setActiveTab('my_tasks')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 flex items-center ${activeTab === 'my_tasks' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}><User className="w-4 h-4 mr-1.5" /> My Tasks</button>
    )}
    {currentUser.role !== ROLES.DESIGNER && <button type="button" onClick={() => setActiveTab('board')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 ${activeTab === 'board' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>Operations</button>}
    {currentUser.role === ROLES.MANAGER && (
      <button type="button" onClick={() => setActiveTab('my_tasks')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 flex items-center ${activeTab === 'my_tasks' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}><User className="w-4 h-4 mr-1.5" /> My Tasks</button>
    )}
    <button type="button" onClick={() => setActiveTab('productivity')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 ${activeTab === 'productivity' ? 'bg-emerald-100 text-emerald-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Performance</button>
    {currentUser.role === ROLES.ADMIN && <button type="button" onClick={() => setActiveTab('closing')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 ${activeTab === 'closing' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>Daily Closing</button>}
    {currentUser.role === ROLES.ADMIN && (
      <button type="button" onClick={() => setActiveTab('ledger')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 ${activeTab === 'ledger' ? 'bg-amber-100 text-amber-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Finance</button>
    )}
    <button type="button" onClick={() => setActiveTab('team')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 ${activeTab === 'team' ? 'bg-emerald-100 text-emerald-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Team</button>
    <button type="button" onClick={() => setActiveTab('attendance')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 ${activeTab === 'attendance' ? 'bg-indigo-100 text-indigo-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Attendance</button>
    <button type="button" onClick={() => setActiveTab('calculator')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 ${activeTab === 'calculator' ? 'bg-blue-100 text-blue-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Tools</button>
    <button type="button" onClick={() => setActiveTab('archive')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 ${activeTab === 'archive' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>Archive</button>
    <button type="button" onClick={() => setActiveTab('meeting')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 flex items-center ${activeTab === 'meeting' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}><Video className="w-4 h-4 mr-1.5" /> Team Meeting</button>
  </div>
);
