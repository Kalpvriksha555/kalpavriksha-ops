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
  if (/^(blob:|data:|https?:\/\/)/i.test(url)) return url;
  if (url.startsWith('/uploads/')) url = url.replace('/uploads/', '/api/profile/photo/');
  if (url.startsWith('uploads/')) url = url.replace('uploads/', '/api/profile/photo/');
  const full = url.startsWith('/') ? `${API_BASE}${url}` : `${API_BASE}/${url.replace(/^\/+/, '')}`;
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
