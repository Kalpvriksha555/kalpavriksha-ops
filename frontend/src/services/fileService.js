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

export const getProjectFileKind = (doc = {}) => {
  if (isProjectFilePdf(doc)) return 'pdf';
  if (isProjectFileImage(doc)) return 'image';
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
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mime = match[1] || fallbackType;
  const isBase64 = Boolean(match[2]);
  const body = match[3] || '';
  if (isBase64) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
};

export const canPreviewProjectFile = (doc = {}) => getProjectFileKind(doc) !== 'file' && Boolean(getProjectFilePreviewUrl(doc));

export const fetchProjectFilePreview = async (doc = {}) => {
  const kind = getProjectFileKind(doc);
  if (kind === 'file') throw new Error('Preview is available only for PDF and image files.');
  const sourceUrl = getProjectFilePreviewUrl(doc);
  if (!sourceUrl) throw new Error('Preview link is not available for this file.');

  // Use JSON/base64 preview-data instead of embedding /preview directly. This
  // prevents IDM/browser download managers from treating Preview as a download.
  const dataUrl = getPreviewDataUrl(doc);
  if (/^(blob:|data:)/i.test(dataUrl)) {
    if (dataUrl.startsWith('blob:')) return { kind, url: dataUrl, sourceUrl: dataUrl, mimeType: getProjectFileMime(doc), size: Number(doc.size || 0) };
    const blob = dataUrlToBlob(dataUrl, kind === 'pdf' ? 'application/pdf' : 'image/*');
    if (!blob || blob.size <= 0) throw new Error('Preview file is empty. Please download or re-upload this file.');
    return { kind, url: URL.createObjectURL(blob), sourceUrl: dataUrl, mimeType: blob.type, size: blob.size };
  }

  const fetchPreviewBlobFallback = async () => {
    // Last-resort inline preview fetch. Never expose this URL directly to iframe/window.open,
    // because download managers can intercept /preview. We fetch it as a blob and render a blob URL.
    const fallbackRes = await fetch(sourceUrl, { method: 'GET', cache: 'no-store', headers: { Accept: kind === 'pdf' ? 'application/pdf,*/*' : 'image/*,*/*' } });
    if (!fallbackRes.ok) {
      const text = await fallbackRes.text().catch(() => '');
      throw new Error(text || `Preview failed (${fallbackRes.status})`);
    }
    const blob = await fallbackRes.blob();
    if (!blob || blob.size <= 0) throw new Error('Preview file is empty. Please download or re-upload this file.');
    return { kind, url: URL.createObjectURL(blob), sourceUrl, mimeType: blob.type || getProjectFileMime(doc), size: blob.size };
  };

  let res;
  try {
    res = await fetch(dataUrl, { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' } });
  } catch (error) {
    return fetchPreviewBlobFallback();
  }
  if (!res.ok) return fetchPreviewBlobFallback();
  const payload = await res.json().catch(() => null);
  if (!payload?.ok || !payload?.dataUrl) return fetchPreviewBlobFallback();
  const blob = dataUrlToBlob(payload.dataUrl, payload.mimeType || (kind === 'pdf' ? 'application/pdf' : 'image/*'));
  if (!blob || blob.size <= 0) throw new Error('Preview file is empty. Please download or re-upload this file.');
  return {
    kind: payload.kind || kind,
    url: URL.createObjectURL(blob),
    sourceUrl,
    mimeType: blob.type || payload.mimeType,
    size: blob.size || payload.size,
  };
};

export const getProjectFileDownloadUrl = (doc = {}) => {
  if (!doc) return '';
  if (doc.downloadUrl) return absoluteApiUrl(doc.downloadUrl);

  // Prefer the saved URL before guessing from the id. Some older browser-only
  // records used Date.now()+Math.random() as an id; forcing those ids through
  // /api/files/:id/download caused false "missing file" errors on mobile/desktop.
  if (doc.url) return absoluteApiUrl(doc.url);

  const id = String(doc.fileId || doc.id || '').trim();
  const looksLikeServerFileId = /^[A-Za-z0-9_-]{6,40}$/.test(id) && !/^\d+(\.\d+)?$/.test(id);
  if (looksLikeServerFileId) return `${API_BASE}/api/files/${encodeURIComponent(id)}/download`;
  return '';
};

export const normalizeProjectFileRecord = (doc = {}) => {
  const id = String(doc.fileId || doc.id || '').trim();
  const name = String(doc.name || doc.fileName || doc.filename || doc.originalName || doc.storedName || 'file').trim();
  const mimeType = String(doc.mimeType || doc.mime || doc.contentType || '').trim();
  const normalized = {
    ...doc,
    id: doc.id || doc.fileId || id || undefined,
    fileId: doc.fileId || doc.id || id || undefined,
    name,
    fileName: doc.fileName || name,
    mimeType,
    mime: doc.mime || mimeType,
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
  if (!doc || getProjectFileKind(doc) === 'file') return '';

  if (doc.previewUrl) return normalizePreviewUrl(doc.previewUrl);

  const id = String(doc.fileId || doc.id || '').trim();
  const looksLikeServerFileId = /^[A-Za-z0-9_-]{6,40}$/.test(id) && !/^\d+(\.\d+)?$/.test(id);
  if (looksLikeServerFileId) return `${API_BASE}/api/files/${encodeURIComponent(id)}?mode=preview`;

  const downloadUrl = getProjectFileDownloadUrl(doc);
  if (downloadUrl) return normalizePreviewUrl(downloadUrl);

  const url = String(doc.url || '').trim();
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
      previewUrl: payload.file?.previewUrl || (payload.file?.id ? `/api/files/${payload.file.id}/preview` : ''),
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
