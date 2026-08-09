import { authFetch, getCsrfToken } from './authService';
import { API_BASE } from '../config/appConfig';

export const MAX_PROJECT_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_PROJECT_UPLOAD_FILES = 20;
const PROJECT_UPLOAD_KINDS = new Set(['pdf', 'image', 'video', 'audio', 'text', 'office', 'cad', 'archive']);
const PAYMENT_RECEIPT_KINDS = Object.freeze(['pdf', 'image']);
const LEGACY_UPLOAD_MUTATION_STORAGE_KEY = 'kalpavriksha_upload_mutations_v2';
const UPLOAD_MUTATION_STORAGE_KEYS = Object.freeze(['kalpavriksha_upload_mutations_v3_a', 'kalpavriksha_upload_mutations_v3_b']);
const UPLOAD_MUTATION_MAX_RECORDS = 500;
const UPLOAD_MUTATION_LOCK_KEY = 'kalpavriksha-upload-mutation-ledger-v3';
const UPLOAD_IDENTITY_LOCK_TIMEOUT = 5000;
let uploadMutationLedgerCache = null;
const uploadMutationIds = new WeakMap();

const appendUploadMutationId = (form, mutation, mutationId) => {
  // Keep the durable ledger identity authoritative. The explicit mutation.id path
  // also documents the normal case, while the fallback preserves a verified alias.
  if (mutationId === mutation.id) form.append('mutationId', mutation.id);
  else form.append('mutationId', mutationId);
};

const makeFileError = (code, message) => Object.assign(new Error(message), { code });
const fileExtension = (name = '') => String(name).split('.').pop()?.toLowerCase() || '';
const kindFromFile = (file = {}) => {
  const extension = fileExtension(file?.name);
  const mime = String(file?.type || '').toLowerCase();
  if (extension === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (/^(png|jpe?g|gif|webp|bmp)$/.test(extension) || mime.startsWith('image/')) return 'image';
  if (/^(mp4|webm|mov|m4v)$/.test(extension) || mime.startsWith('video/')) return 'video';
  if (/^(mp3|wav|m4a|ogg|aac|flac)$/.test(extension) || (extension === 'webm' && /(voice|audio)/.test(String(file?.name || '').toLowerCase())) || mime.startsWith('audio/')) return 'audio';
  if (/^(txt|csv|json|xml|md|log)$/.test(extension) || mime.startsWith('text/')) return 'text';
  if (/^(docx?|xlsx?|pptx?|odt|ods|odp)$/.test(extension)) return 'office';
  if (/^(dwg|dxf|dgn)$/.test(extension)) return 'cad';
  if (/^(zip|rar|7z)$/.test(extension)) return 'archive';
  return 'file';
};

export const validateProjectUploadSelection = (files, options = {}) => {
  options = options && typeof options === 'object' ? options : {};
  const list = Array.from(files || []);
  const maxFiles = Math.max(1, Number(options?.maxFiles || MAX_PROJECT_UPLOAD_FILES));
  if (list.length > maxFiles) throw makeFileError('TOO_MANY_FILES', `Choose no more than ${maxFiles} files at once.`);
  const allowedKinds = new Set(options?.allowedKinds || PROJECT_UPLOAD_KINDS);
  const seen = new Set();
  for (const file of list) {
    if (!Number(file?.size || 0)) throw makeFileError('FILE_EMPTY', `The selected file ${file?.name || ''} is empty.`);
    if (Number(file.size) > MAX_PROJECT_UPLOAD_BYTES) throw makeFileError('FILE_TOO_LARGE', `${file.name} is larger than 100 MB.`);
    const kind = kindFromFile(file);
    if (!allowedKinds.has(kind)) throw makeFileError('FILE_TYPE_NOT_ALLOWED', `${file.name} is not an allowed file type.`);
    const duplicateKey = `${String(file.name || '').toLowerCase()}::${file.size}::${file.lastModified || 0}`;
    if (seen.has(duplicateKey)) throw makeFileError('DUPLICATE_FILE', `${file.name} was selected more than once.`);
    seen.add(duplicateKey);
  }
  return list;
};

const uploadFingerprint = (file, projectId = '', type = '', uploadedBy = '', scope = '') => [
  String(projectId), String(type), String(scope), String(uploadedBy).trim().toLowerCase(),
  String(file?.name || '').trim().toLowerCase(), Number(file?.size || 0), Number(file?.lastModified || 0), String(file?.type || '').toLowerCase()
].join('|');

const readUploadMutationLedger = () => {
  if (uploadMutationLedgerCache) return uploadMutationLedgerCache;
  let selected = { generation: 0, records: {} };
  try {
    for (const key of UPLOAD_MUTATION_STORAGE_KEYS) {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      if (parsed?.schemaVersion === 3 && Number(parsed.generation || 0) >= selected.generation) selected = parsed;
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_UPLOAD_MUTATION_STORAGE_KEY) || '{}');
    if (!Object.keys(selected.records || {}).length && legacy && typeof legacy === 'object') selected.records = legacy;
  } catch {}
  uploadMutationLedgerCache = selected;
  return selected;
};

const writeUploadMutationLedger = (records) => {
  if (typeof localStorage === 'undefined') return false;
  const current = readUploadMutationLedger();
  const envelope = { schemaVersion: 3, generation: Number(current.generation || 0) + 1, writtenAt: Date.now(), records };
  const raw = JSON.stringify(envelope);
  let copies = 0;
  for (const key of UPLOAD_MUTATION_STORAGE_KEYS) {
    try { localStorage.setItem(key, raw); copies += 1; } catch {}
  }
  if (!copies) return false;
  uploadMutationLedgerCache = envelope;
  return true;
};

