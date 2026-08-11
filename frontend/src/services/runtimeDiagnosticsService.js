import { API_BASE } from '../config/appConfig.js';
import { browserAuthContextOwnedByThisPage, getBrowserAuthContext, getCsrfToken } from './authService.js';
import { buildRuntimeDiagnostic } from '../utils/runtimeDiagnosticsUtils.js';

export const CLIENT_RUNTIME_DIAGNOSTIC_EVENT = 'kalpa-api-diagnostic';
export const CLIENT_API_CONTRACT_DIAGNOSTIC_EVENT = 'kalpa-api-contract-diagnostic';
const CLIENT_RUNTIME_ERROR_LOG_KEY = 'kalpa_client_runtime_errors_v3';
const CLIENT_RUNTIME_ERROR_LOG_LIMIT = 30;
const SERVER_REPORT_DEDUPE_MS = 30_000;
const APP_VERSION = '2.9.30-ssh-independent-certify-deploy-closure';
let contextProvider = null;
const reportedRecently = new Map();

const readStoredDiagnostics = () => {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem?.(CLIENT_RUNTIME_ERROR_LOG_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const baseContext = () => {
  const auth = (() => { try { return getBrowserAuthContext(); } catch { return null; } })();
  const width = Number(globalThis.innerWidth || 0);
  let provided = {};
  try { provided = typeof contextProvider === 'function' ? (contextProvider() || {}) : {}; } catch { provided = {}; }
  return {
    ...provided,
    authState:String(auth?.state || provided?.authState || 'unknown'),
    authOwned:(() => { try { return browserAuthContextOwnedByThisPage(); } catch { return null; } })(),
    online:typeof globalThis.navigator?.onLine === 'boolean' ? globalThis.navigator.onLine : null,
    visibility:String(globalThis.document?.visibilityState || ''),
    viewport:width > 0 && width < 640 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop'
  };
};

export const setRuntimeDiagnosticContextProvider = (provider) => {
  contextProvider = typeof provider === 'function' ? provider : null;
  return () => { if (contextProvider === provider) contextProvider = null; };
};

const trimRecentReports = (now = Date.now()) => {
  if (reportedRecently.size < 80) return;
  for (const [key, at] of reportedRecently.entries()) if (now - at > SERVER_REPORT_DEDUPE_MS) reportedRecently.delete(key);
};

const reportDiagnostic = async (diagnostic) => {
  const csrf = (() => { try { return getCsrfToken(); } catch { return ''; } })();
  if (!csrf || diagnostic?.authState !== 'authenticated' || diagnostic?.authOwned === false) return false;
  const now = Date.now();
  trimRecentReports(now);
  const dedupeKey = `${diagnostic.fingerprint}|${diagnostic.relatedRequestId || ''}`;
  if (now - Number(reportedRecently.get(dedupeKey) || 0) < SERVER_REPORT_DEDUPE_MS) return false;
  reportedRecently.set(dedupeKey, now);

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
  try {
    const requestId = globalThis.crypto?.randomUUID?.() || `diag-${now}-${Math.random().toString(36).slice(2)}`;
    const response = await fetch(`${API_BASE}/api/client-diagnostics`, {
      method:'POST',
      credentials:'include',
      cache:'no-store',
      headers:{ 'Content-Type':'application/json', 'X-CSRF-Token':csrf, 'X-Request-Id':requestId },
      body:JSON.stringify(diagnostic),
      signal:controller?.signal
    });
    return response.ok;
  } catch { return false; }
  finally { if (timer) clearTimeout(timer); }
};

export const recordRuntimeDiagnostic = ({ error, source = 'runtime', componentStack = '', operation = '', route = '', method = '', requestId = '', status = 0, responseClass = '', errorFingerprint = '' } = {}) => {
  const diagnostic = buildRuntimeDiagnostic({
    error, source, componentStack, operation, route, method, requestId, status, responseClass, errorFingerprint,
    context:baseContext(), appVersion:APP_VERSION
  });
  try {
    const previous = readStoredDiagnostics();
    const next = [diagnostic, ...previous.filter(item => item?.diagnosticId !== diagnostic.diagnosticId || item?.relatedRequestId !== diagnostic.relatedRequestId)].slice(0, CLIENT_RUNTIME_ERROR_LOG_LIMIT);
    globalThis.localStorage?.setItem?.(CLIENT_RUNTIME_ERROR_LOG_KEY, JSON.stringify(next));
  } catch {}
  queueMicrotask(() => { reportDiagnostic(diagnostic).catch(() => {}); });
  return diagnostic;
};

export const recordApiDiagnosticEvent = (event) => {
  const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {};
  const error = detail.error instanceof Error ? detail.error : Object.assign(new Error(detail.message || detail.responseClass || 'API request failed.'), {
    code:detail.code || '', status:detail.status || 0, requestId:detail.requestId || '', route:detail.route || '', method:detail.method || '', responseClass:detail.responseClass || '', errorFingerprint:detail.errorFingerprint || ''
  });
  return recordRuntimeDiagnostic({
    error,
    source:String(detail.source || 'api-request'),
    operation:detail.operation || '',
    route:detail.route || '',
    method:detail.method || '',
    requestId:detail.requestId || '',
    status:detail.status || 0,
    responseClass:detail.responseClass || '',
    errorFingerprint:detail.errorFingerprint || ''
  });
};

export const getRecentRuntimeDiagnostics = () => readStoredDiagnostics();
