$ErrorActionPreference = "Stop"

$componentCode = @'
import React, { useEffect, useMemo, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { formatDateTime } from '../../utils/date';

export const ActiveToasts = ({ notifications = [], currentUser }) => {
  const [dismissed, setDismissed] = useState([]);

  const visibleToasts = useMemo(() => {
    return (notifications || [])
      .filter(n => {
        if (!currentUser) return false;
        const belongsToMe = (!n.targetUser && n.targetRole === currentUser.role) || n.targetUser === currentUser.name;
        const isUnread = !(n.readBy || []).includes(currentUser.name);
        const id = String(n.id || n.createdAt || n.title || '');
        return belongsToMe && isUnread && !dismissed.includes(id);
      })
      .sort((a, b) => Number(b.id || b.createdAt || 0) - Number(a.id || a.createdAt || 0))
      .slice(0, 3);
  }, [notifications, currentUser, dismissed]);

  useEffect(() => {
    if (!visibleToasts.length) return;
    const timer = setTimeout(() => {
      setDismissed(prev => [...prev, ...visibleToasts.map(n => String(n.id || n.createdAt || n.title || ''))]);
    }, 7000);
    return () => clearTimeout(timer);
  }, [visibleToasts]);

  if (!visibleToasts.length) return null;

  const getToastClass = (type = '') => {
    const value = String(type || '').toLowerCase();
    if (['urgent', 'critical', 'error'].includes(value)) return 'border-red-100 bg-red-50 text-red-900';
    if (['high', 'warning'].includes(value)) return 'border-amber-100 bg-amber-50 text-amber-900';
    if (['success', 'completed'].includes(value)) return 'border-emerald-100 bg-emerald-50 text-emerald-900';
    if (['mention', 'chat', 'message'].includes(value)) return 'border-indigo-100 bg-indigo-50 text-indigo-900';
    return 'border-slate-100 bg-white text-slate-900';
  };

  const getToastIconClass = (type = '') => {
    const value = String(type || '').toLowerCase();
    if (['urgent', 'critical', 'error'].includes(value)) return 'text-red-600 bg-red-100';
    if (['high', 'warning'].includes(value)) return 'text-amber-600 bg-amber-100';
    if (['success', 'completed'].includes(value)) return 'text-emerald-600 bg-emerald-100';
    if (['mention', 'chat', 'message'].includes(value)) return 'text-indigo-600 bg-indigo-100';
    return 'text-slate-600 bg-slate-100';
  };

  return (
    <div className="fixed top-20 right-4 z-[80] w-[calc(100vw-2rem)] max-w-sm space-y-3 pointer-events-none">
      {visibleToasts.map(n => {
        const id = String(n.id || n.createdAt || n.title || '');
        return (
          <div key={id} className={`pointer-events-auto rounded-2xl border shadow-2xl p-4 backdrop-blur-xl transition-all duration-300 ${getToastClass(n.type)}`}>
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${getToastIconClass(n.type)}`}>
                <Bell className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black truncate">{n.title || 'New notification'}</p>
                <p className="text-[11px] font-bold opacity-60 mt-1">{n.time || formatDateTime(n.createdAt || n.id || Date.now())}</p>
              </div>
              <button
                type="button"
                onClick={() => setDismissed(prev => [...prev, id])}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-black/5 transition-colors shrink-0"
                aria-label="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
'@

$targets = @(
  @{ App = "frontend/src/App.jsx"; Component = "frontend/src/components/notifications/ActiveToasts.jsx" },
  @{ App = "src/App.jsx"; Component = "src/components/notifications/ActiveToasts.jsx" }
)

foreach ($target in $targets) {
  if (!(Test-Path $target.App)) { continue }

  $componentDir = Split-Path $target.Component
  New-Item -ItemType Directory -Force -Path $componentDir | Out-Null
  Set-Content -Path $target.Component -Value $componentCode -Encoding UTF8

  $text = Get-Content $target.App -Raw

  if ($text -notmatch "components/notifications/ActiveToasts") {
    $layoutImport = "import { LocalModeBanner, DatabasePermissionBanner, TopNavigation, MobileSearchBar, MainTabNavigation } from './components/layout';"
    $replacement = $layoutImport + "`r`nimport { ActiveToasts } from './components/notifications/ActiveToasts';"
    if ($text.Contains($layoutImport)) {
      $text = $text.Replace($layoutImport, $replacement)
    } else {
      $text = "import { ActiveToasts } from './components/notifications/ActiveToasts';`r`n" + $text
    }
  }

  $text = $text -replace '<activeToasts', '<ActiveToasts'

  if ($text -notmatch '<ActiveToasts\s+notifications=\{notifications\}\s+currentUser=\{currentUser\}\s*/>') {
    $rootPattern = '(<div className=\{`min-h-screen[^\r\n]*\}\>\s*)'
    if ($text -match $rootPattern) {
      $text = [regex]::Replace($text, $rootPattern, '$1' + "`r`n      <ActiveToasts notifications={notifications} currentUser={currentUser} />", 1)
    }
  }

  Set-Content -Path $target.App -Value $text -Encoding UTF8
}

Write-Host "Notification toast recovery applied. Now run npm builds and test login."
