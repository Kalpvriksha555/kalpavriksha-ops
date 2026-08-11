#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const json = relative => JSON.parse(read(relative));

const pkg = json('package.json');
const backendPkg = json('backend/package.json');
const frontendPkg = json('frontend/package.json');
const orchestrator = read('scripts/certify-and-deploy-1.9.30-vps.sh');
const candidate = read('scripts/candidate-certify-1.9.30-vps.sh');
const deploy = read('scripts/deploy-1.9.30-vps.sh');
const entrypointTest = read('tests/backend/current-release-deployment-entrypoint.test.mjs');

assert.equal(pkg.version, '1.9.30-ssh-independent-certify-deploy-closure');
assert.equal(backendPkg.version, '2.9.30-ssh-independent-certify-deploy-closure');
assert.equal(frontendPkg.version, '2.9.30-ssh-independent-certify-deploy-closure');
assert.equal(pkg.scripts['verify:certification-local-postgres'], 'node scripts/phase-23-production-local-postgres-certification-check.mjs');
assert.match(pkg.scripts.verify, /verify:fault-soak && npm run verify:certification-local-postgres && npm run verify:operator-deploy && npm run verify:frontend-runtime/);

assert.match(orchestrator, /PROD_HOST/);
assert.match(orchestrator, /localhost\|127\.0\.0\.1\|::1/);
assert.doesNotMatch(orchestrator, /Production PostgreSQL is local; refusing isolated local clone provisioning/);
assert.match(orchestrator, /Temporary PostgreSQL port \$LOCAL_PG_PORT matches the local production PostgreSQL port/);
assert.match(orchestrator, /temporary cluster uses a separate data root, socket directory and port/);
assert.match(orchestrator, /PGROOT="\/var\/tmp\/kalpavriksha-final-pg-\$\{STAMP\}"/);
assert.match(orchestrator, /PGSOCKET="\$PGROOT\/socket"/);
assert.match(orchestrator, /KALPA_TEMP_PG_PORT:-55432/);
assert.match(orchestrator, /ss -ltnH/);
assert.match(orchestrator, /Temporary PostgreSQL port \$LOCAL_PG_PORT is occupied/);
assert.match(orchestrator, /PG_DUMP/);
assert.match(orchestrator, /PROD_DATABASE_URL/);
assert.match(orchestrator, /Temporary PostgreSQL locale does not match production/);
assert.match(orchestrator, /stop_temp_postgres/);

for (const script of [candidate, deploy]) {
  assert.match(script, /1\.9\.30-ssh-independent-certify-deploy-closure|2\.9\.30-ssh-independent-certify-deploy-closure/);
}
assert.match(entrypointTest, /ssh-independent-certify-deploy-closure/);

console.log('Phase 23 production-local PostgreSQL certification closure PASS (local production PostgreSQL is supported on a distinct temporary port/data/socket, collision remains fail-closed, and exact current release versions are wired through certification/deployment).');
