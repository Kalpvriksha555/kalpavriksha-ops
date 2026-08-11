import { API_BASE } from '../config/appConfig';
import { createRequestDeadline, markClientMutationStarted } from './requestControlService.js';
import { apiHttpError, readApiRecord } from './apiContractService.js';

const CSRF_STORAGE_KEY = 'kalpa_csrf_token';
const AUTH_CONTEXT_STORAGE_KEY = 'kalpa_auth_page_context_v1';
const AUTH_CONTEXT_CHANNEL_NAME = 'kalpa_auth_page_context';
const AUTH_CONTEXT_SCHEMA_VERSION = 1;
const AUTH_PAGE_INSTANCE_ID = (() => {
  try { return globalThis.crypto?.randomUUID?.() || `page-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  catch { return `page-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
})();
let csrfToken = '';
let authRequestGeneration = 0;
let observedAuthContext = null;
let authContextChannel = null;

const parseAuthContext = (raw = '') => {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const ownerInstanceId = String(value.ownerInstanceId || '').trim();
    if (!ownerInstanceId) return null;
    return {
      schemaVersion: Number(value.schemaVersion || AUTH_CONTEXT_SCHEMA_VERSION),
      generation: Math.max(0, Number(value.generation || 0)),
      ownerInstanceId,
      state: String(value.state || 'signed-out'),
      userId: String(value.userId || ''),
      reason: String(value.reason || ''),
      changedAt: Math.max(0, Number(value.changedAt || 0))
    };
  } catch { return null; }
};

const readStoredAuthContext = () => {
  try {
    const parsed = parseAuthContext(globalThis.localStorage?.getItem?.(AUTH_CONTEXT_STORAGE_KEY) || '');
    if (parsed && (!observedAuthContext || parsed.generation >= Number(observedAuthContext.generation || 0))) observedAuthContext = parsed;
  } catch {}
  return observedAuthContext;
};

const invalidateAuthRequestGeneration = () => {
  authRequestGeneration += 1;
  return authRequestGeneration;
};

const staleAuthRequestError = () => {
  const error = new Error('This request belongs to an older sign-in context and was discarded.');
  error.code = 'AUTH_REQUEST_CONTEXT_STALE';
  error.authenticationRejected = true;
  return error;
};

const assertAuthRequestGeneration = (capturedGeneration) => {
  if (Number(capturedGeneration) === authRequestGeneration) return true;
  throw staleAuthRequestError();
};

const dispatchAuthContextChanged = (context = {}, code = 'AUTH_BROWSER_CONTEXT_CHANGED') => {
  try {
    globalThis.window?.dispatchEvent?.(new CustomEvent('kalpa-auth-expired', { detail: { code, context } }));
  } catch {}
};

const acceptExternalAuthContext = (candidate) => {
  const context = parseAuthContext(candidate);
  if (!context || context.ownerInstanceId === AUTH_PAGE_INSTANCE_ID) return;
  if (observedAuthContext && Number(context.generation || 0) < Number(observedAuthContext.generation || 0)) return;
  observedAuthContext = context;
  invalidateAuthRequestGeneration();
  setCsrfToken('');
  dispatchAuthContextChanged(context);
};

export const getAuthPageInstanceId = () => AUTH_PAGE_INSTANCE_ID;
export const getBrowserAuthContext = () => readStoredAuthContext();
export const browserAuthContextOwnedByThisPage = () => {
  const context = readStoredAuthContext();
  return !context?.ownerInstanceId || context.ownerInstanceId === AUTH_PAGE_INSTANCE_ID;
};

