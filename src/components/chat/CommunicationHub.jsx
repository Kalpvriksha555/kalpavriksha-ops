import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, Phone, Video, Square, Mic, Smile, Paperclip, Send, Search, User, Star, Hash, AlertCircle, File as FileIcon } from 'lucide-react';
import { formatLastSeenDateTime } from '../../utils/date';
import { createSafeMeetingRoomName, buildJitsiUrl } from '../../utils/meeting';
import { copyTextToClipboard } from '../../utils/clipboard';
import { MiniEmptyState } from '../shared';
import { getVisibleNotifications } from '../../services/notificationService';
import { CHAT_API_BASE, absoluteChatUrl, makeMessageId, QUICK_EMOJIS, isUserActuallyOnline, getOperationalUsers, identityKey, samePerson, readEntryName, hasReadBy, ROLES, normalizeChannelKey, chatEmojiGroups, reactionEmojis } from '../../utils/chatUtils';

export const CommunicationHub = ({ currentUser, users, chatMessages, onSendMessage, onDeleteMessage, onUpdateMessage, onMarkMessagesRead, appId }) => {
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
  const activePeer = activeChannel === 'global' ? null : chatUsers.find(u => samePerson(u.name, activeChannel));
  const activePeerOnline = activePeer ? isUserActuallyOnline(activePeer, presenceNow) : false;
  const activeCallRoom = activePeer ? createSafeMeetingRoomName('KalpaVriksha_DM', appId || 'kalpavriksha_production_v1', ...[currentUser.name, activePeer.name].sort()) : '';
  const activeCallUrl = activePeer ? buildJitsiUrl(activeCallRoom, currentUser.name, { audioOnly: callAudioOnly, shareScreen: callShareScreen }) : '';

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
    return (samePerson(m.sender, activeChannel) && samePerson(m.recipient, currentUser.name)) || (samePerson(m.sender, currentUser.name) && samePerson(m.recipient, activeChannel));
  };

  useEffect(() => {
    if (isOpen) markCurrentChannelReadNow(activeChannel);
  }, [isOpen, activeChannel, chatMessages.length]);

  const unreadMessages = (chatMessages || []).filter(m => {
    if (!m || m.deleted || hiddenMessageIds.includes(String(m.id))) return false;
    if (samePerson(m.sender, currentUser.name)) return false;
    const channelKey = (m.recipient === 'global' || !m.recipient) ? 'global' : identityKey(m.sender);
    const cutoff = Math.max(Number(localReadState[channelKey] || 0), Number(readThroughRef.current?.[channelKey] || 0));
    const sentAt = Number(m.sentAt || m.id || 0);
    if (sentAt && cutoff && sentAt <= cutoff) return false;
    if (hasReadBy(m, currentUser.name)) return false;
    if (isOpen && isMessageInActiveChannel(m)) return false;
    return true;
  });
  const unreadGlobalCount = (isOpen && activeChannel === 'global') ? 0 : unreadMessages.filter(m => m.recipient === 'global' || !m.recipient).length;

  const getDirectUnreadCountForUser = (userName) => {
    const channelKey = identityKey(userName);
    const cutoff = Math.max(Number(localReadState[channelKey] || 0), Number(readThroughRef.current?.[channelKey] || 0));
    return (chatMessages || []).filter(m => {
      if (!m || m.deleted || hiddenMessageIds.includes(String(m.id))) return false;
      if (!samePerson(m.sender, userName) || !samePerson(m.recipient, currentUser.name)) return false;
      const sentAt = Number(m.sentAt || m.id || 0);
      if (sentAt && cutoff && sentAt <= cutoff) return false;
      if (isOpen && samePerson(activeChannel, userName)) return false;
      if (hasReadBy(m, currentUser.name)) return false;
      return true;
    }).length;
  };

  const unreadDirectTotal = chatUsers.reduce((sum, u) => sum + getDirectUnreadCountForUser(u.name), 0);
  const totalUnreadCount = unreadMessages.length;
  const latestUnreadMessage = unreadMessages.slice().sort((a, b) => Number(b.sentAt || b.id || 0) - Number(a.sentAt || a.id || 0))[0];
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
    setMsg(prev => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${emoji} `);
    composerRef.current?.focus?.();
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
    setMsg(prev => prev.slice(0, -1) + `@${name} `);
    setShowMentions(false);
    composerRef.current?.focus?.();
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
    const url = fileMeta.url ? absoluteChatUrl(fileMeta.url) : (fileMeta.downloadUrl ? absoluteChatUrl(fileMeta.downloadUrl) : fallback.url || '');
    const downloadUrl = fileMeta.downloadUrl ? absoluteChatUrl(fileMeta.downloadUrl) : url;
    const fileRecord = {
      ...fileMeta,
      id: fileMeta.id || fallback.id,
      name: fileName,
      storedName: fileMeta.storedName,
      mime: fileType,
      mimeType: fileType,
      size: fileSize,
      url: fileMeta.url || fallback.url || '',
      downloadUrl: fileMeta.downloadUrl || fileMeta.url || fallback.url || ''
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
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else { setIsRecordingVoice(false); setVoiceStartedAt(null); }
    } catch (error) {
      console.error('Voice note stop failed', error);
      setIsRecordingVoice(false);
      setVoiceStartedAt(null);
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

  const openActionMenu = (event, m) => {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.min(event.clientX || 0, window.innerWidth - 240);
    const y = Math.min(event.clientY || 0, window.innerHeight - 320);
    setReactionMenu(null);
    setActionMenu({ id: m.id, x: Math.max(12, x), y: Math.max(12, y) });
  };

  const openReactionMenu = (event, m) => {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.min(event.clientX || 0, window.innerWidth - 300);
    const y = Math.min(event.clientY || 0, window.innerHeight - 120);
    setActionMenu(null);
    setReactionMenu({ id: m.id, x: Math.max(12, x), y: Math.max(12, y) });
  };

  const activeActionMessage = actionMenu ? (chatMessages || []).find(m => String(m.id) === String(actionMenu.id)) : null;
  const activeReactionMessage = reactionMenu ? (chatMessages || []).find(m => String(m.id) === String(reactionMenu.id)) : null;

  const replyToMessage = (m) => {
    setReplyTo(m);
    setEditingMessage(null);
    setActionMenu(null);
    composerRef.current?.focus?.();
  };

  const editMessage = (m) => {
    if (!samePerson(m.sender, currentUser.name)) return;
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
      text: `↗ Forward to...ed from ${source.sender}: ${summary}`,
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
    if (!(samePerson(m.sender, currentUser.name) || currentUser.role === ROLES.ADMIN)) return;
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
    const parts = text.split(new RegExp(`(@${currentUser.name}|@all)`, 'gi'));
    return parts.map((part, i) => {
      const lower = part.toLowerCase();
      if (lower === `@${currentUser.name.toLowerCase()}`) return <strong key={i} className="text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded-md font-extrabold">{part}</strong>;
      if (lower === `@all`) return <strong key={i} className="text-red-700 bg-red-100 px-1.5 py-0.5 rounded-md font-extrabold">{part}</strong>;
      return part;
    });
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

  const renderAttachmentPreview = (m, isMine) => {
    const fileUrl = absoluteChatUrl(m.downloadUrl || m.fileUrl || m.files?.[0]?.downloadUrl || m.files?.[0]?.url || '');
    if (!fileUrl) return null;
    const fileName = m.fileName || m.files?.[0]?.name || 'Attachment';
    const fileType = m.fileType || m.files?.[0]?.mime || m.files?.[0]?.mimeType || '';
    const lower = String(fileName).toLowerCase();
    const isImage = String(fileType).startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(lower);
    const isVideo = String(fileType).startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/i.test(lower);
    const isAudio = String(fileType).startsWith('audio/') || /\.(webm|mp3|wav|m4a|ogg)$/i.test(lower);
    const isPdf = /\.pdf$/i.test(lower) || String(fileType).includes('pdf');
    const label = getAttachmentLabel(fileName, fileType);
    return (
      <div className={`kalpa-chat-attachment mt-3 rounded-2xl border overflow-hidden ${isMine ? 'border-indigo-300 bg-indigo-500/20' : 'border-slate-100 bg-slate-50'}`}>
        {isImage && <a href={fileUrl} target="_blank" rel="noreferrer" className="block"><img src={fileUrl} alt={fileName} loading="lazy" className="kalpa-chat-attachment-image block max-h-64 w-full object-contain bg-black/5" /></a>}
        {isVideo && <video src={fileUrl} controls preload="metadata" className="block max-h-64 w-full bg-black" />}
        {isAudio && <div className="p-3"><div className={`text-[10px] font-black uppercase tracking-widest mb-2 ${isMine ? 'text-indigo-100' : 'text-indigo-600'}`}>{m.isVoiceNote ? 'Voice note' : 'Audio attachment'}</div><audio src={fileUrl} controls preload="metadata" className="w-full" /></div>}
        {!isImage && !isVideo && !isAudio && (
          <div className={`p-4 flex items-center gap-3 ${isMine ? 'bg-indigo-500/20' : 'bg-white'}`}>
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${isMine ? 'bg-white/15 text-white' : 'bg-indigo-50 text-indigo-600'}`}><FileIcon className="w-5 h-5" /></div>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-black truncate ${isMine ? 'text-white' : 'text-slate-800'}`}>{fileName}</p>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${isMine ? 'text-indigo-100' : 'text-slate-400'}`}>{label}{getReadableFileSize(m.fileSize || m.files?.[0]?.size) ? ` • ${getReadableFileSize(m.fileSize || m.files?.[0]?.size)}` : ''}</p>
            </div>
          </div>
        )}
        {isPdf && <div className={`px-3 pb-3 ${isMine ? 'bg-indigo-500/20' : 'bg-white'}`}><object data={fileUrl} type="application/pdf" className="w-full h-40 rounded-xl border border-slate-200 bg-white"><p className="text-xs text-slate-400 p-3">PDF preview unavailable. Open the file below.</p></object></div>}
        <div className={`p-3 flex items-center justify-between gap-3 border-t ${isMine ? 'border-indigo-300/40' : 'border-slate-100'}`}>
          <div className="min-w-0 flex items-center gap-2">
            <FileIcon className={`w-4 h-4 shrink-0 ${isMine ? 'text-white' : 'text-indigo-500'}`} />
            <div className="min-w-0">
              <p className={`text-xs font-black truncate ${isMine ? 'text-white' : 'text-slate-700'}`}>{fileName}</p>
              <p className={`text-[10px] font-bold ${isMine ? 'text-indigo-100' : 'text-slate-400'}`}>{label} {getReadableFileSize(m.fileSize || m.files?.[0]?.size) ? `• ${getReadableFileSize(m.fileSize || m.files?.[0]?.size)}` : ''}{m.localPreviewOnly ? ' • local preview' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a href={fileUrl} target="_blank" rel="noreferrer" className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${isMine ? 'bg-white/90 text-slate-700' : 'bg-white text-indigo-700 border border-indigo-100'}`}>Open</a>
            <a href={fileUrl} download={fileName} className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${isMine ? 'bg-white text-indigo-700' : 'bg-indigo-600 text-white'}`}>Download</a>
          </div>
        </div>
      </div>
    );
  };

  const channelMessages = (chatMessages || []).filter(m => {
    if (!m || hiddenMessageIds.includes(String(m.id))) return false;
    if (activeChannel === 'global') return m.recipient === 'global' || !m.recipient;
    return (samePerson(m.sender, currentUser.name) && samePerson(m.recipient, activeChannel)) || (samePerson(m.sender, activeChannel) && samePerson(m.recipient, currentUser.name));
  }).sort((a, b) => Number(a.sentAt || a.id || 0) - Number(b.sentAt || b.id || 0));
  const searchKey = chatSearch.trim().toLowerCase();
  const displayMessages = searchKey
    ? channelMessages.filter(m => `${m.text || ''} ${m.fileName || ''} ${m.sender || ''}`.toLowerCase().includes(searchKey))
    : channelMessages;
  const pinnedMessages = channelMessages.filter(m => isPinnedMessage(m) && !m.deleted).slice(-5);

  return (
    <div className="kalpa-chat-shell fixed bottom-6 right-6 z-50 flex flex-col items-end" style={{ maxWidth: 'calc(100vw - 24px)' }}>
      {isOpen && (
        <div
          className="kalpa-chat-panel bg-white rounded-3xl shadow-2xl border-2 border-slate-100 mb-4 overflow-hidden flex flex-row animate-in slide-in-from-bottom-5"
          style={{ width: 'min(1080px, calc(100vw - 48px))', height: 'min(620px, calc(100vh - 96px))', maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 96px)' }}
        >
          <div className="kalpa-chat-sidebar shrink-0 bg-slate-50 border-r border-slate-100 flex flex-col" style={{ width: 300, minWidth: 280, maxWidth: 320 }}>
            <div className="p-4 bg-indigo-600 border-b border-indigo-700">
              <h3 className="text-white font-extrabold flex items-center"><MessageSquare className="w-4 h-4 mr-2" /> Team Chat <span title={currentUserOnline ? 'You are online' : 'You are offline'} className={`ml-2 w-2.5 h-2.5 rounded-full ${currentUserOnline ? 'bg-emerald-300' : 'bg-slate-300'}`}></span></h3>
              <p className="text-indigo-100 text-[10px] font-bold mt-1 uppercase tracking-widest">Global • Direct • Files • Voice</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              <button type="button" onClick={() => { setActiveChannel('global'); setIsCalling(false); currentUser.lastChatRead = Date.now(); markCurrentChannelReadNow('global'); }} className={`w-full text-left px-4 py-3 rounded-xl font-bold flex items-center justify-between transition-colors ${activeChannel === 'global' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-200'}`}>
                <span className="flex items-center"><Hash className="w-4 h-4 mr-2"/> Global Chat</span>
                {unreadGlobalCount > 0 && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">{unreadGlobalCount}</span>}
              </button>
              <div className="pt-4 pb-2 px-4 text-xs font-black text-slate-400 uppercase tracking-widest flex items-center justify-between"><span>Direct Messages</span><span className="text-[10px] text-slate-300">{chatUsers.length}</span></div>
              {chatUsers.length === 0 && <div className="mx-3 mb-2"><MiniEmptyState>No team members found</MiniEmptyState></div>}
              {chatUsers.map(u => {
                const unreadDMCount = getDirectUnreadCountForUser(u.name);
                return (
                  <button type="button" key={u.id} onClick={() => { setActiveChannel(u.name); setIsCalling(false); currentUser.lastChatRead = Date.now(); markCurrentChannelReadNow(u.name); }} className={`w-full text-left px-4 py-3 rounded-xl font-bold flex items-center justify-between transition-colors ${samePerson(activeChannel, u.name) ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-200'}`}>
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
                <button type="button" onClick={() => { setIsOpen(false); markCurrentChannelReadNow(activeChannel); currentUser.lastChatRead = Date.now(); }} className="text-slate-400 hover:text-slate-600 p-1.5 bg-slate-50 rounded-full transition-colors ml-2"><X className="w-5 h-5" /></button>
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
                <div ref={chatScrollRef} className="kalpa-chat-messages flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50 custom-scrollbar relative" style={{ minHeight: 0, overflowX: 'hidden' }} onClick={() => { setActionMenu(null); setReactionMenu(null); }}>
                  {displayMessages.length === 0 && <p className="text-center text-sm text-slate-400 mt-10 font-medium">Say hello to {activeChannel === 'global' ? 'the team' : activeChannel}!</p>}
                  {displayMessages.map((m, idx) => {
                    const isMine = samePerson(m.sender, currentUser.name);
                    const showName = idx === 0 || !samePerson(displayMessages[idx-1].sender, m.sender);
                    const reactions = Object.entries(m.reactions || {}).filter(([, names]) => Array.isArray(names) && names.length);
                    const pinned = isPinnedMessage(m);
                    return (
                      <div key={m.id} data-message-id={String(m.id)} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} ${pinned ? 'scroll-mt-24' : ''}`}>
                        {showName && !isMine && <span className={`text-[11px] font-black uppercase tracking-wider ml-1 mb-1 ${m.senderRole === ROLES.ADMIN ? 'text-indigo-600' : 'text-slate-500'}`}>{m.sender}</span>}
                        <div className="relative group flex items-start gap-2" onContextMenu={(e) => openActionMenu(e, m)}>
                          {isMine && <button type="button" onClick={(e) => openActionMenu(e, m)} className="mt-2 w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-200 shadow-sm flex items-center justify-center opacity-100" title="Message options">⋮</button>}
                          <div className={`kalpa-chat-bubble px-4 py-2.5 rounded-2xl text-[15px] font-medium leading-relaxed shadow-sm relative break-words ${pinned ? 'ring-2 ring-amber-300' : ''} ${isMine ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'}`} style={{ maxWidth: m.fileUrl ? 'min(520px, 84vw)' : 'min(620px, 78vw)', minWidth: 0, overflow: 'visible' }}>
                            {pinned && <span className={`absolute -top-2 ${isMine ? 'right-3 bg-amber-200 text-amber-900' : 'left-3 bg-amber-100 text-amber-700'} text-[9px] font-black px-2 py-0.5 rounded-full border border-amber-200`}>PINNED</span>}
                            {m.replyTo && <button type="button" onClick={() => jumpToPinnedMessage(m.replyTo.id)} className={`w-full text-left mb-2 border-l-4 pl-2 py-1 rounded ${isMine ? 'border-white/70 bg-indigo-500/30' : 'border-indigo-300 bg-indigo-50'}`}><p className={`text-[10px] font-black ${isMine ? 'text-indigo-100' : 'text-indigo-600'}`}>Replying to {m.replyTo.sender}</p><p className={`text-xs truncate ${isMine ? 'text-white/90' : 'text-slate-500'}`}>{m.replyTo.text}</p></button>}
                            {m.forwardedFrom && <div className={`mb-2 border-l-4 pl-2 py-1 rounded ${isMine ? 'border-white/70 bg-indigo-500/30' : 'border-amber-300 bg-amber-50'}`}><p className={`text-[10px] font-black ${isMine ? 'text-indigo-100' : 'text-amber-700'}`}>Forwarded from {m.forwardedFrom.sender}</p><p className={`text-xs truncate ${isMine ? 'text-white/90' : 'text-slate-500'}`}>{m.forwardedFrom.text}</p></div>}
                            <div className={m.deleted ? 'italic opacity-75' : ''}>{renderMessageText(m.text)} {m.edited && !m.deleted && <span className={`text-[10px] ml-1 ${isMine ? 'text-indigo-100' : 'text-slate-400'}`}>(edited)</span>}</div>
                            {m.roomUrl && (
                              <div className={`mt-3 rounded-xl p-3 border ${isMine ? 'bg-indigo-500/30 border-indigo-300' : 'bg-indigo-50 border-indigo-100'}`}>
                                <p className={`text-xs font-black mb-2 ${isMine ? 'text-white' : 'text-indigo-800'}`}>{m.callType === 'audio' ? 'Audio call invite' : m.callType === 'screen' ? 'Screen sharing invite' : 'Video call invite'}</p>
                                <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setCallAudioOnly(m.callType === 'audio'); setActiveChannel(samePerson(m.sender, currentUser.name) ? m.recipient : m.sender); setIsCalling(true); }} className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${isMine ? 'bg-white text-indigo-700' : 'bg-indigo-600 text-white'}`}>Join</button><button type="button" onClick={() => window.open(m.roomUrl, '_blank', 'noopener,noreferrer')} className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${isMine ? 'bg-white/80 text-slate-700' : 'bg-white text-indigo-700 border border-indigo-100'}`}>Open</button></div>
                              </div>
                            )}
                            {!m.deleted && renderAttachmentPreview(m, isMine)}
                          </div>
                          {!isMine && <button type="button" onClick={(e) => openActionMenu(e, m)} className="mt-2 w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-200 shadow-sm flex items-center justify-center opacity-100" title="Message options">⋮</button>}
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
                {isRecordingVoice && <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-100 rounded-xl px-3 py-2"><div><p className="text-[10px] font-black uppercase tracking-widest text-red-600">Recording voice note</p><p className="text-xs font-bold text-red-500">{voiceStartedAt ? `${Math.floor((voiceNow - voiceStartedAt)/60000)}:${String(Math.floor(((voiceNow - voiceStartedAt)%60000)/1000)).padStart(2,'0')}` : '0:00'}</p></div><button type="button" onClick={stopVoiceRecording} className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-[11px] font-black">Stop</button></div>}
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
                  <div className="kalpa-chat-actions-row flex items-center gap-2">
                    <label title="Attach file" className="kalpa-chat-tool-btn p-2.5 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-xl transition-colors cursor-pointer"><Paperclip className="w-5 h-5" /><input type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.dwg,.dxf,.xls,.xlsx,.csv,.doc,.docx,.ppt,.pptx,.zip,.rar" onChange={handleChatFileUpload} /></label>
                    <button type="button" title="Add emoji" onClick={() => setShowEmojiPicker(v => !v)} className={`kalpa-chat-tool-btn p-2.5 rounded-xl transition-colors ${showEmojiPicker ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}><Smile className="w-5 h-5" /></button>
                    <button type="button" title={isRecordingVoice ? 'Stop voice note' : 'Record voice note'} onClick={isRecordingVoice ? stopVoiceRecording : startVoiceRecording} className={`kalpa-chat-tool-btn p-2.5 rounded-xl transition-colors ${isRecordingVoice ? 'bg-red-50 text-red-600 animate-pulse' : 'bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}>{isRecordingVoice ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}</button>
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

      {actionMenu && activeActionMessage && (
        <div className="fixed z-[99999] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden w-56" style={{ left: actionMenu.x, top: actionMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => replyToMessage(activeActionMessage)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">↩ Reply</button>
          <button type="button" onClick={() => togglePinMessage(activeActionMessage)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">{isPinnedMessage(activeActionMessage) ? '★ Unpin' : '☆ Pin'}</button>
          <button type="button" onClick={(e) => openReactionMenu(e, activeActionMessage)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">😊 React</button>
          <button type="button" onClick={() => forwardMessage(activeActionMessage)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">↗ Forward to...</button>
          <button type="button" onClick={() => copyMessage(activeActionMessage)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">⧉ Copy</button>
          {samePerson(activeActionMessage.sender, currentUser.name) && !activeActionMessage.deleted && <button type="button" onClick={() => editMessage(activeActionMessage)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">✎ Edit</button>}
          <button type="button" onClick={() => deleteForMe(activeActionMessage)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Hide for me</button>
          {(samePerson(activeActionMessage.sender, currentUser.name) || currentUser.role === ROLES.ADMIN) && <button type="button" onClick={() => deleteForEveryone(activeActionMessage)} className="w-full text-left px-4 py-3 text-sm font-black text-red-600 hover:bg-red-50">Delete for everyone</button>}
        </div>
      )}

      {reactionMenu && activeReactionMessage && (
        <div className="fixed z-[99999] bg-white border border-slate-200 rounded-2xl shadow-2xl p-2 overflow-hidden" style={{ left: Math.min(reactionMenu.x, Math.max(12, window.innerWidth - 360)), top: reactionMenu.y, maxWidth: 'min(360px, calc(100vw - 24px))' }} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1 overflow-x-auto pb-1" style={{ overscrollBehaviorX: 'contain' }}>{reactionEmojis.map(emoji => { const selected = Array.isArray((activeReactionMessage.reactions || {})[emoji]) && (activeReactionMessage.reactions || {})[emoji].some(n => samePerson(n, currentUser.name)); return <button type="button" key={emoji} onClick={() => toggleReaction(activeReactionMessage, emoji)} className={`w-10 h-10 shrink-0 rounded-xl text-xl flex items-center justify-center transition-all ${selected ? 'bg-indigo-100 ring-2 ring-indigo-200 scale-105' : 'hover:bg-indigo-50 hover:scale-105'}`}>{emoji}</button>; })}</div>
        </div>
      )}

      {latestUnreadMessage && !isOpen && (
        <button type="button" onClick={() => {
          const target = (latestUnreadMessage.recipient === 'global' || !latestUnreadMessage.recipient) ? 'global' : latestUnreadMessage.sender;
          setActiveChannel(target);
          setIsOpen(true);
          window.setTimeout(() => markCurrentChannelReadNow(target), 100);
        }} className="mb-3 w-[320px] max-w-[calc(100vw-2rem)] text-left bg-white border border-indigo-100 rounded-2xl shadow-xl p-3 animate-in slide-in-from-bottom-2 hover:shadow-2xl transition-shadow">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><MessageSquare className="w-5 h-5" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">New chat message</p>
              <p className="text-sm font-black text-slate-800 truncate">{latestUnreadMessage.sender || 'Team'}</p>
              <p className="text-xs font-semibold text-slate-500 truncate">{latestUnreadMessage.text || latestUnreadMessage.fileName || 'Attachment'}</p>
            </div>
          </div>
        </button>
      )}

      <button type="button" onClick={() => { const nextOpen = !isOpen; setIsOpen(nextOpen); if (nextOpen) markCurrentChannelReadNow(activeChannel); }} className="bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-2xl shadow-xl shadow-slate-300 transition-all hover:scale-105 relative">
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
