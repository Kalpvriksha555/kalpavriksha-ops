import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileStorage } from '../../backend/src/services/fileStorageService.js';

const pdf = label => Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`);

const upload = (storage, root, name, bytes) => {
  const fp=path.join(storage.tempRoot,`${Date.now()}-${crypto.randomBytes(5).toString('hex')}.upload`);
  fs.writeFileSync(fp,bytes);
  return {path:fp,originalname:name,mimetype:'application/pdf',size:bytes.length};
};

test('cross-process storage leases prevent premature trash movement and expire safely', async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalp-file-lease-'));
  try {
    const storage=createFileStorage({root,leaseMaxAgeMs:60_000});
    const stored=await storage.validateAndStore(upload(storage,root,'leased.pdf',pdf('leased')), {purpose:'SOURCE',acquireLease:true});
    assert.equal(storage.hasActiveLease(stored.storageKey),true);
    assert.equal(storage.softDelete(stored.storageKey,{reason:'must wait'}),null);
    assert.ok(storage.resolve({storageKey:stored.storageKey}));

    stored.releaseStorageLease();
    assert.equal(storage.hasActiveLease(stored.storageKey),false);
    const trashed=storage.softDelete(stored.storageKey,{reason:'eligible'});
    assert.ok(trashed && fs.existsSync(trashed));
    assert.equal(storage.resolve({storageKey:stored.storageKey}),null);
    assert.ok(fs.existsSync(`${trashed}.json`));

    const stale=await storage.validateAndStore(upload(storage,root,'stale.pdf',pdf('stale')), {purpose:'SOURCE',acquireLease:true});
    const leaseFiles=fs.readdirSync(storage.locksRoot,{recursive:true})
      .filter(name=>String(name).endsWith('.lease'));
    assert.equal(leaseFiles.length>=1,true);
    const staleLease=path.join(storage.locksRoot,String(leaseFiles[0]));
    const old=new Date(Date.now()-120_000);
    fs.utimesSync(staleLease,old,old);
    assert.equal(storage.hasActiveLease(stale.storageKey),false,'Stale lease from a crashed process was not pruned.');
    const staleTrash=storage.softDelete(stale.storageKey,{reason:'stale lease expired'});
    assert.ok(staleTrash && fs.existsSync(staleTrash));
    stale.releaseStorageLease();
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
