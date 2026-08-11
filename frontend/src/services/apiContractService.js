import { asArray, asRecord } from '../utils/runtimeShapeUtils.js';

export const WORKSPACE_SYNC_COLLECTIONS = Object.freeze([
  'users', 'cases', 'deletedProjectIds', 'teamChat', 'notifications', 'attendanceLogs'
]);

const RESPONSE_FIELD_BY_COLLECTION = Object.freeze({
  users:'users',
  cases:'projects',
  deletedProjectIds:'deletedProjectIds',
  teamChat:'chatMessages',
  notifications:'notifications',
  attendanceLogs:'attendanceLogs'
});

const requestIdFromResponse = (response) => String(response?.headers?.get?.('X-Request-Id') || '').trim();

const requestMetaFromResponse = (response) => response?.__kalpaRequestMeta && typeof response.__kalpaRequestMeta === 'object' ? response.__kalpaRequestMeta : {};
const errorFingerprintFromResponse = (response, payload = {}) => String(response?.headers?.get?.('X-Error-Fingerprint') || payload?.errorFingerprint || '').trim();
const emitApiContractDiagnostic = (detail = {}) => {
  try { globalThis.window?.dispatchEvent?.(new CustomEvent('kalpa-api-contract-diagnostic', { detail })); } catch {}
};

export const makeApiContractError = (code, message, { response, payload, operation = 'API request', cause } = {}) => {
  const error = new Error(message || `${operation} returned an invalid response.`);
  error.name = 'ApiContractError';
  error.code = String(code || 'API_CONTRACT_ERROR');
  error.status = Number(response?.status || 0) || 0;
  const requestMeta = requestMetaFromResponse(response);
  error.requestId = requestIdFromResponse(response) || String(payload?.requestId || requestMeta?.requestId || '').trim();
  error.payload = asRecord(payload);
  error.operation = operation || requestMeta?.operation || '';
  error.route = String(requestMeta?.route || '');
  error.method = String(requestMeta?.method || '');
  error.responseClass = 'API_CONTRACT_ERROR';
  error.errorFingerprint = errorFingerprintFromResponse(response, payload);
  if (cause) error.cause = cause;
  emitApiContractDiagnostic({ source:'api-contract', error, code:error.code, requestId:error.requestId, route:error.route, method:error.method, operation:error.operation, status:error.status, responseClass:error.responseClass, errorFingerprint:error.errorFingerprint });
  return error;
};

export const readApiRecord = async (response, {
  operation = 'API request',
  requireOk = false,
  requiredFields = [],
  allowEmptySuccess = false,
} = {}) => {
  let raw = '';
  try {
    raw = await response.text();
  } catch (cause) {
    throw makeApiContractError('API_RESPONSE_BODY_READ_FAILED', `${operation} response could not be read safely.`, { response, operation, cause });
  }

  if (!String(raw || '').trim()) {
    if (response?.ok && allowEmptySuccess) return {};
    if (response?.ok) throw makeApiContractError('API_EMPTY_SUCCESS_RESPONSE', `${operation} returned an empty success response. Refresh before retrying the action.`, { response, operation });
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    if (!response?.ok) return { error:String(raw).slice(0, 2000) };
    throw makeApiContractError('API_INVALID_JSON_RESPONSE', `${operation} returned malformed JSON instead of a confirmed result. Refresh before retrying the action.`, { response, operation, cause });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (!response?.ok) return {};
    throw makeApiContractError('API_INVALID_ROOT_RESPONSE', `${operation} returned the wrong response structure. Refresh before retrying the action.`, { response, operation });
  }

  const payload = asRecord(parsed);
  if (response?.ok && requireOk && payload.ok !== true) {
    throw makeApiContractError('API_SUCCESS_NOT_CONFIRMED', `${operation} completed with HTTP success but the server did not confirm the operation. Refresh before retrying.`, { response, payload, operation });
  }

  if (response?.ok) {
    for (const field of asArray(requiredFields)) {
      if (!Object.prototype.hasOwnProperty.call(payload, field) || payload[field] === undefined || payload[field] === null) {
        throw makeApiContractError('API_REQUIRED_FIELD_MISSING', `${operation} response is missing required field "${field}". Refresh before retrying.`, { response, payload, operation });
      }
    }
  }
  return payload;
};

export const apiHttpError = (response, payload = {}, fallback = 'Request failed.') => {
  const body = asRecord(payload);
  const error = new Error(body.error || body.message || `${fallback}${response?.status ? ` (${response.status})` : ''}`);
  error.status = Number(response?.status || 0) || 0;
  error.code = String(body.code || '');
  error.payload = body;
  error.retryAfterSeconds = Number(response?.headers?.get?.('Retry-After') || body.retryAfterSeconds || 0);
  const requestMeta = requestMetaFromResponse(response);
  error.requestId = requestIdFromResponse(response) || String(body.requestId || requestMeta?.requestId || '').trim();
  error.route = String(requestMeta?.route || '');
  error.method = String(requestMeta?.method || '');
  error.operation = String(requestMeta?.operation || '');
  error.responseClass = Number(error.status || 0) >= 500 ? 'SERVER_5XX' : Number(error.status || 0) >= 400 ? 'CLIENT_4XX' : '';
  error.errorFingerprint = errorFingerprintFromResponse(response, body);
  return error;
};

