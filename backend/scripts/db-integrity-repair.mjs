import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { latestManifest, verifyManifest } from './backup-lib.mjs';
import {
  auditRelationalIntegrityMetadata,
  reconcileRelationalIntegrityMetadata,
  rebaselineLegacyShadowIntegrity,
  rebaselineOperationalSameCountIntegrity,
  runRelationalMigrations
} from '../src/repositories/postgresStateRepository.js';

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const confirmation = String(process.env.KALPA_INTEGRITY_REPAIR_CONFIRM || '').trim();
const backupRoot = String(process.env.KALPA_BACKUP_ROOT || '').trim();
const maxBackupAgeMinutes = Math.max(5, Number(process.env.KALPA_INTEGRITY_REPAIR_BACKUP_MAX_AGE_MINUTES || 180));
if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) throw new Error('DATABASE_URL must point to PostgreSQL.');
if (confirmation !== 'REPAIR VERIFIED LEGACY INTEGRITY METADATA') throw new Error('Set KALPA_INTEGRITY_REPAIR_CONFIRM="REPAIR VERIFIED LEGACY INTEGRITY METADATA".');
if (!backupRoot) throw new Error('KALPA_BACKUP_ROOT is required.');

const manifestPath = latestManifest(backupRoot);
if (!manifestPath || !fs.existsSync(manifestPath)) throw new Error('A recent verified full backup is required.');
const verified = verifyManifest(manifestPath, { verifyContents:true });
const manifest = verified.manifest || {};
const verifiedAt = new Date(manifest.verifiedAt || manifest.completedAt || manifest.createdAt || 0).getTime();
const ageMinutes = verifiedAt ? (Date.now() - verifiedAt) / 60000 : Infinity;
const isFull = Boolean(manifest.components?.database?.file && manifest.components?.files?.file);
if (!verified.ok || manifest.status !== 'VERIFIED' || manifest.ok !== true || !isFull || ageMinutes > maxBackupAgeMinutes) {
  throw new Error(`Latest backup is not an eligible recent verified full backup (${path.basename(manifestPath)}).`);
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
  let action;
  if (before.healthy) action = { ok:true, action:'none', reason:'already-healthy' };
  else if (before.safeCountMetadataDrift) action = await reconcileRelationalIntegrityMetadata(pool, {
    allowedCollections:['files','performanceRecords'], actor:'deployment-integrity-repair', backupManifest:manifestPath
  });
  else if (before.legacyShadowRebaselineSafe) action = await rebaselineLegacyShadowIntegrity(pool, {
    actor:'deployment-integrity-repair', backupManifest:manifestPath
  });
  else if (before.operationalSameCountRebaselineSafe) action = await rebaselineOperationalSameCountIntegrity(pool, {
    actor:'deployment-integrity-repair', backupManifest:manifestPath
  });
  else {
    const error = new Error('Integrity repair refused because the production drift is not a recognized and evidence-bounded metadata condition.');
    error.code = 'UNSAFE_INTEGRITY_DRIFT';
    error.details = before;
    throw error;
  }
  const after = await auditRelationalIntegrityMetadata(pool);
  if (!after.healthy) throw new Error('Post-repair relational integrity is not healthy.');
  console.log(JSON.stringify({ ok:true, backup:{ manifestPath, ageMinutes:Number(ageMinutes.toFixed(2)) }, before, action, after }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok:false, code:error.code || '', error:error.message, details:error.details }, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
