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

  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable && typeof onProgress === 'function') {
      onProgress(Math.round((event.loaded / event.total) * 100));
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

export const downloadProjectFile = async (doc = {}) => {
  const url = getProjectFileDownloadUrl(doc);
  if (!url) {
    alert('This file does not have a valid download link. Please re-upload it once.');
    return;
  }

  // Let the browser stream the file directly instead of buffering it in JS.
  // This is safer for mobile browsers and large PDFs/DWGs.
  const fileName = doc.name || doc.fileName || 'download';
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener noreferrer';
  a.target = '_blank';
  a.style.position = 'fixed';
  a.style.left = '-9999px';
  a.style.top = '-9999px';
  document.body.appendChild(a);

  try {
    a.click();
    if (isMobile) {
      // Some mobile WebViews ignore programmatic downloads. Opening the same
      // URL after the tap keeps the file accessible without changing task data.
      setTimeout(() => {
        try { window.open(url, '_blank', 'noopener,noreferrer'); } catch {}
      }, 250);
    }
  } catch (error) {
    window.location.href = url;
  } finally {
    setTimeout(() => a.remove(), 1000);
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
