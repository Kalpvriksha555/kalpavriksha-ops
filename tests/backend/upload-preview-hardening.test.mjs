import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const storage = fs.readFileSync(new URL('../../backend/src/services/fileStorageService.js', import.meta.url), 'utf8');

test('private storage accepts validated media and keeps active content blocked', () => {
  for (const extension of ['.mp4','.mov','.avi','.mkv','.webm','.mp3','.wav','.m4a','.ogg']) {
    assert.match(storage, new RegExp(extension.replace('.', '\\.')));
  }
  assert.match(storage, /ACTIVE_OR_EXECUTABLE_EXTENSIONS/);
  assert.match(storage, /validateSignature/);
  assert.match(storage, /ANTIVIRUS/);
});

test('HEIC brands are classified before generic ISO media', () => {
  const heic = storage.indexOf("ftyp(?:heic|heif|heix|hevc|mif1|msf1)");
  const generic = storage.indexOf("buffer.subarray(4, 8).toString('ascii') === 'ftyp'");
  assert.ok(heic > 0 && generic > heic);
});

test('preview and download use one authorization and streaming implementation', () => {
  assert.match(server, /function sendAuthorizedStoredFile/);
  assert.match(server, /app\.get\('\/api\/files\/:id\/preview'.*sendAuthorizedStoredFile\(req,res,'preview'\)/s);
  assert.match(server, /app\.get\('\/api\/files\/:id\/download'.*sendAuthorizedStoredFile\(req,res,'download'\)/s);
  assert.match(server, /Accept-Ranges','bytes'/);
  assert.match(server, /res\.sendFile\(fp\)/);
  const downloadRoute = server.slice(server.indexOf("app.get('/api/files/:id/download'"), server.indexOf("app.delete('/api/files/:id'"));
  assert.doesNotMatch(downloadRoute, /fs\.statSync|fs\.readFileSync/);
});

test('legacy inline preview is bounded and asynchronous', () => {
  const route = server.slice(server.indexOf("app.get('/api/files/:id/preview-data'"), server.indexOf("app.get('/api/files/:id/preview'"));
  assert.match(route, /MAX_INLINE_PREVIEW_BYTES/);
  assert.match(route, /fs\.promises\.stat/);
  assert.match(route, /fs\.promises\.readFile/);
  assert.doesNotMatch(route, /fs\.readFileSync|fs\.statSync/);
});

test('profile photos keep their verified MIME type despite content-addressed storage names', () => {
  assert.match(server, /function resolveProfilePhotoRecord/);
  assert.match(server, /profilePhotoMime/);
  assert.match(server, /res\.setHeader\('Content-Type', photo\.mimeType\)/);
  assert.match(server, /Content-Disposition.*inline/s);
  assert.match(server, /profilePhotoUpload/);
  assert.match(server, /PROFILE_PHOTO_MAX_MB = 5/);
  assert.match(server, /allowedMimeTypes:\['image\/png','image\/jpeg','image\/gif','image\/webp','image\/bmp'\]/);
  assert.doesNotMatch(server.slice(server.indexOf("app.post('/api/profile/photo'"), server.indexOf("function normalizeFilePurposeType")), /image\/heic|image\/heif/);
});

test('upload route is one-file, actor-authorized, idempotent and atomically links task files', () => {
  assert.match(server, /SINGLE_FILE_REQUIRED/);
  assert.match(server, /uploadMutationId/);
  assert.match(server, /findCommittedUpload/);
  assert.match(server, /const initialState=readDb\(\);\s*authorizeUpload\(initialState\)/);
  assert.match(server, /attachStoredFileToCase/);
  assert.match(server, /FILE_UPLOADED/);
  assert.match(server, /PAYMENT_RECEIPT_TYPE_INVALID/);
  assert.match(server, /Payment receipts must be a PDF or supported image file/);
});

test('preview classification falls back to extensions for generic legacy MIME and preserves voice WebM', () => {
  assert.match(server, /genericMime = !mime \|\| mime === 'application\/octet-stream'/);
  assert.match(server, /imageExtensions\.has\(extension\) \? 'image'/);
  assert.match(server, /extension === '\.webm' && \/\(voice\|audio\)\//);
  assert.match(server, /extension === '\.webm' && kind === 'audio' \? 'audio\/webm'/);
});

test('private file content disposition supports Unicode without invalid HTTP header bytes', () => {
  assert.match(server, /function contentDispositionValue/);
  assert.match(server, /filename\*=UTF-8''/);
  assert.match(server, /replace\(\/\[\^\\x20-\\x7e\]\/g,'_'\)/);
  assert.match(server, /contentDispositionValue\(mode === 'preview' \? 'inline' : 'attachment',fileName\)/);
});

test('request close removes temporary files without releasing a lease while an async handler can still commit', () => {
  assert.equal((server.match(/res\.once\('close',cleanupTemps\)/g) || []).length, 2);
  assert.equal((server.match(/res\.once\('close',cleanupAll\)/g) || []).length, 0);
  assert.equal((server.match(/res\.once\('finish',cleanupAll\)/g) || []).length, 2);
  assert.match(server, /const cleanupAll=\(\)=>\{ cleanupTemps\(\); releaseRequestStorageLeases\(req\); \}/);
});

test('quarantine retention is bounded and storage health avoids a full object walk on every call', () => {
  assert.match(storage, /FILE_QUARANTINE_RETENTION_MS/);
  assert.match(storage, /FILE_QUARANTINE_MAX_BYTES/);
  assert.match(storage, /function pruneQuarantine/);
  assert.match(storage, /if \(total<=quarantineMaxBytes\) break/);
  assert.match(storage, /FILE_STORAGE_HEALTH_CACHE_MS/);
  assert.match(storage, /objectCountCache/);
});

test('upload authorization reuses one initial state read before expensive file validation', () => {
  const route = server.slice(server.indexOf("app.post('/api/files/upload'"), server.indexOf('function getStoredFilePreviewDescriptor'));
  assert.match(route, /const initialState=readDb\(\);\s*authorizeUpload\(initialState\)/);
  assert.doesNotMatch(route, /authorizeUpload\(readDb\(\)\)/);
});

test('media and HEIC signatures pass real private-storage validation', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const { createFileStorage } = await import('../../backend/src/services/fileStorageService.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kalpa-upload-preview-'));
  const privateStorage = createFileStorage({ root, antivirusMode:'disabled', antivirusRequired:false });
  const samples = [
    { name:'photo.heic', mime:'image/heic', bytes:Buffer.concat([Buffer.alloc(4),Buffer.from('ftypheic'),Buffer.alloc(64)]) },
    { name:'clip.webm', mime:'video/webm', bytes:Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.alloc(64)]) },
    { name:'voice.wav', mime:'audio/wav', bytes:Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.alloc(64)]) },
    { name:'voice.mp3', mime:'audio/mpeg', bytes:Buffer.concat([Buffer.from('ID3'),Buffer.alloc(64)]) },
  ];
  try {
    for (const sample of samples) {
      const temp = path.join(privateStorage.tempDestination(), `${Date.now()}-${sample.name}`);
      fs.writeFileSync(temp, sample.bytes);
      const saved = await privateStorage.validateAndStore({ path:temp, originalname:sample.name, mimetype:sample.mime, size:sample.bytes.length }, { purpose:'CHAT' });
      assert.ok(saved.storageKey.startsWith('objects/'));
      assert.equal(saved.size, sample.bytes.length);
    }
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});


