import { ONLINE_STALE_MS, PRESENCE_HEARTBEAT_MS } from './presenceConfig.js';
const configuredApiBase = String(import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const allowExternalDevelopmentApi = String(import.meta.env.VITE_ALLOW_EXTERNAL_DEV_API || '').toLowerCase() === 'true';

// Local development uses the Vite same-origin proxy. This prevents CORS and
// cookie problems when Vite automatically selects 5174, 5175, or another free
// port, and prevents an old VITE_API_URL shell variable from accidentally
// sending local test actions to production.
export const API_BASE = import.meta.env.PROD
  // Production requests stay on the frontend origin and are forwarded by
  // Vercel. This avoids making every user's ISP route directly to the VPS.
  ? ''
  : (allowExternalDevelopmentApi ? configuredApiBase : '');

if (import.meta.env.PROD && !configuredApiBase) {
  throw new Error('Production build requires VITE_API_URL (or VITE_API_BASE).');
}

// Production mode uses the central backend/PostgreSQL state first.
// Firebase/localStorage are kept only as UI fallback/cache.
export const USE_BACKEND_STATE = true;

export { ONLINE_STALE_MS, PRESENCE_HEARTBEAT_MS };
export const MAX_INLINE_DATA_URL_CHARS = 180000;