const createUploadMutation = (fingerprint, alternateFingerprints = []) => {
  const current = readUploadMutationLedger();
  const records = { ...(current.records || {}) };
  const existingKey = [fingerprint, ...alternateFingerprints].find(key => records[key]?.id);
  if (existingKey) return { ...records[existingKey], fingerprint: existingKey, durable: true };
  const now = Date.now();
  const next = Object.fromEntries(Object.entries(records).filter(([, value]) => now - Number(value?.createdAt || 0) < 7 * 86400000));
  if (Object.keys(next).length >= UPLOAD_MUTATION_MAX_RECORDS) throw makeFileError('UPLOAD_IDENTITY_CAPACITY_REACHED', 'The durable upload identity queue is full. Please finish or clear older uploads.');
  const id = `upload:${globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`}`;
  next[fingerprint] = { id, fingerprint, createdAt: now };
  const durable = writeUploadMutationLedger(next);
  return { ...next[fingerprint], durable };
};

const withUploadMutationLock = async (action) => {
  if (globalThis.navigator?.locks?.request) return navigator.locks.request(UPLOAD_MUTATION_LOCK_KEY, action);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + UPLOAD_IDENTITY_LOCK_TIMEOUT;
  while (Date.now() < deadline) {
    try {
      const existing = JSON.parse(localStorage.getItem(UPLOAD_MUTATION_LOCK_KEY) || 'null');
      if (!existing || Number(existing.expiresAt || 0) < Date.now()) {
        localStorage.setItem(UPLOAD_MUTATION_LOCK_KEY, JSON.stringify({ token, expiresAt: Date.now() + UPLOAD_IDENTITY_LOCK_TIMEOUT }));
        const verified = JSON.parse(localStorage.getItem(UPLOAD_MUTATION_LOCK_KEY) || 'null');
        if (verified?.token === token) {
          try { return await action(); } finally {
            const latest = JSON.parse(localStorage.getItem(UPLOAD_MUTATION_LOCK_KEY) || 'null');
            if (latest?.token === token) localStorage.removeItem(UPLOAD_MUTATION_LOCK_KEY);
          }
        }
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw makeFileError('UPLOAD_IDENTITY_STORAGE_UNAVAILABLE', 'Could not safely reserve a durable upload identity across browser tabs.');
};

const clearUploadMutation = (fingerprint) => {
  const current = readUploadMutationLedger();
  const next = { ...(current.records || {}) };
  delete next[fingerprint];
  writeUploadMutationLedger(next);
};

try { globalThis.addEventListener?.('storage', event => { if (UPLOAD_MUTATION_STORAGE_KEYS.includes(event.key)) uploadMutationLedgerCache = null; }); } catch {}

export const absoluteApiUrl = (url = '', version = '') => {
  let value = String(url || '').trim();
  if (!value) return '';
  if (/^(blob:|data:|https?:)/i.test(value)) return value;
  if (value.startsWith('/uploads/')) value = value.replace('/uploads/', '/api/uploads/');
  if (value.startsWith('uploads/')) value = value.replace('uploads/', '/api/uploads/');
  const full = value.startsWith('/') ? `${API_BASE}${value}` : `${API_BASE}/${value.replace(/^\/+/, '')}`;
  return version ? `${full}${full.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}` : full;
};

export const isTrustedNetworkUrl = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/^(blob:|data:)/i.test(raw)) return true;
  try {
    const base = API_BASE || globalThis.location?.origin || 'http://localhost';
    const parsed = new URL(raw, base);
    const apiOrigin = new URL(base, globalThis.location?.origin || 'http://localhost').origin;
    const pageOrigin = globalThis.location?.origin || apiOrigin;
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? (parsed.origin === apiOrigin || parsed.origin === pageOrigin) : false;
  } catch { return false; }
};

export const isAllowedPrivateFileUrl = (value = '') => {
  if (!isTrustedNetworkUrl(value)) return false;
  if (/^(blob:|data:)/i.test(String(value))) return true;
  try {
    const parsed = new URL(value, API_BASE || globalThis.location?.origin || 'http://localhost');
    const fileMatch = parsed.pathname.match(/^\/api\/files\/([^/]+)(?:\/(?:download|preview|preview-data))?\/?$/i);
    const legacyMatch = parsed.pathname.match(/^\/(?:api\/)?uploads\/([^/]+)\/?$/i);
    return Boolean(fileMatch || legacyMatch);
  } catch { return false; }
};


const getProjectFileName = (doc = {}) => String(doc?.name || doc?.fileName || doc?.filename || '').trim();
const getProjectFileMime = (doc = {}) => String(doc?.mime || doc?.mimeType || doc?.contentType || doc?.type || '').toLowerCase();

export const isProjectFilePdf = (doc = {}) => {
  const name = getProjectFileName(doc).toLowerCase();
  const mime = getProjectFileMime(doc);
  return name.endsWith('.pdf') || mime.includes('pdf');
};

export const isProjectFileImage = (doc = {}) => {
  const name = getProjectFileName(doc).toLowerCase();
  const mime = getProjectFileMime(doc);
  return mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name);
};

export const getProjectFileKind = (doc = {}) => {
  if (isProjectFilePdf(doc)) return 'pdf';
  if (isProjectFileImage(doc)) return 'image';
  const extension = getProjectFileName(doc).split('.').pop()?.toLowerCase();
  const mime = getProjectFileMime(doc);
  if (extension === 'webm' && /(voice|audio)/.test(getProjectFileName(doc).toLowerCase())) return 'audio';
  if (/^(mp4|webm|mov|m4v|avi|mkv)$/.test(extension) || mime.startsWith('video/')) return 'video';
  if (/^(mp3|wav|m4a|ogg|aac|flac)$/.test(extension) || mime.startsWith('audio/')) return 'audio';
  if (/^(txt|csv|json|xml|md|log)$/.test(extension) || mime.startsWith('text/')) return 'text';
  if (/^(docx?|xlsx?|pptx?|odt|ods|odp)$/.test(extension)) return 'office';
  if (/^(dwg|dxf|dgn)$/.test(extension)) return 'cad';
  return 'file';
};

const normalizePreviewUrl = (url = '') => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^(blob:|data:)/i.test(raw)) return raw;
  if (!isTrustedNetworkUrl(raw)) return '';
  const absolute = absoluteApiUrl(raw);
  if (!isAllowedPrivateFileUrl(absolute)) return '';

  // Never use a forced-download endpoint for preview. Some file cards have
  // only downloadUrl/url saved, so convert it to an inline preview endpoint.
  if (/\/api\/files\/[^/?#]+\/download(?:$|[?#])/i.test(absolute)) {
    return absolute.replace(/\/download(?=($|[?#]))/i, '/preview');
  }
  if (/\/api\/files\/[^/?#]+(?:$|[?#])/i.test(absolute)) {
    const [base, hashPart = ''] = absolute.split('#');
    const separator = base.includes('?') ? '&' : '?';
    const cleaned = base
      .replace(/([?&])mode=download(&|$)/i, '$1')
      .replace(/[?&]$/, '');
    return `${cleaned}${cleaned.includes('?') ? '&' : '?'}mode=preview${hashPart ? `#${hashPart}` : ''}`;
  }
  if (/\/api\/uploads\/[^/?#]+(?:$|[?#])/i.test(absolute)) {
    const [base, hashPart = ''] = absolute.split('#');
    const cleaned = base
      .replace(/([?&])mode=download(&|$)/i, '$1')
      .replace(/[?&]$/, '');
    return `${cleaned}${cleaned.includes('?') ? '&' : '?'}mode=preview${hashPart ? `#${hashPart}` : ''}`;
  }
  return absolute;
};



const getPreviewDataUrl = (doc = {}) => {
  const previewUrl = getProjectFilePreviewUrl(doc);
  if (!previewUrl) return '';
  if (/^(blob:|data:)/i.test(previewUrl)) return previewUrl;
  if (/\/api\/files\/[^/?#]+\/preview(?:$|[?#])/i.test(previewUrl)) {
    return previewUrl.replace(/\/preview(?=($|[?#]))/i, '/preview-data');
  }
  const match = previewUrl.match(/\/api\/files\/([^/?#]+)/i);
  if (match && match[1]) return `${API_BASE}/api/files/${encodeURIComponent(decodeURIComponent(match[1]))}/preview-data`;
  return previewUrl;
};

const dataUrlToBlob = (dataUrl = '', fallbackType = 'application/octet-stream') => {
  const MAX_INLINE_DATA_URL_BYTES = 15 * 1024 * 1024;
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mime = match[1] || fallbackType;
  const isBase64 = Boolean(match[2]);
  const body = match[3] || '';
  const estimatedBytes = isBase64 ? Math.floor((body.length * 3) / 4) : body.length;
  if (estimatedBytes > MAX_INLINE_DATA_URL_BYTES) throw makeFileError('INLINE_PREVIEW_TOO_LARGE', 'This legacy inline preview is too large to decode safely. Download the file instead.');
  if (isBase64) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
};

const MAX_INLINE_DATA_URL_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
export const canPreviewProjectFile = (doc = {}) => Boolean(getProjectFilePreviewUrl(doc));

export const fetchProjectFilePreview = async (doc = {}, options = {}) => {
  doc = doc && typeof doc === 'object' ? doc : {};
  options = options && typeof options === 'object' ? options : {};
  const kind = getProjectFileKind(doc);
  const sourceUrl = getProjectFilePreviewUrl(doc);
  if (!sourceUrl) throw new Error('Preview link is not available for this file.');
  const signal = options?.signal;
  if (/^blob:/i.test(sourceUrl)) return { kind, url: sourceUrl, sourceUrl, mimeType: getProjectFileMime(doc), size: Number(doc?.size || 0), directStream: true };
  if (/^data:/i.test(sourceUrl)) {
    const blob = dataUrlToBlob(sourceUrl, getProjectFileMime(doc));
    if (!blob?.size) throw new Error('Preview file is empty.');
    const url = URL.createObjectURL(blob);
    return { kind, url, objectUrl:url, sourceUrl, mimeType:blob.type, size:blob.size };
  }

  // PDFs are already served by the authenticated private preview endpoint and
  // the browser PDF renderer can start streaming them immediately.  Do not put
  // a blocking HEAD round-trip in front of the iframe: that made every PDF
  // preview wait for one full authenticated request before the real range/GET
  // request could even begin.  Metadata from the saved record is sufficient for
  // the initial viewer shell; the server remains authoritative when the iframe
  // opens the URL.
  if (kind === 'pdf') {
    return {
      kind,
      url: sourceUrl,
      sourceUrl,
      mimeType: getProjectFileMime(doc) || 'application/pdf',
      size: Number(doc?.size || 0),
      directStream: true,
      optimisticStream: true
    };
  }

  if (['image', 'video', 'audio'].includes(kind)) {
    const head = await authFetch(sourceUrl, { method: 'HEAD', cache: 'no-store', timeoutMs:FILE_PREVIEW_TIMEOUT_MS, signal });
    if (!head.ok) throw new Error(await readServerMessage(head));
    return {
      kind,
      url: sourceUrl,
      sourceUrl,
      mimeType: head.headers.get('content-type') || getProjectFileMime(doc),
      size: Number(head.headers.get('content-length') || doc?.size || 0),
      directStream: true
    };
  }

  if (kind !== 'text') return { kind, url:'', sourceUrl, mimeType:getProjectFileMime(doc), size:Number(doc?.size || 0), metadataOnly:true, name:getProjectFileName(doc) };
  const previewReadLimits = { maxBytes: kind === 'text' ? MAX_TEXT_PREVIEW_BYTES : 0 };
  const maxBytes = previewReadLimits.maxBytes;
  const response = await authFetch(sourceUrl, { method:'GET', cache:'no-store', timeoutMs:FILE_PREVIEW_TIMEOUT_MS, signal });
  if (!response.ok) throw new Error(await readServerMessage(response));
  const reader = response.body?.getReader?.();
  if (!reader) {
    const blob = await response.blob();
    if (blob.size > maxBytes) throw makeFileError('TEXT_PREVIEW_TOO_LARGE', 'Text preview is larger than 2 MB. Download it instead.');
    return { kind, text:await blob.text(), sourceUrl, mimeType:blob.type, size:blob.size };
  }
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value?.byteLength || 0;
    if (loaded > maxBytes) {
      await reader.cancel();
      throw makeFileError('TEXT_PREVIEW_TOO_LARGE', 'Text preview is larger than 2 MB. Download it instead.');
    }
    if (value) chunks.push(value);
  }
  const blob = new Blob(chunks, { type:response.headers.get('content-type') || 'text/plain' });
  return { kind, text:await blob.text(), sourceUrl, mimeType:blob.type, size:blob.size };
};

export const releaseProjectFilePreview = (preview = {}) => {
  const objectUrl = preview?.objectUrl;
  if (objectUrl && String(objectUrl).startsWith('blob:')) URL.revokeObjectURL(objectUrl);
};

export const getProjectFileDownloadUrl = (doc = {}) => {
  if (!doc) return '';
  const sanitizePrivateFileUrl = (value = '') => {
    if (!isTrustedNetworkUrl(value)) return '';
    const absolute = absoluteApiUrl(value);
    return isAllowedPrivateFileUrl(absolute) ? absolute : '';
  };
  if (doc?.downloadUrl) {
    const trusted = sanitizePrivateFileUrl(doc?.downloadUrl);
    if (trusted) return trusted;
  }

  // Prefer the saved URL before guessing from the id. Some older browser-only
  // records used Date.now()+Math.random() as an id; forcing those ids through
  // /api/files/:id/download caused false "missing file" errors on mobile/desktop.
  if (doc?.url) {
    const trusted = sanitizePrivateFileUrl(doc?.url);
    if (trusted) return trusted;
  }

  const authoritativeFileId = String(doc?.fileId || doc?.id || '').trim();
  const looksLikeServerFileId = /^[A-Za-z0-9_-]{6,80}$/.test(authoritativeFileId) && !/^\d+(\.\d+)?$/.test(authoritativeFileId);
  return looksLikeServerFileId ? `${API_BASE}/api/files/${encodeURIComponent(authoritativeFileId)}/download` : '';
};

export const normalizeProjectFileRecord = (doc = {}) => {
  doc = doc && typeof doc === 'object' ? doc : {};
  const id = String(doc?.fileId || doc?.id || '').trim();
  const name = String(doc?.name || doc?.fileName || doc?.filename || doc?.originalName || doc?.storedName || 'file').trim();
  const mimeType = String(doc?.mimeType || doc?.mime || doc?.contentType || '').trim();
  const normalized = {
    ...doc,
    id: doc?.id || doc?.fileId || id || undefined,
    fileId: doc?.fileId || doc?.id || id || undefined,
    name,
    fileName: doc?.fileName || name,
    mimeType,
    mime: doc?.mime || mimeType,
  };
  const downloadUrl = getProjectFileDownloadUrl(normalized);
  const previewUrl = getProjectFilePreviewUrl(normalized);
  if (downloadUrl) normalized.downloadUrl = downloadUrl;
  if (previewUrl) normalized.previewUrl = previewUrl;
  return normalized;
};

export const hasProjectFileAccess = (doc = {}) => Boolean(getProjectFileDownloadUrl(doc) || getProjectFilePreviewUrl(doc));

export const getProjectFileActionState = (doc = {}) => {
  const normalized = normalizeProjectFileRecord(doc);
  const downloadUrl = getProjectFileDownloadUrl(normalized);
  const previewUrl = getProjectFilePreviewUrl(normalized);
  return {
    doc: normalized,
    hasLink: Boolean(downloadUrl || previewUrl),
    canPreview: canPreviewProjectFile(normalized),
    canDownload: Boolean(downloadUrl),
    downloadUrl,
    previewUrl,
  };
};


export const getProjectFilePreviewUrl = (doc = {}) => {
  if (!doc) return '';

  if (doc?.previewUrl) return normalizePreviewUrl(doc?.previewUrl);

  const id = String(doc?.fileId || doc?.id || '').trim();
  const looksLikeServerFileId = /^[A-Za-z0-9_-]{6,40}$/.test(id) && !/^\d+(\.\d+)?$/.test(id);
  if (looksLikeServerFileId) return `${API_BASE}/api/files/${encodeURIComponent(id)}?mode=preview`;

  const downloadUrl = getProjectFileDownloadUrl(doc);
  if (downloadUrl) return normalizePreviewUrl(downloadUrl);

  const url = String(doc?.url || '').trim();
  if (url) return normalizePreviewUrl(url);

  return '';
};


const readServerMessage = async (res) => {
  const raw = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(raw);
    return parsed.error || parsed.message || raw || `Request failed (${res.status})`;
  } catch {
    return raw || `Request failed (${res.status})`;
  }
};

const UPLOAD_RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;
const FILE_PREVIEW_TIMEOUT_MS = 5 * 60 * 1000;
const FILE_DOWNLOAD_TIMEOUT_MS = 35 * 60 * 1000;

const uploadWithXhr = (url, form, onProgress, signal) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  let settled = false;
  let responseTimer = null;
  const finish = (handler, value) => {
    if (settled) return;
    settled = true;
    if (responseTimer) clearTimeout(responseTimer);
    handler(value);
  };

  xhr.open('POST', url, true);
  xhr.withCredentials = true;
  const csrfToken = getCsrfToken();
  if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
  xhr.timeout = 30 * 60 * 1000; // allow large PDFs/DWGs on slow mobile data

  const startedAt = Date.now();
  xhr.upload.onprogress = (event) => {
    if (typeof onProgress === 'function') {
      const loaded = Number(event.loaded || 0);
      const total = Number(event.total || 0);
      const percent = event.lengthComputable && total > 0 ? Math.round((loaded / total) * 100) : 0;
      const elapsedSeconds = Math.max(0.5, (Date.now() - startedAt) / 1000);
      const speedBps = loaded > 0 ? loaded / elapsedSeconds : 0;
      const remainingBytes = total > loaded ? total - loaded : 0;
      const etaSeconds = speedBps > 0 && remainingBytes > 0 ? Math.ceil(remainingBytes / speedBps) : 0;
      onProgress({ percent, loaded, total, speedBps, etaSeconds });
    }
  };
  xhr.upload.onload = () => {
    if (typeof onProgress === 'function') onProgress({ percent:100, speedBps:0, etaSeconds:0, processing:true });
    responseTimer = setTimeout(() => {
      finish(reject, new Error('The file reached the server, but processing took too long. Please refresh before trying again.'));
      try { xhr.abort(); } catch {}
    }, UPLOAD_RESPONSE_TIMEOUT_MS);
  };

  xhr.onload = () => {
    const raw = xhr.responseText || '';
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
    if (xhr.status >= 200 && xhr.status < 300) return finish(resolve, payload || {});
    const error = makeFileError(payload?.code || `UPLOAD_HTTP_${xhr.status}`, payload?.error || payload?.message || raw || `Upload failed (${xhr.status})`);
    error.status = xhr.status;
    error.payload = payload;
    finish(reject, error);
  };
  xhr.onerror = () => finish(reject, new Error('Upload failed. Please check internet connection and try again.'));
  xhr.ontimeout = () => finish(reject, new Error('Upload timed out. Please try again on a stable connection.'));
  xhr.onabort = () => finish(reject, makeFileError('UPLOAD_CANCELLED', 'Upload was cancelled before the server confirmed it.'));
  signal?.addEventListener?.('abort', () => {
    try { xhr.abort(); } catch {}
  }, { once:true });
  xhr.send(form);
});

export const uploadProjectFile = async (file, projectId, type, uploadedBy, onProgress, options = {}) => {
  options = options && typeof options === 'object' ? options : {};
  if (onProgress && typeof onProgress === 'object') {
    options = onProgress;
    onProgress = options?.onProgress;
  }
  const normalizedType = String(type || 'source').trim().toLowerCase();
  validateProjectUploadSelection([file], normalizedType === 'payment-receipt' ? { allowedKinds: PAYMENT_RECEIPT_KINDS } : {});
  const baseDoc = {
    id: Date.now() + Math.random(),
    name: file.name,
    type,
    date: new Date().toLocaleDateString(),
    uploadedBy,
    size: file.size || 0,
    mimeType: file.type || 'application/octet-stream'
  };

  const actorIdentity = options?.actorId || options?.actorUsername || uploadedBy;
  const scopeParts = [options?.chatScope, options?.recipientId, options?.recipientUsername, options?.recipient, options?.isVoiceNote ? 'voice-note' : ''].filter(Boolean);
  const scope = scopeParts.join(':');
  const fingerprint = uploadFingerprint(file, projectId, normalizedType, actorIdentity, scope);
  const alternateFingerprints = [options?.actorUsername, uploadedBy]
    .filter(Boolean)
    .map(actor => uploadFingerprint(file, projectId, normalizedType, actor, scope));
  const mutation = await withUploadMutationLock(() => createUploadMutation(fingerprint, alternateFingerprints));
  if (!mutation.durable) throw makeFileError('UPLOAD_IDENTITY_STORAGE_UNAVAILABLE', 'Upload recovery identity could not be stored durably. The file was not sent.');
  const mutationId = uploadMutationIds.get(file) || mutation.id;
  uploadMutationIds.set(file, mutationId);
  const form = new FormData();
  form.append('file', file);
  form.append('projectId', projectId || '');
  form.append('type', normalizedType);
  appendUploadMutationId(form, mutation, mutationId);
  if (options?.taskMutationId) form.append('taskMutationId', String(options.taskMutationId));
  if (normalizedType === 'chat') {
    if (options?.chatScope) form.append('chatScope', String(options?.chatScope));
    if (options?.recipientId) form.append('recipientId', String(options?.recipientId));
    if (options?.recipientUsername) form.append('recipientUsername', String(options?.recipientUsername));
    if (options?.recipient) form.append('recipient', String(options?.recipient));
    if (options?.isVoiceNote) form.append('isVoiceNote', 'true');
  }

  try {
    const payload = await uploadWithXhr(`${API_BASE}/api/files/upload`, form, onProgress, options?.signal);
    const authoritativeFileId = String(payload?.file?.id || payload?.file?.fileId || '').trim();
    if (payload?.ok !== true || !authoritativeFileId) throw makeFileError('UPLOAD_RESPONSE_UNCONFIRMED', 'The server response did not confirm a durable uploaded file. Refresh before retrying.');
    uploadMutationIds.delete(file);
    clearUploadMutation(mutation.fingerprint);
    return {
      ...baseDoc,
      ...payload.file,
      type: normalizedType,
      folder: normalizedType,
      uploadedBy,
      date: new Date().toLocaleDateString(),
      url: payload.file?.url || payload.file?.downloadUrl || '',
      previewUrl: payload.file?.previewUrl || (payload.file?.id ? `/api/files/${payload.file.id}/preview` : ''),
      downloadUrl: payload.file?.downloadUrl || (payload.file?.id ? `/api/files/${payload.file.id}/download` : ''),
      _serverCase: payload.case || payload.project || null,
      _persistence: payload.persistence || null
    };
  } catch (error) {
    console.error('Backend file upload failed:', error);
    throw error;
  }
};



const FILE_CACHE_DB_NAME = 'kalpavriksha-file-cache-v1';
const FILE_CACHE_STORE = 'files';
const LEGACY_FILE_CACHE_INDEX_KEY = 'kalpavriksha_downloaded_file_index_v2';
const FILE_CACHE_INDEX_KEY = 'kalpavriksha_downloaded_file_index_v3';
const FILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const nowMs = () => Date.now();
let activeFileCacheActor = 'signed-out';

const hashResourceIdentity = (value = '') => {
  let hash = 0xcbf29ce484222325n;
  for (const char of String(value)) {
    hash ^= BigInt(char.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36);
};

export const setProjectFileCacheActor = (actor = {}) => {
  const nextActor = String(actor?.id || actor?.username || actor?.name || 'signed-out').trim().toLowerCase() || 'signed-out';
  if (nextActor === activeFileCacheActor) return activeFileCacheActor;
  activeFileCacheActor = nextActor;
  return activeFileCacheActor;
};

const isDesktopBridgeAvailable = () => typeof window !== 'undefined' && Boolean(window.kalpavrikshaDesktop?.isDesktop);

const makeDesktopTransferId = () => `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const fileCacheAvailable = () => typeof window !== 'undefined' && 'indexedDB' in window;

