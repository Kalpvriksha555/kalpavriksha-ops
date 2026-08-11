const MAX_COMPONENTS = 8;

const cleanToken = (value = '', max = 120) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

const idLikeSegment = (segment = '') => {
  const value = String(segment || '');
  if (!value) return false;
  if (/^\d+$/.test(value)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value)) return true;
  if (/^[A-Za-z_-]*\d{3,}[A-Za-z0-9_.-]*$/.test(value)) return true;
  if (/^[A-Za-z0-9_-]{24,}$/.test(value)) return true;
  return false;
};

export const sanitizeDiagnosticRoute = (input = '') => {
  let pathname = String(input || '').trim();
  try {
    pathname = new URL(pathname, 'https://kalpa.invalid').pathname;
  } catch {
    pathname = pathname.split('?')[0].split('#')[0];
  }
  const parts = pathname.split('/').map(segment => {
    if (!segment) return '';
    const decoded = (() => { try { return decodeURIComponent(segment); } catch { return segment; } })();
    if (idLikeSegment(decoded)) return ':id';
    return decoded.replace(/[^A-Za-z0-9._~-]/g, '_').slice(0, 48);
  });
  const joined = parts.join('/').replace(/\/{2,}/g, '/');
  return (joined.startsWith('/') ? joined : `/${joined}`).slice(0, 180);
};

