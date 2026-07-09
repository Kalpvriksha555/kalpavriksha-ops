import React, { useState, useEffect, useRef, useCallback } from 'react';
import { formatLastSeenDateTime, formatCallDuration, formatDateKey, formatDateTime, formatDuration, formatMinutes } from './utils/date';
import { allProjectDocs, getCompletedDocuments, getLatestCompletedFileName, getTaskDescription, getEstimateDetails, getCompletedFileBadge } from './utils/taskDisplayUtils';
import { PAYMENT_TRACKING_OPTIONS, getPaymentTrackingStatus, getPaymentStatusBadgeClass, buildPaymentTrackingUpdate, getPaymentEstimateAmount, getPaymentReceivedAmount, derivePaymentTrackingStatusFromData } from './features/finance';
import { getBreakMinutesFromLog, getTaskBusySince, getUserActiveTasks, getUserLastCompletedAt, getUserFreeSince, getUserBusySince, getDraftingElapsedMs, getTotalLoggedInMinutesFromLog, getActiveMinutesFromLog, getAttendanceActiveTaskMinutes, buildAttendanceAccrual, deriveAttendanceSession, getAttendanceFirstLoginLabel, buildAttendanceEngineV3 } from './features/attendance';
import { createSafeMeetingRoomName, buildJitsiUrl } from './utils/meeting';
import { copyTextToClipboard } from './utils/clipboard';
import { Badge, PageLoadingScreen, EmptyState, MiniEmptyState } from './components/shared';
import { LocalModeBanner, DatabasePermissionBanner, TopNavigation, MobileSearchBar, MainTabNavigation, MobileBottomNavigation } from './components/layout';
import { PortalLayer } from './components/ui/LayerPortal';
import { Button, IconButton, InlineAlert } from './components/ui/designSystem.jsx';
import { ActiveToasts } from './features/notifications';
import { ProfileView } from './features/profile';
import { CalculatorView } from './features/calculator';
import { TeamMeetingRoom } from './features/meetings';
import { CommunicationHub } from './features/chat';
import { HistoryArchiveView } from './features/archive';
import { CommandCentreView, ProductivityDashboard, DailyClosingReport, ReportsAnalyticsView, ProductionQAView, SystemSettingsView } from './features/command-centre';
import { ActiveOperationsView } from './features/operations';
import { getStatusColor, getPriorityColor, fetchBackendState, createTaskApi, saveBackendStateApi, deleteTaskApi, mergeTaskLists, persistTasksToLocalCache } from './services/taskService';
import { API_BASE, USE_BACKEND_STATE, ONLINE_STALE_MS, MAX_INLINE_DATA_URL_CHARS } from './config/appConfig';
import { fileToBase64, cleanFileName } from './utils/fileUtils';
import { absoluteApiUrl, getProjectFileDownloadUrl, getProjectFilePreviewUrl, getProjectFileActionState, isProjectFilePdf, isProjectFileImage, getProjectFileKind, canPreviewProjectFile, fetchProjectFilePreview, uploadProjectFile, downloadProjectFile, deleteProjectFileFromServer, canDeleteProjectFile, getProjectFileCacheKey, listCachedProjectFiles, openCachedProjectFile, clearCachedProjectFile, pruneExpiredProjectFileCache } from './services/fileService';
import { sendRealOtp, verifyRealOtp } from './services/otpService';
import { buildNotification, getVisibleNotifications, NOTIFICATION_CATEGORIES, getNotificationCategory, getNotificationPriority, buildActivityTimeline, isNotificationForUser } from './services/notificationService';
import { 
  Briefcase, CheckCircle, Clock, FileText, LayoutDashboard, LogOut, 
  MapPin, Plus, Search, User, Users, Wallet, ArrowRight, Upload, 
  List, MessageSquare, Bell, Paperclip, X, Image as ImageIcon, 
  File as FileIcon, Archive, Send, Flag, Shield, Hash, Video, Phone,
  Calendar, Filter, Check, ArrowLeft, Download, ChevronRight, ChevronLeft, Lock, Eye, EyeOff, Map as MapIcon, AlertCircle, KanbanSquare, Link as LinkIcon, BarChart3, Building2, Smile, Star, Mic, Square, Trash2, Edit3, Save, ZoomIn, ZoomOut, RotateCw, RotateCcw, Maximize2, RefreshCcw
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, deleteDoc, getDocs } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

// SMART CONFIG: Safely connects to your real database
const getFirebaseConfig = () => {
  try {
    if (typeof __firebase_config !== 'undefined' && __firebase_config) {
      return typeof __firebase_config === 'string' ? JSON.parse(__firebase_config) : __firebase_config;
    }
  } catch(e) { console.error("Config parse error", e); }
  
  return {
    apiKey: "AIzaSyChp8wyCBMBq1OEPu2dAXvhf2Xr__MyoME",
    authDomain: "kalpvriksha-designs.firebaseapp.com",
    projectId: "kalpvriksha-designs",
    storageBucket: "kalpvriksha-designs.firebasestorage.app",
    messagingSenderId: "523021216335",
    appId: "1:523021216335:web:2edb5a72a6d105c3b6183a",
    measurementId: "G-QL5KLFTHRN"
  };
};

const app = initializeApp(getFirebaseConfig());
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'kalpavriksha_production_v1';
const safeAppId = String(rawAppId).split('/')[0] || 'kalpavriksha_production_v1';

const isLocalMock = !USE_BACKEND_STATE && getFirebaseConfig().apiKey === "mock-key";

const createOpsBroadcast = () => {
  try {
    if (typeof BroadcastChannel !== 'undefined') return new BroadcastChannel('kalpavriksha_ops_sync');
  } catch (e) {}
  return null;
};
const opsBroadcast = createOpsBroadcast();
const OPS_TAB_ID = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

const stripInlineDataUrl = (value) => {
  if (typeof value !== 'string') return value;
  if (!value.startsWith('data:')) return value;
  if (value.length <= MAX_INLINE_DATA_URL_CHARS) return value;
  return '';
};

const sanitizeFileLikeObjectForCache = (fileObj) => {
  if (!fileObj || typeof fileObj !== 'object') return fileObj;
  const next = { ...fileObj };
  const hadLargeUrl = typeof next.url === 'string' && next.url.startsWith('data:') && next.url.length > MAX_INLINE_DATA_URL_CHARS;
  const hadLargeFileUrl = typeof next.fileUrl === 'string' && next.fileUrl.startsWith('data:') && next.fileUrl.length > MAX_INLINE_DATA_URL_CHARS;
  if (hadLargeUrl) next.url = '';
  if (hadLargeFileUrl) next.fileUrl = '';
  if (hadLargeUrl || hadLargeFileUrl) {
    next.localPreviewOnly = true;
    next.note = next.note || 'Large browser-only file preview removed from cross-tab cache to keep the app stable.';
  }
  return next;
};

const sanitizeProjectForCache = (project) => {
  if (!project || typeof project !== 'object') return project;
  return {
    ...project,
    documents: (project.documents || []).map(sanitizeFileLikeObjectForCache),
    completedFiles: (project.completedFiles || []).map(sanitizeFileLikeObjectForCache)
  };
};

const sanitizeProjectsForCache = (projects) => (Array.isArray(projects) ? projects.map(sanitizeProjectForCache) : []);

const getPendingCreatedProjects = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('kalpa_pending_created_projects') || '{}') || {};
    return Object.values(raw).map(record => record?.project || record).filter(project => project?.id);
  } catch(e) { return []; }
};
const rememberPendingCreatedProject = (project) => {
  if (!project?.id) return;
  try {
    const raw = JSON.parse(localStorage.getItem('kalpa_pending_created_projects') || '{}') || {};
    raw[String(project.id)] = { project: sanitizeProjectForCache(project), createdAt: Date.now(), lastAttemptAt: 0, attempts: Number(raw[String(project.id)]?.attempts || 0) };
    localStorage.setItem('kalpa_pending_created_projects', JSON.stringify(raw));
  } catch(e) {}
};
const markPendingCreatedAttempt = (projectId) => {
  try {
    const raw = JSON.parse(localStorage.getItem('kalpa_pending_created_projects') || '{}') || {};
    const key = String(projectId || '');
    if (raw[key]) { raw[key].lastAttemptAt = Date.now(); raw[key].attempts = Number(raw[key].attempts || 0) + 1; localStorage.setItem('kalpa_pending_created_projects', JSON.stringify(raw)); }
  } catch(e) {}
};
const forgetPendingCreatedProjects = (...ids) => {
  const remove = new Set(ids.flat().map(x => String(x)).filter(Boolean));
  if (!remove.size) return;
  try {
    const raw = JSON.parse(localStorage.getItem('kalpa_pending_created_projects') || '{}') || {};
    remove.forEach(id => { delete raw[id]; });
    localStorage.setItem('kalpa_pending_created_projects', JSON.stringify(raw));
  } catch(e) {}
};
const getProtectedCreatedProjectIds = () => new Set(getPendingCreatedProjects().flatMap(p => [p.id, p.caseId]).map(x => String(x || '')).filter(Boolean));

const getPendingDeletedProjectIds = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('kalpa_pending_deleted_project_ids') || '{}') || {};
    return Object.keys(raw).map(x => String(x)).filter(Boolean);
  } catch(e) { return []; }
};
const rememberPendingDeletedProjects = (...ids) => {
  const incoming = ids.flat().map(x => String(x || '')).filter(Boolean);
  if (!incoming.length) return getPendingDeletedProjectIds();
  try {
    const raw = JSON.parse(localStorage.getItem('kalpa_pending_deleted_project_ids') || '{}') || {};
    incoming.forEach(id => { raw[id] = { id, deletedAt: raw[id]?.deletedAt || Date.now(), lastAttemptAt: raw[id]?.lastAttemptAt || 0, attempts: Number(raw[id]?.attempts || 0) }; });
    localStorage.setItem('kalpa_pending_deleted_project_ids', JSON.stringify(raw));
  } catch(e) {}
  return getPendingDeletedProjectIds();
};
const markPendingDeletedAttempt = (id) => {
  try {
    const raw = JSON.parse(localStorage.getItem('kalpa_pending_deleted_project_ids') || '{}') || {};
    const key = String(id || '');
    if (raw[key]) { raw[key].lastAttemptAt = Date.now(); raw[key].attempts = Number(raw[key].attempts || 0) + 1; localStorage.setItem('kalpa_pending_deleted_project_ids', JSON.stringify(raw)); }
  } catch(e) {}
};
const forgetPendingDeletedProjects = (...ids) => {
  const remove = new Set(ids.flat().map(x => String(x || '')).filter(Boolean));
  if (!remove.size) return getPendingDeletedProjectIds();
  try {
    const raw = JSON.parse(localStorage.getItem('kalpa_pending_deleted_project_ids') || '{}') || {};
    remove.forEach(id => { delete raw[id]; });
    localStorage.setItem('kalpa_pending_deleted_project_ids', JSON.stringify(raw));
  } catch(e) {}
  return getPendingDeletedProjectIds();
};
const getDeletedProjectIds = () => {
  try {
    const confirmed = JSON.parse(localStorage.getItem('kalpa_deleted_project_ids') || '[]').map(x => String(x)).filter(Boolean);
    return [...new Set([...confirmed, ...getPendingDeletedProjectIds()])];
  } catch(e) { return getPendingDeletedProjectIds(); }
};
const saveDeletedProjectIds = (ids = [], options = {}) => {
  const protectedIds = getProtectedCreatedProjectIds();
  const force = !!options.force;
  const unique = [...new Set((ids || []).map(x => String(x)).filter(Boolean).filter(id => force || !protectedIds.has(id)))];
  try { localStorage.setItem('kalpa_deleted_project_ids', JSON.stringify(unique)); } catch(e) {}
  return unique;
};
const rememberDeletedProjects = (...ids) => saveDeletedProjectIds([...getDeletedProjectIds(), ...ids.flat().map(x => String(x)).filter(Boolean)]);
const rememberDeletedProjectsForce = (...ids) => saveDeletedProjectIds([...getDeletedProjectIds(), ...ids.flat().map(x => String(x)).filter(Boolean)], { force: true });
const forgetDeletedProjects = (...ids) => {
  const remove = new Set(ids.flat().map(x => String(x)).filter(Boolean));
  if (!remove.size) return getDeletedProjectIds();
  forgetPendingDeletedProjects([...remove]);
  return saveDeletedProjectIds(getDeletedProjectIds().filter(id => !remove.has(String(id))), { force: true });
};
const RECENT_CREATED_PROJECT_TTL_MS = 2 * 60 * 60 * 1000;
const getRecentCreatedProjects = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('kalpa_recent_created_projects') || '{}') || {};
    const now = Date.now();
    const next = {};
    Object.entries(raw).forEach(([id, record]) => {
      const project = record?.project || record;
      const createdAt = Number(record?.createdAt || project?.createdAt || project?.updatedAt || 0);
      if (project?.id && createdAt && now - createdAt < RECENT_CREATED_PROJECT_TTL_MS) {
        next[String(id)] = { project, createdAt };
      }
    });
    if (JSON.stringify(next) !== JSON.stringify(raw)) localStorage.setItem('kalpa_recent_created_projects', JSON.stringify(next));
    return Object.values(next).map(x => x.project).filter(Boolean);
  } catch(e) { return []; }
};
const rememberRecentCreatedProject = (project) => {
  if (!project?.id) return;
  try {
    const raw = JSON.parse(localStorage.getItem('kalpa_recent_created_projects') || '{}') || {};
    raw[String(project.id)] = { project: sanitizeProjectForCache(project), createdAt: Date.now() };
    localStorage.setItem('kalpa_recent_created_projects', JSON.stringify(raw));
  } catch(e) {}
};
const forgetRecentCreatedProjects = (...ids) => {
  const remove = new Set(ids.flat().map(x => String(x || '')).filter(Boolean));
  if (!remove.size) return;
  try {
    const raw = JSON.parse(localStorage.getItem('kalpa_recent_created_projects') || '{}') || {};
    Object.entries(raw).forEach(([key, record]) => {
      const project = record?.project || record || {};
      const identities = [key, project.id, project.caseId, ...(project.previousTaskIds || [])].map(x => String(x || '')).filter(Boolean);
      if (identities.some(id => remove.has(id))) delete raw[key];
    });
    localStorage.setItem('kalpa_recent_created_projects', JSON.stringify(raw));
  } catch(e) {}
};
const projectIdentityMatches = (a = {}, b = {}) => {
  const aIds = [a.id, a.caseId, ...(a.previousTaskIds || [])].map(x => String(x || '')).filter(Boolean);
  const bIds = [b.id, b.caseId, ...(b.previousTaskIds || [])].map(x => String(x || '')).filter(Boolean);
  return aIds.some(id => bIds.includes(id));
};
const confirmPendingCreatedProjectsAgainstServer = (serverProjects = []) => {
  try {
    const pending = getPendingCreatedProjects();
    const confirmed = pending.filter(p => (serverProjects || []).some(s => projectIdentityMatches(p, s))).flatMap(p => [p.id, p.caseId]).filter(Boolean);
    if (confirmed.length) forgetPendingCreatedProjects(confirmed);
  } catch(e) {}
};
const protectRecentlyCreatedProjects = (incoming = [], current = []) => {
  const recent = getRecentCreatedProjects();
  const pending = getPendingCreatedProjects();
  return mergeProjectsByFreshness(mergeProjectsByFreshness(mergeProjectsByFreshness(incoming, current), recent), pending);
};
const filterDeletedProjects = (projects = []) => {
  const deleted = new Set(getDeletedProjectIds());
  const protectedIds = new Set([
    ...getProtectedCreatedProjectIds(),
    ...getRecentCreatedProjects().flatMap(p => [p?.id, p?.caseId]).map(x => String(x || '')).filter(Boolean)
  ]);
  const list = Array.isArray(projects) ? projects : [];
  const supersededIds = new Set();
  list.forEach(p => {
    (p?.previousTaskIds || []).forEach(id => { if (id) supersededIds.add(String(id)); });
    if (p?.supersedesTaskId) supersededIds.add(String(p.supersedesTaskId));
  });
  return list.filter(p => {
    if (!p) return false;
    const id = String(p.id || '');
    const caseId = String(p.caseId || '');
    // A freshly created task must never be hidden by old deleted-id memory.
    // This restores the proven Phase 23C/24B behaviour: create first, protect
    // until backend confirmation, then allow normal delete filtering later.
    if (protectedIds.has(id) || protectedIds.has(caseId)) return true;
    return !deleted.has(id) && !deleted.has(caseId) && !supersededIds.has(id) && !supersededIds.has(caseId);
  });
};


// Persist assignment changes in a small dedicated ledger. This prevents an older
// unassigned project snapshot from winning after refresh/logout/login.
const getAssignmentLedger = () => {
  try { return JSON.parse(localStorage.getItem('kalpa_assignment_ledger') || '{}') || {}; } catch(e) { return {}; }
};
const saveAssignmentLedger = (ledger) => {
  try { localStorage.setItem('kalpa_assignment_ledger', JSON.stringify(ledger || {})); } catch(e) {}
};
const recordAssignmentLedger = (project = {}) => {
  if (!project?.id || !isAssignedValue(project.assignedTo)) return;
  const ledger = getAssignmentLedger();
  const previous = ledger[String(project.id)] || {};
  const incomingVersion = Number(project.assignmentVersion || project.assignedAt || project.updatedAt || Date.now());
  const previousVersion = Number(previous.assignmentVersion || previous.assignedAt || 0);
  if (incomingVersion >= previousVersion) {
    ledger[String(project.id)] = {
      assignedTo: normalizePersonName(project.assignedTo),
      assignedBy: project.assignedBy || previous.assignedBy || '',
      assignedAt: project.assignedAt || previous.assignedAt || incomingVersion,
      assignmentVersion: incomingVersion
    };
    saveAssignmentLedger(ledger);
  }
};
const applyAssignmentLedgerToProject = (project = {}) => {
  if (!project?.id) return project;
  const ledgerItem = getAssignmentLedger()[String(project.id)];
  if (!ledgerItem || !isAssignedValue(ledgerItem.assignedTo)) return project;
  const projectVersion = Number(project.assignmentVersion || project.assignedAt || 0);
  const ledgerVersion = Number(ledgerItem.assignmentVersion || ledgerItem.assignedAt || 0);
  if (!isAssignedValue(project.assignedTo) || ledgerVersion >= projectVersion) {
    return normalizeProjectRecord({
      ...project,
      assignedTo: normalizePersonName(ledgerItem.assignedTo),
      assignedBy: ledgerItem.assignedBy || project.assignedBy,
      assignedAt: ledgerItem.assignedAt || project.assignedAt,
      assignmentVersion: ledgerVersion || project.assignmentVersion,
      ownership: { ...(project.ownership || {}), assignedTo: normalizePersonName(ledgerItem.assignedTo), assignedBy: ledgerItem.assignedBy || project.assignedBy }
    });
  }
  return project;
};
const applyAssignmentLedgerToProjects = (projects = []) => (Array.isArray(projects) ? projects.map(applyAssignmentLedgerToProject) : []);

const sanitizeChatMessageForCache = (message) => sanitizeFileLikeObjectForCache(message);
const sanitizeChatsForCache = (messages) => (Array.isArray(messages) ? messages.map(sanitizeChatMessageForCache) : []);

const chatTimeValue = (message = {}) => {
  const raw = message.sentAt || message.createdAt || message.updatedAt || message.id || 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const mergeChatMessagesByFreshness = (current = [], incoming = []) => {
  const byId = new Map();
  [...sanitizeChatsForCache(current), ...sanitizeChatsForCache(incoming)].forEach((message) => {
    if (!message) return;
    const key = String(message.id || `${message.sender || message.by || ''}-${message.recipient || ''}-${message.sentAt || message.createdAt || ''}-${message.text || message.fileName || ''}`);
    const existing = byId.get(key);
    if (!existing) { byId.set(key, message); return; }
    const readBy = [...(existing.readBy || []), ...(message.readBy || [])].filter(Boolean);
    const reactions = { ...(existing.reactions || {}), ...(message.reactions || {}) };
    byId.set(key, {
      ...existing,
      ...message,
      readBy: Array.from(new Map(readBy.map((entry) => {
        const name = typeof entry === 'string' ? entry : (entry?.name || JSON.stringify(entry));
        return [String(name).toLowerCase(), entry];
      })).values()),
      reactions,
      updatedAt: Math.max(chatTimeValue(existing), chatTimeValue(message)),
    });
  });
  return Array.from(byId.values()).sort((a, b) => chatTimeValue(a) - chatTimeValue(b));
};

const compactLargeLocalStoragePayloads = () => {
  if (typeof localStorage === 'undefined') return;
  ['kalpa_projects', 'kalpa_projects_backup', 'kalpa_chats'].forEach((key) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw || raw.length < 750000) return;
      // Remove very large inline file blobs before React loads them into memory.
      // This preserves task/message metadata and file names while preventing multi-tab OOM crashes.
      const compacted = raw
        .replace(/"url":"data:[^"]{180000,}"/g, '"url":""')
        .replace(/"fileUrl":"data:[^"]{180000,}"/g, '"fileUrl":""');
      if (compacted !== raw) localStorage.setItem(key, compacted);
    } catch (e) {}
  });
};
compactLargeLocalStoragePayloads();

let lastProjectsBroadcastAt = 0;
const broadcastProjectsSync = (projects) => {
  // Broadcast only compact project metadata. Full base64 file blobs must never be
  // sent between tabs or stored repeatedly, otherwise Chrome can run out of memory.
  const now = Date.now();
  if (now - lastProjectsBroadcastAt < 350) return;
  lastProjectsBroadcastAt = now;
  const compactProjects = sanitizeProjectsForCache(filterDeletedProjects(applyAssignmentLedgerToProjects(projects)));
  const deletedProjectIds = getDeletedProjectIds();
  try { localStorage.setItem('kalpa_projects_backup', JSON.stringify(compactProjects)); } catch(e) {}
  try { opsBroadcast?.postMessage({ type: 'projects-updated', projects: compactProjects, deletedProjectIds, source: OPS_TAB_ID }); } catch(e) {}
  try { localStorage.setItem('kalpa_projects_sync_ping', JSON.stringify({ ts: now, source: OPS_TAB_ID })); } catch(e) {}
};



const toMs = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};
const userLastActivityAt = (user = {}) => Math.max(
  toMs(user.lastHeartbeatAt),
  toMs(user.lastSeenAt),
  toMs(user.lastLoginAt),
  toMs(user.availabilityUpdatedAt)
);
const isUserActuallyOnline = (user = {}, nowMs = Date.now()) => {
  if (!user || !user.isOnline) return false;
  const lastActivity = userLastActivityAt(user);
  return !!lastActivity && (nowMs - lastActivity) <= ONLINE_STALE_MS;
};
const normalizeRole = (role = '') => {
  const value = String(role || '').trim().toUpperCase();
  if (value === 'ADMIN') return 'Admin';
  if (value === 'MANAGER') return 'Manager';
  if (value === 'DESIGNER') return 'Designer';
  return role || '';
};
const normalizeStatus = (status = 'APPROVED') => {
  const value = String(status || 'APPROVED').trim().toUpperCase();
  return value || 'APPROVED';
};
const ROLES = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  DESIGNER: 'Designer'
};
const TEAM_ALIASES_TO_BLOCK = []; // no hardcoded staff aliases blocked; deleted/restricted users are filtered by status
const isSystemPlaceholderUser = (u = {}) => {
  const nameKey = String(u.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const usernameKey = String(u.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return /operations\s*manager/i.test(String(u.name || '')) ||
    String(u.id || '') === 'u-manager' ||
    TEAM_ALIASES_TO_BLOCK.includes(nameKey) ||
    TEAM_ALIASES_TO_BLOCK.includes(usernameKey);
};
const hasValidTeamRole = (u = {}) => [ROLES.ADMIN, ROLES.MANAGER, ROLES.DESIGNER].includes(normalizeRole(u.role));
const isApprovedUser = (u = {}) => normalizeStatus(u.status) === 'APPROVED' && hasValidTeamRole(u) && !isSystemPlaceholderUser(u);
const getOperationalUsers = (users = [], { includeAdmins = true } = {}) => (users || [])
  .map(normalizeTeamUser)
  .filter(u => isApprovedUser(u) && (includeAdmins || u.role !== ROLES.ADMIN))
  .sort((a, b) => {
    const roleOrder = { [ROLES.ADMIN]: 0, [ROLES.MANAGER]: 1, [ROLES.DESIGNER]: 2 };
    return (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) || String(a.name).localeCompare(String(b.name));
  });

const isArchivedLifecycleUser = (u = {}) => ['DELETED', 'REJECTED', 'ARCHIVED'].includes(normalizeStatus(u.status));
const getManagedTeamUsers = (users = [], { includeAdmins = true } = {}) => (users || [])
  .map(normalizeTeamUser)
  .filter(u => hasValidTeamRole(u) && !isSystemPlaceholderUser(u) && !isArchivedLifecycleUser(u) && (includeAdmins || u.role !== ROLES.ADMIN))
  .sort((a, b) => {
    const roleOrder = { [ROLES.ADMIN]: 0, [ROLES.MANAGER]: 1, [ROLES.DESIGNER]: 2 };
    return (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) || String(a.name).localeCompare(String(b.name));
  });

const makeEmployeeLifecycleEvent = (type, by = '', details = {}) => ({
  id: `emp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  type,
  by,
  at: Date.now(),
  details
});

const detectEmployeeLifecycleEventType = (existing = {}, next = {}) => {
  if (!existing || !existing.id) return 'EMPLOYEE_CREATED';
  const oldStatus = normalizeStatus(existing.status);
  const newStatus = normalizeStatus(next.status);
  if (!isArchivedLifecycleUser(existing) && isArchivedLifecycleUser(next)) return 'EMPLOYEE_ARCHIVED';
  if (oldStatus !== 'RESTRICTED' && newStatus === 'RESTRICTED') return 'LOGIN_RESTRICTED';
  if (oldStatus === 'RESTRICTED' && newStatus === 'APPROVED') return 'LOGIN_RESTORED';
  if (normalizeRole(existing.role) !== normalizeRole(next.role)) return 'ROLE_CHANGED';
  if (existing.password !== next.password) return 'PASSWORD_RESET';
  return 'EMPLOYEE_UPDATED';
};



const stripLargeLocalFilesForCloud = (project) => sanitizeProjectForCache(project);

const TASK_CATEGORIES = [
  'Key Route Map', 'Key Route + Map Estimate', 'Key Route + Floor Map',
  'Colony Layout', 'Builder Layout', 'Subdivision', 
  'Floor Plan', 'Map Estimate', 'Other'
];

// PRE-CONFIGURED TEAM ACCOUNTS
const INITIAL_USERS = [
  { id: 1, name: 'Ashutosh Rai', username: 'ashutosh', password: '123', role: ROLES.ADMIN, status: 'APPROVED' },
  { id: 2, name: 'Vaibhav Singh', username: 'vaibhav', password: '123', role: ROLES.ADMIN, status: 'APPROVED' },
  { id: 3, name: 'Shubham Upadhyay', username: 'shubham', password: '123', role: ROLES.ADMIN, status: 'APPROVED' },
  { id: 4, name: 'Amit Kushwaha', username: 'amit', password: '123', role: ROLES.MANAGER, status: 'APPROVED' },
  { id: 5, name: 'Waqar', username: 'waqar', password: '123', role: ROLES.DESIGNER, status: 'APPROVED' },
  { id: 6, name: 'Nilu Gupta', username: 'nilu', password: '123', role: ROLES.DESIGNER, status: 'APPROVED' },
  { id: 7, name: 'Khushbu Pandey', username: 'khushbu', password: '123', role: ROLES.DESIGNER, status: 'APPROVED' }
];


const createEmployeeLifecycleProfile = (user = {}, existing = {}) => {
  const now = Date.now();
  const role = normalizeRole(user.role || existing.role || ROLES.DESIGNER);
  const status = normalizeStatus(user.status || existing.status || 'APPROVED');
  const isArchived = ['DELETED', 'REJECTED', 'ARCHIVED'].includes(status);
  const isRestricted = status === 'RESTRICTED';
  const lifecycleStatus = isArchived ? 'ARCHIVED' : (isRestricted ? 'RESTRICTED' : 'ACTIVE');
  const active = lifecycleStatus === 'ACTIVE';
  const base = { ...existing, ...user, role, status };
  const profileCreatedAt = existing.profileCreatedAt || user.profileCreatedAt || now;
  const profileUpdatedAt = now;
  const workingRole = role === ROLES.ADMIN ? 'ADMIN' : (role === ROLES.MANAGER ? 'MANAGER' : 'DESIGNER');
  const previousEvents = Array.isArray(existing.lifecycleEvents) ? existing.lifecycleEvents : [];
  const incomingEvents = Array.isArray(user.lifecycleEvents) ? user.lifecycleEvents : [];
  const lifecycleEvents = [...previousEvents, ...incomingEvents].filter((event, index, arr) =>
    event && event.id && arr.findIndex(e => e && e.id === event.id) === index
  ).slice(-100);
  const lifecycle = {
    ...(existing.lifecycle || {}),
    ...(user.lifecycle || {}),
    status: lifecycleStatus,
    active,
    restricted: isRestricted,
    archived: isArchived,
    createdAt: existing.lifecycle?.createdAt || user.lifecycle?.createdAt || profileCreatedAt,
    updatedAt: profileUpdatedAt,
    archivedAt: isArchived ? (user.deletedAt || user.archivedAt || existing.lifecycle?.archivedAt || now) : null,
    archivedBy: isArchived ? (user.deletedBy || user.archivedBy || existing.lifecycle?.archivedBy || '') : ''
  };
  const attendanceProfile = {
    ...(existing.attendanceProfile || {}),
    ...(user.attendanceProfile || {}),
    createdAt: existing.attendanceProfile?.createdAt || user.attendanceProfile?.createdAt || profileCreatedAt,
    active,
    includeInAttendance: active && role !== ROLES.ADMIN,
    lastPreparedAt: profileUpdatedAt
  };
  const availabilityProfile = {
    ...(existing.availabilityProfile || {}),
    ...(user.availabilityProfile || {}),
    createdAt: existing.availabilityProfile?.createdAt || user.availabilityProfile?.createdAt || profileCreatedAt,
    active,
    trackAvailability: active,
    defaultAvailability: 'Unavailable'
  };
  const chatProfile = {
    ...(existing.chatProfile || {}),
    ...(user.chatProfile || {}),
    createdAt: existing.chatProfile?.createdAt || user.chatProfile?.createdAt || profileCreatedAt,
    active,
    directMessages: active,
    mentions: active
  };
  const performanceProfile = {
    ...(existing.performanceProfile || {}),
    ...(user.performanceProfile || {}),
    createdAt: existing.performanceProfile?.createdAt || user.performanceProfile?.createdAt || profileCreatedAt,
    active: active && role !== ROLES.ADMIN,
    completedTasks: existing.performanceProfile?.completedTasks || user.performanceProfile?.completedTasks || 0,
    revisionsHandled: existing.performanceProfile?.revisionsHandled || user.performanceProfile?.revisionsHandled || 0,
    averageCompletionMinutes: existing.performanceProfile?.averageCompletionMinutes || user.performanceProfile?.averageCompletionMinutes || 0
  };
  const analyticsProfile = {
    ...(existing.analyticsProfile || {}),
    ...(user.analyticsProfile || {}),
    createdAt: existing.analyticsProfile?.createdAt || user.analyticsProfile?.createdAt || profileCreatedAt,
    active,
    role: workingRole,
    daily: existing.analyticsProfile?.daily || user.analyticsProfile?.daily || {},
    weekly: existing.analyticsProfile?.weekly || user.analyticsProfile?.weekly || {},
    monthly: existing.analyticsProfile?.monthly || user.analyticsProfile?.monthly || {}
  };
  const workloadProfile = {
    ...(existing.workloadProfile || {}),
    ...(user.workloadProfile || {}),
    createdAt: existing.workloadProfile?.createdAt || user.workloadProfile?.createdAt || profileCreatedAt,
    active: active && role !== ROLES.ADMIN,
    dailyLimit: existing.workloadProfile?.dailyLimit || user.workloadProfile?.dailyLimit || (role === ROLES.MANAGER || role === ROLES.DESIGNER ? 15 : 0),
    activeTasks: existing.workloadProfile?.activeTasks || user.workloadProfile?.activeTasks || 0,
    pendingTasks: existing.workloadProfile?.pendingTasks || user.workloadProfile?.pendingTasks || 0
  };
  const notificationPreferences = {
    ...(existing.notificationPreferences || {}),
    ...(user.notificationPreferences || {}),
    createdAt: existing.notificationPreferences?.createdAt || user.notificationPreferences?.createdAt || profileCreatedAt,
    enabled: active,
    task: active,
    chat: active,
    mention: active,
    meeting: active,
    desktop: active,
    digest: active
  };
  const normalized = {
    ...base,
    profileCreatedAt,
    profileUpdatedAt,
    lifecycleStatus,
    lifecycle,
    lifecycleEvents,
    attendanceProfile,
    availabilityProfile,
    chatProfile,
    performanceProfile,
    analyticsProfile,
    workloadProfile,
    notificationPreferences
  };
  if (!active) {
    normalized.isOnline = false;
    normalized.availability = 'Unavailable';
    normalized.breakStartedAt = null;
    normalized.lastLogoutAt = normalized.lastLogoutAt || now;
    normalized.lastSeenAt = normalized.lastSeenAt || now;
    normalized.availabilityUpdatedAt = normalized.availabilityUpdatedAt || now;
  }
  return normalized;
};
const normalizeTeamUser = (u = {}) => {
  const rawName = String(u.name || '').trim();
  const rawUsername = String(u.username || '').trim();
  const isKhushbu = /khus+h?bu|khushboo|khushbu/i.test(rawName) || /khus+h?bu|khushboo|khushbu/i.test(rawUsername);
  const isWaqar = /ali\s*waqar|^ali$|^waqar$/i.test(rawName) || /ali|waqar/i.test(rawUsername);
  const normalized = {
    ...u,
    name: isKhushbu ? 'Khushbu Pandey' : (isWaqar ? 'Waqar' : (rawName || u.name)),
    username: isKhushbu ? 'khushbu' : (isWaqar ? 'waqar' : rawUsername),
    role: normalizeRole(u.role),
    status: normalizeStatus(u.status),
    isOnline: !!u.isOnline,
    lastSeenAt: u.lastSeenAt || u.lastLogoutAt || null
  };
  const online = isUserActuallyOnline(normalized);
  const presenceSafe = online ? normalized : {
    ...normalized,
    isOnline: false,
    availability: 'Unavailable',
    breakStartedAt: null
  };
  return createEmployeeLifecycleProfile(presenceSafe, u);
};

const getPresenceMs = (u = {}) => Math.max(
  Number(u.lastHeartbeatAt) || 0,
  Number(u.lastSeenAt) || 0,
  Number(u.lastLoginAt) || 0,
  Number(u.availabilityUpdatedAt) || 0,
  Number(u.lastLogoutAt) || 0
);

const mergeTeamUserPresenceSafely = (prev = {}, incoming = {}) => {
  const prevTs = getPresenceMs(prev);
  const incomingTs = getPresenceMs(incoming);
  const merged = { ...prev, ...incoming, id: prev.id || incoming.id };
  const prevOnlineFresh = !!prev.isOnline && prevTs && (Date.now() - prevTs) <= ONLINE_STALE_MS;
  const incomingStaleOffline = !incoming.isOnline && String(incoming.availability || '').toLowerCase() === 'unavailable';

  // A delayed /api/state response or another idle tab must not erase a fresher
  // live heartbeat already seen by this browser. This was the main cause of the
  // Attendance screen jumping between two contradictory states.
  if (prevTs > incomingTs || (prevOnlineFresh && incomingStaleOffline)) {
    merged.isOnline = prev.isOnline;
    merged.availability = prev.availability;
    merged.lastSeenAt = prev.lastSeenAt;
    merged.lastHeartbeatAt = prev.lastHeartbeatAt;
    merged.lastLoginAt = prev.lastLoginAt;
    merged.lastLogoutAt = prev.lastLogoutAt;
    merged.availabilityUpdatedAt = prev.availabilityUpdatedAt;
    merged.breakStartedAt = prev.breakStartedAt;
  }
  return merged;
};

const normalizeTeamUsers = (list = []) => {
  const source = (Array.isArray(list) && list.length ? list : INITIAL_USERS).map(normalizeTeamUser);
  const byKey = new Map();
  source.forEach(u => {
    const key = String(u.username || identityKey(u.name) || u.id);
    const prev = byKey.get(key) || {};
    byKey.set(key, normalizeTeamUser(mergeTeamUserPresenceSafely(prev, u)));
  });
  return [...byKey.values()];
};

const normalizePersonName = (name = '') => normalizeTeamUser({ name, username: name }).name || name;
const identityKey = (value = '') => normalizePersonName(String(value || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
const samePerson = (a = '', b = '') => identityKey(a) === identityKey(b);

const attendanceLogKey = (log = {}) => `${String(log.userId || log.name || log.id || '').toLowerCase().trim()}_${log.date || ''}`;
const attendanceLogFreshness = (log = {}) => Math.max(
  Number(log.lastTick) || 0,
  Number(log.logoutAt) || 0,
  Number(log.updatedAt) || 0,
  Number(log.loginAt) || 0,
  Number(log.firstLoginAt) || 0
);
const mergeAttendanceLogsStable = (existing = [], incoming = []) => {
  const byKey = new Map();
  [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])].filter(Boolean).forEach(log => {
    const key = attendanceLogKey(log);
    if (!key || key === '_') return;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, log); return; }
    const prevFresh = attendanceLogFreshness(prev);
    const nextFresh = attendanceLogFreshness(log);
    const fresher = nextFresh >= prevFresh ? log : prev;
    const older = nextFresh >= prevFresh ? prev : log;
    byKey.set(key, {
      ...older,
      ...fresher,
      totalLoggedInMinutes: Math.max(Number(prev.totalLoggedInMinutes) || 0, Number(log.totalLoggedInMinutes) || 0),
      activeMinutes: Math.max(Number(prev.activeMinutes) || 0, Number(log.activeMinutes) || 0),
      productiveMinutes: Math.max(Number(prev.productiveMinutes) || 0, Number(log.productiveMinutes) || 0),
      totalBreakMinutes: Math.max(Number(prev.totalBreakMinutes || prev.breakMinutes) || 0, Number(log.totalBreakMinutes || log.breakMinutes) || 0),
      loginAt: (Number(prev.loginAt) && Number(log.loginAt)) ? Math.min(Number(prev.loginAt), Number(log.loginAt)) : (Number(prev.loginAt) || Number(log.loginAt) || null),
      firstLoginAt: (Number(prev.firstLoginAt) && Number(log.firstLoginAt)) ? Math.min(Number(prev.firstLoginAt), Number(log.firstLoginAt)) : (Number(prev.firstLoginAt) || Number(log.firstLoginAt) || null),
      loginTime: prev.loginTime || log.loginTime || fresher.loginTime || ''
    });
  });
  return [...byKey.values()];
};

const readEntryName = (entry) => typeof entry === 'string' ? entry : (entry?.name || '');
const hasReadBy = (message, userName) => (message?.readBy || []).some(r => samePerson(readEntryName(r), userName));

const normalizeTimelineEvent = (event = {}) => {
  const at = event.at || event.time || event.createdAt || new Date().toISOString();
  const title = event.title || event.text || event.action || 'Timeline Event';
  return {
    ...event,
    id: event.id || `${at}-${title}`,
    title,
    text: event.text || title,
    by: event.by || event.user || event.createdBy || 'System',
    at,
    time: event.time || at,
    remarks: event.remarks || event.note || ''
  };
};

const normalizeTimeline = (timeline = [], history = []) => {
  const raw = Array.isArray(timeline) && timeline.length
    ? timeline
    : (Array.isArray(history) ? history.map(h => ({ title: h.action, text: h.action, by: h.by, at: h.at, time: h.at })) : []);
  const seen = new Set();
  return raw.map(normalizeTimelineEvent).filter(event => {
    const key = [event.type || '', event.title || event.text || '', event.by || '', event.at || event.time || '', event.remarks || ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(a.at || a.time || 0).getTime() - new Date(b.at || b.time || 0).getTime());
};

const normalizeProjectRecord = (project = {}) => {
  const assignedTo = normalizePersonName(project.assignedTo || '');
  const createdBy = normalizePersonName(project.createdBy || '');
  const manager = normalizePersonName(project.manager || '');
  return {
    ...project,
    assignedTo: assignedTo || project.assignedTo,
    createdBy: createdBy || project.createdBy,
    manager: manager || project.manager,
    taskName: project.taskName || makeTaskDisplayName(project),
    timeline: normalizeTimeline(project.timeline, project.history)
  };
};

const normalizeProjectRecords = (list = []) => (Array.isArray(list) ? list : []).map(normalizeProjectRecord);

const projectFreshness = (p = {}) => Number(p.updatedAt || p.syncVersion || p.assignmentVersion || p.assignedAt || p.completedAt || p.submittedAt || p.createdAt || 0);
const isAssignedValue = (value) => Boolean(value && String(value).trim() && String(value).trim() !== 'Unassigned');
const assignmentFreshness = (p = {}) => Number(p.assignmentVersion || p.assignedAt || 0);
const mergeProjectRecordSafely = (existing = {}, incoming = {}) => {
  const a = normalizeProjectRecord(existing || {});
  const b = normalizeProjectRecord(incoming || {});
  const incomingNewer = projectFreshness(b) >= projectFreshness(a);
  const base = incomingNewer ? { ...a, ...b } : { ...b, ...a };
  base.timeline = normalizeTimeline([...(a.timeline || []), ...(b.timeline || [])], [...(a.history || []), ...(b.history || [])]);

  // Assignment is business-critical and must not be downgraded by an older
  // Unassigned copy arriving from another tab, cache, or delayed snapshot.
  // Keep the newest assigned value field-wise rather than blindly replacing
  // the whole project record. This fixes Admin seeing Unassigned after a
  // Manager assigns in another session.
  const aAssigned = isAssignedValue(a.assignedTo);
  const bAssigned = isAssignedValue(b.assignedTo);
  if (aAssigned || bAssigned) {
    const chosen = !aAssigned ? b : !bAssigned ? a : (assignmentFreshness(b) >= assignmentFreshness(a) ? b : a);
    base.assignedTo = normalizePersonName(chosen.assignedTo);
    base.assignedBy = chosen.assignedBy || base.assignedBy;
    base.assignedAt = chosen.assignedAt || base.assignedAt;
    base.assignmentVersion = chosen.assignmentVersion || chosen.assignedAt || base.assignmentVersion;
    base.ownership = { ...(base.ownership || {}), assignedTo: base.assignedTo, assignedBy: base.assignedBy };
    recordAssignmentLedger(base);
  } else {
    base.assignedTo = 'Unassigned';
  }

  return normalizeProjectRecord(base);
};
const mergeProjectsByFreshness = (current = [], incoming = []) => {
  const map = new Map();
  [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]
    .map(normalizeProjectRecord)
    .forEach(p => {
      if (!p?.id) return;
      const key = String(p.id);
      const existing = map.get(key);
      map.set(key, existing ? mergeProjectRecordSafely(existing, p) : p);
    });
  return applyAssignmentLedgerToProjects(Array.from(map.values()).sort((a,b) => projectFreshness(b) - projectFreshness(a)));
};

const persistAndBroadcastProjects = (projects) => {
  const normalized = filterDeletedProjects(applyAssignmentLedgerToProjects(normalizeProjectRecords(mergeTaskLists([], projects))));
  normalized.forEach(recordAssignmentLedger);
  return persistTasksToLocalCache(normalized, {
    sanitize: sanitizeProjectsForCache,
    filterDeleted: filterDeletedProjects,
    broadcast: broadcastProjectsSync
  });
};

const getFileIcon = (filename) => {
  if (!filename) return <FileIcon className="w-5 h-5 text-slate-500" />;
  const ext = filename.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return <ImageIcon className="w-5 h-5 text-blue-500" />;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileText className="w-5 h-5 text-green-600" />;
  if (['doc', 'docx'].includes(ext)) return <FileText className="w-5 h-5 text-blue-600" />;
  if (['pdf'].includes(ext)) return <FileText className="w-5 h-5 text-red-500" />;
  if (['dwg', 'dxf'].includes(ext)) return <FileIcon className="w-5 h-5 text-indigo-500" />;
  return <FileIcon className="w-5 h-5 text-slate-500" />;
};

const exportToCSV = (headers, rows, filename) => {
  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const getAttendanceUser = (log, users = []) => {
  return (users || []).find(u => String(u.id) === String(log.userId))
    || (users || []).find(u => samePerson(u.name, log.name))
    || null;
};

const getProjectDateKey = (project) => formatDateKey(project.createdAt || project.completedAt || Date.now());

const getDraftElapsed = (project, now = Date.now()) => {
  const elapsedMs = getDraftingElapsedMs(project, now);
  if (!elapsedMs && !project?.draftingStartedAt) return '-';
  return formatMinutes(Math.floor(elapsedMs / 60000));
};


const getTodayStart = () => new Date().setHours(0,0,0,0);

const getDailyTaskLimit = (projects = []) => {
  const todayStart = getTodayStart();
  const todayCount = projects.filter(p => (p.createdAt || 0) >= todayStart).length;
  if (todayCount >= 10) return 15;
  if (todayCount >= 5) return 10;
  return 5;
};

const LOCATION_CODE_MAP = {
  VARANASI: 'VNS', BANARAS: 'VNS', KASHI: 'VNS',
  LUCKNOW: 'LKO', AGRA: 'AGR', MATHURA: 'MTR', AYODHYA: 'AYD',
  GORAKHPUR: 'GKP', PRAYAGRAJ: 'PRJ', ALLAHABAD: 'PRJ',
  KANPUR: 'KNP', NOIDA: 'NDA', RAEBARELI: 'RBL', RAEBAREILLY: 'RBL', 'RAI BARELI': 'RBL', 'RAI BAREILLY': 'RBL',
  BAREILLY: 'BRL', MEERUT: 'MRT', GHAZIABAD: 'GZB', JHANSI: 'JHN',
  ALIGARH: 'ALG', MORADABAD: 'MRD', SAHARANPUR: 'SHP', FIROZABAD: 'FRZ',
  FAIZABAD: 'AYD', BARABANKI: 'BBK', SITAPUR: 'STP', UNNAO: 'UNN',
  SULTANPUR: 'SLP', AMETHI: 'AMT', JAUNPUR: 'JNP', BALLIA: 'BLL',
  AZAMGARH: 'AZM', MIRZAPUR: 'MZP', GONDA: 'GND', BASTI: 'BST'
};

const normalizeCodeInput = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();



const LOCATION_DISPLAY_ALIASES = {
  LKO: 'LUCKNOW', LKN: 'LUCKNOW', LUCKNOW: 'LUCKNOW',
  VNS: 'VARANASI', BANARAS: 'VARANASI', KASHI: 'VARANASI', VARANASI: 'VARANASI',
  KNP: 'KANPUR', KANPUR: 'KANPUR',
  AGR: 'AGRA', AGRA: 'AGRA',
  MTR: 'MATHURA', MATHURA: 'MATHURA',
  AYD: 'AYODHYA', FAIZABAD: 'AYODHYA', AYODHYA: 'AYODHYA',
  PRJ: 'PRAYAGRAJ', PRAYAGRAJ: 'PRAYAGRAJ', ALLAHABAD: 'PRAYAGRAJ',
  NDA: 'NOIDA', NOIDA: 'NOIDA',
  RBL: 'RAIBARELI', RAEBARELI: 'RAIBARELI', RAEBAREILLY: 'RAIBARELI', 'RAI BARELI': 'RAIBARELI', 'RAI BAREILLY': 'RAIBARELI',
  BRL: 'BAREILLY', BAREILLY: 'BAREILLY',
  MRT: 'MEERUT', MEERUT: 'MEERUT',
  GZB: 'GHAZIABAD', GHAZIABAD: 'GHAZIABAD'
};

const toTitleCase = (value = '') => String(value || '').toLowerCase().replace(/\w/g, char => char.toUpperCase());
const canonicalDisplayValue = (value = '', aliases = {}) => {
  const key = normalizeCodeInput(value);
  if (!key) return '';
  return aliases[key] || key;
};
const getCanonicalLocationName = (value = '') => canonicalDisplayValue(value, LOCATION_DISPLAY_ALIASES);
const getCanonicalBankName = (value = '') => canonicalDisplayValue(value, {});

const makeCodePart = (value = '', fallback = 'GEN', maxLength = 4) => {
  const clean = normalizeCodeInput(value);
  if (!clean) return fallback;
  const words = clean.split(/\s+/).filter(Boolean);
  const token = words.length >= 2 ? words.map(w => w[0]).join('') : words[0];
  return (token || fallback).slice(0, maxLength);
};

const makeLocationCode = (location = '') => {
  const clean = normalizeCodeInput(location);
  if (!clean) return 'LOC';
  if (LOCATION_CODE_MAP[clean]) return LOCATION_CODE_MAP[clean];
  const matchedKey = Object.keys(LOCATION_CODE_MAP).find(key => clean.includes(key) || key.includes(clean));
  if (matchedKey) return LOCATION_CODE_MAP[matchedKey];
  return makeCodePart(clean, 'LOC', 3);
};

const generateTraceableTaskId = ({ location = '', client = '', bankerName = '', customerName = '', projects = [], excludeId = '' } = {}) => {
  // Format: STATION-BANK-CUSTOMER-NUMBER (example: LKO-PNB-SHUB-0001)
  // Station codes use the fixed office code map requested by the team.
  const loc = makeLocationCode(location);
  const bank = makeCodePart(client, 'BANK', 4);
  const person = makeCodePart(customerName || bankerName, 'CASE', 4);
  const prefix = `${loc}-${bank}-${person}`;
  const existing = new Set((projects || [])
    .filter(p => String(p.id || '') !== String(excludeId || ''))
    .map(p => String(p.id || '')));
  let serial = 1;
  let nextId = `${prefix}-${String(serial).padStart(4, '0')}`;
  while (existing.has(nextId)) {
    serial += 1;
    nextId = `${prefix}-${String(serial).padStart(4, '0')}`;
  }
  return nextId;
};

const getCustomerDisplayName = (project = {}) => project.customerName || 'Customer not added';
const getBankDisplayName = (project = {}) => project.client || project.bankName || 'Bank not added';
const makeTaskDisplayName = (project = {}) => {
  return [project.type, getCustomerDisplayName(project), project.location].filter(Boolean).join(' • ');
};

const getAssignmentRecommendations = (users = [], projects = []) => {
  const limit = getDailyTaskLimit(projects);
  const todayStart = getTodayStart();
  return users
    .filter(u => (u.role === ROLES.DESIGNER || u.role === ROLES.MANAGER) && String(u.status || 'APPROVED').toUpperCase() === 'APPROVED')
    .map(u => {
      const active = projects.filter(p => p.assignedTo === u.name && p.status !== 'Completed').length;
      const doneToday = projects.filter(p => p.assignedTo === u.name && p.status === 'Completed' && (p.completedAt || 0) >= todayStart).length;
      const onBreak = u.availability === 'Break';
      const offline = !isUserActuallyOnline(u);
      let score = active + (onBreak ? 2 : 0) + (offline ? 3 : 0);
      return { ...u, active, doneToday, limit, onBreak, offline, score };
    })
    .sort((a,b) => a.score - b.score || b.doneToday - a.doneToday || a.name.localeCompare(b.name));
};

const getDisplayTaskId = (project = {}) => project.displayId || project.originalTaskId || project.id;
const isRevisionWorkItem = (project = {}) => project.isRevisionWorkItem === true || String(project.id || '').includes('__REV__');
const getNextRevisionNumber = (project = {}) => {
  const existing = [
    ...(Array.isArray(project.revisionHistory) ? project.revisionHistory : []),
    ...(Array.isArray(project.subTasks) ? project.subTasks : [])
  ];
  const nums = existing.map(item => Number(item.revisionNumber || String(item.revisionCode || '').replace(/[^0-9]/g, ''))).filter(Number.isFinite);
  return Math.max(0, ...nums) + 1;
};
const makeRevisionWorkItem = (project = {}, revision = {}, requestedBy = '') => {
  const now = revision.createdAt || Date.now();
  const revisionNumber = revision.revisionNumber || getNextRevisionNumber(project);
  const baseId = String(project.originalTaskId || project.displayId || project.id || `TASK-${now}`);
  return normalizeProjectRecord({
    ...project,
    id: `${baseId}__REV__${revisionNumber}_${now}`,
    displayId: baseId,
    originalTaskId: baseId,
    isRevisionWorkItem: true,
    showInMyTasks: true,
    revisionAssignedAt: now,
    revisionNumber,
    revisionCode: `R${revisionNumber}`,
    taskName: `${project.taskName || makeTaskDisplayName(project)} • Revision ${revisionNumber}`,
    status: 'Revision Pending',
    assignedAt: now,
    assignmentVersion: now,
    priority: 'Urgent',
    createdAt: now,
    updatedAt: now,
    syncVersion: now,
    completedAt: null,
    approvedAt: null,
    submittedAt: null,
    draftingStartedAt: null,
    currentDraftingStartedAt: null,
    draftingCompletedAt: null,
    internalReviewStartedAt: null,
    finalConclusion: 'Revision Pending',
    reviewStatus: 'Revision Pending',
    revisionRequestedAt: now,
    revisionRequestedBy: requestedBy,
    // A revision work item is operational only. It must not create a second
    // finance/ledger/payment row and must keep the original task ID as the
    // business-facing ID.
    excludeFromLedger: true,
    isFinanceExcluded: true,
    estimate: 0,
    paymentStatus: 'Revision',
    paymentTrackingStatus: 'Revision',
    ledger: {},
    documents: revision.attachments ? [...revision.attachments] : [],
    completedFiles: [],
    subTasks: [{ ...revision, id: revision.id || now, status: 'Pending' }],
    timeline: [
      { id: now, text: `Revision ${revisionNumber} created from original task ${baseId}${requestedBy ? ` by ${requestedBy}` : ''}`, time: new Date(now).toLocaleString() },
      ...(revision.title ? [{ id: now + 1, text: `Revision note: ${revision.title}`, time: new Date(now).toLocaleString() }] : [])
    ]
  });
};


const getRevisionTimelineItems = (project = {}, projects = []) => {
  const baseId = String(project.originalTaskId || project.displayId || project.id || '');
  const items = [];
  const pushItem = (raw = {}, fallback = {}) => {
    if (!raw) return;
    const label = raw.revisionCode || (raw.revisionNumber ? `R${raw.revisionNumber}` : fallback.revisionCode || 'REV');
    const title = raw.title || raw.comment || raw.text || raw.action || fallback.title || 'Revision activity';
    const ts = Number(raw.at || raw.completedAt || raw.createdAt || raw.updatedAt || raw.id || fallback.at || Date.now());
    items.push({
      id: raw.id || `${label}-${ts}-${items.length}`,
      label,
      title,
      action: raw.action || fallback.action || raw.status || 'Revision Activity',
      status: raw.status || fallback.status || 'Pending',
      by: raw.reviewer || raw.completedBy || raw.addedBy || raw.by || raw.requestedBy || fallback.by || '',
      at: ts,
      workItemId: raw.workItemId || fallback.workItemId || '',
      files: raw.files || raw.attachments || fallback.files || [],
    });
  };

  (Array.isArray(project.revisionHistory) ? project.revisionHistory : []).forEach(item => pushItem(item));
  (Array.isArray(project.reviewHistory) ? project.reviewHistory : [])
    .filter(item => String(item.action || item.comment || '').toLowerCase().includes('revision'))
    .forEach(item => pushItem(item));
  (Array.isArray(project.subTasks) ? project.subTasks : []).forEach(item => pushItem(item, { action: 'Revision Requested', status: item.status || 'Pending' }));

  (Array.isArray(projects) ? projects : [])
    .filter(item => isRevisionWorkItem(item) && String(item.originalTaskId || item.displayId || '').trim() === baseId)
    .forEach(item => {
      const revisionNumber = item.revisionNumber || getNextRevisionNumber(project);
      pushItem({
        id: item.id,
        revisionNumber,
        revisionCode: item.revisionCode || `R${revisionNumber}`,
        title: item.taskName || `Revision ${revisionNumber}`,
        action: item.status === 'Completed' ? 'Revision Completed' : 'Revision Work Item',
        status: item.status || 'Revision Pending',
        completedBy: item.completedBy || item.assignedTo,
        createdAt: item.createdAt,
        completedAt: item.completedAt,
        workItemId: item.id,
        files: [...(item.completedFiles || []), ...(item.documents || []).filter(doc => String(doc.type || '').toLowerCase() === 'completed')]
      });
    });

  const seen = new Set();
  return items
    .filter(item => {
      const key = [item.label, item.action, item.title, item.workItemId, item.at].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.at || 0) - (b.at || 0));
};

const isRevisionTimelineItemCompleted = (item = {}) => ['DONE', 'COMPLETED', 'APPROVED', 'CLOSED', 'RESOLVED'].includes(normalizeWorkStatusForRevision(item.status || item.action));

const isIncompleteProject = (project = {}) => project.status !== 'Completed';

const isCarriedForwardProject = (project = {}, dateKey = formatDateKey()) => {
  const projectDate = getProjectDateKey(project);
  return isIncompleteProject(project) && projectDate < dateKey;
};

const shouldShowOnOperationsDate = (project = {}, dateKey = formatDateKey()) => {
  const projectDate = getProjectDateKey(project);
  if (projectDate === dateKey) return true;
  // Today's operations should start fresh but still carry forward old pending work.
  if (dateKey === formatDateKey() && isCarriedForwardProject(project, dateKey)) return true;
  return false;
};

const normalizeWorkStatusForRevision = (status = '') => String(status || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const CLOSED_REVISION_STATUSES = new Set(['COMPLETED', 'APPROVED', 'ARCHIVED', 'CLOSED', 'DELETED', 'CANCELLED', 'CANCELED']);
const ACTIVE_REVISION_STATUSES = new Set(['REVISIONPENDING', 'REVISIONINPROGRESS', 'REVERTED']);
const isSubTaskOpen = (subTask = {}) => !['DONE', 'COMPLETED', 'APPROVED', 'CLOSED', 'RESOLVED'].includes(normalizeWorkStatusForRevision(subTask.status || 'Pending'));
const hasActiveRevision = (project = {}) => {
  const statusKey = normalizeWorkStatusForRevision(project.status);
  const reviewKey = normalizeWorkStatusForRevision(project.reviewStatus || project.finalConclusion || '');
  if (CLOSED_REVISION_STATUSES.has(statusKey) || reviewKey === 'APPROVED') return false;
  return ACTIVE_REVISION_STATUSES.has(statusKey)
    || ACTIVE_REVISION_STATUSES.has(reviewKey)
    || (project.subTasks || project.revisions || []).some(isSubTaskOpen);
};

const getSlaInfo = (project = {}, now = Date.now()) => {
  const createdAt = project.createdAt || now;
  const assignedAt = project.assignedAt || project.assignedOn || (project.assignedTo && project.assignedTo !== 'Unassigned' ? createdAt : null);
  const draftStart = project.draftingStartedAt || (project.status === 'Drafting' ? assignedAt || createdAt : null);
  const submittedAt = project.submittedAt || project.draftingCompletedAt || null;
  const completedAt = project.completedAt || null;
  const totalEnd = completedAt || now;
  const draftingEnd = submittedAt || completedAt || now;
  const reviewStart = submittedAt || null;
  const reviewEnd = completedAt || now;
  const ageHours = Math.floor((totalEnd - createdAt) / 3600000);
  const isDelayed = project.status !== 'Completed' && ageHours >= 8;
  const isWarning = project.status !== 'Completed' && ageHours >= 4 && ageHours < 8;
  return {
    createdAt, assignedAt, draftStart, submittedAt, completedAt,
    total: formatDuration(createdAt, totalEnd),
    drafting: draftStart ? formatDuration(draftStart, draftingEnd) : '-',
    review: reviewStart ? formatDuration(reviewStart, reviewEnd) : '-',
    ageHours,
    label: isDelayed ? 'Delayed' : isWarning ? 'Near SLA' : project.status === 'Completed' ? 'Completed' : 'On Track',
    colorClass: isDelayed ? 'bg-red-50 text-red-700 border-red-200' : isWarning ? 'bg-orange-50 text-orange-700 border-orange-200' : project.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-200'
  };
};

const getTodayMetrics = (projects = [], dateKey = formatDateKey()) => {
  const todays = projects.filter(p => getProjectDateKey(p) === dateKey);
  const carried = projects.filter(p => isCarriedForwardProject(p, dateKey));
  const activeToday = projects.filter(p => shouldShowOnOperationsDate(p, dateKey));
  const completedToday = projects.filter(p => p.status === 'Completed' && formatDateKey(p.completedAt || p.createdAt) === dateKey);
  const pendingCollections = projects.filter(p => !isRevisionWorkItem(p) && !p.excludeFromLedger && !p.isFinanceExcluded && (Number(p.estimate) || 0) > (Number(p.ledger?.amountIn) || 0));
  const paymentsToday = projects.filter(p => p.ledger?.updatedAt && formatDateKey(p.ledger.updatedAt) === dateKey);
  const revisions = activeToday.filter(hasActiveRevision);
  return {
    todays, carried, activeToday, completedToday, pendingCollections, paymentsToday, revisions,
    received: todays.length,
    carriedCount: carried.length,
    pending: activeToday.filter(p => p.status === 'Lead Received').length,
    drafting: activeToday.filter(p => p.status === 'Drafting').length,
    review: activeToday.filter(p => p.status === 'Internal Review').length,
    completed: completedToday.length,
    paymentReceived: paymentsToday.reduce((sum, p) => sum + (Number(p.ledger?.amountIn) || 0), 0),
    pendingAmount: pendingCollections.reduce((sum, p) => sum + Math.max(0, (Number(p.estimate) || 0) - (Number(p.ledger?.amountIn) || 0)), 0)
  };
};

const getDocumentReadiness = (project = {}) => {
  const docs = allProjectDocs(project);
  const hasSource = docs.some(d => d.type === 'source');
  const hasFinal = getCompletedDocuments(project).length > 0;
  const hasWorking = docs.some(d => d.type === 'working');
  const hasQr = docs.some(d => String(d.name || '').toLowerCase().includes('qr'));
  const items = [
    { label: 'Source files', done: hasSource },
    { label: 'Working/draft files', done: hasWorking || hasFinal },
    { label: 'Completed file', done: hasFinal },
    { label: 'QR attached', done: hasQr || hasFinal }
  ];
  const score = Math.round((items.filter(i => i.done).length / items.length) * 100);
  return { score, items };
};

const LoginScreen = ({ onLogin, users, onRecoverPassword }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryUser, setRecoveryUser] = useState('');
  const [recoveryMethod, setRecoveryMethod] = useState('email');
  const [recoveryMobile, setRecoveryMobile] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryOtp, setRecoveryOtp] = useState('');
  const [recoveryChallengeId, setRecoveryChallengeId] = useState('');
  const [recoveryNewPass, setRecoveryNewPass] = useState('');
  const [recoveryConfirmPass, setRecoveryConfirmPass] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  const activeUsers = normalizeTeamUsers(users && users.length > 0 ? users : INITIAL_USERS);
  const handleLogin = (e) => {
    e.preventDefault();
    const sourceUsers = activeUsers.some(u => u.username) ? activeUsers : INITIAL_USERS;
    const user = sourceUsers.find(u => 
      (u.username || '').toLowerCase() === username.toLowerCase().trim() && 
      (u.password || '123') === password && 
      u.status === 'APPROVED'
    );
    
    if (user) {
       onLogin(user);
    } else {
       setError('Invalid username/password, or this login has been restricted by Admin.');
    }
  };

  const recoveryMatch = activeUsers.find(u => (u.username || '').toLowerCase() === recoveryUser.toLowerCase().trim());

  const handleSendRecoveryOtp = async () => {
    setRecoveryMessage('');
    if (!recoveryMatch) {
      setRecoveryMessage('No approved user found with this username.');
      return;
    }
    const method = recoveryMethod === 'mobile' ? 'mobile' : 'email';
    if (method === 'email') {
      const registeredEmail = String(recoveryMatch.email || '').trim().toLowerCase();
      const enteredEmail = String(recoveryEmail || '').trim().toLowerCase();
      if (!recoveryMatch.emailRegistered) {
        setRecoveryMessage('Email is not OTP-registered for this account. Please login and register email from Profile, or ask an Admin to reset the password.');
        return;
      }
      if (!registeredEmail) {
        setRecoveryMessage('No registered email is saved for this account. Please ask an Admin to reset the password.');
        return;
      }
      if (!enteredEmail || enteredEmail !== registeredEmail) {
        setRecoveryMessage('Registered email address does not match this account.');
        return;
      }
      try {
        const otpResponse = await sendRealOtp({ username: recoveryMatch.username, email: enteredEmail, channel: 'email', purpose: 'password_recovery' });
        setRecoveryChallengeId(otpResponse.challengeId || '');
        setOtpSent(true);
        setRecoveryMessage(`OTP sent to registered email ${registeredEmail.replace(/(.{2}).+(@.+)/, '$1***$2')}.`);
      } catch (err) {
        setOtpSent(false);
        setRecoveryChallengeId('');
        setRecoveryMessage(err.message || 'Unable to send email OTP. Please contact an Admin.');
      }
      return;
    }

    const registeredMobile = String(recoveryMatch.phone || recoveryMatch.mobile || '').replace(/\D/g, '');
    const enteredMobile = String(recoveryMobile || '').replace(/\D/g, '');
    if (!recoveryMatch.mobileRegistered) {
      setRecoveryMessage('Mobile is not OTP-registered for this account. Use Email OTP if registered, or ask an Admin to reset the password.');
      return;
    }
    if (!registeredMobile) {
      setRecoveryMessage('No registered mobile is saved for this account. Please ask an Admin to reset the password.');
      return;
    }
    if (!enteredMobile || enteredMobile.slice(-10) !== registeredMobile.slice(-10)) {
      setRecoveryMessage('Registered mobile number does not match this account.');
      return;
    }
    try {
      const otpResponse = await sendRealOtp({ username: recoveryMatch.username, mobile: enteredMobile, channel: 'mobile', purpose: 'password_recovery' });
      setRecoveryChallengeId(otpResponse.challengeId || '');
      setOtpSent(true);
      setRecoveryMessage(`OTP sent to registered mobile ending ${registeredMobile.slice(-4)}.`);
    } catch (err) {
      setOtpSent(false);
      setRecoveryChallengeId('');
      setRecoveryMessage(err.message || 'Unable to send mobile OTP. Please use Email OTP or contact an Admin.');
    }
  };

  const handlePasswordRecovery = async () => {
    setRecoveryMessage('');
    if (!recoveryMatch) {
      setRecoveryMessage('No approved user found with this username.');
      return;
    }
    if (!otpSent || !recoveryChallengeId) {
      setRecoveryMessage('Please send and verify OTP first.');
      return;
    }
    try {
      await verifyRealOtp({ challengeId: recoveryChallengeId, otp: recoveryOtp, purpose: 'password_recovery' });
    } catch (err) {
      setRecoveryMessage(err.message || 'Invalid OTP. Please check the OTP and try again.');
      return;
    }
    if (!recoveryNewPass || recoveryNewPass.length < 3) {
      setRecoveryMessage('New password must be at least 3 characters.');
      return;
    }
    if (recoveryNewPass !== recoveryConfirmPass) {
      setRecoveryMessage('New password and confirm password do not match.');
      return;
    }
    onRecoverPassword({ ...recoveryMatch, password: recoveryNewPass, passwordUpdatedAt: Date.now(), passwordResetBy: `${recoveryMethod === 'mobile' ? 'Mobile' : 'Email'} OTP Recovery` });
    setRecoveryMessage('Password reset successfully. You can login with the new password now.');
    setUsername(recoveryMatch.username || '');
    setPassword('');
    setRecoveryOtp('');
    setRecoveryChallengeId('');
    setOtpSent(false);
    setRecoveryNewPass('');
    setRecoveryConfirmPass('');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md border border-slate-100 relative z-10">
        <div className="text-center mb-8">
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-indigo-200 transform rotate-3">
            <Shield className="text-white w-10 h-10 -rotate-3" />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Kalpvriksha Designs Ops</h1>
          <p className="text-slate-500 mt-2 font-medium">Secure Team Portal</p>
        </div>
        
        {error && <div className="bg-red-50 text-red-700 p-4 rounded-xl mb-6 text-sm font-bold text-center border border-red-100 animate-in shake">{error}</div>}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
             <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Username</label>
             <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input required type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full border-2 border-slate-100 pl-12 pr-4 py-3.5 rounded-xl focus:border-indigo-500 focus:ring-0 outline-none transition-colors font-bold text-slate-800" placeholder="Enter username" />
             </div>
          </div>
          <div>
             <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Password</label>
             <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input required type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} className="w-full border-2 border-slate-100 pl-12 pr-12 py-3.5 rounded-xl focus:border-indigo-500 focus:ring-0 outline-none transition-colors font-bold text-slate-800" placeholder="••••••••" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 transition-colors">
                   {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
             </div>
          </div>
          <div className="flex justify-end -mt-1">
            <button type="button" onClick={() => { setShowRecovery(true); setError(''); }} className="text-xs font-black text-indigo-600 hover:text-indigo-800 uppercase tracking-widest">Forgot password?</button>
          </div>
          <button type="submit" className="w-full bg-slate-800 text-white py-4 rounded-xl font-black text-lg hover:bg-slate-700 transition-all shadow-xl shadow-slate-200 mt-6 hover:-translate-y-1">Secure Login</button>
        </form>

        {showRecovery && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl border-2 border-slate-100 p-6 w-full max-w-md animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-black text-slate-800">Password Recovery</h2>
                <button type="button" onClick={() => setShowRecovery(false)} className="p-2 rounded-xl hover:bg-slate-50 text-slate-400"><X className="w-5 h-5" /></button>
              </div>
              <p className="text-sm font-semibold text-slate-500 mb-4">Enter username and choose registered email or mobile. Password reset is allowed only after OTP verification.</p>
              <input value={recoveryUser} onChange={e => { setRecoveryUser(e.target.value); setRecoveryMessage(''); setOtpSent(false); }} placeholder="Username" className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500 mb-3" />
              <div className="grid grid-cols-2 gap-2 mb-3">
                <button type="button" onClick={() => { setRecoveryMethod('email'); setOtpSent(false); setRecoveryMessage(''); }} className={`py-2.5 rounded-xl font-black border ${recoveryMethod === 'email' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}>Email OTP</button>
                <button type="button" onClick={() => { setRecoveryMethod('mobile'); setOtpSent(false); setRecoveryMessage(''); }} className={`py-2.5 rounded-xl font-black border ${recoveryMethod === 'mobile' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}>Mobile OTP</button>
              </div>
              {recoveryMethod === 'email' ? (
                <input value={recoveryEmail} onChange={e => { setRecoveryEmail(e.target.value); setRecoveryMessage(''); setOtpSent(false); }} placeholder="Registered email address" className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500 mb-3" />
              ) : (
                <input value={recoveryMobile} onChange={e => { setRecoveryMobile(e.target.value); setRecoveryMessage(''); setOtpSent(false); }} placeholder="Registered mobile number" className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500 mb-3" />
              )}
              {recoveryUser && recoveryMatch && <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 p-3 rounded-xl font-bold text-sm mb-3">Account found: {recoveryMatch.name}</div>}
              <button type="button" onClick={handleSendRecoveryOtp} className="w-full bg-indigo-50 text-indigo-700 py-3 rounded-xl font-black border border-indigo-100 mb-3">Send OTP</button>
              {otpSent && <>
                <input value={recoveryOtp} onChange={e => setRecoveryOtp(e.target.value)} placeholder="Enter OTP" className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500 mb-3" />
                <input type="password" value={recoveryNewPass} onChange={e => setRecoveryNewPass(e.target.value)} placeholder="New password" className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500 mb-3" />
                <input type="password" value={recoveryConfirmPass} onChange={e => setRecoveryConfirmPass(e.target.value)} placeholder="Confirm new password" className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500 mb-3" />
              </>}
              {recoveryMessage && <div className={`${recoveryMessage.includes('success') || recoveryMessage.includes('OTP sent') ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-600'} border p-4 rounded-xl font-bold text-sm mb-4`}>{recoveryMessage}</div>}
              <div className="grid grid-cols-2 gap-3 mt-5">
                <button type="button" onClick={() => setShowRecovery(false)} className="bg-slate-100 text-slate-700 py-3 rounded-xl font-black">Cancel</button>
                <button type="button" onClick={handlePasswordRecovery} className="bg-slate-800 text-white py-3 rounded-xl font-black">Reset Password</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


const TeamPerformanceView = ({ users, projects, onUpdateUser, currentUser, onOpenPerformance, onSelectProject }) => {
  const [selectedUser, setSelectedUser] = useState(null);
  const [newUser, setNewUser] = useState({ name: '', username: '', password: '', role: ROLES.DESIGNER });
  const [showAddForm, setShowAddForm] = useState(false);

  const isAdmin = currentUser.role === ROLES.ADMIN;

  const handleAddUser = (e) => {
    e.preventDefault();
    if (!newUser.name || !newUser.username || !newUser.password) return;
    const createdAt = Date.now();
    const createdBy = currentUser?.name || 'Admin';
    const u = createEmployeeLifecycleProfile({
      ...newUser,
      id: createdAt,
      status: 'APPROVED',
      createdBy,
      lifecycleEvents: [makeEmployeeLifecycleEvent('EMPLOYEE_CREATED', createdBy, { role: newUser.role })]
    });
    onUpdateUser(u);
    setNewUser({ name: '', username: '', password: '', role: ROLES.DESIGNER });
    setShowAddForm(false);
  };

  if (selectedUser) {
    const userProjects = projects.filter(p => p.assignedTo === selectedUser.name);
    const activeTasks = userProjects.filter(p => p.status !== 'Completed' && p.status !== 'Archived');
    const currentTask = activeTasks.find(p => ['Drafting', 'Internal Review', 'Assigned', 'Revision Pending', 'Revision In Progress'].includes(p.status)) || activeTasks[0];
    const online = isUserActuallyOnline(selectedUser);
    const liveStatus = selectedUser.availability === 'Break' ? 'On Break' : online ? (currentTask ? 'Working' : 'Available') : 'Offline';
    const statusClass = liveStatus === 'Working' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : liveStatus === 'Available' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : liveStatus === 'On Break' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-slate-100 text-slate-500 border-slate-200';

    return (
      <div className="space-y-6 animate-in slide-in-from-right-8 duration-300">
        <button onClick={() => setSelectedUser(null)} className="flex items-center text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-100 w-fit">
           <ArrowLeft className="w-4 h-4 mr-2" /> Back to Team
        </button>
        <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border-2 border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5 border-b-2 border-slate-100 pb-6 mb-6">
            <div className="flex items-center gap-4">
              <div className="bg-indigo-100 p-4 rounded-2xl text-indigo-600"><User className="w-8 h-8" /></div>
              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight">{selectedUser.name}</h2>
                <p className="font-bold text-slate-400 uppercase tracking-widest text-xs sm:text-sm mt-1">{selectedUser.role} • People profile</p>
              </div>
            </div>
            <span className={`${statusClass} border px-4 py-2 rounded-2xl text-sm font-black w-fit`}>{liveStatus}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <button type="button" disabled={!currentTask} onClick={() => currentTask && onSelectProject?.(currentTask)} className="bg-slate-50 border border-slate-100 rounded-2xl p-5 text-left hover:border-indigo-200 hover:bg-indigo-50/40 transition-all disabled:cursor-default disabled:hover:bg-slate-50 disabled:hover:border-slate-100">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">Current Task</p>
              <p className="font-black text-slate-800 mt-2">{currentTask ? (currentTask.id || currentTask.caseId || 'Assigned case') : 'No active task'}</p>
              <p className="text-xs font-bold text-slate-400 mt-1">{currentTask ? `${currentTask.client || currentTask.customerName || 'Case'} • ${currentTask.location || currentTask.city || 'Location'}` : 'Live status only'}</p>
              {currentTask && <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mt-3">Open case</p>}
            </button>
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">Open Work</p>
              <p className="font-black text-slate-800 mt-2">{activeTasks.length} active case{activeTasks.length === 1 ? '' : 's'}</p>
              <p className="text-xs font-bold text-slate-400 mt-1">People page avoids historical analytics.</p>
            </div>
            <div className="bg-emerald-50 border-2 border-emerald-100 rounded-2xl p-5">
              <p className="text-xs font-black uppercase tracking-widest text-emerald-500">Need history?</p>
              <button type="button" onClick={onOpenPerformance} className="font-black text-emerald-900 mt-2 text-left hover:underline">Open Performance Analytics</button>
              <p className="text-xs font-bold text-emerald-700 mt-1">Completed work, revisions, SLA and trends live there.</p>
            </div>
          </div>

          <h3 className="text-lg font-extrabold text-slate-800 mb-3 tracking-tight">Active Assignments</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeTasks.slice(0, 6).map(t => (
              <button type="button" key={t.id || t.caseId} onClick={() => onSelectProject?.(t)} className="border-2 border-slate-100 rounded-2xl p-4 bg-white text-left hover:border-indigo-200 hover:shadow-md hover:-translate-y-0.5 transition-all">
                <p className="font-black text-slate-800">{t.id || t.caseId}</p>
                <p className="text-xs font-bold text-slate-500 mt-1">{t.type || t.caseType || 'Case'} • {t.location || t.city || 'Location'}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mt-3">{t.status || 'Assigned'} • Open</p>
              </button>
            ))}
            {activeTasks.length === 0 && <div className="md:col-span-2 text-center bg-slate-50 border border-slate-100 rounded-2xl p-8 text-slate-400 font-bold">No active assignments.</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl p-8 shadow-sm border-2 border-slate-100 animate-in fade-in">
        <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight mb-4 flex items-center">
          <Users className="w-6 h-6 mr-3 text-indigo-500"/> Team Live Status
        </h2>
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 mb-5">
          <p className="text-sm font-semibold text-indigo-700">This page is now only for people management and live team status. Historical charts, rankings and trends are available only in Performance Analytics.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
              <tr>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Team Member</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-center">Availability</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Current Task</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-center">Active</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-center">Profile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.filter(u => (u.role === ROLES.DESIGNER || u.role === ROLES.MANAGER) && u.status === 'APPROVED').map(u => {
                 const userProjects = projects.filter(p => p.assignedTo === u.name);
                 const activeTasks = userProjects.filter(p => p.status !== 'Completed' && p.status !== 'Archived');
                 const currentTask = activeTasks.find(p => ['Drafting', 'Internal Review', 'Assigned', 'Revision Pending', 'Revision In Progress'].includes(p.status)) || activeTasks[0];
                 const completedToday = userProjects.filter(p => p.status === 'Completed' && formatDateKey(p.completedAt || p.updatedAt || p.createdAt) === formatDateKey()).length;
                 const online = isUserActuallyOnline(u);
                 const statusLabel = u.availability === 'Break' ? 'On Break' : online ? (currentTask ? 'Working' : 'Available') : 'Offline';
                 const statusClass = statusLabel === 'Working' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : statusLabel === 'Available' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : statusLabel === 'On Break' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-slate-100 text-slate-500 border-slate-200';
                 return (
                   <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4"><button type="button" onClick={() => setSelectedUser(u)} className="font-bold text-slate-800 hover:text-indigo-600 text-left">{u.name} <span className="text-xs text-slate-400 font-medium ml-2">({u.role})</span></button></td>
                      <td className="px-6 py-4 text-center"><span className={`px-3 py-1.5 rounded-lg border text-xs font-black ${statusClass}`}>{statusLabel}</span></td>
                      <td className="px-6 py-4">{currentTask ? <button type="button" onClick={() => onSelectProject?.(currentTask)} className="text-left group"><p className="font-black text-slate-700 group-hover:text-indigo-600">{currentTask?.id || '-'}</p><p className="text-xs font-bold text-slate-400">{currentTask ? `${currentTask.type || 'Task'} • ${currentTask.location || ''}` : 'No active task'}</p></button> : <><p className="font-black text-slate-700">-</p><p className="text-xs font-bold text-slate-400">No active task</p></>}</td>
                      <td className="px-6 py-4 text-center font-black text-slate-800">{activeTasks.length}</td>
                      <td className="px-6 py-4 text-center"><button type="button" onClick={() => setSelectedUser(u)} className="px-3 py-1.5 rounded-lg text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-100">Open</button></td>
                   </tr>
                 )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-3xl p-8 shadow-sm border-2 border-slate-100 animate-in fade-in">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">Team & Access Control</h2>
          {isAdmin && !showAddForm && (
             <button onClick={() => setShowAddForm(true)} className="bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center hover:bg-slate-700 transition-colors">
                <Plus className="w-4 h-4 mr-1.5"/> Add Employee
             </button>
          )}
        </div>

        {showAddForm && isAdmin && (
          <div className="bg-indigo-50 border border-indigo-100 p-5 rounded-2xl mb-8 animate-in slide-in-from-top-4">
             <div className="flex justify-between items-center mb-4">
                <h3 className="font-extrabold text-indigo-900">Create New Account</h3>
                <button onClick={() => setShowAddForm(false)} className="text-indigo-400 hover:text-indigo-600"><X className="w-5 h-5"/></button>
             </div>
             <form onSubmit={handleAddUser} className="grid grid-cols-1 sm:grid-cols-5 gap-4 items-end">
                <div><label className="text-xs font-bold text-indigo-600 uppercase mb-1 block">Full Name</label><input required value={newUser.name} onChange={e=>setNewUser({...newUser, name: e.target.value})} className="w-full border-2 border-white rounded-xl p-2.5 font-bold outline-none focus:border-indigo-400"/></div>
                <div><label className="text-xs font-bold text-indigo-600 uppercase mb-1 block">Username</label><input required value={newUser.username} onChange={e=>setNewUser({...newUser, username: e.target.value})} className="w-full border-2 border-white rounded-xl p-2.5 font-bold outline-none focus:border-indigo-400"/></div>
                <div><label className="text-xs font-bold text-indigo-600 uppercase mb-1 block">Password</label><input required value={newUser.password} onChange={e=>setNewUser({...newUser, password: e.target.value})} className="w-full border-2 border-white rounded-xl p-2.5 font-bold outline-none focus:border-indigo-400"/></div>
                <div>
                  <label className="text-xs font-bold text-indigo-600 uppercase mb-1 block">Role</label>
                  <select value={newUser.role} onChange={e=>setNewUser({...newUser, role: e.target.value})} className="w-full border-2 border-white rounded-xl p-2.5 font-bold outline-none focus:border-indigo-400 bg-white">
                     <option value={ROLES.DESIGNER}>Designer</option>
                     <option value={ROLES.MANAGER}>Manager</option>
                  </select>
                </div>
                <button type="submit" className="bg-indigo-600 text-white font-bold py-3 rounded-xl shadow-md hover:bg-indigo-700 transition-colors">Create</button>
                <p className="text-[10px] text-indigo-500 col-span-full mt-2">*Note: Admin promotion requires manual database approval for security.</p>
             </form>
          </div>
        )}

        <div className="space-y-4">
          {getManagedTeamUsers(users, { includeAdmins: true }).map(u => (
            <div key={u.id} className={`flex flex-col sm:flex-row sm:items-center justify-between p-5 rounded-2xl border gap-4 transition-all hover:border-indigo-200 hover:shadow-sm ${String(u.status || 'APPROVED').toUpperCase() === 'RESTRICTED' ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-100'}`}>
              <div className="flex-1">
                <p className="font-extrabold text-slate-800 text-lg flex items-center">
                   {u.name} 
                   {u.role === ROLES.ADMIN && <Shield className="w-4 h-4 ml-2 text-indigo-500" />}
                </p>
                <div className="flex items-center text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5 gap-4">
                   <span>ID: <span className="text-slate-600">{u.username}</span></span>
                   <span>Password: <span className="text-slate-600">••••</span></span>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-3 items-center">
                {isAdmin && u.role !== ROLES.ADMIN && (
                   <select value={u.role} onChange={(e) => onUpdateUser({...u, role: e.target.value})} className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 cursor-pointer outline-none focus:border-indigo-500">
                      <option value={ROLES.DESIGNER}>Designer</option>
                      <option value={ROLES.MANAGER}>Manager</option>
                   </select>
                )}
                <Badge colorClass={`py-1.5 px-4 mr-2 ${String(u.status || 'APPROVED').toUpperCase() === 'RESTRICTED' ? 'bg-red-100 text-red-700 border-red-200' : (u.role === ROLES.ADMIN ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200')}`}>{String(u.status || 'APPROVED').toUpperCase() === 'RESTRICTED' ? 'Restricted' : u.role}</Badge>
                
                {isAdmin && u.role !== ROLES.ADMIN && (
                   <button type="button" onClick={() => {
                      const nextPassword = window.prompt(`Reset password for ${u.name}`);
                      if (nextPassword && nextPassword.trim().length >= 3) onUpdateUser({ ...u, password: nextPassword.trim(), passwordUpdatedAt: Date.now(), passwordResetBy: currentUser.name });
                   }} className="px-4 py-2.5 bg-amber-50 text-amber-700 hover:bg-amber-100 text-sm font-bold rounded-xl transition-all shadow-sm flex items-center border border-amber-100">
                      Reset Password
                   </button>
                )}
                {isAdmin && u.role !== ROLES.ADMIN && (
                   <button type="button" onClick={() => onUpdateUser({ ...u, status: String(u.status || 'APPROVED').toUpperCase() === 'RESTRICTED' ? 'APPROVED' : 'RESTRICTED', restrictedAt: Date.now(), restrictedBy: currentUser.name })} className="px-4 py-2.5 bg-red-50 text-red-700 hover:bg-red-100 text-sm font-bold rounded-xl transition-all shadow-sm flex items-center border border-red-100">
                      {String(u.status || 'APPROVED').toUpperCase() === 'RESTRICTED' ? 'Allow Login' : 'Restrict Login'}
                   </button>
                )}
                {isAdmin && u.role !== ROLES.ADMIN && (
                   <button type="button" onClick={() => {
                      if (window.confirm(`Archive login for ${u.name}? They will be hidden from active operations but old reports and task history will remain.`)) onUpdateUser({ ...u, status: 'ARCHIVED', archivedAt: Date.now(), archivedBy: currentUser.name });
                   }} className="px-4 py-2.5 bg-slate-900 text-white hover:bg-slate-700 text-sm font-bold rounded-xl transition-all shadow-sm flex items-center">
                      Delete Login
                   </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const AttendanceView = ({ attendanceLogs = [], users = [], projects = [] }) => {
  const [filterDate, setFilterDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [monthKey, setMonthKey] = useState(new Date().toLocaleDateString('en-CA').slice(0, 7));
  const nowMs = Date.now();
  const teamMembers = getOperationalUsers(users && users.length ? users : INITIAL_USERS, { includeAdmins: false });
  const attendanceEngine = buildAttendanceEngineV3({ attendanceLogs, users: teamMembers, projects, dateKey: filterDate, now: nowMs });
  const attendanceRows = attendanceEngine.rows;
  const attendanceSummary = attendanceEngine.summary;
  const mostProductive = attendanceEngine.mostProductive;
  const safeLogs = Array.isArray(attendanceLogs) ? attendanceLogs : [];
  const daysInMonth = (() => {
    const [year, month] = monthKey.split('-').map(Number);
    const count = new Date(year, month, 0).getDate();
    return Array.from({ length: count }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, '0')}`);
  })();
  const monthlyRowFor = (user, date) => buildAttendanceEngineV3({ attendanceLogs: safeLogs, users: [user], projects, dateKey: date, now: nowMs }).rows[0] || null;
  const getMonthlyAttendanceCell = (user, date) => {
    const matchingLogs = safeLogs.filter(log => log && log.date === date && (String(log.userId || '') === String(user.id || '') || String(log.name || '').trim().toLowerCase() === String(user.name || '').trim().toLowerCase()));
    const logHasSession = matchingLogs.some(log => log.loginAt || log.firstLoginAt || log.loginTime || log.firstLogin || log.totalLoggedInMinutes || log.activeMinutes || log.productiveMinutes || log.lastTick || log.logoutAt);
    const engineRow = monthlyRowFor(user, date);
    const present = Boolean(logHasSession || engineRow?.session?.start || engineRow?.totalLoggedInMinutes > 0 || engineRow?.productiveMinutes > 0);
    const productive = Math.max(0, Math.floor(Number(engineRow?.productiveMinutes) || 0));
    const logged = Math.max(0, Math.floor(Number(engineRow?.totalLoggedInMinutes) || 0));
    const todayKey = new Date(nowMs).toLocaleDateString('en-CA');
    const isFuture = String(date) > String(todayKey);
    const isToday = String(date) === String(todayKey);
    return { present, productive, logged, isFuture, isToday, label: isFuture ? 'Upcoming' : present ? (productive ? formatMinutes(productive) : 'Present') : 'Absent' };
  };

  const statusStyle = (status) => {
    if (status === 'Working') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    if (status === 'Online / Idle') return 'bg-sky-50 text-sky-700 border-sky-100';
    if (status === 'On Break') return 'bg-amber-50 text-amber-700 border-amber-100';
    if (status === 'No Login') return 'bg-rose-50 text-rose-600 border-rose-100';
    return 'bg-slate-50 text-slate-600 border-slate-100';
  };
  const statusDot = (status) => {
    if (status === 'Working') return 'bg-emerald-500';
    if (status === 'Online / Idle') return 'bg-sky-500';
    if (status === 'On Break') return 'bg-amber-500';
    if (status === 'No Login') return 'bg-rose-400';
    return 'bg-slate-400';
  };

  const handleExport = () => {
    const headers = ["Name", "Role", "Date", "First Login", "Status", "Last Seen", "Logged-in Time", "Productive Time", "Idle Time", "Break Time", "Productivity %", "Alert", "Source"];
    const rows = attendanceRows.map(log => [
      log.name, log.role, log.date, log.loginTime, log.status, log.lastSeen, formatMinutes(log.totalLoggedInMinutes), formatMinutes(log.productiveMinutes), formatMinutes(log.idleMinutes), formatMinutes(log.breakMinutes), `${log.productivePct}%`, log.alert, log.source
    ]);
    exportToCSV(headers, rows, `Attendance_${filterDate}.csv`);
  };

  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col xl:flex-row justify-between xl:items-end gap-4">
        <div>
           <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight flex items-center"><Users className="w-8 h-8 mr-3 text-indigo-500"/> Team Attendance</h2>
           <p className="text-slate-500 mt-2 font-medium">Attendance Engine V3: one source for presence, logged-in, productive and break time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="border-2 border-slate-200 rounded-xl p-2.5 font-bold text-slate-700 outline-none" />
          <input type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} className="border-2 border-slate-200 rounded-xl p-2.5 font-bold text-slate-700 outline-none" />
          <button onClick={handleExport} className="flex items-center px-4 py-2.5 bg-emerald-100 text-emerald-700 font-bold rounded-xl hover:bg-emerald-200 transition-colors"><Download className="w-4 h-4 mr-2" /> Export</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-white rounded-3xl border border-slate-100 p-4 shadow-sm"><p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Present Today</p><p className="text-2xl font-black text-slate-800 mt-1">{attendanceSummary.present}/{attendanceRows.length}</p><p className="text-[11px] font-bold text-slate-400 mt-1">Non-admin team</p></div>
        <div className="bg-white rounded-3xl border border-emerald-100 p-4 shadow-sm"><p className="text-[11px] font-black text-emerald-500 uppercase tracking-widest">Working Now</p><p className="text-2xl font-black text-emerald-700 mt-1">{attendanceSummary.working}</p><p className="text-[11px] font-bold text-slate-400 mt-1">{attendanceSummary.online} online, {attendanceSummary.onBreak} break</p></div>
        <div className="bg-white rounded-3xl border border-indigo-100 p-4 shadow-sm"><p className="text-[11px] font-black text-indigo-500 uppercase tracking-widest">Productive Time</p><p className="text-2xl font-black text-indigo-700 mt-1">{formatMinutes(attendanceSummary.totalActive)}</p><p className="text-[11px] font-bold text-slate-400 mt-1">Single V3 total</p></div>
        <div className="bg-white rounded-3xl border border-slate-100 p-4 shadow-sm"><p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Logged-in Time</p><p className="text-2xl font-black text-slate-800 mt-1">{formatMinutes(attendanceSummary.totalLogged)}</p><p className="text-[11px] font-bold text-slate-400 mt-1">Login to logout/live</p></div>
        <div className="bg-white rounded-3xl border border-amber-100 p-4 shadow-sm"><p className="text-[11px] font-black text-amber-500 uppercase tracking-widest">Break Time</p><p className="text-2xl font-black text-amber-700 mt-1">{formatMinutes(attendanceSummary.totalBreak)}</p><p className="text-[11px] font-bold text-slate-400 mt-1">Approved pauses</p></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div><h3 className="font-black text-slate-800 text-lg">Live Team Status</h3><p className="text-xs font-semibold text-slate-400">All numbers below come from Attendance Engine V3.</p></div>
            <span className="text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-100 px-3 py-1.5 rounded-xl">{filterDate}</span>
          </div>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="text-slate-400 border-b border-slate-100"><tr><th className="px-3 py-3 font-black uppercase tracking-wider text-xs">Member</th><th className="px-3 py-3 font-black uppercase tracking-wider text-xs">Status</th><th className="px-3 py-3 font-black uppercase tracking-wider text-xs">Timeline</th><th className="px-3 py-3 font-black uppercase tracking-wider text-xs text-right">Logged</th><th className="px-3 py-3 font-black uppercase tracking-wider text-xs text-right">Productive</th><th className="px-3 py-3 font-black uppercase tracking-wider text-xs text-right">Break</th><th className="px-3 py-3 font-black uppercase tracking-wider text-xs">Break Record</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {attendanceRows.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-3 py-4"><p className="font-black text-slate-800 text-base">{log.name}</p><p className="text-xs font-semibold text-slate-400 mt-0.5">{log.role}{(log.activeTasks || [])[0]?.caseId ? ` • ${(log.activeTasks || [])[0].caseId}` : ''}</p></td>
                    <td className="px-3 py-4"><span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-black ${statusStyle(log.status)}`}><span className={`w-2 h-2 rounded-full ${statusDot(log.status)}`}></span>{log.status}</span><p className={`text-[11px] font-bold mt-2 ${log.alert === 'Stable' ? 'text-slate-400' : 'text-amber-600'}`}>{log.alert}</p></td>
                    <td className="px-3 py-4"><p className="font-black text-slate-700">{log.loginTime || '-'} <span className="text-slate-300">→</span> {log.onlineNow ? 'Live' : log.lastSeen}</p><div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{width: `${log.productivePct}%`}}></div></div><p className="text-[10px] font-bold text-slate-400 mt-1">Productivity {log.productivePct}%</p></td>
                    <td className="px-3 py-4 text-right"><span className="bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg font-black">{formatMinutes(log.totalLoggedInMinutes)}</span></td>
                    <td className="px-3 py-4 text-right"><span className="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg font-black">{formatMinutes(log.productiveMinutes)}</span></td>
                    <td className="px-3 py-4 text-right"><span className="bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg font-black">{formatMinutes(log.breakMinutes)}</span>{log.breakEvents.length > 0 && <p className="text-[10px] text-slate-400 font-bold mt-1">{log.breakEvents.length} break{log.breakEvents.length > 1 ? 's' : ''}</p>}</td>
                    <td className="px-3 py-4 min-w-[180px]">
                      {log.breakEvents.length > 0 ? (
                        <div className="space-y-1">
                          {log.breakEvents.slice(0, 2).map(ev => (
                            <div key={ev.id || ev.start} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[11px] font-bold ${ev.open ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-slate-50 text-slate-500'}`}>
                              <span>{ev.open ? 'Live break' : 'Break'}</span>
                              <span>{ev.label} • {formatMinutes(ev.minutes)}</span>
                            </div>
                          ))}
                          {log.breakEvents.length > 2 && <p className="text-[10px] font-bold text-slate-400">+{log.breakEvents.length - 2} more break record{log.breakEvents.length - 2 > 1 ? 's' : ''}</p>}
                        </div>
                      ) : <span className="text-xs font-bold text-slate-300">No break taken</span>}
                    </td>
                  </tr>
                ))}
                {attendanceRows.length === 0 && (<tr><td colSpan={7} className="px-6 py-16 text-center text-slate-400 font-bold">No approved non-admin team members found.</td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="sm:hidden space-y-3">
            {attendanceRows.map(log => (<div key={log.id} className="rounded-2xl border border-slate-100 p-4 shadow-sm bg-white"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-800">{log.name}</p><p className="text-xs font-bold text-slate-400">{log.role}</p></div><span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-black ${statusStyle(log.status)}`}><span className={`w-2 h-2 rounded-full ${statusDot(log.status)}`}></span>{log.status}</span></div><p className="mt-3 text-sm font-black text-slate-700">{log.loginTime || '-'} <span className="text-slate-300">→</span> {log.onlineNow ? 'Live' : log.lastSeen}</p><div className="grid grid-cols-3 gap-2 mt-3 text-center"><div className="bg-slate-50 rounded-xl p-2"><p className="text-[10px] font-black text-slate-400 uppercase">Logged</p><p className="font-black text-slate-700">{formatMinutes(log.totalLoggedInMinutes)}</p></div><div className="bg-indigo-50 rounded-xl p-2"><p className="text-[10px] font-black text-indigo-400 uppercase">Productive</p><p className="font-black text-indigo-700">{formatMinutes(log.productiveMinutes)}</p></div><div className="bg-amber-50 rounded-xl p-2"><p className="text-[10px] font-black text-amber-400 uppercase">Break</p><p className="font-black text-amber-700">{formatMinutes(log.breakMinutes)}</p></div></div>{log.breakEvents.length > 0 && <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 p-2 text-[11px] font-bold text-amber-700">{log.breakEvents[0].open ? 'Live break' : 'Last break'}: {log.breakEvents[0].label} • {formatMinutes(log.breakEvents[0].minutes)}</div>}<p className="text-[11px] font-bold text-slate-400 mt-3">{log.alert}</p></div>))}
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
          <h3 className="font-black text-slate-800 text-lg">Today's Insight</h3>
          <p className="text-xs font-semibold text-slate-400 mb-4">Same V3 rows, no separate calculation.</p>
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 mb-4">
            <p className="text-[11px] font-black text-emerald-600 uppercase tracking-widest">Most Productive</p>
            <p className="text-xl font-black text-slate-800 mt-2">{mostProductive?.name || '-'}</p>
            <p className="text-sm font-black text-emerald-700 mt-2">{formatMinutes(mostProductive?.productiveMinutes || 0)}</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-4">
            <p className="text-[11px] font-black text-amber-600 uppercase tracking-widest">Break Visibility</p>
            <p className="text-sm font-black text-slate-800 mt-2">{attendanceSummary.onBreak > 0 ? `${attendanceSummary.onBreak} team member${attendanceSummary.onBreak > 1 ? 's' : ''} on break now` : 'No one is on break now'}</p>
            <p className="text-xs font-bold text-amber-700 mt-1">Total today: {formatMinutes(attendanceSummary.totalBreak)}</p>
          </div>
          <div className="bg-slate-50 rounded-2xl p-4 text-sm text-slate-600 font-semibold space-y-3">
            <p><span className="text-slate-800 font-black">Logged-in:</span> total time from first login to logout/live.</p>
            <p><span className="text-slate-800 font-black">Productive:</span> V3 stable daily productive counter, capped by logged-in time.</p>
            <p><span className="text-slate-800 font-black">Break:</span> approved break duration only.</p>
            <p><span className="text-slate-800 font-black">Engine:</span> {attendanceEngine.source}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4"><div><h3 className="font-black text-slate-800 text-lg">Monthly Attendance Sheet</h3><p className="text-xs font-semibold text-slate-400">Green = present, red = past absent/no login record, grey = upcoming future date.</p></div><span className="text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-100 px-3 py-1.5 rounded-xl">{monthKey}</span></div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-4 font-black uppercase sticky left-0 bg-white z-10">Team Member</th>
                {daysInMonth.map(day => <th key={day} className="py-2 px-2 font-black text-center">{day.slice(-2)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teamMembers.map(user => (
                <tr key={user.id}>
                  <td className="py-3 pr-4 font-black text-slate-700 sticky left-0 bg-white z-10">{user.name}</td>
                  {daysInMonth.map(day => {
                    const cell = getMonthlyAttendanceCell(user, day);
                    return (
                      <td key={day} className="py-3 px-2 text-center">
                        <span title={`${user.name} • ${day} • ${cell.label}`} className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[10px] font-black border ${cell.isFuture ? 'bg-slate-50 text-slate-300 border-slate-100' : cell.isToday ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : cell.present ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-400 border-rose-100'}`}>
                          {cell.isFuture ? '—' : cell.isToday && !cell.present ? '•' : cell.present ? (cell.productive ? 'P' : '✓') : 'A'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const LedgerView = ({ projects, onSelectProject }) => {
  const [activeTab, setActiveTab] = useState('transactions');
  const [selectedLocation, setSelectedLocation] = useState('All');
  const [selectedClient, setSelectedClient] = useState('All');
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState('All');
  
  const financePaymentStatuses = ['All', 'Not Updated', 'Pending', 'Partially Paid', 'Paid', 'Overpaid'];
  const deriveLedgerPaymentStatus = (project = {}) => {
    const estimate = getPaymentEstimateAmount(project);
    const received = getPaymentReceivedAmount(project);
    const rawStatus = String(project.paymentTrackingStatus || project.paymentStatus || project.paymentReceived || project.ledger?.status || project.ledger?.paymentStatus || '').toUpperCase();
    const hasFinanceData = Boolean(
      estimate > 0 || received > 0 || project.ledger?.updatedAt || project.ledger?.date || project.paymentTrackingUpdatedAt ||
      project.paymentDate || project.paymentTime || project.ledger?.receivedFrom || project.ledger?.txnId || project.ledger?.mode
    );

    // Never show Paid/Cleared when no money has actually been received.
    if (received > 0 && estimate > 0 && received > estimate) return 'Overpaid';
    if (received > 0 && estimate > 0 && received === estimate) return 'Paid';
    if (received > 0 && estimate > 0 && received < estimate) return 'Partially Paid';
    if (received > 0 && estimate <= 0) return 'Paid';
    if (estimate > 0 || rawStatus.includes('PENDING') || rawStatus === 'PARTIAL' || hasFinanceData) return 'Pending';
    return 'Not Updated';
  };
  const getLedgerPaymentBadgeClass = (status = 'Not Updated') => {
    switch (status) {
      case 'Paid': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'Overpaid': return 'bg-violet-50 text-violet-700 border-violet-100';
      case 'Partially Paid': return 'bg-blue-50 text-blue-700 border-blue-100';
      case 'Pending': return 'bg-amber-50 text-amber-700 border-amber-100';
      default: return 'bg-rose-50 text-rose-700 border-rose-100';
    }
  };
  
  const baseLedgerProjects = projects.filter(p => !isRevisionWorkItem(p) && !p.excludeFromLedger && !p.isFinanceExcluded && ((Number(p.estimate) > 0) || (Number(p.ledger?.amountIn) > 0) || p.ledger?.updatedAt || p.paymentTrackingUpdatedAt));
  const allLocations = [...new Set(baseLedgerProjects.map(p => getCanonicalLocationName(p.location)).filter(Boolean))].sort();
  const availableClients = [...new Set(baseLedgerProjects.filter(p => selectedLocation === 'All' || getCanonicalLocationName(p.location) === selectedLocation).map(p => getCanonicalBankName(p.client || p.bankName || p.bank)).filter(Boolean))].sort();

  useEffect(() => {
    if (selectedClient !== 'All' && !availableClients.includes(selectedClient)) setSelectedClient('All');
  }, [selectedLocation, availableClients, selectedClient]);

  const ledgerProjects = baseLedgerProjects.filter(p => {
      if (selectedLocation !== 'All' && getCanonicalLocationName(p.location) !== selectedLocation) return false;
      if (selectedClient !== 'All' && getCanonicalBankName(p.client || p.bankName || p.bank) !== selectedClient) return false;
      if (selectedPaymentStatus !== 'All' && deriveLedgerPaymentStatus(p) !== selectedPaymentStatus) return false;
      return true;
  }).sort((a,b) => ((b.ledger?.updatedAt || b.completedAt || b.createdAt) || 0) - ((a.ledger?.updatedAt || a.completedAt || a.createdAt) || 0));

  const statusCounts = baseLedgerProjects.reduce((acc, p) => {
    const status = deriveLedgerPaymentStatus(p);
    acc[status] = (acc[status] || 0) + 1;
    acc.All += 1;
    return acc;
  }, { All: 0, 'Not Updated': 0, Pending: 0, 'Partially Paid': 0, Paid: 0, Overpaid: 0 });

  const totalCost = ledgerProjects.reduce((sum, p) => sum + getPaymentEstimateAmount(p), 0);
  const totalReceived = ledgerProjects.reduce((sum, p) => sum + getPaymentReceivedAmount(p), 0);
  const totalExpenses = ledgerProjects.reduce((sum, p) => sum + (Number(p.ledger?.expenses) || 0), 0);
  const totalRefund = ledgerProjects.reduce((sum, p) => sum + (Number(p.ledger?.refund) || 0), 0);
  const netRevenue = totalReceived - totalExpenses - totalRefund;
  const totalPending = ledgerProjects.reduce((sum, p) => sum + Math.max(0, getPaymentEstimateAmount(p) - getPaymentReceivedAmount(p)), 0);

  const paymentAuditEvents = ledgerProjects.flatMap(p => {
    const explicitAudit = Array.isArray(p.paymentAuditTrail) ? p.paymentAuditTrail : [];
    const ledgerAudit = Array.isArray(p.ledger?.auditTrail) ? p.ledger.auditTrail : [];
    const historyAudit = (Array.isArray(p.history) ? p.history : [])
      .filter(h => /payment|ledger|paid|pending|refund|received/i.test(String(h.action || h.text || '')))
      .map(h => ({
        id: h.id || `${p.id}-${h.at || h.time || Math.random()}`,
        at: h.at || h.time || p.ledger?.updatedAt || p.paymentTrackingUpdatedAt || p.updatedAt,
        by: h.by || h.user || h.updatedBy || p.paymentTrackingUpdatedBy || p.ledger?.updatedBy || 'Admin',
        action: h.action || h.text || 'Payment activity',
        note: h.note || '',
      }));
    const synthesized = (p.ledger?.updatedAt || p.paymentTrackingUpdatedAt) ? [{
      id: `${p.id}-current-payment-state`,
      at: p.ledger?.updatedAt || p.paymentTrackingUpdatedAt,
      by: p.paymentTrackingUpdatedBy || p.ledger?.updatedBy || 'Admin',
      action: 'Current payment state',
      oldStatus: '',
      newStatus: deriveLedgerPaymentStatus(p),
      oldAmount: '',
      newAmount: Number(p.ledger?.amountIn) || 0,
      note: 'Latest saved payment/ledger state for this task'
    }] : [];
    return [...explicitAudit, ...ledgerAudit, ...historyAudit, ...synthesized].map(event => ({
      ...event,
      taskId: p.id,
      customerName: getCustomerDisplayName(p),
      bank: p.client || '',
      status: event.newStatus || deriveLedgerPaymentStatus(p),
      amount: event.newAmount ?? event.amount ?? Number(p.ledger?.amountIn || 0),
    }));
  }).sort((a, b) => (new Date(b.at || 0).getTime() || 0) - (new Date(a.at || 0).getTime() || 0));

  const monthlyStats = {};
  const clientStats = {};
  const customerStats = {};

  ledgerProjects.forEach(p => {
    const dateStr = p.ledger?.date ? p.ledger.date : (p.completedAt || p.createdAt);
    let monthKey = 'Unknown';
    if (dateStr) {
        try { monthKey = new Date(dateStr).toLocaleString('default', { month: 'long', year: 'numeric' }); } catch(e){}
    }
    
    const clientKey = p.client || 'Unknown Client';
    const custKey = p.customerName ? `${p.customerName} (${p.client})` : p.client;

    const est = Number(p.estimate) || 0;
    const rec = Number(p.ledger?.amountIn) || 0;
    const exp = Number(p.ledger?.expenses) || 0;
    const ref = Number(p.ledger?.refund) || 0;
    const pen = est - rec;

    if (!monthlyStats[monthKey]) monthlyStats[monthKey] = { revenue: 0, cost: 0, expense: 0, refund: 0, count: 0 };
    monthlyStats[monthKey].revenue += rec; monthlyStats[monthKey].cost += est; monthlyStats[monthKey].expense += exp; monthlyStats[monthKey].refund += ref; monthlyStats[monthKey].count += 1;

    if (!clientStats[clientKey]) clientStats[clientKey] = { revenue: 0, cost: 0, expense: 0, refund: 0, count: 0 };
    clientStats[clientKey].revenue += rec; clientStats[clientKey].cost += est; clientStats[clientKey].expense += exp; clientStats[clientKey].refund += ref; clientStats[clientKey].count += 1;

    if (!customerStats[custKey]) customerStats[custKey] = { revenue: 0, cost: 0, pending: 0, count: 0 };
    customerStats[custKey].revenue += rec; customerStats[custKey].cost += est; customerStats[custKey].count += 1; customerStats[custKey].pending += pen;
  });

  const handleExport = () => {
    const headers = ["Task ID", "Created Date", "Client", "Customer", "Location", "Payment Status", "Cost (Est)", "Received", "Actual Expenses", "Refund", "Pending"];
    const rows = ledgerProjects.map(p => [
      p.id, p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '-',
      p.client, p.customerName || '', p.location || '', deriveLedgerPaymentStatus(p), getPaymentEstimateAmount(p), getPaymentReceivedAmount(p), Number(p.ledger?.expenses)||0, Number(p.ledger?.refund)||0, Math.max(0, getPaymentEstimateAmount(p) - getPaymentReceivedAmount(p))
    ]);
    exportToCSV(headers, rows, "Financial_Ledger.csv");
  };

  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col xl:flex-row justify-between xl:items-end gap-4">
        <div>
           <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">Financial Ledger</h2>
           <div className="flex flex-wrap gap-3 mt-4">
              <div className="flex flex-col">
                  <label className="text-[10px] font-black uppercase text-slate-400 mb-1 tracking-widest">Filter by Area/City</label>
                  <div className="relative">
                      <MapPin className="w-4 h-4 text-indigo-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <select value={selectedLocation} onChange={e => setSelectedLocation(e.target.value)} className="pl-9 pr-8 py-2.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:border-indigo-500 appearance-none shadow-sm cursor-pointer min-w-[160px]">
                          <option value="All">All Areas</option>
                          {allLocations.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                  </div>
              </div>
              <div className="flex flex-col">
                  <label className="text-[10px] font-black uppercase text-slate-400 mb-1 tracking-widest">Filter by Bank</label>
                  <div className="relative">
                      <Briefcase className="w-4 h-4 text-indigo-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <select value={selectedClient} onChange={e => setSelectedClient(e.target.value)} className="pl-9 pr-8 py-2.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:border-indigo-500 appearance-none shadow-sm cursor-pointer min-w-[160px]">
                          <option value="All">All Banks in Area</option>
                          {availableClients.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                  </div>
              </div>
              <div className="flex flex-col">
                  <label className="text-[10px] font-black uppercase text-slate-400 mb-1 tracking-widest">Payment Status</label>
                  <div className="relative">
                      <Filter className="w-4 h-4 text-indigo-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <select value={selectedPaymentStatus} onChange={e => setSelectedPaymentStatus(e.target.value)} className="pl-9 pr-8 py-2.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:border-indigo-500 appearance-none shadow-sm cursor-pointer min-w-[190px]">
                          {financePaymentStatuses.map(status => <option key={status} value={status}>{status} ({statusCounts[status] || 0})</option>)}
                      </select>
                  </div>
              </div>
           </div>
        </div>
        <div className="flex flex-wrap gap-3 mt-4 xl:mt-0">
          <div className="flex flex-wrap bg-slate-100 p-1.5 rounded-xl border border-slate-200">
            <button type="button" onClick={() => setActiveTab('transactions')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center ${activeTab === 'transactions' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><FileText className="w-4 h-4 mr-1.5" /> All Logs</button>
            <button type="button" onClick={() => setActiveTab('pending')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center ${activeTab === 'pending' ? 'bg-red-50 text-red-600 shadow-sm border border-red-100' : 'text-slate-500 hover:text-slate-700'}`}><Clock className="w-4 h-4 mr-1.5" /> Pending</button>
            <button type="button" onClick={() => setActiveTab('monthly')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center ${activeTab === 'monthly' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><List className="w-4 h-4 mr-1.5" /> Monthly</button>
            <button type="button" onClick={() => setActiveTab('clients')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center ${activeTab === 'clients' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Briefcase className="w-4 h-4 mr-1.5" /> Banks</button>
            <button type="button" onClick={() => setActiveTab('customers')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center ${activeTab === 'customers' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><User className="w-4 h-4 mr-1.5" /> Customers</button>
            <button type="button" onClick={() => setActiveTab('report')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center ${activeTab === 'report' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><BarChart3 className="w-4 h-4 mr-1.5" /> Report</button>
            <button type="button" onClick={() => setActiveTab('audit')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center ${activeTab === 'audit' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Shield className="w-4 h-4 mr-1.5" /> Audit</button>
          </div>
          <button onClick={handleExport} className="flex items-center px-4 py-2.5 bg-emerald-100 text-emerald-700 font-bold rounded-xl hover:bg-emerald-200 transition-colors"><Download className="w-4 h-4 mr-2" /> Export</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-5">
        <div className="bg-emerald-50 p-6 rounded-3xl border-2 border-emerald-100 shadow-sm">
          <p className="text-xs text-emerald-600 font-extrabold uppercase tracking-widest">Gross Received</p>
          <p className="text-3xl font-black text-emerald-700 mt-2">₹{totalReceived.toLocaleString()}</p>
        </div>
        <div className="bg-amber-50 p-6 rounded-3xl border-2 border-amber-100 shadow-sm">
          <p className="text-xs text-amber-600 font-extrabold uppercase tracking-widest">Actual Expenses</p>
          <p className="text-3xl font-black text-amber-700 mt-2">₹{totalExpenses.toLocaleString()}</p>
        </div>
        <div className="bg-red-50 p-6 rounded-3xl border-2 border-red-100 shadow-sm">
          <p className="text-xs text-red-600 font-extrabold uppercase tracking-widest">Total Refunds</p>
          <p className="text-3xl font-black text-red-700 mt-2">₹{totalRefund.toLocaleString()}</p>
        </div>
        <button type="button" onClick={() => setActiveTab('pending')} className="text-left bg-orange-50 p-6 rounded-3xl border-2 border-orange-100 shadow-sm hover:bg-orange-100 transition-colors">
          <p className="text-xs text-orange-600 font-extrabold uppercase tracking-widest">Pending Payments</p>
          <p className="text-3xl font-black text-orange-700 mt-2">₹{totalPending.toLocaleString()}</p>
          <p className="text-[11px] font-bold text-orange-500 mt-2">Click to open pending payments</p>
        </button>
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-3xl shadow-lg text-white relative overflow-hidden">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
          <p className="text-xs text-indigo-300 font-extrabold uppercase tracking-widest">True Net Profit</p>
          <p className="text-3xl font-black text-white mt-2">₹{netRevenue.toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          {activeTab === 'pending' && (
            <div className="p-5 bg-red-50 border-b border-red-100">
              <h3 className="text-lg font-black text-red-700">Pending Payments</h3>
              <p className="text-sm font-bold text-red-500">Only tasks with outstanding balance are shown here.</p>
            </div>
          )}
          {(activeTab === 'transactions' || activeTab === 'pending') && (
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
                <tr>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Payment Date & Time</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Task ID & Client</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-center">Status</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Cost (Est)</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Received</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Expenses</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Pending</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-center">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledgerProjects.filter(p => activeTab === 'pending' ? ((Number(p.estimate) || 0) > (Number(p.ledger?.amountIn) || 0)) : true).map(p => {
                  const est = getPaymentEstimateAmount(p);
                  const rec = getPaymentReceivedAmount(p);
                  const exp = Number(p.ledger?.expenses) || 0;
                  const status = deriveLedgerPaymentStatus(p);
                  const pen = Math.max(0, est - rec);
                  const updateDate = p.ledger?.updatedAt ? new Date(p.ledger.updatedAt) : null;
                  
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-5">
                        <p className="font-bold text-slate-800">{updateDate ? formatDateTime(updateDate) : (p.ledger?.date ? formatDateTime(p.ledger.date) : '-')}</p>
                        <p className="text-xs font-semibold text-slate-400 mt-0.5">{updateDate ? updateDate.toLocaleTimeString() : 'Manual Entry'}</p>
                      </td>
                      <td className="px-6 py-5 cursor-pointer group" onClick={() => onSelectProject(p)}>
                        <div className="flex items-center">
                           <p className="font-bold text-slate-700 group-hover:text-indigo-600 transition-colors">{getDisplayTaskId(p)}</p>
                           <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded ml-2 font-semibold">Created: {p.createdAt ? formatDateTime(p.createdAt) : '-'}</span>
                        </div>
                        <p className="font-medium text-slate-500 text-xs mt-0.5">{getCustomerDisplayName(p)}</p>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full border text-[11px] font-black ${getLedgerPaymentBadgeClass(deriveLedgerPaymentStatus(p))}`}>{deriveLedgerPaymentStatus(p)}</span>
                      </td>
                      <td className="px-6 py-5 text-right font-bold text-slate-600">₹{est.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-bold text-emerald-600">₹{rec.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-bold text-amber-600">₹{exp.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-black text-slate-800">
                        {status === 'Paid' || status === 'Overpaid' ? <span className="text-slate-400"><CheckCircle className="w-4 h-4 inline text-emerald-500"/> Cleared</span> : pen > 0 ? <span className="text-red-500 bg-red-50 px-2 py-1 rounded-lg border border-red-100">₹{pen.toLocaleString()}</span> : <span className="text-slate-400">Not Updated</span>}
                      </td>
                      <td className="px-6 py-5 text-center">
                         {p.ledger?.screenshot ? (
                            <a href={p.ledger.screenshot} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center px-3 py-1.5 bg-indigo-50 text-indigo-700 font-bold text-xs rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-100"><ImageIcon className="w-3 h-3 mr-1.5"/> View</a>
                         ) : (
                            <span className="text-xs font-medium text-slate-400 italic">No receipt</span>
                         )}
                      </td>
                    </tr>
                  )
                })}
                {ledgerProjects.filter(p => activeTab === 'pending' ? ((Number(p.estimate) || 0) > (Number(p.ledger?.amountIn) || 0)) : true).length === 0 && (
                   <tr><td colSpan="8" className="text-center py-10 text-slate-500 font-medium">No records found for this view.</td></tr>
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'monthly' && (
             <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
                <tr>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Month / Year</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-center">Tasks</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Received</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Expenses</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Refunds</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right text-indigo-600">Net Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.keys(monthlyStats).map(month => {
                  const data = monthlyStats[month];
                  const net = data.revenue - data.expense - data.refund;
                  return (
                    <tr key={month} className="hover:bg-slate-50">
                      <td className="px-6 py-5 font-bold text-slate-800">{month}</td>
                      <td className="px-6 py-5 text-center">
                        <span className="bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-black">{data.count}</span>
                      </td>
                      <td className="px-6 py-5 text-right font-bold text-emerald-600">₹{data.revenue.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-bold text-amber-600">₹{data.expense.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-bold text-red-500">₹{data.refund.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-black text-indigo-700">₹{net.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {activeTab === 'clients' && (
             <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
                <tr>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Bank</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-center">Tasks</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Received</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Expenses</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Refunds</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right text-indigo-600">Net Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.keys(clientStats).sort((a,b) => clientStats[b].revenue - clientStats[a].revenue).map(client => {
                  const data = clientStats[client];
                  const net = data.revenue - data.expense - data.refund;
                  return (
                    <tr key={client} className="hover:bg-slate-50">
                      <td className="px-6 py-5 font-bold text-slate-800">{client}</td>
                      <td className="px-6 py-5 text-center">
                        <span className="bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-black">{data.count}</span>
                      </td>
                      <td className="px-6 py-5 text-right font-bold text-emerald-600">₹{data.revenue.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-bold text-amber-600">₹{data.expense.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-bold text-red-500">₹{data.refund.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-black text-indigo-700">₹{net.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {activeTab === 'customers' && (
             <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
                <tr>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Customer Name</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-center">Tasks</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Cost (Est)</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Received</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right text-red-600">Total Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.keys(customerStats).sort((a,b) => customerStats[b].pending - customerStats[a].pending).map(cust => {
                  const data = customerStats[cust];
                  return (
                    <tr key={cust} className="hover:bg-slate-50">
                      <td className="px-6 py-5 font-bold text-slate-800">{cust}</td>
                      <td className="px-6 py-5 text-center">
                        <span className="bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-black">{data.count}</span>
                      </td>
                      <td className="px-6 py-5 text-right font-bold text-slate-600">₹{data.cost.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-bold text-emerald-600">₹{data.revenue.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-black text-red-600">
                        {data.pending > 0 ? `₹${data.pending.toLocaleString()}` : <span className="text-slate-400">₹0</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}


          {activeTab === 'report' && (
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Filtered Records</p>
                  <p className="text-2xl font-black text-slate-800">{ledgerProjects.length}</p>
                </div>
                <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Filtered Received</p>
                  <p className="text-2xl font-black text-emerald-700">₹{totalReceived.toLocaleString()}</p>
                </div>
                <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">Filtered Pending</p>
                  <p className="text-2xl font-black text-orange-700">₹{totalPending.toLocaleString()}</p>
                </div>
                <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Filtered Net</p>
                  <p className="text-2xl font-black text-indigo-700">₹{netRevenue.toLocaleString()}</p>
                </div>
              </div>
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
                  <tr>
                    <th className="px-4 py-4 font-bold uppercase tracking-wider text-xs">Task ID</th>
                    <th className="px-4 py-4 font-bold uppercase tracking-wider text-xs">Bank / Customer</th>
                    <th className="px-4 py-4 font-bold uppercase tracking-wider text-xs text-center">Payment Status</th>
                    <th className="px-4 py-4 font-bold uppercase tracking-wider text-xs text-right">Estimate</th>
                    <th className="px-4 py-4 font-bold uppercase tracking-wider text-xs text-right">Received</th>
                    <th className="px-4 py-4 font-bold uppercase tracking-wider text-xs text-right">Pending</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ledgerProjects.map(p => {
                    const est = Number(p.estimate) || 0;
                    const rec = Number(p.ledger?.amountIn) || 0;
                    const status = deriveLedgerPaymentStatus(p);
                    return (
                      <tr key={`report-${p.id}`} className="hover:bg-slate-50">
                        <td className="px-4 py-4 font-black text-slate-800">{p.id}</td>
                        <td className="px-4 py-4">
                          <p className="font-bold text-slate-700">{p.client || '-'}</p>
                          <p className="text-xs text-slate-500 font-semibold">{getCustomerDisplayName(p)}</p>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className={`inline-flex px-2.5 py-1 rounded-full border text-[11px] font-black ${getLedgerPaymentBadgeClass(status)}`}>{status}</span>
                        </td>
                        <td className="px-4 py-4 text-right font-bold text-slate-600">₹{est.toLocaleString()}</td>
                        <td className="px-4 py-4 text-right font-bold text-emerald-600">₹{rec.toLocaleString()}</td>
                        <td className="px-4 py-4 text-right font-black text-red-600">₹{Math.max(0, est - rec).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                  {ledgerProjects.length === 0 && <tr><td colSpan="6" className="text-center py-10 text-slate-500 font-medium">No report records found for the selected finance filters.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="p-5 space-y-5">
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                <h3 className="text-lg font-black text-indigo-800">Payment Audit Trail</h3>
                <p className="text-sm font-bold text-indigo-500 mt-1">Admin-only history of payment and ledger changes. Archive and Operations logic is not affected by this view.</p>
              </div>
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
                  <tr>
                    <th className="px-4 py-4 font-bold uppercase tracking-wider text-xs">Date & Time</th>
                    <th className="px-4 py-4 font-bold uppercase tracking-wider text-xs">Task</th>
                    <th className="px-4 py-4 font-bold uppercase tracking-wider text-xs">Changed By</th>
                    <th className="px-4 py-4 font-bold uppercase tracking-wider text-xs">Change</th>
                    <th className="px-4 py-4 font-bold uppercase tracking-wider text-xs text-right">Amount</th>
                    <th className="px-4 py-4 font-bold uppercase tracking-wider text-xs">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paymentAuditEvents.map(event => (
                    <tr key={`${event.taskId}-${event.id || event.at}`} className="hover:bg-slate-50">
                      <td className="px-4 py-4 font-bold text-slate-700">{event.at ? formatDateTime(event.at) : '-'}</td>
                      <td className="px-4 py-4">
                        <p className="font-black text-slate-800">{event.taskId}</p>
                        <p className="text-xs text-slate-500 font-semibold">{event.customerName}{event.bank ? ` • ${event.bank}` : ''}</p>
                      </td>
                      <td className="px-4 py-4 font-bold text-slate-600">{event.by || 'Admin'}</td>
                      <td className="px-4 py-4">
                        <p className="font-bold text-slate-700">{event.action || 'Payment activity'}</p>
                        {(event.oldStatus || event.newStatus) && <p className="text-xs font-black text-indigo-600 mt-1">{event.oldStatus || '-'} → {event.newStatus || event.status || '-'}</p>}
                      </td>
                      <td className="px-4 py-4 text-right font-black text-emerald-700">₹{Number(event.amount || 0).toLocaleString()}</td>
                      <td className="px-4 py-4 text-xs font-semibold text-slate-500 max-w-md truncate" title={event.note || ''}>{event.note || '-'}</td>
                    </tr>
                  ))}
                  {paymentAuditEvents.length === 0 && <tr><td colSpan="6" className="text-center py-10 text-slate-500 font-medium">No payment audit entries found for the selected finance filters.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

const TaskDetailView = ({ project, user, onBack, onUpdateProject, users, projects = [], onDeleteTask }) => {
  const [newSubTask, setNewSubTask] = useState('');
  const [newNote, setNewNote] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditCase, setShowEditCase] = useState(false);
  const [isUploadingFinal, setIsUploadingFinal] = useState(false);
  const [fileTransfer, setFileTransfer] = useState({ active: false, phase: '', label: '', fileName: '', progress: 0, message: '', loaded: 0, total: 0, speedBps: 0, etaSeconds: 0, startedAt: 0, transferType: '', fileId: '' });
  const [downloadedFileMap, setDownloadedFileMap] = useState(() => listCachedProjectFiles());
  const [filePreview, setFilePreview] = useState(null);
  const [filePreviewUi, setFilePreviewUi] = useState({ zoom: 1, rotation: 0, fitMode: 'width' });

  const closeFilePreview = useCallback(() => {
    setFilePreview((current) => {
      if (current?.objectUrl) {
        try { URL.revokeObjectURL(current.objectUrl); } catch {}
      }
      return null;
    });
    setFilePreviewUi({ zoom: 1, rotation: 0, fitMode: 'width' });
  }, []);

  useEffect(() => () => {
    if (filePreview?.objectUrl) {
      try { URL.revokeObjectURL(filePreview.objectUrl); } catch {}
    }
  }, [filePreview?.objectUrl]);

  const [subTaskAttachments, setSubTaskAttachments] = useState([]);
  const [noteAttachments, setNoteAttachments] = useState([]);
  const [isUploadingRevisionAttachment, setIsUploadingRevisionAttachment] = useState(false);
  const [isUploadingNoteAttachment, setIsUploadingNoteAttachment] = useState(false);
  const completedFileInputRef = useRef(null);

  const refreshDownloadedFileMap = useCallback(() => {
    setDownloadedFileMap(listCachedProjectFiles());
  }, []);

  useEffect(() => {
    let alive = true;
    pruneExpiredProjectFileCache().finally(() => {
      if (alive) refreshDownloadedFileMap();
    });
    const onStorage = (event) => {
      if (!event.key || event.key === 'kalpavriksha_downloaded_file_index_v1') refreshDownloadedFileMap();
    };
    const onFocus = () => refreshDownloadedFileMap();
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      alive = false;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshDownloadedFileMap]);

  const isDocDownloaded = useCallback((doc = {}) => Boolean(downloadedFileMap[getProjectFileCacheKey(doc)]), [downloadedFileMap]);
  
  const canManage = user.role === ROLES.ADMIN || user.role === ROLES.MANAGER;
  const isAssignedToMe = samePerson(project.assignedTo, user.name);
  const canDesignerRevertOwnTask = user.role === ROLES.DESIGNER && isAssignedToMe;
  const canRevertTask = (canManage || canDesignerRevertOwnTask) && project.status !== 'Lead Received';
  const showFinancials = user.role === ROLES.ADMIN;
  const activeDraftingForUser = (usersProjects = []) => (usersProjects || []).find(p => samePerson(p.assignedTo, project.assignedTo || user.name) && p.status === 'Drafting' && String(p.id) !== String(project.id));

  const handleSaveCaseEdit = (event) => {
    event.preventDefault();
    if (!canManage) return;
    const fd = new FormData(event.currentTarget);
    const nextTypeRaw = String(fd.get('type') || '').trim();
    const nextType = nextTypeRaw === 'Other' ? String(fd.get('otherType') || project.type || 'Other').trim() : nextTypeRaw;
    const now = Date.now();
    const changeReason = String(fd.get('changeReason') || '').trim();
    const previousSnapshot = {
      id: project.id,
      type: project.type || '',
      client: project.client || '',
      customerName: project.customerName || '',
      location: project.location || '',
      description: project.description || '',
      estimateDetails: project.estimateDetails || '',
      estimate: project.estimate || '',
      assignedTo: project.assignedTo || 'Unassigned',
      priority: project.priority || 'Normal',
      dueDate: project.dueDate || '',
    };
    const nextSnapshot = {
      type: nextType || project.type,
      client: getCanonicalBankName(String(fd.get('client') || '').trim()),
      customerName: String(fd.get('customerName') || '').trim(),
      location: getCanonicalLocationName(String(fd.get('location') || '').trim()),
      description: String(fd.get('description') || '').trim(),
      estimateDetails: String(fd.get('estimateDetails') || '').trim(),
      estimate: String(fd.get('estimate') || '').trim(),
      assignedTo: String(fd.get('assignedTo') || 'Unassigned'),
      priority: String(fd.get('priority') || project.priority || 'Normal'),
      dueDate: String(fd.get('dueDate') || ''),
    };
    if (!nextSnapshot.type.toLowerCase().includes('estimate')) nextSnapshot.estimateDetails = '';
    const changedFields = Object.keys(nextSnapshot).filter(k => String(previousSnapshot[k] || '') !== String(nextSnapshot[k] || ''));
    if (changedFields.length === 0 && !changeReason) {
      setShowEditCase(false);
      return;
    }
    const idSourceChanged = ['client', 'customerName', 'location'].some(k => changedFields.includes(k));
    const nextTaskId = idSourceChanged
      ? generateTraceableTaskId({ location: nextSnapshot.location, client: nextSnapshot.client, customerName: nextSnapshot.customerName, projects, excludeId: project.id })
      : project.id;
    const reassignmentHistory = [...(project.reassignmentHistory || [])];
    if (String(previousSnapshot.assignedTo || 'Unassigned') !== String(nextSnapshot.assignedTo || 'Unassigned')) {
      reassignmentHistory.push({ from: previousSnapshot.assignedTo || 'Unassigned', to: nextSnapshot.assignedTo || 'Unassigned', by: user.name, time: new Date(now).toLocaleString(), reason: changeReason || 'Case edited' });
    }
    const updatedProject = {
      ...project,
      ...nextSnapshot,
      id: nextTaskId,
      previousTaskIds: nextTaskId !== project.id ? [...new Set([...(project.previousTaskIds || []), project.id])].filter(Boolean) : (project.previousTaskIds || []),
      supersedesTaskId: nextTaskId !== project.id ? project.id : project.supersedesTaskId,
      caseId: nextTaskId,
      taskName: [nextSnapshot.type, nextSnapshot.customerName, nextSnapshot.location].filter(Boolean).join(' • '),
      updatedAt: now,
      syncVersion: now,
      assignedBy: nextSnapshot.assignedTo !== previousSnapshot.assignedTo ? user.name : project.assignedBy,
      assignedAt: nextSnapshot.assignedTo !== previousSnapshot.assignedTo ? now : project.assignedAt,
      assignmentVersion: nextSnapshot.assignedTo !== previousSnapshot.assignedTo ? now : project.assignmentVersion,
      ownership: { ...(project.ownership || {}), assignedTo: nextSnapshot.assignedTo, editedBy: user.name },
      reassignmentHistory,
      caseEditHistory: [
        ...(project.caseEditHistory || []),
        { id: now, by: user.name, editedBy: user.name, at: now, editedAt: now, time: new Date(now).toLocaleString(), reason: changeReason, changedFields: nextTaskId !== project.id ? [...changedFields, 'taskId'] : changedFields, before: previousSnapshot, after: { ...nextSnapshot, id: nextTaskId } }
      ],
      timeline: [
        ...(project.timeline || []),
        { id: now, text: `Case edited by ${user.name}${nextTaskId !== project.id ? ` • Task ID changed ${project.id} → ${nextTaskId}` : ''}${changeReason ? `: ${changeReason}` : ''}`, time: new Date(now).toLocaleString() }
      ]
    };
    onUpdateProject(updatedProject, project);
    setShowEditCase(false);
  };

  const handlePauseDrafting = () => {
    if (project.status !== 'Drafting') return;
    const now = Date.now();
    const sessionStart = project.draftingResumedAt || project.currentDraftingStartedAt || project.draftingStartedAt || project.workStartedAt || now;
    const previousElapsed = Math.max(0, Number(project.draftingElapsedMsBeforePause) || Number(project.draftingElapsedMs) || 0);
    const sessionElapsed = Math.max(0, now - Number(sessionStart));
    const totalElapsed = previousElapsed + sessionElapsed;
    onUpdateProject({
      ...project,
      status: 'Drafting Paused',
      draftingPausedAt: now,
      currentDraftingStartedAt: null,
      draftingResumedAt: null,
      draftingElapsedMsBeforePause: totalElapsed,
      draftingElapsedMs: totalElapsed,
      pausedBy: user.name,
      pausedDraftingSessions: [...(project.pausedDraftingSessions || []), { start: sessionStart, pausedAt: now, elapsedMs: sessionElapsed, totalElapsedMs: totalElapsed, by: user.name }],
      timeline: [...(project.timeline || []), { id: now, text: `Drafting paused by ${user.name}`, time: new Date(now).toLocaleString() }]
    }, project);
  };

  const handleAdvanceStatus = () => {
    const updatedProject = { ...project };
    if (project.status === 'Lead Received' || project.status === 'Assigned' || project.status === 'Drafting Paused' || project.status === 'Revision Pending' || project.status === 'Revision In Progress') {
      const otherDrafting = activeDraftingForUser(projects);
      if (otherDrafting) {
        alert(`Only one task can be drafted at a time. Pause drafting on ${otherDrafting.id} before starting another task.`);
        return;
      }
      const now = Date.now();
      const wasPaused = project.status === 'Drafting Paused';
      const wasRevision = project.status === 'Revision Pending' || project.status === 'Revision In Progress';
      updatedProject.status = 'Drafting';
      updatedProject.draftingStartedAt = updatedProject.draftingStartedAt || now;
      updatedProject.currentDraftingStartedAt = now;
      updatedProject.draftingResumedAt = now;
      updatedProject.draftingPausedAt = null;
      updatedProject.pausedBy = null;
      updatedProject.reviewStatus = wasRevision ? 'Revision In Progress' : updatedProject.reviewStatus;
      updatedProject.timeline = [...(project.timeline || []), { id: now, text: `${wasPaused ? 'Drafting resumed' : wasRevision ? 'Revision drafting started' : 'Drafting started'} by ${user.name}`, time: new Date(now).toLocaleString() }];
    }
    else if (project.status === 'Drafting') {
      if (getCompletedDocuments(project).length === 0) {
        alert('Upload the completed work file first, then send it for internal review.');
        return;
      }
      updatedProject.status = 'Internal Review';
      updatedProject.submittedAt = updatedProject.submittedAt || Date.now();
      updatedProject.draftingCompletedAt = updatedProject.draftingCompletedAt || Date.now();
      updatedProject.draftingFinalElapsedMs = getDraftingElapsedMs(updatedProject, updatedProject.draftingCompletedAt);
      updatedProject.internalReviewStartedAt = updatedProject.internalReviewStartedAt || Date.now();
      updatedProject.finalConclusion = 'Pending Internal Review';
      updatedProject.reviewStatus = 'Pending';
    }
    else if (project.status === 'Internal Review') {
      if (!canManage) {
        alert('Only Admin or Manager can approve the final file after internal review.');
        return;
      }
      updatedProject.status = 'Completed';
      updatedProject.completedAt = Date.now();
      updatedProject.approvedAt = Date.now();
      updatedProject.reviewedBy = user.name;
      updatedProject.completedBy = user.name;
      updatedProject.approvedBy = user.name;
      updatedProject.finalConclusion = 'Approved';
      updatedProject.reviewStatus = 'Approved';
      updatedProject.ownership = { ...(updatedProject.ownership || {}), reviewedBy: user.name, completedBy: user.name, approvedBy: user.name };
    }
    
    updatedProject.timeline = [
      ...(updatedProject.timeline || []), 
      { id: Date.now(), text: `Status advanced to ${updatedProject.status}`, time: new Date().toLocaleString() }
    ];
    onUpdateProject(updatedProject, project);
  };

  const handleApproveFinal = () => {
    if (!canManage) {
      alert('Only Admin or Manager can approve the final file.');
      return;
    }
    if (getCompletedDocuments(project).length === 0) {
      alert('No completed work file found for approval.');
      return;
    }
    const updatedProject = {
      ...project,
      status: 'Completed',
      completedAt: Date.now(),
      approvedAt: Date.now(),
      reviewedBy: user.name,
      completedBy: user.name,
      approvedBy: user.name,
      finalConclusion: 'Approved',
      reviewStatus: 'Approved',
      ownership: { ...(project.ownership || {}), reviewedBy: user.name, completedBy: user.name, approvedBy: user.name },
      timeline: [
        ...(project.timeline || []),
        { id: Date.now(), text: `Final file approved after internal review by ${user.name}`, time: new Date().toLocaleString() }
      ]
    };
    onUpdateProject(updatedProject, project);
  };

  const handleRevertStatus = () => {
    const updatedProject = { ...project };
    let revertedTo = '';
    
    if (project.status === 'Drafting') revertedTo = 'Assigned';
    else if (project.status === 'Internal Review') revertedTo = 'Drafting';
    else if (project.status === 'Completed') {
      revertedTo = 'Internal Review';
      updatedProject.completedAt = null;
      updatedProject.approvedAt = null;
      updatedProject.finalConclusion = 'Pending Internal Review';
      updatedProject.reviewStatus = 'Pending';
      updatedProject.reportSent = false;
    }
    
    if (revertedTo) {
      updatedProject.status = revertedTo;
      updatedProject.timeline = [
        ...(updatedProject.timeline || []), 
        { id: Date.now(), text: `Status reverted back to ${revertedTo} by ${user.name}`, time: new Date().toLocaleString() }
      ];
      onUpdateProject(updatedProject, project);
    }
  };

  const resetFileTransferLater = (delay = 2200) => {
    window.setTimeout(() => setFileTransfer(prev => prev.active ? prev : { active: false, phase: '', label: '', fileName: '', progress: 0, message: '', loaded: 0, total: 0, speedBps: 0, etaSeconds: 0, startedAt: 0, transferType: '', fileId: '' }), delay);
  };

  const updateFileTransfer = (patch = {}) => {
    setFileTransfer(prev => ({ ...prev, ...patch }));
  };

  const resetFileTransfer = () => setFileTransfer({ active: false, phase: '', label: '', fileName: '', progress: 0, message: '', loaded: 0, total: 0, speedBps: 0, etaSeconds: 0, startedAt: 0, transferType: '', fileId: '' });

  const normalizeTransferProgress = (progressInfo) => {
    if (typeof progressInfo === 'number') return { percent: progressInfo };
    if (!progressInfo || typeof progressInfo !== 'object') return { percent: 0 };
    return {
      percent: Number(progressInfo.percent || progressInfo.progress || 0),
      loaded: Number(progressInfo.loaded || 0),
      total: Number(progressInfo.total || 0),
      speedBps: Number(progressInfo.speedBps || 0),
      etaSeconds: Number(progressInfo.etaSeconds || 0),
    };
  };

  const formatTransferBytes = (bytes = 0) => {
    const n = Number(bytes || 0);
    if (!n) return '';
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  };

  const formatTransferEta = (seconds = 0) => {
    const s = Math.max(0, Math.round(Number(seconds || 0)));
    if (!s) return 'Almost done';
    if (s < 60) return `${s}s left`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s left` : `${m}m left`;
  };

  const renderWhatsAppTransferBar = (extraClass = '') => {
    if (!fileTransfer.active) return null;
    const progress = Math.max(0, Math.min(100, Math.round(fileTransfer.progress || 0)));
    const isWorking = fileTransfer.phase === 'uploading' || fileTransfer.phase === 'downloading';
    const isUpload = fileTransfer.phase === 'uploading';
    const isDownload = fileTransfer.phase === 'downloading';
    const tone = fileTransfer.phase === 'error' ? 'red' : fileTransfer.phase === 'complete' ? 'emerald' : 'indigo';
    const loadedText = fileTransfer.loaded && fileTransfer.total ? `${formatTransferBytes(fileTransfer.loaded)} / ${formatTransferBytes(fileTransfer.total)}` : fileTransfer.total ? formatTransferBytes(fileTransfer.total) : '';
    const etaText = isWorking ? formatTransferEta(fileTransfer.etaSeconds) : (fileTransfer.phase === 'complete' ? 'Complete' : fileTransfer.phase === 'error' ? 'Failed' : 'Working');
    return (
      <div className={`rounded-2xl border shadow-sm overflow-hidden ${tone === 'red' ? 'bg-red-50 border-red-100' : tone === 'emerald' ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-indigo-100'} ${extraClass}`}>
        <div className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${tone === 'red' ? 'bg-red-100 text-red-600' : tone === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-50 text-indigo-700'}`}>
              {isDownload ? <Download className="w-5 h-5" /> : <Paperclip className="w-5 h-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-[11px] font-black uppercase tracking-widest ${tone === 'red' ? 'text-red-600' : tone === 'emerald' ? 'text-emerald-700' : 'text-indigo-700'}`}>{fileTransfer.label || 'File transfer'}</p>
                  <p className="text-sm font-black text-slate-900 truncate">{fileTransfer.fileName || 'File'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-slate-900">{progress}%</p>
                  <p className="text-[10px] font-bold text-slate-500">{etaText}</p>
                </div>
              </div>
              <div className="mt-2 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-300 ${tone === 'red' ? 'bg-red-500' : tone === 'emerald' ? 'bg-emerald-500' : 'bg-indigo-600'}`} style={{ width: `${Math.max(isWorking ? 4 : 0, progress)}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
                <span>{fileTransfer.message || (isUpload ? 'Uploading...' : isDownload ? 'Downloading...' : 'Working...')}</span>
                {loadedText && <span>{loadedText}</span>}
              </div>
            </div>
          </div>
          {isUpload && <p className="text-[11px] font-bold text-indigo-600 mt-3">Keep this page open. Do not select the same file again while upload is running.</p>}
        </div>
      </div>
    );
  };


  const isCurrentTransferForType = (transferType, phase = '') => (
    fileTransfer.active &&
    (!phase || fileTransfer.phase === phase) &&
    String(fileTransfer.transferType || '') === String(transferType || '')
  );

  const isCurrentTransferForDoc = (doc, phase = '') => {
    if (!fileTransfer.active || (phase && fileTransfer.phase !== phase)) return false;
    const currentId = String(fileTransfer.fileId || '');
    const docId = String(doc?.id || doc?.fileId || '');
    if (currentId && docId && currentId === docId) return true;
    return Boolean(fileTransfer.fileName && doc?.name && String(fileTransfer.fileName) === String(doc.name));
  };

  const renderInlineFileTransferBar = (extraClass = '') => renderWhatsAppTransferBar(`mt-3 ${extraClass}`);


  const openUnifiedFilePreview = useCallback(async (doc = {}) => {
    const kind = getProjectFileKind(doc);
    if (kind === 'file') {
      alert('Preview is available for PDF and image files. Please download this file to open it.');
      return;
    }
    const name = doc.name || doc.fileName || (kind === 'image' ? 'Image Preview' : 'PDF Preview');
    if (filePreview?.objectUrl) {
      try { URL.revokeObjectURL(filePreview.objectUrl); } catch {}
    }
    setFilePreviewUi({ zoom: 1, rotation: 0, fitMode: 'width' });
    setFilePreview({ doc, kind, name, loading: true, error: '', url: '', objectUrl: '' });
    try {
      const preview = await fetchProjectFilePreview(doc);
      setFilePreview({
        doc,
        kind: preview.kind || kind,
        name,
        loading: false,
        error: '',
        url: preview.url,
        objectUrl: preview.url,
        sourceUrl: preview.sourceUrl,
        mimeType: preview.mimeType,
        size: preview.size,
      });
    } catch (error) {
      setFilePreview({
        doc,
        kind,
        name,
        loading: false,
        error: error?.message || 'Preview could not be loaded.',
        url: '',
        objectUrl: '',
        sourceUrl: '',
      });
    }
  }, [filePreview?.objectUrl]);

  // Single active preview entry point. Older names are aliases only; do not create
  // separate preview implementations. This prevents runtime errors during hot reload
  // and keeps Chat/Operations/Archive on the same viewer path.
  const handlePreviewFile = openUnifiedFilePreview;

  useEffect(() => {
    window.__kalpaOpenFilePreview = openUnifiedFilePreview;
    return () => {
      if (window.__kalpaOpenFilePreview === openUnifiedFilePreview) {
        delete window.__kalpaOpenFilePreview;
      }
    };
  }, [openUnifiedFilePreview]);

  const handleTrackedDownload = async (doc) => {
    const fileName = doc?.name || doc?.fileName || 'file';
    if (isDocDownloaded(doc)) {
      await handleOpenDownloadedFile(doc);
      return;
    }
    if (fileTransfer.active && fileTransfer.phase !== 'complete' && fileTransfer.phase !== 'error') {
      alert(`${fileTransfer.label || 'File transfer'} is already in progress. Please wait until it completes before starting another upload/download.`);
      return;
    }
    updateFileTransfer({ active: true, phase: 'downloading', label: 'Downloading file', fileName, fileId: doc?.id || doc?.fileId || '', transferType: 'download', progress: 1, loaded: 0, total: Number(doc?.size || 0), speedBps: 0, etaSeconds: 0, startedAt: Date.now(), message: 'Preparing download...' });
    try {
      await downloadProjectFile(doc, (info) => {
        const meta = normalizeTransferProgress(info);
        const safePct = Math.max(1, Math.min(99, Number(meta.percent) || 1));
        updateFileTransfer({
          active: true,
          phase: 'downloading',
          label: 'Downloading file',
          fileName,
          fileId: doc?.id || doc?.fileId || '',
          transferType: 'download',
          progress: safePct,
          loaded: meta.loaded || 0,
          total: meta.total || Number(doc?.size || 0),
          speedBps: meta.speedBps || 0,
          etaSeconds: meta.etaSeconds || 0,
          message: meta.total ? `${safePct}% downloaded` : 'Downloading file...',
        });
      });
      refreshDownloadedFileMap();
      updateFileTransfer({ active: true, phase: 'complete', label: 'Download complete', fileName, fileId: doc?.id || doc?.fileId || '', transferType: 'download', progress: 100, etaSeconds: 0, message: 'Saved for quick open in this browser for 7 days.' });
      window.setTimeout(() => resetFileTransfer(), 2600);
    } catch (error) {
      updateFileTransfer({ active: true, phase: 'error', label: 'Download needs attention', fileName, fileId: doc?.id || doc?.fileId || '', transferType: 'download', progress: 100, etaSeconds: 0, message: error?.message || 'Could not start download. Please try again.' });
    }
  };

  const handleOpenDownloadedFile = async (doc) => {
    const fileName = doc?.name || doc?.fileName || 'file';
    try {
      updateFileTransfer({ active: true, phase: 'complete', label: 'Opening downloaded file', fileName, fileId: doc?.id || doc?.fileId || '', transferType: 'download', progress: 100, etaSeconds: 0, message: 'Opening saved copy from this browser.' });
      await openCachedProjectFile(doc);
      window.setTimeout(() => resetFileTransfer(), 1400);
    } catch (error) {
      await clearCachedProjectFile(doc).catch(() => {});
      refreshDownloadedFileMap();
      updateFileTransfer({ active: true, phase: 'error', label: 'Saved copy missing', fileName, fileId: doc?.id || doc?.fileId || '', transferType: 'download', progress: 100, etaSeconds: 0, message: 'Saved copy is missing or older than 7 days. Please download again.' });
    }
  };

  const renderFileActionButtons = (doc, downloadClassName, deleteClassName = '') => {
    const fileState = getProjectFileActionState(doc);
    const safeDoc = fileState.doc || doc;
    const downloaded = isDocDownloaded(safeDoc);
    const canPreview = fileState.canPreview;
    if (!fileState.hasLink) {
      return (
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          <span className="text-[11px] font-black text-amber-700 bg-amber-50 border border-amber-100 px-3 py-2 rounded-xl whitespace-nowrap" title="File record exists, but no usable server link was saved. Re-upload once to repair it.">
            Link missing
          </span>
          {canDeleteProjectFile(safeDoc, user) && <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); handleFileDelete(safeDoc); }} title="Delete broken file record" className={deleteClassName || "text-xs font-bold text-red-600 bg-white border border-red-100 hover:bg-red-50 px-3 py-2 rounded-xl whitespace-nowrap transition-colors shadow-sm flex items-center gap-1"}><Trash2 className="w-3.5 h-3.5" /> Delete</button>}
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
        {canPreview && (
          <button
            type="button"
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); openUnifiedFilePreview(safeDoc); }}
            className="text-xs font-black text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-xl whitespace-nowrap transition-colors shadow-sm flex items-center gap-1.5"
            title="Preview inside Kalpavriksha Ops without downloading"
          >
            <Eye className="w-3.5 h-3.5" /> Preview
          </button>
        )}
        {fileState.canDownload && (
          <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); downloaded ? handleOpenDownloadedFile(safeDoc) : handleTrackedDownload(safeDoc); }} className={downloadClassName}>
            {downloaded ? 'Open' : 'Download'}
          </button>
        )}
        {downloaded && <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-lg whitespace-nowrap">Downloaded • 7d cache</span>}
        {canDeleteProjectFile(safeDoc, user) && <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); handleFileDelete(safeDoc); }} title="Delete file" className={deleteClassName || "text-xs font-bold text-red-600 bg-white border border-red-100 hover:bg-red-50 px-3 py-2 rounded-xl whitespace-nowrap transition-colors shadow-sm flex items-center gap-1"}><Trash2 className="w-3.5 h-3.5" /> Delete</button>}
      </div>
    );
  };

  const handleFileUpload = async (type, e) => {
    const files = Array.from(e?.target?.files || []);
    if (!files || files.length === 0) return;
    if (fileTransfer.active && fileTransfer.phase !== 'complete' && fileTransfer.phase !== 'error') {
      alert(`${fileTransfer.label || 'File transfer'} is already in progress. Please wait until it completes before starting another upload/download.`);
      if (e?.target) e.target.value = '';
      return;
    }
    if (type === 'completed') setIsUploadingFinal(true);

    const totalFiles = files.length;
    const totalUploadBytes = files.reduce((sum, f) => sum + Number(f.size || 0), 0);
    const transferStartedAt = Date.now();
    const currentLabel = type === 'completed' ? 'Uploading final file' : type === 'working' ? 'Uploading work file' : 'Uploading source file';
    updateFileTransfer({ active: true, phase: 'uploading', label: currentLabel, fileName: files[0]?.name || 'file', transferType: type, progress: 1, loaded: 0, total: totalUploadBytes, speedBps: 0, etaSeconds: 0, startedAt: transferStartedAt, message: totalFiles > 1 ? `Uploading 1 of ${totalFiles}` : 'Upload started. Please do not upload again.' });

    try {
      const updatedProject = { ...project };
      if (!updatedProject.documents) updatedProject.documents = [];
      if (!updatedProject.completedFiles) updatedProject.completedFiles = [];

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        updateFileTransfer({ active: true, phase: 'uploading', label: currentLabel, fileName: file.name, transferType: type, message: totalFiles > 1 ? `Uploading ${index + 1} of ${totalFiles}` : 'Uploading...' });
        const uploadedDoc = await uploadProjectFile(file, project.id, type, user.name, (info) => {
          const meta = normalizeTransferProgress(info);
          const safePct = Math.max(1, Math.min(99, Number(meta.percent) || 1));
          const aggregatePct = Math.round(((index / totalFiles) * 100) + (safePct / totalFiles));
          const previousBytes = files.slice(0, index).reduce((sum, f) => sum + Number(f.size || 0), 0);
          const totalBytes = totalUploadBytes;
          const loadedBytes = previousBytes + Number(meta.loaded || 0);
          const elapsedSeconds = Math.max(0.5, (Date.now() - transferStartedAt) / 1000);
          const speedBps = loadedBytes > 0 ? loadedBytes / elapsedSeconds : 0;
          const remainingBytes = Math.max(0, totalBytes - loadedBytes);
          const etaSeconds = speedBps > 0 && remainingBytes > 0 ? Math.ceil(remainingBytes / speedBps) : 0;
          updateFileTransfer({ transferType: type, progress: Math.max(1, Math.min(99, aggregatePct)), loaded: loadedBytes, total: totalBytes, speedBps, etaSeconds, message: totalFiles > 1 ? `Uploading ${index + 1} of ${totalFiles} • ${safePct}%` : `${safePct}% uploaded` });
        });
        updatedProject.documents.push(uploadedDoc);

        if (type === 'completed') {
          updatedProject.completedFiles.push(uploadedDoc);
        }

        updatedProject.timeline = [...(updatedProject.timeline||[]), {
          id: Date.now() + Math.random(),
          text: `File uploaded: ${file.name}`,
          time: new Date().toLocaleString()
        }];
      }

      if (type === 'completed') {
        updatedProject.status = 'Internal Review';
        updatedProject.submittedAt = updatedProject.submittedAt || Date.now();
        updatedProject.draftingCompletedAt = updatedProject.draftingCompletedAt || Date.now();
        updatedProject.internalReviewStartedAt = updatedProject.internalReviewStartedAt || Date.now();
        updatedProject.completedAt = null;
        updatedProject.finalConclusion = 'Pending Internal Review';
        updatedProject.reviewStatus = 'Pending';
        updatedProject.subTasks = (updatedProject.subTasks || []).map(st => isSubTaskOpen(st) ? { ...st, status: 'Done', completedBy: user.name, completedAt: Date.now() } : st);
        updatedProject.timeline.push({ id: Date.now()+3, text: 'Completed work file uploaded. Sent for internal review before final approval.', time: new Date().toLocaleString() });
      }

      if (e?.target) e.target.value = '';
      onUpdateProject(updatedProject, project);
      updateFileTransfer({ active: true, phase: 'complete', label: 'Upload complete', progress: 100, message: `${totalFiles} file${totalFiles > 1 ? 's' : ''} uploaded successfully.` });
      window.setTimeout(() => resetFileTransfer(), 2600);
    } catch (error) {
      console.error('File upload failed:', error);
      updateFileTransfer({ active: true, phase: 'error', label: 'Upload failed', progress: 100, message: error?.message || 'Please check your internet connection and try again.' });
      alert(`File upload failed: ${error?.message || 'Please check your internet connection and try again.'}`);
    } finally {
      if (type === 'completed') setIsUploadingFinal(false);
      if (e?.target) e.target.value = '';
    }
  };



  const uploadSupportingAttachments = async (event, attachmentType, setAttachments, setUploading) => {
    const files = Array.from(event?.target?.files || []);
    if (files.length === 0) return;
    setUploading(true);
    updateFileTransfer({ active: true, phase: 'uploading', label: attachmentType === 'revision' ? 'Uploading revision attachment' : 'Uploading attachment', fileName: files[0]?.name || 'attachment', transferType: attachmentType, progress: 1, loaded: 0, total: files.reduce((sum, f) => sum + Number(f.size || 0), 0), speedBps: 0, etaSeconds: 0, startedAt: Date.now(), message: 'Upload started. Please wait.' });
    try {
      const uploadedDocs = [];
      for (const file of files) {
        const uploadedDoc = await uploadProjectFile(file, project.id, attachmentType, user.name, (info) => {
          const meta = normalizeTransferProgress(info);
          const safePct = Math.max(1, Math.min(99, Number(meta.percent) || 1));
          updateFileTransfer({ active: true, phase: 'uploading', label: attachmentType === 'revision' ? 'Uploading revision attachment' : 'Uploading attachment', fileName: file.name, transferType: attachmentType, progress: safePct, loaded: meta.loaded || 0, total: meta.total || Number(file.size || 0), speedBps: meta.speedBps || 0, etaSeconds: meta.etaSeconds || 0, message: `${safePct}% uploaded` });
        });
        uploadedDocs.push({
          ...uploadedDoc,
          id: uploadedDoc.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: attachmentType,
          uploadedBy: uploadedDoc.uploadedBy || user.name,
          uploadedAt: uploadedDoc.uploadedAt || Date.now(),
        });
      }
      setAttachments(prev => [...prev, ...uploadedDocs]);
      updateFileTransfer({ active: true, phase: 'complete', label: 'Upload complete', progress: 100, message: `${uploadedDocs.length} attachment${uploadedDocs.length > 1 ? 's' : ''} uploaded successfully.` });
      window.setTimeout(() => resetFileTransfer(), 2200);
    } catch (error) {
      console.error(`${attachmentType} attachment upload failed:`, error);
      updateFileTransfer({ active: true, phase: 'error', label: 'Upload failed', progress: 100, message: error?.message || 'Please check your internet connection and try again.' });
      alert(`Attachment upload failed: ${error?.message || 'Please check your internet connection and try again.'}`);
    } finally {
      setUploading(false);
      if (event?.target) event.target.value = '';
    }
  };

  const handleRevisionAttachmentUpload = (event) => {
    uploadSupportingAttachments(event, 'revision', setSubTaskAttachments, setIsUploadingRevisionAttachment);
  };

  const handleNoteAttachmentUpload = (event) => {
    uploadSupportingAttachments(event, 'discussion', setNoteAttachments, setIsUploadingNoteAttachment);
  };

  const removePendingAttachment = (bucket, docKey) => {
    const removeFrom = (items = []) => items.filter((doc, idx) => String(doc.id || idx) !== String(docKey));
    if (bucket === 'revision') setSubTaskAttachments(prev => removeFrom(prev));
    if (bucket === 'discussion') setNoteAttachments(prev => removeFrom(prev));
  };

  const renderInlineAttachments = (attachments = []) => {
    if (!attachments || attachments.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-2 mt-3">
        {attachments.map((doc, idx) => (
          <button
            key={doc.id || `${doc.name}-${idx}`}
            type="button"
            onClick={() => handleTrackedDownload(doc)}
            className="inline-flex items-center max-w-full text-xs font-black text-indigo-700 bg-white hover:bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-xl transition-colors shadow-sm"
            title={doc.name}
          >
            <Paperclip className="w-3.5 h-3.5 mr-1.5 flex-shrink-0" />
            <span className="truncate max-w-[190px]">{doc.name || 'Attachment'}</span>
          </button>
        ))}
      </div>
    );
  };

  const handleFileDelete = async (docToDelete) => {
    if (!docToDelete) return;
    if (!canDeleteProjectFile(docToDelete, user)) {
      alert('Only Admin, Manager, or the uploader can delete this file.');
      return;
    }
    const fileName = docToDelete.name || 'this file';
    if (!window.confirm(`Delete ${fileName}? This will remove it from this task.`)) return;

    await deleteProjectFileFromServer(docToDelete);

    const sameFile = (doc) => {
      if (!doc) return false;
      if (docToDelete.id && doc.id) return String(doc.id) === String(docToDelete.id);
      return String(doc.url || doc.downloadUrl || doc.name || '') === String(docToDelete.url || docToDelete.downloadUrl || docToDelete.name || '');
    };

    const updatedProject = {
      ...project,
      documents: (project.documents || []).filter(doc => !sameFile(doc)),
      completedFiles: (project.completedFiles || []).filter(doc => !sameFile(doc)),
      timeline: [
        ...(project.timeline || []),
        { id: Date.now(), text: `File deleted: ${fileName}`, time: new Date().toLocaleString() }
      ]
    };

    onUpdateProject(updatedProject, project);
  };

  const handleLedgerScreenshot = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const base64 = await fileToBase64(file);
    const updatedProject = {
      ...project,
      ledger: { ...(project.ledger || {}), screenshot: base64, updatedAt: Date.now() }
    };
    onUpdateProject(updatedProject, project);
  };

  const handleAddSubTask = () => {
    const revisionText = newSubTask.trim();
    if (!revisionText && subTaskAttachments.length === 0) return;
    const now = Date.now();
    const title = revisionText || `Revision attachment added by ${user.name}`;
    const revisionNumber = getNextRevisionNumber(project);
    const revisionItem = {
      id: now,
      title,
      status: 'Pending',
      addedBy: user.name,
      createdAt: now,
      time: new Date(now).toLocaleString(),
      timeSpent: '0h',
      attachments: subTaskAttachments,
      revisionNumber,
      revisionCode: `R${revisionNumber}`
    };
    const isArchivedCompletedCase = project.status === 'Completed';
    const revisionWorkItem = isArchivedCompletedCase ? makeRevisionWorkItem(project, revisionItem, user.name) : null;
    const updatedProject = {
      ...project,
      // Keep archived completed cases completed/permanent. The active revision is created as a temporary work item.
      priority: isArchivedCompletedCase ? project.priority : 'Urgent',
      status: isArchivedCompletedCase ? project.status : 'Revision Pending',
      showInMyTasks: true,
      revisionAssignedAt: now,
      assignedAt: isArchivedCompletedCase ? project.assignedAt : now,
      assignmentVersion: now,
      reviewStatus: isArchivedCompletedCase ? project.reviewStatus : 'Reverted',
      revisionRequestedAt: now,
      reviewedBy: user.name,
      documents: isArchivedCompletedCase ? (project.documents || []) : [...(project.documents || []), ...subTaskAttachments],
      subTasks: isArchivedCompletedCase ? (project.subTasks || []) : [...(project.subTasks || []), revisionItem],
      revisionHistory: [
        ...(project.revisionHistory || []),
        { ...revisionItem, action: 'Revision Requested', reviewer: user.name, at: now, workItemId: revisionWorkItem?.id || null }
      ],
      reviewHistory: [
        ...(project.reviewHistory || []),
        { id: now, action: 'Revision Requested', comment: title, reviewer: user.name, at: now, attachments: subTaskAttachments, revisionNumber, workItemId: revisionWorkItem?.id || null }
      ],
      timeline: [
        ...(project.timeline || []),
        { id: now, text: `Revision ${revisionNumber} requested by ${user.name}: ${title}`, time: new Date(now).toLocaleString() },
        ...(isArchivedCompletedCase ? [{ id: now + 0.5, text: `Temporary revision work item created for today while original task ID remains permanent.`, time: new Date(now).toLocaleString() }] : []),
        ...(subTaskAttachments.length ? [{ id: now + 1, text: `Revision attachment added by ${user.name}: ${subTaskAttachments.map(d => d.name).join(', ')}`, time: new Date(now).toLocaleString() }] : [])
      ],
      ...(revisionWorkItem ? { _spawnProjects: [revisionWorkItem] } : {})
    };
    onUpdateProject(updatedProject, project);
    setNewSubTask('');
    setSubTaskAttachments([]);
  };

  const toggleSubTask = (subTaskId) => {
    const updatedSubTasks = (project.subTasks||[]).map(st => 
      st.id === subTaskId ? { ...st, status: st.status === 'Pending' ? 'Done' : 'Pending' } : st
    );
    onUpdateProject({ ...project, subTasks: updatedSubTasks }, project);
  };

  const handleAddNote = () => {
    const noteText = newNote.trim();
    if (!noteText && noteAttachments.length === 0) return;
    const now = Date.now();
    const updatedProject = {
      ...project,
      notes: [...(project.notes||[]), { id: now, text: noteText || `Attachment added by ${user.name}`, author: user.name, time: new Date(now).toLocaleString(), attachments: noteAttachments }],
      documents: [...(project.documents || []), ...noteAttachments],
      timeline: [
        ...(project.timeline || []),
        ...(noteAttachments.length ? [{ id: now + 1, text: `Discussion attachment added by ${user.name}: ${noteAttachments.map(d => d.name).join(', ')}`, time: new Date(now).toLocaleString() }] : [])
      ]
    };
    onUpdateProject(updatedProject, project);
    setNewNote('');
    setNoteAttachments([]);
  };

  const updateLedger = (field, value) => {
    if (!showFinancials) return;
    const now = Date.now();
    const nextLedger = { ...(project.ledger || {}), [field]: value, updatedAt: now, updatedBy: user?.name || 'Admin' };
    const draftProject = { ...project, ledger: nextLedger };
    const computedStatus = derivePaymentTrackingStatusFromData(draftProject);
    const amountIn = getPaymentReceivedAmount(draftProject);
    const updatedProject = {
      ...draftProject,
      paymentTrackingStatus: computedStatus,
      paymentTrackingUpdatedAt: now,
      paymentTrackingUpdatedBy: user?.name || 'Admin',
      paymentStatus: computedStatus === 'Paid' ? 'YES' : (computedStatus === 'Pending' ? 'PENDING' : 'NOT_UPDATED'),
      paymentReceived: computedStatus === 'Paid' ? 'YES' : (computedStatus === 'Pending' ? 'PARTIAL' : 'NO'),
      paymentAmountIn: amountIn,
      paymentDate: nextLedger.date || project.paymentDate,
    };
    onUpdateProject(updatedProject, project);
  };
  
  const handlePrintReceipt = () => {
    const printWindow = window.open('', '_blank');
    const html = `
      <html>
        <head>
          <title>Receipt - ${project.id}</title>
          <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #1e293b; max-width: 600px; margin: 0 auto; }
            .header { text-align: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; }
            h1 { color: #4f46e5; margin: 0 0 10px 0; font-size: 28px; }
            .row { display: flex; justify-content: space-between; border-bottom: 1px solid #f1f5f9; padding: 12px 0; }
            .label { font-weight: bold; color: #64748b; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;}
            .value { font-weight: bold; font-size: 16px; }
            .amount { font-size: 24px; color: #059669; }
            .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #94a3b8; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>KalpaVriksha Designs</h1>
            <p style="margin: 0; color: #64748b; font-weight: bold;">Official Payment Receipt</p>
          </div>
          <div class="row"><span class="label">Task ID</span><span class="value">${project.id}</span></div>
          <div class="row"><span class="label">Date</span><span class="value">${project.ledger?.date ? new Date(project.ledger.date).toLocaleDateString() : new Date().toLocaleDateString()}</span></div>
          <div class="row"><span class="label">Client / Bank</span><span class="value">${project.client}</span></div>
          <div class="row"><span class="label">Customer Name</span><span class="value">${project.customerName || 'N/A'}</span></div>
          <div class="row"><span class="label">Property Location</span><span class="value">${project.location}</span></div>
          <div class="row"><span class="label">Received From</span><span class="value">${project.ledger?.receivedFrom || 'N/A'}</span></div>
          <div class="row" style="background: #f8fafc; padding: 20px; border-radius: 12px; margin-top: 20px; border: none;">
             <span class="label" style="align-self: center; font-size: 16px; color:#0f172a;">Amount Received</span>
             <span class="value amount">₹${Number(project.ledger?.amountIn || 0).toLocaleString()}</span>
          </div>
          <div class="footer"><p>This is a computer-generated receipt.</p></div>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); }, 500);
  };

  const copyClientLink = () => {
      const link = `${window.location.origin}/track/${project.id}`;
      navigator.clipboard.writeText(link);
      const btn = document.getElementById('client-link-btn');
      if(btn) {
          const oldText = btn.innerHTML;
          btn.innerHTML = `<span class="flex items-center"><Check class="w-4 h-4 mr-2" /> Copied!</span>`;
          setTimeout(() => btn.innerHTML = oldText, 2000);
      }
  };


  const revisionTimelineItems = getRevisionTimelineItems(project, projects);
  const completedRevisionItems = revisionTimelineItems.filter(isRevisionTimelineItemCompleted).length;
  const activeRevisionItems = revisionTimelineItems.length - completedRevisionItems;

  const shareCompletedFileOnWhatsApp = async () => {
    const completedDocs = getCompletedDocuments(project);
    if (completedDocs.length === 0) {
      alert('No completed file found for WhatsApp sharing. Please upload the completed PDF/DWG first.');
      return;
    }

    const docToShare = completedDocs[completedDocs.length - 1];
    const fileName = docToShare.name || docToShare.fileName || `${project.id || project.caseId || 'completed'}-file.pdf`;
    const downloadUrl = getProjectFileDownloadUrl(docToShare);

    if (!downloadUrl) {
      alert('This completed file does not have a valid server download link. Please re-upload the final PDF once.');
      return;
    }

    const markPrepared = (via) => onUpdateProject({
      ...project,
      reportSent: true,
      deliveryLog: [...(project.deliveryLog || []), { via, file: fileName, by: user.name, time: new Date().toLocaleString() }],
      timeline: [...(project.timeline || []), { id: Date.now(), text: `Completed file prepared for WhatsApp delivery: ${fileName}`, time: new Date().toLocaleString() }]
    }, project);

    try {
      const response = await fetch(downloadUrl, { cache: 'no-store' });
      if (!response.ok) {
        const serverText = await response.text().catch(() => '');
        throw new Error(serverText || `Download failed (${response.status})`);
      }

      const contentType = (response.headers.get('content-type') || docToShare.mimeType || docToShare.mime || '').toLowerCase();
      const blob = await response.blob();
      const looksLikePdf = /\.pdf$/i.test(fileName) || contentType.includes('pdf');
      const looksLikeServerError = contentType.includes('text/html') || contentType.includes('application/json') || contentType.includes('text/plain');

      if (looksLikeServerError && looksLikePdf) {
        throw new Error('Server returned an error page instead of the PDF. Please re-upload the completed file.');
      }
      if (looksLikePdf && blob.size < 1200) {
        throw new Error('The PDF received from server is too small and may be corrupt. Please re-upload the completed PDF once.');
      }

      const shareType = looksLikePdf ? 'application/pdf' : (blob.type || docToShare.mimeType || docToShare.mime || 'application/octet-stream');
      const file = new File([blob], fileName, { type: shareType });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName, text: `Kalpvriksha Designs completed file: ${project.id || project.caseId || ''}`.trim() });
        markPrepared('WhatsApp / native file share');
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      markPrepared('Downloaded verified file for WhatsApp Web');
      window.open('https://web.whatsapp.com/', '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.error('WhatsApp PDF share failed:', e);
      alert(`Unable to prepare this PDF for WhatsApp. ${e?.message || 'Please re-upload the completed PDF and try again.'}`);
    }
  };

  const completedDocs = getCompletedDocuments(project);
  const completedDocsCount = completedDocs.length;
  const hasRevisionCycle = (project.subTasks || []).length > 0 || (project.revisionHistory || []).length > 0 || project.priority === 'Urgent';
  const latestCompletedAt = completedDocs.reduce((max, doc) => Math.max(max, Number(doc.uploadedAt || doc.createdAt || doc.updatedAt || doc.id || 0) || new Date(doc.time || doc.date || 0).getTime() || 0), 0);
  const latestRevisedCompletedDocs = hasRevisionCycle && completedDocs.length > 0
    ? completedDocs.filter(doc => {
        const t = Number(doc.uploadedAt || doc.createdAt || doc.updatedAt || doc.id || 0) || new Date(doc.time || doc.date || 0).getTime() || 0;
        return t === latestCompletedAt || String(doc.type || doc.folder || doc.label || '').toLowerCase().includes('revision');
      })
    : [];
  const isAwaitingInternalReview = project.status === 'Internal Review' && completedDocsCount > 0;
  const isFinalApproved = project.status === 'Completed' && (project.finalConclusion === 'Approved' || project.reviewStatus === 'Approved' || project.approvedAt);
  const canApproveFinal = canManage && isAwaitingInternalReview;
  const advanceLabel = (project.status === 'Lead Received' || project.status === 'Assigned' || project.status === 'Drafting Paused')
    ? (project.status === 'Drafting Paused' ? 'Resume Drafting' : 'Start Drafting')
    : project.status === 'Drafting'
      ? 'Send for Internal Review'
      : project.status === 'Internal Review'
        ? (canManage ? 'Approve Final' : 'Awaiting Approval')
        : 'Advance Status';

  const clampPreviewZoom = useCallback((value) => Math.min(4, Math.max(0.35, Number(value.toFixed ? value.toFixed(2) : value))), []);
  const updatePreviewZoom = useCallback((delta) => setFilePreviewUi(v => ({ ...v, zoom: clampPreviewZoom(Number(v.zoom || 1) + delta), fitMode: 'custom' })), [clampPreviewZoom]);
  const fitPreviewWidth = useCallback(() => setFilePreviewUi(v => ({ ...v, zoom: 1, fitMode: 'width' })), []);
  const fitPreviewPage = useCallback(() => setFilePreviewUi(v => ({ ...v, zoom: 0.9, fitMode: 'page' })), []);
  const resetPreviewView = useCallback(() => setFilePreviewUi({ zoom: 1, rotation: 0, fitMode: 'width' }), []);
  const rotatePreview = useCallback((direction = 1) => setFilePreviewUi(v => ({ ...v, rotation: ((Number(v.rotation || 0) + (direction * 90)) % 360 + 360) % 360 })), []);
  const previewZoomValue = clampPreviewZoom(Number(filePreviewUi.zoom || 1));
  const previewFrameSrc = filePreview?.url && filePreview?.kind !== 'image'
    ? `${String(filePreview.url).split('#')[0]}#toolbar=0&navpanes=0&view=${filePreviewUi.fitMode === 'page' ? 'Fit' : 'FitH'}&zoom=${Math.round(previewZoomValue * 100)}`
    : filePreview?.url;
  const previewPdfFrameStyle = undefined;

  useEffect(() => {
    if (!filePreview) return undefined;
    const onKeyDown = (event) => {
      const key = String(event.key || '').toLowerCase();
      if (key === 'escape') { event.preventDefault(); closeFilePreview(); return; }
      if (event.ctrlKey && (key === '+' || key === '=')) { event.preventDefault(); updatePreviewZoom(0.15); return; }
      if (event.ctrlKey && key === '-') { event.preventDefault(); updatePreviewZoom(-0.15); return; }
      if (event.ctrlKey && key === '0') { event.preventDefault(); resetPreviewView(); return; }
      if (key === 'r') { event.preventDefault(); rotatePreview(event.shiftKey ? -1 : 1); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filePreview, closeFilePreview, updatePreviewZoom, resetPreviewView, rotatePreview]);

  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {filePreview && (
        <PortalLayer isOpen={Boolean(filePreview)} className="kalpa-preview-layer fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center" lockScrollClass="kalpa-preview-open" role="dialog" ariaModal={true} ariaLabel="File preview" onEscape={closeFilePreview} initialFocusSelector="button">
          <div className="kalpa-preview-card bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="kalpa-preview-header border-b border-slate-100 bg-white/95">
              <div className="kalpa-preview-title min-w-0 flex items-center gap-3">
                <div className={`${filePreview.kind === 'image' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-red-50 text-red-600 border-red-100'} w-9 h-9 rounded-2xl flex items-center justify-center border shrink-0`}>
                  {filePreview.kind === 'image' ? <ImageIcon className="w-4.5 h-4.5" /> : <FileText className="w-4.5 h-4.5" />}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{filePreview.kind === 'image' ? 'Image Preview' : 'PDF Preview'}{isDocDownloaded(filePreview.doc) ? ' • Cached' : ''}</p>
                  <h3 className="text-sm font-black text-slate-900 truncate">{filePreview.name}</h3>
                </div>
              </div>
              <div className="kalpa-preview-toolbar flex items-center gap-1.5 shrink-0">
                <button type="button" onClick={() => updatePreviewZoom(-0.15)} className="kalpa-preview-btn" title="Zoom out (Ctrl -)"><ZoomOut className="w-4 h-4" /></button>
                <span className="kalpa-preview-zoom">{Math.round(previewZoomValue * 100)}%</span>
                <button type="button" onClick={() => updatePreviewZoom(0.15)} className="kalpa-preview-btn" title="Zoom in (Ctrl +)"><ZoomIn className="w-4 h-4" /></button>
                <span className="kalpa-preview-separator hidden sm:inline-flex" />
                <button type="button" onClick={fitPreviewWidth} className="kalpa-preview-btn-text" title="Fit width">Fit Width</button>
                <button type="button" onClick={fitPreviewPage} className="kalpa-preview-btn-text" title="Fit page">Fit Page</button>
                <button type="button" onClick={() => rotatePreview(1)} className="kalpa-preview-btn-text" title="Rotate right (R)"><RotateCw className="w-3.5 h-3.5" /> Rotate</button>
                <button type="button" onClick={resetPreviewView} className="kalpa-preview-btn" title="Reset view (Ctrl 0)"><RefreshCcw className="w-4 h-4" /></button>
                <span className="kalpa-preview-separator hidden lg:inline-flex" />
                <span className="kalpa-preview-page-pill hidden md:inline-flex">1 / 1</span>
                {filePreview.url && !filePreview.loading && !filePreview.error && <button type="button" onClick={() => window.open(filePreview.url, '_blank', 'noopener,noreferrer')} className="kalpa-preview-btn-text hidden sm:inline-flex" title="Open in new tab"><Maximize2 className="w-3.5 h-3.5" /> Open</button>}
                <button type="button" onClick={() => handleTrackedDownload(filePreview.doc)} className="kalpa-preview-btn-text text-indigo-700" title="Download"><Download className="w-3.5 h-3.5" /> Download</button>
                <button type="button" onClick={closeFilePreview} className="kalpa-preview-close" title="Close (Esc)"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="kalpa-preview-stage flex-1 bg-slate-950 min-h-0 overflow-hidden">
              {filePreview.loading ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-slate-300">
                  <div className="w-12 h-12 rounded-full border-4 border-slate-700 border-t-indigo-400 animate-spin" />
                  <p className="text-sm font-black">Preparing preview...</p>
                </div>
              ) : filePreview.error ? (
                <div className="w-full h-full flex items-center justify-center p-6 bg-slate-100">
                  <div className="max-w-xl w-full bg-white rounded-3xl border border-rose-100 shadow-sm p-6 text-center">
                    <AlertCircle className="w-10 h-10 mx-auto text-rose-500 mb-3" />
                    <h4 className="font-black text-slate-900 text-lg">Preview could not open</h4>
                    <p className="text-sm font-semibold text-slate-500 mt-2 break-words">{filePreview.error}</p>
                    <div className="mt-5 flex flex-col sm:flex-row justify-center gap-2">
                      {filePreview.url && <button type="button" onClick={() => window.open(filePreview.url, '_blank', 'noopener,noreferrer')} className="text-xs font-black text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-4 py-2 rounded-xl">Try browser preview</button>}
                      <button type="button" onClick={() => handleTrackedDownload(filePreview.doc)} className="text-xs font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-4 py-2 rounded-xl">Download file</button>
                    </div>
                  </div>
                </div>
              ) : filePreview.kind === 'image' ? (
                <div className="kalpa-preview-image-stage">
                  <img
                    src={filePreview.url}
                    alt={filePreview.name || 'Image Preview'}
                    style={{ transform: `scale(${filePreviewUi.zoom}) rotate(${filePreviewUi.rotation}deg)`, transition: 'transform 160ms ease' }}
                    className="kalpa-preview-image"
                  />
                </div>
              ) : (
                <div className="kalpa-preview-pdf-stage" style={{ transform: `rotate(${filePreviewUi.rotation}deg)`, transition: 'transform 160ms ease' }}>
                  <div
                    className="kalpa-preview-pdf-zoom-surface"
                    style={{
                      width: `${100 / previewZoomValue}%`,
                      height: `${100 / previewZoomValue}%`,
                      transform: `scale(${previewZoomValue})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    <iframe
                      key={`${filePreview.name || ''}-${filePreviewUi.fitMode}-${filePreviewUi.rotation}`}
                      title={filePreview.name || 'PDF Preview'}
                      src={previewFrameSrc}
                      className="kalpa-preview-pdf-frame"
                      style={previewPdfFrameStyle}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </PortalLayer>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 bg-white p-5 rounded-3xl border-2 border-slate-100 shadow-sm">
        <div className="flex items-center space-x-5">
          <button type="button" onClick={onBack} className="p-3 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors flex-shrink-0 border border-slate-200">
            <ArrowLeft className="w-6 h-6 text-slate-700" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-2xl font-black text-slate-800 tracking-tight">{project.id}</h1>
              <Badge colorClass={getStatusColor(project.status)}>{project.status}</Badge>
              <Badge colorClass={getPriorityColor(project.priority, project.dueDate)}>{project.priority}</Badge>
            </div>
            <p className="text-sm font-semibold text-slate-500 flex items-center">
              <Building2 className="w-4 h-4 mr-1.5 opacity-70"/> {getCustomerDisplayName(project)} • {project.location}
            </p>
            {project.draftingStartedAt && <p className={`text-xs font-bold mt-1 flex items-center ${project.status === 'Drafting Paused' ? 'text-amber-600' : 'text-indigo-600'}`}><Clock className="w-3.5 h-3.5 mr-1" /> {project.status === 'Drafting Paused' ? 'Drafting paused at' : 'Drafting elapsed'}: {getDraftElapsed(project)}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          
          <button id="client-link-btn" type="button" onClick={copyClientLink} className={`px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all flex items-center font-bold text-sm whitespace-nowrap`}>
             <LinkIcon className="w-4 h-4 mr-1.5" /> Client Link
          </button>

          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('kalpa:discuss-task', { detail: { projectId: project.id || project.caseId || '', project } }))} className="px-4 py-2.5 bg-indigo-50 text-indigo-700 rounded-xl hover:bg-indigo-100 transition-all flex items-center font-bold text-sm whitespace-nowrap border border-indigo-100" title="Open team group chat with this task linked">
             <MessageSquare className="w-4 h-4 mr-1.5" /> Task Discussion
          </button>
          
          <button type="button" onClick={shareCompletedFileOnWhatsApp} disabled={!isFinalApproved || completedDocsCount === 0} className={`px-4 py-2.5 rounded-xl transition-all flex items-center font-bold text-sm whitespace-nowrap ${isFinalApproved && completedDocsCount > 0 ? 'bg-green-500 text-white hover:bg-green-600 shadow-md shadow-green-100' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`} title={!isFinalApproved ? 'Final file can be shared only after internal review approval' : 'Share approved final file'}>
             <Send className="w-4 h-4 mr-1.5" /> Share PDF on WhatsApp
          </button>

          {canApproveFinal && (
            <button type="button" onClick={handleApproveFinal} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all flex items-center font-bold text-sm whitespace-nowrap">
              <CheckCircle className="w-4 h-4 mr-2" /> Approve Final
            </button>
          )}
          
          {canManage && (
             <button type="button" onClick={() => setShowEditCase(true)} className="px-4 py-2.5 bg-indigo-50 text-indigo-700 rounded-xl hover:bg-indigo-100 transition-all flex items-center font-bold text-sm whitespace-nowrap border border-indigo-100">
               <Edit3 className="w-4 h-4 mr-1.5" /> Edit Case
             </button>
          )}

          {canManage && (
             showDeleteConfirm ? (
                <div className="flex items-center gap-2 bg-red-50 p-1.5 rounded-xl border border-red-200 animate-in slide-in-from-right-4">
                   <span className="text-xs text-red-600 font-bold ml-2">Delete permanently?</span>
                   <button onClick={() => onDeleteTask(project.id)} className="bg-red-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-red-700 transition-colors">Yes</button>
                   <button onClick={() => setShowDeleteConfirm(false)} className="bg-white text-slate-700 border border-slate-200 px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors">No</button>
                </div>
             ) : (
                <button type="button" onClick={() => setShowDeleteConfirm(true)} className="px-4 py-2.5 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-all flex items-center font-bold text-sm whitespace-nowrap">
                   <X className="w-4 h-4 mr-1.5" /> Delete
                </button>
             )
          )}
          
          {canRevertTask && (
              <button type="button" onClick={handleRevertStatus} className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all flex items-center font-bold text-sm whitespace-nowrap" title={canDesignerRevertOwnTask ? 'Revert your own task to the previous workflow stage' : 'Revert task to the previous workflow stage'}>
                  <ArrowLeft className="w-4 h-4 mr-1.5" /> Revert
              </button>
          )}

          {project.status === 'Drafting' && isAssignedToMe && (
             <button type="button" onClick={handlePauseDrafting} className="px-4 py-2.5 bg-amber-50 text-amber-700 border border-amber-100 rounded-xl hover:bg-amber-100 transition-all flex items-center font-bold text-sm whitespace-nowrap">
               <Clock className="w-4 h-4 mr-2" /> Pause Drafting
             </button>
          )}

          {project.status !== 'Completed' && !canApproveFinal && (isAssignedToMe || canManage) && (
             <button type="button" onClick={handleAdvanceStatus} disabled={project.status === 'Internal Review' && !canManage} className={`px-5 py-2.5 rounded-xl shadow-lg transition-all flex items-center font-bold text-sm whitespace-nowrap ${project.status === 'Internal Review' && !canManage ? 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none' : 'bg-indigo-600 text-white shadow-indigo-200 hover:bg-indigo-700'}`}>
               <CheckCircle className="w-4 h-4 mr-2" />
               {advanceLabel}
             </button>
          )}
        </div>
      </div>

      {showEditCase && canManage && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto" style={{ zIndex: 9999 }}>
          <div className="max-w-4xl mx-auto my-6 bg-white rounded-[2rem] shadow-2xl border border-slate-100 p-6 sm:p-8 relative" style={{ zIndex: 10000 }}>
            <div className="flex items-center justify-between gap-4 mb-6 pb-5 border-b border-slate-100">
              <div>
                <h2 className="text-2xl font-black text-slate-900">Edit Case</h2>
                <p className="text-sm font-bold text-slate-400 mt-1">Update scope, details, assignment, or estimate when customer requirements change.</p>
              </div>
              <button type="button" onClick={() => setShowEditCase(false)} className="p-2.5 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveCaseEdit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Bank Name</label><input name="client" defaultValue={project.client || ''} className="w-full border-2 border-slate-100 rounded-xl p-3 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold" /></div>
                <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Customer Name</label><input name="customerName" defaultValue={project.customerName || ''} className="w-full border-2 border-slate-100 rounded-xl p-3 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold" /></div>
                <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Location</label><input name="location" defaultValue={project.location || ''} className="w-full border-2 border-slate-100 rounded-xl p-3 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold" /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Case Type / Scope</label><select name="type" defaultValue={TASK_CATEGORIES.includes(project.type) ? project.type : 'Other'} className="w-full border-2 border-slate-100 rounded-xl p-3 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold">{TASK_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Other Scope</label><input name="otherType" defaultValue={TASK_CATEGORIES.includes(project.type) ? '' : project.type} placeholder="Only if Other" className="w-full border-2 border-slate-100 rounded-xl p-3 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold" /></div>
                <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Assign To</label><select name="assignedTo" defaultValue={project.assignedTo || 'Unassigned'} className="w-full border-2 border-slate-100 rounded-xl p-3 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold"><option value="Unassigned">Unassigned</option>{getAssignmentRecommendations(users, [project]).map(u => <option key={u.id} value={u.name}>{u.name}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Priority</label><select name="priority" defaultValue={project.priority || 'Normal'} className="w-full border-2 border-slate-100 rounded-xl p-3 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold"><option>Normal</option><option>Urgent</option><option>High</option><option>Low</option></select></div>
                <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Due Date</label><input type="date" name="dueDate" defaultValue={project.dueDate || ''} className="w-full border-2 border-slate-100 rounded-xl p-3 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold" /></div>
                <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Estimate Amount</label><input name="estimate" defaultValue={project.estimate || ''} className="w-full border-2 border-slate-100 rounded-xl p-3 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold" /></div>
              </div>
              <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Estimate Details</label><input name="estimateDetails" defaultValue={project.estimateDetails || ''} className="w-full border-2 border-slate-100 rounded-xl p-3 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold" /></div>
              <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Description</label><textarea name="description" defaultValue={project.description || ''} rows={4} className="w-full border-2 border-slate-100 rounded-xl p-3 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold resize-none" /></div>
              <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Change Reason / Internal Remark</label><textarea name="changeReason" rows={2} placeholder="Example: Customer cancelled map estimate, continue with key plan only." className="w-full border-2 border-indigo-100 rounded-xl p-3 bg-indigo-50/50 focus:bg-white focus:border-indigo-500 outline-none font-bold resize-none" /></div>
              <div className="flex flex-col sm:flex-row justify-end gap-3 pt-3">
                <button type="button" onClick={() => setShowEditCase(false)} className="px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black">Cancel</button>
                <button type="submit" className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black shadow-lg shadow-indigo-100 flex items-center justify-center"><Save className="w-4 h-4 mr-2" /> Save Case Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {(isAwaitingInternalReview || isFinalApproved) && (
        <div className={`rounded-3xl border-2 p-5 shadow-sm ${isFinalApproved ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className={`text-xs font-black uppercase tracking-widest mb-1 ${isFinalApproved ? 'text-emerald-700' : 'text-amber-700'}`}>Internal Review</p>
              <h2 className="text-xl font-black text-slate-900">{isFinalApproved ? 'Final Conclusion: Approved' : 'Completed file submitted for internal review'}</h2>
              <p className="text-sm font-semibold text-slate-600 mt-1">
                {isFinalApproved
                  ? `Checked and approved by ${project.approvedBy || project.reviewedBy || project.completedBy || '-'}${project.approvedAt ? ` on ${formatDateTime(project.approvedAt)}` : ''}.`
                  : 'Admin/Manager should check the uploaded work file. If revision is needed, use Revert; if correct, approve the final conclusion.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isAwaitingInternalReview && <Badge colorClass="bg-amber-100 text-amber-700 border-amber-200">Pending Review</Badge>}
              {isFinalApproved && <Badge colorClass="bg-emerald-100 text-emerald-700 border-emerald-200">Approved</Badge>}
              {completedDocsCount > 0 && <Badge colorClass="bg-indigo-100 text-indigo-700 border-indigo-200">{completedDocsCount} File{completedDocsCount > 1 ? 's' : ''}</Badge>}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-7 rounded-3xl shadow-sm border-2 border-slate-100">
            <h2 className="text-xl font-extrabold mb-5 text-slate-800 flex items-center"><FileText className="w-5 h-5 mr-2 text-indigo-500"/> Project Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8 bg-slate-50 p-6 rounded-2xl border border-slate-100">
              <div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Task Type</p><p className="font-bold text-slate-800 text-lg">{project.type}</p></div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Created By</p>
                <p className="font-bold text-slate-800 text-lg">{project.createdBy || 'System'} <span className="text-xs font-semibold text-slate-500 block">{project.createdAt ? new Date(project.createdAt).toLocaleString() : '-'}</span></p>
              </div>
              
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Assigned To</p>
                {canManage ? (
                  <div className="space-y-2">
                    <select
                      value={project.assignedTo}
                      onChange={(e) => {
                        const newVal = e.target.value;
                        const newTimeline = [...(project.timeline||[]), { id: Date.now(), text: `Task re-assigned to ${newVal} by ${user.name}`, time: new Date().toLocaleString() }];
                        const reassignmentHistory = [...(project.reassignmentHistory || []), { from: project.assignedTo || 'Unassigned', to: newVal, by: user.name, time: new Date().toLocaleString() }];
                        onUpdateProject({...project, assignedTo: newVal, assignedBy: user.name, assignedAt: Date.now(), assignmentVersion: Date.now(), reassignmentHistory, timeline: newTimeline}, project);
                      }}
                      className="w-full font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                    >
                      <option value="Unassigned">Unassigned</option>
                      {getAssignmentRecommendations(users, [project]).map(u => (
                        <option key={u.id} value={u.name}>{u.name} • {u.active}/{u.limit} active</option>
                      ))}
                    </select>
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-2">Smart Recommendations</p>
                      {getAssignmentRecommendations(users, [project]).slice(0,3).map((u, idx) => (
                        <button type="button" key={u.id} onClick={() => {
                          const newTimeline = [...(project.timeline||[]), { id: Date.now(), text: `Smart assigned to ${u.name} by ${user.name}`, time: new Date().toLocaleString() }];
                          const reassignmentHistory = [...(project.reassignmentHistory || []), { from: project.assignedTo || 'Unassigned', to: u.name, by: user.name, time: new Date().toLocaleString() }];
                          onUpdateProject({...project, assignedTo: u.name, assignedBy: user.name, assignedAt: Date.now(), assignmentVersion: Date.now(), reassignmentHistory, timeline: newTimeline}, project);
                        }} className="w-full text-left flex justify-between items-center bg-white hover:bg-indigo-100 rounded-lg px-3 py-2 mb-1 border border-indigo-100 transition-colors">
                          <span className="text-xs font-extrabold text-slate-700">{idx + 1}. {u.name}</span>
                          <span className={`text-[10px] font-black px-2 py-1 rounded-md ${u.active >= u.limit ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>{u.active}/{u.limit}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="font-bold text-slate-800 text-lg">{project.assignedTo}</p>
                )}
              </div>

              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Due Date</p>
                <p className={`font-bold text-lg ${project.dueDate && new Date(project.dueDate).getTime() < Date.now() ? 'text-red-600' : 'text-slate-800'}`}>
                  {project.dueDate ? new Date(project.dueDate).toLocaleDateString() : 'No Due Date'}
                </p>
              </div>

              {getTaskDescription(project) && (
                <div className="col-span-1 sm:col-span-2 mt-2 p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                  <p className="text-xs font-black text-indigo-500 uppercase tracking-widest mb-2">Task Description / Special Instructions</p>
                  <p className="text-sm text-slate-700 font-semibold whitespace-pre-wrap leading-relaxed">{getTaskDescription(project)}</p>
                </div>
              )}

              {getEstimateDetails(project) && (
                <div className="col-span-1 sm:col-span-2 mt-2 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                  <p className="text-xs font-black text-amber-600 uppercase tracking-widest mb-2">Estimate Details</p>
                  <p className="text-sm text-amber-800 font-semibold whitespace-pre-wrap leading-relaxed">{getEstimateDetails(project)}</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-sm border-2 border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-extrabold text-slate-800 flex items-center"><Clock className="w-5 h-5 mr-2 text-indigo-500"/> SLA Tracking</h2>
              <Badge colorClass={getSlaInfo(project).colorClass}>{getSlaInfo(project).label}</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Turnaround</p><p className="text-xl font-black text-slate-800 mt-1">{getSlaInfo(project).total}</p></div>
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4"><p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Drafting Time</p><p className="text-xl font-black text-blue-800 mt-1">{getSlaInfo(project).drafting}</p></div>
              <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4"><p className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Review Time</p><p className="text-xl font-black text-purple-800 mt-1">{getSlaInfo(project).review}</p></div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              {[['Lead', project.createdAt], ['Assigned', project.assignedAt], ['Draft Started', project.draftingStartedAt], ['Submitted', project.submittedAt], ['Completed', project.completedAt]].map(([label, time]) => (
                <div key={label} className={`rounded-xl p-3 border ${time ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                  <p className="font-black uppercase tracking-widest text-[9px]">{label}</p>
                  <p className="font-bold mt-1">{time ? new Date(time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Pending'}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-7 rounded-3xl shadow-sm border-2 border-slate-100">
             <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                <h2 className="text-xl font-extrabold text-slate-800 flex items-center"><Paperclip className="w-5 h-5 mr-2 text-indigo-500"/> Documents & Files</h2>
                {canManage && (
                  <div className="w-full sm:w-auto">
                    <label className={`text-sm font-bold flex items-center justify-center cursor-pointer px-4 py-2 rounded-xl transition-colors border ${isCurrentTransferForType('source', 'uploading') ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-wait' : 'bg-indigo-50 text-indigo-700 hover:text-indigo-800 border-indigo-100'}`}>
                       <Plus className="w-4 h-4 mr-1.5" /> {isCurrentTransferForType('source', 'uploading') ? 'Uploading Source...' : 'Add Source File'}
                       <input type="file" multiple className="hidden" disabled={isCurrentTransferForType('source', 'uploading')} onChange={(e) => handleFileUpload('source', e)} />
                    </label>
                    {isCurrentTransferForType('source') && renderInlineFileTransferBar('sm:w-[380px]')}
                  </div>
                )}
             </div>
             <div className="mb-5 bg-slate-50 border border-slate-100 rounded-2xl p-4">
               <div className="flex justify-between items-center mb-3">
                 <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Document readiness</p>
                 <p className="text-sm font-black text-indigo-700">{getDocumentReadiness(project).score}%</p>
               </div>
               <div className="w-full h-2 bg-white rounded-full overflow-hidden border border-slate-100 mb-3"><div className="h-full bg-indigo-600" style={{ width: `${getDocumentReadiness(project).score}%` }}></div></div>
               <div className="grid grid-cols-2 gap-2">
                 {getDocumentReadiness(project).items.map(item => (
                   <span key={item.label} className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${item.done ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-white text-slate-400 border-slate-100'}`}>{item.done ? '✓' : '○'} {item.label}</span>
                 ))}
               </div>
             </div>
             
             <div className="space-y-4">
               <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest bg-slate-50 py-2 px-3 rounded-lg inline-block">Source Files (From Bank)</h3>
               {(project.documents||[]).filter(d => d.type === 'source').map((doc, idx) => (
                 <div key={idx} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-indigo-200 transition-colors">
                   <div className="flex items-center justify-between">
                   <div className="flex items-center text-slate-700 overflow-hidden pr-2">
                     <div className="p-2 bg-white rounded-lg shadow-sm border border-slate-100">{getFileIcon(doc.name)}</div>
                     <span className="font-bold ml-4 truncate">{doc.name}</span>
                   </div>
                   {renderFileActionButtons(doc, "text-xs font-bold text-indigo-600 bg-white border border-slate-200 hover:bg-indigo-50 px-4 py-2 rounded-xl whitespace-nowrap transition-colors shadow-sm")}
                   </div>
                   {isCurrentTransferForDoc(doc) && renderInlineFileTransferBar()}
                 </div>
               ))}
               
               <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-8 mb-4 border-t-2 border-slate-100 pt-6">
                  <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest bg-blue-50 py-2 px-3 rounded-lg inline-block">Working Files & Drafts</h3>
                  <div className="w-full sm:w-auto">
                    <label className={`text-xs font-bold flex items-center justify-center cursor-pointer px-3 py-1.5 rounded-lg transition-colors border ${isCurrentTransferForType('working', 'uploading') ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-wait' : 'bg-blue-50 text-blue-600 hover:text-blue-800 border-blue-100'}`}>
                      <Plus className="w-3 h-3 mr-1" /> {isCurrentTransferForType('working', 'uploading') ? 'Uploading Work File...' : 'Upload Work File'}
                      <input type="file" multiple className="hidden" disabled={isCurrentTransferForType('working', 'uploading')} accept=".jpg,.jpeg,.png,.mp4,.mov,.avi,.mkv,.webm,.pdf,.dwg,.dxf,.xls,.xlsx,.doc,.docx" onChange={(e) => handleFileUpload('working', e)} />
                    </label>
                    {isCurrentTransferForType('working') && renderInlineFileTransferBar('sm:w-[380px]')}
                  </div>
               </div>
               {(project.documents||[]).filter(d => d.type === 'working').length === 0 && <p className="text-sm text-slate-500 font-medium italic px-2">No working files uploaded yet.</p>}
               {(project.documents||[]).filter(d => d.type === 'working').map((doc, idx) => (
                 <div key={idx} className="p-3.5 bg-blue-50/50 rounded-2xl border border-blue-100 group hover:border-blue-200 transition-colors">
                   <div className="flex items-center justify-between">
                   <div className="flex items-center text-blue-900 overflow-hidden pr-2">
                     <div className="p-2 bg-white rounded-lg shadow-sm border border-blue-100">{getFileIcon(doc.name)}</div>
                     <span className="font-bold ml-4 truncate">{doc.name}</span>
                     <span className="text-[11px] font-bold ml-3 text-blue-600 bg-blue-100 px-2 py-1 rounded-lg whitespace-nowrap hidden sm:inline-block border border-blue-200">by {doc.uploadedBy}</span>
                   </div>
                   {renderFileActionButtons(doc, "text-xs font-bold text-blue-700 bg-white hover:bg-blue-50 shadow-sm border border-blue-200 px-4 py-2 rounded-xl whitespace-nowrap transition-colors")}
                   </div>
                   {isCurrentTransferForDoc(doc) && renderInlineFileTransferBar()}
                 </div>
               ))}

               <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest bg-emerald-50 py-2 px-3 rounded-lg inline-block mt-8 border-t-2 border-slate-100 pt-6 w-full max-w-fit">Completed Work (AutoCAD/PDF)</h3>
               {completedDocs.length === 0 && <p className="text-sm text-slate-500 font-medium italic px-2">No completed files yet.</p>}
               {completedDocs.map((doc, idx) => (
                 <div key={idx} className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-100 group">
                   <div className="flex items-center justify-between">
                   <div className="flex items-center text-emerald-900 overflow-hidden pr-2">
                     <div className="p-2 bg-white rounded-lg shadow-sm border border-emerald-100">
                        {doc.name.includes('QR') ? <ImageIcon className="w-5 h-5 text-emerald-600" /> : getFileIcon(doc.name)}
                     </div>
                     <span className="font-bold ml-4 truncate">{doc.name}</span>
                     <span className="text-[10px] font-black ml-3 text-emerald-700 bg-white px-2 py-1 rounded-lg border border-emerald-100">V{idx + 1}</span>
                     <span className="text-[11px] font-bold ml-3 text-emerald-600 bg-emerald-100 px-2 py-1 rounded-lg whitespace-nowrap hidden sm:inline-block border border-emerald-200">by {doc.uploadedBy}</span>
                   </div>
                   {renderFileActionButtons(doc, "text-xs font-bold text-emerald-700 bg-white hover:bg-emerald-50 shadow-sm border border-emerald-200 px-4 py-2 rounded-xl whitespace-nowrap transition-colors")}
                   </div>
                   {isCurrentTransferForDoc(doc) && renderInlineFileTransferBar()}
                 </div>
               ))}

               {latestRevisedCompletedDocs.length > 0 && (
                 <div className="mt-6 p-4 bg-purple-50/70 border-2 border-purple-100 rounded-2xl">
                   <h3 className="text-xs font-extrabold text-purple-700 uppercase tracking-widest mb-3 flex items-center"><CheckCircle className="w-4 h-4 mr-2" /> Revised Completed File - Latest</h3>
                   <p className="text-xs font-bold text-purple-500 mb-3">These are the latest completed files submitted after revision. Use these for review/approval instead of older completed versions.</p>
                   <div className="space-y-2">
                     {latestRevisedCompletedDocs.map((doc, idx) => (
                       <div key={doc.id || idx} className="p-3 bg-white rounded-xl border border-purple-100">
                         <div className="flex items-center justify-between">
                         <div className="flex items-center min-w-0 pr-2 text-purple-900">
                           <div className="p-2 bg-purple-50 rounded-lg border border-purple-100">{getFileIcon(doc.name)}</div>
                           <div className="ml-3 min-w-0">
                             <p className="font-black truncate">{doc.name}</p>
                             <p className="text-[11px] font-bold text-purple-500">Latest revision upload • by {doc.uploadedBy || 'Team'}</p>
                           </div>
                         </div>
                         {renderFileActionButtons(doc, "text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-100 px-4 py-2 rounded-xl whitespace-nowrap transition-colors")}
                         </div>
                         {isCurrentTransferForDoc(doc) && renderInlineFileTransferBar()}
                       </div>
                     ))}
                   </div>
                 </div>
               )}
             </div>
          </div>

          {(revisionTimelineItems.length > 0 || project.status === 'Completed') && (
            <div className="bg-white p-7 rounded-3xl shadow-sm border-2 border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-800 flex items-center">
                    <Clock className="w-5 h-5 mr-2 text-purple-500" /> Revision Timeline
                  </h2>
                  <p className="text-xs font-bold text-slate-400 mt-1">Permanent task ID stays unchanged. Revision items are linked history only.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="bg-purple-50 text-purple-700 border border-purple-100 px-3 py-1.5 rounded-xl text-xs font-black">{revisionTimelineItems.length} Total</span>
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-3 py-1.5 rounded-xl text-xs font-black">{completedRevisionItems} Completed</span>
                  <span className="bg-red-50 text-red-700 border border-red-100 px-3 py-1.5 rounded-xl text-xs font-black">{activeRevisionItems} Active</span>
                </div>
              </div>
              {revisionTimelineItems.length === 0 ? (
                <p className="text-sm text-slate-500 font-medium italic px-2">No revision history yet.</p>
              ) : (
                <div className="relative pl-4 border-l-2 border-purple-100 space-y-4">
                  {revisionTimelineItems.map((item, idx) => (
                    <div key={item.id || idx} className="relative bg-purple-50/50 border border-purple-100 rounded-2xl p-4">
                      <span className={`absolute -left-[25px] top-5 w-4 h-4 rounded-full border-4 border-white ${isRevisionTimelineItemCompleted(item) ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-widest text-purple-600">{item.label} • {item.action}</p>
                          <p className="font-black text-slate-800 mt-1 break-words">{item.title}</p>
                          <p className="text-xs font-bold text-slate-500 mt-1">{item.by ? `By ${item.by} • ` : ''}{item.at ? new Date(item.at).toLocaleString() : ''}</p>
                          {item.workItemId && <p className="text-[10px] font-bold text-purple-500 mt-1">Linked work item: {item.workItemId}</p>}
                        </div>
                        <span className={`px-3 py-1.5 rounded-xl text-xs font-black border whitespace-nowrap ${isRevisionTimelineItemCompleted(item) ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>{item.status || 'Pending'}</span>
                      </div>
                      {Array.isArray(item.files) && item.files.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.files.slice(0, 4).map((file, fileIdx) => (
                            <span key={file.id || file.name || fileIdx} className="text-[11px] font-bold bg-white text-purple-700 border border-purple-100 px-2.5 py-1.5 rounded-lg max-w-full truncate">📄 {file.name || 'Revision file'}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="bg-white p-7 rounded-3xl shadow-sm border-2 border-slate-100">
            <h2 className="text-xl font-extrabold text-slate-800 mb-5 flex items-center">
              <List className="w-5 h-5 mr-2 text-red-500" /> Revisions & Sub-tasks
            </h2>
            <div className="space-y-3 mb-5 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
              {(project.subTasks||[]).length === 0 ? (
                <p className="text-sm text-slate-500 font-medium italic px-2">No active revisions.</p>
              ) : (
                project.subTasks.map((st, idx) => (
                  <div key={st.id || idx} className="flex items-start p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <button type="button" onClick={() => toggleSubTask(st.id)} className={`mt-0.5 mr-4 rounded-full flex-shrink-0 transition-transform hover:scale-110 ${st.status === 'Done' ? 'text-emerald-500' : 'text-slate-300 hover:text-slate-400'}`}>
                      <CheckCircle className="w-6 h-6" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`font-bold text-base break-words ${st.status === 'Done' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{st.title}</p>
                      <p className="text-xs font-semibold text-slate-400 mt-1">Added by {st.addedBy}</p>
                      {renderInlineAttachments(st.attachments || [])}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
              <div className="flex-1">
                <textarea rows={3} value={newSubTask} onChange={(e) => setNewSubTask(e.target.value)} placeholder="Describe the revision... Enter creates a new line. Use Add Task to send." className="w-full border-2 border-slate-100 rounded-xl px-4 py-3 font-medium focus:border-indigo-500 focus:ring-0 outline-none transition-colors resize-none" />
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <label className="inline-flex items-center cursor-pointer text-xs font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-2 rounded-xl border border-indigo-100 transition-colors">
                    <Paperclip className="w-3.5 h-3.5 mr-1.5" /> {isUploadingRevisionAttachment ? 'Uploading...' : 'Attach Files'}
                    <input type="file" multiple className="hidden" onChange={handleRevisionAttachmentUpload} />
                  </label>
                  <span className="text-[11px] font-bold text-slate-400">No upload limit. Add screenshots, PDFs, DWG, images, videos, Word or Excel files.</span>
                </div>
                {isCurrentTransferForType('revision') && renderInlineFileTransferBar('mb-3')}
                {subTaskAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {subTaskAttachments.map((doc, idx) => (
                      <span key={doc.id || idx} className="inline-flex items-center max-w-full text-xs font-bold text-slate-700 bg-white border border-slate-200 px-2.5 py-1.5 rounded-lg">
                        <Paperclip className="w-3 h-3 mr-1" /><span className="truncate max-w-[160px]">{doc.name}</span>
                        <button type="button" onClick={() => removePendingAttachment('revision', doc.id || idx)} className="ml-2 text-red-500 hover:text-red-700"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" onClick={(e) => { e.preventDefault(); handleAddSubTask(); }} className="px-6 py-3 bg-slate-800 text-white rounded-xl shadow-md hover:bg-slate-700 font-bold whitespace-nowrap transition-colors flex items-center justify-center"><Send className="w-4 h-4 mr-2" /> Add Task</button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {(isAssignedToMe || canManage) && (project.status !== 'Completed' || getCompletedDocuments(project).length === 0) && (
            <div className="bg-gradient-to-b from-indigo-50 to-white p-1 rounded-3xl shadow-sm border border-indigo-100">
              <div className="bg-white p-6 rounded-[1.4rem]">
                <h2 className="text-lg font-extrabold mb-4 text-slate-800">Submit Work</h2>
                {isCurrentTransferForType('completed') && renderInlineFileTransferBar('mb-4')}
                <button type="button" disabled={isUploadingFinal} onClick={() => completedFileInputRef.current?.click()} className="w-full border-2 border-dashed border-indigo-200 rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:bg-indigo-50 transition-colors cursor-pointer bg-slate-50/50 disabled:opacity-70 disabled:cursor-wait">
                  <div className="bg-indigo-100 p-4 rounded-2xl mb-4 shadow-sm"><Upload className="w-8 h-8 text-indigo-600" /></div>
                  <p className="font-bold text-slate-700 mb-1 text-lg">{isUploadingFinal ? 'Uploading...' : 'Upload Final File'}</p>
                  <p className="text-xs font-medium text-slate-500">PDF, AutoCAD, image, Word or Excel format</p>
                </button>
                <input ref={completedFileInputRef} type="file" multiple className="hidden" accept=".pdf,.dwg,.dxf,.jpg,.jpeg,.png,.mp4,.mov,.avi,.mkv,.webm,.xls,.xlsx,.csv,.doc,.docx" onChange={(e) => handleFileUpload('completed', e)} />
              </div>
            </div>
          )}

          {showFinancials && (
            <div className="bg-amber-50 p-6 rounded-3xl shadow-sm border-2 border-amber-200 relative overflow-hidden">
              <div className="absolute right-0 top-0 w-32 h-32 bg-amber-100 rounded-full blur-3xl opacity-50 -z-0"></div>
              <div className="flex justify-between items-center mb-5 relative z-10">
                 <h2 className="text-lg font-extrabold text-amber-900 flex items-center"><Wallet className="w-5 h-5 mr-2" /> Payment Ledger</h2>
                 <button onClick={handlePrintReceipt} className="text-xs font-bold text-amber-700 bg-white border border-amber-200 px-3 py-1.5 rounded-lg hover:bg-amber-100 shadow-sm transition-colors">Print Receipt</button>
              </div>
              
              <div className="space-y-4 text-sm relative z-10">
                <div><label className="text-amber-800 block mb-1.5 text-xs font-black uppercase tracking-widest">Total Estimate Amount</label><input type="number" value={project.estimate || ''} onChange={e => onUpdateProject({...project, estimate: e.target.value}, project)} className="w-full border-2 border-amber-100 p-2.5 rounded-xl bg-white font-bold outline-none focus:border-amber-400" /></div>
                
                <div className="grid grid-cols-2 gap-3">
                   <div><label className="text-amber-800 block mb-1.5 text-xs font-black uppercase tracking-widest">Amount Received</label><input type="number" value={project.ledger?.amountIn || ''} onChange={e => updateLedger('amountIn', e.target.value)} className="w-full border-2 border-emerald-100 p-2.5 rounded-xl bg-white font-bold text-emerald-700 outline-none focus:border-emerald-400" /></div>
                   <div><label className="text-amber-800 block mb-1.5 text-xs font-black uppercase tracking-widest">Actual Expenses</label><input type="number" value={project.ledger?.expenses || ''} onChange={e => updateLedger('expenses', e.target.value)} className="w-full border-2 border-amber-100 p-2.5 rounded-xl bg-white font-bold text-amber-700 outline-none focus:border-amber-400" placeholder="e.g. print cost" /></div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                   <div><label className="text-amber-800 block mb-1.5 text-xs font-black uppercase tracking-widest">Date Paid</label><input type="date" value={project.ledger?.date || ''} onChange={e => updateLedger('date', e.target.value)} className="w-full border-2 border-amber-100 p-2.5 rounded-xl bg-white font-bold outline-none focus:border-amber-400" /></div>
                   <div><label className="text-amber-800 block mb-1.5 text-xs font-black uppercase tracking-widest">Refund</label><input type="number" value={project.ledger?.refund || ''} onChange={e => updateLedger('refund', e.target.value)} className="w-full border-2 border-red-100 p-2.5 rounded-xl bg-white font-bold text-red-600 outline-none focus:border-red-400" /></div>
                </div>
                
                <div><label className="text-amber-800 block mb-1.5 text-xs font-black uppercase tracking-widest">Received From</label><input type="text" value={project.ledger?.receivedFrom || ''} onChange={e => updateLedger('receivedFrom', e.target.value)} placeholder="Sender Name" className="w-full border-2 border-amber-100 p-2.5 rounded-xl bg-white font-bold outline-none focus:border-amber-400" /></div>
                <div><label className="text-amber-800 block mb-1.5 text-xs font-black uppercase tracking-widest">Transaction ID</label><input type="text" value={project.ledger?.txnId || ''} onChange={e => updateLedger('txnId', e.target.value)} className="w-full border-2 border-amber-100 p-2.5 rounded-xl bg-white font-bold outline-none focus:border-amber-400" /></div>
                
                <div className="col-span-2 mt-2 border-t-2 border-amber-100 pt-4">
                  <label className="text-amber-800 block mb-3 text-xs font-black uppercase tracking-widest">Payment Screenshot (Optional)</label>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <label className="cursor-pointer bg-white px-5 py-3 border-2 border-amber-200 text-amber-700 font-bold rounded-xl hover:bg-amber-100 transition-colors shadow-sm w-full sm:w-auto text-center flex justify-center items-center">
                      <Upload className="w-5 h-5 mr-2 inline"/> Upload Receipt
                      <input type="file" className="hidden" accept="image/*" onChange={handleLedgerScreenshot} />
                    </label>
                    {project.ledger?.screenshot && (
                      <a href={project.ledger.screenshot} target="_blank" rel="noreferrer" className="text-sm font-black text-indigo-700 hover:text-indigo-800 bg-indigo-50 px-4 py-3 rounded-xl border border-indigo-100 flex items-center transition-colors">
                         <ImageIcon className="w-4 h-4 mr-2" /> View Attached Receipt
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white p-6 rounded-3xl shadow-sm border-2 border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-extrabold text-slate-800">Team Discussion & Notes</h2>
                <p className="text-xs font-bold text-slate-400 mt-1">Local notes stay on this task. Group chat opens the team discussion with this task ID linked.</p>
              </div>
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('kalpa:discuss-task', { detail: { projectId: project.id || project.caseId || '', project } }))} className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-4 py-2 rounded-xl text-xs font-black hover:bg-indigo-100 flex items-center justify-center gap-2"><MessageSquare className="w-4 h-4" /> Discuss in Group Chat</button>
            </div>
            <div className="space-y-3 mb-5 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
              {(project.notes||[]).length === 0 && <p className="text-sm text-slate-400 font-medium italic">No discussion notes yet.</p>}
              {(project.notes||[]).map((note, idx) => (
                <div key={idx} className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                  <p className="text-sm font-semibold text-slate-700 whitespace-pre-wrap">{note.text}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-wider">{note.author} • {note.time}</p>
                  {renderInlineAttachments(note.attachments || [])}
                </div>
              ))}
            </div>
            <div className="flex items-end space-x-2">
              <div className="flex-1">
                <textarea rows={3} value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add note or comment... Enter creates a new line. Use Send to post." className="w-full border-2 border-slate-100 rounded-xl px-4 py-3 font-medium focus:border-indigo-500 outline-none transition-colors resize-none" />
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <label className="inline-flex items-center cursor-pointer text-xs font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-2 rounded-xl border border-indigo-100 transition-colors">
                    <Paperclip className="w-3.5 h-3.5 mr-1.5" /> {isUploadingNoteAttachment ? 'Uploading...' : 'Attach Files'}
                    <input type="file" multiple className="hidden" onChange={handleNoteAttachmentUpload} />
                  </label>
                  <span className="text-[11px] font-bold text-slate-400">Attach unlimited supporting screenshots/files.</span>
                </div>
                {isCurrentTransferForType('discussion') && renderInlineFileTransferBar('mb-3')}
                {noteAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {noteAttachments.map((doc, idx) => (
                      <span key={doc.id || idx} className="inline-flex items-center max-w-full text-xs font-bold text-slate-700 bg-white border border-slate-200 px-2.5 py-1.5 rounded-lg">
                        <Paperclip className="w-3 h-3 mr-1" /><span className="truncate max-w-[160px]">{doc.name}</span>
                        <button type="button" onClick={() => removePendingAttachment('discussion', doc.id || idx)} className="ml-2 text-red-500 hover:text-red-700"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" onClick={(e) => { e.preventDefault(); handleAddNote(); }} className="bg-slate-800 text-white px-5 py-3 rounded-xl hover:bg-slate-700 flex-shrink-0 shadow-sm transition-colors font-bold flex items-center"><Send className="w-4 h-4 mr-2" /> Send</button>
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-sm border-2 border-slate-100">
            <h2 className="text-lg font-extrabold mb-4 text-slate-800">Task Ownership</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <p className="bg-slate-50 p-3 rounded-xl"><span className="font-black text-slate-400 uppercase text-[10px] block">Created By</span><span className="font-bold text-slate-800">{project.createdBy || project.ownership?.createdBy || '-'}</span></p>
              <p className="bg-slate-50 p-3 rounded-xl"><span className="font-black text-slate-400 uppercase text-[10px] block">Assigned By</span><span className="font-bold text-slate-800">{project.assignedBy || project.ownership?.assignedBy || '-'}</span></p>
              <p className="bg-slate-50 p-3 rounded-xl"><span className="font-black text-slate-400 uppercase text-[10px] block">Reviewed By</span><span className="font-bold text-slate-800">{project.reviewedBy || project.ownership?.reviewedBy || '-'}</span></p>
              <p className="bg-slate-50 p-3 rounded-xl"><span className="font-black text-slate-400 uppercase text-[10px] block">Completed By</span><span className="font-bold text-slate-800">{project.completedBy || project.ownership?.completedBy || '-'}</span></p>
            </div>
            {(project.reassignmentHistory || []).length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Reassignment History</p>
                {(project.reassignmentHistory || []).map((r, idx) => <p key={idx} className="text-xs font-bold text-slate-600 bg-slate-50 rounded-lg px-3 py-2 mb-1">{r.from} → {r.to} by {r.by} • {r.time}</p>)}
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-sm border-2 border-slate-100">
            <h2 className="text-lg font-extrabold mb-4 text-slate-800">Delivery Log</h2>
            <div className="space-y-2">
              {(project.deliveryLog || []).length === 0 && <p className="text-sm text-slate-400 font-medium italic">No delivery record yet.</p>}
              {(project.deliveryLog || []).map((d, idx) => (
                <div key={idx} className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                  <p className="text-sm font-black text-emerald-800">{d.file}</p>
                  <p className="text-xs font-bold text-emerald-600 mt-1">{d.via} • {d.by} • {d.time}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-sm border-2 border-slate-100">
            <h2 className="text-lg font-extrabold mb-5 text-slate-800">Activity Timeline</h2>
            <div className="space-y-5">
              {normalizeTimeline(project.timeline, project.history).length === 0 && <p className="text-sm text-slate-400 font-medium italic">No timeline events yet.</p>}
              {normalizeTimeline(project.timeline, project.history).map((event, idx, arr) => (
                <div key={event.id || idx} className="flex group">
                  <div className="flex flex-col items-center mr-4">
                    <div className="w-3 h-3 rounded-full bg-indigo-500 mt-1 flex-shrink-0 shadow-sm shadow-indigo-200 group-hover:scale-125 transition-transform"></div>
                    {idx !== arr.length - 1 && <div className="w-0.5 h-full bg-slate-100 my-1"></div>}
                  </div>
                  <div className="pb-2">
                    <p className="text-sm font-bold text-slate-800">{event.title || event.text}</p>
                    {event.remarks && <p className="text-xs font-semibold text-slate-500 mt-0.5">{event.remarks}</p>}
                    <p className="text-xs font-semibold text-slate-400 mt-0.5">{event.by || 'System'} • {formatDateTime(event.at || event.time)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};



class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    try {
      console.error('Kalpvriksha Ops app error:', error, info);
      localStorage.setItem('kalpa_last_error', JSON.stringify({
        message: error?.message || String(error),
        stack: error?.stack || '',
        at: new Date().toISOString()
      }));
    } catch (_) {}
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-xl w-full bg-white border border-red-100 rounded-3xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-5">
              <AlertCircle className="w-9 h-9" />
            </div>
            <h1 className="text-2xl font-black text-slate-900">Something needs attention</h1>
            <p className="text-slate-500 font-semibold mt-3">The page did not load correctly, but your data is safe. Refresh the page once. If it repeats, check the saved error log.</p>
            <div className="mt-5 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-red-600 text-sm font-bold break-words">
              {this.state.error?.message || 'Unexpected application error'}
            </div>
            <button type="button" onClick={() => window.location.reload()} className="mt-6 px-6 py-3 rounded-xl bg-slate-900 text-white font-black hover:bg-slate-800 transition-colors">
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function AppShell() {
  const [currentUser, setCurrentUser] = useState(null);
  const currentUserRef = useRef(null);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isDbReady, setIsDbReady] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [dbError, setDbError] = useState(null);
  
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [notifSearch, setNotifSearch] = useState('');
  const [notifFilter, setNotifFilter] = useState('All');
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useState(() => {
    try { return localStorage.getItem('kalpa_desktop_notifications') === 'true'; } catch(e) { return false; }
  });
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [performanceRecords, setPerformanceRecords] = useState([]);
  const [performanceSummary, setPerformanceSummary] = useState(null);
  const [backendStateReady, setBackendStateReady] = useState(false);
  
  const [selectedProject, setSelectedProject] = useState(null);
  const [archiveViewState, setArchiveViewState] = useState({ filterMonth: 'All', filterDate: '', searchText: '', sortOrder: 'newest', scrollTop: 0 });
  const [taskDetailReturnTab, setTaskDetailReturnTab] = useState('board');
  const openTaskDetail = (project, returnTab = activeTab || 'board') => {
    setTaskDetailReturnTab(returnTab);
    setSelectedProject(project);
  };
  const closeTaskDetail = () => {
    setSelectedProject(null);
    if (taskDetailReturnTab) setActiveTab(taskDetailReturnTab);
  };
  const [activeTab, setActiveTab] = useState('command');
  const [boardViewMode, setBoardViewMode] = useState('list'); // 'list' or 'kanban'
  const [selectedBoardDate, setSelectedBoardDate] = useState(formatDateKey());
  const [nowTick, setNowTick] = useState(Date.now());
  // Lightweight live clock for elapsed drafting/free/break timers.
  // Keep this interval modest so multi-tab usage stays low CPU, but timers
  // still update while a designer/manager is on break.
  useEffect(() => {
    const tick = () => setNowTick(Date.now());
    tick();
    const timer = setInterval(tick, 30000);
    return () => clearInterval(timer);
  }, []);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [showNewLead, setShowNewLead] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const body = document.body;
    const html = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    if (showNewLead) {
      body.classList.add('kalpa-create-task-open');
      body.style.overflow = 'hidden';
      html.style.overflow = 'hidden';
      body.style.overscrollBehavior = 'none';
    } else {
      body.classList.remove('kalpa-create-task-open');
    }
    return () => {
      body.classList.remove('kalpa-create-task-open');
      body.style.overflow = previousBodyOverflow;
      html.style.overflow = previousHtmlOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
    };
  }, [showNewLead]);

  const [globalFilePreview, setGlobalFilePreview] = useState(null);
  const [globalFilePreviewUi, setGlobalFilePreviewUi] = useState({ zoom: 1, rotation: 0, fitMode: 'width' });

  const closeGlobalFilePreview = useCallback(() => {
    setGlobalFilePreview((current) => {
      if (current?.objectUrl) {
        try { URL.revokeObjectURL(current.objectUrl); } catch {}
      }
      return null;
    });
    setGlobalFilePreviewUi({ zoom: 1, rotation: 0, fitMode: 'width' });
  }, []);

  const openUnifiedFilePreview = useCallback(async (doc = {}) => {
    const kind = getProjectFileKind(doc);
    const name = doc.name || doc.fileName || (kind === 'image' ? 'Image Preview' : 'PDF Preview');
    if (kind === 'file' && !canPreviewProjectFile(doc)) {
      alert('Preview is available for PDF and image files only. Use Download to save this file.');
      return;
    }
    setGlobalFilePreview((current) => {
      if (current?.objectUrl) {
        try { URL.revokeObjectURL(current.objectUrl); } catch {}
      }
      return { doc, kind, name, loading: true, error: '', url: '', objectUrl: '' };
    });
    setGlobalFilePreviewUi({ zoom: 1, rotation: 0, fitMode: 'width' });
    try {
      const preview = await fetchProjectFilePreview(doc);
      setGlobalFilePreview({
        doc,
        kind: preview.kind || kind,
        name,
        loading: false,
        error: '',
        url: preview.url,
        objectUrl: preview.url,
        sourceUrl: preview.sourceUrl,
        mimeType: preview.mimeType,
        size: preview.size,
      });
    } catch (error) {
      setGlobalFilePreview({
        doc,
        kind,
        name,
        loading: false,
        error: error?.message || 'Preview could not be loaded.',
        url: '',
        objectUrl: '',
        sourceUrl: '',
      });
    }
  }, []);

  const updateGlobalPreviewZoom = useCallback((delta) => {
    setGlobalFilePreviewUi((value) => ({ ...value, zoom: Math.max(0.25, Math.min(3, Number(value.zoom || 1) + delta)), fitMode: 'custom' }));
  }, []);

  const resetGlobalPreviewView = useCallback(() => setGlobalFilePreviewUi({ zoom: 1, rotation: 0, fitMode: 'width' }), []);
  const rotateGlobalPreview = useCallback(() => setGlobalFilePreviewUi((value) => ({ ...value, rotation: ((Number(value.rotation || 0) + 90) % 360 + 360) % 360 })), []);

  useEffect(() => {
    window.__kalpaOpenFilePreview = openUnifiedFilePreview;
    return () => {
      if (window.__kalpaOpenFilePreview === openUnifiedFilePreview) delete window.__kalpaOpenFilePreview;
    };
  }, [openUnifiedFilePreview]);

  const [newTaskCategory, setNewTaskCategory] = useState(TASK_CATEGORIES[0]);
  
  const [leadFiles, setLeadFiles] = useState([]);
  const [isSubmittingLead, setIsSubmittingLead] = useState(false);
  const [createTaskError, setCreateTaskError] = useState('');
  
  const [showLocalBanner, setShowLocalBanner] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [savedGlobalFilters, setSavedGlobalFilters] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('kalpa_saved_global_filters') || '[]');
      return Array.isArray(parsed) ? parsed.filter(f => f && f.query).slice(0, 12) : [];
    } catch (e) { return []; }
  });
  const [savedFilterName, setSavedFilterName] = useState('');
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('kalpa_ui_dark_mode') === 'true'; } catch(e) { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('kalpa_ui_dark_mode', darkMode ? 'true' : 'false'); } catch(e) {}
    try { document.documentElement.classList.toggle('kd-dark-root', !!darkMode); } catch(e) {}
  }, [darkMode]);
  
  const activeUsers = normalizeTeamUsers(users && users.length > 0 ? users : INITIAL_USERS);
  const financeSafeHeaders = React.useMemo(() => ({
    'X-User-Role': currentUser?.role || '',
    'X-User-Name': currentUser?.name || ''
  }), [currentUser?.role, currentUser?.name]);
  const jsonFinanceSafeHeaders = React.useMemo(() => ({
    'Content-Type': 'application/json',
    ...financeSafeHeaders
  }), [financeSafeHeaders]);

  const postPresenceUpdate = useCallback((action = 'heartbeat', userPatch = currentUser) => {
    if (!USE_BACKEND_STATE || !backendStateReady || !userPatch) return;
    const identity = {
      id: userPatch.id,
      name: userPatch.name,
      username: userPatch.username,
      email: userPatch.email,
      role: userPatch.role,
      availability: userPatch.availability,
      isOnline: action === 'logout' ? false : true,
      breakStartedAt: userPatch.breakStartedAt || null
    };
    fetch(`${API_BASE}/api/presence`, {
      method: 'POST',
      headers: jsonFinanceSafeHeaders,
      body: JSON.stringify({ action, user: identity })
    }).then(async res => {
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      // Heartbeat is a writer only. Attendance Engine V3 is painted from a
      // single reader (/api/state). Updating users/logs from both /api/presence
      // and /api/state was the slow flicker: two valid-but-different snapshots
      // alternated on screen every 25-30 seconds.
      if (action === 'heartbeat') return;
      if (data?.user) {
        setUsers(prev => normalizeTeamUsers((prev || []).map(u => String(u.id) === String(data.user.id) ? { ...u, ...data.user } : u)));
        const own = currentUserRef.current;
        if (own && String(own.id) === String(data.user.id) && action !== 'logout') {
          setCurrentUser(prev => prev ? { ...prev, ...data.user } : prev);
        }
      }
      if (Array.isArray(data?.users)) setUsers(prev => normalizeTeamUsers([...(prev || []), ...data.users]));
      if (Array.isArray(data?.attendanceLogs)) setAttendanceLogs(prev => mergeAttendanceLogsStable(prev, data.attendanceLogs));
    }).catch(() => {});
  }, [USE_BACKEND_STATE, backendStateReady, jsonFinanceSafeHeaders]);

  const applyProjectSnapshot = useCallback((incomingProjects = [], options = {}) => {
    if (!Array.isArray(incomingProjects)) return;
    const { persistCache = true, updateSelected = true, source = 'unknown' } = options;
    const incoming = filterDeletedProjects(sanitizeProjectsForCache(incomingProjects));
    confirmPendingCreatedProjectsAgainstServer(incoming);
    setProjects(prev => {
      const merged = filterDeletedProjects(protectRecentlyCreatedProjects(incoming, prev));
      const prevFingerprint = (prev || []).map(p => `${p.id}:${p.updatedAt || 0}:${p.assignmentVersion || 0}:${p.assignedTo || ''}:${p.status || ''}`).sort().join('|');
      const mergedFingerprint = (merged || []).map(p => `${p.id}:${p.updatedAt || 0}:${p.assignmentVersion || 0}:${p.assignedTo || ''}:${p.status || ''}`).sort().join('|');
      if (mergedFingerprint === prevFingerprint) return prev;
      if (persistCache) {
        try {
          const compact = sanitizeProjectsForCache(merged);
          localStorage.setItem('kalpa_projects_backup', JSON.stringify(compact));
          localStorage.setItem('kalpa_projects', JSON.stringify(compact));
        } catch(e) {}
      }
      if (updateSelected) setSelectedProject(sel => sel ? (merged.find(project => String(project.id) === String(sel.id)) || sel) : sel);
      return merged;
    });
  }, []);

  // Central production persistence: hydrate and save operational state through backend.
  // When DATABASE_URL is configured in backend/.env, this is persisted in PostgreSQL.
  useEffect(() => {
    if (!USE_BACKEND_STATE) return;
    let cancelled = false;
    const hydrate = async () => {
      try {
        const data = await fetchBackendState({ apiBase: API_BASE, headers: financeSafeHeaders });
        if (cancelled) return;
        if (Array.isArray(data.users) && data.users.length) setUsers(normalizeTeamUsers(data.users));
        if (Array.isArray(data.deletedProjectIds)) rememberDeletedProjects(data.deletedProjectIds);
        if (Array.isArray(data.projects)) {
          applyProjectSnapshot(data.projects, { source: 'backend-hydrate' });
        }
        if (Array.isArray(data.chatMessages)) {
          const incomingChats = sanitizeChatsForCache(data.chatMessages);
          setChatMessages(incomingChats);
          try { localStorage.setItem('kalpa_chats', JSON.stringify(incomingChats)); } catch(e) {}
        }
        if (Array.isArray(data.notifications)) setNotifications(data.notifications);
        if (Array.isArray(data.attendanceLogs)) setAttendanceLogs(prev => mergeAttendanceLogsStable(prev, data.attendanceLogs));
        if (Array.isArray(data.performanceRecords)) setPerformanceRecords(data.performanceRecords);
        if (data.performanceSummary && typeof data.performanceSummary === 'object') setPerformanceSummary(data.performanceSummary);
        setBackendStateReady(true);
        setIsDbReady(true);
        setDbError(null);
      } catch (err) {
        console.warn('Backend/PostgreSQL state unavailable, using local cache fallback:', err.message);
        try {
          const savedUsers = localStorage.getItem('kalpa_users');
          const savedProjects = localStorage.getItem('kalpa_projects');
          const savedProjectsBackup = localStorage.getItem('kalpa_projects_backup');
          const savedChats = localStorage.getItem('kalpa_chats');
          const savedNotifs = localStorage.getItem('kalpa_notifs');
          const savedLogs = localStorage.getItem('kalpa_attendance');
          setUsers(normalizeTeamUsers(savedUsers ? JSON.parse(savedUsers) : INITIAL_USERS));
          const localProjects = savedProjects ? JSON.parse(savedProjects) : [];
          const backupProjects = savedProjectsBackup ? JSON.parse(savedProjectsBackup) : [];
          applyProjectSnapshot(mergeProjectsByFreshness(sanitizeProjectsForCache(localProjects), sanitizeProjectsForCache(backupProjects)), { source: 'backend-fallback-cache' });
          setChatMessages(savedChats ? sanitizeChatsForCache(JSON.parse(savedChats)) : []);
          setNotifications(savedNotifs ? JSON.parse(savedNotifs) : []);
          setAttendanceLogs(savedLogs ? JSON.parse(savedLogs) : []);
          setShowLocalBanner(true);
        } catch (cacheErr) {
          console.warn('Local cache fallback failed:', cacheErr.message);
          setUsers(normalizeTeamUsers(INITIAL_USERS));
          setProjects(prev => prev || []);
        }
        setBackendStateReady(true);
        setIsDbReady(true);
      }
    };
    hydrate();
    return () => { cancelled = true; };
  }, [financeSafeHeaders, applyProjectSnapshot]);

  // Production presence poll: all roles use the same backend truth for users,
  // so Admin/Manager/Designer screens do not disagree about online/offline state.
  useEffect(() => {
    if (!USE_BACKEND_STATE || !backendStateReady) return;
    let cancelled = false;
    const refreshPresence = async () => {
      try {
        const data = await fetchBackendState({ apiBase: API_BASE, headers: financeSafeHeaders });
        if (cancelled || !Array.isArray(data.users)) return;
        setUsers(prev => normalizeTeamUsers([...(prev || []), ...data.users]));
        if (Array.isArray(data.deletedProjectIds)) rememberDeletedProjects(data.deletedProjectIds);
        if (Array.isArray(data.projects)) {
          applyProjectSnapshot(data.projects, { source: 'backend-poll' });
        }
        if (Array.isArray(data.chatMessages)) {
          setChatMessages(prev => {
            const merged = mergeChatMessagesByFreshness(prev, data.chatMessages);
            try { localStorage.setItem('kalpa_chats', JSON.stringify(sanitizeChatsForCache(merged))); } catch(e) {}
            return merged;
          });
        }
        if (Array.isArray(data.notifications)) {
          setNotifications(prev => {
            const byId = new Map();
            [...(prev || []), ...data.notifications].forEach(n => { if (n?.id) byId.set(String(n.id), { ...(byId.get(String(n.id)) || {}), ...n }); });
            return Array.from(byId.values()).sort((a,b) => Number(b.id || 0) - Number(a.id || 0));
          });
        }
        if (Array.isArray(data.attendanceLogs)) setAttendanceLogs(prev => mergeAttendanceLogsStable(prev, data.attendanceLogs));
        if (Array.isArray(data.performanceRecords)) setPerformanceRecords(data.performanceRecords);
        if (data.performanceSummary && typeof data.performanceSummary === 'object') setPerformanceSummary(data.performanceSummary);
      } catch (e) {}
    };
    refreshPresence();
    const timer = setInterval(refreshPresence, 30000);
    window.addEventListener('focus', refreshPresence);
    document.addEventListener('visibilitychange', refreshPresence);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', refreshPresence);
      document.removeEventListener('visibilitychange', refreshPresence);
    };
  }, [backendStateReady, financeSafeHeaders, applyProjectSnapshot]);

  useEffect(() => {
    if (!USE_BACKEND_STATE || !backendStateReady || !isDbReady) return;
    const timer = setTimeout(() => {
      const payload = {
        // Attendance Engine V3 presence is owned by /api/presence.
        // Never POST client users back through /api/state; that created a
        // second writer which fought the heartbeat stream and caused slow flicker.
        projects: sanitizeProjectsForCache(filterDeletedProjects(protectRecentlyCreatedProjects(projects || [], []))),
        deletedProjectIds: getDeletedProjectIds(),
        chatMessages: sanitizeChatsForCache(chatMessages || []),
        notifications: notifications || [],
        // Attendance is owned by /api/presence in backend mode. Posting it here
        // created a feedback loop where stale client snapshots overwrote fresh
        // backend counters and made the page flicker.
      };
      saveBackendStateApi({
        apiBase: API_BASE,
        headers: jsonFinanceSafeHeaders,
        currentUserRole: currentUser?.role || '',
        payload
      }).catch(err => console.warn('Backend/PostgreSQL state save failed:', err.message));
    }, 900);
    return () => clearTimeout(timer);
  }, [backendStateReady, isDbReady, projects, chatMessages, notifications, currentUser?.role, jsonFinanceSafeHeaders]);


  // Durable create-task outbox: a task that was created in the UI remains protected
  // and is retried until the backend confirms it. This removes the old 30-60 minute
  // failure mode where a delayed backend/localStorage refresh could erase a locally
  // created task that had not yet been persisted.
  useEffect(() => {
    if (!USE_BACKEND_STATE || !backendStateReady || !isDbReady) return;
    let cancelled = false;
    const flushPendingCreatedProjects = async () => {
      const pending = getPendingCreatedProjects();
      if (!pending.length) return;
      for (const project of pending) {
        if (cancelled || !project?.id) continue;
        try {
          markPendingCreatedAttempt(project.id);
          const data = await createTaskApi({
            apiBase: API_BASE,
            headers: jsonFinanceSafeHeaders,
            currentUserRole: currentUser?.role || '',
            task: sanitizeProjectForCache(project)
          });
          const savedProject = data.project || data.case || project;
          forgetPendingCreatedProjects(project.id, project.caseId);
          rememberRecentCreatedProject(savedProject);
          applyProjectSnapshot([savedProject], { source: 'pending-create-confirmed' });
        } catch(e) {
          console.warn('Pending task save retry failed:', e.message);
        }
      }
    };
    flushPendingCreatedProjects();
    const timer = setInterval(flushPendingCreatedProjects, 30000);
    window.addEventListener('online', flushPendingCreatedProjects);
    window.addEventListener('focus', flushPendingCreatedProjects);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('online', flushPendingCreatedProjects); window.removeEventListener('focus', flushPendingCreatedProjects); };
  }, [USE_BACKEND_STATE, backendStateReady, isDbReady, jsonFinanceSafeHeaders, currentUser?.role, applyProjectSnapshot]);


  // Durable delete-task outbox: a deleted task remains hidden everywhere and the
  // backend delete is retried until it confirms. This prevents stale backend,
  // localStorage, or another tab from resurrecting a case after 3-5 seconds.
  useEffect(() => {
    if (!USE_BACKEND_STATE || !backendStateReady || !isDbReady) return;
    let cancelled = false;
    const flushPendingDeletedProjects = async () => {
      const pendingIds = getPendingDeletedProjectIds();
      if (!pendingIds.length) return;
      setProjects(prev => filterDeletedProjects(prev || []));
      for (const id of pendingIds) {
        if (cancelled || !id) continue;
        try {
          markPendingDeletedAttempt(id);
          const data = await deleteTaskApi({ apiBase: API_BASE, taskId: id, headers: jsonFinanceSafeHeaders });
          if (Array.isArray(data.deletedProjectIds)) rememberDeletedProjectsForce(data.deletedProjectIds);
          // Keep the confirmed deleted-id memory, but remove it from retry outbox.
          forgetPendingDeletedProjects(id);
        } catch (e) {
          console.warn('Pending task delete retry failed:', e.message);
        }
      }
    };
    flushPendingDeletedProjects();
    const timer = setInterval(flushPendingDeletedProjects, 30000);
    window.addEventListener('online', flushPendingDeletedProjects);
    window.addEventListener('focus', flushPendingDeletedProjects);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('online', flushPendingDeletedProjects); window.removeEventListener('focus', flushPendingDeletedProjects); };
  }, [USE_BACKEND_STATE, backendStateReady, isDbReady, jsonFinanceSafeHeaders]);

  // Keep assignment/status changes live across tabs without creating storage-event loops.
  // Important: never write back to localStorage while handling an incoming sync event;
  // doing so rebroadcasts the same payload between tabs and can push CPU/memory very high.
  const lastProjectSyncFingerprintRef = useRef('');
  useEffect(() => {
    const makeFingerprint = (items) => {
      try {
        return (items || [])
          .map(p => `${p.id}:${p.updatedAt || 0}:${p.assignmentVersion || 0}:${p.assignedTo || ''}:${p.status || ''}`)
          .sort()
          .join('|');
      } catch (e) { return String(Date.now()); }
    };

    const applyIncomingProjects = (incoming) => {
      if (!Array.isArray(incoming)) return;
      const compactIncoming = filterDeletedProjects(sanitizeProjectsForCache(incoming));
      const fingerprint = makeFingerprint(compactIncoming);
      if (fingerprint && fingerprint === lastProjectSyncFingerprintRef.current) return;
      lastProjectSyncFingerprintRef.current = fingerprint;

      applyProjectSnapshot(compactIncoming, { persistCache: false, source: 'cross-tab' });
    };

    const handleBroadcast = (event) => {
      if (event?.data?.type === 'projects-updated' && event.data.source !== OPS_TAB_ID) {
        if (Array.isArray(event.data.deletedProjectIds)) { rememberDeletedProjects(event.data.deletedProjectIds); setProjects(prev => filterDeletedProjects(prev)); }
        applyIncomingProjects(event.data.projects);
      }
    };

    const handleStorage = (event = {}) => {
      // Only the lightweight ping should trigger a reload. Do not react to every
      // kalpa_projects write, otherwise two tabs can keep waking each other up.
      if (event.key !== 'kalpa_projects_sync_ping') return;
      try {
        const ping = JSON.parse(localStorage.getItem('kalpa_projects_sync_ping') || '{}');
        if (ping.source === OPS_TAB_ID) return;
        const raw = localStorage.getItem('kalpa_projects_backup') || localStorage.getItem('kalpa_projects');
        if (raw) applyIncomingProjects(filterDeletedProjects(JSON.parse(raw)));
      } catch (e) {
        console.warn('Project sync refresh failed', e);
      }
    };

    try { opsBroadcast?.addEventListener('message', handleBroadcast); } catch (e) {}
    window.addEventListener('storage', handleStorage);

    return () => {
      try { opsBroadcast?.removeEventListener('message', handleBroadcast); } catch (e) {}
      window.removeEventListener('storage', handleStorage);
    };
  }, [applyProjectSnapshot]);

  useEffect(() => {
    if (!currentUser) return;
    const latest = activeUsers.find(u => u.id === currentUser.id);
    if (latest && (latest.role !== currentUser.role || latest.name !== currentUser.name || latest.profilePhoto !== currentUser.profilePhoto || latest.username !== currentUser.username)) {
      setCurrentUser(prev => ({ ...prev, ...latest }));
      if (activeTab === 'ledger' && latest.role !== ROLES.ADMIN) setActiveTab('command');
      if (activeTab === 'closing' && latest.role !== ROLES.ADMIN) setActiveTab('command');
    }
  }, [users, currentUser?.id]);

  useEffect(() => {
    if (USE_BACKEND_STATE || isLocalMock) {
      setFirebaseUser({ uid: USE_BACKEND_STATE ? 'backend-state-user' : 'local-dev-user' });
      setIsAuthReady(true);
      return;
    }

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          const authPromise = signInAnonymously(auth);
          const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error("Auth Connection Timeout.")), 8000)
          );
          await Promise.race([authPromise, timeoutPromise]);
        }
      } catch (error) {
        console.error("Firebase Auth Error:", error);
        setAuthError(error.message);
      } finally {
        setIsAuthReady(true);
      }
    };
    
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, user => {
        setFirebaseUser(user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!firebaseUser || !isAuthReady || USE_BACKEND_STATE) return;

    if (isLocalMock) {
      const savedUsers = localStorage.getItem('kalpa_users');
      const savedProjects = localStorage.getItem('kalpa_projects');
      const savedProjectsBackup = localStorage.getItem('kalpa_projects_backup');
      const savedChats = localStorage.getItem('kalpa_chats');
      const savedNotifs = localStorage.getItem('kalpa_notifs');
      const savedLogs = localStorage.getItem('kalpa_attendance');
      
      setUsers(normalizeTeamUsers(savedUsers ? JSON.parse(savedUsers) : INITIAL_USERS));
      const localProjects = savedProjects ? JSON.parse(savedProjects) : [];
      const backupProjects = savedProjectsBackup ? JSON.parse(savedProjectsBackup) : [];
      setProjects(filterDeletedProjects(protectRecentlyCreatedProjects(sanitizeProjectsForCache(localProjects), sanitizeProjectsForCache(backupProjects))));
      setChatMessages(savedChats ? sanitizeChatsForCache(JSON.parse(savedChats)) : []);
      setNotifications(savedNotifs ? JSON.parse(savedNotifs) : []);
      setAttendanceLogs(savedLogs ? JSON.parse(savedLogs) : []);
      setIsDbReady(true);
      return;
    }

    const unsubs = [];
    setDbError(null);
    
    const handleDbError = (err) => {
        console.error("Database permission error:", err);
        if (err.message.includes('Missing or insufficient permissions')) {
            setDbError('permission-denied');
        } else {
            setDbError(err.message);
        }
        setIsDbReady(true);
    };

    try {
        unsubs.push(onSnapshot(collection(db, 'artifacts', safeAppId, 'public', 'data', 'projects'), snap => {
          const cloudProjects = filterDeletedProjects(sanitizeProjectsForCache(snap.docs.map(doc => doc.data())));
          if (cloudProjects.length > 0) {
            setProjects(prev => {
              confirmPendingCreatedProjectsAgainstServer(cloudProjects);
              const merged = filterDeletedProjects(protectRecentlyCreatedProjects(cloudProjects, prev));
              try { localStorage.setItem('kalpa_projects_backup', JSON.stringify(merged)); localStorage.setItem('kalpa_projects', JSON.stringify(merged)); merged.forEach(recordAssignmentLedger); } catch(e) {}
              return merged;
            });
          } else {
            try {
              const backup = localStorage.getItem('kalpa_projects_backup');
              const cached = filterDeletedProjects(normalizeProjectRecords(backup ? JSON.parse(backup) : []));
              setProjects(prev => filterDeletedProjects(mergeProjectsByFreshness(prev, cached)));
            } catch(e) {
              setProjects(prev => prev || []);
            }
          }
        }, handleDbError));

        unsubs.push(onSnapshot(collection(db, 'artifacts', safeAppId, 'public', 'data', 'users'), snap => {
          const fetchedUsers = snap.docs.map(doc => doc.data());
          
          const needsUpdate = fetchedUsers.length === 0 || fetchedUsers.some(u => !u.username);
          
          if (needsUpdate) {
            try {
                INITIAL_USERS.forEach(u => {
                  setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'users', u.id.toString()), u).catch(e => console.error(e));
                });
            } catch(e){}
          } else {
            setUsers(normalizeTeamUsers(fetchedUsers));
          }
        }, handleDbError));

        unsubs.push(onSnapshot(collection(db, 'artifacts', safeAppId, 'public', 'data', 'chats'), snap => {
          const sortedChats = sanitizeChatsForCache(snap.docs.map(doc => doc.data())).sort((a,b) => a.id - b.id);
          setChatMessages(sortedChats);
        }, handleDbError));

        unsubs.push(onSnapshot(collection(db, 'artifacts', safeAppId, 'public', 'data', 'notifications'), snap => {
          const sortedNotifs = snap.docs.map(doc => doc.data()).sort((a,b) => b.id - a.id);
          setNotifications(sortedNotifs);
        }, handleDbError));

        unsubs.push(onSnapshot(collection(db, 'artifacts', safeAppId, 'public', 'data', 'attendanceLogs'), snap => {
          setAttendanceLogs(snap.docs.map(doc => doc.data()));
        }, handleDbError));

        setIsDbReady(true);
    } catch(e) {
        handleDbError(e);
    }

    return () => unsubs.forEach(fn => fn());
  }, [firebaseUser, isAuthReady]);


  useEffect(() => {
    if (!firebaseUser || !isAuthReady || isLocalMock || USE_BACKEND_STATE) return;
    const refreshProjects = async () => {
      try {
        const snap = await getDocs(collection(db, 'artifacts', safeAppId, 'public', 'data', 'projects'));
        const cloudProjects = filterDeletedProjects(sanitizeProjectsForCache(snap.docs.map(d => d.data())));
        if (cloudProjects.length) {
          setProjects(prev => {
            confirmPendingCreatedProjectsAgainstServer(cloudProjects);
            const merged = filterDeletedProjects(protectRecentlyCreatedProjects(cloudProjects, prev));
            try { localStorage.setItem('kalpa_projects_backup', JSON.stringify(merged)); localStorage.setItem('kalpa_projects', JSON.stringify(merged)); merged.forEach(recordAssignmentLedger); } catch(e) {}
            setSelectedProject(sel => sel ? (merged.find(p => String(p.id) === String(sel.id)) || sel) : sel);
            return merged;
          });
        }
      } catch (e) {
        // onSnapshot is the main sync path; focus refresh is only a safety net.
      }
    };
    refreshProjects();
    window.addEventListener('focus', refreshProjects);
    return () => { window.removeEventListener('focus', refreshProjects); };
  }, [firebaseUser, isAuthReady, isLocalMock]);

  useEffect(() => {
    if (!currentUser?.id || !isDbReady) return;

    const today = new Date().toLocaleDateString('en-CA');
    const logId = `${currentUser.id}_${today}`;

    if (USE_BACKEND_STATE) {
      // Backend mode: the server is the only writer for attendance counters.
      // The browser only sends presence beats. Local timer-based mutation caused
      // race conditions between /api/state and /api/presence and made rows jump
      // between old/new values.
      postPresenceUpdate('login', currentUser);
      const heartbeatTimer = setInterval(() => {
        const liveUser = currentUserRef.current || currentUser;
        if (!liveUser?.id) return;
        const beatNow = Date.now();
        const refreshed = { ...liveUser, isOnline: true, lastSeenAt: beatNow, lastHeartbeatAt: beatNow };
        currentUserRef.current = refreshed;
        // Do not mutate UI users from the heartbeat loop. /api/state is the
        // only reader that paints Attendance V3; this prevents alternating
        // local/server snapshots from flickering the table.
        postPresenceUpdate('heartbeat', refreshed);
      }, 25000);
      return () => clearInterval(heartbeatTimer);
    }

    const ensureLocalAttendanceRow = () => {
      const liveUser = currentUserRef.current || currentUser;
      const now = Date.now();
      const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      setAttendanceLogs(prev => {
        if ((prev || []).some(l => l.id === logId)) return prev;
        const currentLog = {
          id: logId,
          userId: liveUser.id,
          name: liveUser.name,
          role: liveUser.role,
          date: today,
          loginTime: timeStr,
          logoutTime: timeStr,
          loginAt: liveUser.lastLoginAt || now,
          logoutAt: now,
          totalLoggedInMinutes: 0,
          activeMinutes: 0,
          totalBreakMinutes: 0,
          currentBreakStartedAt: liveUser.availability === 'Break' ? (liveUser.breakStartedAt || now) : null,
          breakEvents: liveUser.availability === 'Break' ? [{ start: liveUser.breakStartedAt || now, startTime: timeStr }] : [],
          isOnline: true,
          status: liveUser.availability === 'Break' ? 'On Break' : 'Online',
          lastTick: now
        };
        const next = [...(prev || []), currentLog];
        if (isLocalMock) localStorage.setItem('kalpa_attendance', JSON.stringify(next));
        return next;
      });
    };

    ensureLocalAttendanceRow();
    postPresenceUpdate('login', currentUser);

    const attendanceTimer = setInterval(() => {
      const liveUser = currentUserRef.current || currentUser;
      setAttendanceLogs(prev => {
        const currentLog = (prev || []).find(l => l.id === logId);
        if (!currentLog) return prev;
        const now = Date.now();
        const isOnBreak = liveUser.availability === 'Break';
        const accrued = buildAttendanceAccrual(currentLog, now, isOnBreak);
        const breakStart = isOnBreak ? (currentLog.currentBreakStartedAt || liveUser.breakStartedAt || now) : null;
        const existingEvents = Array.isArray(currentLog.breakEvents) ? currentLog.breakEvents : [];
        const hasOpenBreak = existingEvents.some(ev => ev.start && !ev.end);
        const breakEvents = isOnBreak && !hasOpenBreak
          ? [...existingEvents, { start: breakStart, startTime: new Date(breakStart).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]
          : existingEvents;
        const updated = {
          ...currentLog,
          logoutTime: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
          logoutAt: now,
          totalLoggedInMinutes: accrued.totalLoggedInMinutes,
          activeMinutes: accrued.activeMinutes,
          totalBreakMinutes: accrued.totalBreakMinutes,
          currentBreakStartedAt: breakStart,
          breakEvents,
          isOnline: true,
          status: isOnBreak ? 'On Break' : 'Online',
          lastTick: now
        };
        const next = prev.map(l => l.id === logId ? updated : l);
        if (isLocalMock) localStorage.setItem('kalpa_attendance', JSON.stringify(next));
        if (!isLocalMock && firebaseUser) setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'attendanceLogs', logId), updated).catch(e=>{});
        return next;
      });
    }, 30000);

    const heartbeatTimer = setInterval(() => {
      const liveUser = currentUserRef.current || currentUser;
      if (!liveUser?.id) return;
      const beatNow = Date.now();
      const refreshed = { ...liveUser, isOnline: true, lastSeenAt: beatNow, lastHeartbeatAt: beatNow };
      currentUserRef.current = refreshed;
      setUsers(prev => normalizeTeamUsers((prev || []).map(u => String(u.id) === String(refreshed.id) ? { ...u, ...refreshed } : u)));
      if (!USE_BACKEND_STATE && firebaseUser) handleUpdateUser(refreshed);
      postPresenceUpdate('heartbeat', refreshed);
    }, 25000);

    return () => { clearInterval(attendanceTimer); clearInterval(heartbeatTimer); };
  }, [currentUser?.id, isDbReady, firebaseUser, postPresenceUpdate]);


  const saveLocal = (key, data) => {
      if (!isLocalMock) return;
      const safeData = key === 'kalpa_projects' || key === 'kalpa_projects_backup' ? sanitizeProjectsForCache(data) : key === 'kalpa_chats' ? sanitizeChatsForCache(data) : data;
      localStorage.setItem(key, JSON.stringify(safeData));
  };

  const addNotification = async (targetRole, targetUser, title, type = 'info', extra = {}) => {
    const newNotif = buildNotification({
      targetRole,
      targetUser,
      title,
      type,
      category: extra.category,
      priority: extra.priority,
      id: Date.now(),
      time: new Date().toLocaleTimeString()
    });
    setNotifications(prev => {
      const next = [newNotif, ...(prev || [])].slice(0, 200);
      if (isLocalMock) localStorage.setItem('kalpa_notifs', JSON.stringify(next));
      return next;
    });
    const belongsToCurrentUser = currentUser && isNotificationForUser(newNotif, currentUser);
    if (belongsToCurrentUser && desktopNotificationsEnabled && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Kalpvriksha Designs Ops', { body: title, tag: String(newNotif.id) }); } catch(e) {}
    }
    try { await setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'notifications', newNotif.id.toString()), newNotif); } catch(e){}
  };

  const handleUpdateProject = async (updatedProject, oldProject) => {
    const spawnedProjects = Array.isArray(updatedProject?._spawnProjects) ? updatedProject._spawnProjects : [];
    if (updatedProject && Object.prototype.hasOwnProperty.call(updatedProject, '_spawnProjects')) {
      const { _spawnProjects, ...cleanProject } = updatedProject;
      updatedProject = cleanProject;
    }
    updatedProject = normalizeProjectRecord({ ...updatedProject, updatedAt: Date.now(), syncVersion: Date.now() });
    const normalizedSpawned = spawnedProjects.map(p => normalizeProjectRecord({ ...p, updatedAt: p.updatedAt || Date.now(), syncVersion: p.syncVersion || Date.now() }));

    // When a temporary revision work item is finally approved, copy its outcome back to the permanent original task.
    let linkedOriginalUpdate = null;
    if (isRevisionWorkItem(updatedProject) && updatedProject.status === 'Completed' && updatedProject.originalTaskId) {
      const original = projects.find(p => String(p.id) === String(updatedProject.originalTaskId));
      if (original) {
        const now = Date.now();
        const revisionNumber = updatedProject.revisionNumber || getNextRevisionNumber(original);
        const revisionFiles = [...(updatedProject.completedFiles || []), ...(updatedProject.documents || []).filter(d => String(d.type || '').toLowerCase() === 'completed')];
        linkedOriginalUpdate = normalizeProjectRecord({
          ...original,
          updatedAt: now,
          syncVersion: now,
          documents: [...(original.documents || []), ...revisionFiles],
          completedFiles: [...(original.completedFiles || []), ...revisionFiles],
          revisionHistory: [
            ...(original.revisionHistory || []),
            {
              id: now,
              revisionNumber,
              revisionCode: `R${revisionNumber}`,
              action: 'Revision Completed',
              status: 'Completed',
              completedBy: updatedProject.completedBy || updatedProject.assignedTo,
              completedAt: updatedProject.completedAt || now,
              workItemId: updatedProject.id,
              files: revisionFiles
            }
          ],
          timeline: [
            ...(original.timeline || []),
            { id: now, text: `Revision ${revisionNumber} completed and linked back to original task ${original.id}.`, time: new Date(now).toLocaleString() }
          ]
        });
      }
    }

    const projectsToSave = [updatedProject, ...normalizedSpawned, ...(linkedOriginalUpdate ? [linkedOriginalUpdate] : [])];
    projectsToSave.forEach(p => { if (isAssignedValue(p.assignedTo)) recordAssignmentLedger(p); });
    oldProject = oldProject ? normalizeProjectRecord(oldProject) : oldProject;
    const changedPrimaryTaskId = oldProject?.id && updatedProject?.id && String(oldProject.id) !== String(updatedProject.id);
    if (changedPrimaryTaskId) rememberDeletedProjects(oldProject.id, oldProject.caseId);
    // Update the screen immediately. Previously the app waited for Firestore;
    // if a completed file was large or Firebase rejected it, the upload looked like nothing happened.
    setSelectedProject(updatedProject);
    setProjects(prev => {
      const ids = new Set(projectsToSave.map(p => String(p.id)));
      if (changedPrimaryTaskId) {
        ids.add(String(oldProject.id));
        if (oldProject.caseId) ids.add(String(oldProject.caseId));
      }
      const next = filterDeletedProjects(mergeProjectsByFreshness((prev || []).filter(p => !ids.has(String(p.id)) && !ids.has(String(p.caseId || ''))), projectsToSave));
      persistAndBroadcastProjects(next);
      return next;
    });
    
    if (firebaseUser && !isLocalMock) {
        for (const projectToSave of projectsToSave) {
          try {
            await setDoc(
              doc(db, 'artifacts', safeAppId, 'public', 'data', 'projects', projectToSave.id.toString()),
              stripLargeLocalFilesForCloud(projectToSave)
            );
          } catch(e){
            console.warn('Project cloud save failed, but local screen has been updated.', e);
          }
        }
        if (changedPrimaryTaskId) {
          try { await deleteDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'projects', oldProject.id.toString())); } catch(e) {}
        }
    }

    if (changedPrimaryTaskId && USE_BACKEND_STATE) {
      try { await deleteTaskApi({ apiBase: API_BASE, taskId: oldProject.id, headers: jsonFinanceSafeHeaders }); } catch(e) {}
    }

    normalizedSpawned.forEach(spawned => {
      const targetRole = activeUsers.find(u => u.name === spawned.assignedTo)?.role || ROLES.DESIGNER;
      addNotification(targetRole, spawned.assignedTo, `URGENT REVISION assigned: ${getDisplayTaskId(spawned)} ${spawned.revisionCode || ''}`.trim(), 'urgent');
      addNotification(ROLES.MANAGER, null, `Revision work item created: ${getDisplayTaskId(spawned)} ${spawned.revisionCode || ''}`.trim(), 'urgent');
    });

    if (oldProject && updatedProject.status !== oldProject.status) {
      if (updatedProject.status === 'Completed') addNotification(ROLES.MANAGER, null, `Task ${getDisplayTaskId(updatedProject)} completed and ready`, 'success');
      if (updatedProject.status === 'Completed') addNotification(ROLES.DESIGNER, updatedProject.assignedTo, `Task ${getDisplayTaskId(updatedProject)} marked as Completed`, 'success');
    }
    if (oldProject && updatedProject.priority === 'Urgent' && oldProject.priority !== 'Urgent') {
      addNotification(ROLES.DESIGNER, updatedProject.assignedTo, `URGENT REVISION: Task ${getDisplayTaskId(updatedProject)}`, 'urgent');
    }
    if (oldProject && updatedProject.assignedTo !== oldProject.assignedTo && updatedProject.assignedTo !== 'Unassigned') {
      const targetRole = activeUsers.find(u => u.name === updatedProject.assignedTo)?.role || ROLES.DESIGNER;
      addNotification(targetRole, updatedProject.assignedTo, `Task Re-assigned to you: ${getDisplayTaskId(updatedProject)}`, 'info');
    }
  };
  

  const handlePaymentStatusChange = async (project, status) => {
    if (!project || currentUser?.role !== ROLES.ADMIN) return;
    const normalizedStatus = PAYMENT_TRACKING_OPTIONS.includes(status) ? status : 'Not Updated';

    if (normalizedStatus === 'Paid') {
      const estimateAmount = getPaymentEstimateAmount(project);
      const existingAmount = getPaymentReceivedAmount(project);
      const defaultAmount = existingAmount || estimateAmount || '';
      const amountInput = window.prompt(`Enter amount received for ${project.id}${estimateAmount ? ` (estimate ₹${Number(estimateAmount).toLocaleString('en-IN')})` : ''}:`, defaultAmount ? String(defaultAmount) : '');
      if (amountInput === null || String(amountInput).trim() === '') return;
      const amount = Number(String(amountInput).replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) {
        alert('Please enter a valid received amount before marking payment as Paid.');
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const paymentDate = window.prompt('Enter payment date (YYYY-MM-DD):', project.ledger?.date || project.paymentDate || today);
      if (paymentDate === null || !String(paymentDate).trim()) return;
      const mode = window.prompt('Enter payment mode (Cash / UPI / Bank Transfer / Cheque):', project.ledger?.mode || '');
      if (mode === null || !String(mode).trim()) return;
      const transactionId = window.prompt('Reference / Transaction ID (optional):', project.ledger?.txnId || project.transactionId || '') || '';
      const note = window.prompt('Remarks (optional):', '') || '';
      const updatedProject = buildPaymentTrackingUpdate(project, 'Paid', currentUser, {
        amountIn: amount,
        paymentDate: String(paymentDate).trim(),
        mode: String(mode).trim(),
        transactionId: String(transactionId).trim(),
        note: String(note).trim(),
      });
      await handleUpdateProject(updatedProject, project);
      return;
    }

    const updatedProject = buildPaymentTrackingUpdate(project, normalizedStatus, currentUser);
    await handleUpdateProject(updatedProject, project);
  };

  const handleDeleteTask = async (taskId) => {
     const id = String(taskId);
     const target = (projects || []).find(p => String(p.id) === id || String(p.caseId || '') === id) || selectedProject || {};
     const deleteIds = [...new Set([id, target?.id, target?.caseId, ...(target?.previousTaskIds || [])].map(x => String(x || '')).filter(Boolean))];
     setSelectedProject(null);
     // A user-initiated delete must win over recent-create protection. Otherwise
     // a newly created case can disappear locally, then reappear from the protected
     // recent-create cache/backend poll a few seconds later.
     forgetPendingCreatedProjects(deleteIds);
     forgetRecentCreatedProjects(deleteIds);
     rememberDeletedProjectsForce(deleteIds);
     rememberPendingDeletedProjects(deleteIds);
     setProjects(prev => {
       const deleteSet = new Set(deleteIds);
       const next = filterDeletedProjects((prev || []).filter(p => !deleteSet.has(String(p.id)) && !deleteSet.has(String(p.caseId || ''))));
       persistAndBroadcastProjects(next);
       return next;
     });
     try {
       const ledger = getAssignmentLedger();
       delete ledger[id];
       saveAssignmentLedger(ledger);
     } catch(e) {}
     try {
       if (USE_BACKEND_STATE) {
         const data = await deleteTaskApi({ apiBase: API_BASE, taskId: id, headers: jsonFinanceSafeHeaders });
         if (Array.isArray(data.deletedProjectIds)) rememberDeletedProjectsForce(data.deletedProjectIds);
         forgetPendingDeletedProjects(deleteIds);
       }
     } catch (e) { console.warn('Backend delete failed after local deletion:', e); }
     try {
       if (firebaseUser && !isLocalMock) await deleteDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'projects', id));
     } catch (e) { console.warn("Cloud delete skipped/failed after local deletion:", e); }
  };

  const handleSendMessage = async (msg) => {
    if (!firebaseUser) return;
    const normalizedMsg = { ...msg, readBy: msg.readBy || [{ name: msg.sender, time: msg.time }] };
    setChatMessages(prev => {
      const next = [...prev, normalizedMsg].sort((a,b) => a.id - b.id);
      if (isLocalMock) localStorage.setItem('kalpa_chats', JSON.stringify(sanitizeChatsForCache(next)));
      return next;
    });
    try { await setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'chats', normalizedMsg.id.toString()), sanitizeChatMessageForCache(normalizedMsg)); } catch(e){}
    const recipient = String(normalizedMsg.recipient || 'global');
    const isGlobalChat = recipient === 'global' || !recipient;
    const text = String(normalizedMsg.text || '');
    const notifiedUsers = new Set();

    if (isGlobalChat && text.includes('@all')) {
        addNotification(ROLES.ADMIN, null, `@all mention from ${normalizedMsg.sender}`, 'mention', { category: 'Chat', priority: 'High' });
        addNotification(ROLES.MANAGER, null, `@all mention from ${normalizedMsg.sender}`, 'mention', { category: 'Chat', priority: 'High' });
        addNotification(ROLES.DESIGNER, null, `@all mention from ${normalizedMsg.sender}`, 'mention', { category: 'Chat', priority: 'High' });
    }
    (activeUsers || []).forEach(u => {
      if (u.name !== normalizedMsg.sender && text.toLowerCase().includes(`@${u.name}`.toLowerCase())) {
        notifiedUsers.add(String(u.name).toLowerCase());
        addNotification(u.role, u.name, `You were mentioned by ${normalizedMsg.sender}`, 'mention', { category: 'Chat', priority: 'High' });
      }
    });
    if (!isGlobalChat && !samePerson(recipient, normalizedMsg.sender)) {
      const target = (activeUsers || []).find(u => samePerson(u.name, recipient) || samePerson(u.username, recipient) || String(u.id || '').toLowerCase() === String(recipient || '').toLowerCase());
      if (target && !notifiedUsers.has(String(target.name).toLowerCase())) {
        const preview = text || normalizedMsg.fileName || 'Attachment';
        addNotification(target.role, target.name, `New message from ${normalizedMsg.sender}: ${preview.length > 60 ? `${preview.slice(0, 57)}...` : preview}`, 'chat', { category: 'Chat', priority: 'Normal' });
      }
    }
  };

  const openTaskDiscussion = (project) => {
    if (!project) return;
    window.dispatchEvent(new CustomEvent('kalpa:discuss-task', { detail: { projectId: project.id || project.caseId || '', project } }));
  };

  const openTaskReferenceFromChat = (projectOrId) => {
    const projectId = typeof projectOrId === 'string' ? projectOrId : (projectOrId?.id || projectOrId?.caseId || '');
    const target = (projects || []).find(p => String(p.id) === String(projectId) || String(p.caseId || '') === String(projectId)) || (typeof projectOrId === 'object' ? projectOrId : null);
    if (!target) return;
    openTaskDetail(target, activeTab || 'board');
  };

  const handleMarkMessagesRead = async (activeChannel) => {
    if (!currentUser) return;
    const nowText = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const updates = [];
    setChatMessages(prev => {
      const next = prev.map(m => {
        const markAll = activeChannel === '__all__';
        const isGlobal = activeChannel === 'global' && (m.recipient === 'global' || !m.recipient);
        const sameCurrentUser = (value = '') => !!String(value || '').trim() && (samePerson(value, currentUser.name) || samePerson(value, currentUser.username) || (!!currentUser.id && String(value || '').toLowerCase() === String(currentUser.id || '').toLowerCase()));
        const isDM = activeChannel !== 'global' && activeChannel !== '__all__' && samePerson(m.sender, activeChannel) && sameCurrentUser(m.recipient);
        const isIncomingToMe = !sameCurrentUser(m.sender) && (markAll ? (sameCurrentUser(m.recipient) || m.recipient === 'global' || !m.recipient) : (isGlobal || isDM));
        if (!isIncomingToMe) return m;
        const alreadyRead = (m.readBy || []).some(entry => {
          const name = typeof entry === 'string' ? entry : entry?.name;
          return sameCurrentUser(name);
        });
        if (alreadyRead) return m;
        const updated = { ...m, readBy: [...(m.readBy || []), { name: currentUser.name, time: nowText }] };
        updates.push(updated);
        return updated;
      });
      if (isLocalMock) localStorage.setItem('kalpa_chats', JSON.stringify(sanitizeChatsForCache(next)));
      return next;
    });
    if (firebaseUser && updates.length) {
      updates.forEach(m => setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'chats', m.id.toString()), m).catch(e=>{}));
    }
    // Clear chat/mention notifications as soon as the relevant chat is opened/read.
    const readRelevantNotifications = [];
    setNotifications(prev => {
      const next = prev.map(n => {
        const belongsToMe = (!n.targetUser && n.targetRole === currentUser.role) || samePerson(n.targetUser, currentUser.name) || samePerson(n.targetUser, currentUser.username) || (!!currentUser.id && String(n.targetUser || '').toLowerCase() === String(currentUser.id || '').toLowerCase());
        const isChatNotice = ['mention', 'chat', 'message'].includes(String(n.type || '').toLowerCase()) || /mention|message|chat/i.test(String(n.title || ''));
        if (!belongsToMe || !isChatNotice || (n.readBy || []).includes(currentUser.name)) return n;
        const updated = { ...n, readBy: [...(n.readBy || []), currentUser.name] };
        readRelevantNotifications.push(updated);
        return updated;
      });
      if (isLocalMock) localStorage.setItem('kalpa_notifs', JSON.stringify(next));
      return next;
    });
    if (firebaseUser && readRelevantNotifications.length) {
      readRelevantNotifications.forEach(n => setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'notifications', n.id.toString()), n).catch(e=>{}));
    }
  };


  const handleUpdateMessage = async (updatedMsg) => {
    if (!updatedMsg || !updatedMsg.id) return;
    const normalizedMsg = sanitizeChatMessageForCache({ ...updatedMsg });
    setChatMessages(prev => {
      const next = (prev || []).map(m => String(m.id) === String(normalizedMsg.id) ? normalizedMsg : m).sort((a,b) => Number(a.id || 0) - Number(b.id || 0));
      if (isLocalMock) localStorage.setItem('kalpa_chats', JSON.stringify(sanitizeChatsForCache(next)));
      return next;
    });
    try { await setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'chats', normalizedMsg.id.toString()), normalizedMsg); } catch(e){}
  };

  const handleDeleteMessage = async (msgId) => {
    if (!firebaseUser) return;
    try { await deleteDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'chats', msgId.toString())); } catch(e){}
  };

  const markNotificationRead = async (notifId) => {
    if (!currentUser) return;
    const changed = [];
    setNotifications(prev => {
      const next = (prev || []).map(n => {
        if (String(n.id) !== String(notifId) || (n.readBy || []).includes(currentUser.name)) return n;
        const updated = { ...n, readBy: [...(n.readBy || []), currentUser.name] };
        changed.push(updated);
        return updated;
      });
      if (isLocalMock) localStorage.setItem('kalpa_notifs', JSON.stringify(next));
      return next;
    });
    changed.forEach(n => setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'notifications', n.id.toString()), n).catch(e=>{}));
  };

  const markNotifsAsRead = async () => {
    if (!currentUser) return;
    const changed = [];
    setNotifications(prev => {
      const next = (prev || []).map(n => {
        if (!isNotificationForUser(n, currentUser) || (n.readBy || []).includes(currentUser.name)) return n;
        const updated = { ...n, readBy: [...(n.readBy || []), currentUser.name] };
        changed.push(updated);
        return updated;
      });
      if (isLocalMock) localStorage.setItem('kalpa_notifs', JSON.stringify(next));
      return next;
    });
    changed.forEach(n => setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'notifications', n.id.toString()), n).catch(e=>{}));
  };

  const requestDesktopNotifications = async () => {
    try {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        alert('Desktop notifications are not supported in this browser.');
        return;
      }
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      const enabled = permission === 'granted';
      setDesktopNotificationsEnabled(enabled);
      localStorage.setItem('kalpa_desktop_notifications', enabled ? 'true' : 'false');
      if (enabled) new Notification('Kalpvriksha Designs Ops', { body: 'Desktop notifications enabled.' });
    } catch(e) {
      console.warn('Desktop notification permission failed', e);
    }
  };



  const handleUpdateUser = async (u) => {
    let normalizedUser = normalizeTeamUser(u);
    const changedBy = currentUser?.name || normalizedUser.name || 'System';
    setUsers(prev => {
      const source = normalizeTeamUsers(prev && prev.length ? prev : INITIAL_USERS);
      const existing = source.find(x => String(x.id) === String(normalizedUser.id) || (normalizedUser.username && x.username === normalizedUser.username)) || {};
      const eventType = detectEmployeeLifecycleEventType(existing, normalizedUser);
      const eventDetails = {
        previousRole: existing.role || '',
        nextRole: normalizedUser.role || '',
        previousStatus: existing.status || '',
        nextStatus: normalizedUser.status || ''
      };
      const lifecycleEvents = [
        ...(Array.isArray(normalizedUser.lifecycleEvents) ? normalizedUser.lifecycleEvents : []),
        ...(eventType !== 'EMPLOYEE_UPDATED' ? [makeEmployeeLifecycleEvent(eventType, changedBy, eventDetails)] : [])
      ];
      normalizedUser = normalizeTeamUser(createEmployeeLifecycleProfile({ ...normalizedUser, lifecycleEvents }, existing));
      const exists = source.some(x => String(x.id) === String(normalizedUser.id) || (normalizedUser.username && x.username === normalizedUser.username));
      const next = exists
        ? source.map(x => (String(x.id) === String(normalizedUser.id) || (normalizedUser.username && x.username === normalizedUser.username)) ? normalizeTeamUser(createEmployeeLifecycleProfile({ ...x, ...normalizedUser }, x)) : x)
        : [...source, normalizedUser];
      saveLocal('kalpa_users', next);
      return next;
    });
    if (!firebaseUser) return;
    try { await setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'users', normalizedUser.id.toString()), normalizedUser); } catch(e){}
  };


  const recordLoginAttendance = async (user, loginNow = Date.now()) => {
    if (!user) return;
    const today = new Date(loginNow).toLocaleDateString('en-CA');
    const logId = `${user.id}_${today}`;
    const timeStr = new Date(loginNow).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    let updatedLog = null;
    setAttendanceLogs(prev => {
      const existing = prev.find(l => l.id === logId);
      updatedLog = {
        ...(existing || {}),
        id: logId,
        userId: user.id,
        name: user.name,
        role: user.role,
        date: today,
        loginTime: existing?.loginTime || timeStr,
        firstLogin: existing?.firstLogin || existing?.loginTime || timeStr,
        loginAt: existing?.loginAt || loginNow,
        firstLoginAt: existing?.firstLoginAt || existing?.loginAt || loginNow,
        logoutTime: '',
        logoutAt: null,
        isOnline: true,
        status: 'Online',
        currentBreakStartedAt: null,
        totalLoggedInMinutes: Math.max(0, Number(existing?.totalLoggedInMinutes) || 0),
        activeMinutes: Math.max(0, Number(existing?.activeMinutes) || 0),
        totalBreakMinutes: Math.max(0, Number(existing?.totalBreakMinutes) || 0),
        breakEvents: Array.isArray(existing?.breakEvents) ? existing.breakEvents : [],
        lastTick: loginNow
      };
      const next = existing ? prev.map(l => l.id === logId ? updatedLog : l) : [...prev, updatedLog];
      if (isLocalMock) localStorage.setItem('kalpa_attendance', JSON.stringify(next));
      return next;
    });
    if (!isLocalMock && firebaseUser && updatedLog) {
      try { await setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'attendanceLogs', logId), updatedLog); } catch(e){}
    }
  };

  const updateTodayAttendance = async (patcher) => {
    if (!currentUser) return;
    const today = new Date().toLocaleDateString('en-CA');
    const logId = `${currentUser.id}_${today}`;
    const now = Date.now();
    const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    let updatedLog = null;

    setAttendanceLogs(prev => {
      const existing = prev.find(l => l.id === logId) || {
        id: logId,
        userId: currentUser.id,
        name: currentUser.name,
        role: currentUser.role,
        date: today,
        loginTime: timeStr,
        logoutTime: timeStr,
        loginAt: now,
        logoutAt: now,
        totalLoggedInMinutes: 0,
        activeMinutes: 0,
        totalBreakMinutes: 0,
        currentBreakStartedAt: null,
        breakEvents: [],
        isOnline: true,
        status: 'Online',
        lastTick: now
      };
      updatedLog = patcher(existing, now, timeStr);
      const next = prev.some(l => l.id === logId) ? prev.map(l => l.id === logId ? updatedLog : l) : [...prev, updatedLog];
      if (isLocalMock) localStorage.setItem('kalpa_attendance', JSON.stringify(next));
      return next;
    });

    if (!isLocalMock && firebaseUser && updatedLog) {
      try { await setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'attendanceLogs', logId), updatedLog); } catch(e){}
    }
  };

  const handleLogin = (user) => {
    const loginNow = Date.now();
    const onlineUser = { ...user, isOnline: true, availability: 'Available', lastLoginAt: loginNow, lastSeenAt: loginNow, lastHeartbeatAt: loginNow, availabilityUpdatedAt: loginNow, breakStartedAt: null };
    setCurrentUser(onlineUser);
    recordLoginAttendance(onlineUser, loginNow);
    handleUpdateUser(onlineUser);
  };

  const handleLogout = () => {
    if (currentUser) {
      updateTodayAttendance((log, now, timeStr) => {
        const isOnBreak = currentUser.availability === 'Break' || log.status === 'On Break' || !!log.currentBreakStartedAt;
        const accrued = buildAttendanceAccrual(log, now, isOnBreak);
        const events = Array.isArray(log.breakEvents) ? log.breakEvents : [];
        const updatedEvents = events.map(ev => ev.start && !ev.end ? { ...ev, end: now, endTime: timeStr, minutes: Math.floor(Math.max(0, now - Number(ev.start)) / 60000) } : ev);
        return {
          ...log,
          ...accrued,
          logoutTime: timeStr,
          logoutAt: now,
          isOnline: false,
          status: 'Logged Out',
          currentBreakStartedAt: null,
          breakEvents: updatedEvents,
          lastTick: now
        };
      });
      const logoutNow = Date.now();
      const offlineUser = { ...currentUser, isOnline: false, availability: 'Unavailable', lastLogoutAt: logoutNow, lastSeenAt: logoutNow, lastHeartbeatAt: logoutNow, availabilityUpdatedAt: logoutNow, breakStartedAt: null };
      handleUpdateUser(offlineUser);
      postPresenceUpdate('logout', offlineUser);
    }
    setCurrentUser(null);
    setSelectedProject(null);
  };

  const toggleBreak = () => {
    if (!currentUser) return;
    const onBreak = currentUser.availability === 'Break';
    const now = Date.now();
    const updated = { ...currentUser, isOnline: true, availability: onBreak ? 'Available' : 'Break', breakStartedAt: onBreak ? null : now, availabilityUpdatedAt: now };
    updateTodayAttendance((log, ts, timeStr) => {
      const events = Array.isArray(log.breakEvents) ? log.breakEvents : [];
      if (!onBreak) {
        const accrued = buildAttendanceAccrual(log, ts, false);
        return {
          ...log,
          ...accrued,
          isOnline: true,
          status: 'On Break',
          currentBreakStartedAt: now,
          breakEvents: [...events, { start: now, startTime: timeStr }],
          lastTick: ts
        };
      }
      const accrued = buildAttendanceAccrual(log, ts, true);
      const updatedEvents = events.map(ev => ev.start && !ev.end ? { ...ev, end: ts, endTime: timeStr, minutes: Math.floor(Math.max(0, ts - Number(ev.start)) / 60000) } : ev);
      return {
        ...log,
        ...accrued,
        isOnline: true,
        status: 'Online',
        currentBreakStartedAt: null,
        breakEvents: updatedEvents,
        lastTick: ts
      };
    });
    setCurrentUser(updated);
    handleUpdateUser(updated);
    postPresenceUpdate(onBreak ? 'resume' : 'break', updated);
  };

  const handleLeadFileChange = (e) => {
      if (e.target.files) {
          setLeadFiles([...leadFiles, ...Array.from(e.target.files)]);
      }
  };

  const removeLeadFile = (idxToRemove) => {
      setLeadFiles(leadFiles.filter((_, idx) => idx !== idxToRemove));
  };

  if (authError) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-red-50 p-8 rounded-3xl border-2 border-red-200 w-full max-w-lg text-center shadow-2xl">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-black text-red-700 mb-2">Cloud Connection Blocked</h2>
          <p className="text-slate-800 font-medium mb-6">Firebase rejected the login attempt with the following error:</p>
          <div className="bg-white p-4 rounded-xl border border-red-100 text-sm text-red-600 font-mono text-left mb-6 overflow-x-auto">
             {authError}
          </div>
          <div className="bg-orange-50 p-4 rounded-xl border border-orange-200 text-left">
            <p className="font-bold text-orange-800 mb-2">How to fix this right now:</p>
            <ol className="list-decimal pl-5 text-sm text-orange-700 space-y-1 font-medium mb-4">
              <li>Turn off Ad-blockers or Brave Shields for this page.</li>
              <li>Go to the <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="underline font-bold">Firebase Console</a></li>
              <li>Click <strong>Authentication</strong> on the left menu.</li>
              <li>Click the <strong>Sign-in method</strong> tab at the top.</li>
              <li>Make sure <strong>Anonymous</strong> is set to <span className="text-emerald-600 font-bold">Enabled</span>.</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  if ((USE_BACKEND_STATE ? !isDbReady : (!firebaseUser || !isDbReady))) {
    return <PageLoadingScreen />;
  }

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} users={activeUsers} onRecoverPassword={handleUpdateUser} />;
  }

  const canManage = currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.MANAGER;
  if (currentUser.role === ROLES.DESIGNER && activeTab === 'board') setTimeout(() => setActiveTab('command'), 0);
  const myNotifs = getVisibleNotifications(notifications, currentUser)
    .map(n => ({ ...n, category: n.category || getNotificationCategory(n), priority: n.priority || getNotificationPriority(n) }));
  const unreadNotifs = myNotifs.filter(n => !(n.readBy||[]).includes(currentUser.name)).length;
  const notificationCounts = NOTIFICATION_CATEGORIES.reduce((acc, label) => {
    acc[label] = label === 'All' ? myNotifs.length : myNotifs.filter(n => n.category === label).length;
    return acc;
  }, {});
  const filteredNotifs = myNotifs.filter(n => {
    if (notifFilter !== 'All' && n.category !== notifFilter) return false;
    const q = notifSearch.trim().toLowerCase();
    if (!q) return true;
    return [n.title, n.category, n.priority, n.type, n.time].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
  const activityTimeline = buildActivityTimeline(projects, chatMessages, notifications);
  const normalizedGlobalSearch = globalSearch.trim().toLowerCase();
  const globalCaseResults = !normalizedGlobalSearch ? [] : (projects || [])
    .filter(p => [p.id, p.client, p.bankName, p.branchName, p.customerName, p.location, p.assignedTo, p.type, p.status, p.description, p.paymentStatus, p.paymentTrackingStatus]
      .filter(Boolean).join(' ').toLowerCase().includes(normalizedGlobalSearch))
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  const globalPeopleResults = !normalizedGlobalSearch ? [] : (activeUsers || [])
    .filter(u => [u.name, u.username, u.role, u.availability, u.status].filter(Boolean).join(' ').toLowerCase().includes(normalizedGlobalSearch))
    .slice(0, 8);
  const globalNotificationResults = !normalizedGlobalSearch ? [] : (myNotifs || [])
    .filter(n => [n.title, n.message, n.type, n.category, n.priority, n.time].filter(Boolean).join(' ').toLowerCase().includes(normalizedGlobalSearch))
    .slice(0, 8);
  const globalChatResults = !normalizedGlobalSearch ? [] : (chatMessages || [])
    .filter(m => [m.sender, m.text, m.channel, m.to, m.fileName].filter(Boolean).join(' ').toLowerCase().includes(normalizedGlobalSearch))
    .sort((a, b) => Number(b.createdAt || b.id || 0) - Number(a.createdAt || a.id || 0))
    .slice(0, 8);

  const persistSavedGlobalFilters = (nextFilters) => {
    const clean = (nextFilters || []).filter(f => f && f.query).slice(0, 12);
    setSavedGlobalFilters(clean);
    try { localStorage.setItem('kalpa_saved_global_filters', JSON.stringify(clean)); } catch (e) {}
  };
  const saveCurrentGlobalFilter = () => {
    const query = globalSearch.trim();
    if (!query) return;
    const label = (savedFilterName || query).trim().slice(0, 48);
    const filter = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label,
      query,
      tab: activeTab,
      createdAt: Date.now(),
      createdBy: currentUser?.name || 'User'
    };
    const withoutDuplicate = savedGlobalFilters.filter(f => f.query.toLowerCase() !== query.toLowerCase());
    persistSavedGlobalFilters([filter, ...withoutDuplicate]);
    setSavedFilterName('');
  };
  const applySavedGlobalFilter = (filter) => {
    if (!filter?.query) return;
    setSelectedProject(null);
    setGlobalSearch(filter.query);
    if (filter.tab && filter.tab !== 'board') setActiveTab(filter.tab);
  };
  const removeSavedGlobalFilter = (filterId) => {
    persistSavedGlobalFilters(savedGlobalFilters.filter(f => f.id !== filterId));
  };

  const displayedProjects = projects
    .filter(p => {
      if (activeTab === 'my_tasks') {
        if (normalizePersonName(p.assignedTo) !== normalizePersonName(currentUser.name)) return false;
        const statusKey = normalizeWorkStatusForRevision(p.status || p.reviewStatus || '');
        const isRevisionForMe = p.showInMyTasks || isRevisionWorkItem(p) || statusKey.includes('REVISION') || hasActiveRevision(p);
        // Every assigned pending/revision task must appear instantly in My Tasks until completion,
        // regardless of selected date. This includes temporary revision work items created from Archive.
        if (p.status !== 'Completed' || isRevisionForMe) return true;
        if (!shouldShowOnOperationsDate(p, selectedBoardDate)) return false;
      } else if (activeTab === 'board' && !shouldShowOnOperationsDate(p, selectedBoardDate)) return false;
      const q = globalSearch.trim().toLowerCase();
      if (q) {
        const haystack = [p.id, p.client, p.bankName, p.branchName, p.customerName, p.location, p.assignedTo, p.type, p.status, p.description]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return (
    <div className={`min-h-screen bg-slate-50/50 font-sans text-slate-900 pb-20 antialiased selection:bg-indigo-100 selection:text-indigo-900 transition-colors duration-300 ${darkMode ? 'kd-dark' : ''}`}>
      
      
      <ActiveToasts notifications={notifications} currentUser={currentUser} />{showLocalBanner && <LocalModeBanner onClose={() => setShowLocalBanner(false)} />}

      {dbError === 'permission-denied' && <DatabasePermissionBanner />}

      <TopNavigation
        currentUser={currentUser}
        ROLES={ROLES}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        globalSearch={globalSearch}
        setGlobalSearch={setGlobalSearch}
        showNotifs={showNotifs}
        setShowNotifs={setShowNotifs}
        markNotifsAsRead={markNotifsAsRead}
        markNotificationRead={markNotificationRead}
        requestDesktopNotifications={requestDesktopNotifications}
        unreadNotifs={unreadNotifs}
        myNotifs={myNotifs}
        filteredNotifs={filteredNotifs}
        notificationCounts={notificationCounts}
        NOTIFICATION_CATEGORIES={NOTIFICATION_CATEGORIES}
        notifSearch={notifSearch}
        setNotifSearch={setNotifSearch}
        notifFilter={notifFilter}
        setNotifFilter={setNotifFilter}
        desktopNotificationsEnabled={desktopNotificationsEnabled}
        activityTimeline={activityTimeline}
        toggleBreak={toggleBreak}
        setShowProfilePanel={setShowProfilePanel}
        handleLogout={handleLogout}
      />

      {showProfilePanel && (
        <div className="kalpa-modal-backdrop fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="max-w-5xl mx-auto my-6">
            <div className="flex justify-end mb-3">
              <button type="button" onClick={() => setShowProfilePanel(false)} className="bg-white text-slate-700 px-4 py-2 rounded-xl font-black shadow-lg border border-slate-100 hover:bg-slate-50 flex items-center"><X className="w-4 h-4 mr-2" /> Close Profile</button>
            </div>
            <ProfileView currentUser={currentUser} onUpdateUser={handleUpdateUser} setCurrentUser={setCurrentUser} fileToBase64={fileToBase64} sendRealOtp={sendRealOtp} verifyRealOtp={verifyRealOtp} />
          </div>
        </div>
      )}

      <main className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-8 animate-in fade-in duration-300">
        <MobileSearchBar globalSearch={globalSearch} setGlobalSearch={setGlobalSearch} />
        
        {!globalSearch.trim() && !selectedProject && savedGlobalFilters.length > 0 && (
          <div className="bg-white border-2 border-slate-100 rounded-3xl p-4 mb-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><Filter className="w-4 h-4 text-indigo-500" /> Saved Filters</p>
              <button type="button" onClick={() => persistSavedGlobalFilters([])} className="text-[10px] font-black text-slate-400 hover:text-red-500">Clear all</button>
            </div>
            <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
              {savedGlobalFilters.map(filter => (
                <button key={filter.id} type="button" onClick={() => applySavedGlobalFilter(filter)} className="shrink-0 bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-100 rounded-2xl px-4 py-3 text-left transition-all">
                  <span className="block text-xs font-black text-slate-700 max-w-[180px] truncate">{filter.label}</span>
                  <span className="block text-[10px] font-bold text-slate-400 max-w-[180px] truncate">{filter.query}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {globalSearch.trim() && !selectedProject && (
          <div className="bg-white border-2 border-indigo-100 rounded-3xl p-4 sm:p-5 mb-6 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div><h2 className="font-black text-slate-800 flex items-center gap-2"><Search className="w-5 h-5 text-indigo-600" /> Global Search</h2><p className="text-xs font-bold text-slate-400">Cases, team, notifications and chat results for: {globalSearch}</p></div>
              <div className="flex flex-wrap gap-2">
                <input value={savedFilterName} onChange={e => setSavedFilterName(e.target.value)} placeholder="Filter name" className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-400" />
                <button type="button" onClick={saveCurrentGlobalFilter} className="text-xs font-black bg-indigo-600 text-white px-3 py-2 rounded-xl self-start sm:self-auto flex items-center gap-1.5"><Save className="w-3.5 h-3.5" /> Save Filter</button>
                <button type="button" onClick={() => setGlobalSearch('')} className="text-xs font-black bg-slate-100 text-slate-600 px-3 py-2 rounded-xl self-start sm:self-auto">Clear</button>
              </div>
            </div>

            {savedGlobalFilters.length > 0 && (
              <div className="mb-4 bg-indigo-50/60 border border-indigo-100 rounded-2xl p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" /> Saved Filters</p>
                  <span className="text-[10px] font-black text-indigo-400">{savedGlobalFilters.length}/12</span>
                </div>
                <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                  {savedGlobalFilters.map(filter => (
                    <div key={filter.id} className="shrink-0 flex items-center bg-white border border-indigo-100 rounded-xl shadow-sm overflow-hidden">
                      <button type="button" onClick={() => applySavedGlobalFilter(filter)} className="px-3 py-2 text-xs font-black text-slate-700 hover:bg-indigo-50 text-left">
                        <span className="block max-w-[180px] truncate">{filter.label}</span>
                        <span className="block text-[9px] text-slate-400 uppercase tracking-widest truncate max-w-[180px]">{filter.query}</span>
                      </button>
                      <button type="button" onClick={() => removeSavedGlobalFilter(filter.id)} className="px-2 py-3 text-slate-300 hover:text-red-500 hover:bg-red-50 border-l border-indigo-50" title="Remove saved filter"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <section className="lg:col-span-2">
                <div className="flex items-center justify-between mb-2"><h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Cases</h3><span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">{globalCaseResults.length}</span></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {globalCaseResults.slice(0, 10).map(p => (
                    <button key={p.id} type="button" onClick={() => openTaskDetail(p, activeTab || 'board')} className="kalpa-task-row text-left bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-100 rounded-2xl p-4 transition-all">
                      <p className="font-black text-slate-800">{p.id}</p>
                      <p className="text-xs font-bold text-slate-500 mt-1">{getCustomerDisplayName(p)} • {p.location}</p>
                      <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">{p.type} • {p.assignedTo || 'Unassigned'} • {p.status}</p>{getTaskDescription(p) && <p className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 mt-2 line-clamp-2"><span className="font-black">Description:</span> {getTaskDescription(p)}</p>}{getEstimateDetails(p) && <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mt-1 line-clamp-2"><span className="font-black">Estimate:</span> {getEstimateDetails(p)}</p>}
                    </button>
                  ))}
                  {globalCaseResults.length === 0 && <div className="md:col-span-2"><EmptyState icon={Search} title="No matching cases found" description="Try customer, bank, branch, location, task ID, status, payment status, or designer name." compact /></div>}
                </div>
              </section>

              <aside className="space-y-4">
                <section className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3"><h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Team</h3><span className="text-[10px] font-black text-slate-500 bg-white px-2 py-1 rounded-full">{globalPeopleResults.length}</span></div>
                  <div className="space-y-2">
                    {globalPeopleResults.map(u => <button key={u.id || u.username || u.name} type="button" onClick={() => setActiveTab('team')} className="w-full text-left bg-white border border-slate-100 rounded-xl p-3 hover:border-indigo-100"><p className="text-sm font-black text-slate-800">{u.name}</p><p className="text-[11px] font-bold text-slate-400">{u.role} • {u.availability || 'Unavailable'}</p></button>)}
                    {globalPeopleResults.length === 0 && <p className="text-xs font-bold text-slate-400">No team matches.</p>}
                  </div>
                </section>

                <section className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3"><h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Notifications</h3><span className="text-[10px] font-black text-slate-500 bg-white px-2 py-1 rounded-full">{globalNotificationResults.length}</span></div>
                  <div className="space-y-2">
                    {globalNotificationResults.map(n => <button key={n.id} type="button" onClick={() => { setShowNotifs(true); markNotificationRead(n.id); }} className="w-full text-left bg-white border border-slate-100 rounded-xl p-3 hover:border-indigo-100"><p className="text-sm font-black text-slate-800 line-clamp-1">{n.title || 'Notification'}</p><p className="text-[11px] font-bold text-slate-400 line-clamp-2">{n.message || n.category || n.type}</p></button>)}
                    {globalNotificationResults.length === 0 && <p className="text-xs font-bold text-slate-400">No notification matches.</p>}
                  </div>
                </section>

                <section className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3"><h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Chat</h3><span className="text-[10px] font-black text-slate-500 bg-white px-2 py-1 rounded-full">{globalChatResults.length}</span></div>
                  <div className="space-y-2">
                    {globalChatResults.map(m => <div key={m.id} className="bg-white border border-slate-100 rounded-xl p-3"><p className="text-sm font-black text-slate-800">{m.sender || 'Team'}</p><p className="text-[11px] font-bold text-slate-400 line-clamp-2">{m.text || m.fileName || 'Attachment'}</p></div>)}
                    {globalChatResults.length === 0 && <p className="text-xs font-bold text-slate-400">No chat matches.</p>}
                  </div>
                </section>
              </aside>
            </div>
          </div>
        )}

        {!selectedProject && (
          <MainTabNavigation currentUser={currentUser} ROLES={ROLES} activeTab={activeTab} setActiveTab={setActiveTab} />
        )}

        {selectedProject ? (
          <TaskDetailView project={selectedProject} user={currentUser} onBack={closeTaskDetail} onUpdateProject={handleUpdateProject} users={activeUsers} projects={projects} onDeleteTask={handleDeleteTask} />
        ) : activeTab === 'command' ? (
          <CommandCentreView projects={projects} users={activeUsers} attendanceLogs={attendanceLogs} currentUser={currentUser} onOpenPerformance={() => setActiveTab('productivity')} onSelectProject={(p) => openTaskDetail(p, 'command')} onNavigate={(target) => { if (target === 'newCase') { setShowNewLead(true); return; } if (target === 'notifications') { setShowNotifs(true); return; } setActiveTab(target); }} />
        ) : activeTab === 'productivity' ? (
          <ProductivityDashboard users={activeUsers} projects={projects} performanceRecords={performanceRecords} performanceSummary={performanceSummary} />
        ) : activeTab === 'closing' && currentUser.role === ROLES.ADMIN ? (
          <DailyClosingReport projects={projects} currentUser={currentUser} />
        ) : activeTab === 'reports' && currentUser.role === ROLES.ADMIN ? (
          <ReportsAnalyticsView projects={projects} users={activeUsers} currentUser={currentUser} />
        ) : (activeTab === 'settings' || activeTab === 'qa') && currentUser.role === ROLES.ADMIN ? (
          <SystemSettingsView projects={projects} users={activeUsers} currentUser={currentUser} />
        ) : activeTab === 'ledger' && currentUser.role === ROLES.ADMIN ? (
          <LedgerView projects={projects} onSelectProject={(p) => openTaskDetail(p, 'ledger')} />
        ) : activeTab === 'archive' ? (
          <HistoryArchiveView projects={projects} currentUser={currentUser} archiveViewState={archiveViewState} setArchiveViewState={setArchiveViewState} onSelectProject={(p) => openTaskDetail(p, 'archive')} onPaymentStatusChange={handlePaymentStatusChange} />
        ) : activeTab === 'team' ? (
          <TeamPerformanceView users={activeUsers} projects={projects} onUpdateUser={handleUpdateUser} currentUser={currentUser} onOpenPerformance={() => setActiveTab('productivity')} onSelectProject={(p) => openTaskDetail(p, 'team')} />
        ) : activeTab === 'attendance' ? (
          <AttendanceView attendanceLogs={attendanceLogs} users={activeUsers} projects={projects} />
        ) : activeTab === 'profile' ? (
          <ProfileView currentUser={currentUser} onUpdateUser={handleUpdateUser} setCurrentUser={setCurrentUser} fileToBase64={fileToBase64} sendRealOtp={sendRealOtp} verifyRealOtp={verifyRealOtp} />
        ) : activeTab === 'calculator' ? (
          <CalculatorView />
        ) : activeTab === 'meeting' ? (
          <TeamMeetingRoom currentUser={currentUser} safeAppId={safeAppId} />
        ) : (
          <ActiveOperationsView
            activeTab={activeTab}
            canManage={canManage}
            selectedBoardDate={selectedBoardDate}
            setSelectedBoardDate={setSelectedBoardDate}
            boardViewMode={boardViewMode}
            setBoardViewMode={setBoardViewMode}
            setLeadFiles={setLeadFiles}
            setShowNewLead={setShowNewLead}
            displayedProjects={displayedProjects}
            projects={projects}
            activeUsers={activeUsers}
            setSelectedProject={setSelectedProject}
            onSelectProject={(p) => openTaskDetail(p, activeTab || 'board')}
            nowTick={nowTick}
            ROLES={ROLES}
            currentUser={currentUser}
            getCustomerDisplayName={getCustomerDisplayName}
            getDraftElapsed={getDraftElapsed}
            getOperationalUsers={getOperationalUsers}
            isUserActuallyOnline={isUserActuallyOnline}
            onDiscussTask={openTaskDiscussion}
            onPaymentStatusChange={handlePaymentStatusChange}
          />
        )}
      </main>

      {globalFilePreview && (
        <PortalLayer isOpen={Boolean(globalFilePreview)} className="kalpa-preview-layer fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center" lockScrollClass="kalpa-preview-open" role="dialog" ariaModal={true} ariaLabel="File preview" onEscape={closeGlobalFilePreview} initialFocusSelector="button">
          <div className="kalpa-preview-card bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="kalpa-preview-header border-b border-slate-100 bg-white/95">
              <div className="kalpa-preview-title min-w-0 flex items-center gap-3">
                <div className={`${globalFilePreview.kind === 'image' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-red-50 text-red-600 border-red-100'} w-9 h-9 rounded-2xl flex items-center justify-center border shrink-0`}>
                  {globalFilePreview.kind === 'image' ? <ImageIcon className="w-4.5 h-4.5" /> : <FileText className="w-4.5 h-4.5" />}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{globalFilePreview.kind === 'image' ? 'Image Preview' : 'PDF Preview'}</p>
                  <h3 className="text-sm font-black text-slate-900 truncate">{globalFilePreview.name}</h3>
                </div>
              </div>
              <div className="kalpa-preview-toolbar flex items-center gap-1.5 shrink-0">
                <button type="button" onClick={() => updateGlobalPreviewZoom(-0.15)} className="kalpa-preview-btn" title="Zoom out (Ctrl -)"><ZoomOut className="w-4 h-4" /></button>
                <span className="kalpa-preview-zoom">{Math.round((globalFilePreviewUi.zoom || 1) * 100)}%</span>
                <button type="button" onClick={() => updateGlobalPreviewZoom(0.15)} className="kalpa-preview-btn" title="Zoom in (Ctrl +)"><ZoomIn className="w-4 h-4" /></button>
                <span className="kalpa-preview-separator hidden sm:inline-flex" />
                <button type="button" onClick={() => setGlobalFilePreviewUi(v => ({ ...v, zoom: 1, fitMode: 'width' }))} className="kalpa-preview-btn-text" title="Fit width">Fit Width</button>
                <button type="button" onClick={() => setGlobalFilePreviewUi(v => ({ ...v, zoom: 0.9, fitMode: 'page' }))} className="kalpa-preview-btn-text" title="Fit page">Fit Page</button>
                <button type="button" onClick={rotateGlobalPreview} className="kalpa-preview-btn-text" title="Rotate right"><RotateCw className="w-3.5 h-3.5" /> Rotate</button>
                <button type="button" onClick={resetGlobalPreviewView} className="kalpa-preview-btn" title="Reset view (Ctrl 0)"><RefreshCcw className="w-4 h-4" /></button>
                <span className="kalpa-preview-separator hidden lg:inline-flex" />
                <span className="kalpa-preview-page-pill hidden md:inline-flex">1 / 1</span>
                {globalFilePreview.url && !globalFilePreview.loading && !globalFilePreview.error && <button type="button" onClick={() => window.open(globalFilePreview.url, '_blank', 'noopener,noreferrer')} className="kalpa-preview-btn-text hidden sm:inline-flex" title="Open in new tab"><Maximize2 className="w-3.5 h-3.5" /> Open</button>}
                <button type="button" onClick={() => { const downloadUrl = getProjectFileDownloadUrl(globalFilePreview.doc); if (downloadUrl) window.open(downloadUrl, '_blank', 'noopener,noreferrer'); }} className="kalpa-preview-btn-text text-indigo-700" title="Download"><Download className="w-3.5 h-3.5" /> Download</button>
                <button type="button" onClick={closeGlobalFilePreview} className="kalpa-preview-close" title="Close (Esc)"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="kalpa-preview-stage flex-1 bg-slate-950 min-h-0 overflow-hidden">
              {globalFilePreview.loading ? (
                <div className="h-full min-h-[360px] flex items-center justify-center text-white font-black">Loading preview...</div>
              ) : globalFilePreview.error ? (
                <div className="h-full min-h-[360px] flex items-center justify-center">
                  <div className="bg-white rounded-3xl p-6 max-w-md text-center shadow-xl">
                    <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
                    <p className="font-black text-slate-900">Preview unavailable</p>
                    <p className="text-sm text-slate-500 mt-2 break-words">{globalFilePreview.error}</p>
                  </div>
                </div>
              ) : globalFilePreview.kind === 'image' ? (
                <div className="kalpa-preview-image-stage">
                  <img
                    src={globalFilePreview.url}
                    alt={globalFilePreview.name || 'Image preview'}
                    className="kalpa-preview-image"
                    style={{ transform: `scale(${globalFilePreviewUi.zoom}) rotate(${globalFilePreviewUi.rotation}deg)`, transformOrigin: 'center center', transition: 'transform 160ms ease' }}
                  />
                </div>
              ) : (
                <div className="kalpa-preview-pdf-stage" style={{ transform: `rotate(${globalFilePreviewUi.rotation}deg)`, transformOrigin: 'center center' }}>
                  <div
                    className="kalpa-preview-pdf-zoom-surface"
                    style={{
                      width: `${100 / Math.max(0.35, Number(globalFilePreviewUi.zoom || 1))}%`,
                      height: `${100 / Math.max(0.35, Number(globalFilePreviewUi.zoom || 1))}%`,
                      transform: `scale(${Math.max(0.35, Number(globalFilePreviewUi.zoom || 1))})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    <iframe
                      title={globalFilePreview.name || 'PDF preview'}
                      src={`${String(globalFilePreview.url || '').split('#')[0]}#toolbar=0&navpanes=0&view=${globalFilePreviewUi.fitMode === 'page' ? 'Fit' : 'FitH'}`}
                      className="kalpa-preview-pdf-frame"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </PortalLayer>
      )}

      {!showNewLead && <CommunicationHub currentUser={currentUser} users={activeUsers} chatMessages={chatMessages} onSendMessage={handleSendMessage} onDeleteMessage={handleDeleteMessage} onUpdateMessage={handleUpdateMessage} onMarkMessagesRead={handleMarkMessagesRead} appId={safeAppId} projects={projects} onOpenTaskReference={openTaskReferenceFromChat} onPreviewFile={openUnifiedFilePreview} />}

      {!selectedProject && !showNewLead && <MobileBottomNavigation currentUser={currentUser} ROLES={ROLES} activeTab={activeTab} setActiveTab={setActiveTab} unreadNotifs={unreadNotifs} />}

      {showNewLead && (
        <PortalLayer isOpen={showNewLead} className="kalpa-lead-modal" lockScrollClass="kalpa-create-task-open" role="dialog" ariaModal={true} ariaLabel="Create task" onEscape={() => setShowNewLead(false)} initialFocusSelector="input[name=client]">
          <div className="kalpa-lead-modal-card bg-white shadow-2xl animate-in zoom-in-95 duration-200">
             <div className="kalpa-lead-modal-header">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-500 mb-1">Operations</p>
                  <h2 className="text-3xl font-black text-slate-800 tracking-tight">Log New Case</h2>
                </div>
                <IconButton label="Close create task modal" onClick={() => setShowNewLead(false)} className="kalpa-modal-icon-button"><X className="w-6 h-6 text-slate-600"/></IconButton>
             </div>
             
             <form noValidate className="kalpa-create-task-form" onSubmit={async (e) => {
               e.preventDefault();
               if (isSubmittingLead) return;
               setIsSubmittingLead(true);
               setCreateTaskError('');
               try {
               const fd = new FormData(e.target);
               
               const client = fd.get('client');
               const bankerName = ''; // banker/loan officer removed from simplified operational form
               const customerName = fd.get('customerName');
               const location = fd.get('location');
               const taskType = newTaskCategory === 'Other' ? fd.get('otherType') : newTaskCategory;
               const taskId = generateTraceableTaskId({ location, client, bankerName, customerName, projects });
               forgetDeletedProjects(taskId);
               const docs = [];
               for (const file of leadFiles) {
                  try {
                    docs.push(await uploadProjectFile(file, taskId, 'source', currentUser.name));
                  } catch (fileErr) {
                    console.warn('Source file attach failed; creating task without this file:', fileErr);
                    docs.push({ id: Date.now() + Math.random(), name: file.name, type: 'source', date: new Date().toLocaleDateString(), uploadedBy: currentUser.name, size: file.size || 0, mimeType: file.type || 'application/octet-stream', uploadFailed: true });
                  }
               }

               const assignedTo = fd.get('assignedTo');
               const createdStamp = Date.now();
               const newP = {
                 id: taskId,
                 taskName: [taskType, customerName, location].filter(Boolean).join(' • '),
                 client, 
                 bankerName,
                 customerName,
                 location,
                 type: taskType,
                 description: fd.get('description') || '',
                 priority: fd.get('priority'), assignedTo, assignedBy: assignedTo !== 'Unassigned' ? currentUser.name : '', assignedAt: assignedTo !== 'Unassigned' ? createdStamp : null, assignmentVersion: assignedTo !== 'Unassigned' ? createdStamp : null,
                 dueDate: fd.get('dueDate') || null,
                 estimateDetails: fd.get('estimateDetails') || '', estimate: fd.get('estimate') || 0,
                 status: 'Lead Received', createdAt: createdStamp, updatedAt: createdStamp, syncVersion: createdStamp, createdBy: currentUser.name,
                 ownership: { createdBy: currentUser.name, assignedBy: assignedTo !== 'Unassigned' ? currentUser.name : '', assignedTo },
                 reassignmentHistory: assignedTo !== 'Unassigned' ? [{ from: 'Unassigned', to: assignedTo, by: currentUser.name, time: new Date(createdStamp).toLocaleString() }] : [],
                 documents: docs, timeline: [{id: createdStamp, text: 'Case Created', time: new Date(createdStamp).toLocaleString()}],
                 subTasks: [], notes: [], ledger: {}, reportSent: false
               };
               
               if (docs.length > 0) {
                   newP.timeline.push({ id: Date.now()+1, text: `${docs.length} Source File(s) Attached`, time: new Date().toLocaleString() });
               }

               // Fresh task IDs can be reused after local/dev resets. Clear any stale
               // deleted-id memory before the first local merge, otherwise the task
               // appears briefly and then vanishes on the next sync/filter pass.
               forgetDeletedProjects(newP.id, newP.caseId);
               rememberRecentCreatedProject(newP);
               rememberPendingCreatedProject(newP);
               const nextProjects = filterDeletedProjects(mergeProjectsByFreshness((projects || []).filter(p => String(p.id) !== String(newP.id)), [newP, ...getRecentCreatedProjects(), ...getPendingCreatedProjects()]));
               persistAndBroadcastProjects(nextProjects);
               setProjects(nextProjects);
               setSelectedBoardDate(formatDateKey(newP.createdAt));
               setActiveTab('board');
               try { window.localStorage.setItem('kalpa_projects', JSON.stringify(sanitizeProjectsForCache(filterDeletedProjects(nextProjects)))); } catch(e) {}
               if (USE_BACKEND_STATE && backendStateReady && isDbReady) {
                 try {
                   const saveData = await createTaskApi({
                     apiBase: API_BASE,
                     headers: jsonFinanceSafeHeaders,
                     currentUserRole: currentUser?.role || '',
                     task: sanitizeProjectForCache(newP)
                   });
                   if (saveData?.project || saveData?.case) {
                     const savedProject = saveData.project || saveData.case;
                     forgetPendingCreatedProjects(newP.id, newP.caseId);
                     rememberRecentCreatedProject(savedProject);
                     applyProjectSnapshot([savedProject], { source: 'create-confirmed' });
                   }
                 } catch (saveErr) {
                   console.warn('Immediate task save failed; local task is kept and background sync will retry:', saveErr.message);
                 }
               }
               if (firebaseUser && !isLocalMock) {
                   try { await setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'projects', newP.id), stripLargeLocalFilesForCloud(newP)); } catch(e){}
               }

               if (newP.assignedTo !== 'Unassigned') {
                   const targetRole = activeUsers.find(u => u.name === newP.assignedTo)?.role || ROLES.DESIGNER;
                   addNotification(targetRole, newP.assignedTo, `New Task Assigned: ${newP.id}`, 'info');
               }
               setShowNewLead(false);
               setLeadFiles([]);
               setNewTaskCategory(TASK_CATEGORIES[0]);
               } catch (err) {
                 console.error('Create task failed:', err);
                 setCreateTaskError(err?.message || 'Task could not be created. Please check required fields and try again.');
               } finally {
                 setIsSubmittingLead(false);
               }
             }} className="kalpa-create-task-form custom-scrollbar">
               
               <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
                 <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Bank Name</label><input required name="client" className="w-full border-2 border-slate-100 rounded-xl p-3.5 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-colors font-bold text-slate-800" placeholder="SBI Home Loans"/></div>
                 <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Customer Name</label><input required name="customerName" className="w-full border-2 border-slate-100 rounded-xl p-3.5 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-colors font-bold text-slate-800" placeholder="Rajesh Kumar"/></div>
                 <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Location</label><input required name="location" className="w-full border-2 border-slate-100 rounded-xl p-3.5 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-colors font-bold text-slate-800" placeholder="Varanasi"/></div>
               </div>

               <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                 <div>
                   <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Task Category</label>
                   <select required name="type" value={newTaskCategory} onChange={(e) => setNewTaskCategory(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3.5 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-colors font-bold text-slate-800 cursor-pointer">
                     {TASK_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                   </select>
                 </div>
                 <div>
                   <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Assign To</label>
                   <select name="assignedTo" className="w-full border-2 border-slate-100 rounded-xl p-3.5 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-colors font-bold text-indigo-700 cursor-pointer">
                     <option value="Unassigned">Leave Unassigned</option>
                     {getAssignmentRecommendations(activeUsers, projects).map(u => <option key={u.id} value={u.name}>{u.name} • {u.active}/{u.limit} active</option>)}
                   </select>
                   <div className="mt-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                     <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-2">Recommended now</p>
                     {getAssignmentRecommendations(activeUsers, projects).slice(0,3).map((u, idx) => (
                       <div key={u.id} className="flex justify-between items-center bg-white rounded-lg px-3 py-2 mb-1 border border-indigo-100">
                         <span className="text-xs font-extrabold text-slate-700">{idx + 1}. {u.name}</span>
                         <span className={`text-[10px] font-black px-2 py-1 rounded-md ${u.active >= u.limit ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>{u.active}/{u.limit} active</span>
                       </div>
                     ))}
                     <p className="text-[10px] font-bold text-indigo-500 mt-2">Daily task limit rises automatically: 5 → 10 → 15 as case volume increases.</p>
                   </div>
                 </div>
               </div>

               {newTaskCategory === 'Other' && (
                  <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Describe Custom Task</label><input name="otherType" className="w-full border-2 border-slate-100 rounded-xl p-3.5 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold text-slate-800"/></div>
               )}
               
               {newTaskCategory.toLowerCase().includes('estimate') && (
                  <div><label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Property Estimate Value to be Made</label><input name="estimateDetails" placeholder="e.g., ₹50,00,000" className="w-full border-2 border-slate-100 rounded-xl p-3.5 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold text-slate-800"/></div>
               )}

               <div>
                 <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Task Description / Special Instructions</label>
                 <textarea name="description" rows="3" className="w-full border-2 border-slate-100 rounded-xl p-3.5 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold text-slate-800 resize-none" placeholder="Add any special instruction, file note, banker request, route detail, revision context, or estimate instruction..."></textarea>
               </div>

               <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                 <div>
                   <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Priority</label>
                   <select name="priority" className="w-full border-2 border-slate-100 rounded-xl p-3.5 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold text-slate-800 cursor-pointer">
                     <option value="Normal">Normal</option><option value="High">High</option><option value="Urgent">Urgent</option>
                   </select>
                 </div>
                 <div>
                   <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Due Date (Optional)</label>
                   <input type="date" name="dueDate" className="w-full border-2 border-slate-100 rounded-xl p-3 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-bold text-slate-800 cursor-pointer" />
                 </div>
                 {currentUser.role === ROLES.ADMIN && (
                   <div><label className="text-xs font-black text-amber-600 uppercase tracking-widest block mb-2">Pricing Estimate (Admin Only)</label><input type="number" name="estimate" className="w-full border-2 border-amber-200 rounded-xl p-3.5 bg-amber-50 focus:bg-white focus:border-amber-400 outline-none font-bold text-amber-900" placeholder="₹ Amount"/></div>
                 )}
               </div>

               <div className="mt-6 pt-6 border-t-2 border-slate-100">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-3">Attach Initial Files (Optional)</label>
                  
                  {leadFiles.length > 0 && (
                     <div className="mb-4 space-y-2">
                        {leadFiles.map((file, idx) => (
                           <div key={idx} className="flex justify-between items-center bg-indigo-50 p-3 rounded-xl border border-indigo-100">
                              <span className="text-xs font-bold text-slate-700 flex items-center"><FileText className="w-4 h-4 mr-2 text-indigo-500"/> {file.name}</span>
                              <button type="button" onClick={() => removeLeadFile(idx)} className="text-slate-400 hover:text-red-500 bg-white p-1 rounded-md shadow-sm"><X className="w-4 h-4" /></button>
                           </div>
                        ))}
                     </div>
                  )}
                  
                  <label className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center hover:bg-slate-50 transition-colors cursor-pointer w-full bg-slate-50/50">
                    <div className="bg-indigo-100 p-3 rounded-2xl mb-3 shadow-sm"><Upload className="w-6 h-6 text-indigo-600" /></div>
                    <p className="font-bold text-slate-700 text-base mb-1">Click to attach source files</p>
                    <p className="font-medium text-slate-400 text-xs">Images, PDFs, or AutoCAD files</p>
                    <input type="file" multiple className="hidden" accept=".jpg,.jpeg,.png,.mp4,.mov,.avi,.mkv,.webm,.dwg,.dxf,.pdf,.xls,.xlsx,.doc,.docx" onChange={handleLeadFileChange} />
                  </label>
               </div>


               {createTaskError && (
                 <InlineAlert tone="error">{createTaskError}</InlineAlert>
               )}

               <Button type="submit" loading={isSubmittingLead} disabled={isSubmittingLead} size="xl" variant="primary" className="kalpa-create-task-button w-full mt-8">
                  {isSubmittingLead ? 'Uploading Files & Creating Task...' : 'Create Task'}
               </Button>
             </form>
          </div>
        </PortalLayer>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 20px; }
        .kalpa-empty-state { border-style: dashed; }
        .kalpa-soft-enter { animation: kalpaSoftEnter .22s ease-out both; }
        @keyframes kalpaSoftEnter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          * { scroll-behavior: auto !important; animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
        /* Dark Theme 2.0: contrast, cards, tables, badges, chat, notifications */
        .kd-dark {
          background: radial-gradient(circle at top left, rgba(79,70,229,.14), transparent 34%), #0b1220 !important;
          color: #f8fafc !important;
        }
        .kd-dark header,
        .kd-dark .sticky,
        .kd-dark .bg-white,
        .kd-dark .bg-white\/95,
        .kd-dark .bg-white\/90,
        .kd-dark .bg-white\/80,
        .kd-dark .bg-white\/70,
        .kd-dark .bg-white\/60 {
          background-color: rgba(15,23,42,.94) !important;
          color: #f8fafc !important;
          border-color: rgba(148,163,184,.24) !important;
        }
        .kd-dark .bg-slate-50,
        .kd-dark .bg-slate-50\/50,
        .kd-dark .bg-slate-100,
        .kd-dark .bg-slate-100\/70,
        .kd-dark .bg-slate-100\/80,
        .kd-dark .bg-slate-200,
        .kd-dark .bg-indigo-50,
        .kd-dark .bg-blue-50,
        .kd-dark .bg-violet-50 {
          background-color: rgba(30,41,59,.82) !important;
          color: #e2e8f0 !important;
          border-color: rgba(148,163,184,.24) !important;
        }
        .kd-dark .bg-emerald-50,
        .kd-dark .bg-green-50 { background-color: rgba(6,78,59,.36) !important; color: #bbf7d0 !important; border-color: rgba(52,211,153,.28) !important; }
        .kd-dark .bg-amber-50,
        .kd-dark .bg-yellow-50 { background-color: rgba(120,53,15,.36) !important; color: #fde68a !important; border-color: rgba(251,191,36,.28) !important; }
        .kd-dark .bg-red-50,
        .kd-dark .bg-rose-50 { background-color: rgba(127,29,29,.35) !important; color: #fecaca !important; border-color: rgba(248,113,113,.28) !important; }
        .kd-dark .text-slate-950,
        .kd-dark .text-slate-900,
        .kd-dark .text-slate-800,
        .kd-dark .text-slate-700,
        .kd-dark h1,
        .kd-dark h2,
        .kd-dark h3,
        .kd-dark h4,
        .kd-dark b,
        .kd-dark strong {
          color: #f8fafc !important;
          text-shadow: none !important;
        }
        .kd-dark .text-slate-600,
        .kd-dark .text-slate-500,
        .kd-dark .text-slate-400,
        .kd-dark small,
        .kd-dark .muted {
          color: #cbd5e1 !important;
        }
        .kd-dark .text-slate-300 { color: #e2e8f0 !important; }
        .kd-dark .text-indigo-600,
        .kd-dark .text-indigo-700,
        .kd-dark .text-blue-600,
        .kd-dark .text-blue-700 { color: #a5b4fc !important; }
        .kd-dark .text-emerald-600,
        .kd-dark .text-emerald-700,
        .kd-dark .text-green-600,
        .kd-dark .text-green-700 { color: #86efac !important; }
        .kd-dark .text-amber-600,
        .kd-dark .text-amber-700,
        .kd-dark .text-orange-600,
        .kd-dark .text-orange-700 { color: #fbbf24 !important; }
        .kd-dark .text-red-600,
        .kd-dark .text-red-700,
        .kd-dark .text-rose-600,
        .kd-dark .text-rose-700 { color: #fca5a5 !important; }
        .kd-dark .border-slate-50,
        .kd-dark .border-slate-100,
        .kd-dark .border-slate-200,
        .kd-dark .border-slate-300,
        .kd-dark .divide-slate-100 > :not([hidden]) ~ :not([hidden]),
        .kd-dark .divide-slate-200 > :not([hidden]) ~ :not([hidden]) {
          border-color: rgba(148,163,184,.22) !important;
        }
        .kd-dark table,
        .kd-dark thead,
        .kd-dark tbody,
        .kd-dark tr,
        .kd-dark td,
        .kd-dark th {
          color: #e5e7eb !important;
          border-color: rgba(148,163,184,.18) !important;
        }
        .kd-dark tbody tr:hover,
        .kd-dark .hover\:bg-slate-50:hover,
        .kd-dark .hover\:bg-indigo-50:hover {
          background-color: rgba(79,70,229,.16) !important;
        }
        .kd-dark input,
        .kd-dark textarea,
        .kd-dark select {
          background-color: rgba(15,23,42,.9) !important;
          color: #f8fafc !important;
          border-color: rgba(148,163,184,.34) !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.03) !important;
        }
        .kd-dark input::placeholder,
        .kd-dark textarea::placeholder { color: #94a3b8 !important; opacity: 1 !important; }
        .kd-dark button:not(.bg-indigo-600):not(.bg-slate-900):not(.bg-emerald-600):not(.bg-red-600):not(.bg-blue-600),
        .kd-dark .rounded-xl,
        .kd-dark .rounded-2xl,
        .kd-dark .rounded-3xl {
          border-color: rgba(148,163,184,.22) !important;
        }
        .kd-dark .shadow-sm,
        .kd-dark .shadow-md,
        .kd-dark .shadow-lg,
        .kd-dark .shadow-xl,
        .kd-dark .shadow-2xl {
          box-shadow: 0 18px 45px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.03) !important;
        }
        .kd-dark .opacity-40,
        .kd-dark .opacity-50,
        .kd-dark .opacity-60 {
          opacity: .85 !important;
        }
        .kd-dark .disabled\:opacity-70:disabled,
        .kd-dark button:disabled {
          opacity: .55 !important;
        }
        .kd-dark .kalpa-chat-panel,
        .kd-dark .kalpa-chat-shell {
          background: rgba(15,23,42,.98) !important;
          color: #f8fafc !important;
          border-color: rgba(148,163,184,.24) !important;
        }
        .kd-dark .kalpa-chat-bubble {
          color: #f8fafc !important;
        }
        .kd-dark .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #64748b; }
        .kd-dark .custom-scrollbar::-webkit-scrollbar-track { background-color: rgba(15,23,42,.35); }
        .kd-dark .backdrop-blur-xl,
        .kd-dark .backdrop-blur-2xl {
          backdrop-filter: blur(20px) saturate(150%) !important;
        }
        @media (max-width: 640px) {
          .kalpa-chat-shell-closed {
            inset: auto 1rem 1rem auto !important;
            left: auto !important;
            top: auto !important;
            width: auto !important;
            height: auto !important;
            max-width: calc(100vw - 2rem) !important;
            pointer-events: none !important;
          }
          .kalpa-chat-shell-open {
            inset: 0 !important;
            width: 100vw !important;
            height: 100dvh !important;
            pointer-events: auto !important;
          }
          .kalpa-chat-launcher { pointer-events: auto !important; }
        }

/* Kalpavriksha Theme Engine 3.0 — dark-mode readability and semantic surface fix
   Purpose: eliminate white-on-white / washed-out dark mode cards after Tailwind extraction.
   Scope: visual-only; no business logic touched. */
.kd-dark,
.kd-dark-root {
  --kd-bg: #07111f;
  --kd-bg-soft: #0b1220;
  --kd-surface: #111827;
  --kd-surface-2: #162033;
  --kd-surface-3: #1e293b;
  --kd-surface-hover: #24324a;
  --kd-border: rgba(148, 163, 184, 0.24);
  --kd-border-strong: rgba(148, 163, 184, 0.38);
  --kd-text: #f8fafc;
  --kd-text-2: #e2e8f0;
  --kd-text-3: #cbd5e1;
  --kd-muted: #94a3b8;
  --kd-faint: #64748b;
  --kd-accent: #a5b4fc;
  --kd-accent-strong: #818cf8;
  --kd-success: #86efac;
  --kd-warning: #fbbf24;
  --kd-danger: #fca5a5;
  --kd-shadow: 0 24px 60px rgba(0,0,0,.44), inset 0 1px 0 rgba(255,255,255,.04);
}

.kd-dark {
  background: radial-gradient(circle at 18% 0%, rgba(99,102,241,.20), transparent 30%), linear-gradient(135deg, #08111f 0%, #0b1220 45%, #091827 100%) !important;
  color: var(--kd-text) !important;
}

/* Surfaces: convert white/light cards and light gradients to true dark surfaces. */
.kd-dark .bg-white,
.kd-dark .bg-white\/95,
.kd-dark .bg-white\/90,
.kd-dark .bg-white\/80,
.kd-dark .bg-white\/70,
.kd-dark .bg-white\/60,
.kd-dark .bg-slate-50,
.kd-dark .bg-slate-50\/50,
.kd-dark .bg-slate-100,
.kd-dark .bg-slate-100\/70,
.kd-dark .bg-slate-100\/80,
.kd-dark .bg-slate-200,
.kd-dark .bg-gray-50,
.kd-dark .bg-gray-100,
.kd-dark .bg-zinc-50,
.kd-dark .bg-zinc-100 {
  background-color: var(--kd-surface) !important;
  color: var(--kd-text) !important;
  border-color: var(--kd-border) !important;
}

/* Tailwind gradient cards that used from-white/to-slate-50 were staying bright. */
.kd-dark .from-white,
.kd-dark .from-slate-50,
.kd-dark .from-gray-50,
.kd-dark .from-zinc-50 {
  --tw-gradient-from: var(--kd-surface) var(--tw-gradient-from-position) !important;
  --tw-gradient-to: rgba(17,24,39,0) var(--tw-gradient-to-position) !important;
  --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important;
}
.kd-dark .via-white,
.kd-dark .via-slate-50,
.kd-dark .via-gray-50 {
  --tw-gradient-stops: var(--tw-gradient-from), var(--kd-surface-2) var(--tw-gradient-via-position), var(--tw-gradient-to) !important;
}
.kd-dark .to-white,
.kd-dark .to-slate-50,
.kd-dark .to-gray-50,
.kd-dark .to-zinc-50,
.kd-dark .to-slate-100,
.kd-dark .to-gray-100 {
  --tw-gradient-to: var(--kd-surface-2) var(--tw-gradient-to-position) !important;
}
.kd-dark .bg-gradient-to-br.from-white,
.kd-dark .bg-gradient-to-br.from-slate-50,
.kd-dark .bg-gradient-to-r.from-white,
.kd-dark .bg-gradient-to-r.from-slate-50,
.kd-dark .bg-gradient-to-b.from-white,
.kd-dark .bg-gradient-to-b.from-slate-50 {
  background-image: linear-gradient(135deg, var(--kd-surface), var(--kd-surface-2)) !important;
  color: var(--kd-text) !important;
}

/* Common panels/cards/tables. */
.kd-dark table,
.kd-dark thead,
.kd-dark tbody,
.kd-dark tr,
.kd-dark td,
.kd-dark th,
.kd-dark .rounded-xl,
.kd-dark .rounded-2xl,
.kd-dark .rounded-3xl,
.kd-dark .shadow-sm,
.kd-dark .shadow-md,
.kd-dark .shadow-lg,
.kd-dark .shadow-xl,
.kd-dark .shadow-2xl {
  border-color: var(--kd-border) !important;
}
.kd-dark .shadow-sm,
.kd-dark .shadow-md,
.kd-dark .shadow-lg,
.kd-dark .shadow-xl,
.kd-dark .shadow-2xl {
  box-shadow: var(--kd-shadow) !important;
}
.kd-dark thead,
.kd-dark th {
  background: rgba(15,23,42,.72) !important;
  color: var(--kd-text-3) !important;
}
.kd-dark tbody tr,
.kd-dark td {
  color: var(--kd-text-2) !important;
}
.kd-dark tbody tr:hover,
.kd-dark .hover\:bg-slate-50:hover,
.kd-dark .hover\:bg-indigo-50:hover,
.kd-dark .hover\:bg-white:hover {
  background-color: var(--kd-surface-hover) !important;
}

/* Typography hierarchy: keep primary info readable; preserve semantic status colors below. */
.kd-dark h1,
.kd-dark h2,
.kd-dark h3,
.kd-dark h4,
.kd-dark h5,
.kd-dark h6,
.kd-dark .text-slate-950,
.kd-dark .text-slate-900,
.kd-dark .text-slate-800,
.kd-dark .text-gray-950,
.kd-dark .text-gray-900,
.kd-dark .text-gray-800,
.kd-dark strong,
.kd-dark b {
  color: var(--kd-text) !important;
}
.kd-dark .text-slate-700,
.kd-dark .text-slate-600,
.kd-dark .text-gray-700,
.kd-dark .text-gray-600 {
  color: var(--kd-text-2) !important;
}
.kd-dark .text-slate-500,
.kd-dark .text-slate-400,
.kd-dark .text-gray-500,
.kd-dark .text-gray-400,
.kd-dark small,
.kd-dark .muted {
  color: var(--kd-text-3) !important;
}
.kd-dark .text-slate-300,
.kd-dark .text-gray-300 {
  color: var(--kd-text-2) !important;
}
.kd-dark .text-white {
  color: var(--kd-text) !important;
}

/* Keep colored status text vivid. */
.kd-dark .text-indigo-600,
.kd-dark .text-indigo-700,
.kd-dark .text-blue-600,
.kd-dark .text-blue-700,
.kd-dark .text-violet-600,
.kd-dark .text-violet-700 { color: var(--kd-accent) !important; }
.kd-dark .text-emerald-600,
.kd-dark .text-emerald-700,
.kd-dark .text-green-600,
.kd-dark .text-green-700 { color: var(--kd-success) !important; }
.kd-dark .text-amber-600,
.kd-dark .text-amber-700,
.kd-dark .text-yellow-600,
.kd-dark .text-yellow-700,
.kd-dark .text-orange-600,
.kd-dark .text-orange-700 { color: var(--kd-warning) !important; }
.kd-dark .text-red-600,
.kd-dark .text-red-700,
.kd-dark .text-rose-600,
.kd-dark .text-rose-700 { color: var(--kd-danger) !important; }

/* Soft status badge backgrounds. */
.kd-dark .bg-indigo-50,
.kd-dark .bg-blue-50,
.kd-dark .bg-violet-50 { background-color: rgba(79,70,229,.20) !important; color: #c7d2fe !important; border-color: rgba(129,140,248,.30) !important; }
.kd-dark .bg-emerald-50,
.kd-dark .bg-green-50 { background-color: rgba(6,78,59,.34) !important; color: #bbf7d0 !important; border-color: rgba(52,211,153,.30) !important; }
.kd-dark .bg-amber-50,
.kd-dark .bg-yellow-50 { background-color: rgba(120,53,15,.34) !important; color: #fde68a !important; border-color: rgba(251,191,36,.30) !important; }
.kd-dark .bg-red-50,
.kd-dark .bg-rose-50 { background-color: rgba(127,29,29,.34) !important; color: #fecaca !important; border-color: rgba(248,113,113,.30) !important; }

/* Forms, filters, calendar inputs. */
.kd-dark input,
.kd-dark textarea,
.kd-dark select {
  background-color: rgba(15,23,42,.92) !important;
  color: var(--kd-text) !important;
  border-color: var(--kd-border-strong) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.04) !important;
}
.kd-dark input::placeholder,
.kd-dark textarea::placeholder {
  color: var(--kd-muted) !important;
  opacity: 1 !important;
}

/* Navigation/tab bar and non-primary buttons. */
.kd-dark .sticky,
.kd-dark header,
.kd-dark nav {
  background-color: rgba(11,18,32,.94) !important;
  color: var(--kd-text) !important;
  border-color: var(--kd-border) !important;
}
.kd-dark button:not(.bg-indigo-600):not(.bg-slate-900):not(.bg-emerald-600):not(.bg-red-600):not(.bg-blue-600):not(.bg-violet-600):not(.bg-purple-600) {
  border-color: var(--kd-border) !important;
}

/* Command Centre / operations flow boxes that previously became blank white. */
.kd-dark .kalpa-empty-state,
.kd-dark [class*="min-h-"][class*="rounded"],
.kd-dark [class*="border-2"][class*="rounded"] {
  border-color: var(--kd-border) !important;
}
.kd-dark .opacity-40,
.kd-dark .opacity-50,
.kd-dark .opacity-60 {
  opacity: .92 !important;
}
.kd-dark .disabled\:opacity-70:disabled,
.kd-dark button:disabled {
  opacity: .62 !important;
}

/* Chat/notification floating surfaces. */
.kd-dark .kalpa-chat-panel,
.kd-dark .kalpa-chat-shell,
.kd-dark .kalpa-chat-sidebar,
.kd-dark .kalpa-chat-main {
  background: rgba(15,23,42,.98) !important;
  color: var(--kd-text) !important;
  border-color: var(--kd-border) !important;
}
.kd-dark .kalpa-chat-bubble {
  color: var(--kd-text) !important;
}

/* Scrollbars. */
.kd-dark ::-webkit-scrollbar-thumb { background-color: #475569; border-radius: 999px; }
.kd-dark ::-webkit-scrollbar-track { background-color: rgba(15,23,42,.35); }
.kd-dark .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #64748b; }
.kd-dark .custom-scrollbar::-webkit-scrollbar-track { background-color: rgba(15,23,42,.35); }

      `}} />
    </div>
  );
}

export default function App() {
  return <AppErrorBoundary><AppShell /></AppErrorBoundary>;
}

