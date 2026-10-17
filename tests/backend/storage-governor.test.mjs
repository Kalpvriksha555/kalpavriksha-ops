import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDiskPressure, inspectWorkRoot, WORK_ROOT} from '../../scripts/storage-governor.mjs';

const GiB=1024**3;
test('disk governor warns at 80%, pressure at 85%, critical at 90%',()=>{
  const data=(pct,free=20)=>({usedPercent:pct,availableBytes:free*GiB});
  assert.equal(classifyDiskPressure(data(79)),'NORMAL');
  assert.equal(classifyDiskPressure(data(80)),'WARNING');
  assert.equal(classifyDiskPressure(data(85)),'PRESSURE');
  assert.equal(classifyDiskPressure(data(90)),'CRITICAL');
});
test('free-space reserve triggers pressure even below percentage threshold',()=>{
  assert.equal(classifyDiskPressure({usedPercent:50,availableBytes:10*GiB}),'PRESSURE');
  assert.equal(classifyDiskPressure({usedPercent:50,availableBytes:1*GiB}),'CRITICAL');
});
test('scratch housekeeping refuses all alternate locations',()=>{
  for(const path of ['/var/backups/kalpavriksha','/var/lib/kalpavriksha/private-files',
    '/tmp','/var/lib/kalpavriksha/governor/work/../private-files']){
    assert.throws(()=>inspectWorkRoot(path),/restricted/i);
  }
  assert.equal(WORK_ROOT,'/var/lib/kalpavriksha/governor/work');
});
