import React, { useState, useEffect, useRef } from 'react';
import { 
  Briefcase, CheckCircle, Clock, FileText, LayoutDashboard, LogOut, 
  MapPin, Plus, Search, User, Users, Wallet, ArrowRight, Upload, 
  List, MessageSquare, Bell, Paperclip, X, Image as ImageIcon, 
  File as FileIcon, Archive, Send, Flag, Shield, Hash, Video, Phone,
  Calendar, Filter, Check, ArrowLeft, Download, ChevronRight, Lock, Eye, EyeOff, Map as MapIcon, AlertCircle, KanbanSquare, Link as LinkIcon, BarChart3, Building2, Smile, Star, Mic, Square
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, deleteDoc, getDocs } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

// 👇 SMART CONFIG: Safely connects to your real database 👇
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

const API_BASE = import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || 'http://localhost:8080';
// Production mode uses the central backend/PostgreSQL state first.
// Firebase/localStorage are kept only as UI fallback/cache.
const USE_BACKEND_STATE = true;
const isLocalMock = !USE_BACKEND_STATE && getFirebaseConfig().apiKey === "mock-key";

const createOpsBroadcast = () => {
  try {
    if (typeof BroadcastChannel !== 'undefined') return new BroadcastChannel('kalpavriksha_ops_sync');
  } catch (e) {}
  return null;
};
const opsBroadcast = createOpsBroadcast();
const OPS_TAB_ID = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const MAX_INLINE_DATA_URL_CHARS = 180000;

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

const getDeletedProjectIds = () => {
  try { return JSON.parse(localStorage.getItem('kalpa_deleted_project_ids') || '[]').map(x => String(x)).filter(Boolean); } catch(e) { return []; }
};
const saveDeletedProjectIds = (ids = []) => {
  const unique = [...new Set((ids || []).map(x => String(x)).filter(Boolean))];
  try { localStorage.setItem('kalpa_deleted_project_ids', JSON.stringify(unique)); } catch(e) {}
  return unique;
};
const rememberDeletedProjects = (...ids) => saveDeletedProjectIds([...getDeletedProjectIds(), ...ids.flat().map(x => String(x)).filter(Boolean)]);
const filterDeletedProjects = (projects = []) => {
  const deleted = new Set(getDeletedProjectIds());
  return (Array.isArray(projects) ? projects : []).filter(p => p && !deleted.has(String(p.id || '')) && !deleted.has(String(p.caseId || '')));
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

const OTP_API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) ? import.meta.env.VITE_API_URL : 'http://localhost:8080';
const buildOtpError = (error) => {
  if (error?.name === 'TypeError' || String(error?.message || '').toLowerCase().includes('failed to fetch')) {
    return 'OTP backend is not reachable. Start the backend first with: npm run dev:all, or run backend on port 8080.';
  }
  return error?.message || 'OTP service error.';
};
const sendRealOtp = async ({ username, mobile, email, channel, purpose }) => {
  try {
    const res = await fetch(`${OTP_API_BASE}/api/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, mobile, email, channel, purpose })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'OTP service is not configured or reachable.');
    return data;
  } catch (error) {
    throw new Error(buildOtpError(error));
  }
};
const verifyRealOtp = async ({ challengeId, otp, purpose }) => {
  try {
    const res = await fetch(`${OTP_API_BASE}/api/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, otp, purpose })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'OTP verification failed.');
    return data;
  } catch (error) {
    throw new Error(buildOtpError(error));
  }
};


const formatLastSeenDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const ONLINE_STALE_MS = 2 * 60 * 1000;
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

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = error => reject(error);
});

const cleanFileName = (name = 'file') => String(name).replace(/[^a-zA-Z0-9._-]/g, '_');

const uploadProjectFile = async (file, projectId, type, uploadedBy) => {
  const baseDoc = {
    id: Date.now() + Math.random(),
    name: file.name,
    type,
    date: new Date().toLocaleDateString(),
    uploadedBy,
    size: file.size || 0,
    mimeType: file.type || 'application/octet-stream'
  };

  // Important: keep the upload experience instant and reliable.
  // The selected file is converted in the browser first, so it appears immediately
  // in Completed Work even if Firebase Storage rules/network fail.
  return { ...baseDoc, url: URL.createObjectURL(file), localOnly: true };
};

const stripLargeLocalFilesForCloud = (project) => sanitizeProjectForCache(project);

