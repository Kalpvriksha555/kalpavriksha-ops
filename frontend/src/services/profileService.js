import { authFetch, getCsrfToken } from './authService';
import { API_BASE } from '../config/appConfig';
import { asRecord } from '../utils/runtimeShapeUtils.js';
import { markClientMutationStarted } from './requestControlService.js';
import { apiHttpError, readApiRecord } from './apiContractService.js';

export const updateProfileApi = async (patch = {}) => {
  const res = await authFetch(`${API_BASE}/api/profile`, {
    method:'PATCH',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(patch),
    timeoutMs:5 * 60 * 1000
  });
  const data = await readApiRecord(res, { operation:'Profile update', requireOk:res.ok });
  if (!res.ok) throw apiHttpError(res, data, 'Profile update failed.');
  if (!data.user) throw new Error('The backend did not confirm the profile update.');
  return data;
};

export const uploadProfilePhoto = async ({ file, signal, onProgress } = {}) => {
  if (!file) throw new Error('Choose a profile photo first.');
  const form = new FormData();
  form.append('photo', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/profile/photo`);
    markClientMutationStarted();
    xhr.withCredentials = true;
    xhr.timeout = 5 * 60 * 1000;
    const csrf = getCsrfToken();
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    const abort = () => xhr.abort();
    if (signal) signal.addEventListener('abort', abort, { once:true });
    const finish = () => { if (signal) signal.removeEventListener('abort', abort); };
    xhr.onerror = () => { finish(); reject(new Error('Profile photo upload failed because the server could not be reached.')); };
    xhr.ontimeout = () => { finish(); reject(new Error('Profile photo upload timed out. Please retry.')); };
    xhr.onabort = () => { finish(); const error = new Error('Profile photo upload cancelled.'); error.name = 'AbortError'; reject(error); };
    xhr.onload = () => {
      finish();
      let data = {};
      try { data = asRecord(JSON.parse(xhr.responseText || '{}')); } catch { data = {}; }
      if (xhr.status < 200 || xhr.status >= 300 || !data.ok || !data.user) {
        reject(new Error(data.error || 'The backend did not confirm the profile photo upload.'));
        return;
      }
      resolve(data);
    };
    xhr.send(form);
  });
};
