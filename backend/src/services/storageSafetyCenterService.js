import fs from 'node:fs';
import path from 'node:path';

const GIB = 1024 ** 3;
const ID = /^kv-\d{8}T\d{6}Z-[a-f0-9]{8}$/;
const permittedComponents = {
  FULL: [['database', '.postgres.dump'], ['files', '.files.tar.gz']],
  DATABASE: [['database', '.postgres.dump']]
};
function regular(p) {
  try {
    const s = fs.lstatSync(p);
    return s.isFile() && !s.isSymbolicLink() && s.nlink === 1 ? s : null;
  } catch { return null; }
}
function verified(root, name, m) {
  if (!m || !ID.test(String(m.id || '')) || name !== m.id + '.manifest.json' ||
      m.status !== 'VERIFIED' || m.ok !== true || m.verification?.ok !== true) return false;
  const expected = permittedComponents[m.backupType];
  if (!expected || Object.keys(m.components || {}).length !== expected.length) return false;
  return expected.every(([key, suffix]) => {
    const c = m.components[key];
    if (!c || c.file !== m.id + suffix || !/^[a-f0-9]{64}$/.test(String(c.sha256 || ''))) return false;
    const st = regular(path.join(root, c.file));
    return !!st && st.size > 0 && st.size === Number(c.sizeBytes);
  });
}
function recent(entries) {
  return [...entries].sort((a,b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0] || null;
}
function hours(value, now) {
  const stamp = Date.parse(value || '');
  return Number.isFinite(stamp) && stamp <= now ? Math.round((now - stamp) / 360000) / 10 : null;
}
export function inspectStorageSafety({
  root = '/var/backups/kalpavriksha',
  device = '/',
  recoveryDir = '/var/lib/kalpavriksha/recovery-drills',
  now = Date.now(),
  env = process.env
} = {}) {
  const stat = fs.statfsSync(device);
  const freeBytes = stat.bavail * stat.bsize, totalBytes = stat.blocks * stat.bsize;
  const usedPercent = totalBytes ? Math.round(1000 * (stat.blocks - stat.bfree) / stat.blocks) / 10 : 100;
  const attempts = [], good = [];
  let partials = 0, partialBytes = 0;
  const safeRoot = fs.existsSync(root) && fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink();
  if (safeRoot) {
    for (const e of fs.readdirSync(root, {withFileTypes:true})) {
      if (!e.isFile() || !regular(path.join(root,e.name))) continue;
      if (e.name.endsWith('.manifest.json')) {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(root,e.name),'utf8'));
          if (!ID.test(String(m.id || '')) || e.name !== m.id + '.manifest.json') continue;
          const item = {id:m.id, type:m.backupType, createdAt:m.createdAt, status:m.status};
          attempts.push(item);
          if (verified(root,e.name,m)) good.push(item);
        } catch { /* malformed manifests never count as verified */ }
      } else if (/^kv-\d{8}T\d{6}Z-[a-f0-9]{8}\.(?:postgres\.dump|files\.tar\.gz)\.partial$/.test(e.name)) {
        const st = regular(path.join(root,e.name));
        if (st && now-st.mtimeMs > 48*3600000) {partials++;partialBytes+=st.size;}
      }
    }
  }
  const full = good.filter(i=>i.type==='FULL'), db = good.filter(i=>i.type==='DATABASE');
  const latestFull = recent(full), latestDatabase = recent(db);
  const latestFullAttempt = recent(attempts.filter(i=>i.type==='FULL'));
  const latestDatabaseAttempt = recent(attempts.filter(i=>i.type==='DATABASE'));
  const fullAge = hours(latestFull?.createdAt,now), dbAge = hours(latestDatabase?.createdAt,now);
  const alerts = [];
  const add = (id,severity,title,message)=>alerts.push({id,severity,title,message});
  if (usedPercent >= 90 || freeBytes < 2*GIB) add('DISK_CRITICAL','critical','Storage critically low','Investigate storage immediately. No customer-data deletion will be attempted.');
  else if (usedPercent >= 80 || freeBytes < 12*GIB) add('DISK_PRESSURE','warning','Storage running low','Review disk usage and maintain the protected free-space reserve.');
  if (fullAge === null || fullAge > 26) add('FULL_BACKUP_STALE','critical','Verified full backup overdue','Request a new full backup after reviewing the available space.');
  if (latestFullAttempt?.status==='FAILED' && (!latestFull || latestFullAttempt.createdAt > latestFull.createdAt)) add('FULL_BACKUP_FAILED','critical','Latest full backup failed','Review the failed backup service before retrying.');
  if (dbAge === null || dbAge > 8) add('DATABASE_BACKUP_STALE','warning','Database-only backup overdue','Check the six-hour database-backup service.');
  if (latestDatabaseAttempt?.status==='FAILED' && (!latestDatabase || latestDatabaseAttempt.createdAt > latestDatabase.createdAt)) add('DATABASE_BACKUP_FAILED','warning','Latest database backup failed','Review the failed database-backup service.');
  if (partials) add('OLD_PARTIAL_EXPORTS','info','Abandoned partial backups detected','Historical partial exports are preserved and are not automatically deleted.');
  let lastRestore = null;
  try {
    const reports = [];
    for (const entry of fs.readdirSync(recoveryDir)) {
      if (!/^kv-\d{8}T\d{6}Z-[a-f0-9]{8}-\d{8}T\d{6}Z\.json$/.test(entry)) continue;
      const p = path.join(recoveryDir,entry);
      if (!regular(p)) continue;
      const r = JSON.parse(fs.readFileSync(p,'utf8'));
      if (r.ok===true && r.status==='ISOLATED_APPLICATION_RESTORE_PASSED')
        reports.push({completedAt:r.completedAt || '', backupId:r.backupId || r.manifestId || ''});
    }
    lastRestore=reports.sort((a,b)=>Date.parse(b.completedAt)-Date.parse(a.completedAt))[0] || null;
  } catch {}
  return {
    ok:true,checkedAt:new Date(now).toISOString(),
    disk:{usedPercent,freeGiB:Math.round(freeBytes/GIB*10)/10,freeBytes,totalBytes},
    backup:{verifiedFullCount:full.length,verifiedDatabaseCount:db.length,
      latestFull,latestDatabase,latestFullAgeHours:fullAge,latestDatabaseAgeHours:dbAge,
      lastFullAttempt:latestFullAttempt,lastDatabaseAttempt:latestDatabaseAttempt,
      rotationEnabled:env.KALPA_AUTO_BACKUP_ROTATION==='true',
      pinnedBackupSet:!!env.KALPA_BACKUP_PINNED_ID,
      stalePartialCount:partials,stalePartialBytes:partialBytes},
    restore:{lastPassed:lastRestore,applicationOnly:true},
    notificationDelivery:'portal-only',alerts,
    warningCount:alerts.filter(a=>a.severity!=='info').length,
    criticalCount:alerts.filter(a=>a.severity==='critical').length
  };
}