test('upload mutation idempotency is actor and chat-target scoped', () => {
  const route = server.slice(server.indexOf("app.post('/api/files/upload'"), server.indexOf('function getStoredFilePreviewDescriptor'));
  assert.match(route, /uploadedById/);
  assert.match(route, /sameUploadActor/);
  assert.match(route, /requestedChatScope/);
  assert.match(route, /requestedChatParticipants\.every/);
  assert.match(route, /Boolean\(item\?\.isVoiceNote\)===requestedVoiceNote/);
  assert.match(route, /file\.uploadedByUsername=actor\.username/);
});

test('voice note evidence is persisted and overrides a misleading video WebM MIME', () => {
  assert.match(server, /file\.isVoiceNote=requestedVoiceNote/);
  assert.match(server, /file\.mime='audio\/webm'/);
  const descriptor = server.slice(server.indexOf('function getStoredFilePreviewDescriptor'), server.indexOf('function applyPrivateFileResponseHeaders'));
  const voice = descriptor.indexOf("extension === '.webm' && /(voice|audio)/.test(purpose) ? 'audio'");
  const extensionBound = descriptor.indexOf(': extensionKind;');
  assert.ok(voice >= 0 && extensionBound > voice);
  assert.doesNotMatch(descriptor, /mime\.startsWith\('video\/'\) \? 'video'/);
});

