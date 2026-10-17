import test from 'node:test';
import assert from 'node:assert/strict';
import {projectedBackupBytes,checkBackupHeadroom} from '../../backend/scripts/backup-space-guard.mjs';

const GiB=1024**3;
test('backup estimate reserves disk headroom plus full file snapshot and archive',()=>{
  const required=projectedBackupBytes({storageBytes:4*GiB,previousDatabaseBytes:0.4*GiB,reserveGiB:6});
  assert.ok(required>14*GiB);
  assert.ok(required<17*GiB);
});
test('database-only backups omit private file snapshot estimate',()=>{
  const dbOnly=projectedBackupBytes({storageBytes:10*GiB,databaseOnly:true});
  const full=projectedBackupBytes({storageBytes:10*GiB});
  assert.ok(dbOnly<full);
});
test('refuse a backup preflight when estimated free space is unsafe',()=>{
  assert.throws(()=>checkBackupHeadroom({backupRoot:'/tmp',databaseOnly:true,availableBytes:2*GiB}),/BACKUP_SPACE_GUARD/);
});
test('preflight never authorizes cleanup by reducing the reserve',()=>{
  assert.ok(projectedBackupBytes({reserveGiB:0,databaseOnly:true}) >= 4*GiB);
});

test('disk headroom guard runs under backup lock and its failure reaches finally cleanup',async()=>{
  const fs=await import('node:fs');
  const code=fs.readFileSync(new URL('../../backend/scripts/backup-create.mjs',import.meta.url),'utf8');
  const exclusive=code.indexOf("fs.openSync(lockPath,'wx'");
  const preflight=code.indexOf('if (!dryRun) checkBackupHeadroom(');
  const cleanup=code.indexOf('}finally{',preflight);
  assert.ok(exclusive>=0&&preflight>exclusive&&cleanup>preflight);
  assert.match(code.slice(cleanup),/fs\.rmSync\(lockPath,\{force:true\}\)/);
});