const allProjectDocs = (project) => {
  const docs = [...(project?.documents || []), ...(project?.completedFiles || [])];
  const seen = new Set();
  return docs.filter((doc) => {
    const key = doc?.id || doc?.url || `${doc?.name}-${doc?.type}-${doc?.uploadedBy}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const isCompletedDocument = (doc) => {
  const value = String(doc?.type || doc?.folder || doc?.category || doc?.documentType || doc?.status || '').toLowerCase();
  return ['completed', 'final', 'finished', 'submitted'].includes(value) && !String(doc?.name || '').toLowerCase().includes('qr');
};
const getCompletedDocuments = (project) => allProjectDocs(project).filter(isCompletedDocument);
const getLatestCompletedFileName = (project) => {
  const completed = getCompletedDocuments(project);
  return completed.length ? completed[completed.length - 1].name : '';
};

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

const normalizeTeamUsers = (list = []) => {
  const source = (Array.isArray(list) && list.length ? list : INITIAL_USERS).map(normalizeTeamUser);
  const byKey = new Map();
  source.forEach(u => {
    const key = String(u.username || identityKey(u.name) || u.id);
    const prev = byKey.get(key) || {};
    byKey.set(key, normalizeTeamUser({ ...prev, ...u, id: prev.id || u.id }));
  });
  return [...byKey.values()];
};

const normalizePersonName = (name = '') => normalizeTeamUser({ name, username: name }).name || name;
const identityKey = (value = '') => normalizePersonName(String(value || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
const samePerson = (a = '', b = '') => identityKey(a) === identityKey(b);

const createSafeMeetingRoomName = (...parts) => parts
  .filter(Boolean)
  .map(part => String(part).trim())
  .join('_')
  .replace(/[^a-zA-Z0-9_-]/g, '_')
  .replace(/_+/g, '_')
  .slice(0, 96) || 'KalpaVriksha_Meeting';

const buildJitsiUrl = (roomName, displayName, options = {}) => {
  const base = `https://meet.jit.si/${createSafeMeetingRoomName(roomName)}`;
  const params = new URLSearchParams({
    lang: 'en',
    'userInfo.displayName': displayName || 'Kalpvriksha Team'
  });
  const config = [
    'config.defaultLanguage="en"',
    'config.prejoinPageEnabled=true',
    'config.disableDeepLinking=true',
    'config.enableClosePage=false',
    'config.enableWelcomePage=false',
    'config.readOnlyName=true',
    options.audioOnly ? 'config.startAudioOnly=true' : '',
    (options.muteAudio || options.shareScreen) ? 'config.startWithAudioMuted=true' : '',
    (options.muteVideo || options.shareScreen || options.audioOnly) ? 'config.startWithVideoMuted=true' : '',
    options.shareScreen ? 'config.startScreenSharing=true' : ''
  ].filter(Boolean).join('&');
  return `${base}?${params.toString()}#${config}`;
};

const copyTextToClipboard = async (text) => {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch (e) { return false; }
};

const formatCallDuration = (startedAt, nowMs = Date.now()) => {
  if (!startedAt) return '00:00';
  const total = Math.max(0, Math.floor((nowMs - Number(startedAt)) / 1000));
  const mins = Math.floor(total / 60).toString().padStart(2, '0');
  const secs = (total % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};
const readEntryName = (entry) => typeof entry === 'string' ? entry : (entry?.name || '');
const hasReadBy = (message, userName) => (message?.readBy || []).some(r => samePerson(readEntryName(r), userName));

const normalizeProjectRecord = (project = {}) => {
  const assignedTo = normalizePersonName(project.assignedTo || '');
  const createdBy = normalizePersonName(project.createdBy || '');
  const manager = normalizePersonName(project.manager || '');
  return {
    ...project,
    assignedTo: assignedTo || project.assignedTo,
    createdBy: createdBy || project.createdBy,
    manager: manager || project.manager,
    taskName: project.taskName || makeTaskDisplayName(project)
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
  const normalized = filterDeletedProjects(applyAssignmentLedgerToProjects(normalizeProjectRecords(projects)));
  normalized.forEach(recordAssignmentLedger);
  const compact = sanitizeProjectsForCache(normalized);
  try { localStorage.setItem('kalpa_projects_backup', JSON.stringify(compact)); } catch(e) {}
  try { localStorage.setItem('kalpa_projects', JSON.stringify(compact)); } catch(e) {}
  broadcastProjectsSync(compact);
  return normalized;
};

const getStatusColor = (status) => {
  switch (status) {
    case 'Lead Received': return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'Drafting': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'Internal Review': return 'bg-purple-100 text-purple-700 border-purple-200';
    case 'Completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    default: return 'bg-slate-100 text-slate-700 border-slate-200';
  }
};

const getPriorityColor = (priority, dueDate) => {
  if (dueDate && new Date(dueDate).getTime() < Date.now()) return 'text-red-700 bg-red-100 border-red-300 animate-pulse';
  switch (priority) {
    case 'Urgent': return 'text-red-600 bg-red-50 border-red-200';
    case 'High': return 'text-orange-600 bg-orange-50 border-orange-200';
    default: return 'text-slate-600 bg-slate-50 border-slate-200';
  }
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

const Badge = ({ children, colorClass }) => (
  <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${colorClass}`}>
    {children}
  </span>
);

const PageLoadingScreen = ({ title = 'Connecting to Secure Cloud...', subtitle = 'Preparing Kalpvriksha Designs Ops' }) => (
  <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 flex items-center justify-center p-6">
    <div className="bg-white/90 backdrop-blur rounded-[2rem] border-2 border-slate-100 shadow-2xl px-8 py-10 w-full max-w-md text-center animate-in fade-in zoom-in-95 duration-300">
      <div className="relative mx-auto mb-6 w-20 h-20">
        <div className="absolute inset-0 rounded-3xl bg-indigo-100 animate-pulse"></div>
        <div className="absolute inset-2 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
          <LayoutDashboard className="text-white w-9 h-9" />
        </div>
      </div>
      <p className="text-slate-800 font-black tracking-tight text-lg">{title}</p>
      <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-2">{subtitle}</p>
      <div className="mt-6 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full w-1/2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full animate-pulse"></div>
      </div>
    </div>
  </div>
);

const EmptyState = ({ icon: Icon = FileText, title = 'Nothing to show yet', description = 'New activity will appear here automatically.', action = null, compact = false }) => (
  <div className={`w-full rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/70 ${compact ? 'p-5' : 'p-8'} text-center animate-in fade-in duration-200`}>
    <div className={`${compact ? 'w-11 h-11' : 'w-14 h-14'} rounded-2xl bg-white border border-slate-100 shadow-sm mx-auto mb-3 flex items-center justify-center`}>
      <Icon className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} text-slate-400`} />
    </div>
    <p className="text-sm font-black text-slate-700">{title}</p>
    {description && <p className="text-xs font-bold text-slate-400 mt-1 max-w-md mx-auto">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

const MiniEmptyState = ({ children }) => (
  <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-xs font-bold text-slate-400 text-center animate-in fade-in duration-200">
    {children}
  </div>
);

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

const formatDateKey = (value = Date.now()) => {
  try {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch(e) { return new Date().toLocaleDateString('en-CA'); }
};

const formatDateTime = (value) => {
  if (!value) return '-';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    return '-';
  }
};

const formatDuration = (start, end = Date.now()) => {
  if (!start) return '-';
  const diff = Math.max(0, (end || Date.now()) - start);
  const totalMins = Math.floor(diff / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
};

const formatMinutes = (minutes = 0) => {
  const safe = Math.max(0, Math.floor(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
};

const getAttendanceUser = (log, users = []) => {
  return (users || []).find(u => String(u.id) === String(log.userId))
    || (users || []).find(u => samePerson(u.name, log.name))
    || null;
};

const getBreakMinutesFromLog = (log = {}, now = Date.now()) => {
  const stored = Number(log.totalBreakMinutes) || 0;
  const openBreak = log.currentBreakStartedAt ? Math.floor(Math.max(0, now - Number(log.currentBreakStartedAt)) / 60000) : 0;
  return stored + openBreak;
};

const getProjectDateKey = (project) => formatDateKey(project.createdAt || project.completedAt || Date.now());

const getDraftElapsed = (project, now = Date.now()) => {
  if (!project?.draftingStartedAt) return '-';
  return formatDuration(project.draftingStartedAt, project.draftingCompletedAt || project.submittedAt || project.completedAt || now);
};


const getTodayStart = () => new Date().setHours(0,0,0,0);

const getDailyTaskLimit = (projects = []) => {
  const todayStart = getTodayStart();
  const todayCount = projects.filter(p => (p.createdAt || 0) >= todayStart).length;
  if (todayCount >= 10) return 15;
  if (todayCount >= 5) return 10;
  return 5;
};

const makeCodePart = (value = '', fallback = 'GEN') => {
  const clean = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim()
    .toUpperCase();
  if (!clean) return fallback;
  const words = clean.split(/\s+/).filter(Boolean);
  const token = words.length >= 2 ? words.map(w => w[0]).join('') : words[0];
  return (token || fallback).slice(0, 4);
};

const generateTraceableTaskId = ({ location = '', client = '', bankerName = '', customerName = '', projects = [] } = {}) => {
  // Format requested: LOCATION-BANK-CUSTOMER-NUMBER
  // Short forms are generated automatically from the details entered in Add Case.
  const loc = makeCodePart(location, 'LOC');
  const bank = makeCodePart(client, 'BANK');
  const person = makeCodePart(customerName, 'CASE');
  const prefix = `${loc}-${bank}-${person}`;
  const count = (projects || []).filter(p => String(p.id || '').startsWith(`${prefix}-`)).length + 1;
  return `${prefix}-${String(count).padStart(4, '0')}`;
};

const getCustomerDisplayName = (project = {}) => project.customerName || 'Customer not added';
const getBankDisplayName = (project = {}) => project.client || project.bankName || 'Bank not added';
const getCompletedFileBadge = (project = {}) => getLatestCompletedFileName(project) || '';

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
  const pendingCollections = projects.filter(p => (Number(p.estimate) || 0) > (Number(p.ledger?.amountIn) || 0));
  const paymentsToday = projects.filter(p => p.ledger?.updatedAt && formatDateKey(p.ledger.updatedAt) === dateKey);
  const revisions = activeToday.filter(p => (p.subTasks || []).some(st => st.status !== 'Done'));
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


const ProfileView = ({ currentUser, onUpdateUser, setCurrentUser }) => {
  const [draft, setDraft] = useState({
    phone: currentUser.phone || '',
    email: currentUser.email || '',
    address: currentUser.address || '',
    aadharNumber: currentUser.aadharNumber || '',
    panNumber: currentUser.panNumber || '',
    emergencyContact: currentUser.emergencyContact || '',
    designation: currentUser.designation || currentUser.role || '',
    bankDetails: currentUser.bankDetails || '',
    profilePhoto: currentUser.profilePhoto || ''
  });
  const [saved, setSaved] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordMessage, setPasswordMessage] = useState('');
  const [mobileOtp, setMobileOtp] = useState('');
  const [mobileChallengeId, setMobileChallengeId] = useState('');
  const [mobileMessage, setMobileMessage] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [emailChallengeId, setEmailChallengeId] = useState('');
  const [emailMessage, setEmailMessage] = useState('');

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const base64 = await fileToBase64(file);
    setDraft(prev => ({ ...prev, profilePhoto: base64 }));
  };

  const handleSave = () => {
    const phoneChanged = String(draft.phone || '').replace(/\D/g, '') !== String(currentUser.phone || '').replace(/\D/g, '');
    const emailChanged = String(draft.email || '').trim().toLowerCase() !== String(currentUser.email || '').trim().toLowerCase();
    const updated = { ...currentUser, ...draft, mobileRegistered: phoneChanged ? false : !!currentUser.mobileRegistered, emailRegistered: emailChanged ? false : !!currentUser.emailRegistered, profileUpdatedAt: Date.now() };
    setCurrentUser(updated);
    onUpdateUser(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const handleChangePassword = () => {
    setPasswordMessage('');
    if ((currentUser.password || '123') !== passwordForm.current) {
      setPasswordMessage('Current password is incorrect.');
      return;
    }
    if (!passwordForm.next || passwordForm.next.length < 3) {
      setPasswordMessage('New password must be at least 3 characters.');
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordMessage('New password and confirm password do not match.');
      return;
    }
    const updated = { ...currentUser, password: passwordForm.next, passwordUpdatedAt: Date.now() };
    setCurrentUser(updated);
    onUpdateUser(updated);
    setPasswordForm({ current: '', next: '', confirm: '' });
    setPasswordMessage('Password changed successfully. Use the new password from next login.');
  };

  const sendMobileRegistrationOtp = async () => {
    setMobileMessage('');
    const clean = String(draft.phone || '').replace(/\D/g, '');
    if (clean.length < 10) {
      setMobileMessage('Enter a valid mobile number before sending OTP.');
      return;
    }
    try {
      const otpResponse = await sendRealOtp({ username: currentUser.username, mobile: clean, channel: 'mobile', purpose: 'mobile_registration' });
      setMobileChallengeId(otpResponse.challengeId || '');
      setMobileMessage(`OTP sent to mobile ending ${clean.slice(-4)}.`);
    } catch (err) {
      setMobileChallengeId('');
      setMobileMessage(err.message || 'Unable to send OTP. Please check SMS settings.');
    }
  };

  const verifyMobileRegistrationOtp = async () => {
    if (!mobileChallengeId) {
      setMobileMessage('Please send OTP first.');
      return;
    }
    try {
      await verifyRealOtp({ challengeId: mobileChallengeId, otp: mobileOtp, purpose: 'mobile_registration' });
    } catch (err) {
      setMobileMessage(err.message || 'Invalid OTP. Please try again.');
      return;
    }
    const updated = { ...currentUser, ...draft, mobileRegistered: true, mobileRegisteredAt: Date.now(), profileUpdatedAt: Date.now() };
    setCurrentUser(updated);
    onUpdateUser(updated);
    setMobileChallengeId('');
    setMobileOtp('');
    setMobileMessage('Mobile registered successfully for OTP login/recovery.');
  };


  const sendEmailRegistrationOtp = async () => {
    setEmailMessage('');
    const clean = String(draft.email || '').trim().toLowerCase();
    if (!clean.includes('@')) {
      setEmailMessage('Enter a valid email address before sending OTP.');
      return;
    }
    try {
      const otpResponse = await sendRealOtp({ username: currentUser.username, email: clean, channel: 'email', purpose: 'email_registration' });
      setEmailChallengeId(otpResponse.challengeId || '');
      setEmailOtp('');
      setEmailMessage(`OTP sent to ${clean.replace(/(.{2}).+(@.+)/, '$1***$2')}.`);
    } catch (err) {
      setEmailChallengeId('');
      setEmailMessage(err.message || 'Unable to send email OTP. Please check Email OTP settings.');
    }
  };

  const verifyEmailRegistrationOtp = async () => {
    if (!emailChallengeId) {
      setEmailMessage('Please send email OTP first.');
      return;
    }
    try {
      await verifyRealOtp({ challengeId: emailChallengeId, otp: emailOtp, purpose: 'email_registration' });
    } catch (err) {
      setEmailMessage(err.message || 'Invalid OTP. Please try again.');
      return;
    }
    const updated = { ...currentUser, ...draft, emailRegistered: true, emailRegisteredAt: Date.now(), profileUpdatedAt: Date.now() };
    setCurrentUser(updated);
    onUpdateUser(updated);
    setEmailChallengeId('');
    setEmailOtp('');
    setEmailMessage('Email registered successfully for OTP login/recovery.');
  };

  const fields = [
    ['phone', 'Mobile Number'], ['email', 'Email'], ['designation', 'Designation'],
    ['aadharNumber', 'Aadhaar Number'], ['panNumber', 'PAN Number'], ['emergencyContact', 'Emergency Contact'],
    ['address', 'Address'], ['bankDetails', 'Bank Details / UPI']
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">My Profile</h1>
        <p className="text-slate-500 font-medium mt-2">Manage your photo, internal details, and password.</p>
      </div>
      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-8">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="md:w-72 text-center">
            <div className="w-36 h-36 rounded-3xl bg-slate-100 border-2 border-slate-200 mx-auto overflow-hidden flex items-center justify-center shadow-sm">
              {draft.profilePhoto ? <img src={draft.profilePhoto} alt="Profile" className="w-full h-full object-cover" /> : <User className="w-16 h-16 text-slate-300" />}
            </div>
            <label className="mt-4 inline-flex items-center justify-center bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl font-black text-sm cursor-pointer hover:bg-indigo-100 border border-indigo-100">
              <Upload className="w-4 h-4 mr-2" /> Add Photo
              <input type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
            </label>
            <p className="text-xs text-slate-400 font-bold mt-3">{currentUser.name}<br/>{currentUser.role}</p>
            <div className={`mt-3 inline-flex px-3 py-1.5 rounded-full text-[11px] font-black border ${currentUser.mobileRegistered ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
              Mobile: {currentUser.mobileRegistered ? 'Registered' : 'Unregistered'}
            </div>
            <div className={`mt-2 inline-flex px-3 py-1.5 rounded-full text-[11px] font-black border ${currentUser.emailRegistered ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
              Email: {currentUser.emailRegistered ? 'Registered' : 'Unregistered'}
            </div>
          </div>
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-5">
            {fields.map(([key, label]) => (
              <div key={key} className={key === 'address' || key === 'bankDetails' ? 'md:col-span-2' : ''}>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">{label}</label>
                {key === 'address' || key === 'bankDetails' ? (
                  <textarea value={draft[key]} onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))} rows={3} className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500 resize-none" placeholder={`Enter ${label.toLowerCase()}`} />
                ) : (
                  <input value={draft[key]} onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))} className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" placeholder={`Enter ${label.toLowerCase()}`} />
                )}
              </div>
            ))}
            <div className="md:col-span-2 flex flex-wrap items-center gap-3 pt-2">
              <button type="button" onClick={handleSave} className="bg-slate-800 text-white px-6 py-3 rounded-xl font-black hover:bg-slate-700 shadow-lg shadow-slate-200">Save Profile</button>
              {saved && <span className="text-emerald-600 font-black text-sm bg-emerald-50 border border-emerald-100 px-4 py-2 rounded-xl">Profile saved</span>}
              {currentUser.role !== ROLES.ADMIN && <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-100 px-3 py-2 rounded-xl">Please keep Aadhaar/contact details updated.</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">Email OTP Registration</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">Recommended recovery method. Email OTP avoids paid SMS dependency.</p>
          </div>
          <span className={`px-4 py-2 rounded-xl text-xs font-black border ${currentUser.emailRegistered ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{currentUser.emailRegistered ? 'Registered' : 'Unregistered'}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input value={draft.email} onChange={e => { setDraft(prev => ({ ...prev, email: e.target.value })); setEmailMessage(''); }} placeholder="Email address" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
          <button type="button" onClick={sendEmailRegistrationOtp} className="bg-indigo-50 text-indigo-700 px-5 py-3 rounded-xl font-black hover:bg-indigo-100 border border-indigo-100">Send Email OTP</button>
          <input value={emailOtp} onChange={e => setEmailOtp(e.target.value)} placeholder="Enter email OTP" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button type="button" onClick={verifyEmailRegistrationOtp} className="bg-emerald-600 text-white px-5 py-3 rounded-xl font-black hover:bg-emerald-700 shadow-lg shadow-emerald-100">Verify & Register Email</button>
          {emailMessage && <span className={`text-sm font-black px-4 py-2 rounded-xl border ${emailMessage.includes('success') || emailMessage.includes('OTP sent') ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-600'}`}>{emailMessage}</span>}
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">Mobile OTP Registration</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">Register your mobile to use OTP-based password recovery.</p>
          </div>
          <span className={`px-4 py-2 rounded-xl text-xs font-black border ${currentUser.mobileRegistered ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{currentUser.mobileRegistered ? 'Registered' : 'Unregistered'}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input value={draft.phone} onChange={e => { setDraft(prev => ({ ...prev, phone: e.target.value })); setMobileMessage(''); }} placeholder="Mobile number" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
          <button type="button" onClick={sendMobileRegistrationOtp} className="bg-indigo-50 text-indigo-700 px-5 py-3 rounded-xl font-black hover:bg-indigo-100 border border-indigo-100">Send OTP</button>
          <input value={mobileOtp} onChange={e => setMobileOtp(e.target.value)} placeholder="Enter OTP" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button type="button" onClick={verifyMobileRegistrationOtp} className="bg-emerald-600 text-white px-5 py-3 rounded-xl font-black hover:bg-emerald-700 shadow-lg shadow-emerald-100">Verify & Register Mobile</button>
          {mobileMessage && <span className={`text-sm font-black px-4 py-2 rounded-xl border ${mobileMessage.includes('success') || mobileMessage.includes('OTP sent') ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-600'}`}>{mobileMessage}</span>}
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">Change Password</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">Only you can change your login password from your profile.</p>
          </div>
          <Lock className="w-6 h-6 text-indigo-500" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input type="password" value={passwordForm.current} onChange={e => setPasswordForm(prev => ({ ...prev, current: e.target.value }))} placeholder="Current password" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
          <input type="password" value={passwordForm.next} onChange={e => setPasswordForm(prev => ({ ...prev, next: e.target.value }))} placeholder="New password" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
          <input type="password" value={passwordForm.confirm} onChange={e => setPasswordForm(prev => ({ ...prev, confirm: e.target.value }))} placeholder="Confirm new password" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button type="button" onClick={handleChangePassword} className="bg-indigo-600 text-white px-5 py-3 rounded-xl font-black hover:bg-indigo-700 shadow-lg shadow-indigo-100">Update Password</button>
          {passwordMessage && <span className={`text-sm font-black px-4 py-2 rounded-xl border ${passwordMessage.includes('success') ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-600'}`}>{passwordMessage}</span>}
        </div>
      </div>
    </div>
  );
};


const hindiDigitMap = {
  '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9',
  '0':'0','1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9'
};
const hindiNumberWords = {
  'शून्य':0,'एक':1,'दो':2,'तीन':3,'चार':4,'पांच':5,'पाँच':5,'छह':6,'सात':7,'आठ':8,'नौ':9,'दस':10,
  'ग्यारह':11,'बारह':12,'तेरह':13,'चौदह':14,'पंद्रह':15,'सोलह':16,'सत्रह':17,'अठारह':18,'उन्नीस':19,'बीस':20,
  'इक्कीस':21,'बाईस':22,'तेईस':23,'चौबीस':24,'पच्चीस':25,'छब्बीस':26,'सत्ताईस':27,'अट्ठाईस':28,'उनतीस':29,'तीस':30,
  'इकतीस':31,'बत्तीस':32,'तैंतीस':33,'चौंतीस':34,'पैंतीस':35,'छत्तीस':36,'सैंतीस':37,'अड़तीस':38,'उनतालीस':39,'चालीस':40,
  'इकतालीस':41,'बयालीस':42,'तैंतालीस':43,'चवालीस':44,'पैंतालीस':45,'छियालीस':46,'सैंतालीस':47,'अड़तालीस':48,'उनचास':49,'पचास':50,
  'इक्यावन':51,'बावन':52,'तिरपन':53,'चौवन':54,'पचपन':55,'छप्पन':56,'सत्तावन':57,'अट्ठावन':58,'उनसठ':59,'साठ':60,
  'इकसठ':61,'बासठ':62,'तिरसठ':63,'चौंसठ':64,'पैंसठ':65,'छियासठ':66,'सड़सठ':67,'अड़सठ':68,'उनहत्तर':69,'सत्तर':70,
  'इकहत्तर':71,'बहत्तर':72,'तिहत्तर':73,'चौहत्तर':74,'पचहत्तर':75,'छिहत्तर':76,'सतहत्तर':77,'अठहत्तर':78,'उनासी':79,'अस्सी':80,
  'इक्यासी':81,'बयासी':82,'तिरासी':83,'चौरासी':84,'पचासी':85,'छियासी':86,'सत्तासी':87,'अट्ठासी':88,'नवासी':89,'नब्बे':90,
  'इक्यानवे':91,'बानवे':92,'तिरानवे':93,'चौरानवे':94,'पचानवे':95,'छियानवे':96,'सत्तानवे':97,'अट्ठानवे':98,'निन्यानवे':99,'सौ':100
};
const areaFactorsToSqft = {
  sqft: 1,
  sqmt: 10.7639104167,
  hectare: 107639.104167,
  acre: 43560,
  bigha_up: 27000,
  biswa_up: 1350,
  sqyd: 9
};
const areaLabels = { sqft: 'Square feet', sqmt: 'Square metre', hectare: 'Hectare', acre: 'Acre', bigha_up: 'Bigha (UP approx.)', biswa_up: 'Biswa (UP approx.)', sqyd: 'Square yard' };
const parseHindiNumber = (input = '') => {
  const text = String(input).trim();
  if (!text) return '';
  const digitConverted = text.split('').map(ch => hindiDigitMap[ch] ?? ch).join('');
  if (/^[0-9.,\s]+$/.test(digitConverted)) return digitConverted.replace(/,/g,'').trim();
  const normalized = text.replace(/[।,]/g, ' ').replace(/\s+/g, ' ').trim();
  let total = 0, current = 0, found = false;
  normalized.split(' ').forEach(word => {
    if (hindiNumberWords[word] !== undefined) { current += hindiNumberWords[word]; found = true; return; }
    if (word === 'हजार') { total += (current || 1) * 1000; current = 0; found = true; return; }
    if (word === 'लाख') { total += (current || 1) * 100000; current = 0; found = true; return; }
    if (word === 'करोड़' || word === 'करोड') { total += (current || 1) * 10000000; current = 0; found = true; return; }
  });
  return found ? String(total + current) : digitConverted;
};
const CalculatorView = () => {
  const [value, setValue] = useState('1');
  const [fromUnit, setFromUnit] = useState('hectare');
  const [toUnit, setToUnit] = useState('sqft');
  const [lengthValue, setLengthValue] = useState('40');
  const [widthValue, setWidthValue] = useState('60');
  const [lengthUnit, setLengthUnit] = useState('ft');
  const [hindiInput, setHindiInput] = useState('');
  const [englishInput, setEnglishInput] = useState('');
  const [calcExpression, setCalcExpression] = useState('');
  const [calcResult, setCalcResult] = useState('0');

  const runCalculator = (expression = calcExpression) => {
    try {
      const cleaned = String(expression)
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/−/g, '-')
        .replace(/%/g, '/100')
        .replace(/[^0-9+\-*/().\s]/g, '');
      if (!cleaned.trim()) { setCalcResult('0'); return; }
      // Safe because all non-numeric/operator characters are removed above.
      const value = Function(`"use strict"; return (${cleaned})`)();
      setCalcResult(Number.isFinite(value) ? String(Number(value.toFixed(8))) : 'Invalid');
    } catch (e) {
      setCalcResult('Invalid');
    }
  };

  const addCalcToken = (token) => {
    const next = calcExpression + token;
    setCalcExpression(next);
  };

  const hindiDigitRows = [
    ['०', '0'], ['१', '1'], ['२', '2'], ['३', '3'], ['४', '4'],
    ['५', '5'], ['६', '6'], ['७', '7'], ['८', '8'], ['९', '9']
  ];

  const englishToHindiDigits = (input = '') => String(input).split('').map(ch => {
    const row = hindiDigitRows.find(([, en]) => en === ch);
    return row ? row[0] : ch;
  }).join('');

  const convertHindiDigitsOnly = (input = '') => String(input).split('').map(ch => hindiDigitMap[ch] ?? ch).join('');

  const numericValue = Number(parseHindiNumber(value)) || 0;
  const converted = numericValue * (areaFactorsToSqft[fromUnit] || 1) / (areaFactorsToSqft[toUnit] || 1);
  const hindiConverted = convertHindiDigitsOnly(hindiInput);
  const englishToHindiConverted = englishToHindiDigits(englishInput);

  const lengthToFeet = { ft: 1, m: 3.280839895, inch: 1/12, yard: 3 };
  const lengthLabels = { ft: 'Feet', m: 'Metre', inch: 'Inch', yard: 'Yard' };
  const lengthFt = (Number(parseHindiNumber(lengthValue)) || 0) * (lengthToFeet[lengthUnit] || 1);
  const widthFt = (Number(parseHindiNumber(widthValue)) || 0) * (lengthToFeet[lengthUnit] || 1);
  const areaSqft = lengthFt * widthFt;
  const areaSqmt = areaSqft / areaFactorsToSqft.sqmt;
  const areaAcre = areaSqft / areaFactorsToSqft.acre;
  const areaHectare = areaSqft / areaFactorsToSqft.hectare;

  const quickRows = [
    ['1 Hectare', 'Sqft', (1 * areaFactorsToSqft.hectare).toLocaleString('en-IN')],
    ['1 Acre', 'Sqft', areaFactorsToSqft.acre.toLocaleString('en-IN')],
    ['1 Bigha UP', 'Sqft', areaFactorsToSqft.bigha_up.toLocaleString('en-IN')],
    ['1 Biswa UP', 'Sqft', areaFactorsToSqft.biswa_up.toLocaleString('en-IN')]
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Calculator & Conversion Tools</h1>
        <p className="text-slate-500 font-medium mt-2">Area calculator, land measurement converter, Hindi digit guide, and quick estimate tools for everyone.</p>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
        <h2 className="text-xl font-black text-slate-800 mb-5 flex items-center"><LayoutDashboard className="w-5 h-5 mr-2 text-slate-700" /> Simple Calculator</h2>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3 space-y-4">
            <div>
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Expression</label>
              <input value={calcExpression} onChange={e => setCalcExpression(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runCalculator(); } }} placeholder="Example: 1250 + 18% or 40*60/2" className="w-full border-2 border-slate-100 rounded-2xl p-4 font-black text-lg outline-none focus:border-slate-700 bg-slate-50/50" />
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {['7','8','9','÷','%','(', '4','5','6','×','.',')', '1','2','3','−','+','C', '0','00','000','/','*','='].map(btn => (
                <button key={btn} type="button" onClick={() => { if (btn === 'C') { setCalcExpression(''); setCalcResult('0'); return; } if (btn === '=') { runCalculator(); return; } addCalcToken(btn); }} className={`${btn === '=' ? 'bg-slate-800 text-white hover:bg-slate-700' : btn === 'C' ? 'bg-red-50 text-red-600 hover:bg-red-100' : ['÷','×','−','+','/','*','%','(',')'].includes(btn) ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'} px-4 py-3 rounded-2xl font-black transition-colors`}>{btn}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[['+18%', '+18%'], ['-18%', '-18%'], ['Half', '/2'], ['Double', '*2']].map(([label, token]) => (
                <button key={label} type="button" onClick={() => addCalcToken(token)} className="bg-white border border-slate-100 px-4 py-2 rounded-xl text-xs font-black text-slate-600 hover:border-indigo-200 hover:text-indigo-700 transition-colors">{label}</button>
              ))}
            </div>
            <p className="text-xs text-slate-400 font-bold">Supports add, subtract, multiply, divide, brackets, decimals, percentage and quick GST-style percentage checks.</p>
          </div>
          <div className="lg:col-span-2 bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-3xl p-6 flex flex-col justify-between min-h-[220px] shadow-lg">
            <div>
              <p className="text-xs font-black text-indigo-200 uppercase tracking-widest">Result</p>
              <p className="text-5xl font-black mt-4 break-all">{calcResult}</p>
            </div>
            <button type="button" onClick={() => navigator.clipboard?.writeText(String(calcResult))} className="mt-6 bg-white/10 hover:bg-white/20 border border-white/10 text-white rounded-2xl py-3 font-black transition-colors">Copy Result</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-800 mb-5 flex items-center"><MapIcon className="w-5 h-5 mr-2 text-indigo-500" /> Area & Land Unit Converter</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="sm:col-span-1">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Value</label>
              <input value={value} onChange={e => setValue(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3 font-black outline-none focus:border-indigo-500" placeholder="Enter area" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">From</label>
              <select value={fromUnit} onChange={e => setFromUnit(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold bg-white outline-none focus:border-indigo-500">
                {Object.keys(areaFactorsToSqft).map(k => <option key={k} value={k}>{areaLabels[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">To</label>
              <select value={toUnit} onChange={e => setToUnit(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold bg-white outline-none focus:border-indigo-500">
                {Object.keys(areaFactorsToSqft).map(k => <option key={k} value={k}>{areaLabels[k]}</option>)}
              </select>
            </div>
          </div>
          <div className="bg-indigo-50 border-2 border-indigo-100 rounded-3xl p-6">
            <p className="text-xs text-indigo-500 font-black uppercase tracking-widest">Converted result</p>
            <p className="text-4xl font-black text-indigo-800 mt-2">{converted.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</p>
            <p className="text-sm font-bold text-indigo-600 mt-2">{areaLabels[toUnit]}</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-800 mb-5 flex items-center"><LayoutDashboard className="w-5 h-5 mr-2 text-emerald-500" /> Length × Width Calculator</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div>
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Length</label>
              <input value={lengthValue} onChange={e => setLengthValue(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3 font-black outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Width</label>
              <input value={widthValue} onChange={e => setWidthValue(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3 font-black outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Unit</label>
              <select value={lengthUnit} onChange={e => setLengthUnit(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold bg-white outline-none focus:border-emerald-500">
                {Object.keys(lengthToFeet).map(k => <option key={k} value={k}>{lengthLabels[k]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4"><p className="text-xs font-black text-emerald-600 uppercase tracking-widest">Sq ft</p><p className="text-2xl font-black text-emerald-800">{areaSqft.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p></div>
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4"><p className="text-xs font-black text-blue-600 uppercase tracking-widest">Sq mt</p><p className="text-2xl font-black text-blue-800">{areaSqmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p></div>
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4"><p className="text-xs font-black text-amber-600 uppercase tracking-widest">Acre</p><p className="text-2xl font-black text-amber-800">{areaAcre.toLocaleString('en-IN', { maximumFractionDigits: 5 })}</p></div>
            <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4"><p className="text-xs font-black text-purple-600 uppercase tracking-widest">Hectare</p><p className="text-2xl font-black text-purple-800">{areaHectare.toLocaleString('en-IN', { maximumFractionDigits: 5 })}</p></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-800 mb-5">Hindi Digit Guide</h2>
          <p className="text-sm text-slate-500 font-medium mb-4">Use this chart to read Hindi numerals written in deeds, revenue records, khasra papers, maps, and technical reports.</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            {hindiDigitRows.map(([hi, en]) => (
              <div key={hi} className="bg-slate-50 border border-slate-100 rounded-2xl p-4 text-center">
                <p className="text-4xl font-black text-slate-800">{hi}</p>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mt-2">English</p>
                <p className="text-2xl font-black text-indigo-700">{en}</p>
              </div>
            ))}
          </div>
          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Hindi digits to English</label>
          <textarea value={hindiInput} onChange={e => setHindiInput(e.target.value)} rows={3} placeholder="Example: १२३४५६७८९०" className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500 resize-none" />
          <div className="bg-indigo-50 border-2 border-indigo-100 rounded-3xl p-5 mt-4">
            <p className="text-xs text-indigo-600 font-black uppercase tracking-widest">English output</p>
            <p className="text-3xl font-black text-indigo-800 mt-2 break-all">{hindiConverted || '-'}</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-800 mb-5">English Digit to Hindi Digit</h2>
          <p className="text-sm text-slate-500 font-medium mb-4">Useful when entering numbers in the same style as Hindi land documents.</p>
          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">English digits</label>
          <textarea value={englishInput} onChange={e => setEnglishInput(e.target.value)} rows={3} placeholder="Example: 1234567890" className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-emerald-500 resize-none" />
          <div className="bg-emerald-50 border-2 border-emerald-100 rounded-3xl p-5 mt-4">
            <p className="text-xs text-emerald-600 font-black uppercase tracking-widest">Hindi output</p>
            <p className="text-3xl font-black text-emerald-800 mt-2 break-all">{englishToHindiConverted || '-'}</p>
          </div>
          <div className="mt-6 bg-slate-50 rounded-2xl p-5 border border-slate-100">
            <h3 className="font-black text-slate-800 mb-3">Examples</h3>
            <div className="grid grid-cols-2 gap-3 text-sm font-bold">
              <div className="bg-white rounded-xl p-3 border border-slate-100">१२३ → <span className="text-indigo-700">123</span></div>
              <div className="bg-white rounded-xl p-3 border border-slate-100">४५६ → <span className="text-indigo-700">456</span></div>
              <div className="bg-white rounded-xl p-3 border border-slate-100">७८९ → <span className="text-indigo-700">789</span></div>
              <div className="bg-white rounded-xl p-3 border border-slate-100">१००० → <span className="text-indigo-700">1000</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
        <h2 className="text-xl font-black text-slate-800 mb-4">Quick Reference</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickRows.map(([a,b,c]) => <div key={a} className="bg-slate-50 rounded-2xl p-4 border border-slate-100"><p className="font-black text-slate-800">{a}</p><p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">in {b}</p><p className="text-2xl text-indigo-700 font-black mt-2">{c}</p></div>)}
        </div>
      </div>
    </div>
  );
};

const TeamPerformanceView = ({ users, projects, onUpdateUser, currentUser }) => {
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
    const userTasks = projects.filter(p => p.assignedTo === selectedUser.name && p.status === 'Completed').sort((a,b) => (b.completedAt || 0) - (a.completedAt || 0));
    const totalTasks = userTasks.length;
    const totalRevisions = userTasks.reduce((sum, p) => sum + (p.subTasks?.length || 0), 0);

    return (
      <div className="space-y-6 animate-in slide-in-from-right-8 duration-300">
        <button onClick={() => setSelectedUser(null)} className="flex items-center text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-100 w-fit">
           <ArrowLeft className="w-4 h-4 mr-2" /> Back to Team List
        </button>
        
        <div className="bg-white rounded-3xl p-8 shadow-sm border-2 border-slate-100">
           <div className="flex items-center gap-4 mb-8 border-b-2 border-slate-100 pb-6">
              <div className="bg-indigo-100 p-4 rounded-2xl text-indigo-600"><User className="w-8 h-8" /></div>
              <div>
                 <h2 className="text-3xl font-black text-slate-800 tracking-tight">{selectedUser.name}</h2>
                 <p className="font-bold text-slate-400 uppercase tracking-widest text-sm mt-1">{selectedUser.role} Analytics</p>
              </div>
           </div>

           <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
              <div className="bg-emerald-50 border-2 border-emerald-100 rounded-3xl p-6 shadow-sm">
                 <div className="flex items-center gap-3 mb-2 text-emerald-600"><CheckCircle className="w-6 h-6"/><h3 className="font-extrabold uppercase tracking-widest text-sm">Tasks Completed</h3></div>
                 <p className="text-5xl font-black text-emerald-800">{totalTasks}</p>
                 <p className="text-sm font-medium text-emerald-600 mt-2">Lifetime operational efficiency</p>
              </div>
              <div className="bg-orange-50 border-2 border-orange-100 rounded-3xl p-6 shadow-sm">
                 <div className="flex items-center gap-3 mb-2 text-orange-600"><Clock className="w-6 h-6"/><h3 className="font-extrabold uppercase tracking-widest text-sm">Total Revisions Handled</h3></div>
                 <p className="text-5xl font-black text-orange-800">{totalRevisions}</p>
                 <p className="text-sm font-medium text-orange-600 mt-2">Corrections required post-draft</p>
              </div>
           </div>

           <h3 className="text-xl font-extrabold text-slate-800 mb-4 tracking-tight">Completed Tasks Breakdown</h3>
           <div className="overflow-x-auto border-2 border-slate-100 rounded-2xl">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
                  <tr>
                    <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Date</th>
                    <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Task ID</th>
                    <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Client & Location</th>
                    <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-center">Revisions Needed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {userTasks.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50">
                       <td className="px-6 py-4 font-bold text-slate-600">{t.completedAt ? formatDateTime(t.completedAt) : '-'}</td>
                       <td className="px-6 py-4 font-bold text-slate-800">{t.id}</td>
                       <td className="px-6 py-4"><p className="font-bold text-slate-700">{t.client}</p><p className="text-xs text-slate-400 font-medium">{t.location}</p></td>
                       <td className="px-6 py-4 text-center">
                          <span className={`px-3 py-1.5 rounded-lg text-xs font-black ${t.subTasks?.length > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>{t.subTasks?.length || 0} Revisions</span>
                       </td>
                    </tr>
                  ))}
                  {userTasks.length === 0 && <tr><td colSpan="4" className="px-6 py-8 text-center text-slate-400 font-medium">No completed tasks yet.</td></tr>}
                </tbody>
              </table>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl p-8 shadow-sm border-2 border-slate-100 animate-in fade-in">
        <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight mb-6 flex items-center">
          <BarChart3 className="w-6 h-6 mr-3 text-indigo-500"/> Team Workload Overview
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
              <tr>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Team Member</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-center">Active / Pending</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-center">Completed</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-center">Total Assigned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.filter(u => (u.role === ROLES.DESIGNER || u.role === ROLES.MANAGER) && u.status === 'APPROVED').map(u => {
                 const userProjects = projects.filter(p => p.assignedTo === u.name);
                 const pending = userProjects.filter(p => p.status !== 'Completed').length;
                 const completed = userProjects.filter(p => p.status === 'Completed').length;
                 const total = userProjects.length;
                 return (
                   <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-bold text-slate-800">{u.name} <span className="text-xs text-slate-400 font-medium ml-2">({u.role})</span></td>
                      <td className="px-6 py-4 text-center">
                         <span className={`px-3 py-1.5 rounded-lg text-xs font-black ${pending > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{pending} Tasks</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                         <span className={`px-3 py-1.5 rounded-lg text-xs font-black ${completed > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{completed} Tasks</span>
                      </td>
                      <td className="px-6 py-4 text-center font-black text-slate-800">{total}</td>
                   </tr>
                 )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-3xl p-8 shadow-sm border-2 border-slate-100 animate-in fade-in">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">Team & Security Control</h2>
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
                {(u.role === ROLES.DESIGNER || u.role === ROLES.MANAGER) && (
                   <button type="button" onClick={() => setSelectedUser(u)} className="px-5 py-2.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-600 hover:text-white text-sm font-bold rounded-xl transition-all shadow-sm flex items-center">
                      View Analytics <ChevronRight className="w-4 h-4 ml-1" />
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

const AttendanceView = ({ attendanceLogs = [], users = [] }) => {
  const [filterDate, setFilterDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [monthKey, setMonthKey] = useState(new Date().toLocaleDateString('en-CA').slice(0, 7));
  const safeLogs = Array.isArray(attendanceLogs) ? attendanceLogs : [];
  const filteredLogs = safeLogs.filter(log => log.date === filterDate && normalizeRole(log.role) !== ROLES.ADMIN);
  const daysInMonth = (() => {
    const [year, month] = monthKey.split('-').map(Number);
    const count = new Date(year, month, 0).getDate();
    return Array.from({ length: count }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, '0')}`);
  })();
  const teamMembers = getOperationalUsers(users && users.length ? users : INITIAL_USERS, { includeAdmins: false });
  const isPresent = (user, date) => safeLogs.some(log => String(log.userId) === String(user.id) && log.date === date);
  const attendanceRows = teamMembers.map(user => {
    const log = safeLogs.find(l => l.date === filterDate && (String(l.userId) === String(user.id) || samePerson(l.name, user.name)));
    return {
      ...(log || {}),
      id: log?.id || `${user.id}_${filterDate}_empty`,
      userId: user.id,
      name: user.name,
      role: user.role,
      date: filterDate,
      loginTime: log?.loginTime || '-',
      logoutTime: log?.logoutTime || '',
      activeMinutes: log?.activeMinutes || 0,
      totalBreakMinutes: log?.totalBreakMinutes || 0,
      currentBreakStartedAt: log?.currentBreakStartedAt || null,
      breakEvents: Array.isArray(log?.breakEvents) ? log.breakEvents : []
    };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const handleExport = () => {
    const headers = ["Name", "Role", "Date", "First Login", "Online/Last Seen", "Active Hours", "Break Time"];
    const rows = attendanceRows.map(log => {
      const user = getAttendanceUser(log, users);
      const isOnline = isUserActuallyOnline(user);
      const lastSeen = formatLastSeenDateTime(user?.lastSeenAt || user?.lastLogoutAt || user?.lastHeartbeatAt);
      return [
        log.name, log.role, log.date, log.loginTime, isOnline ? "Online" : `Last seen ${lastSeen}`, ((log.activeMinutes || 0) / 60).toFixed(1) + " hrs", formatMinutes(getBreakMinutesFromLog(log))
      ];
    });
    exportToCSV(headers, rows, `Attendance_${filterDate}.csv`);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4">
        <div>
           <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight flex items-center"><Users className="w-8 h-8 mr-3 text-indigo-500"/> Team Attendance</h2>
           <p className="text-slate-500 mt-2 font-medium">Daily log and monthly present/absent snapshot visible to everyone.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="border-2 border-slate-200 rounded-xl p-2.5 font-bold text-slate-700 outline-none" />
          <input type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} className="border-2 border-slate-200 rounded-xl p-2.5 font-bold text-slate-700 outline-none" />
          <button onClick={handleExport} className="flex items-center px-4 py-2.5 bg-emerald-100 text-emerald-700 font-bold rounded-xl hover:bg-emerald-200 transition-colors"><Download className="w-4 h-4 mr-2" /> Export</button>
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
              <tr>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Team Member</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">First Login</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Online / Logout</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Active Duration</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Break Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {attendanceRows.map(log => {
                const safeMinutes = log.activeMinutes || 0;
                const hours = Math.floor(safeMinutes / 60);
                const mins = Math.floor(safeMinutes % 60);
                const user = getAttendanceUser(log, users);
                const isOnline = isUserActuallyOnline(user);
                const breakMinutes = getBreakMinutesFromLog(log);
                const breakEvents = Array.isArray(log.breakEvents) ? log.breakEvents : [];
                return (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-5"><p className="font-bold text-slate-800 text-base">{log.name}</p><p className="text-xs font-semibold text-slate-400 mt-0.5">{log.role}</p></td>
                    <td className="px-6 py-5 font-bold text-emerald-600">{log.loginTime}</td>
                    <td className="px-6 py-5 font-bold text-slate-600">{isOnline ? <span className="inline-flex items-center gap-2 text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-500"></span>Online</span> : <span className="text-slate-500">Last seen {formatLastSeenDateTime(user?.lastSeenAt || user?.lastLogoutAt || user?.lastHeartbeatAt)}</span>}</td>
                    <td className="px-6 py-5 text-right"><span className="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg font-black">{hours}h {mins}m</span></td>
                    <td className="px-6 py-5 text-right"><span className="bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg font-black">{formatMinutes(breakMinutes)}</span>{breakEvents.length > 0 && <p className="text-[10px] text-slate-400 font-bold mt-1">{breakEvents.length} break{breakEvents.length > 1 ? 's' : ''} taken</p>}</td>
                  </tr>
                )
              })}
              {attendanceRows.length === 0 && (<tr><td colSpan={5} className="px-6 py-16 text-center text-slate-400 font-bold">No approved non-admin team members found.</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b-2 border-slate-100 flex justify-between items-center">
          <div>
            <h3 className="text-xl font-black text-slate-800">Monthly Attendance Sheet</h3>
            <p className="text-sm text-slate-500 font-medium">Green = present, red = absent/no login record.</p>
          </div>
          <span className="text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-100 px-3 py-1.5 rounded-xl">{monthKey}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
              <tr>
                <th className="px-4 py-4 font-black uppercase tracking-widest sticky left-0 bg-slate-50 z-10">Member</th>
                {daysInMonth.map(d => <th key={d} className="px-2 py-4 text-center font-black">{Number(d.slice(-2))}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teamMembers.map(u => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-4 font-black text-slate-800 sticky left-0 bg-white z-10">{u.name}<p className="text-[10px] text-slate-400 font-bold">{u.role}</p></td>
                  {daysInMonth.map(d => (
                    <td key={d} className="px-2 py-4 text-center">
                      <span className={`inline-flex w-6 h-6 rounded-full items-center justify-center text-[10px] font-black ${isPresent(u, d) ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-400'}`}>{isPresent(u, d) ? 'P' : 'A'}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const CommandCentreView = ({ projects = [], users = [], onSelectProject, currentUser }) => {
  const [dateKey, setDateKey] = useState(formatDateKey());
  const [availabilityFilter, setAvailabilityFilter] = useState('Available');
  const metrics = getTodayMetrics(projects, dateKey);
  const activeBoard = metrics.activeToday.slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
  const people = getOperationalUsers(users || [], { includeAdmins: true });
  const workingTeam = people.filter(u => u.role === ROLES.DESIGNER || u.role === ROLES.MANAGER);
  const activeTasksFor = (userName) => projects.filter(p => normalizePersonName(p.assignedTo) === normalizePersonName(userName) && p.status !== 'Completed');
  const nowMs = Date.now();
  const availablePeople = people.filter(u => isUserActuallyOnline(u, nowMs) && (u.role === ROLES.ADMIN || (u.availability !== 'Break' && activeTasksFor(u.name).length === 0))); // admins shown available but no free-since
  const busyPeople = people.filter(u => u.role !== ROLES.ADMIN && isUserActuallyOnline(u, nowMs) && u.availability !== 'Break' && activeTasksFor(u.name).length > 0);
  const breakPeople = people.filter(u => u.role !== ROLES.ADMIN && isUserActuallyOnline(u, nowMs) && u.availability === 'Break');
  const offlinePeople = people.filter(u => !isUserActuallyOnline(u, nowMs));
  const free = availablePeople.length;
  const busy = busyPeople.length;
  const breaks = breakPeople.length;
  const availabilityGroups = { Available: availablePeople, Busy: busyPeople, Break: breakPeople, Offline: offlinePeople };
  const selectedAvailabilityPeople = availabilityGroups[availabilityFilter] || [];
  const completionRate = metrics.received ? Math.round((metrics.completed / metrics.received) * 100) : 0;
  const pendingNow = activeBoard.filter(p => p.status !== 'Completed').length;
  const delayedCount = activeBoard.filter(p => getSlaInfo(p).label === 'Delayed').length;
  const nearSlaCount = activeBoard.filter(p => getSlaInfo(p).label === 'Near SLA').length;
  const activeCapacity = workingTeam.reduce((sum, u) => sum + activeTasksFor(u.name).length, 0);
  const capacityLimit = workingTeam.reduce((sum, u) => sum + Number(u.dailyLimit || u.taskLimit || 10), 0) || Math.max(workingTeam.length * 10, 1);
  const capacityPct = Math.min(100, Math.round((activeCapacity / capacityLimit) * 100));
  const statusFlow = [
    ['Received', metrics.received, 'bg-blue-500'],
    ['Carried', metrics.carriedCount, 'bg-orange-500'],
    ['Drafting', metrics.drafting, 'bg-indigo-500'],
    ['Review', metrics.review, 'bg-purple-500'],
    ['Completed', metrics.completed, 'bg-emerald-500'],
    ['Revisions', metrics.revisions.length, 'bg-red-500']
  ];
  const maxFlow = Math.max(...statusFlow.map(([, value]) => Number(value) || 0), 1);
  const workloadCards = workingTeam.map(u => {
    const active = activeTasksFor(u.name);
    const completedToday = projects.filter(p => normalizePersonName(p.assignedTo) === normalizePersonName(u.name) && p.status === 'Completed' && formatDateKey(p.completedAt || p.createdAt) === dateKey).length;
    const revisions = projects.filter(p => normalizePersonName(p.assignedTo) === normalizePersonName(u.name) && (p.subTasks || []).some(st => st.status !== 'Done')).length;
    const limit = Number(u.dailyLimit || u.taskLimit || 10) || 10;
    const loadPct = Math.min(100, Math.round((active.length / limit) * 100));
    return { ...u, active, completedToday, revisions, limit, loadPct };
  }).sort((a,b) => b.active.length - a.active.length || b.completedToday - a.completedToday || a.name.localeCompare(b.name));
  const topPerformers = workloadCards.slice().sort((a,b) => b.completedToday - a.completedToday || a.active.length - b.active.length).slice(0, 4);
  const stats = [
    ['Cases Received', metrics.received, 'bg-blue-50 text-blue-700 border-blue-100'],
    ['Active Pending', pendingNow, 'bg-orange-50 text-orange-700 border-orange-100'],
    ['Completion Rate', `${completionRate}%`, 'bg-emerald-50 text-emerald-700 border-emerald-100'],
    ['Delayed SLA', delayedCount, 'bg-red-50 text-red-700 border-red-100'],
    ['Near SLA', nearSlaCount, 'bg-amber-50 text-amber-700 border-amber-100'],
    ['Urgent Revisions', metrics.revisions.length, 'bg-purple-50 text-purple-700 border-purple-100']
  ];
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4">
        <div><h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Command Centre</h1><p className="text-slate-500 font-medium mt-2">Live operations snapshot with workload, SLA, productivity, and carried-forward work.</p></div>
        <input type="date" value={dateKey} onChange={e => setDateKey(e.target.value)} className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2.5 font-bold text-slate-700 outline-none" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">{stats.map(([label, value, cls]) => <div key={label} className={`${cls} border-2 rounded-3xl p-5 shadow-sm`}><p className="text-[10px] font-black uppercase tracking-widest opacity-80">{label}</p><p className="text-3xl font-black mt-2">{value}</p></div>)}</div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div><h2 className="font-black text-slate-800 text-xl flex items-center"><BarChart3 className="w-5 h-5 mr-2 text-indigo-500" /> Operations Flow</h2><p className="text-xs font-bold text-slate-400 mt-1">Pending vs completed trend for the selected day.</p></div>
            <Badge colorClass={completionRate >= 70 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : completionRate >= 40 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-red-50 text-red-700 border-red-100'}>{completionRate}% Done</Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {statusFlow.map(([label, value, color]) => (
              <div key={label} className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                <div className="h-28 flex items-end justify-center">
                  <div className={`${color} rounded-t-xl w-full max-w-[42px] transition-all`} style={{ height: `${Math.max(8, (Number(value || 0) / maxFlow) * 100)}%` }}></div>
                </div>
                <p className="text-center text-2xl font-black text-slate-800 mt-3">{value}</p>
                <p className="text-center text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h3 className="font-black text-slate-800 mb-1">Active Workload</h3><p className="text-xs font-bold text-slate-400 mb-4">Current assigned load across managers/designers.</p>
          <div className="flex items-end justify-between mb-3"><p className="text-4xl font-black text-slate-800">{activeCapacity}</p><p className="text-xs font-black text-slate-400 uppercase tracking-widest">of {capacityLimit} capacity</p></div>
          <div className="h-4 bg-slate-100 rounded-full overflow-hidden mb-4"><div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${capacityPct}%` }}></div></div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3"><p className="font-black text-blue-700">{free}</p><p className="text-[9px] font-black uppercase text-blue-500">Available</p></div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3"><p className="font-black text-emerald-700">{busy}</p><p className="text-[9px] font-black uppercase text-emerald-500">Busy</p></div>
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3"><p className="font-black text-amber-700">{breaks}</p><p className="text-[9px] font-black uppercase text-amber-500">Break</p></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
          <div className="p-5 border-b-2 border-slate-100"><h2 className="font-black text-slate-800 text-xl">Daily Operations Board</h2><p className="text-xs font-bold text-slate-400 mt-1">Includes today's tasks plus older pending tasks carried forward.</p></div>
          <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto custom-scrollbar">
            {activeBoard.map(p => <div key={p.id} onClick={() => onSelectProject(p)} className="p-5 hover:bg-slate-50 cursor-pointer flex justify-between items-center"><div><p className="font-black text-slate-800">{p.id} <span className="text-xs font-bold text-slate-400 ml-2">{getCustomerDisplayName(p)}</span></p><p className="text-sm font-extrabold text-slate-700 mt-1">{p.taskName || makeTaskDisplayName(p)}</p><p className="text-xs font-bold text-slate-500 mt-1">{p.type} • {p.location} • {p.assignedTo || 'Unassigned'}</p>{getLatestCompletedFileName(p) && <p className="text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 mt-2 w-fit">Completed: {getLatestCompletedFileName(p)}</p>}{isCarriedForwardProject(p, dateKey) && <span className="inline-flex mt-2 text-[10px] bg-orange-50 text-orange-700 border border-orange-100 px-2 py-1 rounded-lg font-black uppercase">Carried Forward</span>}</div><Badge colorClass={getStatusColor(p.status)}>{p.status}</Badge></div>)}
            {activeBoard.length === 0 && <div className="p-10 text-center text-slate-400 font-bold">No operations for this date.</div>}
          </div>
        </div>
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
            <h3 className="font-black text-slate-800 mb-1">Team Availability</h3><p className="text-xs font-bold text-slate-400 mb-4">Click Available, Busy, Break, or Offline to see the members in that status.</p>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[["Available", free, "bg-blue-50 text-blue-700 border-blue-100"], ["Busy", busy, "bg-emerald-50 text-emerald-700 border-emerald-100"], ["Break", breaks, "bg-amber-50 text-amber-700 border-amber-100"], ["Offline", offlinePeople.length, "bg-slate-50 text-slate-600 border-slate-100"]].map(([label, count, cls]) => (
                <button key={label} type="button" onClick={() => setAvailabilityFilter(label)} className={`${cls} border-2 p-3 rounded-2xl text-center font-black transition-all ${availabilityFilter === label ? 'ring-2 ring-slate-300 scale-[1.02]' : 'hover:scale-[1.01]'}`}>
                  {count}<p className="text-[10px] uppercase tracking-widest">{label}</p>
                </button>
              ))}
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
              {selectedAvailabilityPeople.length === 0 && <MiniEmptyState>No team members in {availabilityFilter}.</MiniEmptyState>}
              {selectedAvailabilityPeople.map(member => {
                const tasks = activeTasksFor(member.name);
                const since = availabilityFilter === 'Break' ? (member.breakStartedAt || member.availabilityUpdatedAt || Date.now()) : (member.availabilityUpdatedAt || member.lastSeenAt || member.lastLoginAt || Date.now());
                return (
                  <div key={member.id} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-2xl p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                        {member.profilePhoto ? <img src={member.profilePhoto} alt={member.name} className="w-full h-full object-cover" /> : <User className="w-4 h-4 text-slate-400" />}
                      </div>
                      <div>
                        <p className="font-black text-slate-800 text-sm">{member.name}</p>
                        <p className="text-[11px] font-bold text-slate-400">{member.role === ROLES.ADMIN && availabilityFilter === 'Available' ? 'Available' : availabilityFilter === 'Busy' ? tasks.map(t => t.id).join(', ') : availabilityFilter === 'Break' ? `Break since ${formatDuration(since, Date.now())}` : availabilityFilter === 'Available' ? `Free since ${formatDuration(since, Date.now())}` : `Last seen ${formatLastSeenDateTime(member.lastSeenAt || member.lastLogoutAt || member.lastHeartbeatAt)}`}</p>
                      </div>
                    </div>
                    <Badge colorClass={availabilityFilter === 'Busy' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : availabilityFilter === 'Break' ? 'bg-amber-50 text-amber-700 border-amber-100' : availabilityFilter === 'Available' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-slate-50 text-slate-600 border-slate-100'}>{availabilityFilter}</Badge>
                  </div>
                );
              })}
            </div>
          </div>
          {currentUser?.role === ROLES.ADMIN && <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><h3 className="font-black text-slate-800 mb-4">Payment Health</h3><p className="text-xs font-black text-slate-400 uppercase tracking-widest">Received Today</p><p className="text-3xl font-black text-emerald-600 mb-4">₹{metrics.paymentReceived.toLocaleString()}</p><p className="text-xs font-black text-slate-400 uppercase tracking-widest">Pending Collections</p><p className="text-3xl font-black text-red-500">₹{metrics.pendingAmount.toLocaleString()}</p></div>}
          <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><h3 className="font-black text-slate-800 mb-4">Urgent Revision Queue</h3>{metrics.revisions.slice(0,5).map(p => <button key={p.id} onClick={() => onSelectProject(p)} className="w-full text-left bg-red-50 border border-red-100 p-3 rounded-xl mb-2"><p className="font-black text-red-700 text-xs">{p.id}</p><p className="text-[10px] font-bold text-red-500">{p.subTasks?.length || 0} revision items</p></button>)}{metrics.revisions.length === 0 && <p className="text-sm text-slate-400 font-bold">No urgent revisions.</p>}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4"><h3 className="font-black text-slate-800 flex items-center"><Users className="w-5 h-5 mr-2 text-indigo-500" /> Designer Performance Cards</h3><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Active workload</span></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto custom-scrollbar pr-1">
            {workloadCards.map(member => (
              <div key={member.id} className="border border-slate-100 bg-slate-50 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-3"><div><p className="font-black text-slate-800">{member.name}</p><p className="text-[11px] font-bold text-slate-400">{member.role} • {member.active.length}/{member.limit} active</p></div><Badge colorClass={member.loadPct >= 90 ? 'bg-red-50 text-red-700 border-red-100' : member.loadPct >= 60 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}>{member.loadPct}%</Badge></div>
                <div className="h-2 bg-white rounded-full overflow-hidden mb-3"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${member.loadPct}%` }}></div></div>
                <div className="grid grid-cols-3 gap-2 text-center"><div className="bg-white rounded-xl p-2"><p className="font-black text-slate-800">{member.active.length}</p><p className="text-[9px] font-black uppercase text-slate-400">Active</p></div><div className="bg-white rounded-xl p-2"><p className="font-black text-emerald-600">{member.completedToday}</p><p className="text-[9px] font-black uppercase text-slate-400">Done</p></div><div className="bg-white rounded-xl p-2"><p className="font-black text-red-500">{member.revisions}</p><p className="text-[9px] font-black uppercase text-slate-400">Revisions</p></div></div>
              </div>
            ))}
            {workloadCards.length === 0 && <p className="text-sm text-slate-400 font-bold text-center py-8">No designer or manager workload available.</p>}
          </div>
        </div>
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
            <h3 className="font-black text-slate-800 mb-4 flex items-center"><Star className="w-5 h-5 mr-2 text-amber-500" /> Top Today</h3>
            <div className="space-y-3">
              {topPerformers.map((member, idx) => <div key={member.id} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-2xl p-3"><div><p className="font-black text-slate-800 text-sm">{idx + 1}. {member.name}</p><p className="text-[11px] font-bold text-slate-400">{member.completedToday} completed • {member.active.length} active</p></div><Badge colorClass="bg-amber-50 text-amber-700 border-amber-100">{member.role}</Badge></div>)}
              {topPerformers.length === 0 && <p className="text-sm text-slate-400 font-bold">No completion data yet.</p>}
            </div>
          </div>
          <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
            <h3 className="font-black text-slate-800 mb-4 flex items-center"><Clock className="w-5 h-5 mr-2 text-indigo-500" /> SLA Tracking</h3>
            <div className="space-y-3 max-h-72 overflow-y-auto custom-scrollbar">
              {activeBoard.slice().sort((a,b) => getSlaInfo(b).ageHours - getSlaInfo(a).ageHours).slice(0,8).map(p => { const sla = getSlaInfo(p); return (
                <button key={p.id} type="button" onClick={() => onSelectProject(p)} className="w-full text-left border border-slate-100 hover:border-indigo-100 hover:bg-slate-50 rounded-2xl p-4 transition-all">
                  <div className="flex justify-between items-start gap-3">
                    <div><p className="font-black text-slate-800">{p.id}</p><p className="text-xs font-bold text-slate-400 mt-1">Draft: {sla.drafting} • Review: {sla.review} • Total: {sla.total}</p></div>
                    <Badge colorClass={sla.colorClass}>{sla.label}</Badge>
                  </div>
                </button>
              )})}
              {activeBoard.length === 0 && <p className="text-sm text-slate-400 font-bold text-center py-8">No SLA items for this date.</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
        <h3 className="font-black text-slate-800 mb-4 flex items-center"><Bell className="w-5 h-5 mr-2 text-indigo-500" /> Latest Activity</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto custom-scrollbar">
          {projects.slice().sort((a,b) => (b.updatedAt || b.completedAt || b.submittedAt || b.createdAt || 0) - (a.updatedAt || a.completedAt || a.submittedAt || a.createdAt || 0)).slice(0,10).map(p => (
            <button key={p.id} type="button" onClick={() => onSelectProject(p)} className="w-full text-left bg-slate-50 hover:bg-indigo-50 border border-slate-100 rounded-2xl p-4 transition-all">
              <p className="font-black text-slate-800">{p.id} • {p.status}</p>
              <p className="text-xs font-bold text-slate-500 mt-1">{getCustomerDisplayName(p)} • {p.location} • {p.assignedTo || 'Unassigned'}</p>
            </button>
          ))}
          {projects.length === 0 && <p className="text-sm text-slate-400 font-bold text-center py-8">No recent activity yet.</p>}
        </div>
      </div>
    </div>
  );
};

const ProductivityDashboard = ({ users = [], projects = [] }) => {
  const todayKey = formatDateKey();
  const weekStart = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const monthKey = todayKey.slice(0,7);
  const team = (users || []).filter(u => (u.role === ROLES.DESIGNER || u.role === ROLES.MANAGER) && u.status === 'APPROVED');
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div><h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Productivity Dashboard</h1><p className="text-slate-500 font-medium mt-2">Designer and manager performance, visible to the whole team.</p></div>
      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-left text-sm whitespace-nowrap"><thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100"><tr><th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Member</th><th className="px-6 py-5 text-center font-bold uppercase tracking-wider text-xs">Today</th><th className="px-6 py-5 text-center font-bold uppercase tracking-wider text-xs">Week</th><th className="px-6 py-5 text-center font-bold uppercase tracking-wider text-xs">Month</th><th className="px-6 py-5 text-center font-bold uppercase tracking-wider text-xs">Active</th><th className="px-6 py-5 text-center font-bold uppercase tracking-wider text-xs">Avg SLA</th><th className="px-6 py-5 text-center font-bold uppercase tracking-wider text-xs">Revision %</th></tr></thead><tbody className="divide-y divide-slate-100">{team.map(u => { const userTasks = projects.filter(p => p.assignedTo === u.name); const completed = userTasks.filter(p => p.status === 'Completed'); const today = completed.filter(p => formatDateKey(p.completedAt || p.createdAt) === todayKey).length; const week = completed.filter(p => (p.completedAt || 0) >= weekStart).length; const month = completed.filter(p => formatDateKey(p.completedAt || p.createdAt).slice(0,7) === monthKey).length; const active = userTasks.filter(p => p.status !== 'Completed').length; const revs = userTasks.filter(p => (p.subTasks || []).length > 0).length; const revPct = userTasks.length ? Math.round((revs / userTasks.length) * 100) : 0; const avgMins = completed.length ? Math.round(completed.reduce((sum,p) => sum + Math.max(0, ((p.completedAt || p.submittedAt || p.createdAt || Date.now()) - (p.createdAt || Date.now()))/60000), 0) / completed.length) : 0; return <tr key={u.id} className="hover:bg-slate-50"><td className="px-6 py-5"><p className="font-black text-slate-800">{u.name}</p><p className="text-xs font-bold text-slate-400">{u.role}</p></td><td className="px-6 py-5 text-center font-black text-emerald-600">{today}</td><td className="px-6 py-5 text-center font-black text-indigo-600">{week}</td><td className="px-6 py-5 text-center font-black text-slate-800">{month}</td><td className="px-6 py-5 text-center"><span className="bg-orange-50 text-orange-700 px-3 py-1 rounded-lg font-black text-xs">{active}</span></td><td className="px-6 py-5 text-center font-bold text-slate-600">{avgMins ? formatDuration(0, avgMins * 60000) : '-'}</td><td className="px-6 py-5 text-center font-bold text-red-500">{revPct}%</td></tr> })}</tbody></table></div></div>
    </div>
  );
};

const DailyClosingReport = ({ projects = [] }) => {
  const [dateKey, setDateKey] = useState(formatDateKey());
  const metrics = getTodayMetrics(projects, dateKey);
  const rows = [
    ['Cases Received', metrics.received], ['Carried Forward Pending', metrics.carriedCount], ['Cases Completed', metrics.completed], ['Urgent Revisions', metrics.revisions.length], ['Payments Received', `₹${metrics.paymentReceived.toLocaleString()}`], ['Pending Collections', `₹${metrics.pendingAmount.toLocaleString()}`]
  ];
  const handleExport = () => exportToCSV(['Metric','Value'], rows, `Daily_Closing_${dateKey}.csv`);
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4"><div><h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Daily Closing Report</h1><p className="text-slate-500 font-medium mt-2">End-of-day summary with pending work carried forward.</p></div><div className="flex gap-3"><input type="date" value={dateKey} onChange={e => setDateKey(e.target.value)} className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2.5 font-bold text-slate-700 outline-none" /><button onClick={handleExport} className="bg-emerald-100 text-emerald-700 font-bold px-4 py-2.5 rounded-xl"><Download className="w-4 h-4 inline mr-2"/>Export</button></div></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">{rows.map(([label,value]) => <div key={label} className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm"><p className="text-xs text-slate-400 font-black uppercase tracking-widest">{label}</p><p className="text-3xl font-black text-slate-800 mt-2">{value}</p></div>)}</div>
      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden"><div className="p-5 border-b-2 border-slate-100"><h2 className="font-black text-slate-800 text-xl">Pending Carry Forward List</h2></div><div className="divide-y divide-slate-100">{metrics.carried.map(p => <div key={p.id} className="p-5 flex justify-between items-center"><div><p className="font-black text-slate-800">{p.id}</p><p className="text-xs font-bold text-slate-400">{getCustomerDisplayName(p)} • {p.location} • {p.assignedTo}</p></div><Badge colorClass={getStatusColor(p.status)}>{p.status}</Badge></div>)}{metrics.carried.length === 0 && <div className="p-10 text-center text-slate-400 font-bold">No previous pending tasks to carry forward.</div>}</div></div>
    </div>
  );
};

const LedgerView = ({ projects, onSelectProject }) => {
  const [activeTab, setActiveTab] = useState('transactions');
  const [selectedLocation, setSelectedLocation] = useState('All');
  const [selectedClient, setSelectedClient] = useState('All');
  
  const baseLedgerProjects = projects.filter(p => (Number(p.estimate) > 0) || (Number(p.ledger?.amountIn) > 0) || p.ledger?.updatedAt);
  const allLocations = [...new Set(baseLedgerProjects.map(p => p.location).filter(Boolean))].sort();
  const availableClients = [...new Set(baseLedgerProjects.filter(p => selectedLocation === 'All' || p.location === selectedLocation).map(p => p.client).filter(Boolean))].sort();

  useEffect(() => {
    if (selectedClient !== 'All' && !availableClients.includes(selectedClient)) setSelectedClient('All');
  }, [selectedLocation, availableClients, selectedClient]);

  const ledgerProjects = baseLedgerProjects.filter(p => {
      if (selectedLocation !== 'All' && p.location !== selectedLocation) return false;
      if (selectedClient !== 'All' && p.client !== selectedClient) return false;
      return true;
  }).sort((a,b) => ((b.ledger?.updatedAt || b.completedAt || b.createdAt) || 0) - ((a.ledger?.updatedAt || a.completedAt || a.createdAt) || 0));

  const totalCost = ledgerProjects.reduce((sum, p) => sum + (Number(p.estimate) || 0), 0);
  const totalReceived = ledgerProjects.reduce((sum, p) => sum + (Number(p.ledger?.amountIn) || 0), 0);
  const totalExpenses = ledgerProjects.reduce((sum, p) => sum + (Number(p.ledger?.expenses) || 0), 0);
  const totalRefund = ledgerProjects.reduce((sum, p) => sum + (Number(p.ledger?.refund) || 0), 0);
  const netRevenue = totalReceived - totalExpenses - totalRefund;
  const totalPending = ledgerProjects.reduce((sum, p) => sum + Math.max(0, (Number(p.estimate) || 0) - (Number(p.ledger?.amountIn) || 0)), 0);

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
    const headers = ["Task ID", "Created Date", "Client", "Customer", "Location", "Cost (Est)", "Received", "Actual Expenses", "Refund", "Pending"];
    const rows = ledgerProjects.map(p => [
      p.id, p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '-',
      p.client, p.customerName || '', p.location || '', Number(p.estimate)||0, Number(p.ledger?.amountIn)||0, Number(p.ledger?.expenses)||0, Number(p.ledger?.refund)||0, (Number(p.estimate)||0) - (Number(p.ledger?.amountIn)||0)
    ]);
    exportToCSV(headers, rows, "Financial_Ledger.csv");
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
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
           </div>
        </div>
        <div className="flex flex-wrap gap-3 mt-4 xl:mt-0">
          <div className="flex flex-wrap bg-slate-100 p-1.5 rounded-xl border border-slate-200">
            <button type="button" onClick={() => setActiveTab('transactions')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center ${activeTab === 'transactions' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><FileText className="w-4 h-4 mr-1.5" /> All Logs</button>
            <button type="button" onClick={() => setActiveTab('pending')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center ${activeTab === 'pending' ? 'bg-red-50 text-red-600 shadow-sm border border-red-100' : 'text-slate-500 hover:text-slate-700'}`}><Clock className="w-4 h-4 mr-1.5" /> Pending</button>
            <button type="button" onClick={() => setActiveTab('monthly')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center ${activeTab === 'monthly' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><List className="w-4 h-4 mr-1.5" /> Monthly</button>
            <button type="button" onClick={() => setActiveTab('clients')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center ${activeTab === 'clients' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Briefcase className="w-4 h-4 mr-1.5" /> Banks</button>
            <button type="button" onClick={() => setActiveTab('customers')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center ${activeTab === 'customers' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><User className="w-4 h-4 mr-1.5" /> Customers</button>
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
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Cost (Est)</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Received</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Expenses</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Pending</th>
                  <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-center">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledgerProjects.filter(p => activeTab === 'pending' ? ((Number(p.estimate) || 0) > (Number(p.ledger?.amountIn) || 0)) : true).map(p => {
                  const est = Number(p.estimate) || 0;
                  const rec = Number(p.ledger?.amountIn) || 0;
                  const exp = Number(p.ledger?.expenses) || 0;
                  const pen = est - rec;
                  const updateDate = p.ledger?.updatedAt ? new Date(p.ledger.updatedAt) : null;
                  
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-5">
                        <p className="font-bold text-slate-800">{updateDate ? formatDateTime(updateDate) : (p.ledger?.date ? formatDateTime(p.ledger.date) : '-')}</p>
                        <p className="text-xs font-semibold text-slate-400 mt-0.5">{updateDate ? updateDate.toLocaleTimeString() : 'Manual Entry'}</p>
                      </td>
                      <td className="px-6 py-5 cursor-pointer group" onClick={() => onSelectProject(p)}>
                        <div className="flex items-center">
                           <p className="font-bold text-slate-700 group-hover:text-indigo-600 transition-colors">{p.id}</p>
                           <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded ml-2 font-semibold">Created: {p.createdAt ? formatDateTime(p.createdAt) : '-'}</span>
                        </div>
                        <p className="font-medium text-slate-500 text-xs mt-0.5">{getCustomerDisplayName(p)}</p>
                      </td>
                      <td className="px-6 py-5 text-right font-bold text-slate-600">₹{est.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-bold text-emerald-600">₹{rec.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-bold text-amber-600">₹{exp.toLocaleString()}</td>
                      <td className="px-6 py-5 text-right font-black text-slate-800">
                        {pen > 0 ? <span className="text-red-500 bg-red-50 px-2 py-1 rounded-lg border border-red-100">₹{pen.toLocaleString()}</span> : <span className="text-slate-400"><CheckCircle className="w-4 h-4 inline text-emerald-500"/> Cleared</span>}
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
                   <tr><td colSpan="7" className="text-center py-10 text-slate-500 font-medium">No records found for this view.</td></tr>
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
        </div>
      </div>
    </div>
  );
};

const HistoryArchiveView = ({ projects, onSelectProject }) => {
  const [filterMonth, setFilterMonth] = useState('All');
  const [filterDate, setFilterDate] = useState('');

  const archived = projects.filter(p => p.status === 'Completed').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  const uniqueMonths = [...new Set(archived.map(p => {
    if (!p.completedAt) return null;
    try {
        return new Date(p.completedAt).toLocaleString('default', { month: 'long', year: 'numeric' });
    } catch(e) { return null; }
  }).filter(Boolean))];

  const filteredArchived = archived.filter(p => {
    if (!p.completedAt) return false;
    try {
        const d = new Date(p.completedAt);
        const monthYear = d.toLocaleString('default', { month: 'long', year: 'numeric' });
        const exactDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

        if (filterDate) return exactDate === filterDate;
        if (filterMonth !== 'All') return monthYear === filterMonth;
        return true;
    } catch(e) { return false; }
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-5">
         <div>
             <h2 className="text-3xl font-extrabold text-slate-800 flex items-center tracking-tight"><Archive className="w-8 h-8 mr-3 text-indigo-500"/> Task History Catalog</h2>
             <p className="text-slate-500 mt-2 font-medium">{filteredArchived.length} Completed Tasks securely stored on the cloud.</p>
         </div>
         <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-2xl border-2 border-slate-100 shadow-sm w-full sm:w-auto">
            <div className="flex items-center space-x-2 px-3 py-1">
                <Calendar className="w-5 h-5 text-indigo-400" />
                <select value={filterMonth} onChange={(e) => {setFilterMonth(e.target.value); setFilterDate('');}} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer">
                    <option value="All">All Months</option>
                    {uniqueMonths.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
            </div>
            <div className="w-0.5 h-8 bg-slate-100 hidden sm:block"></div>
            <div className="flex items-center space-x-2 px-3 py-1">
                <Filter className="w-5 h-5 text-indigo-400" />
                <input type="date" value={filterDate} onChange={(e) => {setFilterDate(e.target.value); setFilterMonth('All');}} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer" />
            </div>
            {(filterDate || filterMonth !== 'All') && (
                <button type="button" onClick={() => {setFilterMonth('All'); setFilterDate('');}} className="ml-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl transition-colors">Clear</button>
            )}
         </div>
      </div>
      
      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
              <tr>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Date Completed</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Task Details</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Location</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Designer</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredArchived.map(p => (
                <tr key={p.id} className="hover:bg-slate-50 cursor-pointer transition-colors group" onClick={() => onSelectProject(p)}>
                  <td className="px-6 py-5">
                    <span className="font-bold text-slate-700">{p.completedAt ? formatDateTime(p.completedAt) : '-'}</span>
                    <p className="text-[11px] font-semibold text-slate-400 mt-1">{p.completedAt ? new Date(p.completedAt).toLocaleTimeString() : ''}</p>
                  </td>
                  <td className="px-6 py-5">
                     <p className="font-bold text-slate-800 text-base">{p.id}</p>
                     <p className="text-xs font-medium text-slate-500 mt-1">{getCustomerDisplayName(p)} • {p.type}</p>
                  </td>
                  <td className="px-6 py-5 font-medium text-slate-600">{p.location}</td>
                  <td className="px-6 py-5 font-medium text-slate-600">{p.assignedTo}</td>
                  <td className="px-6 py-5 text-right flex items-center justify-end gap-2">
                     {p.reportSent && <span className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg flex items-center mr-2"><Check className="w-3 h-3 mr-1"/> Sent</span>}
                     <button type="button" className="text-indigo-600 bg-indigo-50 group-hover:bg-indigo-600 group-hover:text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm">View Files</button>
                  </td>
                </tr>
              ))}
              {filteredArchived.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-16 text-center text-slate-400 font-medium">No completed tasks found for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const TeamMeetingRoom = ({ currentUser }) => {
  const [copied, setCopied] = useState(false);
  const [meetingMode, setMeetingMode] = useState('video');
  const [meetingStartedAt, setMeetingStartedAt] = useState(null);
  const [meetingNow, setMeetingNow] = useState(Date.now());
  const [meetingNotes, setMeetingNotes] = useState('');
  const roomName = createSafeMeetingRoomName('KalpaVriksha_Ops_TeamRoom', safeAppId);
  const meetingUrl = buildJitsiUrl(roomName, currentUser?.name, {
    audioOnly: meetingMode === 'audio',
    muteVideo: meetingMode === 'audio'
  });
  const screenShareUrl = buildJitsiUrl(roomName, currentUser?.name, {
    shareScreen: true,
    muteAudio: true,
    muteVideo: true
  });
  const openMeeting = () => window.open(meetingUrl, '_blank', 'noopener,noreferrer');
  const openScreenShare = () => window.open(screenShareUrl, '_blank', 'noopener,noreferrer');
  const handleCopy = async () => {
    const ok = await copyTextToClipboard(meetingUrl);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1800);
  };
  useEffect(() => {
    try { setMeetingStartedAt(Number(localStorage.getItem('kalpa_team_meeting_started_at') || 0) || null); } catch(e) {}
    try { setMeetingNotes(localStorage.getItem('kalpa_team_meeting_notes') || ''); } catch(e) {}
  }, []);
  useEffect(() => {
    const t = setInterval(() => setMeetingNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const handleStartMeeting = () => {
    const now = Date.now();
    setMeetingStartedAt(now);
    try { localStorage.setItem('kalpa_team_meeting_started_at', String(now)); } catch(e) {}
  };
  const handleEndMeeting = () => {
    setMeetingStartedAt(null);
    try { localStorage.removeItem('kalpa_team_meeting_started_at'); } catch(e) {}
  };
  const handleNotesChange = (e) => {
    const value = e.target.value;
    setMeetingNotes(value);
    try { localStorage.setItem('kalpa_team_meeting_notes', value); } catch(err) {}
  };
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight flex items-center"><Video className="w-8 h-8 mr-3 text-indigo-500"/> Team Virtual Office</h1>
          <p className="text-slate-500 mt-2 font-medium">Persistent audio/video meeting room for instant collaboration, screen sharing, and team discussions.</p>
          <p className="text-[11px] text-slate-400 font-bold mt-2 uppercase tracking-widest">Camera • Mic • Share Screen • Open in New Tab</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setMeetingMode('video')} className={`px-4 py-2 rounded-xl text-xs font-black border transition-colors ${meetingMode === 'video' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            <Video className="w-4 h-4 inline mr-1.5" /> Video
          </button>
          <button type="button" onClick={() => setMeetingMode('audio')} className={`px-4 py-2 rounded-xl text-xs font-black border transition-colors ${meetingMode === 'audio' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            <Phone className="w-4 h-4 inline mr-1.5" /> Audio Only
          </button>
          <button type="button" onClick={handleStartMeeting} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition-colors shadow-sm">
            Start Meeting
          </button>
          {meetingStartedAt && <button type="button" onClick={handleEndMeeting} className="px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-xl text-xs font-black hover:bg-red-100 transition-colors">End</button>}
          <button type="button" onClick={handleCopy} className="px-4 py-2 bg-white text-indigo-700 border border-indigo-100 rounded-xl text-xs font-black hover:bg-indigo-50 transition-colors">
            {copied ? 'Link Copied' : 'Copy Link'}
          </button>
          <button type="button" onClick={openMeeting} className="px-5 py-2 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-colors flex items-center w-fit">
            <Video className="w-4 h-4 mr-2" /> Open Meeting
          </button>
          <button type="button" onClick={openScreenShare} className="px-5 py-2 bg-slate-900 text-white rounded-xl font-bold shadow-md hover:bg-slate-800 transition-colors flex items-center w-fit">
            <Video className="w-4 h-4 mr-2" /> Share Screen
          </button>
        </div>
      </div>
      <div className="bg-white border border-indigo-100 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
        <div>
          <p className="text-sm font-extrabold text-slate-800">Team meeting room is always the same for everyone.</p>
          <p className="text-xs font-semibold text-slate-500 mt-1">Meetings now open in a full browser tab for reliable camera, mic and screen sharing. If screen sharing does not start automatically, click the Jitsi Share Screen button in the bottom toolbar.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {meetingStartedAt && <span className="text-[10px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-700 border border-indigo-100 px-3 py-1.5 rounded-full">Live • {formatCallDuration(meetingStartedAt, meetingNow)}</span>}
          <span className="text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-100 px-3 py-1.5 rounded-full">Ready</span>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-extrabold text-slate-800 mb-2">Meeting notes</p>
          <textarea value={meetingNotes} onChange={handleNotesChange} rows={3} placeholder="Write quick discussion points, decisions, or action items here..." className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all resize-none" />
          <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest">Saved locally in this browser; does not affect other modules.</p>
        </div>
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-extrabold text-indigo-900 mb-2">Quick meeting flow</p>
          <ul className="text-xs font-semibold text-indigo-700 space-y-1.5">
            <li>1. Click Start Meeting.</li>
            <li>2. Allow mic/camera permission.</li>
            <li>3. Use Jitsi toolbar for screen share.</li>
            <li>4. Copy link for users joining from another browser.</li>
          </ul>
        </div>
      </div>
      <div className="w-full min-h-[360px] bg-slate-900 rounded-3xl overflow-hidden shadow-xl border-4 border-slate-800 relative flex items-center justify-center p-6 text-center">
        <div className="max-w-xl">
          <div className="w-16 h-16 rounded-2xl bg-white/10 text-white flex items-center justify-center mx-auto mb-4">
            <Video className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black text-white">Open meeting in a new tab</h2>
          <p className="text-sm font-semibold text-slate-300 mt-3">Embedded meetings can hide or block screen sharing in some browsers. Use the buttons below for the full Jitsi toolbar.</p>
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            <button type="button" onClick={openMeeting} className="px-5 py-3 rounded-xl bg-indigo-600 text-white text-sm font-black hover:bg-indigo-700 shadow-md">Open Meeting</button>
            <button type="button" onClick={openScreenShare} className="px-5 py-3 rounded-xl bg-white text-slate-900 text-sm font-black hover:bg-slate-100 shadow-md">Share Screen</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const TaskDetailView = ({ project, user, onBack, onUpdateProject, users, onDeleteTask }) => {
  const [newSubTask, setNewSubTask] = useState('');
  const [newNote, setNewNote] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isUploadingFinal, setIsUploadingFinal] = useState(false);
  const completedFileInputRef = useRef(null);
  
  const canManage = user.role === ROLES.ADMIN || user.role === ROLES.MANAGER;
  const isAssignedToMe = project.assignedTo === user.name;
  const showFinancials = user.role === ROLES.ADMIN;

  const handleAdvanceStatus = () => {
    const updatedProject = { ...project };
    if (project.status === 'Lead Received') {
      updatedProject.status = 'Drafting';
      updatedProject.draftingStartedAt = updatedProject.draftingStartedAt || Date.now();
    }
    else if (project.status === 'Drafting') {
      updatedProject.status = 'Completed';
      updatedProject.draftingCompletedAt = Date.now();
      updatedProject.completedAt = Date.now();
      updatedProject.reviewedBy = user.name;
      updatedProject.completedBy = user.name;
      updatedProject.ownership = { ...(updatedProject.ownership || {}), reviewedBy: user.name, completedBy: user.name };
    }
    else if (project.status === 'Internal Review') {
      updatedProject.status = 'Completed';
      updatedProject.completedAt = Date.now();
      updatedProject.reviewedBy = user.name;
      updatedProject.completedBy = user.name;
      updatedProject.ownership = { ...(updatedProject.ownership || {}), reviewedBy: user.name, completedBy: user.name };
    }
    
    updatedProject.timeline = [
      ...(updatedProject.timeline || []), 
      { id: Date.now(), text: `Status advanced to ${updatedProject.status}`, time: new Date().toLocaleString() }
    ];
    onUpdateProject(updatedProject, project);
  };

  const handleRevertStatus = () => {
    const updatedProject = { ...project };
    let revertedTo = '';
    
    if (project.status === 'Drafting') revertedTo = 'Lead Received';
    else if (project.status === 'Internal Review') revertedTo = 'Drafting';
    else if (project.status === 'Completed') {
      revertedTo = 'Internal Review';
      updatedProject.completedAt = null; 
      updatedProject.reportSent = false;
    }
    
    if (revertedTo) {
      updatedProject.status = revertedTo;
      updatedProject.timeline = [
        ...(updatedProject.timeline || []), 
        { id: Date.now(), text: `Status reverted back to ${revertedTo}`, time: new Date().toLocaleString() }
      ];
      onUpdateProject(updatedProject, project);
    }
  };

  const handleFileUpload = async (type, e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (type === 'completed') setIsUploadingFinal(true);

    try {
    const updatedProject = { ...project };
    if (!updatedProject.documents) updatedProject.documents = [];
    if (!updatedProject.completedFiles) updatedProject.completedFiles = [];

    for (const file of Array.from(files)) {
        const uploadedDoc = await uploadProjectFile(file, project.id, type, user.name);
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
      updatedProject.status = 'Completed';
      updatedProject.submittedAt = updatedProject.submittedAt || Date.now();
      updatedProject.draftingCompletedAt = updatedProject.draftingCompletedAt || Date.now();
      updatedProject.completedAt = updatedProject.completedAt || Date.now();
      updatedProject.timeline.push({ id: Date.now()+3, text: 'Completed file uploaded. Task marked Completed.', time: new Date().toLocaleString() });
    }

    if (e?.target) e.target.value = '';
    onUpdateProject(updatedProject, project);
    } catch (error) {
      console.error('File upload failed:', error);
      alert('File upload failed. Please try again with a smaller file or different format.');
    } finally {
      if (type === 'completed') setIsUploadingFinal(false);
      if (e?.target) e.target.value = '';
    }
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
    if (!newSubTask.trim()) return;
    const updatedProject = {
      ...project,
      priority: 'Urgent', 
      status: 'Internal Review',
      subTasks: [
        ...(project.subTasks || []),
        { id: Date.now(), title: newSubTask, status: 'Pending', addedBy: user.name, timeSpent: '0h' }
      ],
      timeline: [
        ...(project.timeline || []),
        { id: Date.now(), text: `Revision/Sub-task Added: ${newSubTask}`, time: new Date().toLocaleString() }
      ]
    };
    onUpdateProject(updatedProject, project);
    setNewSubTask('');
  };

  const toggleSubTask = (subTaskId) => {
    const updatedSubTasks = (project.subTasks||[]).map(st => 
      st.id === subTaskId ? { ...st, status: st.status === 'Pending' ? 'Done' : 'Pending' } : st
    );
    onUpdateProject({ ...project, subTasks: updatedSubTasks }, project);
  };

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    const updatedProject = {
      ...project,
      notes: [...(project.notes||[]), { id: Date.now(), text: newNote, author: user.name, time: new Date().toLocaleString() }]
    };
    onUpdateProject(updatedProject, project);
    setNewNote('');
  };

  const updateLedger = (field, value) => {
    if (!showFinancials) return;
    const updatedProject = {
      ...project,
      ledger: { ...(project.ledger || {}), [field]: value, updatedAt: Date.now() }
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


  const shareCompletedFileOnWhatsApp = async () => {
    const completedDocs = getCompletedDocuments(project);
    if (completedDocs.length === 0) {
      alert('No completed file found for WhatsApp sharing. Please upload the completed PDF/DWG first.');
      return;
    }
    const docToShare = completedDocs[completedDocs.length - 1];

    try {
      if (navigator.canShare) {
        const response = await fetch(docToShare.url);
        const blob = await response.blob();
        const file = new File([blob], docToShare.name, { type: blob.type || docToShare.mimeType || 'application/octet-stream' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: docToShare.name });
          onUpdateProject({
            ...project,
            reportSent: true,
            deliveryLog: [...(project.deliveryLog || []), { via: 'WhatsApp / native share', file: docToShare.name, by: user.name, time: new Date().toLocaleString() }],
            timeline: [...(project.timeline || []), { id: Date.now(), text: `Completed file delivered via WhatsApp: ${docToShare.name}`, time: new Date().toLocaleString() }]
          }, project);
          return;
        }
      }
    } catch (e) {
      console.log('Native file share unavailable, using WhatsApp Web fallback.', e);
    }

    if (docToShare.url) {
      const link = document.createElement('a');
      link.href = docToShare.url;
      link.download = docToShare.name || `${project.id}-completed-file`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    onUpdateProject({
      ...project,
      reportSent: true,
      deliveryLog: [...(project.deliveryLog || []), { via: 'WhatsApp Web fallback', file: docToShare.name, by: user.name, time: new Date().toLocaleString() }],
      timeline: [...(project.timeline || []), { id: Date.now(), text: `Completed file prepared for WhatsApp delivery: ${docToShare.name}`, time: new Date().toLocaleString() }]
    }, project);
    window.open('https://web.whatsapp.com/', '_blank');
  };

  const completedDocsCount = getCompletedDocuments(project).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
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
            {project.draftingStartedAt && <p className="text-xs font-bold text-indigo-600 mt-1 flex items-center"><Clock className="w-3.5 h-3.5 mr-1" /> Drafting elapsed: {getDraftElapsed(project)}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          
          <button id="client-link-btn" type="button" onClick={copyClientLink} className={`px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all flex items-center font-bold text-sm whitespace-nowrap`}>
             <LinkIcon className="w-4 h-4 mr-1.5" /> Client Link
          </button>
          
          <button type="button" onClick={shareCompletedFileOnWhatsApp} disabled={completedDocsCount === 0} className={`px-4 py-2.5 rounded-xl transition-all flex items-center font-bold text-sm whitespace-nowrap ${completedDocsCount > 0 ? 'bg-green-500 text-white hover:bg-green-600 shadow-md shadow-green-100' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
             <Send className="w-4 h-4 mr-1.5" /> Share PDF on WhatsApp
          </button>
          
          {user.role === ROLES.ADMIN && (
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
          
          {(canManage && project.status !== 'Lead Received') && (
              <button type="button" onClick={handleRevertStatus} className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all flex items-center font-bold text-sm whitespace-nowrap">
                  <ArrowLeft className="w-4 h-4 mr-1.5" /> Revert
              </button>
          )}

          {project.status !== 'Completed' && (isAssignedToMe || canManage) && (
             <button type="button" onClick={handleAdvanceStatus} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center font-bold text-sm whitespace-nowrap">
               <CheckCircle className="w-4 h-4 mr-2" />
               Advance Status
             </button>
          )}
        </div>
      </div>

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

              {showFinancials && project.estimateDetails && (
                <div className="col-span-1 sm:col-span-2 mt-2 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                  <p className="text-sm text-amber-800 font-bold">Estimate Detail: <span className="font-medium">{project.estimateDetails}</span></p>
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
                  <label className="text-sm text-indigo-700 hover:text-indigo-800 font-bold flex items-center cursor-pointer bg-indigo-50 px-4 py-2 rounded-xl transition-colors border border-indigo-100">
                     <Plus className="w-4 h-4 mr-1.5" /> Add Source File
                     <input type="file" multiple className="hidden" onChange={(e) => handleFileUpload('source', e)} />
                  </label>
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
                 <div key={idx} className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-indigo-200 transition-colors">
                   <div className="flex items-center text-slate-700 overflow-hidden pr-2">
                     <div className="p-2 bg-white rounded-lg shadow-sm border border-slate-100">{getFileIcon(doc.name)}</div>
                     <span className="font-bold ml-4 truncate">{doc.name}</span>
                   </div>
                   {doc.url ? (
                     <a href={doc.url} download={doc.name} className="text-xs font-bold text-indigo-600 bg-white border border-slate-200 hover:bg-indigo-50 px-4 py-2 rounded-xl whitespace-nowrap transition-colors shadow-sm">Download</a>
                   ) : (
                     <button type="button" className="text-xs font-bold text-slate-400 bg-slate-50 px-4 py-2 rounded-xl whitespace-nowrap cursor-not-allowed border border-slate-200">Unavailable</button>
                   )}
                 </div>
               ))}
               
               <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-8 mb-4 border-t-2 border-slate-100 pt-6">
                  <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest bg-blue-50 py-2 px-3 rounded-lg inline-block">Working Files & Drafts</h3>
                  <label className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center cursor-pointer bg-blue-50 px-3 py-1.5 rounded-lg transition-colors border border-blue-100">
                    <Plus className="w-3 h-3 mr-1" /> Upload Work File
                    <input type="file" multiple className="hidden" accept=".jpg,.jpeg,.png,.mp4,.mov,.avi,.mkv,.webm,.pdf,.dwg,.dxf,.xls,.xlsx,.doc,.docx" onChange={(e) => handleFileUpload('working', e)} />
                  </label>
               </div>
               {(project.documents||[]).filter(d => d.type === 'working').length === 0 && <p className="text-sm text-slate-500 font-medium italic px-2">No working files uploaded yet.</p>}
               {(project.documents||[]).filter(d => d.type === 'working').map((doc, idx) => (
                 <div key={idx} className="flex items-center justify-between p-3.5 bg-blue-50/50 rounded-2xl border border-blue-100 group hover:border-blue-200 transition-colors">
                   <div className="flex items-center text-blue-900 overflow-hidden pr-2">
                     <div className="p-2 bg-white rounded-lg shadow-sm border border-blue-100">{getFileIcon(doc.name)}</div>
                     <span className="font-bold ml-4 truncate">{doc.name}</span>
                     <span className="text-[11px] font-bold ml-3 text-blue-600 bg-blue-100 px-2 py-1 rounded-lg whitespace-nowrap hidden sm:inline-block border border-blue-200">by {doc.uploadedBy}</span>
                   </div>
                   {doc.url ? (
                     <a href={doc.url} download={doc.name} className="text-xs font-bold text-blue-700 bg-white hover:bg-blue-50 shadow-sm border border-blue-200 px-4 py-2 rounded-xl whitespace-nowrap transition-colors">Download</a>
                   ) : (
                     <button type="button" className="text-xs font-bold text-slate-400 bg-slate-50 px-4 py-2 rounded-xl whitespace-nowrap cursor-not-allowed border border-slate-200">Unavailable</button>
                   )}
                 </div>
               ))}

               <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest bg-emerald-50 py-2 px-3 rounded-lg inline-block mt-8 border-t-2 border-slate-100 pt-6 w-full max-w-fit">Completed Work (AutoCAD/PDF)</h3>
               {getCompletedDocuments(project).length === 0 && <p className="text-sm text-slate-500 font-medium italic px-2">No completed files yet.</p>}
               {getCompletedDocuments(project).map((doc, idx) => (
                 <div key={idx} className="flex items-center justify-between p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-100 group">
                   <div className="flex items-center text-emerald-900 overflow-hidden pr-2">
                     <div className="p-2 bg-white rounded-lg shadow-sm border border-emerald-100">
                        {doc.name.includes('QR') ? <ImageIcon className="w-5 h-5 text-emerald-600" /> : getFileIcon(doc.name)}
                     </div>
                     <span className="font-bold ml-4 truncate">{doc.name}</span>
                     <span className="text-[10px] font-black ml-3 text-emerald-700 bg-white px-2 py-1 rounded-lg border border-emerald-100">V{idx + 1}</span>
                     <span className="text-[11px] font-bold ml-3 text-emerald-600 bg-emerald-100 px-2 py-1 rounded-lg whitespace-nowrap hidden sm:inline-block border border-emerald-200">by {doc.uploadedBy}</span>
                   </div>
                   {doc.url && (
                     <a href={doc.url} download={doc.name} className="text-xs font-bold text-emerald-700 bg-white hover:bg-emerald-50 shadow-sm border border-emerald-200 px-4 py-2 rounded-xl whitespace-nowrap transition-colors">Download</a>
                   )}
                 </div>
               ))}
             </div>
          </div>

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
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
              <textarea rows={3} value={newSubTask} onChange={(e) => setNewSubTask(e.target.value)} placeholder="Describe the revision... Enter creates a new line. Use Add Task to send." className="flex-1 border-2 border-slate-100 rounded-xl px-4 py-3 font-medium focus:border-indigo-500 focus:ring-0 outline-none transition-colors resize-none" />
              <button type="button" onClick={(e) => { e.preventDefault(); handleAddSubTask(); }} className="px-6 py-3 bg-slate-800 text-white rounded-xl shadow-md hover:bg-slate-700 font-bold whitespace-nowrap transition-colors flex items-center justify-center"><Send className="w-4 h-4 mr-2" /> Add Task</button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {(isAssignedToMe || canManage) && (project.status !== 'Completed' || getCompletedDocuments(project).length === 0) && (
            <div className="bg-gradient-to-b from-indigo-50 to-white p-1 rounded-3xl shadow-sm border border-indigo-100">
              <div className="bg-white p-6 rounded-[1.4rem]">
                <h2 className="text-lg font-extrabold mb-4 text-slate-800">Submit Work</h2>
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
            <h2 className="text-lg font-extrabold mb-4 text-slate-800">Team Discussion & Notes</h2>
            <div className="space-y-3 mb-5 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
              {(project.notes||[]).length === 0 && <p className="text-sm text-slate-400 font-medium italic">No discussion notes yet.</p>}
              {(project.notes||[]).map((note, idx) => (
                <div key={idx} className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                  <p className="text-sm font-semibold text-slate-700 whitespace-pre-wrap">{note.text}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-wider">{note.author} • {note.time}</p>
                </div>
              ))}
            </div>
            <div className="flex items-end space-x-2">
              <textarea rows={3} value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add note or comment... Enter creates a new line. Use Send to post." className="flex-1 border-2 border-slate-100 rounded-xl px-4 py-3 font-medium focus:border-indigo-500 outline-none transition-colors resize-none" />
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
              {(project.timeline||[]).map((event, idx) => (
                <div key={idx} className="flex group">
                  <div className="flex flex-col items-center mr-4">
                    <div className="w-3 h-3 rounded-full bg-indigo-500 mt-1 flex-shrink-0 shadow-sm shadow-indigo-200 group-hover:scale-125 transition-transform"></div>
                    {idx !== (project.timeline||[]).length - 1 && <div className="w-0.5 h-full bg-slate-100 my-1"></div>}
                  </div>
                  <div className="pb-2">
                    <p className="text-sm font-bold text-slate-800">{event.text}</p>
                    <p className="text-xs font-semibold text-slate-400 mt-0.5">{event.time}</p>
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

const CommunicationHub = ({ currentUser, users, chatMessages, onSendMessage, onDeleteMessage, onUpdateMessage, onMarkMessagesRead }) => {
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
  const normalizeChannelKey = (channel) => channel === 'global' ? 'global' : identityKey(channel);

  const chatUsers = getOperationalUsers(users || [], { includeAdmins: true }).filter(u => !samePerson(u.name, currentUser.name));
  const liveCurrentUser = getOperationalUsers(users || [], { includeAdmins: true }).find(u => samePerson(u.name, currentUser.name)) || currentUser;
  const currentUserOnline = isUserActuallyOnline(liveCurrentUser, presenceNow);
  const activePeer = activeChannel === 'global' ? null : chatUsers.find(u => samePerson(u.name, activeChannel));
  const activePeerOnline = activePeer ? isUserActuallyOnline(activePeer, presenceNow) : false;
  const activeCallRoom = activePeer ? createSafeMeetingRoomName('KalpaVriksha_DM', safeAppId, ...[currentUser.name, activePeer.name].sort()) : '';
  const activeCallUrl = activePeer ? buildJitsiUrl(activeCallRoom, currentUser.name, { audioOnly: callAudioOnly, shareScreen: callShareScreen }) : '';

  const chatEmojiGroups = [
    { label: 'Quick reactions', emojis: ['👍','❤️','😂','😮','😢','👏','🎉','🔥','✅','👀','🙏','🤝','🙌','💯','⭐','✨'] },
    { label: 'Smileys', emojis: ['😀','😃','😄','😁','😊','🙂','😉','😎','🤩','😅','🤣','😂','🥹','😍','😘','😇','🤔','🫡','🤫','😐','🙄','😮','😯','😴','😢','😭','😡','😤','🤯'] },
    { label: 'Work', emojis: ['📌','📎','📝','📁','📂','📄','📊','📈','📉','🗂️','🧾','🖊️','🧮','🏗️','🏠','📐','📏','🧱','💼','📅','⏰','⏳','🔔','💬','📞','🎥'] },
    { label: 'Status', emojis: ['✅','☑️','✔️','❌','⚠️','🚨','🔴','🟠','🟡','🟢','🔵','🟣','⬆️','⬇️','➡️','🔁','🔄','📍','🎯','🚀','🏁','🔒','🔓'] },
    { label: 'Celebration', emojis: ['🎉','🥳','🏆','🥇','🙌','👏','💪','🔥','⭐','✨','💯','🌟','🎊','🍰','☕','🌈'] },
  ];
  const reactionEmojis = ['👍','❤️','😂','😮','😢','👏','🎉','🔥','✅','👀','🙏','🤝','🙌','💯','⭐','✨','⚠️','🚀'];

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
      return true;
    }).length;
  };

  const unreadDirectTotal = chatUsers.reduce((sum, u) => sum + getDirectUnreadCountForUser(u.name), 0);
  const totalUnreadCount = isOpen ? unreadMessages.filter(m => !isMessageInActiveChannel(m)).length + unreadDirectTotal : Math.max(unreadMessages.length, unreadGlobalCount + unreadDirectTotal);
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
    const now = Date.now();
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
    const now = Date.now();
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

  const handleChatFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    onSendMessage(createBaseMessage({
      text: `Shared attachment: ${file.name}`,
      fileName: file.name,
      fileUrl: URL.createObjectURL(file),
      fileType: file.type || '',
      localPreviewOnly: true,
      fileSize: file.size || 0,
      replyTo: replyTo ? { id: replyTo.id, sender: replyTo.sender, text: replyTo.text || replyTo.fileName || 'Attachment' } : null,
    }));
    setReplyTo(null);
    if (e?.target) e.target.value = '';
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
      recorder.onstop = () => {
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        setIsRecordingVoice(false);
        if (!blob.size) return;
        const createdAt = Date.now();
        onSendMessage(createBaseMessage({
          id: createdAt,
          text: 'Shared voice note',
          fileName: `voice-note-${createdAt}.webm`,
          fileUrl: URL.createObjectURL(blob),
          fileType: blob.type || 'audio/webm',
          localPreviewOnly: true,
          fileSize: blob.size,
          sentAt: createdAt,
        }));
      };
      recorder.start();
      setIsRecordingVoice(true);
    } catch (error) {
      console.error('Voice note recording failed', error);
      setIsRecordingVoice(false);
      alert('Microphone permission is needed to record a voice note.');
    }
  };

  const stopVoiceRecording = () => {
    try {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else setIsRecordingVoice(false);
    } catch (error) {
      console.error('Voice note stop failed', error);
      setIsRecordingVoice(false);
    }
  };

  const startCall = (audioOnly = false, shareScreen = false) => {
    if (!activePeer) return;
    setCallAudioOnly(audioOnly);
    setCallShareScreen(shareScreen);
    setCallStartedAt(Date.now());
    setIsCalling(true);
    const room = createSafeMeetingRoomName('KalpaVriksha_DM', safeAppId, ...[currentUser.name, activePeer.name].sort());
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
    const body = m.text || m.fileName || 'Attachment';
    setEditingMessage(null);
    setReplyTo(null);
    setMsg(`Forwarded from ${m.sender}: ${body}`);
    setActionMenu(null);
    composerRef.current?.focus?.();
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
    if (/\.(dwg|dxf)$/i.test(lower)) return 'Drawing';
    return 'File';
  };

  const renderAttachmentPreview = (m, isMine) => {
    if (!m.fileUrl) return null;
    const fileName = m.fileName || 'Attachment';
    const fileType = m.fileType || '';
    const lower = String(fileName).toLowerCase();
    const isImage = String(fileType).startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(lower);
    const isVideo = String(fileType).startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/i.test(lower);
    const isAudio = String(fileType).startsWith('audio/') || /\.(webm|mp3|wav|m4a|ogg)$/i.test(lower);
    return (
      <div className={`mt-3 rounded-2xl border overflow-hidden ${isMine ? 'border-indigo-300 bg-indigo-500/20' : 'border-slate-100 bg-slate-50'}`}>
        {isImage && <img src={m.fileUrl} alt={fileName} className="block max-h-56 w-full object-cover" />}
        {isVideo && <video src={m.fileUrl} controls className="block max-h-56 w-full bg-black" />}
        {isAudio && <div className="p-3"><audio src={m.fileUrl} controls className="w-full" /></div>}
        <div className="p-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            <FileIcon className={`w-4 h-4 shrink-0 ${isMine ? 'text-white' : 'text-indigo-500'}`} />
            <div className="min-w-0">
              <p className={`text-xs font-black truncate ${isMine ? 'text-white' : 'text-slate-700'}`}>{fileName}</p>
              <p className={`text-[10px] font-bold ${isMine ? 'text-indigo-100' : 'text-slate-400'}`}>{getAttachmentLabel(fileName, fileType)} {getReadableFileSize(m.fileSize) ? `• ${getReadableFileSize(m.fileSize)}` : ''}</p>
            </div>
          </div>
          <a href={m.fileUrl} download={fileName} target="_blank" rel="noreferrer" className={`px-3 py-1.5 rounded-lg text-[11px] font-black shrink-0 ${isMine ? 'bg-white text-indigo-700' : 'bg-white text-indigo-700 border border-indigo-100'}`}>Open</a>
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
                            {m.replyTo && <div className={`mb-2 border-l-4 pl-2 py-1 rounded ${isMine ? 'border-white/70 bg-indigo-500/30' : 'border-indigo-300 bg-indigo-50'}`}><p className={`text-[10px] font-black ${isMine ? 'text-indigo-100' : 'text-indigo-600'}`}>Replying to {m.replyTo.sender}</p><p className={`text-xs truncate ${isMine ? 'text-white/90' : 'text-slate-500'}`}>{m.replyTo.text}</p></div>}
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
                  <textarea ref={composerRef} rows={2} value={msg} onChange={handleInputChange} onKeyDown={handleMessageKeyDown} placeholder={editingMessage ? 'Edit your message...' : activeChannel === 'global' ? 'Message team or @mention...' : `Message ${activeChannel}...`} className="kalpa-chat-textarea w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-base font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all resize-none" style={{ minHeight: 58, maxHeight: 132, overflowY: 'auto' }} />
                  <div className="kalpa-chat-actions-row flex items-center gap-2">
                    <label title="Attach file" className="kalpa-chat-tool-btn p-2.5 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-xl transition-colors cursor-pointer"><Paperclip className="w-5 h-5" /><input type="file" className="hidden" accept="image/*,video/*,.pdf,.dwg,.dxf,.xls,.xlsx,.csv,.doc,.docx" onChange={handleChatFileUpload} /></label>
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

      {actionMenu && activeActionMessage && (
        <div className="fixed z-[99999] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden w-56" style={{ left: actionMenu.x, top: actionMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => replyToMessage(activeActionMessage)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">↩ Reply</button>
          <button type="button" onClick={() => togglePinMessage(activeActionMessage)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">{isPinnedMessage(activeActionMessage) ? '★ Unpin' : '☆ Pin'}</button>
          <button type="button" onClick={(e) => openReactionMenu(e, activeActionMessage)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">😊 React</button>
          <button type="button" onClick={() => forwardMessage(activeActionMessage)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">↗ Forward</button>
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

      <button type="button" onClick={() => { const nextOpen = !isOpen; setIsOpen(nextOpen); if (nextOpen) markCurrentChannelReadNow(activeChannel); }} className="bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-2xl shadow-xl shadow-slate-300 transition-all hover:scale-105 relative">
        <MessageSquare className="w-7 h-7" />
        {totalUnreadCount > 0 && !isOpen && <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[11px] font-black px-2.5 py-1 rounded-full border-2 border-white shadow-sm animate-pulse">{totalUnreadCount}</span>}
      </button>
    </div>
  );
};


const ActiveToasts = ({ notifications = [], currentUser }) => {
  if (!currentUser) return null;
  const visible = (notifications || [])
    .filter(n => ((!n.targetUser && n.targetRole === currentUser.role) || n.targetUser === currentUser.name))
    .filter(n => !(n.readBy || []).includes(currentUser.name))
    .slice(0, 2);

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

function AppShell() {
  const [currentUser, setCurrentUser] = useState(null);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isDbReady, setIsDbReady] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [dbError, setDbError] = useState(null);
  
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [backendStateReady, setBackendStateReady] = useState(false);
  
  const [selectedProject, setSelectedProject] = useState(null);
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
  const [newTaskCategory, setNewTaskCategory] = useState(TASK_CATEGORIES[0]);
  
  const [leadFiles, setLeadFiles] = useState([]);
  const [isSubmittingLead, setIsSubmittingLead] = useState(false);
  
  const [showLocalBanner, setShowLocalBanner] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  
  const activeUsers = normalizeTeamUsers(users && users.length > 0 ? users : INITIAL_USERS);

  // Central production persistence: hydrate and save operational state through backend.
  // When DATABASE_URL is configured in backend/.env, this is persisted in PostgreSQL.
  useEffect(() => {
    if (!USE_BACKEND_STATE) return;
    let cancelled = false;
    const hydrate = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/state`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Backend state failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.users) && data.users.length) setUsers(normalizeTeamUsers(data.users));
        if (Array.isArray(data.deletedProjectIds)) rememberDeletedProjects(data.deletedProjectIds);
        if (Array.isArray(data.projects)) {
          const incoming = filterDeletedProjects(sanitizeProjectsForCache(data.projects));
          setProjects(prev => filterDeletedProjects(mergeProjectsByFreshness(incoming, prev)));
          try { localStorage.setItem('kalpa_projects_backup', JSON.stringify(incoming)); localStorage.setItem('kalpa_projects', JSON.stringify(incoming)); } catch(e) {}
        }
        if (Array.isArray(data.chatMessages)) setChatMessages(sanitizeChatsForCache(data.chatMessages));
        if (Array.isArray(data.notifications)) setNotifications(data.notifications);
        if (Array.isArray(data.attendanceLogs)) setAttendanceLogs(data.attendanceLogs);
        setBackendStateReady(true);
        setIsDbReady(true);
        setDbError(null);
      } catch (err) {
        console.warn('Backend/PostgreSQL state unavailable, using local cache fallback:', err.message);
        setBackendStateReady(true);
      }
    };
    hydrate();
    return () => { cancelled = true; };
  }, []);

  // Production presence poll: all roles use the same backend truth for users,
  // so Admin/Manager/Designer screens do not disagree about online/offline state.
  useEffect(() => {
    if (!USE_BACKEND_STATE || !backendStateReady) return;
    let cancelled = false;
    const refreshPresence = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/state`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !Array.isArray(data.users)) return;
        setUsers(prev => normalizeTeamUsers([...(prev || []), ...data.users]));
        if (Array.isArray(data.deletedProjectIds)) rememberDeletedProjects(data.deletedProjectIds);
        if (Array.isArray(data.projects)) {
          const incomingProjects = filterDeletedProjects(sanitizeProjectsForCache(data.projects));
          setProjects(prev => filterDeletedProjects(mergeProjectsByFreshness(incomingProjects, prev)));
          try { localStorage.setItem('kalpa_projects_backup', JSON.stringify(incomingProjects)); localStorage.setItem('kalpa_projects', JSON.stringify(incomingProjects)); } catch(e) {}
        }
        if (Array.isArray(data.attendanceLogs)) setAttendanceLogs(data.attendanceLogs);
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
  }, [backendStateReady]);

  useEffect(() => {
    if (!USE_BACKEND_STATE || !backendStateReady || !isDbReady) return;
    const timer = setTimeout(() => {
      const payload = {
        users: normalizeTeamUsers(users && users.length ? users : INITIAL_USERS),
        projects: sanitizeProjectsForCache(filterDeletedProjects(projects || [])),
        deletedProjectIds: getDeletedProjectIds(),
        chatMessages: sanitizeChatsForCache(chatMessages || []),
        notifications: notifications || [],
        attendanceLogs: attendanceLogs || []
      };
      fetch(`${API_BASE}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => console.warn('Backend/PostgreSQL state save failed:', err.message));
    }, 900);
    return () => clearTimeout(timer);
  }, [backendStateReady, isDbReady, users, projects, chatMessages, notifications, attendanceLogs]);

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

      setProjects(prev => {
        const merged = mergeProjectsByFreshness(prev, compactIncoming);
        const mergedFingerprint = makeFingerprint(merged);
        const prevFingerprint = makeFingerprint(prev);
        if (mergedFingerprint === prevFingerprint) return prev;
        setSelectedProject(sel => sel ? (merged.find(p => String(p.id) === String(sel.id)) || sel) : sel);
        return merged;
      });
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
  }, []);

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
    if (isLocalMock) {
      setFirebaseUser({ uid: 'local-dev-user' });
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
    if (!firebaseUser || !isAuthReady) return;

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
      setProjects(filterDeletedProjects(mergeProjectsByFreshness(sanitizeProjectsForCache(localProjects), sanitizeProjectsForCache(backupProjects))));
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
              const merged = filterDeletedProjects(mergeProjectsByFreshness(prev, cloudProjects));
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
    if (!firebaseUser || !isAuthReady || isLocalMock) return;
    const refreshProjects = async () => {
      try {
        const snap = await getDocs(collection(db, 'artifacts', safeAppId, 'public', 'data', 'projects'));
        const cloudProjects = filterDeletedProjects(sanitizeProjectsForCache(snap.docs.map(d => d.data())));
        if (cloudProjects.length) {
          setProjects(prev => {
            const merged = filterDeletedProjects(mergeProjectsByFreshness(prev, cloudProjects));
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
    if (!currentUser || !isDbReady) return;
    
    const today = new Date().toLocaleDateString('en-CA');
    const logId = `${currentUser.id}_${today}`;
    
    const track = async () => {
        let currentLog = attendanceLogs.find(l => l.id === logId);
        const now = Date.now();
        const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        if (!currentLog) {
            currentLog = {
                id: logId,
                userId: currentUser.id,
                name: currentUser.name,
                role: currentUser.role,
                date: today,
                loginTime: timeStr,
                logoutTime: timeStr,
                activeMinutes: 0,
                totalBreakMinutes: 0,
                currentBreakStartedAt: currentUser.availability === 'Break' ? (currentUser.breakStartedAt || now) : null,
                breakEvents: currentUser.availability === 'Break' ? [{ start: currentUser.breakStartedAt || now, startTime: timeStr }] : [],
                isOnline: true,
                status: currentUser.availability === 'Break' ? 'On Break' : 'Online',
                lastTick: now
            };
            if (isLocalMock) {
                setAttendanceLogs(prev => {
                   const next = [...prev, currentLog];
                   localStorage.setItem('kalpa_attendance', JSON.stringify(next));
                   return next;
                });
            } else if (firebaseUser) {
                try { await setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'attendanceLogs', logId), currentLog); } catch(e){}
            }
        }
    };
    track();

    const interval = setInterval(() => {
        setAttendanceLogs(prev => {
            const currentLog = prev.find(l => l.id === logId);
            if (!currentLog) return prev;
            
            const now = Date.now();
            const elapsedMins = (now - currentLog.lastTick) / (1000 * 60);
            const safeElapsed = elapsedMins < 5 ? elapsedMins : 0;
            const isOnBreak = currentUser.availability === 'Break';
            const breakStart = isOnBreak ? (currentLog.currentBreakStartedAt || currentUser.breakStartedAt || now) : null;
            const existingEvents = Array.isArray(currentLog.breakEvents) ? currentLog.breakEvents : [];
            const hasOpenBreak = existingEvents.some(ev => ev.start && !ev.end);
            const breakEvents = isOnBreak && !hasOpenBreak
                ? [...existingEvents, { start: breakStart, startTime: new Date(breakStart).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]
                : existingEvents;
            
            const updated = {
                ...currentLog,
                logoutTime: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                activeMinutes: currentLog.activeMinutes + (!isOnBreak ? safeElapsed : 0),
                totalBreakMinutes: (Number(currentLog.totalBreakMinutes) || 0) + (isOnBreak ? safeElapsed : 0),
                currentBreakStartedAt: breakStart,
                breakEvents,
                isOnline: true,
                status: isOnBreak ? 'On Break' : 'Online',
                lastTick: now
            };

            if (isLocalMock) {
                const next = prev.map(l => l.id === logId ? updated : l);
                localStorage.setItem('kalpa_attendance', JSON.stringify(next));
                return next;
            } else {
                if (firebaseUser) setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'attendanceLogs', logId), updated).catch(e=>{});
                return prev; 
            }
        });
    }, 60000); 

    const userHeartbeat = setInterval(() => {
      const beatNow = Date.now();
      const refreshed = { ...currentUser, isOnline: true, lastSeenAt: beatNow, lastHeartbeatAt: beatNow };
      setCurrentUser(refreshed);
      handleUpdateUser(refreshed);
    }, 30000);

    return () => { clearInterval(interval); clearInterval(userHeartbeat); };
  }, [currentUser, isDbReady, firebaseUser]);


  const saveLocal = (key, data) => {
      if (!isLocalMock) return;
      const safeData = key === 'kalpa_projects' || key === 'kalpa_projects_backup' ? sanitizeProjectsForCache(data) : key === 'kalpa_chats' ? sanitizeChatsForCache(data) : data;
      localStorage.setItem(key, JSON.stringify(safeData));
  };

  const addNotification = async (targetRole, targetUser, title, type = 'info') => {
    if (!firebaseUser) return;
    const newNotif = { id: Date.now(), targetRole, targetUser, title, type, readBy: [], time: new Date().toLocaleTimeString() };
    setNotifications(prev => {
      const next = [newNotif, ...prev].sort((a,b) => (b.id || 0) - (a.id || 0));
      if (isLocalMock) localStorage.setItem('kalpa_notifs', JSON.stringify(next));
      return next;
    });
    try { await setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'notifications', newNotif.id.toString()), newNotif); } catch(e){}
  };

  const handleUpdateProject = async (updatedProject, oldProject) => {
    updatedProject = normalizeProjectRecord({ ...updatedProject, updatedAt: Date.now(), syncVersion: Date.now() });
    if (isAssignedValue(updatedProject.assignedTo)) recordAssignmentLedger(updatedProject);
    oldProject = oldProject ? normalizeProjectRecord(oldProject) : oldProject;
    // Update the screen immediately. Previously the app waited for Firestore;
    // if a completed file was large or Firebase rejected it, the upload looked like nothing happened.
    setSelectedProject(updatedProject);
    setProjects(prev => {
      const next = mergeProjectsByFreshness(prev.filter(p => String(p.id) !== String(updatedProject.id)), [updatedProject]);
      persistAndBroadcastProjects(next);
      return next;
    });
    
    if (firebaseUser && !isLocalMock) {
        try {
          await setDoc(
            doc(db, 'artifacts', safeAppId, 'public', 'data', 'projects', updatedProject.id.toString()),
            stripLargeLocalFilesForCloud(updatedProject)
          );
        } catch(e){
          console.warn('Project cloud save failed, but local screen has been updated.', e);
        }
    }

    if (oldProject && updatedProject.status !== oldProject.status) {
      if (updatedProject.status === 'Completed') addNotification(ROLES.MANAGER, null, `Task ${updatedProject.id} completed and ready`, 'success');
      if (updatedProject.status === 'Completed') addNotification(ROLES.DESIGNER, updatedProject.assignedTo, `Task ${updatedProject.id} marked as Completed`, 'success');
    }
    if (oldProject && updatedProject.priority === 'Urgent' && oldProject.priority !== 'Urgent') {
      addNotification(ROLES.DESIGNER, updatedProject.assignedTo, `URGENT REVISION: Task ${updatedProject.id}`, 'urgent');
    }
    if (oldProject && updatedProject.assignedTo !== oldProject.assignedTo && updatedProject.assignedTo !== 'Unassigned') {
      const targetRole = activeUsers.find(u => u.name === updatedProject.assignedTo)?.role || ROLES.DESIGNER;
      addNotification(targetRole, updatedProject.assignedTo, `Task Re-assigned to you: ${updatedProject.id}`, 'info');
    }
  };
  
  const handleDeleteTask = async (taskId) => {
     const id = String(taskId);
     setSelectedProject(null);
     rememberDeletedProjects(id);
     setProjects(prev => {
       const next = filterDeletedProjects((prev || []).filter(p => String(p.id) !== id && String(p.caseId || '') !== id));
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
         const res = await fetch(`${API_BASE}/api/state/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
         const data = await res.json().catch(() => ({}));
         if (Array.isArray(data.deletedProjectIds)) rememberDeletedProjects(data.deletedProjectIds);
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
    if (normalizedMsg.text.includes('@all')) {
        addNotification(ROLES.ADMIN, null, `@all mention from ${normalizedMsg.sender}`, 'mention');
        addNotification(ROLES.MANAGER, null, `@all mention from ${normalizedMsg.sender}`, 'mention');
        addNotification(ROLES.DESIGNER, null, `@all mention from ${normalizedMsg.sender}`, 'mention');
    }
    (activeUsers || []).forEach(u => {
      if (u.name !== normalizedMsg.sender && normalizedMsg.text?.toLowerCase().includes(`@${u.name}`.toLowerCase())) {
        addNotification(u.role, u.name, `You were mentioned by ${normalizedMsg.sender}`, 'mention');
      }
    });
  };

  const handleMarkMessagesRead = async (activeChannel) => {
    if (!currentUser) return;
    const nowText = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const updates = [];
    setChatMessages(prev => {
      const next = prev.map(m => {
        const markAll = activeChannel === '__all__';
        const isGlobal = activeChannel === 'global' && (m.recipient === 'global' || !m.recipient);
        const isDM = activeChannel !== 'global' && activeChannel !== '__all__' && samePerson(m.sender, activeChannel) && samePerson(m.recipient, currentUser.name);
        const isIncomingToMe = !samePerson(m.sender, currentUser.name) && (markAll || isGlobal || isDM || samePerson(m.recipient, currentUser.name) || m.recipient === 'global' || !m.recipient);
        if (!isIncomingToMe) return m;
        const alreadyRead = hasReadBy(m, currentUser.name);
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
        const belongsToMe = (!n.targetUser && n.targetRole === currentUser.role) || n.targetUser === currentUser.name;
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

  const markNotifsAsRead = async () => {
    if (!currentUser || !firebaseUser) return;
    myNotifs.forEach(n => {
      if (!n.readBy?.includes(currentUser.name)) {
        const updated = { ...n, readBy: [...(n.readBy||[]), currentUser.name] };
        setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'notifications', n.id.toString()), updated).catch(e=>{});
      }
    });
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
    handleUpdateUser(onlineUser);
  };

  const handleLogout = () => {
    if (currentUser) {
      updateTodayAttendance((log, now, timeStr) => {
        const events = Array.isArray(log.breakEvents) ? log.breakEvents : [];
        const updatedEvents = events.map(ev => ev.start && !ev.end ? { ...ev, end: now, endTime: timeStr, minutes: Math.floor(Math.max(0, now - Number(ev.start)) / 60000) } : ev);
        return {
          ...log,
          logoutTime: timeStr,
          isOnline: false,
          status: 'Logged Out',
          currentBreakStartedAt: null,
          breakEvents: updatedEvents,
          lastTick: now
        };
      });
      const logoutNow = Date.now();
      handleUpdateUser({ ...currentUser, isOnline: false, availability: 'Unavailable', lastLogoutAt: logoutNow, lastSeenAt: logoutNow, lastHeartbeatAt: logoutNow, availabilityUpdatedAt: logoutNow, breakStartedAt: null });
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
        return {
          ...log,
          isOnline: true,
          status: 'On Break',
          currentBreakStartedAt: now,
          breakEvents: [...events, { start: now, startTime: timeStr }],
          lastTick: ts
        };
      }
      const openStart = log.currentBreakStartedAt || currentUser.breakStartedAt || now;
      const duration = Math.floor(Math.max(0, ts - Number(openStart)) / 60000);
      const updatedEvents = events.map(ev => ev.start && !ev.end ? { ...ev, end: ts, endTime: timeStr, minutes: Math.floor(Math.max(0, ts - Number(ev.start)) / 60000) } : ev);
      return {
        ...log,
        isOnline: true,
        status: 'Online',
        currentBreakStartedAt: null,
        totalBreakMinutes: (Number(log.totalBreakMinutes) || 0) + Math.max(0, Math.min(5, (ts - (Number(log.lastTick) || ts)) / 60000)),
        breakEvents: updatedEvents,
        lastTick: ts
      };
    });
    setCurrentUser(updated);
    handleUpdateUser(updated);
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

  if (!firebaseUser || !isDbReady) {
    return <PageLoadingScreen />;
  }

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} users={activeUsers} onRecoverPassword={handleUpdateUser} />;
  }

  const canManage = currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.MANAGER;
  if (currentUser.role === ROLES.DESIGNER && activeTab === 'board') setTimeout(() => setActiveTab('command'), 0);
  const myNotifs = notifications.filter(n => (!n.targetUser && n.targetRole === currentUser.role) || n.targetUser === currentUser.name).sort((a,b) => (b.id || 0) - (a.id || 0));
  const unreadNotifs = myNotifs.filter(n => !(n.readBy||[]).includes(currentUser.name)).length;

  const displayedProjects = projects
    .filter(p => {
      if (activeTab === 'my_tasks') {
        if (normalizePersonName(p.assignedTo) !== normalizePersonName(currentUser.name)) return false;
        // Carry-forward fix: every assigned pending task remains in My Tasks until completed,
        // even if it was created on a previous date. Completed tasks still follow the selected date.
        if (p.status !== 'Completed') return true;
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
    <div className="min-h-screen bg-slate-50/50 font-sans text-slate-900 pb-20 antialiased">
      <ActiveToasts notifications={notifications} currentUser={currentUser} />
      
      {showLocalBanner && (
          <div className="bg-amber-100 border-b border-amber-200 text-amber-800 p-2.5 text-center text-xs font-bold flex justify-center items-center shadow-sm z-50 relative">
              <span>⚠️ Local Mode: Data is saved locally. Cloud features disconnected.</span>
              <button type="button" onClick={() => setShowLocalBanner(false)} className="ml-4 p-1 hover:bg-amber-200 rounded-md"><X className="w-4 h-4" /></button>
          </div>
      )}

      {dbError === 'permission-denied' && (
         <div className="bg-red-600 border-b-4 border-red-800 text-white p-4 text-center text-sm shadow-xl z-50 relative">
            <p className="font-black text-lg mb-1">⚠️ FIREBASE DATABASE IS LOCKED ⚠️</p>
            <p className="font-medium max-w-4xl mx-auto">
              Your database is currently rejecting read/write access. To fix this:<br/>
              1. Go to Firebase Console &rarr; <b>Firestore Database</b> &rarr; <b>Rules</b> tab.<br/>
              2. Change <code className="bg-red-800/50 px-2 py-0.5 rounded mx-1">allow read, write: if false;</code> to <code className="bg-emerald-500 px-2 py-0.5 rounded font-mono mx-1 shadow-sm">allow read, write: if true;</code><br/>
              3. Click "Publish", wait 30 seconds, and refresh this page.
            </p>
        </div>
      )}

      <nav className="bg-white border-b-2 border-slate-100 sticky top-0 z-40 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8 flex justify-between h-[72px]">
          <div className="flex items-center">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 w-10 h-10 rounded-xl flex items-center justify-center mr-4 shadow-md">
              <LayoutDashboard className="text-white w-5 h-5" />
            </div>
            <span className="font-extrabold text-lg sm:text-2xl text-slate-800 tracking-tight truncate">Kalpvriksha Designs <span className="text-indigo-600">Ops</span></span>
          </div>
          <div className="hidden lg:flex flex-1 max-w-xl mx-8">
            <div className="relative w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search cases, customer, bank, branch, location, designer..." className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl pl-12 pr-10 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-indigo-400 transition-all" />
              {globalSearch && <button type="button" onClick={() => setGlobalSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>}
            </div>
          </div>
          <div className="flex items-center space-x-6">
            
            <div className="relative">
              <button type="button" onClick={() => { setShowNotifs(!showNotifs); if(!showNotifs) markNotifsAsRead(); }} className="p-2.5 relative text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors">
                <Bell className="w-6 h-6" />
                {unreadNotifs > 0 && <span className="absolute top-2 right-2 w-3 h-3 bg-red-500 rounded-full border-2 border-white shadow-sm animate-pulse"></span>}
              </button>
              
              {showNotifs && (
                <div className="absolute right-0 mt-3 w-80 bg-white rounded-3xl shadow-2xl border-2 border-slate-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-4">
                  <div className="p-4 bg-slate-50 border-b border-slate-100">
                    <div className="font-extrabold text-sm text-slate-800 uppercase tracking-widest flex justify-between items-center">
                      Notification Centre
                      {unreadNotifs === 0 && <Check className="w-4 h-4 text-emerald-500" />}
                    </div>
                    <div className="flex gap-2 mt-3 text-[10px] font-black uppercase tracking-widest">
                      <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700">Tasks</span>
                      <span className="px-2 py-1 rounded-lg bg-red-50 text-red-700">Urgent</span>
                      <span className="px-2 py-1 rounded-lg bg-purple-50 text-purple-700">Mentions</span>
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {myNotifs.length === 0 && <p className="text-xs text-slate-400 font-bold text-center py-6">All caught up!</p>}
                    {myNotifs.map(n => (
                      <div key={n.id} className={`p-3.5 rounded-2xl flex items-start transition-colors ${!(n.readBy||[]).includes(currentUser.name) ? 'bg-indigo-50/50 border border-indigo-100' : 'bg-white hover:bg-slate-50 border border-transparent'}`}>
                        {n.type === 'success' && <CheckCircle className="w-5 h-5 text-emerald-500 mr-3 mt-0.5 shrink-0"/>}
                        {n.type === 'mention' && <div className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs mr-3 mt-0.5 shrink-0">@</div>}
                        {n.type === 'urgent' && <Flag className="w-5 h-5 text-red-500 mr-3 mt-0.5 shrink-0"/>}
                        {n.type === 'info' && <Briefcase className="w-5 h-5 text-blue-500 mr-3 mt-0.5 shrink-0"/>}
                        <div>
                          <p className={`text-sm text-slate-800 ${!(n.readBy||[]).includes(currentUser.name) ? 'font-extrabold' : 'font-semibold'}`}>{n.title}</p>
                          <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">{n.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {currentUser.role !== ROLES.ADMIN && (
              <button type="button" onClick={toggleBreak} className={`px-3 py-2 rounded-xl text-xs font-black border transition-colors ${currentUser.availability === 'Break' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                {currentUser.availability === 'Break' ? 'On Break' : 'Take Break'}
              </button>
            )}
            <button type="button" onClick={() => setShowProfilePanel(true)} className="hidden sm:flex items-center gap-3 border-l-2 border-slate-100 pl-6 hover:bg-slate-50 rounded-xl pr-3 py-1 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                {currentUser.profilePhoto ? <img src={currentUser.profilePhoto} alt={currentUser.name} className="w-full h-full object-cover" /> : <User className="w-5 h-5 text-slate-400" />}
              </div>
              <div className="text-right">
                <p className="text-sm font-extrabold text-slate-800">{currentUser.name}</p>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{currentUser.role} • {currentUser.emailRegistered ? 'Email Registered' : (currentUser.mobileRegistered ? 'Mobile Registered' : 'Recovery Unregistered')}</p>
              </div>
            </button>
            <button type="button" onClick={handleLogout} className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors" title="Log out">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {showProfilePanel && (
        <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="max-w-5xl mx-auto my-6">
            <div className="flex justify-end mb-3">
              <button type="button" onClick={() => setShowProfilePanel(false)} className="bg-white text-slate-700 px-4 py-2 rounded-xl font-black shadow-lg border border-slate-100 hover:bg-slate-50 flex items-center"><X className="w-4 h-4 mr-2" /> Close Profile</button>
            </div>
            <ProfileView currentUser={currentUser} onUpdateUser={handleUpdateUser} setCurrentUser={setCurrentUser} />
          </div>
        </div>
      )}

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="lg:hidden mb-5">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search cases..." className="w-full bg-white border-2 border-slate-100 rounded-2xl pl-12 pr-10 py-3 text-sm font-bold outline-none focus:border-indigo-400" />
            {globalSearch && <button type="button" onClick={() => setGlobalSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>}
          </div>
        </div>
        
        {globalSearch.trim() && !selectedProject && (
          <div className="bg-white border-2 border-indigo-100 rounded-3xl p-5 mb-6 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <div><h2 className="font-black text-slate-800">Search Results</h2><p className="text-xs font-bold text-slate-400">Showing matching cases for: {globalSearch}</p></div>
              <button type="button" onClick={() => setGlobalSearch('')} className="text-xs font-black bg-slate-100 text-slate-600 px-3 py-2 rounded-xl">Clear</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {displayedProjects.slice(0, 12).map(p => (
                <button key={p.id} type="button" onClick={() => setSelectedProject(p)} className="text-left bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-100 rounded-2xl p-4 transition-all">
                  <p className="font-black text-slate-800">{p.id}</p>
                  <p className="text-xs font-bold text-slate-500 mt-1">{getCustomerDisplayName(p)} • {p.location}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">{p.type} • {p.assignedTo || 'Unassigned'} • {p.status}</p>
                </button>
              ))}
              {displayedProjects.length === 0 && <div className="col-span-full"><EmptyState icon={Search} title="No matching cases found" description="Try a customer name, bank, branch, location, task ID, or designer name." compact /></div>}
            </div>
          </div>
        )}

        {!selectedProject && (
          <div className="flex flex-wrap gap-2 mb-8 bg-white p-1.5 rounded-2xl shadow-sm border-2 border-slate-100 w-fit">
            <button type="button" onClick={() => setActiveTab('command')} className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all ${activeTab === 'command' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>Command Centre</button>
            {currentUser.role === ROLES.DESIGNER && (
              <button type="button" onClick={() => setActiveTab('my_tasks')} className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all flex items-center ${activeTab === 'my_tasks' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}><User className="w-4 h-4 mr-1.5" /> My Tasks</button>
            )}
            {currentUser.role !== ROLES.DESIGNER && <button type="button" onClick={() => setActiveTab('board')} className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all ${activeTab === 'board' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>Operations</button>}
            {currentUser.role === ROLES.MANAGER && (
              <button type="button" onClick={() => setActiveTab('my_tasks')} className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all flex items-center ${activeTab === 'my_tasks' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}><User className="w-4 h-4 mr-1.5" /> My Tasks</button>
            )}
            <button type="button" onClick={() => setActiveTab('productivity')} className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all ${activeTab === 'productivity' ? 'bg-emerald-100 text-emerald-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Performance</button>
            {currentUser.role === ROLES.ADMIN && <button type="button" onClick={() => setActiveTab('closing')} className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all ${activeTab === 'closing' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>Daily Closing</button>}
            {currentUser.role === ROLES.ADMIN && (
              <button type="button" onClick={() => setActiveTab('ledger')} className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all ${activeTab === 'ledger' ? 'bg-amber-100 text-amber-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Finance</button>
            )}
            <button type="button" onClick={() => setActiveTab('team')} className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all ${activeTab === 'team' ? 'bg-emerald-100 text-emerald-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Team</button>
            <button type="button" onClick={() => setActiveTab('attendance')} className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all ${activeTab === 'attendance' ? 'bg-indigo-100 text-indigo-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Attendance</button>
            <button type="button" onClick={() => setActiveTab('calculator')} className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all ${activeTab === 'calculator' ? 'bg-blue-100 text-blue-800 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>Tools</button>
            <button type="button" onClick={() => setActiveTab('archive')} className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all ${activeTab === 'archive' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>Archive</button>
            <button type="button" onClick={() => setActiveTab('meeting')} className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all flex items-center ${activeTab === 'meeting' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}><Video className="w-4 h-4 mr-1.5" /> Team Meeting</button>
          </div>
        )}

        {selectedProject ? (
          <TaskDetailView project={selectedProject} user={currentUser} onBack={() => setSelectedProject(null)} onUpdateProject={handleUpdateProject} users={activeUsers} onDeleteTask={handleDeleteTask} />
        ) : activeTab === 'command' ? (
          <CommandCentreView projects={projects} users={activeUsers} currentUser={currentUser} onSelectProject={(p) => { setActiveTab('board'); setSelectedProject(p); }} />
        ) : activeTab === 'productivity' ? (
          <ProductivityDashboard users={activeUsers} projects={projects} />
        ) : activeTab === 'closing' && currentUser.role === ROLES.ADMIN ? (
          <DailyClosingReport projects={projects} />
        ) : activeTab === 'ledger' && currentUser.role === ROLES.ADMIN ? (
          <LedgerView projects={projects} onSelectProject={(p) => { setActiveTab('board'); setSelectedProject(p); }} />
        ) : activeTab === 'archive' ? (
          <HistoryArchiveView projects={projects} onSelectProject={(p) => { setActiveTab('board'); setSelectedProject(p); }} />
        ) : activeTab === 'team' ? (
          <TeamPerformanceView users={activeUsers} projects={projects} onUpdateUser={handleUpdateUser} currentUser={currentUser} />
        ) : activeTab === 'attendance' ? (
          <AttendanceView attendanceLogs={attendanceLogs} users={activeUsers} />
        ) : activeTab === 'profile' ? (
          <ProfileView currentUser={currentUser} onUpdateUser={handleUpdateUser} setCurrentUser={setCurrentUser} />
        ) : activeTab === 'calculator' ? (
          <CalculatorView />
        ) : activeTab === 'meeting' ? (
          <TeamMeetingRoom currentUser={currentUser} />
        ) : (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
              <div>
                <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">{activeTab === 'my_tasks' ? 'My Tasks' : (canManage ? 'Active Operations' : 'My Workspace')}</h1>
              </div>
              <div className="flex flex-wrap gap-3">
                {(activeTab === 'board' || activeTab === 'my_tasks') && (
                   <div className="bg-white border-2 border-slate-100 rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-sm">
                      <Calendar className="w-4 h-4 text-indigo-500" />
                      <input type="date" value={selectedBoardDate} onChange={(e) => setSelectedBoardDate(e.target.value)} className="text-xs font-bold text-slate-700 bg-transparent outline-none" />
                   </div>
                )}
                {(activeTab === 'board' || activeTab === 'my_tasks') && (
                   <div className="bg-slate-100 p-1 rounded-xl flex items-center shadow-inner">
                      <button onClick={() => setBoardViewMode('list')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center ${boardViewMode === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><List className="w-4 h-4 mr-1.5" /> List</button>
                      <button onClick={() => setBoardViewMode('kanban')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center ${boardViewMode === 'kanban' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><KanbanSquare className="w-4 h-4 mr-1.5" /> Board</button>
                   </div>
                )}
                {canManage && (
                  <button type="button" onClick={() => { setLeadFiles([]); setShowNewLead(true); }} className="bg-slate-800 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-700 transition-all shadow-xl shadow-slate-200 flex items-center w-full sm:w-auto justify-center hover:scale-105 transform">
                    <Plus className="w-5 h-5 mr-2" /> Log New Case
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              <div className="lg:col-span-3 w-full">
                
                {boardViewMode === 'kanban' ? (
                   <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      {['Lead Received', 'Drafting', 'Completed'].map(statusCol => (
                         <div key={statusCol} className="bg-slate-100/50 rounded-3xl p-4 border-2 border-slate-100/50 min-h-[500px]">
                            <h3 className="font-black text-slate-500 uppercase tracking-widest text-xs mb-4 px-2">{statusCol} <span className="ml-2 bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{displayedProjects.filter(p => p.status === statusCol).length}</span></h3>
                            <div className="space-y-4">
                               {displayedProjects.filter(p => p.status === statusCol).map(p => (
                                  <div key={p.id} onClick={() => setSelectedProject(p)} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-300 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group">
                                     <div className="flex justify-between items-start mb-2">
                                        <p className="font-extrabold text-slate-800 group-hover:text-indigo-600 transition-colors">{p.id}</p>
                                        {p.priority === 'Urgent' && <Flag className="w-4 h-4 text-red-500 animate-pulse"/>}
                                     </div>
                                     <p className="text-sm font-bold text-slate-700 mb-1">{getCustomerDisplayName(p)}</p>
                                     <p className="text-xs text-slate-500 mb-3">{p.type} • {p.location}</p>{getLatestCompletedFileName(p) && <p className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 mb-3 truncate">Completed: {getLatestCompletedFileName(p)}</p>}
                                     <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                                        <Badge colorClass={p.assignedTo === 'Unassigned' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-700 border-slate-200'}>{p.assignedTo}</Badge>
                                        {p.subTasks?.length > 0 && <span className="text-[10px] text-red-600 bg-red-50 px-2 py-0.5 rounded font-black">{p.subTasks.length} Revs</span>}
                                     </div>
                                  </div>
                               ))}
                            </div>
                         </div>
                      ))}
                   </div>
                ) : (
                  <div className="bg-white rounded-3xl shadow-sm border-2 border-slate-100 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
                          <tr>
                            <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Task ID</th>
                            <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Type & Location</th>
                            <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Assigned To</th>
                            <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Elapsed</th>
                            <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {displayedProjects.map(p => (
                            <tr key={p.id} onClick={() => setSelectedProject(p)} className="hover:bg-slate-50 cursor-pointer transition-colors group">
                              <td className="px-6 py-5">
                                <div className="flex items-center gap-2">
                                  <p className="font-extrabold text-slate-800 text-base">{p.id}</p>
                                  {p.priority === 'Urgent' && <Flag className="w-4 h-4 text-red-500 animate-pulse"/>}
                                </div>
                                <p className="text-slate-500 font-semibold text-xs mt-1">{getCustomerDisplayName(p)}</p>
                                <p className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded mt-1.5 w-fit font-bold">Created: {p.createdAt ? formatDateTime(p.createdAt) : '-'}</p>{getLatestCompletedFileName(p) && <p className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded mt-1.5 w-fit font-black">Completed: {getLatestCompletedFileName(p)}</p>}
                              </td>
                              <td className="px-6 py-5">
                                <p className="font-bold text-slate-700">{p.type}</p>
                                <p className="text-slate-400 font-medium text-xs mt-1">{p.location}</p>
                              </td>
                              <td className="px-6 py-5">
                                <Badge colorClass={p.assignedTo === 'Unassigned' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-700 border-slate-200'}>{p.assignedTo}</Badge>
                              </td>
                              <td className="px-6 py-5 font-bold text-slate-600">{p.status === 'Drafting' ? getDraftElapsed(p, nowTick) : (p.draftingStartedAt ? getDraftElapsed(p, nowTick) : '-')}</td>
                              <td className="px-6 py-5">
                                <Badge colorClass={`border-transparent ${getStatusColor(p.status)}`}>{p.status}</Badge>
                              </td>
                            </tr>
                          ))}
                          {displayedProjects.length === 0 && (
                            <tr><td colSpan={5} className="px-6 py-16 text-center text-slate-400 font-bold">No active projects found for this date.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-1 space-y-6">
                <h3 className="text-xl font-extrabold text-slate-800 flex items-center tracking-tight"><Users className="w-6 h-6 mr-3 text-indigo-500" /> Team Activity</h3>
                <div className="bg-white rounded-3xl p-6 shadow-sm border-2 border-slate-100 space-y-5">
                  {getOperationalUsers(activeUsers, { includeAdmins: false }).filter(u => u.role === ROLES.DESIGNER || u.role === ROLES.MANAGER).map(designer => {
                    const designerOnline = isUserActuallyOnline(designer, nowTick);
                    const activeTasks = designerOnline ? projects.filter(p => p.assignedTo === designer.name && p.status !== 'Completed') : [];
                    const todayStart = new Date().setHours(0,0,0,0);
                    
                    const submittedToday = projects.filter(p => {
                      if (p.assignedTo !== designer.name) return false;
                      if (p.completedAt && p.completedAt >= todayStart) return true;
                      if (p.submittedAt && p.submittedAt >= todayStart) return true;
                      return false;
                    }).length;

                    let idleStatus = designerOnline ? "Available" : `Unavailable${designer.lastSeenAt || designer.lastLogoutAt || designer.lastHeartbeatAt ? ` - Last seen ${formatLastSeenDateTime(designer.lastSeenAt || designer.lastLogoutAt || designer.lastHeartbeatAt)}` : ''}`;
                    if (designerOnline && designer.availability === 'Break') {
                      idleStatus = `On break${designer.breakStartedAt ? ` for ${formatDuration(designer.breakStartedAt, nowTick)}` : ''}`;
                    } else if (designerOnline && activeTasks.length === 0) {
                      const recentlyCompleted = projects.filter(p => p.assignedTo === designer.name && (p.completedAt || p.submittedAt)).sort((a,b) => ((b.completedAt||b.submittedAt)||0) - ((a.completedAt||a.submittedAt)||0))[0];
                      if (recentlyCompleted) {
                         const hoursIdle = Math.floor((nowTick - (recentlyCompleted.completedAt||recentlyCompleted.submittedAt)) / (1000 * 60 * 60));
                         idleStatus = hoursIdle > 0 ? `Free for ${hoursIdle}h` : "Just finished a task";
                      }
                    }

                    return (
                      <div key={designer.id} className="border-b-2 border-slate-50 pb-5 last:border-0 last:pb-0">
                        <div className="flex justify-between items-start mb-3">
                          <p className="font-extrabold text-slate-800 text-base flex items-center">
                            {!designerOnline ? (
                                <span title="Unavailable" className="w-2.5 h-2.5 rounded-full mr-3 shadow-sm bg-slate-300"></span>
                            ) : designer.availability === 'Break' ? (
                                <span title="On Break" className="w-2.5 h-2.5 rounded-full mr-3 shadow-sm bg-amber-500 animate-pulse"></span>
                            ) : activeTasks.length > 0 ? (
                                <span title="Working" className="w-2.5 h-2.5 rounded-full mr-3 shadow-sm bg-emerald-500 animate-pulse"></span>
                            ) : (
                                <span title="Available" className="w-2.5 h-2.5 rounded-full mr-3 shadow-sm bg-blue-500"></span>
                            )}
                            {designer.name}
                          </p>
                          <span className="text-[10px] bg-indigo-50 border border-indigo-100 text-indigo-700 px-2.5 py-1 rounded-lg font-black uppercase tracking-wider">{submittedToday} done today</span>
                        </div>
                        {designerOnline && designer.availability !== 'Break' && activeTasks.length > 0 ? (
                          <div className="ml-5 space-y-2">
                            {activeTasks.map(at => {
                              const pendingRevs = (at.subTasks||[]).filter(st => st.status === 'Pending').length;
                              const totalRevs = (at.subTasks||[]).length;
                              return (
                                <div key={at.id} className="text-xs font-bold bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex justify-between items-center group cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => setSelectedProject(at)}>
                                  <span className="text-slate-700 truncate mr-2">{at.id}</span>
                                  {totalRevs > 0 && <span className="text-[10px] text-red-600 font-black bg-red-50 border border-red-100 px-2 py-0.5 rounded-md whitespace-nowrap uppercase tracking-wider">{pendingRevs} pending</span>}
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 font-semibold ml-5 italic flex items-center"><Clock className="w-3 h-3 mr-1.5"/>{idleStatus}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {!showNewLead && <CommunicationHub currentUser={currentUser} users={activeUsers} chatMessages={chatMessages} onSendMessage={handleSendMessage} onDeleteMessage={handleDeleteMessage} onUpdateMessage={handleUpdateMessage} onMarkMessagesRead={handleMarkMessagesRead} />}

      {showNewLead && (
        <div className="kalpa-lead-modal fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[80] flex justify-center items-center p-4">
          <div className="kalpa-lead-modal-card bg-white rounded-[2rem] w-full max-w-3xl max-h-[90vh] overflow-y-auto p-8 shadow-2xl animate-in zoom-in-95 duration-200 custom-scrollbar">
             <div className="flex justify-between items-center mb-8 border-b-2 border-slate-100 pb-6">
                <h2 className="text-3xl font-black text-slate-800 tracking-tight">Log New Case</h2>
                <button type="button" onClick={() => setShowNewLead(false)} className="p-2.5 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors"><X className="w-6 h-6 text-slate-600"/></button>
             </div>
             
             <form onSubmit={async (e) => {
               e.preventDefault();
               if (isSubmittingLead) return;
               setIsSubmittingLead(true);
               try {
               const fd = new FormData(e.target);
               
               const client = fd.get('client');
               const bankerName = ''; // banker/loan officer removed from simplified operational form
               const customerName = fd.get('customerName');
               const location = fd.get('location');
               const taskType = newTaskCategory === 'Other' ? fd.get('otherType') : newTaskCategory;
               const taskId = generateTraceableTaskId({ location, client, bankerName, customerName, projects });
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
               const newP = {
                 id: taskId,
                 taskName: [taskType, customerName, location].filter(Boolean).join(' • '),
                 client, 
                 bankerName,
                 customerName,
                 location,
                 type: taskType,
                 description: fd.get('description') || '',
                 priority: fd.get('priority'), assignedTo, assignedBy: assignedTo !== 'Unassigned' ? currentUser.name : '', assignedAt: assignedTo !== 'Unassigned' ? Date.now() : null, assignmentVersion: assignedTo !== 'Unassigned' ? Date.now() : null,
                 dueDate: fd.get('dueDate') || null,
                 estimateDetails: fd.get('estimateDetails') || '', estimate: fd.get('estimate') || 0,
                 status: 'Lead Received', createdAt: Date.now(), updatedAt: Date.now(), syncVersion: Date.now(), createdBy: currentUser.name,
                 ownership: { createdBy: currentUser.name, assignedBy: assignedTo !== 'Unassigned' ? currentUser.name : '', assignedTo },
                 reassignmentHistory: assignedTo !== 'Unassigned' ? [{ from: 'Unassigned', to: assignedTo, by: currentUser.name, time: new Date().toLocaleString() }] : [],
                 documents: docs, timeline: [{id: Date.now(), text: 'Case Created', time: new Date().toLocaleString()}],
                 subTasks: [], notes: [], ledger: {}, reportSent: false
               };
               
               if (docs.length > 0) {
                   newP.timeline.push({ id: Date.now()+1, text: `${docs.length} Source File(s) Attached`, time: new Date().toLocaleString() });
               }

               const nextProjects = mergeProjectsByFreshness((projects || []).filter(p => String(p.id) !== String(newP.id)), [newP]);
               persistAndBroadcastProjects(nextProjects);
               setProjects(nextProjects);
               setSelectedBoardDate(formatDateKey(newP.createdAt));
               setActiveTab('board');
               try { window.localStorage.setItem('kalpa_projects', JSON.stringify(sanitizeProjectsForCache(filterDeletedProjects(nextProjects)))); } catch(e) {}
               if (USE_BACKEND_STATE && backendStateReady && isDbReady) {
                 try {
                   const saveRes = await fetch(`${API_BASE}/api/state`, {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({
                       users: normalizeTeamUsers(users && users.length ? users : INITIAL_USERS),
                       projects: sanitizeProjectsForCache(filterDeletedProjects(nextProjects)),
                       deletedProjectIds: getDeletedProjectIds(),
                       chatMessages: sanitizeChatsForCache(chatMessages || []),
                       notifications: notifications || [],
                       attendanceLogs: attendanceLogs || []
                     })
                   });
                   if (!saveRes.ok) throw new Error(`Backend save failed: ${saveRes.status}`);
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
                 alert(`Task could not be created: ${err?.message || 'Please try again.'}`);
               } finally {
                 setIsSubmittingLead(false);
               }
             }} className="space-y-6">
               
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

               <button type="submit" disabled={isSubmittingLead} className={`kalpa-create-task-button w-full py-4 text-white rounded-2xl font-black text-lg shadow-xl transition-all mt-8 ${isSubmittingLead ? 'bg-indigo-400 cursor-not-allowed' : 'bg-slate-800 hover:bg-slate-700 shadow-slate-200 hover:-translate-y-1'}`}>
                  {isSubmittingLead ? 'Uploading Files & Creating Task...' : 'Create Task'}
               </button>
             </form>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 20px; }
      `}} />
    </div>
  );
}

export default function App() {
  return <AppErrorBoundary><AppShell /></AppErrorBoundary>;
}
