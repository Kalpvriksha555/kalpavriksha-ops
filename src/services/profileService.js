import { API_BASE } from '../config/appConfig';

export const uploadProfilePhoto = async ({ file, user }) => {
  const form = new FormData();
  form.append('photo', file);
  form.append('userId', String(user?.id || ''));
  form.append('username', String(user?.username || ''));

  const res = await fetch(`${API_BASE}/api/profile/photo`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Profile photo upload failed.');
  return data;
};