export const getProjectFileCacheKey = (doc = {}) => {
  doc = doc && typeof doc === 'object' ? doc : {};
  const id = String(doc?.id || doc?.fileId || '').trim();
  const url = String(doc?.downloadUrl || doc?.url || '').trim();
  const name = String(doc?.name || doc?.fileName || 'file').trim();
  const size = String(doc?.size || '').trim();
  const resourceIdentity = [id, url, name, size, String(doc?.mimeType || '')].join('|');
  const resourceKey = (id || url || name) ? `${id || name}::${hashResourceIdentity(resourceIdentity)}` : '';
  return resourceKey ? `${activeFileCacheActor}::${resourceKey}` : '';
};

const readCacheIndex = () => {
  try { return JSON.parse(localStorage.getItem(FILE_CACHE_INDEX_KEY) || '{}') || {}; } catch { return {}; }
};

const writeCacheIndex = (index = {}) => {
  try { localStorage.setItem(FILE_CACHE_INDEX_KEY, JSON.stringify(index || {})); } catch {}
};

const isCacheEntryFresh = (entry = {}) => {
  const savedAt = Number(entry?.savedAt || 0);
  return savedAt > 0 && (nowMs() - savedAt) <= FILE_CACHE_TTL_MS;
};

export const getProjectFileCacheMeta = (doc = {}) => {
  const index = readCacheIndex();
  const entry = index[getProjectFileCacheKey(doc)];
  return entry && isCacheEntryFresh(entry) ? entry : null;
};

