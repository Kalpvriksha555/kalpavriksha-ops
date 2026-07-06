import { API_BASE } from '../config/appConfig';

export const normalizePhone = (value = '') => String(value || '').replace(/\D/g, '');

export const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();

export const isValidEmail = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

export const maskEmail = (value = '') => {
  const email = normalizeEmail(value);
  if (!email) return '';
  return email.replace(/(.{2}).+(@.+)/, '$1***$2');
};

export const profilePhotoUrl = (value = '', version = '') => {
  let url = String(value || '').trim();
  if (!url) return '';

  // Data/blob URLs are temporary local previews. Keep them untouched while the
  // user is uploading a new photo. Persisted server URLs are normalized below.
  if (/^(blob:|data:)/i.test(url)) return url;

  const apiBase = String(API_BASE || '').replace(/\/+$/, '');

  // After moving from Render to VPS, some saved profile photos may still carry
  // an old absolute backend URL. If the path is one of our own file endpoints,
  // rebuild it against the current API base instead of trying the old host.
  try {
    if (/^https?:\/\//i.test(url)) {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith('/api/profile/photo/') || parsed.pathname.startsWith('/uploads/')) {
        url = `${parsed.pathname}${parsed.search || ''}`;
      } else {
        return url;
      }
    }
  } catch (_err) {
    // Fall through to normal relative URL handling.
  }

  if (url.startsWith('/uploads/')) url = url.replace('/uploads/', '/api/profile/photo/');
  if (url.startsWith('uploads/')) url = url.replace('uploads/', '/api/profile/photo/');
  if (url.startsWith('api/profile/photo/')) url = `/${url}`;

  const full = url.startsWith('/') ? `${apiBase}${url}` : `${apiBase}/${url.replace(/^\/+/, '')}`;
  return version ? `${full}${full.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}` : full;
};

export const getProfilePhotoVersion = (user = {}) => user.profilePhotoUpdatedAt || user.profileUpdatedAt || '';

export const buildInitialProfileDraft = (user = {}) => ({
  phone: user.phone || '',
  email: user.email || '',
  address: user.address || '',
  aadharNumber: user.aadharNumber || '',
  panNumber: user.panNumber || '',
  emergencyContact: user.emergencyContact || '',
  designation: user.designation || user.role || '',
  bankDetails: user.bankDetails || '',
  profilePhoto: user.profilePhoto || ''
});

export const buildProfileSavePayload = (currentUser = {}, draft = {}) => {
  const phoneChanged = normalizePhone(draft.phone) !== normalizePhone(currentUser.phone);
  const emailChanged = normalizeEmail(draft.email) !== normalizeEmail(currentUser.email);
  return {
    ...currentUser,
    ...draft,
    email: normalizeEmail(draft.email),
    mobileRegistered: phoneChanged ? false : !!currentUser.mobileRegistered,
    emailRegistered: emailChanged ? false : !!currentUser.emailRegistered,
    profileUpdatedAt: Date.now()
  };
};

export const validatePasswordChange = (currentUser = {}, passwordForm = {}) => {
  if ((currentUser.password || '123') !== passwordForm.current) return 'Current password is incorrect.';
  if (!passwordForm.next || passwordForm.next.length < 3) return 'New password must be at least 3 characters.';
  if (passwordForm.next !== passwordForm.confirm) return 'New password and confirm password do not match.';
  return '';
};

export const buildPasswordUpdatePayload = (currentUser = {}, passwordForm = {}) => ({
  ...currentUser,
  password: passwordForm.next,
  passwordUpdatedAt: Date.now()
});

export const buildRegisteredMobilePayload = (currentUser = {}, draft = {}) => ({
  ...currentUser,
  ...draft,
  mobileRegistered: true,
  mobileRegisteredAt: Date.now(),
  profileUpdatedAt: Date.now()
});

export const buildRegisteredEmailPayload = (currentUser = {}, draft = {}) => ({
  ...currentUser,
  ...draft,
  email: normalizeEmail(draft.email),
  emailRegistered: true,
  emailRegisteredAt: Date.now(),
  profileUpdatedAt: Date.now()
});
