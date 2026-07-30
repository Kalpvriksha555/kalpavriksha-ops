import { API_BASE } from '../config/appConfig';
import { authFetch } from './authService';

const parseJson = async (response) => response.json().catch(() => ({}));
const assertOk = async (response, fallback) => {
  const payload = await parseJson(response);
  if (!response.ok) {
    const error = new Error(payload.error || fallback || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = payload.code || '';
    error.payload = payload;
    throw error;
  }
  return payload;
};

export const sendChatMessageApi = async (message = {}) => {
  const flatFile = message.fileId ? {
    id: message.fileId,
    fileId: message.fileId,
    name: message.fileName || 'Attachment',
    mime: message.fileType || '',
    size: Number(message.fileSize || 0),
    url: message.fileUrl || '',
    downloadUrl: message.downloadUrl || ''
  } : null;
  const files = [
    ...(Array.isArray(message.files) ? message.files : []),
    ...(message.file ? [message.file] : []),
    ...(flatFile ? [flatFile] : [])
  ].filter((file, index, all) => file && all.findIndex(item => String(item.id || item.fileId || '') === String(file.id || file.fileId || '')) === index);
  const response = await authFetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      text:message.text || '',
      recipient:message.recipient || 'global',
      caseId:message.caseId || '',
      mentions:message.mentions || [],
      taskRefs:message.taskRefs || [],
      files,
      roomUrl:message.roomUrl || '',
      fileUrl:message.fileUrl || ''
    })
  });
  return assertOk(response, 'Message could not be sent.');
};

export const updateChatMessageApi = async (messageId, patch = {}) => {
  const response = await authFetch(`${API_BASE}/api/chat/${encodeURIComponent(String(messageId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      ...(patch.text !== undefined ? { text:patch.text } : {}),
      ...(patch.deleted !== undefined ? { deleted:Boolean(patch.deleted) } : {}),
      ...(patch.reactions ? { reactions:patch.reactions } : {}),
      ...(patch.readBy ? { readBy:patch.readBy, markRead:true } : {})
    })
  });
  return assertOk(response, 'Message could not be updated.');
};

export const deleteChatMessageApi = async (messageId) => {
  const response = await authFetch(`${API_BASE}/api/chat/${encodeURIComponent(String(messageId))}`, { method:'DELETE' });
  return assertOk(response, 'Message could not be deleted.');
};

export const markChatReadApi = async (activeChannel = '__all__') => {
  const response = await authFetch(`${API_BASE}/api/chat/read`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ activeChannel })
  });
  return assertOk(response, 'Messages could not be marked as read.');
};

export const markNotificationReadApi = async (notificationId) => {
  const response = await authFetch(`${API_BASE}/api/notifications/${encodeURIComponent(String(notificationId))}/read`, { method:'POST' });
  return assertOk(response, 'Notification could not be marked as read.');
};

export const markAllNotificationsReadApi = async () => {
  const response = await authFetch(`${API_BASE}/api/notifications/read-all`, { method:'POST' });
  return assertOk(response, 'Notifications could not be marked as read.');
};


export const createNotificationApi = async (notification = {}) => {
  const response = await authFetch(`${API_BASE}/api/notifications`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({
      targetRole:notification.targetRole || '',
      targetUser:notification.targetUser || '',
      title:notification.title || notification.text || '',
      type:notification.type || 'info',
      category:notification.category || '',
      priority:notification.priority || 'Normal',
      target:notification.target || '',
      caseId:notification.caseId || notification.projectId || ''
    })
  });
  return assertOk(response, 'Notification could not be created.');
};
