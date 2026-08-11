import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const findings = [];
const requirePattern = (file, pattern, message) => {
  const source = read(file);
  if (!pattern.test(source)) findings.push({ file, message, pattern:String(pattern) });
};
const forbidPattern = (file, pattern, message) => {
  const source = read(file);
  if (pattern.test(source)) findings.push({ file, message, pattern:String(pattern) });
};

requirePattern('frontend/src/services/apiContractService.js', /export const readApiRecord/, 'Central successful-response contract parser is missing.');
requirePattern('frontend/src/services/apiContractService.js', /export const validateWorkspaceStatePayload/, 'Workspace state payload validator is missing.');
requirePattern('frontend/src/services/requestControlService.js', /export const markClientMutationStarted/, 'Client mutation generation guard is missing.');
requirePattern('frontend/src/services/authService.js', /if \(!safeMethod\(method\)\) markClientMutationStarted\(\)/, 'Authenticated writes must invalidate older in-flight workspace reads.');
requirePattern('frontend/src/services/taskService.js', /clientMutationGenerationAtStart = getClientMutationGeneration\(\)/, 'Workspace GET must capture mutation generation before request.');
requirePattern('frontend/src/services/taskService.js', /validateWorkspaceStatePayload\(await parseJsonSafe/, 'Workspace GET must validate its API contract.');
requirePattern('frontend/src/utils/workspaceSyncUtils.js', /export const classifyWorkspaceResponseFreshness/, 'Workspace stale-response classifier is missing.');
requirePattern('frontend/src/utils/workspaceSyncUtils.js', /Math\.max\(a\.stateVersion, b\.stateVersion\)/, 'Workspace markers must advance monotonically.');
requirePattern('frontend/src/App.jsx', /const hydrationFreshness = classifyWorkspaceResponseFreshness/, 'Initial workspace hydration must classify response freshness.');
requirePattern('frontend/src/App.jsx', /needsFreshFollowUp = true/, 'Discarded adaptive refreshes must schedule a fresh follow-up.');
requirePattern('frontend/src/App.jsx', /window\.setTimeout\(\(\) => void refreshWorkspaceSnapshot\(\), 0\)/, 'Stale adaptive response must be followed by a fresh request.');
requirePattern('frontend/src/components/command-centre/CommandCentreView.jsx', /readApiRecord\(res, \{ operation:'Performance leaderboard'/, 'Leaderboard response must use central API contract parsing.');
requirePattern('frontend/src/services/chatService.js', /const saved = asRecord\(payload\.message\)/, 'Chat create must consume the confirmed response envelope.');
requirePattern('backend/src/server.js', /existingMessage\) return res\.json\(\{ok:true,idempotent:true,message:existingMessage\}\)/, 'Idempotent chat replay must use the same explicit success envelope.');
requirePattern('backend/src/server.js', /res\.status\(201\)\.json\(\{ok:true,message:msg\}\)/, 'New chat creation must use an explicit success envelope.');

forbidPattern('frontend/src/App.jsx', /Array\.fromasArray/, 'Invalid Array.fromasArray runtime call reappeared.');
forbidPattern('frontend/src/components/command-centre/CommandCentreView.jsx', /res\.ok\s*\?\s*res\.json\(/, 'Direct success JSON parsing bypasses API contract validation.');
forbidPattern('frontend/src/components/command-centre/CommandCentreView.jsx', /asRecord\(await\s+res\.json\(\)\.catch/, 'Malformed successful response is being silently converted to an empty object.');

const app = read('frontend/src/App.jsx');
const classifyAt = app.indexOf('const hydrationFreshness = classifyWorkspaceResponseFreshness');
const applyAt = app.indexOf("applyProjectSnapshot(data.projects, { source: 'backend-hydrate' })", classifyAt);
if (!(classifyAt >= 0 && applyAt > classifyAt)) findings.push({ file:'frontend/src/App.jsx', message:'Initial hydration applies projects before stale-response classification.' });

const frontendRoot = path.join(root, 'frontend/src');
const files = [];
const walk = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(?:js|jsx)$/.test(entry.name)) files.push(full);
  }
};
walk(frontendRoot);
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  if (/Array\.fromasArray/.test(source)) findings.push({ file:path.relative(root, file), message:'Invalid Array.fromasArray runtime call found.' });
}

if (findings.length) {
  console.error('Phase 12 API contract/stale-response verification failed.');
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.message}${finding.pattern ? ` (${finding.pattern})` : ''}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok:true,
  check:'phase-12-api-contract-stale-response-closure',
  scannedFrontendFiles:files.length,
  guardedBoundaries:15,
  staleResponsePolicy:'discard-before-apply-and-refresh',
}, null, 2));
