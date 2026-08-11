import crypto from 'crypto';

const clean = (value = '', max = 120) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const integerOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
};
const idLikeSegment = (segment = '') => {
  const value = String(segment || '');
  return /^\d+$/.test(value)
    || /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value)
    || /^[A-Za-z_-]*\d{3,}[A-Za-z0-9_.-]*$/.test(value)
    || /^[A-Za-z0-9_-]{24,}$/.test(value);
};

export function sanitizeOperationalPath(input = '') {
  let pathname = String(input || '').trim();
  try {
    if (/^https?:\/\//i.test(pathname)) pathname = new URL(pathname).pathname;
  } catch {}
  pathname = pathname.split('?')[0].split('#')[0];
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  return pathname.split('/').map(segment => {
    if (!segment) return '';
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch {}
    if (idLikeSegment(decoded)) return ':id';
    return decoded.replace(/[^A-Za-z0-9._~-]/g, '_').slice(0, 48);
  }).join('/').replace(/\/{2,}/g, '/').slice(0, 180);
}

const canonicalErrorText = (error = {}) => {
  const stackLine = String(error?.stack || '').split(/\r?\n/).slice(0, 4).join('|')
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .replace(/[A-Za-z]:\\[^\s)]+/g, '[path]')
    .replace(/\/[^\s):]+(?:\/[^\s):]+)+/g, '[path]')
    .replace(/:\d+(?::\d+)?/g, ':line');
  return [error?.name || 'Error', error?.code || '', error?.message || '', stackLine].join('|').slice(0, 12000);
};

export function serverErrorFingerprint(error = {}, context = {}) {
  const canonical = [
    canonicalErrorText(error),
    clean(context?.method || '', 12).toUpperCase(),
    sanitizeOperationalPath(context?.path || ''),
    clean(context?.code || error?.code || '', 80).toUpperCase()
  ].join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function publicApiErrorPayload({ error = {}, status = 500, fallback = 'The request could not be completed.', requestId = '', extra = {}, fingerprint = '' } = {}) {
  const safeStatus = Number(status || error?.statusCode || error?.status || 500) || 500;
  const code = clean(error?.code || '', 80).toUpperCase();
  const internal = safeStatus >= 500;
  const message = internal ? clean(fallback, 300) : clean(error?.publicMessage || error?.message || fallback, 600);
  return {
    ok:false,
    requestId:clean(requestId, 100),
    code,
    error:message || 'The request could not be completed.',
    ...(internal ? { errorFingerprint:clean(fingerprint, 32).toLowerCase() } : {}),
    ...(extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {})
  };
}

const sanitizeOperation = (value = '') => {
  let text = clean(value, 180);
  text = text.replace(/https?:\/\/[^\s]+/gi, match => sanitizeOperationalPath(match));
  text = text.replace(/\/api\/[^\s]+/gi, match => sanitizeOperationalPath(match));
  text = text.replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, ':id');
  text = text.replace(/\b[A-Za-z_-]*\d{3,}[A-Za-z0-9_.-]*\b/g, ':id');
  text = text.replace(/(['"])[^'"]{3,}\1/g, '[value]');
  return clean(text, 100).replace(/[^A-Za-z0-9 _./:-]/g, '_');
};

const allowedVisibility = new Set(['visible','hidden','prerender','']);
const allowedViewport = new Set(['mobile','tablet','desktop','']);
const allowedAuthState = new Set(['authenticated','signed-out','unknown','']);

export function normalizeClientDiagnostic(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fingerprint = clean(input.fingerprint || '', 32).toLowerCase().replace(/[^a-f0-9]/g, '');
  if (fingerprint.length < 8) {
    const error = new Error('Client diagnostic fingerprint is invalid.');
    error.statusCode = 400;
    error.code = 'CLIENT_DIAGNOSTIC_INVALID';
    throw error;
  }
  const diagnosticId = clean(input.diagnosticId || `KD-${fingerprint.slice(0, 12).toUpperCase()}`, 40).replace(/[^A-Za-z0-9-]/g, '');
  const componentPath = Array.isArray(input.componentPath)
    ? input.componentPath.slice(0, 8).map(item => clean(item, 80).replace(/[^A-Za-z0-9_$.-]/g, '_')).filter(Boolean)
    : [];
  const visibility = clean(input.visibility || '', 16).toLowerCase();
  const viewport = clean(input.viewport || '', 16).toLowerCase();
  const authState = clean(input.authState || '', 24).toLowerCase();
  return {
    schemaVersion:1,
    diagnosticId,
    fingerprint,
    source:clean(input.source || 'runtime', 80).replace(/[^A-Za-z0-9_.:-]/g, '_'),
    errorName:clean(input.errorName || 'Error', 60).replace(/[^A-Za-z0-9_$.-]/g, '_'),
    errorCode:clean(input.errorCode || '', 80).toUpperCase().replace(/[^A-Z0-9_.:-]/g, '_'),
    messageClass:clean(input.messageClass || 'RUNTIME_EXCEPTION', 80).toUpperCase().replace(/[^A-Z0-9_.:-]/g, '_'),
    operation:sanitizeOperation(input.operation || ''),
    route:sanitizeOperationalPath(input.route || ''),
    method:clean(input.method || '', 12).toUpperCase().replace(/[^A-Z]/g, ''),
    relatedRequestId:clean(input.relatedRequestId || '', 100).replace(/[^A-Za-z0-9._:-]/g, ''),
    status:Math.max(0, Math.min(599, Number(input.status || 0) || 0)),
    responseClass:clean(input.responseClass || '', 80).toUpperCase().replace(/[^A-Z0-9_.:-]/g, '_'),
    componentPath,
    stackLocation:clean(input.stackLocation || '', 160).replace(/[?#].*$/, ''),
    appVersion:clean(input.appVersion || '', 80).replace(/[^A-Za-z0-9_.-]/g, '_'),
    stateVersion:integerOrNull(input.stateVersion),
    dataRevision:integerOrNull(input.dataRevision),
    presenceGeneration:integerOrNull(input.presenceGeneration),
    authState:allowedAuthState.has(authState) ? authState : 'unknown',
    authOwned:typeof input.authOwned === 'boolean' ? input.authOwned : null,
    role:clean(input.role || '', 40).replace(/[^A-Za-z0-9 _.-]/g, '_'),
    online:typeof input.online === 'boolean' ? input.online : null,
    visibility:allowedVisibility.has(visibility) ? visibility : '',
    viewport:allowedViewport.has(viewport) ? viewport : '',
    clientAt:(() => {
      const time = Date.parse(String(input.at || ''));
      return Number.isFinite(time) ? new Date(time).toISOString() : '';
    })()
  };
}