test('OOXML validation reads the central directory and old incoming files are pruned', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const { createFileStorage } = await import('../../backend/src/services/fileStorageService.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kalpa-ooxml-'));
  const incoming = path.join(root, '.incoming');
  fs.mkdirSync(incoming, { recursive:true });
  const oldIncoming = path.join(incoming, 'old-upload.tmp');
  const freshIncoming = path.join(incoming, 'fresh-upload.tmp');
  fs.writeFileSync(oldIncoming, 'old');
  fs.writeFileSync(freshIncoming, 'fresh');
  const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(oldIncoming, oldTime, oldTime);

  const makeStoredZip = (entries) => {
    const locals=[]; const centrals=[]; let offset=0;
    for (const [name,value] of entries) {
      const nameBytes=Buffer.from(name); const data=Buffer.from(value);
      const local=Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(20,4); local.writeUInt16LE(0,6); local.writeUInt16LE(0,8);
      local.writeUInt32LE(0,14); local.writeUInt32LE(data.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(nameBytes.length,26);
      locals.push(local,nameBytes,data);
      const central=Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0,8); central.writeUInt16LE(0,10);
      central.writeUInt32LE(0,16); central.writeUInt32LE(data.length,20); central.writeUInt32LE(data.length,24); central.writeUInt16LE(nameBytes.length,28); central.writeUInt32LE(offset,42);
      centrals.push(central,nameBytes);
      offset += local.length + nameBytes.length + data.length;
    }
    const centralBuffer=Buffer.concat(centrals);
    const eocd=Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(entries.length,8); eocd.writeUInt16LE(entries.length,10); eocd.writeUInt32LE(centralBuffer.length,12); eocd.writeUInt32LE(offset,16);
    return Buffer.concat([...locals,centralBuffer,eocd]);
  };

  try {
    const storageInstance=createFileStorage({ root, antivirusMode:'disabled', incomingRetentionMs:60*60*1000 });
    assert.equal(fs.existsSync(oldIncoming), false);
    assert.equal(fs.existsSync(freshIncoming), true);
    const temp=path.join(storageInstance.tempDestination(), 'valid.docx');
    const zip=makeStoredZip([['[Content_Types].xml','types'],['word/document.xml','doc']]);
    fs.writeFileSync(temp,zip);
    const saved=await storageInstance.validateAndStore({path:temp,originalname:'valid.docx',mimetype:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:zip.length},{purpose:'SOURCE'});
    assert.ok(saved.storageKey.endsWith('.docx'));
    const fake=path.join(storageInstance.tempDestination(),'fake.docx');
    const fakeBytes=Buffer.concat([Buffer.from('PK\x03\x04[Content_Types].xml word/'),Buffer.alloc(1024)]);
    fs.writeFileSync(fake,fakeBytes);
    await assert.rejects(storageInstance.validateAndStore({path:fake,originalname:'fake.docx',mimetype:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:fakeBytes.length},{purpose:'SOURCE'}), /valid Office document container/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});


test('content-addressed deduplication repairs a corrupted existing object before discarding the good retry', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  const { createFileStorage } = await import('../../backend/src/services/fileStorageService.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kalpa-dedup-repair-'));
  const storageInstance = createFileStorage({ root, antivirusMode:'disabled', antivirusRequired:false });
  const goodBytes = Buffer.from('%PDF-1.7\nvalidated-content\n%%EOF');
  const expectedHash = crypto.createHash('sha256').update(goodBytes).digest('hex');
  const makeUpload = (suffix) => {
    const temp = path.join(storageInstance.tempDestination(), `${suffix}.pdf`);
    fs.writeFileSync(temp, goodBytes);
    return { path:temp, originalname:'evidence.pdf', mimetype:'application/pdf', size:goodBytes.length };
  };
  try {
    const first = await storageInstance.validateAndStore(makeUpload('first'), { purpose:'SOURCE' });
    const destination = storageInstance.resolve(first).fp;
    fs.writeFileSync(destination, Buffer.from('%PDF-corrupted'));
    const repaired = await storageInstance.validateAndStore(makeUpload('retry'), { purpose:'SOURCE' });
    assert.equal(repaired.repairedCorruptObject, true);
    assert.equal(repaired.deduplicated, false);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex'), expectedHash);
    const deduplicated = await storageInstance.validateAndStore(makeUpload('third'), { purpose:'SOURCE' });
    assert.equal(deduplicated.repairedCorruptObject, false);
    assert.equal(deduplicated.deduplicated, true);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});


test('the one active upload stack enforces the canonical 100 MB and 20 file hard caps', () => {
  assert.match(server, /boundedEnvNumber\('MAX_UPLOAD_SIZE_MB', 100, 1, 100\)/);
  assert.match(server, /boundedEnvNumber\('MAX_UPLOAD_FILES', 20, 1, 20\)/);
  assert.equal(fs.existsSync(new URL('../../backend/src/middleware/upload.js', import.meta.url)), false);
});

test('stored and response filenames strip bidirectional and zero-width controls', async () => {
  const { safeOriginalFileName } = await import('../../backend/src/services/fileStorageService.js');
  const unsafe = `invoice-${String.fromCharCode(0x202e)}gpj.exe${String.fromCharCode(0x200b)}.pdf`;
  const safe = safeOriginalFileName(unsafe);
  assert.doesNotMatch(safe, /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u);
  assert.match(safe, /\.pdf$/);
  assert.match(server, /\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff/);
  assert.match(server, /filename\*=UTF-8''/);
});

test('identical profile-photo retries are authoritative no-op responses', () => {
  const route = server.slice(server.indexOf("app.post('/api/profile/photo'"), server.indexOf('function normalizeFilePurposeType'));
  assert.match(route, /user\.profilePhotoSha256/);
  assert.match(route, /previousKey/);
  assert.match(route, /idempotent:true/);
  assert.match(route, /updated:false/);
});
