import { API_BASE } from '../config/appConfig';

const CHAT_API_BASE = API_BASE;

export { CHAT_API_BASE };

export const absoluteChatUrl = (value = '') => {
  if (!value) return '';
  const str = String(value);
  if (/^(blob:|data:|https?:)/i.test(str)) return str;
  return str.startsWith('/') ? `${CHAT_API_BASE}${str}` : `${CHAT_API_BASE}/${str.replace(/^\/+/, '')}`;
};

export const makeMessageId = () => Number(`${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`);

export const QUICK_EMOJIS = ['👍','✅','🙏','😂','❤️','👏','🔥','🎉'];

export const ONLINE_STALE_MS = 2 * 60 * 1000;

export const toMs = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const userLastActivityAt = (user = {}) => Math.max(
  toMs(user.lastHeartbeatAt),
  toMs(user.lastSeenAt),
  toMs(user.lastLoginAt),
  toMs(user.availabilityUpdatedAt)
);

export const isUserActuallyOnline = (user = {}, nowMs = Date.now()) => {
  if (!user || !user.isOnline) return false;
  const lastActivity = userLastActivityAt(user);
  return !!lastActivity && (nowMs - lastActivity) <= ONLINE_STALE_MS;
};

export const normalizeRole = (role = '') => {
  const value = String(role || '').trim().toUpperCase();
  if (value === 'ADMIN') return 'Admin';
  if (value === 'MANAGER') return 'Manager';
  if (value === 'DESIGNER') return 'Designer';
  return role || '';
};

export const normalizeStatus = (status = 'APPROVED') => String(status || 'APPROVED').trim().toUpperCase() || 'APPROVED';

export const ROLES = { ADMIN: 'Admin', MANAGER: 'Manager', DESIGNER: 'Designer' };

export const normalizeChatUser = (u = {}) => {
  const rawName = String(u.name || '').trim();
  const rawUsername = String(u.username || '').trim();
  const isKhushbu = /khus+h?bu|khushboo|khushbu/i.test(rawName) || /khus+h?bu|khushboo|khushbu/i.test(rawUsername);
  const isWaqar = /ali\s*waqar|^ali$|^waqar$/i.test(rawName) || /ali|waqar/i.test(rawUsername);
  return {
    ...u,
    name: isKhushbu ? 'Khushbu Pandey' : (isWaqar ? 'Waqar' : (rawName || u.name)),
    username: isKhushbu ? 'khushbu' : (isWaqar ? 'waqar' : rawUsername),
    role: normalizeRole(u.role),
    status: normalizeStatus(u.status),
    lastSeenAt: u.lastSeenAt || u.lastLogoutAt || null
  };
};

export const isSystemPlaceholderUser = (u = {}) => /operations\s*manager/i.test(String(u.name || '')) || String(u.id || '') === 'u-manager';
export const hasValidTeamRole = (u = {}) => [ROLES.ADMIN, ROLES.MANAGER, ROLES.DESIGNER].includes(normalizeRole(u.role));
export const isApprovedUser = (u = {}) => normalizeStatus(u.status) === 'APPROVED' && hasValidTeamRole(u) && !isSystemPlaceholderUser(u);

export const getOperationalUsers = (users = [], { includeAdmins = true } = {}) => (users || [])
  .map(normalizeChatUser)
  .filter(u => isApprovedUser(u) && (includeAdmins || u.role !== ROLES.ADMIN))
  .sort((a, b) => {
    const roleOrder = { [ROLES.ADMIN]: 0, [ROLES.MANAGER]: 1, [ROLES.DESIGNER]: 2 };
    return (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) || String(a.name).localeCompare(String(b.name));
  });

export const normalizePersonName = (name = '') => normalizeChatUser({ name, username: name }).name || name;
export const identityKey = (value = '') => normalizePersonName(String(value || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
export const samePerson = (a = '', b = '') => identityKey(a) === identityKey(b);
export const normalizeChannelKey = (channel) => channel === 'global' ? 'global' : identityKey(channel);
export const readEntryName = (entry) => typeof entry === 'string' ? entry : (entry?.name || '');
export const hasReadBy = (message, userName) => (message?.readBy || []).some(r => samePerson(readEntryName(r), userName));

export const chatEmojiGroups = [
  { label: 'Quick reactions', emojis: ['👍','❤️','😂','😮','😢','👏','🎉','🔥','✅','👀','🙏','🤝','🙌','💯','⭐','✨'] },
  { label: 'Smileys', emojis: ['😀','😃','😄','😁','😊','🙂','😉','😎','🤩','😅','🤣','😂','🥹','😍','😘','😇','🤔','🫡','🤫','😐','🙄','😮','😯','😴','😢','😭','😡','😤','🤯'] },
  { label: 'Work', emojis: ['📌','📎','📝','📁','📂','📄','📊','📈','📉','🗂️','🧾','🖊️','🧮','🏗️','🏠','📐','📏','🧱','💼','📅','⏰','⏳','🔔','💬','📞','🎥'] },
  { label: 'Status', emojis: ['✅','☑️','✔️','❌','⚠️','🚨','🔴','🟠','🟡','🟢','🔵','🟣','⬆️','⬇️','➡️','🔁','🔄','📍','🎯','🚀','🏁','🔒','🔓'] },
  { label: 'Celebration', emojis: ['🎉','🥳','🏆','🥇','🙌','👏','💪','🔥','⭐','✨','💯','🌟','🎊','🍰','☕','🌈'] },
];

export const reactionEmojis = ['👍','❤️','😂','😮','😢','👏','🎉','🔥','✅','👀','🙏','🤝','🙌','💯','⭐','✨','⚠️','🚀'];
