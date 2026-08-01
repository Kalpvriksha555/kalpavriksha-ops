import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { setTimeout as delay } from 'timers/promises';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const requireText = (file, pattern, message) => { if (!pattern.test(read(file))) throw new Error(`${message} (${file})`); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

requireText('backend/src/services/authorizationService.js', /ROLE_CAPABILITIES/, 'Central role capability matrix is missing.');
requireText('backend/src/server.js', /authorizedProjectUpdate/, 'Server-authorized task updates are missing.');
requireText('backend/src/server.js', /authorizationDenied/, 'Authorization denial auditing is missing.');
requireText('backend/src/server.js', /scopedTeamChat/, 'Role-scoped chat filtering is missing.');
requireText('backend/src/server.js', /MAX_UPLOAD_FILES/, 'Upload file-count protection is missing.');
requireText('backend/src/middleware/security.js', /UNSAFE_JSON/, 'Unsafe JSON rejection is missing.');
requireText('backend/src/middleware/security.js', /RATE_LIMITED/, 'API rate limiting is missing.');
requireText('frontend/src/App.jsx', /Only an Admin or Manager can permanently delete a task/, 'Frontend Manager delete guard is missing.');
if (/currentUserRole/.test(read('frontend/src/services/taskService.js'))) throw new Error('Client-controlled role fields remain in the task service.');
if (/form\.append\(['"](?:by|role)['"]/.test(read('frontend/src/components/chat/CommunicationHub.jsx'))) throw new Error('Client-controlled chat uploader identity remains.');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalp-authz-check-'));
const dbFile = path.join(tempDir, 'db.json');
const authFile = path.join(tempDir, 'auth.json');
const uploadDir = path.join(tempDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
fs.writeFileSync(dbFile, JSON.stringify({ users: [], cases: [], projects: [], payments: [], teamChat: [], notifications: [], attendanceLogs: [], audit: [], files: [] }));

const port = 20000 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
let child;
let output = '';

const start = async () => {
  child = spawn(process.execPath, ['backend/src/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: '',
      DB_SSL: 'false',
      ALLOW_JSON_FALLBACK: 'true',
      PORT: String(port),
      KALPA_DB_FILE: dbFile,
      KALPA_AUTH_FILE: authFile,
      KALPA_LEGACY_UPLOAD_DIR: uploadDir,
      KALPA_FILE_STORAGE_ROOT: path.join(tempDir, 'private-files'),
      BOOTSTRAP_ADMIN_USERNAME: 'phase4admin',
      BOOTSTRAP_ADMIN_PASSWORD: 'StrongAdmin123',
      BOOTSTRAP_ADMIN_NAME: 'Phase 4 Admin',
      API_WRITE_RATE_LIMIT: '1000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw new Error(`Authorization test server exited early.\n${output}`);
    try { if ((await fetch(`${base}/api/health/live`)).ok) return; } catch {}
    await delay(100);
  }
  throw new Error(`Authorization test server did not start.\n${output}`);
};

const stop = async () => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(2000).then(() => child.exitCode === null && child.kill('SIGKILL'))]);
};

const request = async (pathname, { method = 'GET', body, rawBody, session, headers = {} } = {}) => {
  const requestHeaders = { ...headers };
  if (body !== undefined || rawBody !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (session?.cookie) requestHeaders.Cookie = session.cookie;
  if (session?.csrf && !['GET','HEAD','OPTIONS'].includes(method)) requestHeaders['X-CSRF-Token'] = session.csrf;
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: requestHeaders,
    body: rawBody !== undefined ? rawBody : (body === undefined ? undefined : JSON.stringify(body))
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('json') ? await response.json().catch(() => ({})) : await response.text().catch(() => '');
  const setCookie = response.headers.get('set-cookie') || '';
  const cookie = setCookie ? setCookie.split(';')[0] : session?.cookie || '';
  return { response, payload, cookie, requestId: response.headers.get('x-request-id') || '' };
};

const multipart = async (pathname, form, session) => {
  const headers = {};
  if (session?.cookie) headers.Cookie = session.cookie;
  if (session?.csrf) headers['X-CSRF-Token'] = session.csrf;
  const response = await fetch(`${base}${pathname}`, { method:'POST', headers, body:form });
  const payload = await response.json().catch(() => ({}));
  return { response, payload, requestId:response.headers.get('x-request-id') || '' };
};

const login = async (username, password) => {
  const result = await request('/api/auth/login', { method:'POST', body:{ username, password } });
  assert(result.response.ok, `Login failed for ${username}: ${JSON.stringify(result.payload)}`);
  return { cookie:result.cookie, csrf:result.payload.csrfToken, user:result.payload.user };
};

const changeTemporaryPassword = async (username, temporaryPassword, permanentPassword) => {
  const temporary = await login(username, temporaryPassword);
  const changed = await request('/api/auth/change-password', { method:'POST', session:temporary, body:{ currentPassword:temporaryPassword, newPassword:permanentPassword } });
  assert(changed.response.ok, `Password change failed for ${username}.`);
  return { cookie:changed.cookie, csrf:changed.payload.csrfToken, user:changed.payload.user };
};

try {
  await start();

  const anonymous = await request('/api/state');
  assert(anonymous.response.status === 401, 'Anonymous operational state was not blocked.');
  assert(Boolean(anonymous.requestId), 'Responses do not include a request ID.');

  const admin = await login('phase4admin', 'StrongAdmin123');
  const createUser = async (name, username, role, password) => {
    const created = await request('/api/auth/users', { method:'POST', session:admin, body:{ name, username, role, password } });
    assert(created.response.status === 201, `Could not create ${role} ${username}: ${JSON.stringify(created.payload)}`);
    return created.payload.user;
  };
  const managerUser = await createUser('Phase 4 Manager', 'phase4manager', 'MANAGER', 'TempManager123');
  const designerOneUser = await createUser('Designer One', 'phase4designer1', 'DESIGNER', 'TempDesigner123');
  const designerTwoUser = await createUser('Designer Two', 'phase4designer2', 'DESIGNER', 'TempDesigner456');
  const manager = await changeTemporaryPassword('phase4manager', 'TempManager123', 'ManagerSecure456');
  const designerOne = await changeTemporaryPassword('phase4designer1', 'TempDesigner123', 'DesignerSecure456');
  const designerTwo = await changeTemporaryPassword('phase4designer2', 'TempDesigner456', 'DesignerSecure789');

  const makeTask = async (id, assignee) => {
    const created = await request('/api/state/projects', {
      method:'POST', session:admin,
      body:{ currentUserRole:'DESIGNER', project:{ id, caseId:id, customerName:id, assignedTo:assignee.name, assigneeName:assignee.name, assigneeId:assignee.id, status:'Lead Received', estimateAmount:9000, paymentAmountIn:0, paymentTrackingStatus:'Not Updated', createdBy:'Spoofed Client' } }
    });
    assert(created.response.ok, `Admin could not create ${id}.`);
    assert(created.payload.project.createdBy === 'Phase 4 Admin', 'Server did not derive the task creator from the authenticated session.');
    return created.payload.project;
  };
  const taskOne = await makeTask('AUTHZ-TASK-1', designerOneUser);
  const taskTwo = await makeTask('AUTHZ-TASK-2', designerTwoUser);

  const finance = await request('/api/state/projects/AUTHZ-TASK-1/payment-status', { method:'POST', session:admin, body:{ paymentTrackingStatus:'Paid', expectedFinanceVersion:0, expectedAmount:9000, amountIn:5000, paymentDate:'2026-07-30', mode:'UPI', transactionId:'AUTHZ-FIN-1', by:'Spoofed Actor' } });
  assert(finance.response.ok && finance.payload.project?.paymentAmountIn === 5000 && finance.payload.project?.paymentTrackingStatus === 'Pending', `Partial finance update failed: ${finance.response.status} ${JSON.stringify(finance.payload)}`);
  assert(finance.payload.project.paymentTrackingUpdatedBy === 'Phase 4 Admin', 'Finance actor was accepted from the client instead of the session.');

  const d1State = await request('/api/state', { session:designerOne });
  assert(d1State.response.ok, 'Designer state read failed.');
  assert((d1State.payload.projects || []).length === 1 && d1State.payload.projects[0].id === 'AUTHZ-TASK-1', 'Designer received tasks outside their assignment.');
  assert(!Object.hasOwn(d1State.payload.projects[0], 'paymentAmountIn') && !Object.hasOwn(d1State.payload, 'payments'), 'Designer received finance data.');

  // Deliberately omit expectedTaskVersion here. Authorization must run first:
  // an unrelated Designer must receive 403 without learning whether the task
  // exists or which optimistic-concurrency version it currently has.
  const spoofedOtherUpdate = await request('/api/state/projects', { method:'POST', session:designerOne, headers:{ 'X-User-Role':'ADMIN', 'X-User-Name':'Phase 4 Admin' }, body:{ currentUserRole:'ADMIN', project:{ id:'AUTHZ-TASK-2', caseId:'AUTHZ-TASK-2', status:'Completed', assignedTo:'Designer One' } } });
  assert(
    spoofedOtherUpdate.response.status === 403 && spoofedOtherUpdate.payload?.code === 'TASK_UPDATE_FORBIDDEN',
    `Designer anti-spoofing check returned ${spoofedOtherUpdate.response.status}: ${JSON.stringify(spoofedOtherUpdate.payload)}`
  );

  const spoofedBroadStateUpdate = await request('/api/state', { method:'POST', session:designerOne, headers:{ 'X-User-Role':'ADMIN', 'X-User-Name':'Phase 4 Admin' }, body:{ projects:[{ id:'AUTHZ-TASK-2', caseId:'AUTHZ-TASK-2', status:'Completed', assignedTo:'Designer One', currentUserRole:'ADMIN' }] } });
  assert(
    spoofedBroadStateUpdate.response.status === 403 && spoofedBroadStateUpdate.payload?.code === 'TASK_UPDATE_FORBIDDEN',
    `Legacy state anti-spoofing check returned ${spoofedBroadStateUpdate.response.status}: ${JSON.stringify(spoofedBroadStateUpdate.payload)}`
  );

  // Even a correct mutation ID must not bypass task authorization. This guards
  // the idempotent replay path from becoming a task-existence/data oracle.
  const spoofedIdempotentReplay = await request('/api/state/projects', {
    method:'POST',
    session:designerOne,
    body:{
      mutationId:taskTwo.lastTaskMutationId,
      project:{ id:'AUTHZ-TASK-2', caseId:'AUTHZ-TASK-2' }
    }
  });
  assert(
    spoofedIdempotentReplay.response.status === 403 && spoofedIdempotentReplay.payload?.code === 'TASK_UPDATE_FORBIDDEN',
    `Unauthorized idempotent replay returned ${spoofedIdempotentReplay.response.status}: ${JSON.stringify(spoofedIdempotentReplay.payload)}`
  );

  const ownUpdate = await request('/api/state/projects', { method:'POST', session:designerOne, body:{ expectedTaskVersion:taskOne.taskVersion, project:{ id:'AUTHZ-TASK-1', caseId:'AUTHZ-TASK-1', status:'Drafting', assignedTo:'Designer Two', customerName:'Tampered', paymentAmountIn:0, paymentTrackingStatus:'Not Updated' } } });
  assert(ownUpdate.response.ok, 'Designer could not update their assigned task.');
  assert(ownUpdate.payload.project.status === 'Drafting', 'Allowed Designer status change was not saved.');
  assert(ownUpdate.payload.project.assignedTo === 'Designer One' && ownUpdate.payload.project.customerName === 'AUTHZ-TASK-1', 'Designer changed protected task fields.');
  assert(!Object.hasOwn(ownUpdate.payload.project, 'paymentAmountIn'), 'Designer update response exposed finance data.');

  const broadStateSpoof = await request('/api/state', { method:'POST', session:designerOne, body:{ users:[{id:'fake-admin',role:'Admin'}], payments:[{id:'fake-payment',paymentAmountIn:999999}], audit:[{action:'fake'}], notifications:[{id:'fake-notification'}] } });
  assert(broadStateSpoof.response.ok, 'Protected broad-state fields caused an unsafe server error.');
  for (const field of ['users','payments','audit','notifications']) assert((broadStateSpoof.payload.ignoredFields || []).includes(field), `Broad-state field ${field} was not explicitly ignored.`);

  const d1Delete = await request('/api/state/projects/AUTHZ-TASK-1', { method:'DELETE', session:designerOne });
  assert(d1Delete.response.status === 403, 'Designer permanently deleted a task.');
  const managerFinance = await request('/api/state/projects/AUTHZ-TASK-1/payment-status', { method:'POST', session:manager, body:{ paymentTrackingStatus:'Pending', expectedFinanceVersion:1 } });
  assert(managerFinance.response.status === 403, 'Manager changed finance data.');

  const managerUpdate = await request('/api/state/projects', { method:'POST', session:manager, body:{ expectedTaskVersion:ownUpdate.payload.project.taskVersion, project:{ id:'AUTHZ-TASK-1', caseId:'AUTHZ-TASK-1', assignedTo:'Designer Two', assigneeName:'Designer Two', assigneeId:designerTwoUser.id, status:'Assigned' } } });
  assert(managerUpdate.response.ok && managerUpdate.payload.project.assignedTo === 'Designer Two', 'Manager could not perform an operational assignment update.');
  assert(!Object.hasOwn(managerUpdate.payload.project, 'paymentAmountIn'), 'Manager received finance data.');
  const managerCreated = await request('/api/state/projects', { method:'POST', session:manager, body:{ mutationId:'phase4-manager-recent-create', project:{ id:'AUTHZ-MANAGER-RECENT', caseId:'AUTHZ-MANAGER-RECENT', customerName:'Manager recent task', assignedTo:'Designer Two', assigneeName:'Designer Two', assigneeId:designerTwoUser.id, status:'Lead Received' } } });
  assert(managerCreated.response.ok && managerCreated.payload.project.createdBy === 'Phase 4 Manager', `Manager could not create a recent task: ${managerCreated.response.status} ${JSON.stringify(managerCreated.payload)}`);
  const managerRecentEdit = await request('/api/state/projects', { method:'POST', session:manager, body:{ mutationId:'phase4-manager-recent-edit', expectedTaskVersion:managerCreated.payload.project.taskVersion, project:{ id:'AUTHZ-MANAGER-RECENT', caseId:'AUTHZ-MANAGER-RECENT', customerName:'Manager edited recent task', priority:'High' } } });
  assert(managerRecentEdit.response.ok && managerRecentEdit.payload.project.customerName === 'Manager edited recent task' && managerRecentEdit.payload.project.priority === 'High', `Manager could not edit a recently created task: ${managerRecentEdit.response.status} ${JSON.stringify(managerRecentEdit.payload)}`);

  // A normal caller may echo a server task object. Its server-owned
  // lastTaskMutationId must never make a genuinely new edit look idempotent.
  const managerEchoEdit = await request('/api/state/projects', { method:'POST', session:manager, body:{ expectedTaskVersion:managerRecentEdit.payload.project.taskVersion, project:{ ...managerRecentEdit.payload.project, priority:'Urgent' } } });
  assert(
    managerEchoEdit.response.ok
      && managerEchoEdit.payload.project.priority === 'Urgent'
      && Number(managerEchoEdit.payload.project.taskVersion) === Number(managerRecentEdit.payload.project.taskVersion) + 1
      && managerEchoEdit.payload.project.lastTaskMutationId !== managerRecentEdit.payload.project.lastTaskMutationId,
    `Server-owned mutation metadata suppressed a genuine Manager edit: ${managerEchoEdit.response.status} ${JSON.stringify(managerEchoEdit.payload)}`
  );
  const managerRecentDelete = await request('/api/state/projects/AUTHZ-MANAGER-RECENT', { method:'DELETE', session:manager });
  assert(managerRecentDelete.response.ok && managerRecentDelete.payload.deleted === 1, 'Manager could not permanently delete a recently created task.');
  const managerAfterDelete = await request('/api/state', { session:manager });
  assert(!(managerAfterDelete.payload.projects || []).some(task => task.id === 'AUTHZ-MANAGER-RECENT'), 'Manager-deleted recent task remained visible.');
  const staleManagerRecreate = await request('/api/state/projects', { method:'POST', session:manager, body:{ project:managerEchoEdit.payload.project } });
  assert(staleManagerRecreate.response.status === 409 && staleManagerRecreate.payload.code === 'PROJECT_DELETED', 'A stale client recreated the Manager-deleted task.');

  const d1AfterReassign = await request('/api/state', { session:designerOne });
  assert(!(d1AfterReassign.payload.projects || []).some(task => task.id === 'AUTHZ-TASK-1'), 'Reassigned task remained visible to the previous Designer.');
  const d2AfterReassign = await request('/api/state', { session:designerTwo });
  assert((d2AfterReassign.payload.projects || []).some(task => task.id === 'AUTHZ-TASK-1'), 'Reassigned task was not visible to the new Designer.');

  const spoofedChat = await request('/api/chat', { method:'POST', session:designerTwo, body:{ text:'Private manager note', recipient:managerUser.id, sender:'Phase 4 Admin', role:'ADMIN' } });
  assert(spoofedChat.response.status === 201 && spoofedChat.payload.sender === 'Designer Two' && spoofedChat.payload.senderRole === 'DESIGNER', 'Chat sender identity was accepted from the client.');
  const d1PrivateState = await request('/api/state', { session:designerOne });
  assert(!(d1PrivateState.payload.chatMessages || []).some(message => message.id === spoofedChat.payload.id), 'Designer received another user’s direct message.');
  const managerPrivateState = await request('/api/state', { session:manager });
  assert((managerPrivateState.payload.chatMessages || []).some(message => message.id === spoofedChat.payload.id), 'Direct-message recipient could not see the message.');

  const invalidRecipient = await request('/api/chat', { method:'POST', session:designerOne, body:{ text:'No target', recipient:'does-not-exist' } });
  assert(invalidRecipient.response.status === 400 && invalidRecipient.payload.code === 'CHAT_RECIPIENT_INVALID', 'Invalid direct-message recipient was accepted.');

  const sourceForm = new FormData();
  sourceForm.append('file', new Blob(['source'], { type:'text/plain' }), 'source.txt');
  sourceForm.append('projectId', 'AUTHZ-TASK-2');
  sourceForm.append('type', 'source');
  sourceForm.append('by', 'Phase 4 Admin');
  const sourceDenied = await multipart('/api/files/upload', sourceForm, designerTwo);
  assert(sourceDenied.response.status === 403, 'Designer uploaded a protected source file.');

  const workingForm = new FormData();
  workingForm.append('file', new Blob(['working'], { type:'text/plain' }), 'working.txt');
  workingForm.append('projectId', 'AUTHZ-TASK-2');
  workingForm.append('type', 'working');
  workingForm.append('by', 'Spoofed Uploader');
  const working = await multipart('/api/files/upload', workingForm, designerTwo);
  assert(working.response.ok && working.payload.file.uploadedBy === 'Designer Two', 'Server did not derive the file uploader from the session.');

  const otherTaskForm = new FormData();
  otherTaskForm.append('file', new Blob(['wrong task'], { type:'text/plain' }), 'wrong.txt');
  otherTaskForm.append('projectId', 'AUTHZ-TASK-2');
  otherTaskForm.append('type', 'working');
  const wrongDesignerUpload = await multipart('/api/files/upload', otherTaskForm, designerOne);
  assert(wrongDesignerUpload.response.status === 403, 'Designer uploaded a file to another user’s task.');

  const chatForm = new FormData();
  chatForm.append('file', new Blob(['private attachment'], { type:'text/plain' }), 'private.txt');
  chatForm.append('type', 'chat');
  const chatUpload = await multipart('/api/files/upload', chatForm, designerTwo);
  assert(chatUpload.response.ok, 'Chat attachment upload failed.');
  const directWithFile = await request('/api/chat', { method:'POST', session:designerTwo, body:{ text:'Private file', recipient:managerUser.id, files:[{ id:chatUpload.payload.file.id }] } });
  assert(directWithFile.response.status === 201, `Direct chat attachment could not be sent: ${directWithFile.response.status} ${JSON.stringify(directWithFile.payload)}`);
  const d1FileAccess = await request(`/api/files/${encodeURIComponent(chatUpload.payload.file.id)}?mode=download`, { session:designerOne });
  assert(d1FileAccess.response.status === 403, 'Unrelated Designer accessed a private chat attachment.');
  const managerFileAccess = await request(`/api/files/${encodeURIComponent(chatUpload.payload.file.id)}?mode=download`, { session:manager });
  assert(managerFileAccess.response.ok, 'Direct-message recipient could not access the attachment.');
  const d1LegacyFileAccess = await request(`/uploads/${encodeURIComponent(chatUpload.payload.file.storedName)}`, { session:designerOne });
  assert(d1LegacyFileAccess.response.status === 403, 'Legacy /uploads path bypassed file authorization.');
  const managerLegacyFileAccess = await request(`/uploads/${encodeURIComponent(chatUpload.payload.file.storedName)}`, { session:manager });
  assert(managerLegacyFileAccess.response.ok, 'Authorized recipient could not use a legacy upload link.');

  const ownNotification = await request('/api/notifications', { method:'POST', session:designerOne, body:{ targetRole:'ADMIN', title:'Designer operational alert', type:'info' } });
  assert(ownNotification.response.status === 201 && ownNotification.payload.notification.createdBy === 'Designer One', 'Authorized notification creation failed or accepted a spoofed actor.');
  const forbiddenNotification = await request('/api/notifications', { method:'POST', session:designerOne, body:{ targetRole:'DESIGNER', title:'Spam all Designers' } });
  assert(forbiddenNotification.response.status === 403, 'Designer created a global Designer notification.');
  const d2ReadOtherNotification = await request(`/api/notifications/${encodeURIComponent(ownNotification.payload.notification.id)}/read`, { method:'POST', session:designerTwo });
  assert(d2ReadOtherNotification.response.status === 403, 'Unrelated user marked another role’s notification as read.');

  const unsafe = await request('/api/state', { method:'POST', session:admin, rawBody:'{"__proto__":{"polluted":true}}' });
  assert(unsafe.response.status === 400 && unsafe.payload.code === 'UNSAFE_JSON', 'Unsafe JSON keys were accepted.');

  const noCsrf = await fetch(`${base}/api/state/projects`, { method:'POST', headers:{ 'Content-Type':'application/json', Cookie:admin.cookie }, body:JSON.stringify({ project:{ id:'NO-CSRF' } }) });
  assert(noCsrf.status === 403, 'Mutation without CSRF was accepted.');

  const adminState = await request('/api/state', { session:admin });
  const savedTask = (adminState.payload.projects || []).find(task => task.id === 'AUTHZ-TASK-1');
  assert(savedTask?.paymentAmountIn === 5000 && savedTask?.paymentTrackingStatus === 'Pending' && savedTask?.ledger?.mode === 'UPI', `Operational role changes rolled back protected finance data: ${JSON.stringify(savedTask)}`);

  console.log('Phase 4 authorization and API protection verification passed.');
  console.log('Verified: role scoping, anti-spoofing, task/finance/file/chat/notification permissions, private direct messages, CSRF, request IDs, payload validation and finance preservation.');
} finally {
  await stop();
  fs.rmSync(tempDir, { recursive:true, force:true });
}
