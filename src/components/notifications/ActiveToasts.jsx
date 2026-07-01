import React, { useEffect, useMemo, useState } from "react";
import { MessageSquare, X, Bell, AlertCircle, CheckCircle } from "lucide-react";
import { getVisibleNotifications } from "../../services/notificationService";

const storageKeyFor = (user = {}) => `kalpa_dismissed_toasts_${String(user.id || user.name || "guest").replace(/[^a-z0-9_-]/gi, "_")}`;

const iconFor = (notification = {}) => {
  const category = String(notification.category || '').toLowerCase();
  const type = String(notification.type || '').toLowerCase();
  const priority = String(notification.priority || '').toLowerCase();
  if (priority === 'critical' || type === 'urgent') return <AlertCircle className="w-5 h-5 text-red-500" />;
  if (category === 'chat' || type === 'chat' || type === 'mention') return <MessageSquare className="w-5 h-5 text-purple-600" />;
  if (type === 'success') return <CheckCircle className="w-5 h-5 text-emerald-600" />;
  return <Bell className="w-5 h-5 text-indigo-600" />;
};

export const ActiveToasts = ({ toasts = [], notifications = [], currentUser }) => {
  const storageKey = storageKeyFor(currentUser || {});
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]').map(String); } catch(e) { return []; }
  });

  useEffect(() => {
    try { setDismissed(JSON.parse(localStorage.getItem(storageKey) || '[]').map(String)); } catch(e) { setDismissed([]); }
  }, [storageKey]);

  const source = useMemo(() => {
    if (Array.isArray(toasts) && toasts.length) return toasts;
    if (!currentUser) return [];
    return getVisibleNotifications(notifications, currentUser, { unreadOnly: true, limit: 4 })
      .filter(n => !dismissed.includes(String(n.id)));
  }, [toasts, notifications, currentUser, dismissed]);

  useEffect(() => {
    if (!source.length) return undefined;
    const timer = window.setTimeout(() => {
      const ids = source.map(n => String(n.id)).filter(Boolean);
      if (!ids.length) return;
      setDismissed(prev => {
        const next = [...new Set([...prev, ...ids])].slice(-80);
        try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch(e) {}
        return next;
      });
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [source.map(n => n.id).join('|'), storageKey]);

  const dismiss = (id) => {
    const sid = String(id);
    setDismissed(prev => {
      const next = [...new Set([...prev, sid])].slice(-80);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch(e) {}
      return next;
    });
  };

  if (!source.length) return null;

  return (
    <div
      className="fixed top-24 right-4 space-y-3 pointer-events-none max-w-[calc(100vw-2rem)] kalpa-toast-host"
      style={{ zIndex: 2147483000 }}
      aria-live="polite"
      aria-relevant="additions"
    >
      {source.slice(0, 3).map((toast, index) => (
        <div
          key={toast.id || index}
          className="pointer-events-auto bg-white/95 backdrop-blur border border-slate-200 shadow-2xl rounded-2xl px-4 py-3 text-sm text-slate-800 w-[340px] max-w-full animate-in slide-in-from-right-4 fade-in duration-200 kalpa-toast-card"
          style={{ transform: `translateY(${index * 2}px)` }}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">{iconFor(toast)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600">{toast.category || 'Notification'}</span>
                {toast.priority && <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{toast.priority}</span>}
              </div>
              {toast.title && <div className="font-black leading-snug break-words">{toast.title}</div>}
              {toast.message || toast.text ? <div className="mt-1 text-xs font-semibold text-slate-500 break-words">{toast.message || toast.text}</div> : null}
              {toast.time && <div className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">{toast.time}</div>}
            </div>
            <button type="button" onClick={() => dismiss(toast.id)} className="text-slate-300 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-50"><X className="w-4 h-4" /></button>
          </div>
        </div>
      ))}
    </div>
  );
};
