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
      const blobUrl = URL.createObjectURL(blob);
      triggerBrowserDownload(blobUrl, fileName);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      return { ok: true, method: 'blob' };
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
    const blobUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(blobUrl, fileName);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    return { ok: true, method: 'blob' };
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
