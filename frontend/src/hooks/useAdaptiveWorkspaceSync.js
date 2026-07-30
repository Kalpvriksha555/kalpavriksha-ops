import { useEffect, useRef } from 'react';

const DEFAULT_VISIBLE_MS = 60_000;
const DEFAULT_HIDDEN_MS = 5 * 60_000;
const MIN_EVENT_GAP_MS = 5_000;

export const useAdaptiveWorkspaceSync = ({ enabled, refresh, visibleIntervalMs = DEFAULT_VISIBLE_MS, hiddenIntervalMs = DEFAULT_HIDDEN_MS }) => {
  const refreshRef = useRef(refresh);
  const lastRunRef = useRef(0);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer = null;

    const schedule = () => {
      if (cancelled) return;
      const delay = document.visibilityState === 'hidden' ? hiddenIntervalMs : visibleIntervalMs;
      timer = window.setTimeout(run, delay);
    };

    const run = async ({ force = false } = {}) => {
      if (cancelled) return;
      const now = Date.now();
      if (!force && now - lastRunRef.current < MIN_EVENT_GAP_MS) { schedule(); return; }
      lastRunRef.current = now;
      try { await refreshRef.current?.(); } finally { if (timer) window.clearTimeout(timer); schedule(); }
    };

    const onFocus = () => run({ force: true });
    const onOnline = () => run({ force: true });
    const onVisibility = () => { if (document.visibilityState === 'visible') run({ force: true }); };

    run({ force: true });
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, visibleIntervalMs, hiddenIntervalMs]);
};

export default useAdaptiveWorkspaceSync;
