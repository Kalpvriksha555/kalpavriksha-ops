import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rootPackage = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const backendPackage = JSON.parse(fs.readFileSync(new URL('../../backend/package.json', import.meta.url), 'utf8'));
const frontendPackage = JSON.parse(fs.readFileSync(new URL('../../frontend/package.json', import.meta.url), 'utf8'));
const deploy = fs.readFileSync(new URL('../../scripts/deploy-1.9.30-vps.sh', import.meta.url), 'utf8');
const launcher = fs.readFileSync(new URL('../../scripts/launch-deploy-1.9.30-vps.sh', import.meta.url), 'utf8');
const orchestrator = fs.readFileSync(new URL('../../scripts/certify-and-deploy-1.9.30-vps.sh', import.meta.url), 'utf8');

test('1.9.30 is the only current production deployment entrypoint', () => {
  assert.equal(rootPackage.version, '1.9.30-runtime-persistence-recovery');
  assert.equal(backendPackage.version, '2.9.30-runtime-persistence-recovery');
  assert.equal(frontendPackage.version, '2.9.30-runtime-persistence-recovery');
  assert.equal(rootPackage.scripts['deploy:vps'], 'bash scripts/launch-deploy-1.9.30-vps.sh');
  assert.match(deploy, /EXPECTED_ROOT_VERSION="1\.9\.30-runtime-persistence-recovery"/);
  assert.match(deploy, /EXPECTED_BACKEND_VERSION="2\.9\.30-runtime-persistence-recovery"/);
  assert.match(deploy, /EXPECTED_FRONTEND_VERSION="2\.9\.30-runtime-persistence-recovery"/);
});

test('current deployment remains fail-closed, rollback-capable and verification gated', () => {
  assert.match(deploy, /\[\[ "\$RELEASE_ROOT" != "\$LIVE" \]\] \|\| fail/);
  assert.match(deploy, /flock -n 8/);
  assert.match(deploy, /restore_previous_runtime/);
  assert.match(deploy, /npm ci --include=dev --ignore-scripts --no-audit --no-fund/);
  assert.match(deploy, /npm ci --prefix backend --no-audit --no-fund/);
  assert.match(deploy, /npm ci --prefix frontend --include=dev --no-audit --no-fund/);
  assert.match(deploy, /npm run verify/);
  assert.match(deploy, /npm run release:clean-install/);
  assert.match(deploy, /npm run backup:create \| tee "\$WORK\/pre-deployment-backup\.json"/);
  assert.match(deploy, /npm run db:migrate --prefix backend/);
  assert.match(deploy, /npm run db:integrity --prefix backend/);
  assert.match(deploy, /npm run release:certify/);
  assert.match(deploy, /npm run release:gate/);
  assert.match(deploy, /source-parity-clean\.mjs/);
  assert.match(deploy, /\/api\/health\/live/);
  assert.match(deploy, /\/api\/health\/ready/);
  assert.match(deploy, /post-deployment-backup/);
});

test('current launcher is SSH-independent, overlap-protected and requires exact isolated candidate certification', () => {
  assert.match(launcher, /deploy-1\.9\.30-vps\.sh/);
  assert.match(launcher, /kalpavriksha-deploy-1930/);
  assert.match(launcher, /flock -n 7/);
  assert.match(launcher, /systemd-run/);
  assert.match(launcher, /kalpavriksha-deploy-last-unit/);
  assert.match(launcher, /kalpavriksha-certified-candidate\.commit/);
  assert.match(launcher, /CERTIFIED_FOR_GUARDED_DEPLOYMENT/);
  assert.match(launcher, /wrongTaskAttachmentPrevented/);
  assert.match(launcher, /GitHub main moved after candidate certification/);
});

test('obsolete two-file runtime hotfix entrypoints are not packaged as current deployers', () => {
  assert.equal(fs.existsSync(new URL('../../scripts/deploy-runtime-persistence-hotfix-vps.sh', import.meta.url)), false);
  assert.equal(fs.existsSync(new URL('../../scripts/Run-Runtime-Persistence-Hotfix.ps1', import.meta.url)), false);
});


test('production deploy re-verifies isolated certification and preserves the certified Git identity', () => {
  assert.match(deploy, /CERTIFIED_COMMIT_FILE/);
  assert.match(deploy, /CERTIFIED_RESULT_FILE/);
  assert.match(deploy, /CERTIFIED_FOR_GUARDED_DEPLOYMENT/);
  assert.match(deploy, /wrongTaskAttachmentPrevented/);
  assert.match(deploy, /git -C "\$RELEASE_ROOT" -c core\.fileMode=false status --porcelain --untracked-files=no/);
  assert.match(deploy, /Preserving the exact certified GitHub commit as the immutable release identity/);
  assert.doesNotMatch(deploy, /rm -rf "\$RELEASE_ROOT\/\.git"/);
  assert.doesNotMatch(deploy, /git -C "\$RELEASE_ROOT" init/);
});

