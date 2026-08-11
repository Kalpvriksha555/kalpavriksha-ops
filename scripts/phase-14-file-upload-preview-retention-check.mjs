import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const findings=[];
const requirePattern=(file,pattern,message)=>{ const source=read(file); if(!pattern.test(source)) findings.push({file,message,pattern:String(pattern)}); };
const forbidPattern=(file,pattern,message)=>{ const source=read(file); if(pattern.test(source)) findings.push({file,message,pattern:String(pattern)}); };
const requireOrder=(file,source,before,after,message)=>{
  const first=source.indexOf(before); const second=source.indexOf(after,Math.max(0,first));
  if(!(first>=0 && second>first)) findings.push({file,message,before,after});
};
const quotedItems=(source,label)=>{
  const match=source.match(new RegExp(`${label}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`));
  if(!match) return null;
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(item=>item[1]);
};

const server=read('backend/src/server.js');
const storage=read('backend/src/services/fileStorageService.js');
const retention=read('backend/src/services/storageRetentionService.js');
const fileService=read('frontend/src/services/fileService.js');
const viewer=read('frontend/src/components/files/UnifiedFileViewer.jsx');
const app=read('frontend/src/App.jsx');
const chat=read('frontend/src/components/chat/CommunicationHub.jsx');
const profile=read('frontend/src/components/profile/ProfileView.jsx');

// One canonical extension contract must exist at both browser and private-storage boundaries.
const backendExtensions=quotedItems(storage,'DEFAULT_ALLOWED_EXTENSIONS');
const frontendExtensions=quotedItems(fileService,'PROJECT_UPLOAD_EXTENSIONS');
if(!backendExtensions) findings.push({file:'backend/src/services/fileStorageService.js',message:'Canonical backend file-extension contract could not be parsed.'});
if(!frontendExtensions) findings.push({file:'frontend/src/services/fileService.js',message:'Canonical frontend file-extension contract could not be parsed.'});
if(backendExtensions && frontendExtensions){
  const backend=backendExtensions.map(value=>value.replace(/^\./,'')).sort();
  const frontend=[...frontendExtensions].sort();
  if(JSON.stringify(backend)!==JSON.stringify(frontend)) findings.push({file:'frontend/src/services/fileService.js',message:'Frontend upload extensions have drifted from the backend secure-storage contract.',backend,frontend});
}
for(const unsupported of ['zip','rar','7z','odt','ods','odp','dgn','aac','flac','m4v','svg','html','js','exe']){
  if(frontendExtensions?.includes(unsupported)) findings.push({file:'frontend/src/services/fileService.js',message:`Unsupported/active extension is exposed by the project uploader: ${unsupported}`});
}
requirePattern('frontend/src/services/fileService.js',/if \(!extension \|\| !PROJECT_UPLOAD_EXTENSION_SET\.has\(extension\)\) throw makeFileError\('FILE_TYPE_NOT_ALLOWED'/,'Browser uploads must reject unsupported extensions before transfer.');
requirePattern('backend/src/services/fileStorageService.js',/ACTIVE_OR_EXECUTABLE_EXTENSIONS/,'Private storage must retain an explicit active/executable deny-list.');
requirePattern('backend/src/services/fileStorageService.js',/'\.svg'/,'SVG must remain blocked from private attachment storage/inline preview.');

// All business-file pickers must use the same exact contract, not broad browser MIME wildcards.
for(const [file,pattern,message] of [
  ['frontend/src/App.jsx',/accept=\{PROJECT_UPLOAD_ACCEPT\}/,'Task file inputs must use the canonical project upload accept list.'],
  ['frontend/src/App.jsx',/accept=\{PAYMENT_RECEIPT_ACCEPT\}/,'Payment receipts must use the dedicated finance-safe accept list.'],
  ['frontend/src/components/chat/CommunicationHub.jsx',/accept=\{PROJECT_UPLOAD_ACCEPT\}/,'Chat attachments must use the canonical project upload accept list.'],
  ['frontend/src/components/profile/ProfileView.jsx',/accept="\.png,\.jpg,\.jpeg,\.gif,\.webp,\.bmp"/,'Profile-photo picker must match its backend image contract exactly.']
]) requirePattern(file,pattern,message);
forbidPattern('frontend/src/components/profile/ProfileView.jsx',/accept="[^"]*image\/\*/,'Profile-photo selection must not advertise image formats that the backend will reject.');

