import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const orchestrator = fs.readFileSync(new URL('../../scripts/certify-and-deploy-1.9.30-vps.sh', import.meta.url), 'utf8');
const rootPackage = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const backendPackage = JSON.parse(fs.readFileSync(new URL('../../backend/package.json', import.meta.url), 'utf8'));
const frontendPackage = JSON.parse(fs.readFileSync(new URL('../../frontend/package.json', import.meta.url), 'utf8'));
const matrix = fs.readFileSync(new URL('../../scripts/full-release-verifier-matrix.mjs', import.meta.url), 'utf8');

test('current release supports a local production PostgreSQL host for isolated certification', () => {
  assert.match(orchestrator, /localhost\|127\.0\.0\.1\|::1/);
  assert.doesNotMatch(orchestrator, /Production PostgreSQL is local; refusing isolated local clone provisioning/);
  assert.match(orchestrator, /Production PostgreSQL is local; certification remains isolated/);
});

test('local production certification remains fail-closed on temporary port collision', () => {
  assert.match(orchestrator, /\[\[ "\$PROD_PORT" != "\$LOCAL_PG_PORT" \]\]/);
  assert.match(orchestrator, /Temporary PostgreSQL port \$LOCAL_PG_PORT matches the local production PostgreSQL port/);
  assert.match(orchestrator, /Temporary PostgreSQL port \$LOCAL_PG_PORT is occupied/);
});

test('disposable certification PostgreSQL retains separate data root socket and port', () => {
  assert.match(orchestrator, /PGROOT="\/var\/tmp\/kalpavriksha-final-pg-\$\{STAMP\}"/);
  assert.match(orchestrator, /PGDATA="\$PGROOT\/data"/);
  assert.match(orchestrator, /PGSOCKET="\$PGROOT\/socket"/);
  assert.match(orchestrator, /KALPA_TEMP_PG_PORT:-55432/);
  assert.match(orchestrator, /listen_addresses = '127\.0\.0\.1'/);
  assert.match(orchestrator, /stop_temp_postgres/);
});

test('Phase 23 current versions and permanent release gate are wired through the candidate', () => {
  assert.equal(rootPackage.version, '1.9.30-ssh-independent-certify-deploy-closure');
  assert.equal(backendPackage.version, '2.9.30-ssh-independent-certify-deploy-closure');
  assert.equal(frontendPackage.version, '2.9.30-ssh-independent-certify-deploy-closure');
  assert.equal(rootPackage.scripts['verify:certification-local-postgres'], 'node scripts/phase-23-production-local-postgres-certification-check.mjs');
  assert.match(matrix, /production-local-postgres-certification/);
});
