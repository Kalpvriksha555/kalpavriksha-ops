import 'dotenv/config';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import pg from 'pg';
import { latestManifest, verifyManifest } from './backup-lib.mjs';
import {
  auditRelationalIntegrityMetadata,
  canonicalizeCurrentPhysicalIntegrity
} from '../src/repositories/postgresStateRepository.js';

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const confirmation = String(process.env.KALPA_CURRENT_PHYSICAL_CANONICALIZE_CONFIRM || '').trim();
const frozenConfirmation = String(process.env.KALPA_BACKEND_FROZEN_CONFIRM || '').trim();
const backupRoot = String(process.env.KALPA_BACKUP_ROOT || '').trim();
const expectedStateVersionRaw = String(process.env.KALPA_EXPECTED_STATE_VERSION || '').trim();
const maxBackupAgeMinutes = Math.max(5, Number(process.env.KALPA_INTEGRITY_REPAIR_BACKUP_MAX_AGE_MINUTES || 180));
const port = Number(process.env.PORT || 8080);
const preflightOnly = String(process.env.KALPA_CANONICALIZE_PREFLIGHT_ONLY || '').trim().toLowerCase() === 'true';

if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) throw new Error('DATABASE_URL must point to PostgreSQL.');
if (confirmation !== 'CANONICALIZE VERIFIED CURRENT PHYSICAL RELATIONAL STATE') {
  throw new Error('Set KALPA_CURRENT_PHYSICAL_CANONICALIZE_CONFIRM="CANONICALIZE VERIFIED CURRENT PHYSICAL RELATIONAL STATE".');
}
if (!preflightOnly && frozenConfirmation !== 'BACKEND WRITES ARE STOPPED') {
  throw new Error('Set KALPA_BACKEND_FROZEN_CONFIRM="BACKEND WRITES ARE STOPPED" only after PM2 is stopped.');
}
if (!backupRoot) throw new Error('KALPA_BACKUP_ROOT is required.');

function assertBackendPortClosed() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host:'127.0.0.1', port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve();
    }, 1500);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      reject(new Error(`Backend port ${port} is still accepting connections. Stop application writes before canonicalization.`));
    });
    socket.once('error', error => {
      clearTimeout(timeout);
      socket.destroy();
      if (['ECONNREFUSED','EHOSTUNREACH','ENETUNREACH'].includes(error?.code)) resolve();
      else reject(error);
    });
  });
}

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

const expectedStateVersion = expectedStateVersionRaw ? Number(expectedStateVersionRaw) : null;
if (expectedStateVersionRaw && (!Number.isInteger(expectedStateVersion) || expectedStateVersion < 1)) {
  throw new Error('KALPA_EXPECTED_STATE_VERSION must be a positive integer.');
}

if (preflightOnly) {
  console.log(JSON.stringify({
    ok:true,
    preflightOnly:true,
    backup:{ manifestPath, ageMinutes:Number(ageMinutes.toFixed(2)) }
  }, null, 2));
  process.exit(0);
}

await assertBackendPortClosed();

const pool = new pg.Pool({
  connectionString:databaseUrl,
  ssl:process.env.DB_SSL === 'true' ? { rejectUnauthorized:false } : undefined,
  connectionTimeoutMillis:Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  query_timeout:Number(process.env.DB_QUERY_TIMEOUT_MS || 180000)
});

try {
  const before = await auditRelationalIntegrityMetadata(pool);
  if (before.countMismatches.length) {
    const error = new Error(`Current physical canonicalization refused because metadata and PostgreSQL counts differ: ${before.countMismatches.join(', ')}.`);
    error.code = 'RELATIONAL_METADATA_COUNT_MISMATCH';
    error.details = before;
    throw error;
  }

  const action = await canonicalizeCurrentPhysicalIntegrity(pool, {
    actor:'incremental-deployment-current-physical-canonicalizer',
    backupManifest:manifestPath,
    expectedStateVersion:expectedStateVersion ?? before.stateVersion
  });
  const after = await auditRelationalIntegrityMetadata(pool);
  if (!after.healthy) {
    const error = new Error('Post-canonicalization relational integrity is not healthy.');
    error.code = 'POST_CANONICALIZATION_INTEGRITY_FAILURE';
    error.details = after;
    throw error;
  }

  console.log(JSON.stringify({
    ok:true,
    backup:{ manifestPath, ageMinutes:Number(ageMinutes.toFixed(2)) },
    before,
    action,
    after
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok:false, code:error.code || '', error:error.message, details:error.details }, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
