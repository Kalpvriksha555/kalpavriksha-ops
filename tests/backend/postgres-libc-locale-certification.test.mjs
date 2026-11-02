import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const file=new URL('../../scripts/certify-and-deploy-1.9.30-vps.sh',import.meta.url);
const script=fs.readFileSync(file,'utf8');
const start=script.indexOf('"$INITDB" --help | grep -Fq --');
const end=script.indexOf('\ncat >>"$PGDATA/postgresql.conf"',start);
assert.ok(start>=0&&end>start,'initdb locale block was not found');
const initdbBlock=script.slice(start,end);
function smoke(provider,locale,t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalpa-libc-parity-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const exe=path.join(dir,'initdb-help');
  fs.writeFileSync(exe,'#!/bin/sh\nprintf "%s\\n" "--locale-provider" "--icu-locale"\n',{mode:0o700});
  const capture=path.join(dir,'args.txt');
  const sh='set -Eeuo pipefail\nsay(){ :; }\nfail(){ echo "$*" >&2; exit 9; }\nrunuser(){ printf "%s\\n" "$@" > "$CAPTURE"; }\n'+initdbBlock;
  const r=spawnSync('bash',['-c',sh],{
    encoding:'utf8',env:{...process.env,
      PROD_PROVIDER:provider,PROD_LOCALE:locale,
      PROD_COLLATE:'C.UTF-8',PROD_CTYPE:'C.UTF-8',
      PROD_ENCODING:'UTF8',PGDATA:path.join(dir,'data'),INITDB:exe,CAPTURE:capture}
  });
  assert.equal(r.status,0,'shell initdb plan failed: '+r.stderr);
  return fs.readFileSync(capture,'utf8').trim().split('\n');
}
test('locale-aware certification script remains shell-parseable',()=>{
  const check=spawnSync('bash',['-n',fileURLToPath(file)],{encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
});
test('libc production C.UTF-8 selects libc initdb without ICU arguments',t=>{
  const args=smoke('c','',t);
  assert.ok(args.includes('--locale-provider=libc'));
  assert.ok(args.includes('--lc-collate=C.UTF-8'));
  assert.ok(args.includes('--lc-ctype=C.UTF-8'));
  assert.ok(args.includes('--encoding=UTF8'));
  assert.equal(args.some(a=>a.startsWith('--icu-locale')),false);
});
test('ICU production retains ICU locale and C locale metadata',t=>{
  const args=smoke('i','en-US',t);
  assert.ok(args.includes('--locale-provider=icu'));
  assert.ok(args.includes('--icu-locale=en-US'));
  assert.ok(args.includes('--lc-collate=C.UTF-8'));
  assert.ok(args.includes('--lc-ctype=C.UTF-8'));
});
test('production, temporary cluster and disposable database compare all locale properties',()=>{
  assert.match(script,/IFS='\|' read -r PROD_VERSION_NUM PROD_DB_BYTES PROD_PROVIDER PROD_LOCALE PROD_COLLATE PROD_CTYPE PROD_ENCODING/);
  assert.match(script,/IFS='\|' read -r TEMP_PROVIDER TEMP_LOCALE TEMP_COLLATE TEMP_CTYPE TEMP_ENCODING/);
  assert.match(script,/IFS='\|' read -r VERIFY_PROVIDER VERIFY_LOCALE VERIFY_COLLATE VERIFY_CTYPE VERIFY_ENCODING/);
  assert.equal((script.match(/pg_encoding_to_char\(d\.encoding\)/g)||[]).length,3);
  assert.match(script,/\$TEMP_COLLATE" == "\$PROD_COLLATE"/);
  assert.match(script,/\$VERIFY_CTYPE" == "\$PROD_CTYPE"/);
  assert.match(script,/Unsupported PostgreSQL production locale provider/);
  assert.doesNotMatch(script,/Certification requires the same ICU provider as verified production/);
});