export const sanitizeDiagnosticOperation = (value = '') => {
  let text = cleanToken(value, 180);
  text = text.replace(/https?:\/\/[^\s]+/gi, match => sanitizeDiagnosticRoute(match));
  text = text.replace(/\/api\/[^\s]+/gi, match => sanitizeDiagnosticRoute(match));
  text = text.replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, ':id');
  text = text.replace(/\b[A-Za-z_-]*\d{3,}[A-Za-z0-9_.-]*\b/g, ':id');
  text = text.replace(/(['"])[^'"]{3,}\1/g, '[value]');
  return cleanToken(text, 100);
};

export const classifyRuntimeMessage = ({ error, code = '', status = 0, responseClass = '' } = {}) => {
  const explicitCode = cleanToken(code || error?.code || '', 80).toUpperCase();
  if (explicitCode) return explicitCode;
  const cls = cleanToken(responseClass, 80).toUpperCase();
  if (cls) return cls;
  const name = cleanToken(error?.name || '', 80).toUpperCase();
  const message = String(error?.message || error || '').toLowerCase();
  if (name === 'TIMEOUTERROR' || /timed? out|timeout/.test(message)) return 'REQUEST_TIMEOUT';
  if (/failed to fetch|network|offline|connection/.test(message)) return 'NETWORK_UNAVAILABLE';
  if (/is not a function/.test(message)) return 'TYPE_NOT_FUNCTION';
  if (/cannot read (?:properties|property) of (?:undefined|null)/.test(message)) return 'NULLISH_PROPERTY_ACCESS';
  if (/undefined is not an object|object is undefined/.test(message)) return 'UNDEFINED_OBJECT_ACCESS';
  if (/is not iterable/.test(message)) return 'TYPE_NOT_ITERABLE';
  if (/maximum call stack|too much recursion/.test(message)) return 'RECURSION_OVERFLOW';
  if (/out of memory|allocation failed/.test(message)) return 'MEMORY_PRESSURE';
  if (Number(status) >= 500) return 'SERVER_5XX';
  if (Number(status) === 429) return 'RATE_LIMITED';
  if (Number(status) === 401) return 'AUTH_REQUIRED';
  if (Number(status) === 403) return 'FORBIDDEN';
  if (Number(status) === 404) return 'NOT_FOUND';
  if (Number(status) === 409) return 'CONFLICT';
  return name || 'RUNTIME_EXCEPTION';
};

export const extractComponentPath = (componentStack = '') => {
  const names = [];
  const seen = new Set();
  for (const line of String(componentStack || '').split(/\r?\n/)) {
    const match = line.match(/\bat\s+([A-Za-z_$][\w$.-]*)/);
    const name = match?.[1] || '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name.slice(0, 80));
    if (names.length >= MAX_COMPONENTS) break;
  }
  return names;
};

export const extractStackLocation = (stack = '') => {
  for (const line of String(stack || '').split(/\r?\n/).slice(0, 10)) {
    const match = line.match(/(?:https?:\/\/[^\s)]+|\/assets\/[^\s)]+|[A-Za-z0-9_.-]+\.(?:js|jsx|mjs|ts|tsx):\d+(?::\d+)?)/);
    if (!match) continue;
    let location = match[0].replace(/^https?:\/\/[^/]+/i, '');
    location = location.replace(/[?#].*$/, '');
    location = location.replace(/:\d+(?::\d+)?$/, ':line');
    return cleanToken(location, 160);
  }
  return '';
};

const hash32 = (input = '', seed = 0x811c9dc5) => {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

export const buildRuntimeDiagnostic = ({
  error,
  source = 'runtime',
  componentStack = '',
  operation = '',
  route = '',
  method = '',
  requestId = '',
  status = 0,
  responseClass = '',
  errorFingerprint = '',
  context = {},
  appVersion = ''
} = {}) => {
  const safeRoute = sanitizeDiagnosticRoute(route || error?.route || error?.requestUrl || '');
  const messageClass = classifyRuntimeMessage({ error, code:error?.code, status:status || error?.status, responseClass:responseClass || error?.responseClass });
  const errorName = cleanToken(error?.name || 'Error', 60) || 'Error';
  const errorCode = cleanToken(error?.code || '', 80).toUpperCase();
  const componentPath = extractComponentPath(componentStack || error?.componentStack || '');
  const stackLocation = extractStackLocation(error?.stack || '');
  const canonical = [
    cleanToken(source, 80), messageClass, errorName, errorCode,
    sanitizeDiagnosticOperation(operation || error?.operation || ''), safeRoute,
    componentPath.join('>'), stackLocation
  ].join('|').toLowerCase();
  const localFingerprint = `${hash32(canonical)}${hash32(canonical, 0x9e3779b9)}`;
  const fingerprint = cleanToken(errorFingerprint || error?.errorFingerprint || localFingerprint, 64).toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, 32) || localFingerprint;
  const diagnosticId = `KD-${fingerprint.slice(0, 12).toUpperCase()}`;
  const numeric = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : null;
  return {
    schemaVersion:1,
    diagnosticId,
    fingerprint,
    at:new Date().toISOString(),
    source:cleanToken(source, 80) || 'runtime',
    errorName,
    errorCode,
    messageClass,
    operation:sanitizeDiagnosticOperation(operation || error?.operation || ''),
    route:safeRoute,
    method:cleanToken(method || error?.method || '', 12).toUpperCase(),
    relatedRequestId:cleanToken(requestId || error?.requestId || '', 100),
    status:Math.max(0, Math.min(599, Number(status || error?.status || 0) || 0)),
    responseClass:cleanToken(responseClass || error?.responseClass || '', 80).toUpperCase(),
    componentPath,
    stackLocation,
    appVersion:cleanToken(appVersion, 80),
    stateVersion:numeric(context?.stateVersion),
    dataRevision:numeric(context?.dataRevision),
    presenceGeneration:numeric(context?.presenceGeneration),
    authState:cleanToken(context?.authState || '', 32).toLowerCase(),
    authOwned:typeof context?.authOwned === 'boolean' ? context.authOwned : null,
    role:cleanToken(context?.role || '', 40),
    online:typeof context?.online === 'boolean' ? context.online : null,
    visibility:['visible','hidden','prerender'].includes(String(context?.visibility || '')) ? String(context.visibility) : '',
    viewport:cleanToken(context?.viewport || '', 24)
  };
};
