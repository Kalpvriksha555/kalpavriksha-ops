import { API_BASE } from '../config/appConfig';

const CSRF_STORAGE_KEY = 'kalpa_csrf_token';
let csrfToken = '';

try { csrfToken = window.localStorage.getItem(CSRF_STORAGE_KEY) || ''; } catch {}

export const setCsrfToken = (value = '') => {
  csrfToken = String(value || '');
  try {
    if (csrfToken) window.localStorage.setItem(CSRF_STORAGE_KEY, csrfToken);
    else window.localStorage.removeItem(CSRF_STORAGE_KEY);
  } catch {}
};

export const getCsrfToken = () => csrfToken;

const safeMethod = (method = 'GET') => ['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());

const parsePayload = async (response) => response.json().catch(() => ({}));

export const authFetch = async (input, init = {}) => {
  const method = String(init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});
  if (!safeMethod(method) && csrfToken && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(input, { ...init, method, headers, credentials: 'include' });
  if (response.status === 401) {
    setCsrfToken('');
    try { window.dispatchEvent(new CustomEvent('kalpa-auth-expired')); } catch {}
  }
  return response;
};

const throwAuthError = async (response, fallback) => {
  const payload = await parsePayload(response);
  const error = new Error(payload.error || fallback || `Authentication request failed: ${response.status}`);
  error.status = response.status;
  error.code = payload.code || '';
  error.payload = payload;
  throw error;
};

export const loginApi = async ({ username, password }) => {
  const response = await authFetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!response.ok) return throwAuthError(response, 'Login failed.');
  const payload = await parsePayload(response);
  setCsrfToken(payload.csrfToken || '');
  return payload;
};

export const getSessionApi = async () => {
  const response = await authFetch(`${API_BASE}/api/auth/session`, { cache: 'no-store' });
  if (!response.ok) {
    setCsrfToken('');
    return { ok: false, authenticated: false };
  }
  const payload = await parsePayload(response);
  setCsrfToken(payload.csrfToken || '');
  return payload;
};

export const logoutApi = async () => {
  try {
    const response = await authFetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
    if (!response.ok && response.status !== 401) await throwAuthError(response, 'Logout failed.');
  } finally {
    setCsrfToken('');
  }
  return { ok: true };
};

export const logoutAllApi = async () => {
  const response = await authFetch(`${API_BASE}/api/auth/logout-all`, { method: 'POST' });
  if (!response.ok) return throwAuthError(response, 'Could not sign out other sessions.');
  setCsrfToken('');
  return parsePayload(response);
};

export const changePasswordApi = async ({ currentPassword, newPassword }) => {
  const response = await authFetch(`${API_BASE}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword })
  });
  if (!response.ok) return throwAuthError(response, 'Password could not be changed.');
  const payload = await parsePayload(response);
  setCsrfToken(payload.csrfToken || '');
  return payload;
};

export const requestPasswordRecoveryApi = async ({ username, channel, email, mobile }) => {
  const response = await authFetch(`${API_BASE}/api/auth/recovery/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, channel, email, mobile })
  });
  if (!response.ok) return throwAuthError(response, 'Recovery OTP could not be sent.');
  return parsePayload(response);
};

export const resetPasswordRecoveryApi = async ({ challengeId, otp, newPassword }) => {
  const response = await authFetch(`${API_BASE}/api/auth/recovery/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId, otp, newPassword })
  });
  if (!response.ok) return throwAuthError(response, 'Password could not be reset.');
  return parsePayload(response);
};

export const createAuthUserApi = async (user) => {
  const response = await authFetch(`${API_BASE}/api/auth/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user)
  });
  if (!response.ok) return throwAuthError(response, 'Employee account could not be created.');
  return parsePayload(response);
};

export const updateAuthUserApi = async (userId, patch) => {
  const response = await authFetch(`${API_BASE}/api/auth/users/${encodeURIComponent(String(userId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  if (!response.ok) return throwAuthError(response, 'Employee access could not be updated.');
  return parsePayload(response);
};

export const resetAuthUserPasswordApi = async (userId, password) => {
  const response = await authFetch(`${API_BASE}/api/auth/users/${encodeURIComponent(String(userId))}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!response.ok) return throwAuthError(response, 'Employee password could not be reset.');
  return parsePayload(response);
};