export const claimBrowserAuthContext = ({ state = 'signed-out', userId = '', reason = '' } = {}) => {
  const previous = readStoredAuthContext();
  const context = {
    schemaVersion: AUTH_CONTEXT_SCHEMA_VERSION,
    generation: Math.max(Number(previous?.generation || 0), Number(observedAuthContext?.generation || 0)) + 1,
    ownerInstanceId: AUTH_PAGE_INSTANCE_ID,
    state: String(state || 'signed-out'),
    userId: String(userId || ''),
    reason: String(reason || ''),
    changedAt: Date.now()
  };
  observedAuthContext = context;
  invalidateAuthRequestGeneration();
  try { globalThis.localStorage?.setItem?.(AUTH_CONTEXT_STORAGE_KEY, JSON.stringify(context)); } catch {}
  try { authContextChannel?.postMessage?.(context); } catch {}
  return context;
};

export const assertBrowserAuthContextOwnership = () => {
  const context = readStoredAuthContext();
  if (!context?.ownerInstanceId || context.ownerInstanceId === AUTH_PAGE_INSTANCE_ID) return true;
  setCsrfToken('');
  dispatchAuthContextChanged(context);
  const error = new Error('This browser tab no longer owns the active sign-in. Reload this tab before signing in again.');
  error.code = 'AUTH_BROWSER_CONTEXT_CHANGED';
  error.authenticationRejected = true;
  throw error;
};

// CSRF credentials are page-instance secrets. Remove the legacy persisted copy
// so a browser refresh never silently resurrects the previous workspace session.
try { window.localStorage.removeItem(CSRF_STORAGE_KEY); } catch {}

export const setCsrfToken = (value = '') => {
  const nextToken = String(value || '');
  if (nextToken !== csrfToken) invalidateAuthRequestGeneration();
  csrfToken = nextToken;
  try { window.localStorage.removeItem(CSRF_STORAGE_KEY); } catch {}
};

export const getCsrfToken = () => csrfToken;

export const notifyBrowserAuthenticationRejected = (code = 'AUTH_REQUIRED') => {
  setCsrfToken('');
  dispatchAuthContextChanged(readStoredAuthContext(), String(code || 'AUTH_REQUIRED'));
};

if (typeof window !== 'undefined') {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      authContextChannel = new BroadcastChannel(AUTH_CONTEXT_CHANNEL_NAME);
      authContextChannel.addEventListener('message', event => acceptExternalAuthContext(event?.data));
    }
  } catch { authContextChannel = null; }
  try {
    window.addEventListener('storage', event => {
      if (event?.key === AUTH_CONTEXT_STORAGE_KEY && event?.newValue) acceptExternalAuthContext(event.newValue);
    });
  } catch {}
}

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

