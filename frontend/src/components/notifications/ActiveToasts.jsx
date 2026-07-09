import React, { useEffect, useMemo, useState } from "react";
import { ToastViewport } from "../ui/designSystem.jsx";
import { getVisibleNotifications } from "../../services/notificationService";

const storageKeyFor = (user = {}) => `kalpa_dismissed_toasts_${String(user.id || user.name || "guest").replace(/[^a-z0-9_-]/gi, "_")}`;

export const ActiveToasts = ({ toasts = [], notifications = [], currentUser }) => {
  const storageKey = storageKeyFor(currentUser || {});
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]').map(String); } catch(e) { return []; }
  });

  useEffect(() => {
    try { setDismissed(JSON.parse(localStorage.getItem(storageKey) || '[]').map(String)); } catch(e) { setDismissed([]); }
  }, [storageKey]);

  const source = useMemo(() => {
    if (Array.isArray(toasts) && toasts.length) return toasts.filter(n => !dismissed.includes(String(n.id)));
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

  return <ToastViewport toasts={source} onDismiss={dismiss} max={3} />;
};
