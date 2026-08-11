import { API_BASE } from '../config/appConfig';
import { authFetch } from './authService';
import { asArray, asRecord } from '../utils/runtimeShapeUtils.js';
import { apiHttpError, readApiRecord } from './apiContractService.js';

const parseJson = async (response, operation = 'Communication request') => readApiRecord(response, { operation, requireOk:response.ok });

const transientMutationIds = new WeakMap();
const createMutationId = (prefix = 'mutation') => {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}:${uuid || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
};
const mutationIdFor = (record = {}, prefix = 'mutation', { useRecordId = false } = {}) => {
  const explicit = String(record?.mutationId || record?.clientMutationId || (useRecordId ? record?.id : '') || '').trim();
  if (explicit) return explicit.startsWith(`${prefix}:`) ? explicit : `${prefix}:${explicit}`;
  if (record && typeof record === 'object') {
    const existing = transientMutationIds.get(record);
    if (existing) return existing;
    const created = createMutationId(prefix);
    transientMutationIds.set(record, created);
    return created;
  }
  return createMutationId(prefix);
};
const assertOk = async (response, fallback) => {
  const payload = await parseJson(response, fallback || 'Communication request');
  if (!response.ok) throw apiHttpError(response, payload, fallback || 'Communication request failed.');
  return payload;
};

export const sendChatMessageApi = async (message = {}) => {
  message = message && typeof message === 'object' ? message : {};
  const flatFile = message?.fileId ? {
    id: message?.fileId,
    fileId: message?.fileId,
    name: message?.fileName || 'Attachment',
    mime: message?.fileType || '',
    size: Number(message?.fileSize || 0),
    url: message?.fileUrl || '',
    downloadUrl: message?.downloadUrl || ''
  } : null;
  const files = [
    ...(Array.isArray(message?.files) ? message?.files : []),
    ...(message?.file ? [message?.file] : []),
    ...(flatFile ? [flatFile] : [])
  ].filter((file, index, all) => file && all.findIndex(item => String(item.id || item.fileId || '') === String(file.id || file.fileId || '')) === index);
  const response = await authFetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      mutationId:mutationIdFor(message,'chat',{useRecordId:true}),
      text:message?.text || '',
      recipient:message?.recipient || 'global',
      caseId:message?.caseId || '',
      mentions:asArray(message?.mentions),
      taskRefs:asArray(message?.taskRefs),
      files,
      roomUrl:message?.roomUrl || '',
      fileUrl:message?.fileUrl || ''
    })
  });
  const payload = await assertOk(response, 'Message could not be sent.');
  const saved = asRecord(payload.message);
  if (!saved.id) {
    const error = new Error('Message save was not confirmed with a server message id. Refresh before retrying.');
    error.name = 'ApiContractError';
    error.code = 'CHAT_CONFIRMATION_MISSING';
    error.payload = payload;
    throw error;
  }
  return saved;
};

export const updateChatMessageApi = async (messageId, patch = {}) => {
  patch = patch && typeof patch === 'object' ? patch : {};
  const response = await authFetch(`${API_BASE}/api/chat/${encodeURIComponent(String(messageId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      ...(patch?.text !== undefined ? { text:patch?.text } : {}),
      ...(patch?.deleted !== undefined ? { deleted:Boolean(patch?.deleted) } : {}),
      ...(patch?.reactions ? { reactions:asRecord(patch?.reactions) } : {}),
      ...(patch?.readBy ? { readBy:patch?.readBy, markRead:true } : {})
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
  notification = notification && typeof notification === 'object' ? notification : {};
  const response = await authFetch(`${API_BASE}/api/notifications`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({
      mutationId:mutationIdFor(notification,'notification'),
      targetRole:notification?.targetRole || '',
      targetUser:notification?.targetUser || '',
      title:notification?.title || notification?.text || '',
      type:notification?.type || 'info',
      category:notification?.category || '',
      priority:notification?.priority || 'Normal',
      target:notification?.target || '',
      caseId:notification?.caseId || notification?.projectId || ''
    })
  });
  return assertOk(response, 'Notification could not be created.');
};
