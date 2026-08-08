import { API_BASE } from '../config/appConfig';
import { createRequestDeadline } from './requestControlService.js';

const CSRF_STORAGE_KEY = 'kalpa_csrf_token';
let csrfToken = '';

// CSRF credentials are page-instance secrets. Remove the legacy persisted copy
// so a browser refresh never silently resurrects the previous workspace session.
try { window.localStorage.removeItem(CSRF_STORAGE_KEY); } catch {}

export const setCsrfToken = (value = '') => {
  csrfToken = String(value || '');
  try { window.localStorage.removeItem(CSRF_STORAGE_KEY); } catch {}
};

export const getCsrfToken = () => csrfToken;

const safeMethod = (method = 'GET') => ['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
export const DEFAULT_AUTH_FETCH_TIMEOUT_MS = 90_000;
export const AUTH_REQUEST_TIMEOUTS = Object.freeze({
  boot: 5_000,
  login: 20_000,
  passwordChange: 35_000,
  recoverySend: 40_000,
  recoveryReset: 40_000
});
const RESPONSE_BODY_METHODS = new Set(['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text']);

const timeoutMessageForAuthAction = (action = '') => ({
  boot:'Secure session verification took too long. Check your connection and retry sign-in.',
  login:'Secure sign-in took too long. Check your connection and try again.',
  passwordChange:'Password change confirmation took too long. Your password was not confirmed; please retry.',
  recoverySend:'Password recovery delivery took too long. Wait briefly before requesting another OTP.',
  recoveryReset:'Password reset confirmation took too long. Your new password was not confirmed; please retry.'
}[action] || 'The secure request took too long. Please retry.');

const normalizeAuthNetworkError = (error, action = '') => {
  const normalized = error instanceof Error ? error : new Error(String(error || 'Authentication request failed.'));
  if (normalized.name === 'TimeoutError' || /timed out/i.test(normalized.message)) {
    normalized.code = 'AUTH_REQUEST_TIMEOUT';
    normalized.message = timeoutMessageForAuthAction(action);
    return normalized;
  }
  if (normalized.name === 'TypeError' || /failed to fetch|network|offline/i.test(normalized.message)) {
    normalized.code = 'AUTH_NETWORK_UNAVAILABLE';
    normalized.message = 'The secure server could not be reached. Check your internet connection and try again.';
  }
  return normalized;
};

const requestAbortReason = (signal) => {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Request was aborted.');
  error.name = 'AbortError';
  return error;
};

const consumeWithDeadline = async (response, methodName, args, deadline, finish) => {
  const operation = Promise.resolve().then(() => response[methodName](...args));
  if (!deadline.signal) {
    try { return await operation; } finally { finish(); }
  }

  let abortHandler = null;
  const aborted = new Promise((_, reject) => {
    abortHandler = () => {
      const reason = requestAbortReason(deadline.signal);
      try { response.body?.cancel?.(reason)?.catch?.(() => {}); } catch {}
      reject(reason);
    };
    if (deadline.signal.aborted) abortHandler();
    else deadline.signal.addEventListener('abort', abortHandler, { once:true });
  });

  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (abortHandler) deadline.signal.removeEventListener('abort', abortHandler);
    finish();
  }
};

const streamWithDeadline = (body, deadline, finish) => {
  if (!body || typeof ReadableStream === 'undefined') return body;
  const reader = body.getReader();
  let settled = false;
  let abortHandler = null;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (abortHandler && deadline.signal) deadline.signal.removeEventListener('abort', abortHandler);
    finish();
  };

  return new ReadableStream({
    start(controller) {
      if (!deadline.signal) return;
      abortHandler = () => {
        if (settled) return;
        const reason = requestAbortReason(deadline.signal);
        try { reader.cancel(reason).catch(() => {}); } catch {}
        settle();
        try { controller.error(reason); } catch {}
      };
      if (deadline.signal.aborted) abortHandler();
      else deadline.signal.addEventListener('abort', abortHandler, { once:true });
    },
    async pull(controller) {
      if (settled) return;
      try {
        const { done, value } = await reader.read();
        if (done) {
          settle();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        settle();
        controller.error(error);
      }
    },
    async cancel(reason) {
      settle();
      try { await reader.cancel(reason); } catch {}
    }
  });
};