const requireNonNegativeIntegerLike = (value, field, payload) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw makeApiContractError('WORKSPACE_SYNC_MARKER_INVALID', `Workspace response has an invalid ${field} marker.`, { payload, operation:'Workspace sync' });
  }
  return number;
};

export const normalizeCollectionRevisions = (value, payload = {}) => {
  const source = asRecord(value);
  const normalized = {};
  for (const collection of WORKSPACE_SYNC_COLLECTIONS) {
    if (!Object.prototype.hasOwnProperty.call(source, collection)) {
      throw makeApiContractError('WORKSPACE_COLLECTION_REVISION_MISSING', `Workspace response is missing the ${collection} revision marker.`, { payload, operation:'Workspace sync' });
    }
    normalized[collection] = requireNonNegativeIntegerLike(source[collection], `collectionRevisions.${collection}`, payload);
  }
  return normalized;
};

export const validateWorkspaceStatePayload = (value) => {
  const payload = asRecord(value);
  if (payload.ok !== true) throw makeApiContractError('WORKSPACE_RESPONSE_UNCONFIRMED', 'The workspace response was not confirmed by the server.', { payload, operation:'Workspace sync' });

  const stateVersion = requireNonNegativeIntegerLike(payload.stateVersion, 'stateVersion', payload);
  const dataRevision = requireNonNegativeIntegerLike(payload.dataRevision, 'dataRevision', payload);
  const presenceGeneration = requireNonNegativeIntegerLike(payload.presenceGeneration, 'presenceGeneration', payload);
  const collectionRevisions = normalizeCollectionRevisions(payload.collectionRevisions, payload);
  const syncToken = String(payload.syncToken || '').trim();
  if (syncToken && syncToken !== `${dataRevision}.${presenceGeneration}`) {
    throw makeApiContractError('WORKSPACE_SYNC_TOKEN_MISMATCH', 'The workspace response contains inconsistent revision markers.', { payload, operation:'Workspace sync' });
  }

  const partial = String(payload.partial || '').trim();
  if (partial && !['presence', 'workspace'].includes(partial)) {
    throw makeApiContractError('WORKSPACE_PARTIAL_KIND_INVALID', `Unknown workspace partial response type: ${partial}.`, { payload, operation:'Workspace sync' });
  }

  if (payload.unchanged === true) {
    if (partial) throw makeApiContractError('WORKSPACE_RESPONSE_CONFLICT', 'Workspace response cannot be both unchanged and partial.', { payload, operation:'Workspace sync' });
  } else if (partial === 'presence') {
    for (const field of ['users', 'attendanceLogs']) {
      if (!Array.isArray(payload[field])) throw makeApiContractError('WORKSPACE_COLLECTION_SHAPE_INVALID', `Presence response field ${field} must be an array.`, { payload, operation:'Workspace sync' });
    }
  } else if (partial === 'workspace') {
    if (!Array.isArray(payload.changedCollections)) throw makeApiContractError('WORKSPACE_CHANGED_COLLECTIONS_INVALID', 'Workspace partial response is missing changedCollections.', { payload, operation:'Workspace sync' });
    const changedCollections = [...new Set(payload.changedCollections.map(value => String(value || '').trim()).filter(Boolean))];
    for (const collection of changedCollections) {
      if (!WORKSPACE_SYNC_COLLECTIONS.includes(collection)) throw makeApiContractError('WORKSPACE_CHANGED_COLLECTION_UNKNOWN', `Workspace partial response named unknown collection ${collection}.`, { payload, operation:'Workspace sync' });
      const field = RESPONSE_FIELD_BY_COLLECTION[collection];
      if (!Array.isArray(payload[field])) throw makeApiContractError('WORKSPACE_COLLECTION_SHAPE_INVALID', `Changed workspace collection ${collection} must include array field ${field}.`, { payload, operation:'Workspace sync' });
    }
    const rowDeltaIds = asRecord(payload.rowDeltaIds);
    for (const [collection, ids] of Object.entries(rowDeltaIds)) {
      if (!WORKSPACE_SYNC_COLLECTIONS.includes(collection) || !Array.isArray(ids)) throw makeApiContractError('WORKSPACE_ROW_DELTA_INVALID', `Workspace row delta for ${collection} is invalid.`, { payload, operation:'Workspace sync' });
    }
    payload.changedCollections = changedCollections;
  } else {
    for (const field of ['users', 'projects', 'deletedProjectIds', 'chatMessages', 'notifications', 'attendanceLogs']) {
      if (!Array.isArray(payload[field])) throw makeApiContractError('WORKSPACE_COLLECTION_SHAPE_INVALID', `Full workspace response field ${field} must be an array.`, { payload, operation:'Workspace sync' });
    }
  }

  return { ...payload, stateVersion, dataRevision, presenceGeneration, collectionRevisions, syncToken:syncToken || `${dataRevision}.${presenceGeneration}` };
};
