import 'dotenv/config';
import pg from 'pg';
import { auditRelationalIntegrityMetadata, runRelationalMigrations } from '../src/repositories/postgresStateRepository.js';

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
  console.error(JSON.stringify({ ok:false, code:'DATABASE_URL_REQUIRED', error:'DATABASE_URL must contain a valid PostgreSQL connection string.' }, null, 2));
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString:databaseUrl,
  ssl:process.env.DB_SSL === 'true' ? { rejectUnauthorized:false } : undefined,
  connectionTimeoutMillis:Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  query_timeout:Number(process.env.DB_QUERY_TIMEOUT_MS || 120000)
});

try {
  await runRelationalMigrations(pool);
  const audit = await auditRelationalIntegrityMetadata(pool);
  const allowLegacy = String(process.env.KALPA_ALLOW_LEGACY_SHADOW_REBASELINE || '').trim().toLowerCase() === 'true';
  const status = audit.healthy ? 'HEALTHY' : audit.safeCountMetadataDrift ? 'SAFE_COUNT_METADATA_DRIFT' : audit.legacyShadowRebaselineSafe ? 'LEGACY_SHADOW_REBASELINE_REQUIRED' : 'UNSAFE_INTEGRITY_DRIFT';
  const ok = audit.healthy || audit.safeCountMetadataDrift || (allowLegacy && audit.legacyShadowRebaselineSafe);
  console.log(JSON.stringify({ ok, status, ...audit }, null, 2));
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok:false, status:'AUDIT_FAILED', code:error.code || '', error:error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
