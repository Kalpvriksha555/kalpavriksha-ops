import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// Verify the release manifest covers every tracked file except itself.
// sha256sum -c verifies contents; this check prevents new files bypassing it.
const result=spawnSync('git',['ls-files','-z'],{encoding:'buffer',maxBuffer:16*1024*1024});
if(result.status!==0)throw new Error('Cannot enumerate tracked source files');
const tracked=result.stdout.toString('utf8').split('\0').filter(Boolean)
  .filter(p=>p!=='RELEASE_FILE_MANIFEST.sha256').sort();
const manifest=fs.readFileSync('RELEASE_FILE_MANIFEST.sha256','utf8');
const lines=manifest.trimEnd().split('\n').filter(Boolean);
const names=[];
for(const line of lines){
  const match=/^[0-9a-f]{64}  (.+)$/.exec(line);
  if(!match)throw new Error('Malformed release manifest line');
  names.push(match[1]);
}
names.sort();
const missing=tracked.filter(p=>!names.includes(p));
const extra=names.filter(p=>!tracked.includes(p));
const dup=names.filter((p,i)=>i>0&&p===names[i-1]);
if(missing.length||extra.length||dup.length){
  throw new Error('Release manifest file list is incomplete: missing='+missing.join(',')+
    ' extra='+extra.join(',')+' duplicates='+dup.join(','));
}
console.log('Release manifest covers all '+tracked.length+' tracked source files.');
