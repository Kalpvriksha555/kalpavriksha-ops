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
    let inFlight = null;
    let queuedForce = false;

    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      if (cancelled) return;
      clearTimer();
      const delay = document.visibilityState === 'hidden' ? hiddenIntervalMs : visibleIntervalMs;
      timer = window.setTimeout(() => run(), delay);
    };

    const run = ({ force = false } = {}) => {
      if (cancelled) return Promise.resolve();
      if (inFlight) {
        // Focus/online/visibility events can arrive together. Collapse them into
        // one follow-up refresh instead of starting parallel API requests and
        // leaving multiple timers behind.
        queuedForce = queuedForce || force;
        return inFlight;
      }
      const now = Date.now();
      if (!force && now - lastRunRef.current < MIN_EVENT_GAP_MS) {
        schedule();
        return Promise.resolve();
      }
      lastRunRef.current = now;
      clearTimer();
      inFlight = Promise.resolve()
        .then(() => refreshRef.current?.())
        .catch(() => undefined)
        .finally(() => {
          inFlight = null;
          if (cancelled) return;
          if (queuedForce) {
            queuedForce = false;
            run({ force: true });
          } else schedule();
        });
      return inFlight;
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
      clearTimer();
      queuedForce = false;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, visibleIntervalMs, hiddenIntervalMs]);
};

export default useAdaptiveWorkspaceSync;