export const pruneExpiredProjectFileCache = async () => {
  const index = readCacheIndex();
  const expiredKeys = Object.values(index).filter(entry => !isCacheEntryFresh(entry)).map(entry => entry.key).filter(Boolean);
  if (!expiredKeys.length) return index;
  const next = { ...index };
  expiredKeys.forEach(key => delete next[key]);
  writeCacheIndex(next);
  if (fileCacheAvailable()) {
    try {
      const db = await openFileCacheDb();
      await new Promise((resolve) => {
        const tx = db.transaction(FILE_CACHE_STORE, 'readwrite');
        expiredKeys.forEach(key => tx.objectStore(FILE_CACHE_STORE).delete(key));
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
      db.close?.();
    } catch (error) {
      console.warn('Expired file cache cleanup failed:', error);
    }
  }
  return next;
};

export const listCachedProjectFiles = () => {
  const index = readCacheIndex();
  let changed = false;
  const next = {};
  Object.entries(index).forEach(([key, entry]) => {
    if (isCacheEntryFresh(entry)) next[key] = entry;
    else changed = true;
  });
  if (changed) writeCacheIndex(next);
  return next;
};

export const markProjectFileCached = (doc = {}, meta = {}) => {
  doc = doc && typeof doc === 'object' ? doc : {};
  meta = meta && typeof meta === 'object' ? meta : {};
  const key = getProjectFileCacheKey(doc);
  if (!key) return {};
  const index = readCacheIndex();
  index[key] = {
    key,
    name: doc?.name || doc?.fileName || meta?.name || 'file',
    size: Number(meta?.size || doc?.size || 0),
    mimeType: meta?.mimeType || doc?.mimeType || 'application/octet-stream',
    savedAt: nowMs(),
    expiresAt: nowMs() + FILE_CACHE_TTL_MS,
    projectFileId: doc?.id || doc?.fileId || '',
  };
  writeCacheIndex(index);
  return index[key];
};

const openFileCacheDb = () => new Promise((resolve, reject) => {
  if (!fileCacheAvailable()) return reject(new Error('Browser file cache is not available.'));
  const req = indexedDB.open(FILE_CACHE_DB_NAME, 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(FILE_CACHE_STORE)) db.createObjectStore(FILE_CACHE_STORE, { keyPath: 'key' });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error('Could not open browser file cache.'));
});

const putCachedBlob = async (doc = {}, blob) => {
  if (!blob || !fileCacheAvailable()) return null;
  const key = getProjectFileCacheKey(doc);
  if (!key) return null;
  const db = await openFileCacheDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_CACHE_STORE, 'readwrite');
    tx.objectStore(FILE_CACHE_STORE).put({
      key,
      blob,
      name: doc?.name || doc?.fileName || 'file',
      size: blob.size || doc?.size || 0,
      mimeType: blob.type || doc?.mimeType || 'application/octet-stream',
      savedAt: nowMs(),
      expiresAt: nowMs() + FILE_CACHE_TTL_MS,
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not save downloaded file locally.'));
  });
  db.close?.();
  return markProjectFileCached(doc, { size: blob.size, mimeType: blob.type });
};

