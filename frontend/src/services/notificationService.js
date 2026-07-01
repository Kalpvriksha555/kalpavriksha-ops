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

export const isNotificationForUser = (notification = {}, user = {}) => {
  if (!notification || !user) return false;
  return (!notification.targetUser && notification.targetRole === user.role) || notification.targetUser === user.name;
};

export const isNotificationUnreadForUser = (notification = {}, user = {}) => {
  if (!notification || !user?.name) return false;
  return !(notification.readBy || []).includes(user.name);
};

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