const API_DIAGNOSTIC_EVENT = 'kalpa-api-diagnostic';
const createClientRequestId = () => {
  try { return globalThis.crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  catch { return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
};
const safeRequestRoute = (input = '') => {
  try { return new URL(String(input || ''), globalThis.location?.origin || 'https://kalpa.invalid').pathname; }
  catch { return String(input || '').split('?')[0].split('#')[0].slice(0, 240); }
};
const responseClassForStatus = (status = 0) => {
  const value = Number(status || 0);
  if (value >= 500) return 'SERVER_5XX';
  if (value === 429) return 'RATE_LIMITED';
  if (value === 401) return 'AUTH_REQUIRED';
  if (value === 403) return 'FORBIDDEN';
  if (value === 404) return 'NOT_FOUND';
  if (value === 409) return 'CONFLICT';
  if (value >= 400) return 'CLIENT_4XX';
  return '';
};
const emitApiDiagnostic = (detail = {}) => {
  try { globalThis.window?.dispatchEvent?.(new CustomEvent(API_DIAGNOSTIC_EVENT, { detail })); } catch {}
};
const attachResponseRequestMeta = (response, meta = {}) => {
  try { Object.defineProperty(response, '__kalpaRequestMeta', { value:Object.freeze({ ...meta }), configurable:true }); } catch {}
  return response;
};

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

const consumeWithDeadline = async (response, methodName, args, deadline, finish, requestAuthGeneration) => {
  assertAuthRequestGeneration(requestAuthGeneration);
  const operation = Promise.resolve().then(() => response[methodName](...args));
  if (!deadline.signal) {
    try {
      const value = await operation;
      assertAuthRequestGeneration(requestAuthGeneration);
      return value;
    } finally { finish(); }
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
    const value = await Promise.race([operation, aborted]);
    assertAuthRequestGeneration(requestAuthGeneration);
    return value;
  } finally {
    if (abortHandler) deadline.signal.removeEventListener('abort', abortHandler);
    finish();
  }
};

const streamWithDeadline = (body, deadline, finish, requestAuthGeneration) => {
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
        assertAuthRequestGeneration(requestAuthGeneration);
        const { done, value } = await reader.read();
        assertAuthRequestGeneration(requestAuthGeneration);
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

const wrapResponseWithDeadline = (response, deadline, requestMethod = 'GET', requestAuthGeneration = authRequestGeneration) => {
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
        wrappedBody ||= streamWithDeadline(target.body, deadline, finish, requestAuthGeneration);
        return wrappedBody;
      }
      if (RESPONSE_BODY_METHODS.has(property) && typeof target[property] === 'function') {
        return (...args) => consumeWithDeadline(target, property, args, deadline, finish, requestAuthGeneration);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
};

const parsePayload = async (response, operation = 'Authentication request') => readApiRecord(response, { operation, requireOk:response.ok });

export const authFetch = async (input, init = {}) => {
  const {
    timeoutMs = DEFAULT_AUTH_FETCH_TIMEOUT_MS,
    signal: externalSignal,
    notifyAuthExpired = true,
    authAction = '',
    skipSessionOwnershipCheck = false,
    ...fetchInit
  } = init || {};
  if (!skipSessionOwnershipCheck) assertBrowserAuthContextOwnership();
  const requestAuthGeneration = authRequestGeneration;
  const method = String(fetchInit.method || 'GET').toUpperCase();
  const headers = new Headers(fetchInit.headers || {});
  const requestId = String(headers.get('X-Request-Id') || createClientRequestId()).trim();
  if (!headers.has('X-Request-Id')) headers.set('X-Request-Id', requestId);
  const route = safeRequestRoute(input);
  const operation = String(authAction || `${method} ${route}`).slice(0, 120);
  const requestStartedAt = Date.now();
  // Send the per-page session token on safe reads as well as writes. The server
  // treats a mismatched token as a stale browser-tab context without clearing
  // the shared cookie, preventing one tab from reading another tab's new user.
  if (csrfToken && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', csrfToken);

  const deadline = createRequestDeadline({ timeoutMs, externalSignal });
  if (!safeMethod(method)) markClientMutationStarted();

  try {
    const response = await fetch(input, { ...fetchInit, method, headers, signal:deadline.signal, credentials: 'include' });
    const requestMeta = { requestId, route, method, operation, status:Number(response.status || 0), durationMs:Date.now() - requestStartedAt };
    attachResponseRequestMeta(response, requestMeta);
    if (!response.ok) emitApiDiagnostic({ source:'api-http', ...requestMeta, responseClass:responseClassForStatus(response.status), errorFingerprint:String(response.headers.get('X-Error-Fingerprint') || '') });
    // A response that started under an older user/page context is never allowed
    // to reach application state, even if HTTP completed successfully. This also
    // protects slow response bodies that finish after logout or account replacement.
    assertAuthRequestGeneration(requestAuthGeneration);
    const sessionContextChanged = response.status === 409 && String(response.headers.get('X-Auth-Session-Context') || '').toLowerCase() === 'changed';
    if (sessionContextChanged) {
      notifyBrowserAuthenticationRejected('AUTH_SESSION_CONTEXT_CHANGED');
    } else if (response.status === 401 && notifyAuthExpired) {
      notifyBrowserAuthenticationRejected('AUTH_REQUIRED');
    }
    const responseAuthGeneration = authRequestGeneration;
    return wrapResponseWithDeadline(response, deadline, method, responseAuthGeneration);
  } catch (error) {
    deadline.cleanup();
    const normalized = normalizeAuthNetworkError(error, authAction);
    normalized.requestId = normalized.requestId || requestId;
    normalized.route = normalized.route || route;
    normalized.method = normalized.method || method;
    normalized.operation = normalized.operation || operation;
    normalized.responseClass = normalized.responseClass || (normalized.code === 'AUTH_REQUEST_TIMEOUT' ? 'REQUEST_TIMEOUT' : 'NETWORK_UNAVAILABLE');
    emitApiDiagnostic({ source:'api-network', error:normalized, code:normalized.code || '', requestId, route, method, operation, status:0, responseClass:normalized.responseClass, durationMs:Date.now() - requestStartedAt });
    throw normalized;
  }
};

const throwAuthError = async (response, fallback) => {
  const payload = await readApiRecord(response, { operation:fallback || 'Authentication request' });
  const error = apiHttpError(response, payload, fallback || 'Authentication request failed.');
  if (response.status === 401) error.authenticationRejected = true;
  throw error;
};

export const loginApi = async ({ username, password }) => {
  assertBrowserAuthContextOwnership();
  const response = await authFetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    timeoutMs:AUTH_REQUEST_TIMEOUTS.login,
    authAction:'login',
    notifyAuthExpired: false
  });
  if (!response.ok) return throwAuthError(response, 'Login failed.');
  const payload = await parsePayload(response, 'Secure sign-in');
  if (!payload.user || payload.authenticated !== true) throw apiHttpError(response, payload, 'Secure sign-in was not confirmed.');
  setCsrfToken(payload.csrfToken || '');
  claimBrowserAuthContext({ state:'authenticated', userId:payload.user?.id || payload.user?.username || '', reason:'login' });
  return payload;
};

export const clearBrowserSessionApi = async () => {
  setCsrfToken('');
  // Opening/reloading a page intentionally becomes the browser's new auth owner
  // before network cleanup. Other tabs therefore stop using stale credentials
  // immediately, even when the connection is slow or the cleanup response is lost.
  claimBrowserAuthContext({ state:'signed-out', reason:'page-boot' });
  const response = await authFetch(`${API_BASE}/api/auth/clear-browser-session`, {
    method: 'POST',
    cache: 'no-store',
    timeoutMs: 8_000,
    authAction:'boot',
    notifyAuthExpired: false,
    skipSessionOwnershipCheck: true
  });
  if (!response.ok) return throwAuthError(response, 'Previous browser session could not be cleared.');
  return parsePayload(response, 'Clear previous browser session');
};

export const getSessionApi = async () => {
  const response = await authFetch(`${API_BASE}/api/auth/session`, { cache:'no-store', timeoutMs:AUTH_REQUEST_TIMEOUTS.boot, authAction:'boot' });
  if (!response.ok) return throwAuthError(response, 'Secure session verification failed.');
  const payload = await parsePayload(response, 'Secure session verification');
  if (!payload.user || payload.authenticated !== true) throw apiHttpError(response, payload, 'Secure session verification was not confirmed.');
  setCsrfToken(payload.csrfToken || '');
  return payload;
};

export const logoutApi = async () => {
  try {
    const response = await authFetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
    if (!response.ok && response.status !== 401 && response.status !== 409) await throwAuthError(response, 'Logout failed.');
  } finally {
    setCsrfToken('');
    claimBrowserAuthContext({ state:'signed-out', reason:'logout' });
  }
  return { ok: true };
};

export const logoutAllApi = async () => {
  const response = await authFetch(`${API_BASE}/api/auth/logout-all`, { method: 'POST' });
  if (!response.ok) return throwAuthError(response, 'Could not sign out other sessions.');
  setCsrfToken('');
  claimBrowserAuthContext({ state:'signed-out', reason:'logout-all' });
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
  claimBrowserAuthContext({ state:'authenticated', userId:payload.user?.id || payload.user?.username || '', reason:'password-change' });
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