export const getCachedProjectFile = async (doc = {}) => {
  const key = getProjectFileCacheKey(doc);
  if (!key || !fileCacheAvailable()) return null;
  const db = await openFileCacheDb();
  const item = await new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_CACHE_STORE, 'readonly');
    const req = tx.objectStore(FILE_CACHE_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('Could not read cached file.'));
  });
  db.close?.();
  if (!item) return null;
  if (!isCacheEntryFresh(item)) {
    await clearCachedProjectFile(doc).catch(() => {});
    return null;
  }
  return item;
};

export const openCachedProjectFile = async (doc = {}) => {
  doc = doc && typeof doc === 'object' ? doc : {};
  if (isDesktopBridgeAvailable()) {
    const key = getProjectFileCacheKey(doc);
    const result = await window.kalpavrikshaDesktop.openCachedFile({
      key,
      fileName: doc?.name || doc?.fileName || 'download',
    });
    if (!result?.ok) {
      await clearCachedProjectFile(doc).catch(() => {});
      throw new Error(result?.message || 'This file is not saved on this computer anymore. Please download it again.');
    }
    return { ok: true, fromCache: true, desktop: true };
  }

  const item = await getCachedProjectFile(doc);
  if (!item?.blob) throw new Error('This file is not saved in this browser anymore. Please download it again.');
  const blobUrl = URL.createObjectURL(item.blob);
  const opened = window.open(blobUrl, '_blank', 'noopener,noreferrer');
  if (!opened) {
    triggerBrowserDownload(blobUrl, item.name || doc?.name || 'download');
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60 * 1000);
  return { ok: true, fromCache: true };
};

