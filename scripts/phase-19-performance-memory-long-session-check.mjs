import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const findings = [];
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const requireFile = file => { if (!fs.existsSync(path.join(root, file))) findings.push({ file, message:'Required Phase 19 source/test file is missing.' }); };
const requirePattern = (file, pattern, message) => {
  if (!fs.existsSync(path.join(root, file))) return;
  if (!pattern.test(read(file))) findings.push({ file, message });
};

for (const file of [
  'frontend/src/App.jsx',
  'frontend/src/components/chat/CommunicationHub.jsx',
  'frontend/src/components/profile/ProfileView.jsx',
  'frontend/src/components/command-centre/CommandCentreView.jsx',
  'frontend/src/components/operations/ActiveOperationsView.jsx',
  'backend/src/server.js',
  'tests/frontend/phase19-long-session-soak.test.mjs',
  'tests/backend/phase19-long-session-soak.test.mjs'
]) requireFile(file);

requirePattern('frontend/src/App.jsx', /LIVE_CHAT_MEMORY_LIMIT = 1500[\s\S]*slice\(-LIVE_CHAT_MEMORY_LIMIT\)/, 'Browser chat working set must be bounded.');
requirePattern('frontend/src/App.jsx', /LIVE_NOTIFICATION_MEMORY_LIMIT = 300[\s\S]*slice\(0, LIVE_NOTIFICATION_MEMORY_LIMIT\)/, 'Browser notification working set must be bounded.');
requirePattern('frontend/src/App.jsx', /GLOBAL_CASE_SEARCH_LIMIT = 40[\s\S]*slice\(0, GLOBAL_CASE_SEARCH_LIMIT\)/, 'Global task search must have a bounded render set.');
requirePattern('frontend/src/components/chat/CommunicationHub.jsx', /CHAT_RENDER_BATCH = 250[\s\S]*matchingMessages\.slice\(-visibleMessageLimit\)/, 'Chat DOM must use progressive rendering instead of mounting the full history.');
requirePattern('frontend/src/components/chat/CommunicationHub.jsx', /HIDDEN_MESSAGE_ID_LIMIT = 500[\s\S]*slice\(-HIDDEN_MESSAGE_ID_LIMIT\)/, 'Per-user hidden-message storage must be bounded.');
requirePattern('frontend/src/components/chat/CommunicationHub.jsx', /\/api\/chat\/history\?before=[\s\S]*setHistoryMessages/, 'Progressive chat must retain access to durable older history.');
requirePattern('frontend/src/components/profile/ProfileView.jsx', /profilePhoto !== preview[\s\S]*URL\.revokeObjectURL\(preview\)/, 'Profile-photo temporary object URLs must be released after server confirmation.');
for (const file of ['frontend/src/components/command-centre/CommandCentreView.jsx','frontend/src/components/operations/ActiveOperationsView.jsx']) {
  requirePattern(file, /if \(document\.hidden\) return[\s\S]*addEventListener\('visibilitychange'[\s\S]*removeEventListener\('visibilitychange'/, 'Recurring dashboard clocks must suspend while the page is hidden.');
}
requirePattern('backend/src/server.js', /WORKSPACE_COMPACT_CHAT_LIMIT[\s\S]*WORKSPACE_COMPACT_NOTIFICATION_LIMIT/, 'Compact workspace feed limits are missing.');
requirePattern('backend/src/server.js', /compact \? fullChatMessages\.slice\(0, WORKSPACE_COMPACT_CHAT_LIMIT\)[\s\S]*compact \? fullNotifications\.slice\(0, WORKSPACE_COMPACT_NOTIFICATION_LIMIT\)/, 'Compact workspace payloads must be bounded without altering durable state.');
requirePattern('backend/src/server.js', /app\.get\('\/api\/chat\/history',[\s\S]*requireCapability\('state:read'\)[\s\S]*Math\.min\(250[\s\S]*scopedTeamChat\(readDb\(\),req\)/, 'Authenticated bounded chat-history retrieval is missing.');
requirePattern('package.json', /"verify:long-session"\s*:\s*"node scripts\/phase-19-performance-memory-long-session-check\.mjs"/, 'Phase 19 verifier is not registered.');
requirePattern('package.json', /npm run verify:persistence-restart && npm run verify:long-session && npm run verify:diagnostics && npm run verify:deployment-resume && npm run verify:fault-soak && npm run verify:certification-local-postgres && npm run verify:operator-deploy && npm run verify:frontend-runtime/, 'Phase 19 verifier is not in the normal verification chain after Phase 18.');
requirePattern('scripts/full-release-verifier-matrix.mjs', /id:'performance-memory-long-session'[\s\S]*phase-19-performance-memory-long-session-check\.mjs/, 'Phase 19 verifier is missing from the release matrix.');

if (findings.length) {
  console.error(`Phase 19 performance/memory long-session closure FAILED with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.message}`);
  process.exit(1);
}
console.log('Phase 19 performance/memory long-session closure PASS (bounded live feeds, progressive chat history, bounded browser metadata, hidden-tab timer suspension and object-URL cleanup present).');
