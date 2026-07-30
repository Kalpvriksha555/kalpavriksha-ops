import { API_BASE } from '../config/appConfig';
import { authFetch } from './authService';

const readPayload = async (response, fallback) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 503) {
    const error = new Error(payload.error || fallback || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = payload.code || '';
    throw error;
  }
  return payload;
};

export const getReliabilityStatusApi = async () => readPayload(
  await authFetch(`${API_BASE}/api/system/reliability`, { cache:'no-store' }),
  'System reliability status could not be loaded.'
);

export const getBackupStatusApi = async () => readPayload(
  await authFetch(`${API_BASE}/api/system/backups`, { cache:'no-store' }),
  'Backup status could not be loaded.'
);

export const getOperationalJobsApi = async ({ status = '', limit = 100 } = {}) => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', String(limit));
  return readPayload(await authFetch(`${API_BASE}/api/system/jobs?${params}`, { cache:'no-store' }), 'Operational jobs could not be loaded.');
};

export const retryOperationalJobApi = async (jobId) => readPayload(
  await authFetch(`${API_BASE}/api/system/jobs/${encodeURIComponent(String(jobId))}/retry`, { method:'POST' }),
  'The operational job could not be retried.'
);

export const getOperationalEventsApi = async ({ limit = 100 } = {}) => readPayload(
  await authFetch(`${API_BASE}/api/system/events?limit=${encodeURIComponent(String(limit))}`, { cache:'no-store' }),
  'Operational events could not be loaded.'
);
