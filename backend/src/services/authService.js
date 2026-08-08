import crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const PASSWORD_PREFIX = 'scrypt-v1';

export const normalizeUsername = (value = '') => String(value || '').trim().toLowerCase();
export const normalizeAuthRole = (value = '') => {
  const role = String(value || '').trim().toUpperCase();
  if (role === 'ADMIN') return 'ADMIN';
  if (role === 'MANAGER') return 'MANAGER';
  return 'DESIGNER';
};
export const normalizeAuthStatus = (value = '') => {
  const status = String(value || 'APPROVED').trim().toUpperCase();
  if (status === 'ARCHIVED' || status === 'DELETED') return 'ARCHIVED';
  if (status === 'RESTRICTED' || status === 'BLOCKED' || status === 'DISABLED') return 'RESTRICTED';
  return 'APPROVED';
};

export const passwordPolicyErrors = (password = '') => {
  const value = String(password || '');
  const errors = [];
  if (value.length < 10) errors.push('Password must be at least 10 characters.');
  if (!/[a-z]/.test(value)) errors.push('Password must include a lowercase letter.');
  if (!/[A-Z]/.test(value)) errors.push('Password must include an uppercase letter.');
  if (!/[0-9]/.test(value)) errors.push('Password must include a number.');
  if (/\s/.test(value)) errors.push('Password cannot contain spaces.');
  return errors;
};

export const isWeakLegacyPassword = (password = '') => {
  const value = String(password || '');
  return value.length < 10 || passwordPolicyErrors(value).length > 0 || /^(123|1234|password|admin|kalpavriksha)$/i.test(value);
};

export async function hashPassword(password = '') {
  const value = String(password || '');
  if (!value) throw new Error('Password is required.');
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(value, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return [
    PASSWORD_PREFIX,
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt.toString('base64url'),
    Buffer.from(derived).toString('base64url')
  ].join('$');
}

export async function verifyPassword(password = '', encoded = '') {
  try {
    const [prefix, nRaw, rRaw, pRaw, saltRaw, hashRaw] = String(encoded || '').split('$');
    if (prefix !== PASSWORD_PREFIX || !saltRaw || !hashRaw) return false;
    const options = {
      N: Number(nRaw) || SCRYPT_OPTIONS.N,
      r: Number(rRaw) || SCRYPT_OPTIONS.r,
      p: Number(pRaw) || SCRYPT_OPTIONS.p,
      maxmem: SCRYPT_OPTIONS.maxmem
    };
    const expected = Buffer.from(hashRaw, 'base64url');
    const actual = Buffer.from(await scryptAsync(String(password || ''), Buffer.from(saltRaw, 'base64url'), expected.length, options));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export const randomOpaqueToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const tokenHash = (token = '') => crypto.createHash('sha256').update(String(token || '')).digest('hex');
export const randomOtp = () => String(crypto.randomInt(100000, 1000000));

export const stripCredentialFields = (user = {}) => {
  if (!user || typeof user !== 'object') return user;
  const safe = { ...user };
  [
    'password', 'passwordHash', 'password_hash', 'credential', 'credentials', 'sessionToken',
    'refreshToken', 'resetToken', 'otp', 'secret', 'mustChangePassword'
  ].forEach(field => delete safe[field]);
  return safe;
};

export const publicSessionUser = (user = {}, credential = {}) => {
  const safe = stripCredentialFields(user && typeof user === 'object' ? user : {});
  credential = credential && typeof credential === 'object' ? credential : {};
  const authRole = normalizeAuthRole(safe.role || credential.role || '');
  const displayRole = authRole === 'ADMIN' ? 'Admin' : authRole === 'MANAGER' ? 'Manager' : 'Designer';
  return {
    ...safe,
    id: String(safe.id || credential.user_id || credential.userId || ''),
    username: normalizeUsername(safe.username || credential.username || ''),
    role: displayRole,
    status: normalizeAuthStatus(safe.status || credential.status || ''),
    mustChangePassword: Boolean(credential.must_change_password ?? credential.mustChangePassword),
    passwordChangedAt: credential.password_changed_at || credential.passwordChangedAt || null
  };
};

// The July 30 secure-auth cutover hashes the passwords that already existed in
// the legacy operational snapshot. Those are established employee passwords,
// not temporary passwords created by an administrator. Treating every migrated
// password as temporary locked otherwise-valid users behind an unexpected
// password-change screen and caused authenticated state requests to return 428.
//
// This helper deliberately repairs only credentials that can still be proven to
// come from the read-only legacy snapshot and that have never subsequently had
// their password changed/reset. A later admin password reset has a
// password_changed_at timestamp and therefore remains subject to the normal
// mandatory-change flow.
export const reconcileLegacyCredential = ({ credential = {}, user = {}, legacyCandidate = null } = {}) => {
  const next = {
    ...credential,
    user_id: String(credential.user_id || credential.userId || user.id || '').trim(),
    username: normalizeUsername(user.username || credential.username || ''),
    role: normalizeAuthRole(user.role || credential.role || ''),
    status: normalizeAuthStatus(user.status || credential.status || '')
  };

  const isApprovedLegacyAccount = Boolean(
    legacyCandidate?.password
    && next.status === 'APPROVED'
    && !credential.password_changed_at
    && !credential.passwordChangedAt
  );

  const repairedLegacyMigration = Boolean(isApprovedLegacyAccount && credential.must_change_password);
  if (repairedLegacyMigration) {
    next.must_change_password = false;
    next.failed_attempts = 0;
    next.locked_until = null;
  }

  return { credential: next, repairedLegacyMigration };
};
