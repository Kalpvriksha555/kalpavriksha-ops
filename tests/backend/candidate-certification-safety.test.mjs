import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script=fs.readFileSync(new URL('../../scripts/candidate-certify-1.9.30-vps.sh',import.meta.url),'utf8');

test('candidate certification is isolated from live cutover and uses a disposable PostgreSQL clone',()=>{
  assert.match(script,/\[\[ \"\$RELEASE_ROOT\" != \"\$LIVE_ROOT\" \]\]/);
  assert.match(script,/pg_dump/i);
  assert.match(script,/pg_restore/i);
  assert.match(script,/CERT_DATABASE_URL/);
  assert.match(script,/TRUNCATE TABLE auth_sessions, auth_credentials/);
  assert.match(script,/DELETE FROM app_state WHERE key='main'/);
  assert.match(script,/DROPDB/);
  assert.doesNotMatch(script,/pm2 (?:start|restart|delete|stop)/);
  assert.doesNotMatch(script,/rsync .*\$LIVE_ROOT/);
});

test('candidate certification exercises collision allocation, idempotent replay and stale-id upload resolution',()=>{
  assert.match(script,/force an optimistic task-ID collision/);
  assert.match(script,/idempotent create replay/);
  assert.match(script,/-F \"projectId=\$REQUESTED_ID\"/);
  assert.match(script,/-F \"taskMutationId=\$MUTATION_B\"/);
  assert.match(script,/upload resolved to wrong task/);
  assert.match(script,/uploaded file was incorrectly attached to collided original task/);
});

test('candidate certification measures server-side create, upload and download latency',()=>{
  assert.match(script,/KALPA_CERT_CREATE_MAX_SECONDS/);
  assert.match(script,/KALPA_CERT_UPLOAD_MAX_SECONDS/);
  assert.match(script,/KALPA_CERT_DOWNLOAD_MAX_SECONDS/);
  assert.match(script,/4 MiB source upload/);
  assert.match(script,/4 MiB file download/);
});


test('candidate certification uses a configurable temporary PostgreSQL boundary and fail-safe cleanup',()=>{
  assert.match(script,/KALPA_CERT_PG_HOST/);
  assert.match(script,/KALPA_CERT_PG_PORT/);
  assert.match(script,/KALPA_CERT_DB_TCP_HOST/);
  assert.match(script,/git -c core\.fileMode=false status --porcelain --untracked-files=no/);
  assert.match(script,/SNAPSHOT_DIR=.*\/var\/tmp\/kalpavriksha-candidate-snapshot/);
  assert.match(script,/chown postgres:postgres "\$DUMP_FILE"/);
  assert.match(script,/chmod 0600 "\$DUMP_FILE"/);
  assert.match(script,/runuser -u postgres -- "\$PG_RESTORE" -h "\$CERT_PG_HOST" -p "\$CERT_PG_PORT"/);
  assert.match(script,/PGPASSWORD="\$CERT_DB_PASSWORD" "\$PSQL" -h "\$CERT_DB_TCP_HOST"/);
  assert.match(script,/trap cleanup_runtime EXIT/);
  assert.doesNotMatch(script,/trap cleanup_runtime EXIT INT TERM ERR/);
});
