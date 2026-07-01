export const API_BASE = import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Production mode uses the central backend/PostgreSQL state first.
// Firebase/localStorage are kept only as UI fallback/cache.
export const USE_BACKEND_STATE = true;

export const ONLINE_STALE_MS = 2 * 60 * 1000;
export const MAX_INLINE_DATA_URL_CHARS = 180000;