export const clearCachedProjectFile = async (doc = {}) => {
  const key = getProjectFileCacheKey(doc);
  if (!key) return;
  const index = readCacheIndex();
  delete index[key];
  writeCacheIndex(index);
  if (isDesktopBridgeAvailable()) {
    await window.kalpavrikshaDesktop.clearCachedFile({ key }).catch(() => {});
  }
  if (!fileCacheAvailable()) return;
  const db = await openFileCacheDb();
  await new Promise((resolve) => {
    const tx = db.transaction(FILE_CACHE_STORE, 'readwrite');
    tx.objectStore(FILE_CACHE_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
  db.close?.();
};

const triggerBrowserDownload = (url, fileName = 'download') => {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1500);
};

const MAX_TRACKED_BROWSER_DOWNLOAD_BYTES = 32 * 1024 * 1024;
export const downloadProjectFile = async (doc = {}, onProgress, options = {}) => {
  doc = doc && typeof doc === 'object' ? doc : {};
  options = options && typeof options === 'object' ? options : {};
  if (onProgress && typeof onProgress === 'object') {
    options = onProgress;
    onProgress = options?.onProgress;
  }
  const signal = options?.signal;
  const url = getProjectFileDownloadUrl(doc);
  if (!url) {
    throw new Error('This file does not have a valid download link. Please re-upload it once.');
  }

  const fileName = doc?.name || doc?.fileName || 'download';
  const startedAt = Date.now();
  const declaredSize = Number(doc?.size || 0);

  if (isDesktopBridgeAvailable()) {
    const transferId = makeDesktopTransferId();
    const unsubscribe = window.kalpavrikshaDesktop.onFileTransferProgress?.((event = {}) => {
      if (event?.transferId !== transferId || typeof onProgress !== 'function') return;
      onProgress(event);
    });
    try {
      const result = await window.kalpavrikshaDesktop.downloadAndOpenFile({
        transferId,
        key: getProjectFileCacheKey(doc),
        url,
        fileName,
        mimeType: doc?.mimeType || 'application/octet-stream',
        size: Number(doc?.size || 0),
        ttlMs: FILE_CACHE_TTL_MS,
      });
      if (!result?.ok) throw new Error(result?.message || 'Download failed. Please try again.');
      markProjectFileCached(doc, { size: result.size || doc?.size || 0, mimeType: result.mimeType || doc?.mimeType });
      if (typeof onProgress === 'function') onProgress({ percent: 100, loaded: result.size || Number(doc?.size || 0), total: result.size || Number(doc?.size || 0), speedBps: 0, etaSeconds: 0, desktop: true });
      return { ok: true, method: result.openedExisting ? 'desktop-open-cache' : 'desktop-download-cache', cached: true, desktop: true };
    } finally {
      if (typeof unsubscribe === 'function') unsubscribe();
    }
  }

  if (declaredSize > MAX_TRACKED_BROWSER_DOWNLOAD_BYTES) {
    triggerBrowserDownload(url, fileName);
    return { ok:true, method: 'browser-native-large', cached:false, completionConfirmed:false };
  }

  try {
    if (signal?.aborted) throw makeFileError('DOWNLOAD_CANCELLED', 'Download cancelled.');
    const res = signal
      ? await authFetch(url, { cache: 'no-store', timeoutMs:FILE_DOWNLOAD_TIMEOUT_MS, signal })
      : await authFetch(url, { cache: 'no-store', timeoutMs:FILE_DOWNLOAD_TIMEOUT_MS });
    if (!res.ok) {
      const msg = await readServerMessage(res).catch(() => `Download failed (${res.status})`);
      throw new Error(msg);
    }

    const total = Number(res.headers.get('content-length') || doc?.size || 0);
    const reader = res.body?.getReader?.();
    if (!reader) {
      triggerBrowserDownload(url, fileName);
      return { ok:true, method: 'browser-native', cached:false, completionConfirmed: false };
    }

    const chunks = [];
    let loaded = 0;
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        throw makeFileError('DOWNLOAD_CANCELLED', 'Download cancelled.');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength || 0;
        if (typeof onProgress === 'function') {
          const elapsedSeconds = Math.max(0.5, (Date.now() - startedAt) / 1000);
          const speedBps = loaded > 0 ? loaded / elapsedSeconds : 0;
          const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
          const remainingBytes = total > loaded ? total - loaded : 0;
          const etaSeconds = speedBps > 0 && remainingBytes > 0 ? Math.ceil(remainingBytes / speedBps) : 0;
          onProgress({ percent, loaded, total, speedBps, etaSeconds });
        }
      }
    }

    const blob = new Blob(chunks, { type: res.headers.get('content-type') || doc?.mimeType || 'application/octet-stream' });
    if (typeof onProgress === 'function') onProgress({ percent: 100, loaded: blob.size || loaded, total: total || blob.size || loaded, speedBps: 0, etaSeconds: 0 });
    const cachedMeta = await putCachedBlob(doc, blob).catch((cacheError) => { console.warn('File downloaded but local cache failed:', cacheError); return null; });
    const blobUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(blobUrl, fileName);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    return { ok: true, method: 'blob', cached: Boolean(cachedMeta), completionConfirmed:true };
  } catch (error) {
    // If the browser/network blocks streamed fetch even though the file URL is valid,
    // fall back to the normal browser download flow instead of showing a false failure.
    // Real server errors above (404/500 with a response) still throw before this block.
    if (error?.code === 'DOWNLOAD_CANCELLED' || signal?.aborted) throw makeFileError('DOWNLOAD_CANCELLED', 'Download cancelled.');
    if (error instanceof TypeError || /failed to fetch|network|load failed/i.test(String(error?.message || ''))) {
      console.warn('Tracked download stream failed; falling back to direct browser download:', error);
      if (typeof onProgress === 'function') onProgress({ percent: 100, loaded: Number(doc?.size || 0), total: Number(doc?.size || 0), speedBps: 0, etaSeconds: 0, fallback: true });
      triggerBrowserDownload(url, fileName);
      return { ok: true, method: 'direct-fallback', cached:false, completionConfirmed:false };
    }
    console.error('Download failed:', error);
    throw error;
  }
};

export const deleteProjectFileFromServer = async (doc = {}) => {
  if (!doc?.id) throw new Error('This file has no server record and cannot be deleted safely.');
  const response = await authFetch(`${API_BASE}/api/files/${encodeURIComponent(doc?.id)}`, { method: 'DELETE' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `File deletion failed: ${response.status}`);
    error.status = response.status;
    error.code = payload.code || '';
    error.payload = payload;
    throw error;
  }
  return payload;
};

export const canDeleteProjectFile = (doc = {}, user = {}) => {
  const role = String(user?.role || '').trim().toUpperCase();
  if (role === 'ADMIN' || role === 'MANAGER') return true;
  return String(doc?.uploadedBy || '').trim().toLowerCase() === String(user?.name || '').trim().toLowerCase();
};
