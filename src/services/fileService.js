import { API_BASE } from '../config/appConfig';

export const absoluteApiUrl = (url = '', version = '') => {
  let value = String(url || '').trim();
  if (!value) return '';
  if (/^(blob:|data:|https?:)/i.test(value)) return value;
  if (value.startsWith('/uploads/')) value = value.replace('/uploads/', '/api/uploads/');
  if (value.startsWith('uploads/')) value = value.replace('uploads/', '/api/uploads/');
  const full = value.startsWith('/') ? `${API_BASE}${value}` : `${API_BASE}/${value.replace(/^\/+/, '')}`;
  return version ? `${full}${full.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}` : full;
};


const getProjectFileName = (doc = {}) => String(doc?.name || doc?.fileName || doc?.filename || '').toLowerCase();
const getProjectFileMime = (doc = {}) => String(doc?.mime || doc?.mimeType || doc?.contentType || doc?.type || '').toLowerCase();

export const isProjectFilePdf = (doc = {}) => {
  const name = getProjectFileName(doc);
  const mime = getProjectFileMime(doc);
  return name.endsWith('.pdf') || mime.includes('pdf');
};

export const isProjectFileImage = (doc = {}) => {
  const name = getProjectFileName(doc);
  const mime = getProjectFileMime(doc);
  return mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name);
};

export const isProjectFileText = (doc = {}) => {
  const name = getProjectFileName(doc);
  const mime = getProjectFileMime(doc);
  return mime.startsWith('text/')
    || /\.(txt|json|xml|csv|log|md|rtf)$/i.test(name)
    || ['application/json', 'application/xml', 'text/xml', 'application/csv'].some(type => mime.includes(type));
};

export const isProjectFileOffice = (doc = {}) => {
  const name = getProjectFileName(doc);
  const mime = getProjectFileMime(doc);
  return /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(name)
    || mime.includes('wordprocessingml')
    || mime.includes('spreadsheetml')
    || mime.includes('presentationml')
    || mime.includes('msword')
    || mime.includes('ms-excel')
    || mime.includes('ms-powerpoint');
};

export const isProjectFileCad = (doc = {}) => {
  const name = getProjectFileName(doc);
  const mime = getProjectFileMime(doc);
  return name.endsWith('.dwg') || name.endsWith('.dxf') || mime.includes('acad') || mime.includes('dwg') || mime.includes('dxf');
};

export const getProjectFileKind = (doc = {}) => {
  if (isProjectFilePdf(doc)) return 'pdf';
  if (isProjectFileImage(doc)) return 'image';
  if (isProjectFileText(doc)) return 'text';
  if (isProjectFileOffice(doc)) return 'office';
  if (isProjectFileCad(doc)) return 'cad';
  return 'file';
};

const normalizePreviewUrl = (url = '') => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^(blob:|data:)/i.test(raw)) return raw;
  const absolute = absoluteApiUrl(raw);

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

export const canPreviewProjectFile = (doc = {}) => Boolean(getProjectFilePreviewUrl(doc));


export const getProjectFileDownloadUrl = (doc = {}) => {
  if (!doc) return '';
  if (doc.downloadUrl) return absoluteApiUrl(doc.downloadUrl);

  // Prefer the saved URL before guessing from the id. Some older browser-only
  // records used Date.now()+Math.random() as an id; forcing those ids through
  // /api/files/:id/download caused false "missing file" errors on mobile/desktop.
  if (doc.url) return absoluteApiUrl(doc.url);

  const id = String(doc.id || '').trim();
  const looksLikeServerFileId = /^[A-Za-z0-9_-]{6,40}$/.test(id) && !/^\d+(\.\d+)?$/.test(id);
  if (looksLikeServerFileId) return `${API_BASE}/api/files/${encodeURIComponent(id)}/download`;
  return '';
};


