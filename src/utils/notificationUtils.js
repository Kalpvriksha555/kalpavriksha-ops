export const NOTIFICATION_CATEGORIES = ['All', 'Task', 'Chat', 'Meeting', 'Attendance', 'System'];

export const getNotificationCategory = (notification = {}) => {
  const title = String(notification.title || '').toLowerCase();
  const type = String(notification.type || '').toLowerCase();
  if (notification.category) return notification.category;
  if (type === 'mention' || title.includes('mentioned') || title.includes('@')) return 'Chat';
  if (title.includes('meeting') || title.includes('call')) return 'Meeting';
  if (title.includes('attendance') || title.includes('break') || title.includes('login') || title.includes('logout')) return 'Attendance';
  if (title.includes('task') || title.includes('case') || title.includes('revision') || title.includes('assigned') || title.includes('completed')) return 'Task';
  return 'System';
};

export const getNotificationPriority = (notification = {}) => {
  const title = String(notification.title || '').toLowerCase();
  const type = String(notification.type || '').toLowerCase();
  if (notification.priority) return notification.priority;
  if (type === 'urgent' || title.includes('urgent') || title.includes('revision')) return 'Critical';
  if (title.includes('assigned') || title.includes('completed') || title.includes('manager review')) return 'High';
  if (type === 'mention') return 'Normal';
  return 'Info';
};

export const buildNotification = ({ targetRole, targetUser, title, type = 'info', id = Date.now(), time, category, priority } = {}) => {
  const base = { id, targetRole, targetUser, title, type, readBy: [], time: time || new Date().toLocaleTimeString() };
  return {
    ...base,
    category: category || getNotificationCategory(base),
    priority: priority || getNotificationPriority(base)
  };
};

const norm = (value = '') => String(value || '').trim().toLowerCase();
const identityKey = (value = '') => norm(value).replace(/[^a-z0-9]/g, '');
export const normalizeNotificationReadName = (entry) => typeof entry === 'string' ? entry : (entry?.name || entry?.username || entry?.id || '');

export const notificationUserKeys = (user = {}) => [user?.name, user?.username, user?.id]
  .filter(Boolean)
  .flatMap(value => [norm(value), identityKey(value)])
  .filter(Boolean);

export const isNotificationReadByUser = (notification = {}, user = {}) => {
  if (!notification || !user) return false;
  const keys = new Set(notificationUserKeys(user));
  if (!keys.size) return false;
  return (notification.readBy || []).some(entry => {
    const name = normalizeNotificationReadName(entry);
    return keys.has(norm(name)) || keys.has(identityKey(name));
  });
};

export const addNotificationReadUser = (notification = {}, user = {}) => {
  if (!notification || !user?.name) return notification;
  if (isNotificationReadByUser(notification, user)) return notification;
  return {
    ...notification,
    readBy: [...(notification.readBy || []), user.name],
    readAt: Date.now()
  };
};

const readByKey = (entry) => identityKey(normalizeNotificationReadName(entry));

export const mergeNotificationRecords = (existing = {}, incoming = {}) => {
  const readMap = new Map();
  [...(existing.readBy || []), ...(incoming.readBy || [])].forEach(entry => {
    const key = readByKey(entry);
    if (key) readMap.set(key, entry);
  });
  const existingUpdated = Number(existing.updatedAt || existing.readAt || 0);
  const incomingUpdated = Number(incoming.updatedAt || incoming.readAt || 0);
  const base = incomingUpdated >= existingUpdated ? { ...existing, ...incoming } : { ...incoming, ...existing };
  return { ...base, readBy: Array.from(readMap.values()) };
};

export const mergeNotificationsByStability = (current = [], incoming = []) => {
  const byId = new Map();
  [...(current || []), ...(incoming || [])].forEach(n => {
    if (!n?.id) return;
    const key = String(n.id);
    byId.set(key, byId.has(key) ? mergeNotificationRecords(byId.get(key), n) : n);
  });
  return Array.from(byId.values())
    .sort((a, b) => Number(b.id || b.createdAt || 0) - Number(a.id || a.createdAt || 0))
    .slice(0, 200);
};

const readName = normalizeNotificationReadName;

const userAliases = notificationUserKeys;

const notificationTargetMatchesUser = (targetUser = '', user = {}) => {
  const target = norm(targetUser);
  const targetKey = identityKey(targetUser);
  if (!target && !targetKey) return false;
  return userAliases(user).some(alias => alias && (alias === target || alias === targetKey));
};

const isChatLikeNotification = (notification = {}) => {
  const category = norm(notification.category);
  const type = norm(notification.type);
  const title = norm(notification.title || notification.message || notification.text);
  return category === 'chat' || ['chat', 'message', 'mention'].includes(type) || /new message|chat message|mentioned|@all/.test(title);
};

const isBroadcastChatNotification = (notification = {}) => {
  const type = norm(notification.type);
  const title = norm(notification.title || notification.message || notification.text);
  return type === 'mention' || /@all|mentioned/.test(title);
};

export const isNotificationForUser = (notification = {}, user = {}) => {
  if (!notification || !user) return false;
  const targetUser = norm(notification.targetUser);
  const targetRole = norm(notification.targetRole);
  const userRole = norm(user.role);

  // Direct chat notifications must have an explicit target user.
  // Older role-wide chat notices caused users to see personal DMs between other people.
  if (isChatLikeNotification(notification)) {
    if (targetUser) return notificationTargetMatchesUser(notification.targetUser, user);
    if (!isBroadcastChatNotification(notification)) return false;
  }

  if (targetUser) return notificationTargetMatchesUser(notification.targetUser, user);
  return !!targetRole && targetRole === userRole;
};

export const isNotificationUnreadForUser = (notification = {}, user = {}) => !isNotificationReadByUser(notification, user);

export const getVisibleNotifications = (notifications = [], user = {}, { unreadOnly = false, limit } = {}) => {
  const visible = (Array.isArray(notifications) ? notifications : [])
    .filter(n => isNotificationForUser(n, user))
    .filter(n => !unreadOnly || isNotificationUnreadForUser(n, user))
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  return typeof limit === 'number' ? visible.slice(0, limit) : visible;
};

export const buildActivityTimeline = (projects = [], chatMessages = [], notifications = []) => {
  const taskEvents = (projects || []).slice(0, 25).flatMap(p => {
    const events = [];
    if (p.createdAt) events.push({ id: `task-created-${p.id}`, at: p.createdAt, label: `${p.id} created for ${p.customerName || p.client || 'customer'}`, type: 'Task' });
    if (p.completedAt) events.push({ id: `task-completed-${p.id}`, at: p.completedAt, label: `${p.id} completed by ${p.assignedTo || 'team'}`, type: 'Task' });
    return events;
  });
  const chatEvents = (chatMessages || []).slice(-25).map(m => ({ id: `chat-${m.id}`, at: m.id || m.createdAt || Date.now(), label: `${m.sender || m.by || 'Team'} sent a chat message`, type: 'Chat' }));
  const notifEvents = (notifications || []).slice(0, 30).map(n => ({ id: `notif-${n.id}`, at: n.id || Date.now(), label: n.title || 'Notification', type: getNotificationCategory(n) }));
  return [...taskEvents, ...chatEvents, ...notifEvents]
    .filter(Boolean)
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
    .slice(0, 18);
};
