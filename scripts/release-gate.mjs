import fs from 'node:fs';
import path from 'node:path';
import { readAndVerifyReleaseCertificate, sourceTreeHash, validateProductionEnvironment } from '../backend/src/services/releaseCertificationService.js';
import { inspectBackupManifests } from '../backend/src/services/operationalReliabilityService.js';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const certificatePath = path.resolve(process.env.RELEASE_CERTIFICATE_PATH || 'release-certification.json');
const source = sourceTreeHash(root);
const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const requireBackup = String(process.env.RELEASE_REQUIRE_BACKUP || production).toLowerCase() === 'true';
const certificate = readAndVerifyReleaseCertificate(certificatePath, {
  expectedAppVersion: pkg.version,
  expectedSourceHash: source.hash,
  maxAgeHours: Number(process.env.RELEASE_CERTIFICATE_MAX_AGE_HOURS || 24),
  requireCleanInstall: true,
  requireBackup
});
const environment = production ? validateProductionEnvironment(process.env) : { ok: true, checks: [], errors: [] };
let backups = { ok: true, status: 'NOT_REQUIRED' };
if (requireBackup) {
  backups = inspectBackupManifests(String(process.env.KALPA_BACKUP_ROOT || ''), { maxAgeHours: Number(process.env.BACKUP_MAX_AGE_HOURS || 26) });
}
const ok = certificate.ok && environment.ok && backups.ok;
console.log(JSON.stringify({ ok, status: ok ? 'DEPLOYMENT_ALLOWED' : 'DEPLOYMENT_BLOCKED', certificate, environment, backups: { ok: backups.ok, status: backups.status, ageHours: backups.ageHours, latest: backups.latest?.id || '' } }, null, 2));
if (!ok) process.exitCode = 1;