const isServerFileId = (id = '') => /^[A-Za-z0-9_-]{6,40}$/.test(String(id || '').trim()) && !/^\d+(\.\d+)?$/.test(String(id || '').trim());

const hasInlineLocalUrl = (doc = {}) => /^(blob:|data:)/i.test(String(doc.previewUrl || doc.url || doc.fileUrl || '').trim());

const hasExplicitFileUrl = (doc = {}) => Boolean(String(doc.previewUrl || doc.url || doc.fileUrl || doc.downloadUrl || '').trim());

export const getProjectFilePreviewUrl = (doc = {}) => {
  if (!doc) return '';

  // Chat attachments often carry a message id plus a direct file/data URL. Prefer
  // the real file URL first, otherwise the message id can be mistaken for a file id
  // and the app may navigate to a raw image/PDF route instead of the viewer.
  if (doc.previewUrl) return normalizePreviewUrl(doc.previewUrl);
  if (doc.url) return normalizePreviewUrl(doc.url);
  if (doc.fileUrl) return normalizePreviewUrl(doc.fileUrl);
  if (doc.downloadUrl) return normalizePreviewUrl(doc.downloadUrl);

  const id = String(doc.fileId || doc.id || '').trim();
  if (isServerFileId(id)) return `${API_BASE}/api/files/${encodeURIComponent(id)}/preview`;

  return '';
};

export const getProjectFilePreviewDataUrl = (doc = {}) => {
  if (!doc || hasInlineLocalUrl(doc)) return '';

  const explicit = String(doc.previewUrl || doc.url || doc.fileUrl || doc.downloadUrl || '').trim();
  if (explicit && !/\/api\/files\/[^/?#]+/i.test(explicit)) return '';

  const fileId = String(doc.fileId || '').trim();
  if (isServerFileId(fileId)) return `${API_BASE}/api/files/${encodeURIComponent(fileId)}/preview-data`;

  const id = String(doc.id || '').trim();
  if (!hasExplicitFileUrl(doc) && isServerFileId(id)) return `${API_BASE}/api/files/${encodeURIComponent(id)}/preview-data`;

  return '';
};

const base64ToBlob = (base64 = '', mimeType = 'application/octet-stream') => {
  const binary = atob(String(base64 || ''));
  const chunks = [];
  const chunkSize = 8192;
  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i += 1) bytes[i] = slice.charCodeAt(i);
    chunks.push(bytes);
  }
  return new Blob(chunks, { type: mimeType || 'application/octet-stream' });
};

const getScopedProjectFileCacheKey = (doc = {}, scope = FILE_CACHE_SCOPE_DOWNLOAD) => {
  const base = getProjectFileCacheKey(doc);
  return base ? `${scope}::${base}` : '';
};

const isScopedCacheEntryFresh = (entry = {}, ttlMs = FILE_CACHE_TTL_MS) => {
  const savedAt = Number(entry.savedAt || 0);
  return savedAt > 0 && (nowMs() - savedAt) <= ttlMs;
};

export const releaseProjectFilePreview = (preview = {}) => {
  const url = String(preview?.objectUrl || preview?.url || '');
  if (url && url.startsWith('blob:')) {
    try { URL.revokeObjectURL(url); } catch {}
  }
};

const putPreviewBlob = async (doc = {}, blob) => {
  if (!blob || !fileCacheAvailable()) return null;
  const key = getScopedProjectFileCacheKey(doc, FILE_CACHE_SCOPE_PREVIEW);
  if (!key) return null;
  const db = await openFileCacheDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_CACHE_STORE, 'readwrite');
    tx.objectStore(FILE_CACHE_STORE).put({
      key,
      blob,
      scope: FILE_CACHE_SCOPE_PREVIEW,
      name: doc.name || doc.fileName || 'preview',
      size: blob.size || doc.size || 0,
      mimeType: blob.type || doc.mimeType || 'application/octet-stream',
      savedAt: nowMs(),
      expiresAt: nowMs() + FILE_PREVIEW_CACHE_TTL_MS,
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not save preview cache.'));
  });
  db.close?.();
  return true;
};

