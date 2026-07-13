import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, X, Phone, Video, Square, Mic, Smile, Paperclip, Send, Search, User, Star, Hash, AlertCircle, File as FileIcon, ExternalLink, ClipboardList } from 'lucide-react';
import { formatLastSeenDateTime } from '../../utils/date';
import { createSafeMeetingRoomName, buildJitsiUrl } from '../../utils/meeting';
import { copyTextToClipboard } from '../../utils/clipboard';
import { MiniEmptyState } from '../shared';
import { getVisibleNotifications } from '../../services/notificationService';
import { formatTaskId } from '../../utils/taskDisplayUtils';
import { CHAT_API_BASE, absoluteChatUrl, makeMessageId, QUICK_EMOJIS, isUserActuallyOnline, getOperationalUsers, identityKey, samePerson, readEntryName, ROLES, normalizeChannelKey, chatEmojiGroups, reactionEmojis } from '../../utils/chatUtils';

export const CommunicationHub = ({ currentUser, users, chatMessages, onSendMessage, onDeleteMessage, onUpdateMessage, onMarkMessagesRead, appId, projects = [], onOpenTaskReference, onPreviewFile }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [presenceNow, setPresenceNow] = useState(Date.now());
  const [activeChannel, setActiveChannel] = useState('global');
  const [msg, setMsg] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [callAudioOnly, setCallAudioOnly] = useState(false);
  const [callShareScreen, setCallShareScreen] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState(null);
  const [callNow, setCallNow] = useState(Date.now());
  const [callCopied, setCallCopied] = useState(false);
  const [chatSearch, setChatSearch] = useState('');
  const [showLatestButton, setShowLatestButton] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceStartedAt, setVoiceStartedAt] = useState(null);
  const [voiceNow, setVoiceNow] = useState(Date.now());
  const [uploadingAttachment, setUploadingAttachment] = useState(null);
  const [forwardMessageData, setForwardMessageData] = useState(null);
  const [actionMenu, setActionMenu] = useState(null);
  const [reactionMenu, setReactionMenu] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const mediaRecorderRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceCancelRef = useRef(false);
  const chatEndRef = useRef(null);
  const chatScrollRef = useRef(null);
  const composerRef = useRef(null);
  const localReadKey = `kalpa_chat_read_${currentUser?.id || identityKey(currentUser?.name || '')}`;
  const hiddenKey = `kalpa_chat_hidden_${currentUser?.id || identityKey(currentUser?.name || '')}`;
  const pinnedKey = `kalpa_chat_pinned_${currentUser?.id || identityKey(currentUser?.name || '')}`;
  const [localReadState, setLocalReadState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(localReadKey) || '{}'); } catch(e) { return {}; }
  });
  const [hiddenMessageIds, setHiddenMessageIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem(hiddenKey) || '[]'); } catch(e) { return []; }
  });
  const [pinnedMessageIds, setPinnedMessageIds] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(pinnedKey) || '[]'); return Array.isArray(saved) ? saved.map(String) : []; } catch(e) { return []; }
  });
  const readThroughRef = useRef(localReadState);
  const chatUsers = getOperationalUsers(users || [], { includeAdmins: true }).filter(u => !samePerson(u.name, currentUser.name));
  const liveCurrentUser = getOperationalUsers(users || [], { includeAdmins: true }).find(u => samePerson(u.name, currentUser.name)) || currentUser;
  const currentUserOnline = isUserActuallyOnline(liveCurrentUser, presenceNow);
  const currentUserAliases = [currentUser?.name, currentUser?.username, currentUser?.id].filter(Boolean);
  const currentUserAliasKeys = currentUserAliases.flatMap(alias => [identityKey(alias), String(alias || '').trim().toLowerCase()]).filter(Boolean);
  const sameCurrentUser = (value = '') => {
    const key = identityKey(value);
    const raw = String(value || '').trim().toLowerCase();
    return !!(key || raw) && currentUserAliasKeys.some(alias => alias === key || alias === raw);
  };
  const sameChatIdentity = (value = '', user = {}) => {
    const key = identityKey(value);
    const raw = String(value || '').trim().toLowerCase();
    return [user?.name, user?.username, user?.id].filter(Boolean).some(alias => identityKey(alias) === key || String(alias || '').trim().toLowerCase() === raw);
  };
  const hasReadByCurrentUser = (message = {}) => (message?.readBy || []).some(entry => sameCurrentUser(readEntryName(entry)));
  const sameChannelIdentity = (value = '', channel = activeChannel) => {
    if (channel === 'global') return String(value || 'global') === 'global' || !value;
    const user = chatUsers.find(u => sameChatIdentity(channel, u));
    return samePerson(value, channel) || (!!user && sameChatIdentity(value, user));
  };
  const activePeer = activeChannel === 'global' ? null : chatUsers.find(u => sameChatIdentity(activeChannel, u));
  const activePeerOnline = activePeer ? isUserActuallyOnline(activePeer, presenceNow) : false;
  const activeCallRoom = activePeer ? createSafeMeetingRoomName('KalpaVriksha_DM', appId || 'kalpavriksha_production_v1', ...[currentUser.name, activePeer.name].sort()) : '';
  const activeCallUrl = activePeer ? buildJitsiUrl(activeCallRoom, currentUser.name, { audioOnly: callAudioOnly, shareScreen: callShareScreen }) : '';

  const normalizeTaskToken = (value = '') => String(value || '').replace(/^#/, '').trim().toUpperCase();
  const getTaskDisplayId = (project = {}) => formatTaskId(project.id || project.caseId || '');
  const taskLookup = React.useMemo(() => {
    const map = new Map();
    (projects || []).forEach(project => {
      [project?.id, project?.caseId].filter(Boolean).forEach(key => map.set(normalizeTaskToken(key), project));
    });
    return map;
  }, [projects]);

  const resolveTaskReferences = (text = '', explicitRefs = []) => {
    const found = new Map();
    const addProject = (project) => {
      if (!project) return;
      const key = normalizeTaskToken(project.id || project.caseId);
      if (key && !found.has(key)) found.set(key, project);
    };

    (explicitRefs || []).forEach(ref => {
      const key = normalizeTaskToken(ref?.id || ref?.caseId || ref?.taskId);
      addProject(taskLookup.get(key) || (ref && (ref.id || ref.caseId || ref.taskId) ? ref : null));
    });

    const haystack = ` ${String(text || '').toUpperCase()} `;
    (projects || []).forEach(project => {
      const ids = [project?.id, project?.caseId].filter(Boolean).map(normalizeTaskToken);
      if (ids.some(id => id && (haystack.includes(`#${id}`) || haystack.includes(` ${id} `) || haystack.includes(`\n${id} `) || haystack.includes(` ${id}\n`)))) addProject(project);
    });

    return Array.from(found.values()).slice(0, 5);
  };

  const openTaskFromChat = (project) => {
    if (!project) return;
    if (typeof onOpenTaskReference === 'function') onOpenTaskReference(project);
    else window.dispatchEvent(new CustomEvent('kalpa:open-task-reference', { detail: { projectId: project.id || project.caseId || '', project } }));
    setActionMenu(null);
    setReactionMenu(null);
  };

  const buildTaskRefsForMessage = (text = '') => resolveTaskReferences(text).map(project => ({
    id: project.id || project.caseId || '',
    caseId: project.caseId || project.id || '',
    customerName: project.customerName || '',
    location: project.location || project.city || '',
    bank: project.client || project.bankName || project.bank || '',
    status: project.status || '',
    assignedTo: project.assignedTo || project.assigneeName || ''
  }));

  const moveComposerCaretToEnd = (value = '') => {
    const target = composerRef.current;
    if (!target) return;
    const position = String(value || '').length;
    target.focus?.();
    try { target.setSelectionRange(position, position); } catch(e) {}
  };

  const appendToComposerSafely = (textToAppend = '') => {
    let nextValue = '';
    setMsg(prev => {
      const base = String(prev || '').trimEnd();
      nextValue = base ? `${base} ${textToAppend}` : textToAppend;
      return nextValue;
    });
    window.requestAnimationFrame(() => moveComposerCaretToEnd(nextValue));
    window.setTimeout(() => moveComposerCaretToEnd(nextValue), 80);
  };

  useEffect(() => {
    const openTaskDiscussion = (event) => {
      const detail = event?.detail || {};
      const project = detail.project || taskLookup.get(normalizeTaskToken(detail.projectId));
      const taskId = getTaskDisplayId(project) || String(detail.projectId || '').trim();
      if (!taskId) return;
      setActiveChannel('global');
      setIsOpen(true);
      setEditingMessage(null);
      setReplyTo(null);
      setForwardMessageData(null);
      setChatSearch('');
      const assignedMention = project?.assignedTo && !String(project.assignedTo).toLowerCase().includes('unassigned') ? ` @${project.assignedTo}` : '';
      appendToComposerSafely(`#${taskId}${assignedMention} `);
    };
    window.addEventListener('kalpa:discuss-task', openTaskDiscussion);
    return () => window.removeEventListener('kalpa:discuss-task', openTaskDiscussion);
  }, [taskLookup]);

  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(localReadKey) || '{}'); readThroughRef.current = saved; setLocalReadState(saved); } catch(e) { readThroughRef.current = {}; setLocalReadState({}); }
  }, [localReadKey]);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(hiddenKey) || '[]'); setHiddenMessageIds(Array.isArray(saved) ? saved : []); } catch(e) { setHiddenMessageIds([]); }
  }, [hiddenKey]);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(pinnedKey) || '[]'); setPinnedMessageIds(Array.isArray(saved) ? saved.map(String) : []); } catch(e) { setPinnedMessageIds([]); }
  }, [pinnedKey]);
  useEffect(() => {
    const timer = setInterval(() => setPresenceNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setCallNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!isRecordingVoice) return;
    const timer = setInterval(() => setVoiceNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isRecordingVoice]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('kalpa-mobile-chat-open', !!isOpen);
    return () => document.body.classList.remove('kalpa-mobile-chat-open');
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !chatSearch) chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [isOpen, chatMessages.length, activeChannel, isCalling, chatSearch]);
  useEffect(() => {
    if (!isOpen || !chatScrollRef.current) return;
    const el = chatScrollRef.current;
    const onScroll = () => setShowLatestButton(el.scrollHeight - el.scrollTop - el.clientHeight > 180);
    el.addEventListener('scroll', onScroll);
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [isOpen, activeChannel, isCalling]);

  useEffect(() => {
    if (!isOpen) {
      setActionMenu(null);
      setReactionMenu(null);
      return;
    }
    const closeMenus = () => {
      setActionMenu(null);
      setReactionMenu(null);
    };
    window.addEventListener('resize', closeMenus);
    window.addEventListener('orientationchange', closeMenus);
    return () => {
      window.removeEventListener('resize', closeMenus);
      window.removeEventListener('orientationchange', closeMenus);
    };
  }, [isOpen]);

  const savePinnedMessageIds = (nextIds = []) => {
    const clean = [...new Set((nextIds || []).map(String).filter(Boolean))].slice(-20);
    setPinnedMessageIds(clean);
    try { localStorage.setItem(pinnedKey, JSON.stringify(clean)); } catch(e) {}
  };

  const isPinnedMessage = (m) => pinnedMessageIds.includes(String(m?.id || ''));

  const togglePinMessage = (m) => {
    if (!m?.id) return;
    const id = String(m.id);
    const next = isPinnedMessage(m) ? pinnedMessageIds.filter(x => x !== id) : [...pinnedMessageIds, id];
    savePinnedMessageIds(next);
    setActionMenu(null);
  };

  const jumpToPinnedMessage = (id) => {
    const safeId = String(id || '').replace(/"/g, '\"');
    const container = chatScrollRef.current;
    const target = container?.querySelector?.(`[data-message-id="${safeId}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const markCurrentChannelReadNow = (channel = activeChannel) => {
    const key = normalizeChannelKey(channel);
    setLocalReadState(prev => {
      const now = Date.now() + 1000;
      const next = { ...prev, [key]: now };
      readThroughRef.current = { ...readThroughRef.current, [key]: now };
      try { localStorage.setItem(localReadKey, JSON.stringify(next)); } catch(e) {}
      return next;
    });
    if (typeof onMarkMessagesRead === 'function') onMarkMessagesRead(channel);
  };

  const isMessageInActiveChannel = (m) => {
    if (activeChannel === 'global') return m.recipient === 'global' || !m.recipient;
    return (sameChannelIdentity(m.sender, activeChannel) && sameCurrentUser(m.recipient)) || (sameCurrentUser(m.sender) && sameChannelIdentity(m.recipient, activeChannel));
  };

  useEffect(() => {
    if (isOpen) markCurrentChannelReadNow(activeChannel);
  }, [isOpen, activeChannel, chatMessages.length]);

  const isGlobalMessage = (m = {}) => String(m.recipient || '').trim().toLowerCase() === 'global' || !String(m.recipient || '').trim();
  const isDirectMessageForCurrentUser = (m = {}) => {
    if (!m || isGlobalMessage(m)) return false;
    return sameCurrentUser(m.sender) || sameCurrentUser(m.recipient);
  };
  const isIncomingDirectToCurrentUser = (m = {}) => {
    if (!m || isGlobalMessage(m)) return false;
    return !sameCurrentUser(m.sender) && sameCurrentUser(m.recipient);
  };
  const isMessageForCurrentUser = (m = {}) => {
    if (!m || m.deleted || hiddenMessageIds.includes(String(m.id))) return false;
    if (isGlobalMessage(m)) return true;
    return isDirectMessageForCurrentUser(m);
  };
  const getMessageChannelForCurrentUser = (m = {}) => {
    if (isGlobalMessage(m)) return 'global';
    if (!isDirectMessageForCurrentUser(m)) return 'global';
    if (sameCurrentUser(m.sender)) return m.recipient || 'global';
    return m.sender || 'global';
  };

  const unreadMessages = (chatMessages || []).filter(m => {
    if (!isMessageForCurrentUser(m)) return false;
    if (m.callType || m.roomUrl) return false;
    if (sameCurrentUser(m.sender)) return false;
    if (!isGlobalMessage(m) && !isIncomingDirectToCurrentUser(m)) return false;
    const channelKey = isGlobalMessage(m) ? 'global' : identityKey(m.sender);
    const cutoff = Math.max(Number(localReadState[channelKey] || 0), Number(readThroughRef.current?.[channelKey] || 0));
    const sentAt = Number(m.sentAt || m.id || 0);
    if (sentAt && cutoff && sentAt <= cutoff) return false;
    if (hasReadByCurrentUser(m)) return false;
    if (isOpen && isMessageInActiveChannel(m)) return false;
    return true;
  });
  const unreadGlobalCount = (isOpen && activeChannel === 'global') ? 0 : unreadMessages.filter(m => m.recipient === 'global' || !m.recipient).length;

  const getDirectUnreadCountForUser = (userName) => {
    const channelKey = identityKey(userName);
    const cutoff = Math.max(Number(localReadState[channelKey] || 0), Number(readThroughRef.current?.[channelKey] || 0));
    return (chatMessages || []).filter(m => {
      if (!m || m.deleted || hiddenMessageIds.includes(String(m.id))) return false;
      if (m.callType || m.roomUrl) return false;
      if (!sameChatIdentity(m.sender, { name: userName, username: userName }) || !isIncomingDirectToCurrentUser(m)) return false;
      const sentAt = Number(m.sentAt || m.id || 0);
      if (sentAt && cutoff && sentAt <= cutoff) return false;
      if (isOpen && sameChannelIdentity(userName, activeChannel)) return false;
      if (hasReadByCurrentUser(m)) return false;
      return true;
    }).length;
  };

  const unreadDirectTotal = chatUsers.reduce((sum, u) => sum + getDirectUnreadCountForUser(u.name), 0);
  const totalUnreadCount = unreadMessages.length;
  const latestUnreadMessage = unreadMessages.slice().sort((a, b) => Number(b.sentAt || b.id || 0) - Number(a.sentAt || a.id || 0))[0];

  const getConversationLabel = (channel = activeChannel) => {
    if (channel === 'global') return 'Global Chat';
    const user = chatUsers.find(u => sameChatIdentity(channel, u));
    return user?.name || channel || 'Direct Chat';
  };

  const getMessagePreviewText = (m = {}) => {
    if (!m) return '';
    if (m.deleted) return 'Message was deleted';
    if (m.isVoiceNote) return '🎙️ Voice note';
    if (m.fileName) return `📎 ${m.fileName}`;
    return String(m.text || 'Message').replace(/\s+/g, ' ').trim();
  };

  const openConversationForMessage = (m) => {
    if (!m) return;
    const target = getMessageChannelForCurrentUser(m);
    setActiveChannel(target || 'global');
    setIsCalling(false);
    setIsOpen(true);
    setShowEmojiPicker(false);
    setActionMenu(null);
    setReactionMenu(null);
    window.setTimeout(() => {
      markCurrentChannelReadNow(target || 'global');
      const safeId = String(m.id || '').replace(/"/g, '\"');
      const targetEl = chatScrollRef.current?.querySelector?.(`[data-message-id="${safeId}"]`);
      if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 200);
  };
  const hasUnreadGlobalMention = unreadMessages.some(m => (m.recipient === 'global' || !m.recipient) && (m.text?.includes(`@${currentUser.name}`) || m.text?.includes('@all')));

  useEffect(() => {
    if (hasUnreadGlobalMention && !isOpen) {
      const latestMention = unreadMessages.filter(m => (m.recipient === 'global' || !m.recipient) && (m.text?.includes(`@${currentUser.name}`) || m.text?.includes('@all'))).pop();
      if (latestMention && latestMention.id > (currentUser.lastMentionRead || 0)) {
        setIsOpen(true);
        setActiveChannel('global');
        currentUser.lastMentionRead = latestMention.id;
      }
    }
  }, [chatMessages, hasUnreadGlobalMention, isOpen]);

  const addEmojiToMessage = (emoji) => {
    appendToComposerSafely(`${emoji} `);
  };

  const clearComposerContext = () => {
    setReplyTo(null);
    setEditingMessage(null);
    setShowMentions(false);
    setShowEmojiPicker(false);
  };

  const handleSend = () => {
    const text = msg.trim();
    if (!text) return;
    const now = makeMessageId();
    const nowText = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    if (editingMessage) {
      const updated = { ...editingMessage, text, edited: true, editedAt: now, time: editingMessage.time || nowText };
      if (typeof onUpdateMessage === 'function') onUpdateMessage(updated);
      setMsg('');
      clearComposerContext();
      return;
    }
    const senderRole = users.find(u => samePerson(u.name, currentUser.name))?.role || '';
    const newMsg = {
      id: now,
      text,
      sender: currentUser.name,
      senderRole,
      recipient: activeChannel,
      time: nowText,
      sentAt: now,
      replyTo: replyTo ? { id: replyTo.id, sender: replyTo.sender, text: replyTo.text || replyTo.fileName || 'Attachment' } : null,
      taskRefs: buildTaskRefsForMessage(text),
      reactions: {},
      readBy: [{ name: currentUser.name, time: nowText }]
    };
    onSendMessage(newMsg);
    setMsg('');
    clearComposerContext();
    currentUser.lastChatRead = now;
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setMsg(val);
    if (activeChannel === 'global' && val.endsWith('@')) setShowMentions(true);
    else if (!val.includes('@')) setShowMentions(false);
  };

  const insertMention = (name) => {
    const nextValue = String(msg || '').slice(0, -1) + `@${name} `;
    setMsg(nextValue);
    setShowMentions(false);
    window.requestAnimationFrame(() => moveComposerCaretToEnd(nextValue));
  };

  const createBaseMessage = (overrides = {}) => {
    const now = makeMessageId();
    const senderRole = users.find(u => samePerson(u.name, currentUser.name))?.role || '';
    return {
      id: now,
      sender: currentUser.name,
      senderRole,
      recipient: activeChannel,
      time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
      sentAt: now,
      readBy: [{ name: currentUser.name, time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }],
      reactions: {},
      ...overrides
    };
  };


  const uploadChatFileToServer = async (file, type = 'chat') => {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    form.append('by', currentUser?.name || 'Team');
    form.append('role', currentUser?.role || 'USER');
    const res = await fetch(`${CHAT_API_BASE}/api/files/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(await res.text());
    const payload = await res.json();
    return payload.file || {};
  };

  const buildAttachmentMessage = (fileMeta = {}, fallback = {}, extra = {}) => {
    const fileName = fileMeta.name || fallback.name || 'Attachment';
    const fileType = fileMeta.mime || fileMeta.mimeType || fallback.type || '';
    const fileSize = fileMeta.size || fallback.size || 0;
    const previewUrl = getInlineChatPreviewUrl(fileMeta.previewUrl || fileMeta.url || fallback.url || fileMeta.downloadUrl || '');
    const downloadUrl = fileMeta.downloadUrl
      ? absoluteChatUrl(fileMeta.downloadUrl)
      : absoluteChatUrl(fileMeta.downloadUrl || fileMeta.url || fallback.url || previewUrl || '');
    const url = previewUrl || downloadUrl;
    const fileRecord = {
      ...fileMeta,
      id: fileMeta.id || fallback.id,
      name: fileName,
      storedName: fileMeta.storedName,
      mime: fileType,
      mimeType: fileType,
      size: fileSize,
      // url/previewUrl are always inline-safe; downloadUrl is the only attachment path.
      url: previewUrl || fileMeta.previewUrl || fileMeta.url || fallback.url || '',
      previewUrl: previewUrl || fileMeta.previewUrl || fileMeta.url || fallback.url || '',
      downloadUrl: downloadUrl || fileMeta.downloadUrl || ''
    };
    return createBaseMessage({
      text: extra.text || `Shared attachment: ${fileName}`,
      fileName,
      fileUrl: url,
      downloadUrl,
      fileType,
      fileSize,
      files: [fileRecord],
      localPreviewOnly: !!extra.localPreviewOnly,
      uploadStatus: extra.uploadStatus || 'ready',
      taskRefs: extra.taskRefs || buildTaskRefsForMessage(extra.text || ''),
      replyTo: replyTo ? { id: replyTo.id, sender: replyTo.sender, text: replyTo.text || replyTo.fileName || 'Attachment' } : null,
      ...extra
    });
  };

  const handleChatFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setUploadingAttachment({ name: file.name, size: file.size || 0, type: file.type || '' });
    try {
      const fileMeta = await uploadChatFileToServer(file, 'chat');
      onSendMessage(buildAttachmentMessage(fileMeta, { name: file.name, type: file.type, size: file.size, url: previewUrl }));
    } catch (error) {
      console.error('Chat attachment upload failed, sending local preview only:', error);
      onSendMessage(buildAttachmentMessage({}, { name: file.name, type: file.type, size: file.size, url: previewUrl }, { localPreviewOnly: true, uploadStatus: 'local-only', text: `Shared attachment: ${file.name}` }));
    } finally {
      setUploadingAttachment(null);
      setReplyTo(null);
      if (e?.target) e.target.value = '';
    }
  };

  const startVoiceRecording = async () => {
    try {
      if (!navigator?.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        alert('Voice notes are not supported in this browser.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceCancelRef.current = false;
      voiceChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        setIsRecordingVoice(false);
        setVoiceStartedAt(null);
        if (voiceCancelRef.current) {
          voiceCancelRef.current = false;
          voiceChunksRef.current = [];
          return;
        }
        if (!blob.size) return;
        const createdAt = makeMessageId();
        const file = new File([blob], `voice-note-${createdAt}.webm`, { type: blob.type || 'audio/webm' });
        const previewUrl = URL.createObjectURL(blob);
        setUploadingAttachment({ name: file.name, size: blob.size, type: file.type, voice: true });
        try {
          const fileMeta = await uploadChatFileToServer(file, 'chat');
          onSendMessage(buildAttachmentMessage(fileMeta, { name: file.name, type: file.type, size: blob.size, url: previewUrl }, { id: createdAt, text: '🎙️ Shared voice note', sentAt: createdAt, isVoiceNote: true }));
        } catch (error) {
          console.error('Voice note upload failed, sending local preview only:', error);
          onSendMessage(buildAttachmentMessage({}, { name: file.name, type: file.type, size: blob.size, url: previewUrl }, { id: createdAt, text: '🎙️ Shared voice note', sentAt: createdAt, localPreviewOnly: true, uploadStatus: 'local-only', isVoiceNote: true }));
        } finally {
          setUploadingAttachment(null);
        }
      };
      recorder.start();
      setVoiceStartedAt(Date.now());
      setVoiceNow(Date.now());
      setIsRecordingVoice(true);
    } catch (error) {
      console.error('Voice note recording failed', error);
      setIsRecordingVoice(false);
      setVoiceStartedAt(null);
      alert('Microphone permission is needed to record a voice note.');
    }
  };

  const stopVoiceRecording = () => {
    try {
      voiceCancelRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else { setIsRecordingVoice(false); setVoiceStartedAt(null); }
    } catch (error) {
      console.error('Voice note stop failed', error);
      setIsRecordingVoice(false);
      setVoiceStartedAt(null);
    }
  };

  const cancelVoiceRecording = () => {
    try {
      voiceCancelRef.current = true;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else {
        setIsRecordingVoice(false);
        setVoiceStartedAt(null);
        voiceChunksRef.current = [];
      }
    } catch (error) {
      console.error('Voice note cancel failed', error);
      setIsRecordingVoice(false);
      setVoiceStartedAt(null);
      voiceChunksRef.current = [];
      voiceCancelRef.current = false;
    }
  };

  const startCall = (audioOnly = false, shareScreen = false) => {
    if (!activePeer) return;
    setCallAudioOnly(audioOnly);
    setCallShareScreen(shareScreen);
    setCallStartedAt(Date.now());
    setIsCalling(true);
    const room = createSafeMeetingRoomName('KalpaVriksha_DM', appId || 'kalpavriksha_production_v1', ...[currentUser.name, activePeer.name].sort());
    const url = buildJitsiUrl(room, currentUser.name, { audioOnly, shareScreen });
    onSendMessage(createBaseMessage({
      text: shareScreen ? `🖥️ Started screen sharing / help session` : (audioOnly ? `📞 Started an Audio Call` : `📹 Started a Video Call`),
      recipient: activePeer.name,
      callType: shareScreen ? 'screen' : (audioOnly ? 'audio' : 'video'),
      roomUrl: url,
    }));
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyCallLink = async () => {
    if (!activeCallUrl) return;
    const ok = await copyTextToClipboard(activeCallUrl);
    setCallCopied(ok);
    window.setTimeout(() => setCallCopied(false), 1800);
  };

  const handleMessageKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const updateMessage = (m) => {
    if (typeof onUpdateMessage === 'function') onUpdateMessage(m);
  };

  const isMobileViewport = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(max-width: 640px)')?.matches || window.innerWidth <= 640;
  };

  const openActionMenu = (event, m) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!m) return;
    setShowEmojiPicker(false);
    setReactionMenu(null);

    const mobile = isMobileViewport();
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 360;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 640;
    const menuWidth = mobile ? Math.min(256, Math.max(220, viewportW - 28)) : 224;
    const menuHeight = mobile ? 330 : 390;
    const safePad = mobile ? 12 : 12;

    const triggerRect = event?.currentTarget?.getBoundingClientRect?.();
    const point = event?.changedTouches?.[0] || event?.touches?.[0] || event;
    const fallbackX = point?.clientX || event?.clientX || Math.round(viewportW / 2);
    const fallbackY = point?.clientY || event?.clientY || Math.round(viewportH / 2);
    const centerX = triggerRect ? (triggerRect.left + triggerRect.width / 2) : fallbackX;
    const topY = triggerRect ? triggerRect.top : fallbackY;
    const bottomY = triggerRect ? triggerRect.bottom : fallbackY;

    let x;
    if (mobile) {
      const isRightSideMessage = centerX > viewportW / 2;
      x = isRightSideMessage
        ? (triggerRect ? triggerRect.right : fallbackX) - menuWidth
        : (triggerRect ? triggerRect.left : fallbackX);
    } else if (centerX > viewportW / 2) {
      x = (triggerRect ? triggerRect.left : fallbackX) - menuWidth - 8;
    } else {
      x = (triggerRect ? triggerRect.right : fallbackX) + 8;
    }
    x = Math.min(Math.max(safePad, x), Math.max(safePad, viewportW - menuWidth - safePad));

    let y;
    const spaceBelow = viewportH - bottomY;
    const spaceAbove = topY;
    if (mobile) {
      // WhatsApp-style: prefer a compact floating card directly above the tapped message.
      // If there isn't enough room, place it below while keeping it inside the viewport.
      if (spaceAbove >= menuHeight + safePad) y = topY - menuHeight - 8;
      else if (spaceBelow >= menuHeight + safePad) y = bottomY + 8;
      else y = Math.min(Math.max(safePad, topY - Math.round(menuHeight / 2)), Math.max(safePad, viewportH - menuHeight - safePad));
    } else if (spaceBelow >= menuHeight + safePad) y = bottomY + 8;
    else if (spaceAbove >= menuHeight + safePad) y = topY - menuHeight - 8;
    else y = Math.min(Math.max(safePad, topY - 96), Math.max(safePad, viewportH - menuHeight - safePad));

    setActionMenu({
      id: m.id || m.messageId || m.sentAt || `${m.sender || 'msg'}-${m.time || Date.now()}`,
      x,
      y,
      width: menuWidth,
      mobile,
      message: m,
      openedAt: Date.now()
    });
  };

  const openReactionMenu = (event, m) => {
    event?.stopPropagation?.();
    const mobile = isMobileViewport();
    const menuWidth = mobile ? 316 : 360;
    const menuHeight = mobile ? 136 : 96;
    const safePad = mobile ? 12 : 12;
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;
    const rect = event?.currentTarget?.getBoundingClientRect?.();

    // Prefer the clicked React option button, then the already-open message action menu,
    // then the raw pointer position. This keeps the picker visible above the chatbox instead
    // of being clipped/hidden behind the composer.
    const baseX = rect ? rect.left : (actionMenu?.x || event?.clientX || Math.round(viewportW / 2));
    const baseY = rect ? rect.top : (actionMenu?.y || event?.clientY || Math.round(viewportH / 2));
    const baseRight = rect ? rect.right : baseX + 48;
    const baseBottom = rect ? rect.bottom : baseY + 44;

    let x = mobile ? baseX : baseRight + 8;
    if (!mobile && baseX > viewportW / 2) x = baseX - menuWidth - 8;
    x = Math.min(Math.max(safePad, x), Math.max(safePad, viewportW - menuWidth - safePad));

    const spaceAbove = baseY;
    const spaceBelow = viewportH - baseBottom;
    let y;
    if (mobile) {
      // WhatsApp-like floating picker: prefer above the action menu/message; fall back below.
      if (spaceAbove >= menuHeight + safePad) y = baseY - menuHeight - 8;
      else if (spaceBelow >= menuHeight + safePad) y = baseBottom + 8;
      else y = Math.min(Math.max(safePad, baseY - 80), Math.max(safePad, viewportH - menuHeight - safePad));
    } else if (spaceBelow >= menuHeight + safePad) y = baseBottom + 8;
    else if (spaceAbove >= menuHeight + safePad) y = baseY - menuHeight - 8;
    else y = Math.min(Math.max(safePad, baseY - 48), Math.max(safePad, viewportH - menuHeight - safePad));

    setActionMenu(null);
    setReactionMenu({
      id: m.id || m.messageId || m.sentAt || `${m.sender || 'msg'}-${m.time || Date.now()}`,
      x,
      y,
      width: menuWidth,
      mobile,
      message: m,
      openedAt: Date.now()
    });
  };

  const findMessageByMenu = (menu) => {
    if (!menu) return null;
    if (menu.message) return menu.message;
    return (chatMessages || []).find(m => String(m.id || m.messageId || m.sentAt || `${m.sender || 'msg'}-${m.time || ''}`) === String(menu.id));
  };

  const activeActionMessage = findMessageByMenu(actionMenu);
  const activeReactionMessage = findMessageByMenu(reactionMenu);
  const canUsePortal = typeof document !== 'undefined' && document.body;
  const closeMessageMenus = () => { setActionMenu(null); setReactionMenu(null); };


  const renderMessageOptions = (m) => {
    const handleOpen = (e) => openActionMenu(e, m);
    return (
      <button
        type="button"
        onPointerDown={(e) => { e.stopPropagation(); }}
        onPointerUp={(e) => { e.stopPropagation(); if (e.pointerType && e.pointerType !== 'mouse') handleOpen(e); }}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => { e.stopPropagation(); handleOpen(e); }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => handleOpen(e)}
        className="kalpa-message-options-trigger mt-1 shrink-0 w-10 h-10 sm:w-8 sm:h-8 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-200 shadow-sm flex items-center justify-center opacity-100 text-xl leading-none touch-manipulation select-none"
        aria-label="Message options"
        title="Message options"
        style={{ pointerEvents: 'auto', position: 'relative', zIndex: 60, touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
      >
        ⋮
      </button>
    );
  };

  const replyToMessage = (m) => {
    setReplyTo(m);
    setEditingMessage(null);
    setActionMenu(null);
    composerRef.current?.focus?.();
  };

  const editMessage = (m) => {
    if (!sameCurrentUser(m.sender)) return;
    setEditingMessage(m);
    setReplyTo(null);
    setMsg(m.text || '');
    setActionMenu(null);
    composerRef.current?.focus?.();
  };

  const forwardMessage = (m) => {
    setEditingMessage(null);
    setReplyTo(null);
    setForwardMessageData(m);
    setActionMenu(null);
  };

  const sendForwardTo = (target) => {
    const source = forwardMessageData;
    if (!source) return;
    const now = makeMessageId();
    const summary = source.text || source.fileName || 'Attachment';
    const forwarded = createBaseMessage({
      id: now,
      recipient: target,
      sentAt: now,
      text: `↗ Forwarded from ${source.sender}: ${summary}`,
      forwardedFrom: { id: source.id, sender: source.sender, text: summary },
      fileName: source.fileName || '',
      fileUrl: source.fileUrl || '',
      downloadUrl: source.downloadUrl || '',
      fileType: source.fileType || '',
      fileSize: source.fileSize || 0,
      files: source.files || [],
      roomUrl: source.roomUrl || '',
      callType: source.callType || ''
    });
    onSendMessage(forwarded);
    setForwardMessageData(null);
    setActiveChannel(target);
  };

  const copyMessage = async (m) => {
    await copyTextToClipboard(m.text || m.fileName || '');
    setActionMenu(null);
  };

  const deleteForMe = (m) => {
    const next = Array.from(new Set([...(hiddenMessageIds || []).map(String), String(m.id)]));
    setHiddenMessageIds(next);
    try { localStorage.setItem(hiddenKey, JSON.stringify(next)); } catch(e) {}
    setActionMenu(null);
  };

  const deleteForEveryone = (m) => {
    if (!(sameCurrentUser(m.sender) || currentUser.role === ROLES.ADMIN)) return;
    if (!window.confirm('Delete this message for everyone?')) return;
    if (typeof onUpdateMessage === 'function') {
      updateMessage({ ...m, deleted: true, text: 'This message was deleted.', fileUrl: '', fileName: '', fileType: '', roomUrl: '', deletedBy: currentUser.name, deletedAt: Date.now() });
    } else if (typeof onDeleteMessage === 'function') {
      onDeleteMessage(m.id);
    }
    setActionMenu(null);
  };

  const toggleReaction = (m, emoji) => {
    const reactions = { ...(m.reactions || {}) };
    const names = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];
    const already = names.some(n => samePerson(n, currentUser.name));
    reactions[emoji] = already ? names.filter(n => !samePerson(n, currentUser.name)) : [...names, currentUser.name];
    if (!reactions[emoji].length) delete reactions[emoji];
    updateMessage({ ...m, reactions });
    setReactionMenu(null);
  };

  const renderMessageText = (text) => {
    if (!text) return null;
    const knownTaskIds = Array.from(taskLookup.keys()).filter(Boolean).sort((a, b) => b.length - a.length);
    const escapedTaskPattern = knownTaskIds.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const mentionNames = Array.from(new Set([currentUser?.name, ...(users || []).map(u => u.name), 'all'].filter(Boolean)));
    const escapeForRegex = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentionPattern = mentionNames.map(name => `@${escapeForRegex(name)}`).join('|');
    const pattern = escapedTaskPattern ? new RegExp(`(#?(?:${escapedTaskPattern})|${mentionPattern})`, 'gi') : new RegExp(`(${mentionPattern})`, 'gi');
    const parts = String(text).split(pattern).filter(part => part !== '');
    return parts.map((part, i) => {
      const lower = part.toLowerCase();
      const task = taskLookup.get(normalizeTaskToken(part));
      if (task) return <button key={i} type="button" onClick={(e) => { e.stopPropagation(); openTaskFromChat(task); }} className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 rounded-md font-extrabold align-baseline bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-100"><ClipboardList className="w-3 h-3" />#{getTaskDisplayId(task)}</button>;
      if (lower === `@all`) return <strong key={i} className="inline-flex items-center text-red-700 bg-red-100 px-1.5 py-0.5 rounded-md font-extrabold">{part}</strong>;
      if (lower.startsWith('@')) {
        const mentioned = (users || []).find(u => samePerson(part.slice(1), u.name) || samePerson(part.slice(1), u.username));
        const isMe = samePerson(part.slice(1), currentUser?.name) || samePerson(part.slice(1), currentUser?.username);
        return <strong key={i} className={`inline-flex items-center px-1.5 py-0.5 rounded-md font-extrabold ${isMe ? 'text-purple-700 bg-purple-100' : 'text-indigo-700 bg-indigo-50'}`}>{mentioned ? `@${mentioned.name}` : part}</strong>;
      }
      return part;
    });
  };

  const renderTaskReferenceCards = (message = {}, isMine = false) => {
    const refs = resolveTaskReferences(message.text || '', message.taskRefs || []);
    if (!refs.length) return null;
    return (
      <div className="mt-3 space-y-2">
        {refs.map(task => {
          const taskId = getTaskDisplayId(task);
          return (
            <button
              key={`${message.id || 'msg'}-${taskId}`}
              type="button"
              onClick={(e) => { e.stopPropagation(); openTaskFromChat(task); }}
              className={`w-full text-left rounded-2xl border p-3 transition-all shadow-sm ${isMine ? 'bg-white/10 border-white/20 hover:bg-white/20 text-white' : 'bg-indigo-50 border-indigo-100 hover:border-indigo-300 text-slate-800'}`}
              title="Open this task"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-[10px] font-black uppercase tracking-widest ${isMine ? 'text-indigo-100' : 'text-indigo-600'}`}>Task reference</p>
                  <p className="text-sm font-black truncate">#{taskId}</p>
                  <p className={`text-xs font-bold truncate mt-1 ${isMine ? 'text-white/80' : 'text-slate-500'}`}>{task.customerName || 'Customer'}{task.location || task.city ? ` • ${task.location || task.city}` : ''}</p>
                  <p className={`text-[10px] font-bold uppercase tracking-wider mt-1 ${isMine ? 'text-indigo-100' : 'text-slate-400'}`}>{task.client || task.bankName || task.bank || 'Bank not added'} • {task.status || 'Status not set'}</p>
                </div>
                <ExternalLink className={`w-4 h-4 shrink-0 mt-1 ${isMine ? 'text-white/80' : 'text-indigo-500'}`} />
              </div>
            </button>
          );
        })}
      </div>
    );
  };


  const renderComposerTaskPreview = () => {
    const refs = resolveTaskReferences(msg || '');
    if (!refs.length) return null;
    return (
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/80 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Task reference ready</p>
          <span className="text-[10px] font-black text-indigo-400">Protected task tag</span>
        </div>
        {refs.map(task => {
          const taskId = getTaskDisplayId(task);
          return (
            <button
              key={`composer-${taskId}`}
              type="button"
              onClick={() => openTaskFromChat(task)}
              className="w-full text-left rounded-xl bg-white border border-indigo-100 hover:border-indigo-300 px-3 py-2 shadow-sm transition-all"
              title="Open this task now"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-800 truncate">#{taskId}</p>
                  <p className="text-xs font-bold text-slate-500 truncate">{task.customerName || 'Customer'}{task.location || task.city ? ` • ${task.location || task.city}` : ''}</p>
                </div>
                <ExternalLink className="w-4 h-4 shrink-0 text-indigo-500" />
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  const getReadableFileSize = (bytes) => {
    const size = Number(bytes || 0);
    if (!size) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  };

  const getAttachmentLabel = (name = '', type = '') => {
    const lower = String(name).toLowerCase();
    if (String(type).startsWith('audio/') || /\.(webm|mp3|wav|m4a|ogg)$/i.test(lower)) return 'Voice note';
    if (String(type).startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(lower)) return 'Image';
    if (String(type).startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/i.test(lower)) return 'Video';
    if (/\.pdf$/i.test(lower)) return 'PDF';
    if (/\.(xls|xlsx|csv)$/i.test(lower)) return 'Sheet';
    if (/\.(doc|docx)$/i.test(lower)) return 'Document';
    if (/\.(ppt|pptx)$/i.test(lower)) return 'Presentation';
    if (/\.(dwg|dxf)$/i.test(lower)) return 'Drawing';
    return 'File';
  };


  const getInlineChatPreviewUrl = (url = '') => {
    const absolute = absoluteChatUrl(url || '');
    if (!absolute) return '';
    if (/^(blob:|data:)/i.test(absolute)) return absolute;
    if (/\/api\/files\/[^/?#]+\/download(?:$|[?#])/i.test(absolute)) return absolute.replace(/\/download(?=($|[?#]))/i, '/preview');
    if (/\/api\/files\/[^/?#]+(?:$|[?#])/i.test(absolute) && !/[?&]mode=preview/i.test(absolute)) {
      const [base, hash = ''] = absolute.split('#');
      const cleaned = base.replace(/([?&])mode=download(&|$)/i, '$1').replace(/[?&]$/, '');
      return `${cleaned}${cleaned.includes('?') ? '&' : '?'}mode=preview${hash ? `#${hash}` : ''}`;
    }
    if (/\/api\/uploads\/[^/?#]+(?:$|[?#])/i.test(absolute) && !/[?&]mode=preview/i.test(absolute)) {
      const [base, hash = ''] = absolute.split('#');
      const cleaned = base.replace(/([?&])mode=download(&|$)/i, '$1').replace(/[?&]$/, '');
      return `${cleaned}${cleaned.includes('?') ? '&' : '?'}mode=preview${hash ? `#${hash}` : ''}`;
    }
    return absolute;
  };

  const getAttachmentFileRecord = (m = {}) => {
    const first = m.files?.[0] || {};
    const fileName = m.fileName || first.name || 'Attachment';
    const fileType = m.fileType || first.mime || first.mimeType || '';
    const rawPreview = first.previewUrl || m.previewUrl || first.url || m.fileUrl || m.downloadUrl || first.downloadUrl || '';
    const rawDownload = m.downloadUrl || first.downloadUrl || first.url || m.fileUrl || rawPreview;
    const previewUrl = getInlineChatPreviewUrl(rawPreview);
    const downloadUrl = absoluteChatUrl(rawDownload || '');
    return {
      ...first,
      id: first.fileId || first.id || m.fileId || m.id,
      fileId: first.fileId || first.id || m.fileId,
      name: fileName,
      fileName,
      mime: fileType,
      mimeType: fileType,
      size: m.fileSize || first.size || 0,
      url: previewUrl,
      previewUrl,
      downloadUrl,
    };
  };

  const renderAttachmentPreview = (m, isMine) => {
    const fileRecord = getAttachmentFileRecord(m);
    const previewUrl = fileRecord.previewUrl || fileRecord.url || '';
    const downloadUrl = fileRecord.downloadUrl || previewUrl || '';
    if (!previewUrl && !downloadUrl) return null;
    const fileName = fileRecord.name || 'Attachment';
    const fileType = fileRecord.mimeType || fileRecord.mime || '';
    const lower = String(fileName).toLowerCase();
    const isImage = String(fileType).startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(lower);
    const isVideo = String(fileType).startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/i.test(lower);
    const isAudio = String(fileType).startsWith('audio/') || /\.(webm|mp3|wav|m4a|ogg)$/i.test(lower);
    const isPdf = /\.pdf$/i.test(lower) || String(fileType).includes('pdf');
    const label = getAttachmentLabel(fileName, fileType);
    const previewHandler = typeof onPreviewFile === 'function'
      ? onPreviewFile
      : (typeof window !== 'undefined' && typeof window.__kalpaOpenFilePreview === 'function' ? window.__kalpaOpenFilePreview : null);
    const canInlinePreview = (isImage || isPdf) && typeof previewHandler === 'function' && Boolean(previewUrl || downloadUrl);
    const handlePreviewClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (canInlinePreview) {
        previewHandler({ ...fileRecord, previewUrl: previewUrl || fileRecord.previewUrl, url: previewUrl || fileRecord.url, downloadUrl });
        return;
      }
      alert('Preview is not ready yet. Please try again after the file finishes syncing.');
    };
    const handleDownloadClick = (event) => {
      event.stopPropagation();
      if (!downloadUrl) return;
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = fileName;
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    };
    return (
      <div className={`kalpa-chat-attachment mt-3 rounded-2xl border overflow-hidden ${isMine ? 'border-indigo-300 bg-indigo-500/20' : 'border-slate-100 bg-slate-50'}`}>
        {isImage && previewUrl && (
          <button type="button" onClick={handlePreviewClick} className="block w-full bg-black/5 cursor-zoom-in" title="Preview image">
            <img src={previewUrl} alt={fileName} loading="lazy" className="kalpa-chat-attachment-image block max-h-64 w-full object-contain" />
          </button>
        )}
        {isVideo && <video src={previewUrl || downloadUrl} controls preload="metadata" className="block max-h-64 w-full bg-black" />}
        {isAudio && <div className="p-3"><div className={`text-[10px] font-black uppercase tracking-widest mb-2 ${isMine ? 'text-indigo-100' : 'text-indigo-600'}`}>{m.isVoiceNote ? 'Voice note' : 'Audio attachment'}</div><audio src={previewUrl || downloadUrl} controls preload="metadata" className="w-full" /></div>}
        {!isImage && !isVideo && !isAudio && (
          <div className={`p-4 flex items-center gap-3 ${isMine ? 'bg-indigo-500/20' : 'bg-white'}`}>
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${isMine ? 'bg-white/15 text-white' : 'bg-indigo-50 text-indigo-600'}`}><FileIcon className="w-5 h-5" /></div>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-black truncate ${isMine ? 'text-white' : 'text-slate-800'}`}>{fileName}</p>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${isMine ? 'text-indigo-100' : 'text-slate-400'}`}>{label}{getReadableFileSize(fileRecord.size) ? ` • ${getReadableFileSize(fileRecord.size)}` : ''}</p>
            </div>
          </div>
        )}
        {isPdf && (
          <div className={`px-3 pb-3 ${isMine ? 'bg-indigo-500/20' : 'bg-white'}`}>
            <button type="button" onClick={handlePreviewClick} className={`w-full h-32 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 transition-colors ${isMine ? 'border-indigo-200/60 bg-white/10 text-white hover:bg-white/15' : 'border-indigo-100 bg-indigo-50/60 text-indigo-700 hover:bg-indigo-50'}`}>
              <FileIcon className="w-7 h-7" />
              <span className="text-xs font-black">Preview PDF in Kalpavriksha Ops</span>
              <span className="text-[10px] font-bold opacity-70">No automatic browser download</span>
            </button>
          </div>
        )}
        <div className={`p-3 flex items-center justify-between gap-3 border-t ${isMine ? 'border-indigo-300/40' : 'border-slate-100'}`}>
          <div className="min-w-0 flex items-center gap-2">
            <FileIcon className={`w-4 h-4 shrink-0 ${isMine ? 'text-white' : 'text-indigo-500'}`} />
            <div className="min-w-0">
              <p className={`text-xs font-black truncate ${isMine ? 'text-white' : 'text-slate-700'}`}>{fileName}</p>
              <p className={`text-[10px] font-bold ${isMine ? 'text-indigo-100' : 'text-slate-400'}`}>{label} {getReadableFileSize(fileRecord.size) ? `• ${getReadableFileSize(fileRecord.size)}` : ''}{m.localPreviewOnly ? ' • local preview' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(isImage || isPdf) && <button type="button" onClick={handlePreviewClick} className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${isMine ? 'bg-white/90 text-slate-700' : 'bg-white text-indigo-700 border border-indigo-100'}`}>Preview</button>}
            {!(isImage || isPdf) && <button type="button" onClick={handleDownloadClick} className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${isMine ? 'bg-white/90 text-slate-700' : 'bg-white text-indigo-700 border border-indigo-100'}`}>Open</button>}
            {downloadUrl && <button type="button" onClick={handleDownloadClick} className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${isMine ? 'bg-white text-indigo-700' : 'bg-indigo-600 text-white'}`}>Download</button>}
          </div>
        </div>
      </div>
    );
  };

  const channelMessages = (chatMessages || []).filter(m => {
    if (!isMessageForCurrentUser(m)) return false;
    if (activeChannel === 'global') return isGlobalMessage(m);
    return (sameCurrentUser(m.sender) && sameChannelIdentity(m.recipient, activeChannel)) || (sameChannelIdentity(m.sender, activeChannel) && sameCurrentUser(m.recipient));
  }).sort((a, b) => Number(a.sentAt || a.id || 0) - Number(b.sentAt || b.id || 0));
  const searchKey = chatSearch.trim().toLowerCase();
  const displayMessages = searchKey
    ? channelMessages.filter(m => `${m.text || ''} ${m.fileName || ''} ${m.sender || ''}`.toLowerCase().includes(searchKey))
    : channelMessages;
  const pinnedMessages = channelMessages.filter(m => isPinnedMessage(m) && !m.deleted).slice(-5);

  return (
    <div className={`kalpa-chat-shell ${isOpen ? 'kalpa-chat-shell-open' : 'kalpa-chat-shell-closed'} fixed bottom-6 right-6 z-50 flex flex-col items-end`} style={{ maxWidth: 'calc(100vw - 24px)' }}>
      <style>{`
        @media (max-width: 640px) {
          .kalpa-inline-message-options[open]::before {
            content: "";
            position: fixed;
            inset: 0;
            background: rgba(15, 23, 42, 0.42);
            backdrop-filter: blur(2px);
            z-index: 2147483000;
          }
          .kalpa-inline-message-options[open] > summary {
            position: relative;
            z-index: 2147483002;
          }
          .kalpa-inline-message-options[open] > .kalpa-message-options-menu {
            position: fixed !important;
            left: max(10px, env(safe-area-inset-left)) !important;
            right: max(10px, env(safe-area-inset-right)) !important;
            bottom: max(10px, env(safe-area-inset-bottom)) !important;
            top: auto !important;
            width: auto !important;
            max-width: none !important;
            max-height: min(72vh, 520px);
            overflow-y: auto;
            z-index: 2147483001 !important;
            border-radius: 24px 24px 20px 20px !important;
            padding: 8px;
            box-shadow: 0 -20px 60px rgba(15, 23, 42, 0.28), 0 12px 24px rgba(15, 23, 42, 0.18);
            transform: translateZ(0);
          }
          .kalpa-inline-message-options[open] > .kalpa-message-options-menu::before {
            content: "";
            display: block;
            width: 48px;
            height: 5px;
            border-radius: 999px;
            background: #cbd5e1;
            margin: 4px auto 8px;
          }
          .kalpa-inline-message-options[open] > .kalpa-message-options-menu button {
            min-height: 48px;
            font-size: 15px;
            border-radius: 16px;
          }
          html.dark .kalpa-inline-message-options[open] > .kalpa-message-options-menu,
          body.dark .kalpa-inline-message-options[open] > .kalpa-message-options-menu,
          .dark .kalpa-inline-message-options[open] > .kalpa-message-options-menu {
            background: #0f172a;
            border-color: rgba(148, 163, 184, 0.22);
          }
          html.dark .kalpa-inline-message-options[open] > .kalpa-message-options-menu button,
          body.dark .kalpa-inline-message-options[open] > .kalpa-message-options-menu button,
          .dark .kalpa-inline-message-options[open] > .kalpa-message-options-menu button {
            color: #e5e7eb;
          }
        }
      `}</style>

      {isOpen && (
        <div
          className="kalpa-chat-panel bg-white rounded-3xl shadow-2xl border-2 border-slate-100 mb-4 overflow-hidden flex flex-row animate-in slide-in-from-bottom-5" role="dialog" aria-label="Team chat"
          style={{ width: 'min(1080px, calc(100vw - 48px))', height: 'min(620px, calc(100vh - 96px))', maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 96px)' }}
        >
          <div className="kalpa-chat-sidebar shrink-0 bg-slate-50 border-r border-slate-100 flex flex-col" style={{ width: 300, minWidth: 280, maxWidth: 320 }}>
            <div className="p-4 bg-indigo-600 border-b border-indigo-700">
              <h3 className="text-white font-extrabold flex items-center"><MessageSquare className="w-4 h-4 mr-2" /> Team Chat <span title={currentUserOnline ? 'You are online' : 'You are offline'} className={`ml-2 w-2.5 h-2.5 rounded-full ${currentUserOnline ? 'bg-emerald-300' : 'bg-slate-300'}`}></span></h3>
              <p className="text-indigo-100 text-[10px] font-bold mt-1 uppercase tracking-widest">Global • Direct • Files • Voice</p>
            </div>
            <div className="kalpa-chat-channel-strip flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', overscrollBehaviorX: 'contain' }}>
              <button type="button" onClick={() => { setActiveChannel('global'); setIsCalling(false); setShowEmojiPicker(false); setActionMenu(null); setReactionMenu(null); currentUser.lastChatRead = Date.now(); markCurrentChannelReadNow('global'); }} className={`w-full text-left px-4 py-3 rounded-xl font-bold flex items-center justify-between transition-colors ${activeChannel === 'global' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-200'}`}>
                <span className="flex items-center"><Hash className="w-4 h-4 mr-2"/> Global Chat</span>
                {unreadGlobalCount > 0 && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">{unreadGlobalCount}</span>}
              </button>
              <div className="pt-4 pb-2 px-4 text-xs font-black text-slate-400 uppercase tracking-widest flex items-center justify-between"><span>Direct Messages</span><span className="text-[10px] text-slate-300">{chatUsers.length}</span></div>
              {chatUsers.length === 0 && <div className="mx-3 mb-2"><MiniEmptyState>No team members found</MiniEmptyState></div>}
              {chatUsers.map(u => {
                const unreadDMCount = getDirectUnreadCountForUser(u.name);
                return (
                  <button type="button" key={u.id} onClick={() => { setActiveChannel(u.name); setIsCalling(false); setShowEmojiPicker(false); setActionMenu(null); setReactionMenu(null); currentUser.lastChatRead = Date.now(); markCurrentChannelReadNow(u.name); }} className={`w-full text-left px-4 py-3 rounded-xl font-bold flex items-center justify-between transition-colors ${samePerson(activeChannel, u.name) ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-200'}`}>
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="truncate flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${isUserActuallyOnline(u, presenceNow) ? (u.availability === 'Break' ? 'bg-amber-400' : 'bg-emerald-500') : 'bg-slate-300'}`}></span>{u.name}</span>
                      <span className="text-[10px] text-slate-400 uppercase truncate">{isUserActuallyOnline(u, presenceNow) ? (u.availability === 'Break' ? 'On break' : 'Available to chat') : `Offline${u.lastSeenAt || u.lastLogoutAt || u.lastHeartbeatAt ? ` • ${formatLastSeenDateTime(u.lastSeenAt || u.lastLogoutAt || u.lastHeartbeatAt)}` : ''}`} • {u.role}</span>
                    </div>
                    {unreadDMCount > 0 && (
                      <span title={`You have ${unreadDMCount} unread personal message${unreadDMCount > 1 ? 's' : ''} from ${u.name}`} className="flex items-center gap-1 bg-amber-400 text-amber-950 text-[10px] px-2 py-0.5 rounded-full shadow-sm animate-pulse shrink-0 border border-amber-300"><Star className="w-3 h-3 fill-current" /> {unreadDMCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 flex flex-col min-w-0 relative bg-white">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
              <div className="min-w-0">
                <h3 className="font-extrabold text-slate-800 flex items-center truncate">
                  {activeChannel === 'global' ? <><Hash className="w-5 h-5 mr-2 text-slate-400" /> Global Team Chat</> : <><span className={`w-2.5 h-2.5 rounded-full mr-2 ${activePeerOnline ? 'bg-emerald-500' : 'bg-slate-300'}`}></span><User className="w-5 h-5 mr-2 text-indigo-500" /> {activeChannel}</>}
                </h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{activeChannel === 'global' ? 'Everyone can see these messages' : activePeerOnline ? 'Online now' : 'Direct private conversation'}</p>
              </div>
              <div className="flex items-center gap-2">
                {activeChannel !== 'global' && <>
                  <button type="button" onClick={() => startCall(true)} className="p-2 rounded-xl bg-slate-50 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600" title="Audio call"><Phone className="w-4 h-4" /></button>
                  <button type="button" onClick={() => startCall(false)} className="p-2 rounded-xl bg-slate-50 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600" title="Video call"><Video className="w-4 h-4" /></button>
                  <button type="button" onClick={() => startCall(false, true)} className="px-3 py-2 rounded-xl bg-slate-50 hover:bg-indigo-50 text-xs font-black text-slate-500 hover:text-indigo-600">Share screen</button>
                </>}
                <button type="button" onClick={() => { setIsOpen(false); markCurrentChannelReadNow(activeChannel); currentUser.lastChatRead = Date.now(); }} className="kalpa-chat-close-btn text-slate-500 hover:text-slate-700 p-2 bg-slate-50 rounded-full transition-colors ml-2" aria-label="Close chat"><X className="w-5 h-5" /></button>
              </div>
            </div>

            {isCalling ? (
              <div className="flex-1 bg-slate-900 flex flex-col min-h-0">
                <div className="p-3 bg-slate-800 text-white flex items-center justify-between">
                  <div><p className="text-sm font-black">{callShareScreen ? 'Screen share session' : (callAudioOnly ? 'Audio call' : 'Video meeting')} with {activeChannel}</p><p className="text-[10px] text-slate-300">{callStartedAt ? `${Math.floor((callNow - callStartedAt)/60000)}m ${Math.floor(((callNow - callStartedAt)%60000)/1000)}s` : 'Ready'}</p></div>
                  <div className="flex gap-2"><button type="button" onClick={() => window.open(activeCallUrl, '_blank', 'noopener,noreferrer')} className="px-3 py-2 rounded-lg bg-white/10 text-xs font-black">Open tab</button><button type="button" onClick={handleCopyCallLink} className="px-3 py-2 rounded-lg bg-white/10 text-xs font-black">{callCopied ? 'Copied' : 'Copy link'}</button><button type="button" onClick={() => setIsCalling(false)} className="px-3 py-2 rounded-lg bg-red-500 text-xs font-black">End</button></div>
                </div>
                <div className="flex-1 flex items-center justify-center p-6 text-center text-white">
                  <div className="max-w-sm">
                    <p className="text-lg font-black mb-2">Meeting opened in a new browser tab</p>
                    <p className="text-xs font-semibold text-slate-300">This keeps screen sharing reliable. If the tab did not open, click Open tab above.</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="px-4 py-2 bg-white border-b border-slate-100 flex items-center gap-2 shrink-0">
                  <Search className="w-4 h-4 text-slate-300" />
                  <input value={chatSearch} onChange={(e) => setChatSearch(e.target.value)} placeholder="Search this chat..." className="flex-1 bg-transparent text-xs font-semibold text-slate-600 placeholder:text-slate-300 focus:outline-none" />
                  {chatSearch && <button type="button" onClick={() => setChatSearch('')} className="text-[10px] font-black text-slate-400 hover:text-slate-600">CLEAR</button>}
                </div>
                {pinnedMessages.length > 0 && (
                  <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 shrink-0">
                    <div className="flex items-center justify-between mb-2"><p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Pinned messages</p><span className="text-[10px] font-black text-amber-600">{pinnedMessages.length}</span></div>
                    <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                      {pinnedMessages.map(pm => <button key={`pin-${pm.id}`} type="button" onClick={() => jumpToPinnedMessage(pm.id)} className="shrink-0 max-w-[220px] text-left bg-white border border-amber-100 rounded-xl px-3 py-2 shadow-sm hover:border-amber-300"><p className="text-[10px] font-black text-amber-700 truncate">{pm.sender}</p><p className="text-xs font-bold text-slate-600 truncate">{pm.text || pm.fileName || 'Pinned attachment'}</p></button>)}
                    </div>
                  </div>
                )}
                <div ref={chatScrollRef} className="kalpa-chat-messages flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50 custom-scrollbar relative" style={{ minHeight: 0, overflowX: 'hidden' }} onClick={(e) => { if (e.target === e.currentTarget) { setActionMenu(null); setReactionMenu(null); } }}>
                  {displayMessages.length === 0 && <p className="text-center text-sm text-slate-400 mt-10 font-medium">Say hello to {activeChannel === 'global' ? 'the team' : activeChannel}!</p>}
                  {displayMessages.map((m, idx) => {
                    const isMine = sameCurrentUser(m.sender);
                    const showName = idx === 0 || !samePerson(displayMessages[idx-1].sender, m.sender);
                    const reactions = Object.entries(m.reactions || {}).filter(([, names]) => Array.isArray(names) && names.length);
                    const pinned = isPinnedMessage(m);
                    return (
                      <div key={m.id} data-message-id={String(m.id)} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} ${pinned ? 'scroll-mt-24' : ''}`}>
                        {showName && !isMine && <span className={`text-[11px] font-black uppercase tracking-wider ml-1 mb-1 ${m.senderRole === ROLES.ADMIN ? 'text-indigo-600' : 'text-slate-500'}`}>{m.sender}</span>}
                        <div className="relative group flex items-start gap-2" onContextMenu={(e) => openActionMenu(e, m)}>
                          {isMine && renderMessageOptions(m)}
                          <div className={`kalpa-chat-bubble px-4 py-2.5 rounded-2xl text-[15px] font-medium leading-relaxed shadow-sm relative break-words ${pinned ? 'ring-2 ring-amber-300' : ''} ${isMine ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'}`} style={{ maxWidth: m.fileUrl ? 'min(520px, 84vw)' : 'min(620px, 78vw)', minWidth: 0, overflow: 'visible' }}>
                            {pinned && <span className={`absolute -top-2 ${isMine ? 'right-3 bg-amber-200 text-amber-900' : 'left-3 bg-amber-100 text-amber-700'} text-[9px] font-black px-2 py-0.5 rounded-full border border-amber-200`}>PINNED</span>}
                            {m.replyTo && <button type="button" onClick={() => jumpToPinnedMessage(m.replyTo.id)} className={`w-full text-left mb-2 border-l-4 pl-2 py-1 rounded ${isMine ? 'border-white/70 bg-indigo-500/30' : 'border-indigo-300 bg-indigo-50'}`}><p className={`text-[10px] font-black ${isMine ? 'text-indigo-100' : 'text-indigo-600'}`}>Replying to {m.replyTo.sender}</p><p className={`text-xs truncate ${isMine ? 'text-white/90' : 'text-slate-500'}`}>{m.replyTo.text}</p></button>}
                            {m.forwardedFrom && <div className={`mb-2 border-l-4 pl-2 py-1 rounded ${isMine ? 'border-white/70 bg-indigo-500/30' : 'border-amber-300 bg-amber-50'}`}><p className={`text-[10px] font-black ${isMine ? 'text-indigo-100' : 'text-amber-700'}`}>Forwarded from {m.forwardedFrom.sender}</p><p className={`text-xs truncate ${isMine ? 'text-white/90' : 'text-slate-500'}`}>{m.forwardedFrom.text}</p></div>}
                            <div className={m.deleted ? 'italic opacity-75' : ''}>{renderMessageText(m.text)} {m.edited && !m.deleted && <span className={`text-[10px] ml-1 ${isMine ? 'text-indigo-100' : 'text-slate-400'}`}>(edited)</span>}</div>
                            {!m.deleted && renderTaskReferenceCards(m, isMine)}
                            {m.roomUrl && (
                              <div className={`mt-3 rounded-xl p-3 border ${isMine ? 'bg-indigo-500/30 border-indigo-300' : 'bg-indigo-50 border-indigo-100'}`}>
                                <p className={`text-xs font-black mb-2 ${isMine ? 'text-white' : 'text-indigo-800'}`}>{m.callType === 'audio' ? 'Audio call invite' : m.callType === 'screen' ? 'Screen sharing invite' : 'Video call invite'}</p>
                                <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setCallAudioOnly(m.callType === 'audio'); setActiveChannel(sameCurrentUser(m.sender) ? m.recipient : m.sender); setIsCalling(true); }} className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${isMine ? 'bg-white text-indigo-700' : 'bg-indigo-600 text-white'}`}>Join</button><button type="button" onClick={() => window.open(m.roomUrl, '_blank', 'noopener,noreferrer')} className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${isMine ? 'bg-white/80 text-slate-700' : 'bg-white text-indigo-700 border border-indigo-100'}`}>Open</button></div>
                              </div>
                            )}
                            {!m.deleted && renderAttachmentPreview(m, isMine)}
                          </div>
                          {!isMine && renderMessageOptions(m)}
                        </div>
                        {reactions.length > 0 && <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>{reactions.map(([emoji, names]) => <button key={`${m.id}-${emoji}`} type="button" onClick={(e) => openReactionMenu(e, m)} title={(names || []).join(', ')} className="bg-white border border-slate-200 rounded-full px-2 py-0.5 text-xs shadow-sm hover:border-indigo-200"><span>{emoji}</span> <span className="font-black text-slate-500">{names.length}</span></button>)}</div>}
                        <span className="text-[9px] font-bold text-slate-300 mt-1 mx-1 flex items-center gap-1">{m.time}{isMine && <span title={(m.readBy || []).filter(r => !samePerson(readEntryName(r), currentUser.name)).length ? `Read by ${(m.readBy || []).filter(r => !samePerson(readEntryName(r), currentUser.name)).map(r => `${readEntryName(r)} at ${r.time || ''}`).join(', ')}` : 'Sent'} className={(m.readBy || []).filter(r => !samePerson(readEntryName(r), currentUser.name)).length ? 'text-blue-500' : 'text-slate-300'}>{(m.readBy || []).filter(r => !samePerson(readEntryName(r), currentUser.name)).length ? '✓✓' : '✓'}</span>}</span>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                  {showLatestButton && !chatSearch && <button type="button" onClick={() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })} className="sticky bottom-2 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[11px] font-black px-4 py-2 rounded-full shadow-lg">Jump to latest</button>}
                </div>
              </>
            )}

            {!isCalling && showMentions && activeChannel === 'global' && (
              <div className="bg-white border-t-2 border-slate-100 max-h-40 overflow-y-auto absolute bottom-[70px] w-full shadow-lg z-20">
                <button type="button" onClick={() => insertMention('all')} className="w-full text-left px-5 py-3 hover:bg-slate-50 text-sm font-bold text-slate-700 border-b border-slate-50 transition-colors bg-red-50"><span className="text-red-600 mr-1 font-black">@all</span> <span className="text-xs text-red-400 font-semibold ml-2">(Notify Everyone)</span></button>
                {chatUsers.map(u => <button type="button" key={u.id} onClick={() => insertMention(u.name)} className="w-full text-left px-5 py-3 hover:bg-slate-50 text-sm font-bold text-slate-700 border-b border-slate-50 transition-colors"><span className="text-indigo-600 mr-1">@</span>{u.name} <span className="text-xs text-slate-400 font-semibold ml-2">({u.role})</span></button>)}
              </div>
            )}

            {!isCalling && (
              <div className="kalpa-chat-inputbar p-3 bg-white border-t-2 border-slate-100 flex flex-col gap-2 z-10 relative shrink-0">
                {(replyTo || editingMessage) && <div className="flex items-center justify-between gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2"><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">{editingMessage ? 'Editing message' : `Replying to ${replyTo?.sender}`}</p><p className="text-xs font-bold text-slate-600 truncate">{editingMessage?.text || replyTo?.text || replyTo?.fileName}</p></div><button type="button" onClick={clearComposerContext} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button></div>}
                {uploadingAttachment && <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2"><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{uploadingAttachment.voice ? 'Saving voice note' : 'Uploading attachment'}</p><p className="text-xs font-bold text-slate-600 truncate">{uploadingAttachment.name} {getReadableFileSize(uploadingAttachment.size) ? `• ${getReadableFileSize(uploadingAttachment.size)}` : ''}</p></div><span className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin shrink-0" /></div>}
                {isRecordingVoice && <div className="kalpa-voice-recording-bar flex items-center justify-between gap-3 bg-red-50 border border-red-100 rounded-xl px-3 py-2"><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-widest text-red-600">Recording voice note</p><p className="text-xs font-bold text-red-500">{voiceStartedAt ? `${Math.floor((voiceNow - voiceStartedAt)/60000)}:${String(Math.floor(((voiceNow - voiceStartedAt)%60000)/1000)).padStart(2,'0')}` : '0:00'}</p></div><div className="flex items-center gap-2 shrink-0"><button type="button" onClick={cancelVoiceRecording} className="bg-white text-red-600 border border-red-100 px-3 py-1.5 rounded-lg text-[11px] font-black">Cancel</button><button type="button" onClick={stopVoiceRecording} className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-[11px] font-black">Stop & Send</button></div></div>}
                {showEmojiPicker && (
                  <div
                    className="fixed bg-white border border-slate-100 rounded-2xl shadow-2xl p-3 z-[99998] overflow-hidden"
                    style={{
                      right: 'max(16px, env(safe-area-inset-right))',
                      bottom: 'clamp(118px, 18vh, 210px)',
                      width: 'min(520px, calc(100vw - 32px))',
                      maxHeight: 'calc(100vh - 150px)'
                    }}
                  >
                    <div className="flex items-center justify-between mb-2 gap-3">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 truncate">Emoji picker • scroll to see all emojis</span>
                      <button type="button" onClick={() => setShowEmojiPicker(false)} className="text-slate-400 hover:text-slate-600 shrink-0"><X className="w-4 h-4" /></button>
                    </div>
                    <div
                      className="custom-scrollbar pr-1"
                      style={{
                        maxHeight: 'calc(100vh - 205px)',
                        minHeight: 180,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        overscrollBehavior: 'contain',
                        WebkitOverflowScrolling: 'touch'
                      }}
                    >
                      {chatEmojiGroups.map(group => (
                        <div key={group.label} className="mb-4 last:mb-1">
                          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 sticky top-0 bg-white/95 backdrop-blur-sm py-1 z-10">{group.label}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(42px, 1fr))', gap: 8 }}>
                            {group.emojis.map(emoji => (
                              <button key={`${group.label}-${emoji}`} type="button" onClick={() => addEmojiToMessage(emoji)} className="rounded-xl bg-slate-50 hover:bg-indigo-50 hover:scale-105 text-xl transition-all flex items-center justify-center border border-transparent hover:border-indigo-100" style={{ height: 42, minWidth: 0 }}>{emoji}</button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="kalpa-chat-composer flex flex-col gap-2">
                  <div className="kalpa-chat-quick-emojis flex items-center gap-1 overflow-x-auto custom-scrollbar pb-0.5">{QUICK_EMOJIS.map(emoji => <button type="button" key={emoji} onClick={() => addEmojiToMessage(emoji)} className="shrink-0 w-9 h-8 rounded-xl bg-slate-50 hover:bg-indigo-50 text-lg border border-slate-100 hover:border-indigo-100 transition-all">{emoji}</button>)}</div>
                  <textarea ref={composerRef} rows={2} value={msg} onChange={handleInputChange} onKeyDown={handleMessageKeyDown} placeholder={editingMessage ? 'Edit your message...' : activeChannel === 'global' ? 'Message team or @mention...' : `Message ${activeChannel}...`} className="kalpa-chat-textarea w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-base font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all resize-none" style={{ minHeight: 58, maxHeight: 132, overflowY: 'auto' }} />
                  {renderComposerTaskPreview()}
                  <div className="kalpa-chat-actions-row flex items-center gap-2">
                    <label title="Attach file" className="kalpa-chat-tool-btn p-2.5 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-xl transition-colors cursor-pointer"><Paperclip className="w-5 h-5" /><input type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.dwg,.dxf,.xls,.xlsx,.csv,.doc,.docx,.ppt,.pptx,.zip,.rar" onChange={handleChatFileUpload} /></label>
                    <button type="button" title="Add emoji" onClick={() => setShowEmojiPicker(v => !v)} className={`kalpa-chat-tool-btn p-2.5 rounded-xl transition-colors ${showEmojiPicker ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}><Smile className="w-5 h-5" /></button>
                    <button type="button" title={isRecordingVoice ? 'Stop and send voice note' : 'Record voice note'} onClick={isRecordingVoice ? stopVoiceRecording : startVoiceRecording} className={`kalpa-chat-tool-btn p-2.5 rounded-xl transition-colors ${isRecordingVoice ? 'bg-red-50 text-red-600 animate-pulse' : 'bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}>{isRecordingVoice ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}</button>
                    <div className="flex-1" />
                    <button type="button" disabled={!msg.trim()} onClick={handleSend} className={`kalpa-chat-send-btn p-3 rounded-xl shadow-md transition-colors ${msg.trim() ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`}><Send className="w-5 h-5" /></button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}


      {forwardMessageData && (
        <div className="fixed inset-0 z-[99998] bg-slate-900/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-3" onClick={() => setForwardMessageData(null)}>
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div><p className="text-sm font-black text-slate-800">Forward message</p><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate max-w-xs">{forwardMessageData.text || forwardMessageData.fileName || 'Attachment'}</p></div>
              <button type="button" onClick={() => setForwardMessageData(null)} className="p-2 rounded-xl bg-slate-50 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2 custom-scrollbar">
              <button type="button" onClick={() => sendForwardTo('global')} className="w-full text-left px-4 py-3 rounded-2xl hover:bg-indigo-50 font-bold text-slate-700 flex items-center gap-3"><Hash className="w-4 h-4 text-indigo-500" /> Global Chat</button>
              {chatUsers.map(u => <button type="button" key={`fwd-${u.id}`} onClick={() => sendForwardTo(u.name)} className="w-full text-left px-4 py-3 rounded-2xl hover:bg-indigo-50 font-bold text-slate-700 flex items-center gap-3"><User className="w-4 h-4 text-indigo-500" /> <span className="truncate">{u.name}</span><span className="ml-auto text-[10px] font-black text-slate-300 uppercase">{u.role}</span></button>)}
            </div>
          </div>
        </div>
      )}

      {canUsePortal && actionMenu && activeActionMessage && createPortal((
        <div
          className="kalpa-message-action-portal fixed inset-0 pointer-events-auto"
          style={{ zIndex: 2147483646, isolation: 'isolate' }}
          onClick={() => setActionMenu(null)}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <div
            className={`kalpa-message-action-menu fixed bg-white border border-slate-200 shadow-2xl overflow-hidden ${actionMenu.mobile ? 'rounded-2xl sm:rounded-3xl animate-in fade-in zoom-in-95 duration-150' : 'rounded-2xl'}`}
            style={actionMenu.mobile ? {
              left: `min(max(12px, ${Number(actionMenu.x || 12)}px), calc(100vw - ${(actionMenu.width || 256) + 12}px))`,
              top: `min(max(12px, ${Number(actionMenu.y || 12)}px), calc(100vh - 340px))`,
              width: actionMenu.width || 256,
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'min(72vh, 340px)',
              zIndex: 2147483647,
              overflowY: 'auto',
              boxShadow: '0 22px 60px rgba(15, 23, 42, 0.28)'
            } : {
              left: `min(max(12px, ${Number(actionMenu.x || 12)}px), calc(100vw - ${(actionMenu.width || 224) + 12}px))`,
              top: `min(max(12px, ${Number(actionMenu.y || 12)}px), calc(100vh - 400px))`,
              width: actionMenu.width || 224,
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'min(80vh, 390px)',
              zIndex: 2147483647,
              overflowY: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <div className="px-3 pt-3 pb-2 border-b border-slate-100 bg-white sticky top-0 z-10">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Message options</p>
              <p className="text-xs font-black text-slate-700 truncate">{activeActionMessage.text || activeActionMessage.fileName || 'Chat message'}</p>
            </div>
            <div className="p-1.5">
              <button type="button" onClick={() => replyToMessage(activeActionMessage)} className="w-full text-left px-3 py-2.5 text-sm font-bold text-slate-700 rounded-xl hover:bg-slate-50 active:bg-slate-100 flex items-center gap-2"><span className="w-6 text-center">↩</span> Reply</button>
              <button type="button" onClick={() => togglePinMessage(activeActionMessage)} className="w-full text-left px-3 py-2.5 text-sm font-bold text-slate-700 rounded-xl hover:bg-slate-50 active:bg-slate-100 flex items-center gap-2"><span className="w-6 text-center">{isPinnedMessage(activeActionMessage) ? '★' : '☆'}</span> {isPinnedMessage(activeActionMessage) ? 'Unpin' : 'Pin'}</button>
              <button type="button" onClick={(e) => openReactionMenu(e, activeActionMessage)} className="w-full text-left px-3 py-2.5 text-sm font-bold text-slate-700 rounded-xl hover:bg-slate-50 active:bg-slate-100 flex items-center gap-2"><span className="w-6 text-center">😊</span> React</button>
              <button type="button" onClick={() => forwardMessage(activeActionMessage)} className="w-full text-left px-3 py-2.5 text-sm font-bold text-slate-700 rounded-xl hover:bg-slate-50 active:bg-slate-100 flex items-center gap-2"><span className="w-6 text-center">↗</span> Forward</button>
              <button type="button" onClick={() => copyMessage(activeActionMessage)} className="w-full text-left px-3 py-2.5 text-sm font-bold text-slate-700 rounded-xl hover:bg-slate-50 active:bg-slate-100 flex items-center gap-2"><span className="w-6 text-center">⧉</span> Copy</button>
              {samePerson(activeActionMessage.sender, currentUser.name) && !activeActionMessage.deleted && <button type="button" onClick={() => editMessage(activeActionMessage)} className="w-full text-left px-3 py-2.5 text-sm font-bold text-slate-700 rounded-xl hover:bg-slate-50 active:bg-slate-100 flex items-center gap-2"><span className="w-6 text-center">✎</span> Edit</button>}
              <button type="button" onClick={() => deleteForMe(activeActionMessage)} className="w-full text-left px-3 py-2.5 text-sm font-bold text-slate-700 rounded-xl hover:bg-slate-50 active:bg-slate-100 flex items-center gap-2"><span className="w-6 text-center">⊘</span> Hide for me</button>
              {(samePerson(activeActionMessage.sender, currentUser.name) || currentUser.role === ROLES.ADMIN) && <button type="button" onClick={() => deleteForEveryone(activeActionMessage)} className="w-full text-left px-3 py-2.5 text-sm font-black text-red-600 rounded-xl hover:bg-red-50 active:bg-red-100 flex items-center gap-2"><span className="w-6 text-center">🗑</span> Delete for everyone</button>}
            </div>
          </div>
        </div>
      ), document.body)}

      {canUsePortal && reactionMenu && activeReactionMessage && createPortal((
        <div
          className="kalpa-reaction-portal fixed inset-0 pointer-events-auto"
          style={{ zIndex: 2147483646, isolation: 'isolate' }}
          onClick={() => setReactionMenu(null)}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <div
            className={`kalpa-reaction-menu fixed bg-white border border-slate-200 shadow-2xl rounded-2xl overflow-hidden ${reactionMenu.mobile ? 'animate-in fade-in zoom-in-95 duration-150' : ''}`}
            style={{
              left: `min(max(12px, ${Number(reactionMenu.x || 12)}px), calc(100vw - ${(reactionMenu.width || 316) + 12}px))`,
              top: `min(max(12px, ${Number(reactionMenu.y || 12)}px), calc(100vh - 168px))`,
              width: reactionMenu.width || (reactionMenu.mobile ? 316 : 360),
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'min(58vh, 168px)',
              zIndex: 2147483647,
              boxShadow: '0 22px 60px rgba(15, 23, 42, 0.28)'
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <div className="px-3 pt-2 pb-1 border-b border-slate-100 bg-white">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">React</p>
            </div>
            <div className="p-2 flex items-center gap-1 overflow-x-auto" style={{ overscrollBehaviorX: 'contain', WebkitOverflowScrolling: 'touch' }}>
              {reactionEmojis.map(emoji => {
                const selected = Array.isArray((activeReactionMessage.reactions || {})[emoji]) && (activeReactionMessage.reactions || {})[emoji].some(n => samePerson(n, currentUser.name));
                return (
                  <button
                    type="button"
                    key={emoji}
                    onClick={() => toggleReaction(activeReactionMessage, emoji)}
                    className={`w-11 h-11 shrink-0 rounded-xl text-2xl flex items-center justify-center transition-all ${selected ? 'bg-indigo-100 ring-2 ring-indigo-200 scale-105' : 'hover:bg-indigo-50 active:bg-indigo-50 hover:scale-105'}`}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ), document.body)}

      {latestUnreadMessage && !isOpen && (
        <button type="button" onClick={() => openConversationForMessage(latestUnreadMessage)} className="kalpa-chat-unread-preview mb-3 w-[320px] max-w-[calc(100vw-2rem)] text-left bg-white border border-indigo-100 rounded-2xl shadow-xl p-3 animate-in slide-in-from-bottom-2 hover:shadow-2xl transition-shadow">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><MessageSquare className="w-5 h-5" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">New chat message • {getConversationLabel(getMessageChannelForCurrentUser(latestUnreadMessage))}</p>
              <p className="text-sm font-black text-slate-800 truncate">{latestUnreadMessage.sender || 'Team'}</p>
              <p className="text-xs font-semibold text-slate-500 truncate">{getMessagePreviewText(latestUnreadMessage)}</p>
            </div>
          </div>
        </button>
      )}

      <button type="button" onClick={() => { const nextOpen = !isOpen; setIsOpen(nextOpen); setShowEmojiPicker(false); setActionMenu(null); setReactionMenu(null); if (nextOpen) markCurrentChannelReadNow(activeChannel); }} className={`kalpa-chat-launcher pointer-events-auto bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-2xl shadow-xl shadow-slate-300 transition-all hover:scale-105 relative ${isOpen ? 'kalpa-chat-launcher-open' : ''}`}>
        <MessageSquare className="w-7 h-7" />
        {totalUnreadCount > 0 && !isOpen && <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[11px] font-black px-2.5 py-1 rounded-full border-2 border-white shadow-sm animate-pulse">{totalUnreadCount > 99 ? '99+' : totalUnreadCount}</span>}
      </button>
    </div>
  );
};


const ActiveToasts = ({ notifications = [], currentUser }) => {
  if (!currentUser) return null;
  const visible = getVisibleNotifications(notifications, currentUser, { unreadOnly: true, limit: 2 });

  if (visible.length === 0) return null;

  return (
    <div className="fixed top-24 right-5 z-[60] space-y-3 pointer-events-none">
      {visible.map(n => (
        <div key={n.id} className="bg-white border-2 border-indigo-100 shadow-2xl rounded-2xl p-4 max-w-xs animate-in slide-in-from-right-4">
          <p className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-1">Notification</p>
          <p className="text-sm font-extrabold text-slate-800">{n.title}</p>
          <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-wider">{n.time}</p>
        </div>
      ))}
    </div>
  );
};


class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Something went wrong.' };
  }
  componentDidCatch(error, info) {
    try {
      const logs = JSON.parse(localStorage.getItem('kd-error-logs') || '[]');
      logs.unshift({ at: new Date().toISOString(), message: error?.message || String(error), stack: error?.stack || '', componentStack: info?.componentStack || '' });
      localStorage.setItem('kd-error-logs', JSON.stringify(logs.slice(0, 50)));
    } catch (_) {}
    console.error('Kalpvriksha app error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl shadow-xl border border-red-100 p-8 max-w-xl w-full text-center">
            <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center"><AlertCircle className="w-8 h-8 text-red-500" /></div>
            <h1 className="text-2xl font-black text-slate-800">Something needs attention</h1>
            <p className="text-slate-500 font-medium mt-2">The page did not load correctly, but your data is safe. Refresh the page once. If it repeats, check the saved error log.</p>
            <p className="mt-4 text-xs font-bold text-red-500 bg-red-50 border border-red-100 rounded-xl p-3 break-words">{this.state.message}</p>
            <button type="button" onClick={() => window.location.reload()} className="mt-6 bg-slate-800 text-white px-6 py-3 rounded-xl font-black">Refresh Page</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default CommunicationHub;
