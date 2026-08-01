import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../../backend/src/repositories/postgresStateRepository.js', import.meta.url), 'utf8');
const security = fs.readFileSync(new URL('../../backend/src/middleware/security.js', import.meta.url), 'utf8');

test('browser sessions are session cookies and boot can revoke a stale page session', () => {
  const cookieStart = server.indexOf('function setSessionCookie');
  const cookieEnd = server.indexOf('function clearSessionCookie', cookieStart);
  const cookieBlock = server.slice(cookieStart, cookieEnd);
  assert.match(cookieBlock, /httpOnly:\s*true/);
  assert.doesNotMatch(cookieBlock, /maxAge|expires:/);
  assert.match(server, /app\.post\('\/api\/auth\/clear-browser-session'/);
  assert.match(server, /revokeAuthSession\(tokenHash\(rawToken\)\)/);
  assert.match(server, /routePath === '\/auth\/clear-browser-session'/);
});

test('a correct password clears an automatic failed-attempt lock but not account restriction', () => {
  const start = server.indexOf("app.post('/api/auth/login'");
  const end = server.indexOf("app.get('/api/auth/session'", start);
  const login = server.slice(start, end);
  assert.ok(login.indexOf('await verifyPassword') < login.indexOf("eventType: 'LOGIN_BLOCKED_RESTRICTED'"));
  assert.match(login, /if \(lockedUntil > Date\.now\(\)\) \{[\s\S]*clearLoginFailures\(credential\)[\s\S]*LOGIN_UNLOCKED_WITH_VALID_PASSWORD/);
  assert.match(login, /ACCOUNT_RESTRICTED/);
});

test('state hydration uses a compact read-only snapshot and cached performance bundle', () => {
  assert.match(server, /function readDb\(\)/);
  assert.match(server, /const d = readDb\(\);\s*const scoped = scopedState\(d, req, \{ compact:queryFlag/s);
  assert.match(server, /function sanitizeCasesForRole/);
  assert.match(server, /function getPerformanceBundle/);
  assert.match(server, /performanceBundleCache\.revision === performanceDataRevision/);
  assert.match(server, /metadataAffectsPerformance/);
  assert.doesNotMatch(server, /sanitize\(\{ \.\.\.d, cases:visibleCases \}, role\)/);
});

test('partial relational writes use the version-matched persisted shadow instead of rereading every table', () => {
  assert.match(server, /relationalShadowState = structuredClone\(loaded\.persistedState \|\| loaded\.state\)/);
  assert.match(server, /persistedBaseState: relationalShadowState/);
  assert.match(repository, /persistedBaseState \? decomposeState\(persistedBaseState\) : await readRelationalParts\(client\)/);
  assert.match(repository, /committedState,/);
  assert.match(repository, /committedStateOwned: Boolean\(fastSelectedWrite\)/);
  assert.match(repository, /revisionSnapshotWritten:shouldWriteRevisionSnapshot/);
});

test('rate limiter periodically removes expired identities', () => {
  assert.match(security, /sweepExpiredRateLimits/);
  assert.match(security, /stores\.delete\(key\)/);
});


test('designer performance comparison uses a dedicated aggregate leaderboard without exposing peer cases', () => {
  assert.match(server, /app\.get\('\/api\/performance\/leaderboard', requireCapability\('performance:read'\)/);
  assert.match(server, /function buildTeamLeaderboard/);
  assert.match(server, /members[\s\S]*assignedCount[\s\S]*completedCount[\s\S]*productivityScore/);
  const leaderboardStart = server.indexOf('function buildTeamLeaderboard');
  const leaderboardEnd = server.indexOf('function chatReadKey', leaderboardStart);
  const leaderboardBlock = server.slice(leaderboardStart, leaderboardEnd);
  assert.doesNotMatch(leaderboardBlock, /customerName|documents|completedFiles|sourceFiles/);
});

test('adaptive state reads return unchanged or presence-only payloads without rebuilding the full workspace', () => {
  assert.match(server, /function stateSyncDescriptor/);
  assert.match(server, /dataRevision:Number\(workspaceDataRevision/);
  assert.match(server, /if \(sameWorkspaceData && hasPresence\)/);
  assert.match(server, /unchanged:true/);
  assert.match(server, /partial:'presence'/);
  assert.match(server, /function markWorkspaceCollectionsChanged/);
  assert.match(server, /function workspaceCollectionsFromMetadata/);
  assert.match(server, /reason\.startsWith\('presence_'\)/);
});

test('leaderboard keeps historical aggregates cached while live presence stays fresh', () => {
  assert.match(server, /let leaderboardAggregateCache = new Map\(\)/);
  assert.match(server, /function leaderboardAggregateStats/);
  assert.match(server, /const cacheKey = `\$\{performanceDataRevision\}:\$\{config\.key\}:\$\{todayKey\}`/);
  assert.match(server, /function buildTeamLeaderboard[\s\S]*presenceById[\s\S]*availability:presence\.availability/);
  assert.match(server, /leaderboardAggregateCache\.clear\(\)/);
  assert.match(server, /return !reason\.startsWith\('presence_'\)/);
});

test('leaderboard case counts resolve assignee ids as well as display names', () => {
  const start = server.indexOf('function leaderboardAggregateStats');
  const end = server.indexOf('function buildTeamLeaderboard', start);
  const block = server.slice(start, end);
  assert.match(block, /userKeyById/);
  assert.match(block, /record\.assigneeId/);
  assert.match(block, /canonicalOwner/);
});


test('performance leaderboard supports exact calendar months, overall scope, and reversible admin baselines', () => {
  assert.match(server, /function performanceScopeConfig/);
  assert.match(server, /scope:'month'/);
  assert.match(server, /scope:'overall'/);
  assert.match(server, /serverMonthKey\(timestamp\) === config\.month/);
  assert.match(server, /app\.patch\('\/api\/performance\/baseline\/:id', requireAdminSession/);
  assert.match(server, /scoreBaselineMonth/);
  assert.match(server, /Full performance score history restored/);
  assert.match(server, /\['Manager','Designer'\]\.includes\(targetRole\)/);
  assert.match(server, /PERFORMANCE_ROLE_NOT_ELIGIBLE/);
  assert.match(server, /collections:\['users','audit'\]/);
});

test('monthly performance excludes ambiguous updatedAt-only completion dates', () => {
  assert.match(server, /completionEventAt:completionEventAt\|\|0/);
  assert.match(server, /if \(config\.scope === 'month'\) return explicit/);
  assert.match(server, /performanceCaseCompletedAt/);
  assert.doesNotMatch(server.slice(server.indexOf('function performanceCaseCompletedAt'), server.indexOf('function performanceCaseRevisionAt')), /updatedAt/);
});

test('collection-aware workspace sync does not resend cases for chat-only changes', () => {
  assert.match(server, /const WORKSPACE_SYNC_COLLECTIONS/);
  assert.match(server, /function scopedStateCollections/);
  assert.match(server, /parseClientCollectionRevisions/);
  assert.match(server, /partial:'workspace'/);
  assert.match(server, /changedCollections/);
  assert.match(server, /workspaceCollectionRevisions/);
});

test('routine selective writes avoid rebuilding every performance record and file link', () => {
  assert.match(server, /function normalizeStateForSelectiveSave/);
  assert.match(server, /if \(!collections\) return norm\(d\)/);
  assert.match(server, /Performance records are derived from cases at read time/);
  const saveStart = server.indexOf('function save(d, metadata = {})');
  const saveEnd = server.indexOf('function updatePresencePersistedGeneration', saveStart);
  const saveBlock = server.slice(saveStart, saveEnd);
  assert.match(saveBlock, /normalizeStateForSelectiveSave\(latestPresence\.state, effectiveMetadata\)/);
  assert.doesNotMatch(saveBlock, /const normalized = norm\(latestPresence\.state\)/);
});

test('case creation has a single generated primary id', () => {
  const start = server.indexOf("app.post('/api/cases'");
  const end = server.indexOf("app.post('/api/cases/:id/assign'", start);
  const block = server.slice(start, end);
  assert.equal((block.match(/\bid:nanoid\(8\)/g) || []).length, 1);
});

test('presence merged into a foreground write does not masquerade as a user-profile change', () => {
  assert.match(server, /requestedCollections:requestedCollections \? \[\.\.\.requestedCollections\] : null/);
  assert.match(server, /const sourceCollections = Array\.isArray\(metadata\.requestedCollections\) \? metadata\.requestedCollections : metadata\.collections/);
  assert.match(server, /const explicitlyChangesUsers = !Array\.isArray\(metadata\.requestedCollections\) \|\| metadata\.requestedCollections\.includes\('users'\)/);
});