const getCachedPreviewBlob = async (doc = {}) => {
  const key = getScopedProjectFileCacheKey(doc, FILE_CACHE_SCOPE_PREVIEW);
  if (!key || !fileCacheAvailable()) return null;
  const db = await openFileCacheDb();
  const item = await new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_CACHE_STORE, 'readonly');
    const req = tx.objectStore(FILE_CACHE_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('Could not read preview cache.'));
  });
  db.close?.();
  if (!item?.blob) return null;
  if (!isScopedCacheEntryFresh(item, FILE_PREVIEW_CACHE_TTL_MS)) {
    if (fileCacheAvailable()) {
      const cleanupDb = await openFileCacheDb().catch(() => null);
      if (cleanupDb) {
        await new Promise((resolve) => {
          const tx = cleanupDb.transaction(FILE_CACHE_STORE, 'readwrite');
          tx.objectStore(FILE_CACHE_STORE).delete(key);
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
        cleanupDb.close?.();
      }
    }
    return null;
  }
  return item;
};

const fetchProjectFilePreviewFresh = async (doc = {}, options = {}) => {
  const kind = getProjectFileKind(doc);
  const sourceUrl = getProjectFilePreviewUrl(doc);
  const name = doc.name || doc.fileName || doc.filename || 'File';
  const size = Number(doc.size || doc.fileSize || 0);
  const originalMime = getProjectFileMime(doc) || 'application/octet-stream';

  if (!sourceUrl) throw new Error('Preview link is not available for this file.');

  // CAD and unsupported binary formats should never force a browser download from Preview.
  // They open as metadata cards with an explicit Download button.
  if (kind === 'cad' || kind === 'file') {
    return {
      kind,
      url: '',
      objectUrl: '',
      sourceUrl,
      mimeType: originalMime,
      size,
      metadataOnly: true,
      fromCache: false,
      name,
    };
  }

  // Office files are browser-dependent. We keep Preview inline by showing a safe
  // office preview card/iframe fallback instead of navigating to a download URL.
  if (kind === 'office') {
    return {
      kind,
      url: sourceUrl,
      objectUrl: '',
      sourceUrl,
      mimeType: originalMime,
      size,
      metadataOnly: false,
      fromCache: false,
      name,
    };
  }

  const cached = await getCachedPreviewBlob(doc).catch(() => null);
  if (cached?.blob) {
    const cachedUrl = URL.createObjectURL(cached.blob);
    const mimeType = cached.mimeType || cached.blob.type || originalMime;
    const text = kind === 'text' ? await cached.blob.text().catch(() => '') : undefined;
    return {
      kind,
      url: cachedUrl,
      objectUrl: cachedUrl,
      sourceUrl,
      mimeType,
      size: cached.size || cached.blob.size,
      text,
      fromCache: true,
      release: () => releaseProjectFilePreview({ objectUrl: cachedUrl }),
    };
  }

  const dataUrl = getProjectFilePreviewDataUrl(doc);
  let blob;
  let contentType = '';
  if (dataUrl) {
    const dataRes = await fetch(dataUrl, { method: 'GET', cache: 'no-store', signal: options.signal, headers: { Accept: 'application/json' } });
    const payload = await dataRes.json().catch(() => null);
    if (!dataRes.ok || !payload?.ok) throw new Error(payload?.error || `Preview failed (${dataRes.status})`);
    if (payload.previewType === 'metadata') {
      return { kind, url: '', objectUrl: '', sourceUrl, mimeType: payload.mime || originalMime, size: payload.size || size, metadataOnly: true, fromCache: false, name: payload.name || name };
    }
    contentType = String(payload.mime || originalMime || '').toLowerCase();
    blob = base64ToBlob(payload.base64 || '', contentType || originalMime || 'application/octet-stream');
  } else {
    const res = await fetch(sourceUrl, { method: 'GET', cache: 'no-store', signal: options.signal, headers: { Accept: 'application/octet-stream,*/*;q=0.8' } });
    contentType = String(res.headers.get('Content-Type') || '').toLowerCase();
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Preview failed (${res.status})`);
    }
    if (contentType.includes('text/html') && kind !== 'text') {
      const text = await res.text().catch(() => '');
      throw new Error(text || 'Preview endpoint did not return a valid file stream.');
    }
    blob = await res.blob();
  }

  if (!blob || blob.size <= 0) throw new Error('Preview file is empty. Please download or re-upload this file.');

  const expected = kind === 'pdf'
    ? 'application/pdf'
    : kind === 'image'
      ? (contentType && contentType !== 'application/octet-stream' ? contentType : (originalMime.startsWith('image/') ? originalMime : 'image/*'))
      : (contentType && contentType !== 'application/octet-stream' ? contentType : (originalMime || 'text/plain'));
  const typedBlob = new Blob([blob], { type: expected });
  await putPreviewBlob(doc, typedBlob).catch((error) => console.warn('Preview cache save failed:', error));
  const objectUrl = URL.createObjectURL(typedBlob);
  const text = kind === 'text' ? await typedBlob.text().catch(() => '') : undefined;

  return {
    kind,
    url: objectUrl,
    objectUrl,
    sourceUrl,
    mimeType: typedBlob.type || contentType,
    size: typedBlob.size,
    text,
    fromCache: false,
    release: () => releaseProjectFilePreview({ objectUrl }),
  };
};

export const fetchProjectFilePreview = async (doc = {}, options = {}) => {
  const dedupeKey = getScopedProjectFileCacheKey(doc, FILE_CACHE_SCOPE_PREVIEW) || getProjectFilePreviewUrl(doc);
  const signal = options.signal;

  if (!dedupeKey) return fetchProjectFilePreviewFresh(doc, options);

  // Reuse an active network/cache read for the same file so double-clicks,
  // React re-renders, and quick viewer transitions do not fire duplicate preview requests.
  const active = PREVIEW_INFLIGHT_REQUESTS.get(dedupeKey);
  if (active?.promise) {
    if (signal?.aborted) throw new DOMException('Preview request cancelled.', 'AbortError');
    return active.promise.then((result) => {
      if (signal?.aborted) throw new DOMException('Preview request cancelled.', 'AbortError');
      // Blob URLs cannot be shared safely between two consumers because one close
      // may revoke the other viewer. Clone the blob-backed preview from cache for
      // the second consumer by re-reading after the first request completes.
      return fetchProjectFilePreviewFresh(doc, { signal });
    });
  }

  const promise = fetchProjectFilePreviewFresh(doc, options)
    .finally(() => PREVIEW_INFLIGHT_REQUESTS.delete(dedupeKey));
  PREVIEW_INFLIGHT_REQUESTS.set(dedupeKey, { promise, startedAt: nowMs() });
  return promise;
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

const uploadWithXhr = (url, form, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', url, true);
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

  xhr.onload = () => {
    const raw = xhr.responseText || '';
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
    if (xhr.status >= 200 && xhr.status < 300) return resolve(payload || {});
    reject(new Error(payload?.error || payload?.message || raw || `Upload failed (${xhr.status})`));
  };
  xhr.onerror = () => reject(new Error('Upload failed. Please check internet connection and try again.'));
  xhr.ontimeout = () => reject(new Error('Upload timed out. Please try again on a stable connection.'));
  xhr.send(form);
});

export const uploadProjectFile = async (file, projectId, type, uploadedBy, onProgress) => {
  const baseDoc = {
    id: Date.now() + Math.random(),
    name: file.name,
    type,
    date: new Date().toLocaleDateString(),
    uploadedBy,
    size: file.size || 0,
    mimeType: file.type || 'application/octet-stream'
  };

  const form = new FormData();
  form.append('file', file);
  form.append('projectId', projectId || '');
  form.append('type', type || 'source');
  form.append('by', uploadedBy || 'Team');

  try {
    const payload = await uploadWithXhr(`${API_BASE}/api/files/upload`, form, onProgress);
    return {
      ...baseDoc,
      ...payload.file,
      type,
      folder: type,
      uploadedBy,
      date: new Date().toLocaleDateString(),
      url: payload.file?.url || payload.file?.downloadUrl || '',
      downloadUrl: payload.file?.downloadUrl || (payload.file?.id ? `/api/files/${payload.file.id}/download` : '')
    };
  } catch (error) {
    console.error('Backend file upload failed:', error);
    throw error;
  }
};



const FILE_CACHE_DB_NAME = 'kalpavriksha-file-cache-v1';
const FILE_CACHE_STORE = 'files';
const FILE_CACHE_INDEX_KEY = 'kalpavriksha_downloaded_file_index_v1';
const FILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FILE_PREVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FILE_CACHE_SCOPE_DOWNLOAD = 'download';
const FILE_CACHE_SCOPE_PREVIEW = 'preview';
const PREVIEW_INFLIGHT_REQUESTS = new Map();
const nowMs = () => Date.now();

const isDesktopBridgeAvailable = () => typeof window !== 'undefined' && Boolean(window.kalpavrikshaDesktop?.isDesktop);

const makeDesktopTransferId = () => `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const fileCacheAvailable = () => typeof window !== 'undefined' && 'indexedDB' in window;

export const getProjectFileCacheKey = (doc = {}) => {
  const id = String(doc.id || doc.fileId || '').trim();
  const url = String(doc.downloadUrl || doc.url || '').trim();
  const name = String(doc.name || doc.fileName || 'file').trim();
  const size = String(doc.size || '').trim();
  return [id || url || name, name, size].filter(Boolean).join('::');
};

const readCacheIndex = () => {
  try { return JSON.parse(localStorage.getItem(FILE_CACHE_INDEX_KEY) || '{}') || {}; } catch { return {}; }
};

const writeCacheIndex = (index = {}) => {
  try { localStorage.setItem(FILE_CACHE_INDEX_KEY, JSON.stringify(index || {})); } catch {}
};

const isCacheEntryFresh = (entry = {}) => {
  const savedAt = Number(entry.savedAt || 0);
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
  const key = getProjectFileCacheKey(doc);
  if (!key) return {};
  const index = readCacheIndex();
  index[key] = {
    key,
    name: doc.name || doc.fileName || meta.name || 'file',
    size: Number(meta.size || doc.size || 0),
    mimeType: meta.mimeType || doc.mimeType || 'application/octet-stream',
    savedAt: nowMs(),
    expiresAt: nowMs() + FILE_CACHE_TTL_MS,
    projectFileId: doc.id || doc.fileId || '',
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
      name: doc.name || doc.fileName || 'file',
      size: blob.size || doc.size || 0,
      mimeType: blob.type || doc.mimeType || 'application/octet-stream',
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
  if (isDesktopBridgeAvailable()) {
    const key = getProjectFileCacheKey(doc);
    const result = await window.kalpavrikshaDesktop.openCachedFile({
      key,
      fileName: doc.name || doc.fileName || 'download',
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
    triggerBrowserDownload(blobUrl, item.name || doc.name || 'download');
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

export const downloadProjectFile = async (doc = {}, onProgress) => {
  const url = getProjectFileDownloadUrl(doc);
  if (!url) {
    throw new Error('This file does not have a valid download link. Please re-upload it once.');
  }

  const fileName = doc.name || doc.fileName || 'download';
  const startedAt = Date.now();

  if (isDesktopBridgeAvailable()) {
    const transferId = makeDesktopTransferId();
    const unsubscribe = window.kalpavrikshaDesktop.onFileTransferProgress?.((event = {}) => {
      if (event.transferId !== transferId || typeof onProgress !== 'function') return;
      onProgress(event);
    });
    try {
      const result = await window.kalpavrikshaDesktop.downloadAndOpenFile({
        transferId,
        key: getProjectFileCacheKey(doc),
        url,
        fileName,
        mimeType: doc.mimeType || 'application/octet-stream',
        size: Number(doc.size || 0),
        ttlMs: FILE_CACHE_TTL_MS,
      });
      if (!result?.ok) throw new Error(result?.message || 'Download failed. Please try again.');
      markProjectFileCached(doc, { size: result.size || doc.size || 0, mimeType: result.mimeType || doc.mimeType });
      if (typeof onProgress === 'function') onProgress({ percent: 100, loaded: result.size || Number(doc.size || 0), total: result.size || Number(doc.size || 0), speedBps: 0, etaSeconds: 0, desktop: true });
      return { ok: true, method: result.openedExisting ? 'desktop-open-cache' : 'desktop-download-cache', cached: true, desktop: true };
    } finally {
      if (typeof unsubscribe === 'function') unsubscribe();
    }
  }

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const msg = await readServerMessage(res).catch(() => `Download failed (${res.status})`);
      throw new Error(msg);
    }

    const total = Number(res.headers.get('content-length') || doc.size || 0);
    const reader = res.body?.getReader?.();
    if (!reader) {
      const blob = await res.blob();
      if (typeof onProgress === 'function') onProgress({ percent: 100, loaded: blob.size || total, total: blob.size || total, speedBps: 0, etaSeconds: 0 });
      await putCachedBlob(doc, blob).catch((cacheError) => console.warn('File downloaded but local cache failed:', cacheError));
      const blobUrl = URL.createObjectURL(blob);
      triggerBrowserDownload(blobUrl, fileName);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      return { ok: true, method: 'blob', cached: true };
    }

    const chunks = [];
    let loaded = 0;
    while (true) {
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

    const blob = new Blob(chunks, { type: res.headers.get('content-type') || doc.mimeType || 'application/octet-stream' });
    if (typeof onProgress === 'function') onProgress({ percent: 100, loaded: blob.size || loaded, total: total || blob.size || loaded, speedBps: 0, etaSeconds: 0 });
    await putCachedBlob(doc, blob).catch((cacheError) => console.warn('File downloaded but local cache failed:', cacheError));
    const blobUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(blobUrl, fileName);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    return { ok: true, method: 'blob', cached: true };
  } catch (error) {
    // If the browser/network blocks streamed fetch even though the file URL is valid,
    // fall back to the normal browser download flow instead of showing a false failure.
    // Real server errors above (404/500 with a response) still throw before this block.
    if (error instanceof TypeError || /failed to fetch|network|load failed|aborted/i.test(String(error?.message || ''))) {
      console.warn('Tracked download stream failed; falling back to direct browser download:', error);
      if (typeof onProgress === 'function') onProgress({ percent: 100, loaded: Number(doc.size || 0), total: Number(doc.size || 0), speedBps: 0, etaSeconds: 0, fallback: true });
      triggerBrowserDownload(url, fileName);
      return { ok: true, method: 'direct-fallback' };
    }
    console.error('Download failed:', error);
    throw error;
  }
};

export const deleteProjectFileFromServer = async (doc = {}) => {
  if (!doc?.id) return;
  try {
    await fetch(`${API_BASE}/api/files/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
  } catch (error) {
    console.warn('Server file delete failed:', error);
  }
};

export const canDeleteProjectFile = (doc = {}, user = {}) => {
  const role = String(user?.role || '').trim().toUpperCase();
  if (role === 'ADMIN' || role === 'MANAGER') return true;
  return String(doc?.uploadedBy || '').trim().toLowerCase() === String(user?.name || '').trim().toLowerCase();
};
