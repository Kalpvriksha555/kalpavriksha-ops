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
  if (doc.id && !String(doc.id).includes('.')) return `${API_BASE}/api/files/${encodeURIComponent(doc.id)}/download`;
  if (doc.url) return absoluteApiUrl(doc.url);
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
    const res = await fetch(`${API_BASE}/api/files/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(await readServerMessage(res));
    const payload = await res.json();
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
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const message = await res.text().catch(() => '');
      if (res.status === 410 || /unavailable|missing/i.test(message)) {
        alert(message || 'This file record exists, but the physical file is missing on the server. Please re-upload this file once.');
        return;
      }
      throw new Error(message || `Download failed (${res.status})`);
    }
    const blob = await res.blob();
    if (!blob || blob.size === 0) throw new Error('Downloaded file is empty');
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = doc.name || 'download';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      a.remove();
    }, 1500);
  } catch (error) {
    console.error('File download failed:', error);
    window.open(url, '_blank', 'noopener,noreferrer');
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
