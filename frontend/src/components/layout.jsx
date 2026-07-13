import React from 'react';
import { AlertCircle, Archive, BarChart3, Bell, Briefcase, Calculator, Calendar, CheckCircle, ClipboardList, Flag, LayoutDashboard, LogOut, MessageSquare, MoreHorizontal, Search, Settings, User, Users, Video, X } from 'lucide-react';
import { getProfilePhotoVersion, profilePhotoUrl } from '../utils/profileUtils';
import { isNotificationReadByUser } from '../services/notificationService';

export const LocalModeBanner = ({ onClose }) => (
  <div className="bg-amber-100 border-b border-amber-200 text-amber-800 p-2.5 text-center text-xs font-bold flex flex-wrap justify-center items-center gap-2 shadow-sm z-50 relative">
    <span>Live database unavailable - using the bundled offline snapshot. Changes may not sync until reconnection.</span>
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

const getNotificationIcon = (notification = {}) => {
  const category = notification.category || '';
  const type = notification.type || '';
  if (notification.priority === 'Critical' || type === 'urgent') return <AlertCircle className="w-5 h-5 text-red-500 mr-3 mt-0.5 shrink-0" />;
  if (category === 'Chat' || type === 'mention') return <MessageSquare className="w-5 h-5 text-purple-500 mr-3 mt-0.5 shrink-0" />;
  if (category === 'Meeting') return <Video className="w-5 h-5 text-indigo-500 mr-3 mt-0.5 shrink-0" />;
  if (category === 'Attendance') return <Calendar className="w-5 h-5 text-emerald-500 mr-3 mt-0.5 shrink-0" />;
  if (type === 'success') return <CheckCircle className="w-5 h-5 text-emerald-500 mr-3 mt-0.5 shrink-0" />;
  if (type === 'urgent') return <Flag className="w-5 h-5 text-red-500 mr-3 mt-0.5 shrink-0" />;
  return <Briefcase className="w-5 h-5 text-blue-500 mr-3 mt-0.5 shrink-0" />;
};

const priorityClass = (priority = '') => {
  if (priority === 'Critical') return 'bg-red-100 text-red-700';
  if (priority === 'High') return 'bg-amber-100 text-amber-700';
  if (priority === 'Normal') return 'bg-blue-100 text-blue-700';
  return 'bg-slate-100 text-slate-500';
};

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
  markNotificationRead,
  requestDesktopNotifications,
  unreadNotifs,
  myNotifs,
  filteredNotifs,
  notificationCounts,
  NOTIFICATION_CATEGORIES,
  notifSearch,
  setNotifSearch,
  notifFilter,
  setNotifFilter,
  desktopNotificationsEnabled,
  activityTimeline,
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
          <button type="button" onClick={() => setShowNotifs(!showNotifs)} className="p-2 sm:p-2.5 relative text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all duration-200 active:scale-95 overflow-visible" title={unreadNotifs > 0 ? `${unreadNotifs} unread notification${unreadNotifs > 1 ? 's' : ''}` : 'Notifications'}>
            <Bell className="w-6 h-6" />
            {unreadNotifs > 0 && <span
              className="absolute bg-red-500 text-white font-black rounded-full border-2 border-white shadow-md animate-pulse flex items-center justify-center kalpa-notification-badge"
              style={{ top: '-8px', right: '-10px', minWidth: unreadNotifs > 99 ? 34 : unreadNotifs > 9 ? 28 : 22, height: 22, padding: '0 6px', fontSize: 11, lineHeight: '18px', zIndex: 3 }}
            >{unreadNotifs > 99 ? '99+' : unreadNotifs}</span>}
          </button>
          {showNotifs && (
            <div className="absolute right-0 mt-3 w-[420px] max-w-[calc(100vw-2rem)] bg-white rounded-3xl shadow-2xl border-2 border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-4 kalpa-notification-panel"
            style={{ zIndex: 2147482000 }}>
              <div className="p-4 bg-slate-50 border-b border-slate-100">
                <div className="font-extrabold text-sm text-slate-800 uppercase tracking-widest flex justify-between items-center gap-3">
                  <span>Notification Centre</span>
                  <div className="flex items-center gap-2">
                    {unreadNotifs > 0 && <button type="button" onClick={markNotifsAsRead} className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 bg-white border border-indigo-100 px-2 py-1 rounded-lg">Mark all read</button>}
                    <button type="button" onClick={() => setShowNotifs(false)} className="text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="mt-3 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input value={notifSearch} onChange={e => setNotifSearch(e.target.value)} placeholder="Search notifications..." className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:border-indigo-400" />
                </div>
                <div className="flex gap-2 mt-3 overflow-x-auto pb-1 custom-scrollbar">
                  {(NOTIFICATION_CATEGORIES || ['All']).map(label => (
                    <button key={label} type="button" onClick={() => setNotifFilter(label)} className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border whitespace-nowrap ${notifFilter === label ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                      {label} {notificationCounts?.[label] ? <span className="opacity-80">({notificationCounts[label]})</span> : ''}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  {[["Unread", unreadNotifs], ["Critical", (myNotifs || []).filter(n => n.priority === 'Critical').length], ["High", (myNotifs || []).filter(n => n.priority === 'High').length], ["Total", (myNotifs || []).length]].map(([label, count]) => (
                    <div key={label} className="bg-white border border-slate-100 rounded-xl py-2">
                      <p className="text-sm font-black text-slate-800">{count}</p>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {(filteredNotifs || []).length === 0 && <p className="text-xs text-slate-400 font-bold text-center py-6">No notifications found.</p>}
                {(filteredNotifs || []).map(n => {
                  const unread = !isNotificationReadByUser(n, currentUser);
                  return (
                    <div key={n.id} className={`p-3.5 rounded-2xl flex items-start transition-colors group ${unread ? 'bg-indigo-50/50 border border-indigo-100' : 'bg-white hover:bg-slate-50 border border-transparent'}`}>
                      {getNotificationIcon(n)}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${priorityClass(n.priority)}`}>{n.priority || 'Info'}</span>
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{n.category || 'System'}</span>
                        </div>
                        <p className={`text-sm text-slate-800 leading-snug ${unread ? 'font-extrabold' : 'font-semibold'}`}>{n.title}</p>
                        <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">{n.time}</p>
                      </div>
                      {unread ? <button type="button" onClick={() => markNotificationRead(n.id)} className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 ml-2 bg-white/80 border border-indigo-100 px-2 py-1 rounded-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">Read</button> : <span className="text-[10px] font-black text-emerald-600 ml-2">✓</span>}
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-slate-100 bg-slate-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Activity Timeline</p>
                  <button type="button" onClick={requestDesktopNotifications} className={`text-[10px] font-black px-2 py-1 rounded-lg border ${desktopNotificationsEnabled ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>Desktop {desktopNotificationsEnabled ? 'On' : 'Off'}</button>
                </div>
                <div className="space-y-2 max-h-36 overflow-y-auto custom-scrollbar">
                  {(activityTimeline || []).length === 0 && <p className="text-xs text-slate-400 font-bold text-center py-3">No recent activity.</p>}
                  {(activityTimeline || []).map(item => (
                    <div key={item.id} className="flex items-start gap-2 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0"></span>
                      <div className="min-w-0"><p className="font-bold text-slate-700 truncate">{item.label}</p><p className="text-[10px] text-slate-400 font-black uppercase">{item.type}</p></div>
                    </div>
                  ))}
                </div>
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
            {currentUser.profilePhoto ? <img src={profilePhotoUrl(currentUser.profilePhoto, getProfilePhotoVersion(currentUser))} alt={currentUser.name} className="w-full h-full object-cover" /> : <User className="w-5 h-5 text-slate-400" />}
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

export const MainTabNavigation = ({ currentUser, ROLES, activeTab, setActiveTab }) => {
  const selectTab = (tab, event) => {
    if (event) {
      event.preventDefault?.();
      event.stopPropagation?.();
    }
    setActiveTab(tab);
  };
  const tabButtonProps = (tab) => ({
    type: 'button',
    onClick: () => setActiveTab(tab),
    onTouchEnd: (event) => selectTab(tab, event),
  });

  return (
  <div className="kalpa-main-tabs flex gap-2 mb-6 sm:mb-8 bg-white p-1.5 rounded-2xl shadow-sm border-2 border-slate-100 w-full sm:w-fit max-w-full overflow-x-auto sm:flex-wrap custom-scrollbar relative z-[90] pointer-events-auto touch-pan-x">
    <button {...tabButtonProps('command')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 pointer-events-auto ${activeTab === 'command' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>Command Centre</button>
    {currentUser.role === ROLES.DESIGNER && (
      <button {...tabButtonProps('my_tasks')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 flex items-center pointer-events-auto ${activeTab === 'my_tasks' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}><User className="w-4 h-4 mr-1.5" /> My Tasks</button>
    )}
    {currentUser.role !== ROLES.DESIGNER && <button {...tabButtonProps('board')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 pointer-events-auto ${activeTab === 'board' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>Operations</button>}
    {currentUser.role === ROLES.MANAGER && (
      <button {...tabButtonProps('my_tasks')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 flex items-center pointer-events-auto ${activeTab === 'my_tasks' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}><User className="w-4 h-4 mr-1.5" /> My Tasks</button>
    )}
    <button {...tabButtonProps('productivity')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 pointer-events-auto ${activeTab === 'productivity' ? 'bg-emerald-100 text-emerald-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Performance Analytics</button>
    {currentUser.role === ROLES.ADMIN && <button {...tabButtonProps('closing')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 pointer-events-auto ${activeTab === 'closing' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>Daily Closing</button>}
    {currentUser.role === ROLES.ADMIN && <button {...tabButtonProps('reports')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 pointer-events-auto ${activeTab === 'reports' ? 'bg-indigo-100 text-indigo-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Reports</button>}
    {currentUser.role === ROLES.ADMIN && (
      <button {...tabButtonProps('ledger')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 pointer-events-auto ${activeTab === 'ledger' ? 'bg-amber-100 text-amber-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Finance</button>
    )}
    <button {...tabButtonProps('team')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 pointer-events-auto ${activeTab === 'team' ? 'bg-emerald-100 text-emerald-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Team</button>
    <button {...tabButtonProps('attendance')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 pointer-events-auto ${activeTab === 'attendance' ? 'bg-indigo-100 text-indigo-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Attendance</button>
    <button {...tabButtonProps('calculator')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 pointer-events-auto ${activeTab === 'calculator' ? 'bg-blue-100 text-blue-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Tools</button>
    <button {...tabButtonProps('archive')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 pointer-events-auto ${activeTab === 'archive' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>Archive</button>
    <button {...tabButtonProps('meeting')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 flex items-center pointer-events-auto ${activeTab === 'meeting' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}><Video className="w-4 h-4 mr-1.5" /> Team Meeting</button>
    {currentUser.role === ROLES.ADMIN && <button {...tabButtonProps('settings')} className={`shrink-0 px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 active:scale-95 flex items-center pointer-events-auto ${activeTab === 'settings' || activeTab === 'qa' ? 'bg-slate-100 text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}><Settings className="w-4 h-4 mr-1.5" /> Settings</button>}
  </div>
  );
};


export const MobileBottomNavigation = ({ currentUser, ROLES, activeTab, setActiveTab, unreadNotifs = 0 }) => {
  const [showMore, setShowMore] = React.useState(false);
  const isAdmin = currentUser?.role === ROLES.ADMIN;
  const isDesigner = currentUser?.role === ROLES.DESIGNER;
  const isManager = currentUser?.role === ROLES.MANAGER;
  const taskTab = isDesigner || isManager ? 'my_tasks' : 'board';
  const taskLabel = isDesigner || isManager ? 'My Tasks' : 'Operations';
  const taskIcon = isDesigner || isManager ? User : ClipboardList;

  const primaryTabs = [
    { key: 'command', label: 'Command', icon: LayoutDashboard },
    { key: taskTab, label: taskLabel, icon: taskIcon },
    { key: 'productivity', label: 'Performance', icon: BarChart3 },
    { key: 'team', label: 'Team', icon: Users },
  ];

  const moreTabs = [
    ...(isAdmin ? [{ key: 'ledger', label: 'Finance', icon: Briefcase }, { key: 'closing', label: 'Closing', icon: CheckCircle }, { key: 'reports', label: 'Reports', icon: BarChart3 }, { key: 'settings', label: 'Settings', icon: Settings }] : []),
    { key: 'attendance', label: 'Attendance', icon: Calendar },
    { key: 'calculator', label: 'Tools', icon: Calculator },
    { key: 'archive', label: 'Archive', icon: Archive },
    { key: 'meeting', label: 'Meeting', icon: Video },
  ];

  const go = (key) => {
    setActiveTab(key);
    setShowMore(false);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const TabButton = ({ item }) => {
    const Icon = item.icon;
    const selected = activeTab === item.key;
    return (
      <button type="button" onClick={() => go(item.key)} className={`kalpa-bottom-nav-btn ${selected ? 'is-active' : ''}`} aria-current={selected ? 'page' : undefined}>
        <span className="kalpa-bottom-nav-icon"><Icon className="w-5 h-5" />{item.key === 'command' && unreadNotifs > 0 && <em>{unreadNotifs > 99 ? '99+' : unreadNotifs}</em>}</span>
        <span>{item.label}</span>
      </button>
    );
  };

  return (
    <div className="kalpa-bottom-nav-shell lg:hidden" role="navigation" aria-label="Mobile app navigation">
      {showMore && (
        <div className="kalpa-bottom-more-panel">
          {moreTabs.map(item => {
            const Icon = item.icon;
            const selected = activeTab === item.key;
            return (
              <button key={item.key} type="button" onClick={() => go(item.key)} className={selected ? 'is-active' : ''}>
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="kalpa-bottom-nav-bar">
        {primaryTabs.map(item => <TabButton key={item.key} item={item} />)}
        <button type="button" onClick={() => setShowMore(v => !v)} className={`kalpa-bottom-nav-btn ${showMore || moreTabs.some(t => t.key === activeTab) ? 'is-active' : ''}`} aria-expanded={showMore}>
          <span className="kalpa-bottom-nav-icon"><MoreHorizontal className="w-5 h-5" /></span>
          <span>More</span>
        </button>
      </div>
    </div>
  );
};
