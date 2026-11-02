// Execute archive verification in a child process so the API event loop never
// synchronously hashes multiple GB of backup data.
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const checker=path.join(root,'scripts/file-retention-backup-gate.mjs');

export function checkAttachmentRetentionReadiness({timeoutMs=10*60*1000}={}){
  return new Promise(resolve=>{
    let child;
    try{
      child=spawn(process.execPath,[checker],{
        cwd:root,env:process.env,stdio:['ignore','pipe','pipe']
      });
    }catch{return resolve({ok:false,reason:'GATE_PROCESS_START_FAILED'});}
    let output='',error='',settled=false;
    const finish=value=>{
      if(settled)return;
      settled=true;clearTimeout(watchdog);
      resolve(value);
    };
    child.stdout.on('data',chunk=>{output=(output+chunk.toString()).slice(-16384);});
    child.stderr.on('data',chunk=>{error=(error+chunk.toString()).slice(-4096);});
    child.on('error',()=>finish({ok:false,reason:'GATE_PROCESS_ERROR'}));
    child.on('exit',code=>{
      try{
        const parsed=JSON.parse(output.trim());
        finish(code===0 && parsed?.ok===true
          ? {ok:true,checked:parsed.checked,reason:parsed.reason}
          : {ok:false,reason:String(parsed?.reason||'GATE_CHECK_FAILED').slice(0,128)});
      }catch{finish({ok:false,reason:'GATE_CHECK_NO_VALID_RESULT'});}
    });
    const watchdog=setTimeout(()=>{
      child.kill('SIGTERM');
      finish({ok:false,reason:'GATE_CHECK_TIMEOUT'});
    },timeoutMs);
    watchdog.unref?.();
  });
}