// Durable upload replay must retain enough registry evidence to distinguish actors,
// destinations, chat targets and content, and byte hashing must happen before replay.
{
  const registryStart=server.indexOf('function addFileRegistryEntry');
  const registryEnd=server.indexOf('function allKnownFileDocs',registryStart);
  const registry=server.slice(registryStart,registryEnd);
  for(const required of ['uploadMutationId','sha256','uploadedById','uploadedByUsername','type: doc.type || doc.folder','folder: doc.folder || doc.type','chatScope','chatParticipants','isVoiceNote']) {
    if(!registry.includes(required)) findings.push({file:'backend/src/server.js',message:`File registry no longer persists replay evidence: ${required}`});
  }

  const start=server.indexOf("app.post('/api/files/upload'");
  const end=server.indexOf('function getStoredFilePreviewDescriptor',start);
  const route=server.slice(start,end);
  requireOrder('backend/src/server.js',route,'preparedUploads=await prepareSecureUploads(req,purpose)','const concurrentUpload=findCommittedUpload(d,req.file)','Upload retry confirmation must happen only after signature validation and server-side SHA-256 creation.');
  if(!/const sameUploadActor=/.test(route)) findings.push({file:'backend/src/server.js',message:'Upload replay must be actor-scoped.'});
  if(!/requestedChatParticipants\.every/.test(route)) findings.push({file:'backend/src/server.js',message:'Chat upload replay must be participant-scoped.'});
  if(!/Boolean\(item\?\.isVoiceNote\)===requestedVoiceNote/.test(route)) findings.push({file:'backend/src/server.js',message:'Voice-note replay identity must retain the voice-note discriminator.'});
  if(!/const sameSha=/.test(route)) findings.push({file:'backend/src/server.js',message:'Upload replay must compare server-computed content hashes.'});
  if(!/error\.code='UPLOAD_MUTATION_ID_REUSE'/.test(route) || !/error\.statusCode=409/.test(route)) findings.push({file:'backend/src/server.js',message:'Mutation-ID reuse for a different upload must fail closed with HTTP 409.'});
  if(!/DUPLICATE_UPLOAD_MUTATION/.test(route)) findings.push({file:'backend/src/server.js',message:'Exact response-loss replays must retain the legacy duplicate-upload classification.'});
}

