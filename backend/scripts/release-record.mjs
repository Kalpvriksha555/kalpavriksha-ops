import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { verifyReleaseCertificate } from '../src/services/releaseCertificationService.js';
import { runRelationalMigrations } from '../src/repositories/postgresStateRepository.js';

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const certificatePath = path.resolve(process.env.RELEASE_CERTIFICATE_PATH || '../release-certification.json');
if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) throw new Error('DATABASE_URL must be PostgreSQL.');
const certificate = JSON.parse(fs.readFileSync(certificatePath, 'utf8'));
const requireBackup = String(process.env.RELEASE_REQUIRE_BACKUP || (String(process.env.NODE_ENV || '').toLowerCase() === 'production')).toLowerCase() === 'true';
const verification = verifyReleaseCertificate(certificate, { requireCleanInstall: true, requireBackup });
if (!verification.ok) throw new Error(`Release certificate is invalid: ${verification.failures.join(' ')}`);
const pool = new pg.Pool({ connectionString: databaseUrl, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined, connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000) });
try {
  await runRelationalMigrations(pool);
  await pool.query(
    `INSERT INTO release_certifications(id,app_version,git_commit,status,source_hash,certificate_hash,report,created_at,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,certificate_hash=EXCLUDED.certificate_hash,report=EXCLUDED.report,expires_at=EXCLUDED.expires_at`,
    [certificate.id,certificate.appVersion,certificate.gitCommit || '',certificate.status,certificate.sourceHash,certificate.certificateHash,JSON.stringify(certificate),certificate.createdAt,certificate.expiresAt]
  );
  console.log(JSON.stringify({ ok:true, recorded:true, certificateId:certificate.id }, null, 2));
} finally {
  await pool.end().catch(() => {});
}
