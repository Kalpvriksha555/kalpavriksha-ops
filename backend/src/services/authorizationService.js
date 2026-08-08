const normalize = (value = '') => String(value || '').trim().toUpperCase();
const identity = (value = '') => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const ROLE_CAPABILITIES = Object.freeze({
  ADMIN: Object.freeze(['*']),
  MANAGER: Object.freeze([
    'state:read', 'task:read', 'task:create', 'task:update', 'task:delete', 'task:assign', 'task:review',
    'task:revision', 'task:timeline', 'file:read', 'file:upload', 'file:delete',
    'chat:read', 'chat:write', 'notification:read', 'presence:self',
    'performance:read', 'performance:rebuild', 'system:read', 'whatsapp:share'
  ]),
  DESIGNER: Object.freeze([
    'state:read', 'task:read:assigned', 'task:update:assigned', 'task:start:assigned',
    'task:timeline:assigned', 'file:read:assigned', 'file:upload:assigned', 'file:delete:own',
    'chat:read', 'chat:write', 'notification:read:self', 'presence:self',
    'performance:read', 'system:read'
  ])
});

export const normalizePermissionRole = (value = '') => {
  const role = normalize(value);
  if (role === 'ADMIN' || role === 'MANAGER' || role === 'DESIGNER') return role;
  return '';
};

export const authorizationActor = (user = {}) => {
  const safeUser = user && typeof user === 'object' ? user : {};
  return {
    id: String(safeUser.id || safeUser.userId || '').trim(),
    username: String(safeUser.username || '').trim().toLowerCase(),
    name: String(safeUser.name || safeUser.username || 'Team member').trim(),
    role: normalizePermissionRole(safeUser.role)
  };
};

export const hasCapability = (user = {}, capability = '') => {
  const role = normalizePermissionRole(user?.role);
  const permissions = ROLE_CAPABILITIES[role] || [];
  return permissions.includes('*') || permissions.includes(capability);
};

export const isCaseAssignedToUser = (caseRecord = {}, user = {}) => {
  const actor = authorizationActor(user);
  const candidateIds = [
    caseRecord?.assigneeId,
    caseRecord?.assignedUserId,
    caseRecord?.ownerId,
    caseRecord?.userId
  ].map(value => String(value || '').trim()).filter(Boolean);
  if (actor.id && candidateIds.includes(actor.id)) return true;

  const candidateNames = [
    caseRecord?.assigneeName,
    caseRecord?.assignedTo,
    caseRecord?.assignedToName,
    caseRecord?.assignedUserName,
    caseRecord?.ownerName,
    caseRecord?.designerName
  ].map(identity).filter(Boolean);
  return Boolean(identity(actor.name) && candidateNames.includes(identity(actor.name)));
};

export const canAccessCase = (user = {}, caseRecord = {}) => {
  const role = normalizePermissionRole(user?.role);
  if (role === 'ADMIN' || role === 'MANAGER') return true;
  if (role !== 'DESIGNER') return false;
  return isCaseAssignedToUser(caseRecord, user);
};

export const filterCasesForUser = (cases = [], user = {}) => {
  const role = normalizePermissionRole(user?.role);
  if (role === 'ADMIN' || role === 'MANAGER') return Array.isArray(cases) ? cases : [];
  return (Array.isArray(cases) ? cases : []).filter(caseRecord => canAccessCase(user, caseRecord));
};

export const canMutateCase = (user = {}, caseRecord = {}, action = 'update') => {
  const role = normalizePermissionRole(user?.role);
  if (role === 'ADMIN') return true;
  if (role === 'MANAGER') return action !== 'finance';
  if (role !== 'DESIGNER' || !isCaseAssignedToUser(caseRecord, user)) return false;
  return ['update', 'start', 'timeline', 'upload-final', 'upload-working'].includes(action);
};

export const notificationBelongsToUser = (notification = {}, user = {}) => {
  const actor = authorizationActor(user);
  if (actor.role === 'ADMIN') return true;
  const targets = [notification?.to, notification?.targetRole, notification?.targetUser, notification?.userId, notification?.userName]
    .map(identity)
    .filter(Boolean);
  return targets.includes(identity(actor.role)) || targets.includes(identity(actor.name)) || targets.includes(identity(actor.id));
};

export const canAccessFileDocument = (user = {}, doc = {}, cases = []) => {
  const actor = authorizationActor(user);
  const role = actor.role;
  if (role === 'ADMIN' || role === 'MANAGER') return true;
  if (role !== 'DESIGNER') return false;
  const purpose = normalize(doc?.purpose || doc?.folder || doc?.type);
  if (purpose === 'CHAT') {
    if (String(doc?.chatScope || '').toUpperCase() === 'GLOBAL') return true;
    const participants = Array.isArray(doc?.chatParticipants) ? doc?.chatParticipants.map(identity).filter(Boolean) : [];
    const actorKeys = [actor.id, actor.username, actor.name].map(identity).filter(Boolean);
    if (participants.length) return actorKeys.some(key => participants.includes(key));
    return identity(doc?.uploadedBy) === identity(actor.name);
  }
  if (identity(doc?.uploadedBy) && identity(doc?.uploadedBy) === identity(user?.name)) return true;
  const caseId = String(doc?.caseId || doc?.projectId || '').trim();
  if (!caseId) return false;
  const caseRecord = (Array.isArray(cases) ? cases : []).find(item => [item?.id, item?.caseId].map(String).includes(caseId));
  return Boolean(caseRecord && canAccessCase(user, caseRecord));
};

export const canDeleteFileDocument = (user = {}, doc = {}, cases = []) => {
  const role = normalizePermissionRole(user?.role);
  if (role === 'ADMIN' || role === 'MANAGER') return true;
  return role === 'DESIGNER'
    && identity(doc?.uploadedBy) === identity(user?.name)
    && canAccessFileDocument(user, doc, cases);
};