// Every file alias that can keep an attachment live must participate in GC, resolution and deletion.
for(const field of ['documents','completedFiles','sourceFiles','workFiles','files','uploads','attachments']){
  const allKnown=server.slice(server.indexOf('function allKnownFileDocs'),server.indexOf('function fileStorageKey'));
  if(!allKnown.includes(`c.${field}`)) findings.push({file:'backend/src/server.js',message:`Garbage-collection liveness omits case attachment alias: ${field}`});
}
requirePattern('backend/src/server.js',/\.\.\.\(c\.file \? \[c\.file\] : \[\]\)/,'Singular legacy case.file references must keep physical objects live.');
requirePattern('backend/src/server.js',/'uploads','attachments'/,'File deletion must remove upload/attachment aliases as well as canonical file arrays.');
requirePattern('backend/src/server.js',/if \(c\.file && matches\(c\.file\)\) \{ delete c\.file/,'File deletion must remove the singular legacy case.file alias.');

// Retention may expire ordinary attachments, but never finance/profile evidence, and
// legacy Unix-second timestamps must not be interpreted as 1970 milliseconds.
requirePattern('backend/src/services/storageRetentionService.js',/if \(numeric >= 1_000_000_000 && numeric < 100_000_000_000\) return numeric \* 1000/,'90-day retention must normalize plausible Unix-second timestamps.');
requirePattern('backend/src/services/storageRetentionService.js',/if \(purpose === 'PAYMENT_RECEIPT' \|\| purpose === 'FINANCE' \|\| purpose === 'FINANCIAL' \|\| purpose === 'BANK_LEDGER' \|\| purpose === 'LEDGER'\) return true/,'Finance/payment/ledger file evidence must be permanently exempt from automatic retention.');
requirePattern('backend/src/services/storageRetentionService.js',/visit\(Array\.isArray\(state\.payments\) \? state\.payments : \[\]\)/,'Payment references must participate in retention protection even with malformed legacy state shapes.');
requirePattern('backend/src/services/storageRetentionService.js',/if \(!anchor\) return false; \/\/ fail closed: unknown-age files are retained/,'Unknown-age files must fail closed and remain retained.');

// Expired/deleted/missing/quarantined rows may keep metadata but must not synthesize
// actionable URLs. PDFs should open immediately while availability is checked in parallel.
requirePattern('frontend/src/services/fileService.js',/\['DELETED','EXPIRED','MISSING','QUARANTINED'\]/,'Frontend must recognize unavailable storage states.');
requirePattern('frontend/src/services/fileService.js',/export const getProjectFileDownloadUrl = \(doc = \{\}\) => \{\s*if \(!doc \|\| unavailableStorageStatus\(doc\)\) return '';/s,'Unavailable file rows must not recreate download URLs from IDs.');
requirePattern('frontend/src/services/fileService.js',/export const getProjectFilePreviewUrl = \(doc = \{\}\) => \{\s*if \(!doc \|\| unavailableStorageStatus\(doc\)\) return '';/s,'Unavailable file rows must not recreate preview URLs from IDs.');
requirePattern('frontend/src/services/fileService.js',/\^\[A-Za-z0-9_-\]\{6,80\}\$/,'Preview/status fallback must accept the same bounded legacy ID length as download.');
requirePattern('frontend/src/services/fileService.js',/export const probeProjectFileAvailability = async/,'Private-file availability probe is missing.');
requirePattern('frontend/src/components/files/UnifiedFileViewer.jsx',/if \(result\.optimisticStream\)[\s\S]*probeProjectFileAvailability\(file, \{ signal:controller\.signal \}\)/,'PDF viewer must keep immediate streaming while asynchronously verifying the authoritative file row.');

// Inline preview of legacy rows must be extension-bound, not promoted by untrusted MIME metadata.
{
  const start=server.indexOf('function getStoredFilePreviewDescriptor');
  const end=server.indexOf('function contentDispositionValue',start);
  const block=server.slice(start,end);
  if(!/extension === '\.pdf' \? 'pdf'/.test(block) || !/: extensionKind;/.test(block)) findings.push({file:'backend/src/server.js',message:'Stored-file preview type must be determined by the safe extension contract.'});
  if(/mime\.startsWith\('image\/'\) \? 'image'/.test(block)) findings.push({file:'backend/src/server.js',message:'Legacy MIME metadata must not promote unsupported active files into inline image preview.'});
}

// Ensure this closure remains wired into normal verification and the release matrix.
requirePattern('package.json',/"verify:file-lifecycle"\s*:\s*"node scripts\/phase-14-file-upload-preview-retention-check\.mjs"/,'Phase 14 verifier script is not registered in package.json.');
requirePattern('package.json',/npm run verify:task-lifecycle && npm run verify:file-lifecycle &&(?: npm run verify:[^&]+ &&)* npm run verify:frontend-runtime/,'Phase 14 verifier must run in the normal verification chain after Phase 13 and before runtime bootstrap.');
requirePattern('scripts/full-release-verifier-matrix.mjs',/id:'file-upload-preview-retention'[\s\S]*phase-14-file-upload-preview-retention-check\.mjs/,'Phase 14 verifier is not part of the release matrix.');

if(findings.length){
  console.error(`Phase 14 file/upload/preview/retention closure FAILED with ${findings.length} finding(s):`);
  for(const finding of findings) console.error(`- ${finding.file}: ${finding.message}`);
  process.exit(1);
}
console.log(`Phase 14 file/upload/preview/retention closure PASS (${frontendExtensions?.length || 0} canonical upload extensions; finance retention protected; replay/preview/GC contracts present).`);
