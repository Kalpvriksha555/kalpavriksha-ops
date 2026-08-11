import { API_BASE } from '../config/appConfig';
import { authFetch } from './authService';
import { apiHttpError, readApiRecord } from './apiContractService.js';

const buildOtpError = (error) => {
  if (error?.name === 'TypeError' || String(error?.message || '').toLowerCase().includes('failed to fetch')) {
    return 'The secure OTP service is temporarily unreachable. Check your connection and try again.';
  }
  return error?.message || 'OTP service error.';
};

export const sendRealOtp = async ({ username, mobile, email, channel, purpose }) => {
  try {
    const res = await authFetch(`${API_BASE}/api/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, mobile, email, channel, purpose })
    });
    const data = await readApiRecord(res, { operation:'OTP delivery', requireOk:res.ok });
    if (!res.ok) throw apiHttpError(res, data, 'OTP service is not configured or reachable.');
    return data;
  } catch (error) {
    throw new Error(buildOtpError(error));
  }
};

export const verifyRealOtp = async ({ challengeId, otp, purpose }) => {
  try {
    const res = await authFetch(`${API_BASE}/api/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, otp, purpose })
    });
    const data = await readApiRecord(res, { operation:'OTP verification', requireOk:res.ok });
    if (!res.ok) throw apiHttpError(res, data, 'OTP verification failed.');
    return data;
  } catch (error) {
    throw new Error(buildOtpError(error));
  }
};
