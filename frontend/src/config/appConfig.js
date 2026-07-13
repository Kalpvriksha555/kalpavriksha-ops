const runtimeApiBase = 'https://api.kalpvriksha.co.in';

export const API_BASE = String(import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || runtimeApiBase).replace(/\/+$/, '');

// Production mode uses the central backend/PostgreSQL state first.
// Firebase/localStorage are kept only as UI fallback/cache.
export const USE_BACKEND_STATE = true;

export const ONLINE_STALE_MS = 8 * 60 * 1000;
export const MAX_INLINE_DATA_URL_CHARS = 180000;