test('launcher invokes deployment through bash and does not depend on executable file mode', () => {
  assert.match(launcher, /\[\[ -f "\$DEPLOY_SCRIPT" \]\]/);
  assert.match(launcher, /bash -n "\$DEPLOY_SCRIPT"/);
  assert.match(launcher, /\/bin\/bash "\$DEPLOY_SCRIPT"/);
  assert.doesNotMatch(launcher, /\[\[ -x "\$DEPLOY_SCRIPT" \]\]/);
});

test('final orchestration certifies first, removes temporary PostgreSQL, then monitors guarded deployment', () => {
  assert.match(orchestrator, /KALPA_TEMP_PG_PORT:-55432/);
  assert.match(orchestrator, /Database restore\/auth preflight: PASS/);
  assert.match(orchestrator, /bash scripts\/candidate-certify-1\.9\.30-vps\.sh/);
  assert.match(orchestrator, /stop_temp_postgres/);
  assert.match(orchestrator, /bash scripts\/launch-deploy-1\.9\.30-vps\.sh/);
  assert.match(orchestrator, /systemctl show "\$DEPLOY_UNIT" -p Result/);
  assert.match(orchestrator, /PM2 is not running permanent live backend script/);
  assert.match(orchestrator, /Public API health endpoint did not become reachable/);
  assert.match(orchestrator, /Public frontend did not become reachable within five minutes/);
});

test('integrated PostgreSQL preflight is independent of root-created directory traversal by the postgres OS user', () => {
  assert.match(orchestrator,/"\$PG_RESTORE" -U postgres -h "\$PGSOCKET" -p "\$LOCAL_PG_PORT"/);
  assert.match(orchestrator,/"\$PSQL" -U postgres -h "\$PGSOCKET" -p "\$LOCAL_PG_PORT"/);
  assert.match(orchestrator,/"\$CREATEDB" -U postgres -h "\$PGSOCKET" -p "\$LOCAL_PG_PORT"/);
  assert.match(orchestrator,/"\$DROPDB" -U postgres -h "\$PGSOCKET" -p "\$LOCAL_PG_PORT"/);
  assert.doesNotMatch(orchestrator,/runuser -u postgres -- "\$PG_RESTORE"/);
  assert.doesNotMatch(orchestrator,/chown postgres:postgres "\$PREFLIGHT_DUMP"/);
  assert.match(orchestrator,/Only initdb\/pg_ctl run as OS user postgres/);
});

test('Linux postgres identity is used only for temporary server process ownership, never for dump file access', () => {
  const runuserLines = orchestrator.split('\n').filter(line => line.includes('runuser -u postgres --'));
  assert.ok(runuserLines.length >= 2);
  for (const line of runuserLines) assert.match(line,/\$INITDB|\$PG_CTL/);
  const candidate = fs.readFileSync(new URL('../../scripts/candidate-certify-1.9.30-vps.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(candidate,/runuser -u postgres --/);
});


test('integrated PostgreSQL preflight mirrors the real data-only restore ownership model', () => {
  assert.match(orchestrator,/PGPASSWORD="\$PREFLIGHT_PASSWORD" "\$PSQL" -h 127\.0\.0\.1 .* -U "\$PREFLIGHT_ROLE" -d "\$PREFLIGHT_DB2" .*CREATE TABLE cert_restore_probe/);
  assert.match(orchestrator,/"\$PG_DUMP" .*--data-only .*--table=public\.cert_restore_probe/);
  assert.match(orchestrator,/"\$PG_RESTORE" .*--data-only .*--disable-triggers .*--exit-on-error/);
  assert.match(orchestrator,/SELECT tableowner FROM pg_catalog.pg_tables/);
  assert.match(orchestrator,/Preflight destination table ownership changed during data-only restore/);
  assert.match(orchestrator,/SELECT value FROM cert_restore_probe WHERE id=1/);
});

test('runtime state normalization preserves the verified physical shadow across cold load and reload', () => {
  const repository = fs.readFileSync(new URL('../../backend/src/repositories/postgresStateRepository.js', import.meta.url), 'utf8');
  assert.match(repository, /export function normalizeRuntimeStateFromPersistedState/);
  assert.match(repository, /normalizeRuntimeStateFromPersistedState\(currentPersistedState, normalizeState\)/);
  assert.ok((repository.match(/normalizeRuntimeStateFromPersistedState\(persistedState, normalizeState\)/g) || []).length >= 2);
  assert.doesNotMatch(repository, /const state = normalizeState\(persistedState\)/);
  assert.doesNotMatch(repository, /const currentState = normalizeState\(currentPersistedState\)/);
});

test('integrated certification mirrors the production ICU locale instead of using C collation', () => {
  assert.match(orchestrator, /datlocprovider/);
  assert.match(orchestrator, /--locale-provider=icu/);
  assert.match(orchestrator, /--icu-locale="\$PROD_LOCALE"/);
  assert.match(orchestrator, /Temporary PostgreSQL locale does not match production/);
  assert.match(orchestrator, /Disposable DB locale inheritance: PASS/);
  assert.doesNotMatch(orchestrator, /--no-locale/);
});
