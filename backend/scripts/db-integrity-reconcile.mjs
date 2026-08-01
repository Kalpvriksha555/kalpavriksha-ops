import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { latestManifest, verifyManifest } from './backup-lib.mjs';
import {
  auditRelationalIntegrityMetadata,
  reconcileRelationalIntegrityMetadata,
  runRelationalMigrations
} from '../src/repositories/postgresStateRepository.js';

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const confirmation = String(process.env.KALPA_INTEGRITY_RECONCILE_CONFIRM || '').trim();
const backupRoot = String(process.env.KALPA_BACKUP_ROOT || '').trim();
const allowedCollections = String(process.env.KALPA_INTEGRITY_RECONCILE_COLLECTIONS || 'files,performanceRecords')
  .split(',').map(value => value.trim()).filter(Boolean);
const maxBackupAgeMinutes = Math.max(5, Number(process.env.KALPA_INTEGRITY_RECONCILE_BACKUP_MAX_AGE_MINUTES || 180));

if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
  console.error(JSON.stringify({ ok:false, code:'DATABASE_URL_REQUIRED', error:'DATABASE_URL must contain a valid PostgreSQL connection string.' }, null, 2));
  process.exit(1);
}
if (confirmation !== 'RECONCILE COUNT METADATA ONLY') {
  console.error(JSON.stringify({ ok:false, code:'CONFIRMATION_REQUIRED', error:'Set KALPA_INTEGRITY_RECONCILE_CONFIRM="RECONCILE COUNT METADATA ONLY".' }, null, 2));
  process.exit(1);
}
if (!backupRoot) {
  console.error(JSON.stringify({ ok:false, code:'BACKUP_ROOT_REQUIRED', error:'KALPA_BACKUP_ROOT is required.' }, null, 2));
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
  const before = await auditRelationalIntegrityMetadata(pool);
  if (before.healthy) {
    console.log(JSON.stringify({ ok:true, reconciled:false, reason:'already-healthy', audit:before }, null, 2));
  } else {
    if (!before.safeCountMetadataDrift) {
      const error = new Error('Automatic reconciliation is forbidden because the stored snapshot hash does not match the physical relational state.');
      error.code = 'UNSAFE_INTEGRITY_DRIFT';
      throw error;
    }
    const manifestPath = latestManifest(backupRoot);
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      const error = new Error('No verified pre-deployment backup manifest is available.');
      error.code = 'VERIFIED_BACKUP_REQUIRED';
      throw error;
    }
    const verified = verifyManifest(manifestPath, { verifyContents:true });
    const manifest = verified.manifest || {};
    const completedAt = new Date(manifest.verifiedAt || manifest.completedAt || manifest.createdAt || 0).getTime();
    const ageMinutes = completedAt ? (Date.now() - completedAt) / 60000 : Infinity;
    const isFull = Boolean(manifest.components?.database?.file && manifest.components?.files?.file);
    if (!verified.ok || manifest.status !== 'VERIFIED' || manifest.ok !== true || !isFull || ageMinutes > maxBackupAgeMinutes) {
      const error = new Error(`The latest backup is not an eligible recent verified full backup (${path.basename(manifestPath)}; age ${Number.isFinite(ageMinutes) ? ageMinutes.toFixed(1) : 'unknown'} minutes).`);
      error.code = 'RECENT_VERIFIED_FULL_BACKUP_REQUIRED';
      error.backup = { manifestPath, ageMinutes, status:manifest.status || '', verified:verified.ok, isFull };
      throw error;
    }
    const disallowed = before.countMismatches.filter(key => !allowedCollections.includes(key));
    if (disallowed.length) {
      const error = new Error(`Count-only drift exists outside the approved collections: ${disallowed.join(', ')}.`);
      error.code = 'COUNT_DRIFT_NOT_APPROVED';
      throw error;
    }
    const result = await reconcileRelationalIntegrityMetadata(pool, {
      allowedCollections,
      actor:'deployment-integrity-reconciler',
      backupManifest:manifestPath
    });
    const after = await auditRelationalIntegrityMetadata(pool);
    if (!after.healthy) {
      const error = new Error('Post-reconciliation integrity audit is not healthy.');
      error.code = 'POST_RECONCILIATION_AUDIT_FAILED';
      error.audit = after;
      throw error;
    }
    console.log(JSON.stringify({ ok:true, ...result, backup:{ manifestPath, ageMinutes:Number(ageMinutes.toFixed(2)), verified:true }, audit:after }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok:false, code:error.code || '', error:error.message, details:error.backup || error.audit || undefined }, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