const wrapResponseWithDeadline = (response, deadline, requestMethod = 'GET') => {
  let finished = false;
  let wrappedBody;
  const finish = () => {
    if (finished) return;
    finished = true;
    deadline.cleanup();
  };

  if (!response.body || requestMethod === 'HEAD' || [204, 205, 304].includes(response.status)) finish();

  return new Proxy(response, {
    get(target, property) {
      if (property === 'body') {
        if (finished) return target.body;
        wrappedBody ||= streamWithDeadline(target.body, deadline, finish);
        return wrappedBody;
      }
      if (RESPONSE_BODY_METHODS.has(property) && typeof target[property] === 'function') {
        return (...args) => consumeWithDeadline(target, property, args, deadline, finish);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
};

const parsePayload = async (response) => response.json().catch(() => ({}));

export const authFetch = async (input, init = {}) => {
  const {
    timeoutMs = DEFAULT_AUTH_FETCH_TIMEOUT_MS,
    signal: externalSignal,
    notifyAuthExpired = true,
    authAction = '',
    ...fetchInit
  } = init || {};
  const method = String(fetchInit.method || 'GET').toUpperCase();
  const headers = new Headers(fetchInit.headers || {});
  if (!safeMethod(method) && csrfToken && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', csrfToken);

  const deadline = createRequestDeadline({ timeoutMs, externalSignal });

  try {
    const response = await fetch(input, { ...fetchInit, method, headers, signal:deadline.signal, credentials: 'include' });
    if (response.status === 401 && notifyAuthExpired) {
      setCsrfToken('');
      try { window.dispatchEvent(new CustomEvent('kalpa-auth-expired')); } catch {}
    }
    return wrapResponseWithDeadline(response, deadline, method);
  } catch (error) {
    deadline.cleanup();
    throw normalizeAuthNetworkError(error, authAction);
  }
};

const throwAuthError = async (response, fallback) => {
  const payload = await parsePayload(response);
  const error = new Error(payload.error || fallback || `Authentication request failed: ${response.status}`);
  error.status = response.status;
  error.code = payload.code || '';
  error.payload = payload;
  error.retryAfterSeconds = Number(response.headers?.get?.('Retry-After') || payload.retryAfterSeconds || 0);
  error.requestId = String(response.headers?.get?.('X-Request-Id') || payload.requestId || '');
  if (response.status === 401) error.authenticationRejected = true;
  throw error;
};

export const loginApi = async ({ username, password }) => {
  const response = await authFetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    timeoutMs:AUTH_REQUEST_TIMEOUTS.login,
    authAction:'login',
    notifyAuthExpired: false
  });
  if (!response.ok) return throwAuthError(response, 'Login failed.');
  const payload = await parsePayload(response);
  setCsrfToken(payload.csrfToken || '');
  return payload;
};

export const clearBrowserSessionApi = async () => {
  setCsrfToken('');
  const response = await authFetch(`${API_BASE}/api/auth/clear-browser-session`, {
    method: 'POST',
    cache: 'no-store',
    timeoutMs: 8_000,
    authAction:'boot',
    notifyAuthExpired: false
  });
  if (!response.ok) return throwAuthError(response, 'Previous browser session could not be cleared.');
  return parsePayload(response);
};

export const getSessionApi = async () => {
  const response = await authFetch(`${API_BASE}/api/auth/session`, { cache:'no-store', timeoutMs:AUTH_REQUEST_TIMEOUTS.boot, authAction:'boot' });
  if (!response.ok) return throwAuthError(response, 'Secure session verification failed.');
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
    body: JSON.stringify({ currentPassword, newPassword }),
    timeoutMs:AUTH_REQUEST_TIMEOUTS.passwordChange,
    authAction:'passwordChange',
    notifyAuthExpired: false
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
    body: JSON.stringify({ username, channel, email, mobile }),
    timeoutMs:AUTH_REQUEST_TIMEOUTS.recoverySend,
    authAction:'recoverySend',
    notifyAuthExpired: false
  });
  if (!response.ok) return throwAuthError(response, 'Recovery OTP could not be sent.');
  return parsePayload(response);
};

export const resetPasswordRecoveryApi = async ({ challengeId, otp, newPassword }) => {
  const response = await authFetch(`${API_BASE}/api/auth/recovery/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId, otp, newPassword }),
    timeoutMs:AUTH_REQUEST_TIMEOUTS.recoveryReset,
    authAction:'recoveryReset',
    notifyAuthExpired: false
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
