import React from 'react';
import { FileText, LayoutDashboard } from 'lucide-react';
import { EmptyStatePanel, LoadingState } from './ui/designSystem.jsx';

export const Badge = ({ children, colorClass }) => (
  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-200 ${colorClass}`}>
    {children}
  </span>
);

export const PageLoadingScreen = ({ title = 'Connecting to Secure Cloud...', subtitle = 'Preparing Kalpvriksha Designs Ops' }) => (/* legacy compatible wrapper */
  <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 flex items-center justify-center p-6">
    <div className="bg-white/90 backdrop-blur rounded-[2rem] border-2 border-slate-100 shadow-2xl px-8 py-10 w-full max-w-md text-center animate-in fade-in zoom-in-95 duration-300">
      <div className="relative mx-auto mb-6 w-20 h-20">
        <div className="absolute inset-0 rounded-3xl bg-indigo-100 animate-pulse"></div>
        <div className="absolute inset-2 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
          <LayoutDashboard className="text-white w-9 h-9" />
        </div>
      </div>
      <p className="text-slate-800 font-black tracking-tight text-lg">{title}</p>
      <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-2">{subtitle}</p>
      <div className="mt-6 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full w-1/2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full animate-pulse"></div>
      </div>
    </div>
  </div>
);

export const EmptyState = ({ icon: Icon = FileText, title = 'Nothing to show yet', description = 'New activity will appear here automatically.', action = null, compact = false }) => (
  <div className={`w-full rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/70 ${compact ? 'p-5' : 'p-8'} text-center animate-in fade-in duration-200`}>
    <div className={`${compact ? 'w-11 h-11' : 'w-14 h-14'} rounded-2xl bg-white border border-slate-100 shadow-sm mx-auto mb-3 flex items-center justify-center`}>
      <Icon className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} text-slate-400`} />
    </div>
    <p className="text-sm font-black text-slate-700">{title}</p>
    {description && <p className="text-xs font-bold text-slate-400 mt-1 max-w-md mx-auto">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const MiniEmptyState = ({ children }) => (
  <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-xs font-bold text-slate-400 text-center animate-in fade-in duration-200">
    {children}
  </div>
);


export { LoadingState, EmptyStatePanel };
