import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const findings=[];
const requirePattern=(file,pattern,message)=>{ const source=read(file); if(!pattern.test(source)) findings.push({file,message,pattern:String(pattern)}); };
const forbidPattern=(file,pattern,message)=>{ const source=read(file); if(pattern.test(source)) findings.push({file,message,pattern:String(pattern)}); };

const auth=read('frontend/src/services/authService.js');
const app=read('frontend/src/App.jsx');
const server=read('backend/src/server.js');
const meeting=read('frontend/src/components/meetings/TeamMeetingRoom.jsx');
const commandCentre=read('frontend/src/components/command-centre/CommandCentreView.jsx');
const chat=read('frontend/src/components/chat/CommunicationHub.jsx');

// Browser cookies are shared across tabs, while this application requires page-instance
// ownership. A stale tab must stop before it can read through another user's new cookie.
requirePattern('frontend/src/services/authService.js',/AUTH_CONTEXT_STORAGE_KEY = 'kalpa_auth_page_context_v1'/,'Browser auth ownership storage key is missing.');
requirePattern('frontend/src/services/authService.js',/AUTH_CONTEXT_CHANNEL_NAME = 'kalpa_auth_page_context'/,'Browser auth ownership channel is missing.');
requirePattern('frontend/src/services/authService.js',/const AUTH_PAGE_INSTANCE_ID = \(\(\) =>/,'Every page instance must have a unique auth owner ID.');
requirePattern('frontend/src/services/authService.js',/new BroadcastChannel\(AUTH_CONTEXT_CHANNEL_NAME\)/,'Auth ownership changes must propagate through BroadcastChannel when available.');
requirePattern('frontend/src/services/authService.js',/window\.addEventListener\('storage'/,'Auth ownership changes must have a storage-event fallback.');
requirePattern('frontend/src/services/authService.js',/export const assertBrowserAuthContextOwnership = \(\) =>/,'Requests need a local page-ownership preflight.');
requirePattern('frontend/src/services/authService.js',/if \(!skipSessionOwnershipCheck\) assertBrowserAuthContextOwnership\(\)/,'authFetch must reject stale pages before network access.');
requirePattern('frontend/src/services/authService.js',/let authRequestGeneration = 0/,'Auth requests need a monotonic session-generation boundary.');
requirePattern('frontend/src/services/authService.js',/assertAuthRequestGeneration\(requestAuthGeneration\)/,'Responses must be rejected when their initiating auth generation is no longer current.');
requirePattern('frontend/src/services/authService.js',/consumeWithDeadline[\s\S]*assertAuthRequestGeneration\(requestAuthGeneration\)/,'Slow response bodies must remain bound to their initiating auth generation.');
requirePattern('frontend/src/services/authService.js',/streamWithDeadline[\s\S]*assertAuthRequestGeneration\(requestAuthGeneration\)/,'Streamed responses must remain bound to their initiating auth generation.');
requirePattern('frontend/src/services/authService.js',/if \(csrfToken && !headers\.has\('X-CSRF-Token'\)\) headers\.set\('X-CSRF-Token', csrfToken\)/,'Safe reads and writes must carry the page-bound session token whenever available.');
requirePattern('frontend/src/services/authService.js',/response\.status === 409[\s\S]*X-Auth-Session-Context[\s\S]*AUTH_SESSION_CONTEXT_CHANGED/,'Browser must recognize the server stale-session-context signal.');
forbidPattern('frontend/src/services/authService.js',/localStorage\.setItem\(CSRF_STORAGE_KEY/,'CSRF/page-session secrets must never be persisted in browser storage.');
requirePattern('frontend/src/services/authService.js',/window\.localStorage\.removeItem\(CSRF_STORAGE_KEY\)/,'Legacy persisted CSRF secrets must be actively removed.');

// A page boot owns the browser context immediately, then clears the shared cookie. Only
// that public cleanup call may bypass the local ownership preflight.
requirePattern('frontend/src/services/authService.js',/claimBrowserAuthContext\(\{ state:'signed-out', reason:'page-boot' \}\)[\s\S]*skipSessionOwnershipCheck: true/,'Page boot must claim signed-out ownership before clearing the shared session.');
requirePattern('frontend/src/services/authService.js',/claimBrowserAuthContext\(\{ state:'authenticated',[\s\S]*reason:'login' \}\)/,'Successful login must claim authenticated page ownership.');
requirePattern('frontend/src/services/authService.js',/claimBrowserAuthContext\(\{ state:'authenticated',[\s\S]*reason:'password-change' \}\)/,'Password-change session rotation must refresh page ownership.');
requirePattern('frontend/src/services/authService.js',/claimBrowserAuthContext\(\{ state:'signed-out', reason:'logout' \}\)/,'Logout must publish signed-out ownership.');

// Server compares an optional page token on safe reads and always requires it for writes.
// A mismatch returns 409 without revoking/clearing the newer shared session cookie.
{
  const start=server.indexOf('async function authenticationGate');
  const end=server.indexOf('function requireAdminSession',start);
  const gate=server.slice(start,end);
  if(start<0 || end<0) findings.push({file:'backend/src/server.js',message:'Authentication gate could not be isolated.'});
  else {
    if(!/const suppliedSessionContext = String\(req\.get\?\.\('x-csrf-token'\)/.test(gate)) findings.push({file:'backend/src/server.js',message:'Authentication gate must read the page session-context token.'});
    if(!/const suppliedContextMismatch = Boolean/.test(gate)) findings.push({file:'backend/src/server.js',message:'Authentication gate is missing stale-context comparison.'});
    if(!/res\.setHeader\('X-Auth-Session-Context', 'changed'\)/.test(gate) || !/status\(409\)[\s\S]*AUTH_SESSION_CONTEXT_CHANGED/.test(gate)) findings.push({file:'backend/src/server.js',message:'Stale page contexts must return the explicit HTTP 409 replacement signal.'});
    const mismatchStart=gate.indexOf('if (suppliedContextMismatch)');
    const unsafeStart=gate.indexOf('if (!isSafeMethod(req.method))');
    if(!(mismatchStart>=0 && unsafeStart>mismatchStart)) findings.push({file:'backend/src/server.js',message:'Safe reads must be context-checked before the write-only CSRF branch.'});
    const mismatchBlock=gate.slice(mismatchStart,unsafeStart);
    if(/clearSessionCookie|revokeAuthSession|revokeAllUserSessions/.test(mismatchBlock)) findings.push({file:'backend/src/server.js',message:'A stale tab must never clear or revoke the newer tab\'s valid shared session.'});
    if(!/if \(!suppliedSessionContext \|\| !expectedSessionContext\)/.test(gate)) findings.push({file:'backend/src/server.js',message:'Unsafe requests must still require the anti-CSRF/page token.'});
  }
}
requirePattern('backend/src/server.js',/exposedHeaders: \[[^\]]*'X-Request-Id'[^\]]*'X-Auth-Session-Context'/,'Approved cross-origin frontends must be able to read the session-context replacement header.');

// Single-account login policy must be race-safe, including simultaneous devices.
{
  const start=server.indexOf('async function createAuthSession');
  const end=server.indexOf('async function cleanupExpiredAuthSessions',start);
  const block=server.slice(start,end);
  if(!/SELECT user_id FROM auth_credentials WHERE user_id=\$1 FOR UPDATE/.test(block)) findings.push({file:'backend/src/server.js',message:'PostgreSQL session creation must serialize per user before replacing the active session.'});
  if(!/UPDATE auth_sessions SET revoked_at=COALESCE\(revoked_at,now\(\)\) WHERE user_id=\$1 AND revoked_at IS NULL/.test(block)) findings.push({file:'backend/src/server.js',message:"Creating a session must revoke the account's previous active session inside the same transaction."});
  if(!(block.indexOf('FOR UPDATE')>=0 && block.indexOf('INSERT INTO auth_sessions')>block.indexOf('FOR UPDATE'))) findings.push({file:'backend/src/server.js',message:'Session replacement lock/revocation must precede the new session insert.'});
  if(!/store\.sessions = store\.sessions\.map\(item => String\(item\.user_id\) === session\.user_id && !item\.revoked_at/.test(block)) findings.push({file:'backend/src/server.js',message:'Development auth storage must enforce the same one-live-session rule.'});
}

// Durable browser state must remain actor-scoped rather than falling through to the next
// employee. Unknown legacy ownership is preserved but ignored until it can be identified.
requirePattern('frontend/src/App.jsx',/let activeOperationalActorScope = ''/,'Operational retry state needs an explicit active actor scope.');
requirePattern('frontend/src/App.jsx',/const getPendingCreatedRecords = \(actorId = activeOperationalActorScope\)/,'Pending task creates must default to the active actor only.');
requirePattern('frontend/src/App.jsx',/const getPendingDeletedRecords = \(actorId = activeOperationalActorScope\)/,'Pending task deletes must default to the active actor only.');
requirePattern('frontend/src/App.jsx',/if \(!actorKey\) return \[\];/,'Signed-out pages must not enumerate actor-owned task retry queues.');
requirePattern('frontend/src/App.jsx',/Boolean\(record\.actorId\) && String\(record\.actorId\)\.trim\(\)\.toLowerCase\(\)\s*===?\s*actorKey/,'Legacy unknown-actor retry entries must not be adopted by a later user.');
requirePattern('frontend/src/App.jsx',/const getRecentCreatedProjects = \(actorId = activeOperationalActorScope\)/,'Recent-created task protection must be actor-scoped.');
requirePattern('frontend/src/App.jsx',/recordActor && recordActor === actorKey/,'Recent-created task records without a known owner must not be adopted by a later user.');
requirePattern('frontend/src/App.jsx',/setOperationalActorScope\(null\);[\s\S]*setCurrentUser\(null\)/,'Sign-out must clear actor scope before workspace identity.');
requirePattern('frontend/src/App.jsx',/setOperationalActorScope\(user\);[\s\S]*clearRoleScopedOperationalCaches\(user\)/,'Successful authentication must establish the actor scope before loading actor caches.');

// Transient React state and in-flight files are also part of the account boundary.
{
  const start=app.indexOf('const clearAuthenticatedWorkspace = useCallback');
  const end=app.indexOf('const [globalSearch, setGlobalSearch]',start);
  const block=app.slice(start,end);
  for(const [pattern,message] of [
    [/createdTaskUploadAbortRef\.current\.abort\(\)/,'Sign-out must abort in-flight task attachment uploads.'],
    [/setWorkspaceFilePreview\(null\)/,'Sign-out must close workspace file previews.'],
    [/URL\.revokeObjectURL\(current\.objectUrl\)/,'Sign-out must revoke temporary preview object URLs.'],
    [/setLeadFiles\(\[\]\)/,'Sign-out must discard unsent task files from memory.'],
    [/setGlobalSearch\(''\)/,'Sign-out must discard previous-user global search text.'],
    [/setNotifSearch\(''\)/,'Sign-out must discard previous-user notification search text.'],
    [/setSavedGlobalFilters\(\[\]\)/,'Sign-out must discard the active user\'s in-memory saved-filter list.'],
    [/setArchiveViewState\(/,'Sign-out must reset archive query state.'],
    [/setFinanceViewState\(/,'Sign-out must reset finance query state.'],
    [/setCreatedTaskUpload\(\{ active:false/,'Sign-out must reset task-upload status UI.']
  ]) if(!pattern.test(block)) findings.push({file:'frontend/src/App.jsx',message});
}
requirePattern('frontend/src/App.jsx',/AUTH_BROWSER_CONTEXT_CHANGED[\s\S]*AUTH_SESSION_CONTEXT_CHANGED[\s\S]*signed out to prevent account data from mixing/,'Cross-tab/session replacement must produce an explicit safe sign-out message.');

// Browser-only collaboration/QA state cannot use unscoped global keys.
requirePattern('frontend/src/components/meetings/TeamMeetingRoom.jsx',/kalpa_team_meeting_started_at::\$\{storageActorKey\}/,'Meeting start state must be actor-scoped.');
requirePattern('frontend/src/components/meetings/TeamMeetingRoom.jsx',/kalpa_team_meeting_notes::\$\{storageActorKey\}/,'Meeting notes must be actor-scoped.');
requirePattern('frontend/src/components/command-centre/CommandCentreView.jsx',/kalpa-production-qa-signoff-\$\{todayKey\}::\$\{String\(currentUser/,'Production QA signoff state must be actor-scoped.');
requirePattern('frontend/src/components/chat/CommunicationHub.jsx',/useEffect\(\(\) => \(\) => \{[\s\S]*attachmentUploadAbortRef\.current\?\.abort\(\)[\s\S]*voiceCancelRef\.current = true[\s\S]*recorder\.stop\(\)/,'Chat upload and voice capture must stop when the authenticated workspace unmounts.');

// Long-running multipart requests are authenticated before their request bodies finish.
// Revalidate the exact original session after parsing and abort task-detail uploads on
// unmount so a logout/account replacement cannot commit under the previous actor.
requirePattern('frontend/src/services/fileService.js',/assertBrowserAuthContextOwnership\(\);[\s\S]*xhr\.open\('POST'/,'XHR uploads must reject a stale page before sending bytes.');
requirePattern('frontend/src/services/fileService.js',/xhr\.status === 409[\s\S]*X-Auth-Session-Context[\s\S]*notifyBrowserAuthenticationRejected\('AUTH_SESSION_CONTEXT_CHANGED'\)/,'XHR uploads must surface browser-session replacement immediately.');
requirePattern('frontend/src/services/fileService.js',/xhr\.status === 401[\s\S]*notifyBrowserAuthenticationRejected/,'XHR upload authentication expiry must clear the active browser auth context.');
{
  const start=app.indexOf('const TaskDetailView =');
  const end=app.indexOf('const clearAuthenticatedWorkspace = useCallback',start);
  const block=app.slice(start,end);
  for(const [pattern,message] of [
    [/useEffect\(\(\) => \(\) => \{[\s\S]*fileTransferAbortRef\.current\?\.abort\(\)[\s\S]*fileTransferAbortRef\.current = null/,'Task-detail unmount must abort the active file transfer.'],
    [/handleFileUpload[\s\S]*const controller=new AbortController\(\)[\s\S]*signal:controller\.signal/,'Task source/working/final uploads must receive an abort signal.'],
    [/uploadSupportingAttachments[\s\S]*const controller=new AbortController\(\)[\s\S]*signal:controller\.signal/,'Revision/discussion attachments must receive an abort signal.'],
    [/handleLedgerScreenshot[\s\S]*const controller=new AbortController\(\)[\s\S]*signal:controller\.signal/,'Payment-receipt uploads must receive an abort signal.'],
    [/fileTransferAbortRef\.current \|\| \(fileTransfer\.active/,'Task file operations need a synchronous ref lock as well as rendered transfer state.']
  ]) if(!pattern.test(block)) findings.push({file:'frontend/src/App.jsx',message});
}
{
  const start=server.indexOf('async function requireFreshAuthenticatedRequestAfterBody');
  const end=server.indexOf('function requireAdminSession',start);
  const block=server.slice(start,end);
  if(start<0 || end<0) findings.push({file:'backend/src/server.js',message:'Post-body authentication revalidation middleware is missing.'});
  else {
    if(!/const refreshed = await resolveRequestAuthentication\(req\)/.test(block)) findings.push({file:'backend/src/server.js',message:'Multipart writes must re-resolve authentication after body parsing.'});
    if(!/refreshedSessionHash !== originalSessionHash/.test(block) || !/refreshedUserId !== originalUserId/.test(block)) findings.push({file:'backend/src/server.js',message:'Post-body authentication must remain bound to the exact initiating session and user.'});
    if(!/AUTH_SESSION_EXPIRED_DURING_REQUEST/.test(block) || !/cleanupRequestTempUploads\(req\)/.test(block)) findings.push({file:'backend/src/server.js',message:'Expired multipart sessions must fail closed and remove temporary bytes.'});
  }
}
for(const [pattern,message] of [
  [/app\.post\('\/api\/profile\/photo', profilePhotoUpload, requireFreshAuthenticatedRequestAfterBody,/,'Profile-photo writes must revalidate after multipart parsing.'],
  [/app\.post\('\/api\/files\/upload', uploadAny, requireFreshAuthenticatedRequestAfterBody,/,'Canonical file writes must revalidate after multipart parsing.'],
  [/app\.post\('\/api\/cases', requireAnyRole\('ADMIN','MANAGER'\), uploadAny, requireFreshAuthenticatedRequestAfterBody, requireAnyRole\('ADMIN','MANAGER'\),/,'Task-create multipart writes must revalidate session and role after parsing.'],
  [/app\.post\('\/api\/cases\/:id\/upload-source',[\s\S]*?uploadAny, requireFreshAuthenticatedRequestAfterBody, requireAnyRole\('ADMIN','MANAGER'\), requireCaseAction/,'Legacy source-file writes must revalidate session/role before commit.'],
  [/app\.post\('\/api\/cases\/:id\/upload-final',[\s\S]*?uploadAny, requireFreshAuthenticatedRequestAfterBody, requireCaseAction/,'Legacy final-file writes must revalidate session before commit.']
]) if(!pattern.test(server)) findings.push({file:'backend/src/server.js',message});
{
  const start=app.indexOf('const clearAuthenticatedWorkspace = useCallback');
  const end=app.indexOf('const [globalSearch, setGlobalSearch]',start);
  const block=app.slice(start,end);
  if(!/markClientMutationStarted\(\);[\s\S]*setOperationalActorScope\(null\)/.test(block)) findings.push({file:'frontend/src/App.jsx',message:'Authentication boundaries must invalidate all older workspace-read generations.'});
}

// Permanent release wiring.
requirePattern('package.json',/"verify:session-isolation"\s*:\s*"node scripts\/phase-15-auth-session-browser-isolation-check\.mjs"/,'Phase 15 verifier is not registered in package.json.');
requirePattern('package.json',/npm run verify:file-lifecycle && npm run verify:session-isolation/,'Phase 15 verifier must run after Phase 14 in the normal chain.');
requirePattern('scripts/full-release-verifier-matrix.mjs',/id:'auth-session-browser-isolation'[\s\S]*phase-15-auth-session-browser-isolation-check\.mjs/,'Phase 15 verifier is not part of the full release matrix.');

if(findings.length){
  console.error(`Phase 15 auth/session/browser isolation closure FAILED with ${findings.length} finding(s):`);
  for(const finding of findings) console.error(`- ${finding.file}: ${finding.message}`);
  process.exit(1);
}
console.log('Phase 15 auth/session/browser isolation closure PASS (page ownership, safe-read binding, actor isolation and transient cleanup present).');
