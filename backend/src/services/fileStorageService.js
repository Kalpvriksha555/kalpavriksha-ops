import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const DEFAULT_ALLOWED_EXTENSIONS = Object.freeze([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.heif',
  '.dwg', '.dxf', '.xlsx', '.xls', '.csv', '.docx', '.doc', '.rtf', '.pptx', '.ppt', '.txt'
]);

const ACTIVE_OR_EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.dll', '.com', '.bat', '.cmd', '.ps1', '.msi', '.scr', '.jar', '.apk', '.app',
  '.html', '.htm', '.xhtml', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.php', '.asp',
  '.aspx', '.jsp', '.svg', '.sh', '.py', '.pl', '.rb', '.vbs', '.reg', '.lnk', '.iso'
]);

const MIME_BY_EXTENSION = Object.freeze({
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.dwg': 'application/acad', '.dxf': 'application/dxf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel', '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword', '.rtf': 'application/rtf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint', '.txt': 'text/plain'
});

const OOXML_EXTENSIONS = new Set(['.xlsx', '.docx', '.pptx']);
const OLE_EXTENSIONS = new Set(['.xls', '.doc', '.ppt']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.heif']);

export class FileValidationError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'FileValidationError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function mkdirPrivate(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch {}
}

function normalizedExtension(filename = '') {
  return path.extname(String(filename || '').trim()).toLowerCase();
}

export function safeOriginalFileName(value = 'file') {
  const base = path.basename(String(value || 'file').replace(/\0/g, '')).normalize('NFKC');
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/:*?"<>|]/g, '_').trim();
  return (cleaned || 'file').slice(0, 180);
}

function startsWith(buffer, bytes) {
  if (!Buffer.isBuffer(buffer) || buffer.length < bytes.length) return false;
  return bytes.every((value, index) => buffer[index] === value);
}

function looksLikeText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return true;
  let suspicious = 0;
  for (const byte of buffer) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / buffer.length < 0.03;
}

function detectSignature(buffer, extension) {
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { family: 'pdf', mime: 'application/pdf' };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { family: 'image', mime: 'image/png' };
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { family: 'image', mime: 'image/jpeg' };
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return { family: 'image', mime: 'image/gif' };
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { family: 'image', mime: 'image/webp' };
  if (startsWith(buffer, [0x42, 0x4d])) return { family: 'image', mime: 'image/bmp' };
  if (buffer.subarray(4, 12).toString('ascii').includes('ftypheic') || buffer.subarray(4, 12).toString('ascii').includes('ftypheif')) return { family: 'image', mime: MIME_BY_EXTENSION[extension] || 'image/heic' };
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) || startsWith(buffer, [0x50, 0x4b, 0x07, 0x08])) return { family: 'zip', mime: MIME_BY_EXTENSION[extension] || 'application/zip' };
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { family: 'ole', mime: MIME_BY_EXTENSION[extension] || 'application/x-ole-storage' };
  const ascii = buffer.subarray(0, 32).toString('ascii').trimStart();
  if (/^AC10\d{2}/.test(ascii)) return { family: 'dwg', mime: 'application/acad' };
  if (extension === '.dxf' && looksLikeText(buffer) && /(?:SECTION|HEADER|ENTITIES|TABLES)/i.test(buffer.toString('utf8', 0, Math.min(buffer.length, 4096)))) return { family: 'dxf', mime: 'application/dxf' };
  if (extension === '.rtf' && buffer.subarray(0, 5).toString('ascii') === '{\\rtf') return { family: 'rtf', mime: 'application/rtf' };
  if (['.csv', '.txt'].includes(extension) && looksLikeText(buffer)) return { family: 'text', mime: MIME_BY_EXTENSION[extension] };
  return { family: 'unknown', mime: '' };
}

function validateSignature(extension, signature) {
  if (extension === '.pdf') return signature.family === 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return signature.family === 'image';
  if (OOXML_EXTENSIONS.has(extension)) return signature.family === 'zip';
  if (OLE_EXTENSIONS.has(extension)) return signature.family === 'ole';
  if (extension === '.dwg') return signature.family === 'dwg';
  if (extension === '.dxf') return signature.family === 'dxf';
  if (extension === '.rtf') return signature.family === 'rtf';
  if (['.csv', '.txt'].includes(extension)) return signature.family === 'text';
  return false;
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function readHead(filePath, bytes = 8192) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const count = fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, count);
  } finally {
    fs.closeSync(fd);
  }
}

function validateStructuredContainer(filePath, extension) {
  if (!OOXML_EXTENSIONS.has(extension)) return true;
  const stat = fs.statSync(filePath);
  const sampleSize = Math.min(stat.size, 1024 * 1024);
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(sampleSize);
    const tail = Buffer.alloc(sampleSize);
    const headCount = fs.readSync(fd, head, 0, sampleSize, 0);
    const tailOffset = Math.max(0, stat.size - sampleSize);
    const tailCount = fs.readSync(fd, tail, 0, sampleSize, tailOffset);
    const indexText = Buffer.concat([head.subarray(0, headCount), tail.subarray(0, tailCount)]).toString('latin1');
    const expectedFolder = extension === '.docx' ? 'word/' : extension === '.xlsx' ? 'xl/' : 'ppt/';
    return indexText.includes('[Content_Types].xml') && indexText.includes(expectedFolder);
  } finally {
    fs.closeSync(fd);
  }
}

function safeStoragePath(root, storageKey) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, String(storageKey || ''));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return resolved;
}

export function createFileStorage(options = {}) {
  const root = path.resolve(options.root || path.join(process.cwd(), 'private-files'));
  const antivirusMode = String(options.antivirusMode ?? process.env.FILE_ANTIVIRUS_MODE ?? 'disabled').trim().toLowerCase();
  const antivirusRequired = options.antivirusRequired ?? String(process.env.FILE_ANTIVIRUS_REQUIRED || '').trim().toLowerCase() === 'true';
  const clamScanPath = String(options.clamScanPath || process.env.CLAMSCAN_PATH || 'clamscan').trim();
  const tempRoot = path.resolve(options.tempRoot || path.join(root, '.incoming'));
  const objectsRoot = path.resolve(options.objectsRoot || path.join(root, 'objects'));
  const quarantineRoot = path.resolve(options.quarantineRoot || path.join(root, 'quarantine'));
  const trashRoot = path.resolve(options.trashRoot || path.join(root, 'trash'));
  const legacyRoots = [...new Set((options.legacyRoots || []).filter(Boolean).map(item => path.resolve(item)))];
  const allowedExtensions = new Set((options.allowedExtensions || DEFAULT_ALLOWED_EXTENSIONS).map(value => String(value).toLowerCase().startsWith('.') ? String(value).toLowerCase() : `.${String(value).toLowerCase()}`));

  [root, tempRoot, objectsRoot, quarantineRoot, trashRoot].forEach(mkdirPrivate);

  function tempDestination() {
    mkdirPrivate(tempRoot);
    return tempRoot;
  }

  async function quarantine(file, reason, code = 'FILE_REJECTED') {
    if (!file?.path || !fs.existsSync(file.path)) return null;
    const date = new Date().toISOString().slice(0, 10);
    const directory = path.join(quarantineRoot, date);
    mkdirPrivate(directory);
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeOriginalFileName(file.originalname || file.filename || 'rejected.bin')}`;
    const destination = path.join(directory, name);
    fs.renameSync(file.path, destination);
    fs.writeFileSync(`${destination}.json`, JSON.stringify({ code, reason, originalName: file.originalname || '', size: Number(file.size || 0), quarantinedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    return destination;
  }

  async function antivirusScan(filePath) {
    if (!antivirusMode || antivirusMode === 'disabled' || antivirusMode === 'none') {
      if (antivirusRequired) throw new FileValidationError('ANTIVIRUS_REQUIRED', 'Antivirus scanning is required but no scanner is configured.', 503);
      return { status:'NOT_CONFIGURED', engine:'' };
    }
    if (antivirusMode !== 'clamscan') {
      if (antivirusRequired) throw new FileValidationError('ANTIVIRUS_MODE_UNSUPPORTED', `Unsupported antivirus mode: ${antivirusMode}.`, 503);
      return { status:'UNSUPPORTED', engine:antivirusMode };
    }
    return new Promise((resolve, reject) => {
      const child = spawn(clamScanPath, ['--no-summary', '--stdout', filePath], { stdio:['ignore','pipe','pipe'] });
      let output='';
      const timer=setTimeout(()=>{ child.kill('SIGKILL'); reject(new FileValidationError('ANTIVIRUS_TIMEOUT','Antivirus scanning timed out.',503)); }, 120000);
      child.stdout.on('data',chunk=>{ output=(output+chunk.toString()).slice(-8000); });
      child.stderr.on('data',chunk=>{ output=(output+chunk.toString()).slice(-8000); });
      child.on('error',error=>{
        clearTimeout(timer);
        if (antivirusRequired) reject(new FileValidationError('ANTIVIRUS_UNAVAILABLE',`Antivirus scanner is unavailable: ${error.message}`,503));
        else resolve({status:'UNAVAILABLE',engine:'clamscan',detail:error.message});
      });
      child.on('exit',code=>{
        clearTimeout(timer);
        if (code===0) resolve({status:'CLEAN',engine:'clamscan'});
        else if (code===1) resolve({status:'INFECTED',engine:'clamscan',detail:output.trim()});
        else if (antivirusRequired) reject(new FileValidationError('ANTIVIRUS_SCAN_FAILED',`Antivirus scan failed with exit code ${code}.`,503,{detail:output.trim()}));
        else resolve({status:'UNAVAILABLE',engine:'clamscan',detail:output.trim()});
      });
    });
  }

  async function validateAndStore(file, context = {}) {
    if (!file?.path || !fs.existsSync(file.path)) throw new FileValidationError('UPLOAD_TEMP_FILE_MISSING', 'The uploaded temporary file could not be found.', 500);
    const originalName = safeOriginalFileName(file.originalname || file.filename || 'file');
    const extension = normalizedExtension(originalName);
    if (!extension) {
      await quarantine(file, 'File has no extension.', 'FILE_EXTENSION_REQUIRED');
      throw new FileValidationError('FILE_EXTENSION_REQUIRED', 'Files must include a recognised extension.');
    }
    if (ACTIVE_OR_EXECUTABLE_EXTENSIONS.has(extension) || !allowedExtensions.has(extension)) {
      await quarantine(file, `Extension ${extension} is not allowed.`, 'FILE_TYPE_NOT_ALLOWED');
      throw new FileValidationError('FILE_TYPE_NOT_ALLOWED', `Files ending in ${extension} are not permitted.`);
    }
    const stat = fs.statSync(file.path);
    if (!stat.size) {
      await quarantine(file, 'Empty file.', 'EMPTY_FILE');
      throw new FileValidationError('EMPTY_FILE', 'Empty files cannot be uploaded.');
    }
    const head = readHead(file.path);
    const signature = detectSignature(head, extension);
    if (!validateSignature(extension, signature)) {
      await quarantine(file, `Signature ${signature.family} does not match ${extension}.`, 'FILE_SIGNATURE_MISMATCH');
      throw new FileValidationError('FILE_SIGNATURE_MISMATCH', `The file content does not match its ${extension} extension.`);
    }
    if (!validateStructuredContainer(file.path, extension)) {
      await quarantine(file, `The ${extension} container is missing required Office document entries.`, 'OFFICE_CONTAINER_INVALID');
      throw new FileValidationError('OFFICE_CONTAINER_INVALID', `The uploaded ${extension} file is not a valid Office document container.`);
    }
    const antivirus = await antivirusScan(file.path);
    if (antivirus.status === 'INFECTED') {
      await quarantine(file, antivirus.detail || 'Malware detected.', 'MALWARE_DETECTED');
      throw new FileValidationError('MALWARE_DETECTED', 'The uploaded file was rejected because malware was detected.', 400);
    }
    const sha256 = await sha256File(file.path);
    const storageKey = path.posix.join('objects', sha256.slice(0, 2), `${sha256}${extension}`);
    const destination = safeStoragePath(root, storageKey);
    if (!destination) throw new FileValidationError('INVALID_STORAGE_KEY', 'A secure storage key could not be generated.', 500);
    mkdirPrivate(path.dirname(destination));
    let deduplicated = false;
    if (fs.existsSync(destination)) {
      deduplicated = true;
      fs.unlinkSync(file.path);
    } else {
      fs.renameSync(file.path, destination);
      try { fs.chmodSync(destination, 0o600); } catch {}
    }
    return {
      originalName,
      extension,
      storageKey,
      storedName: storageKey,
      sha256,
      size: stat.size,
      detectedMime: signature.mime || MIME_BY_EXTENSION[extension] || 'application/octet-stream',
      suppliedMime: String(file.mimetype || '').toLowerCase(),
      securityStatus: 'VALIDATED',
      antivirusStatus: antivirus.status,
      antivirusEngine: antivirus.engine || '',
      storageProvider: 'local-private',
      deduplicated,
      storedAt: new Date().toISOString(),
      purpose: String(context.purpose || '').toUpperCase()
    };
  }

  function resolve(doc = {}) {
    const candidates = [doc.storageKey, doc.storedName, doc.stored_name].filter(Boolean);
    for (const key of candidates) {
      const fp = safeStoragePath(root, key);
      if (fp && fs.existsSync(fp) && fs.statSync(fp).isFile()) return { storageKey: String(key), stored: String(key), fp, provider: 'local-private' };
    }
    const legacyNames = [doc.storedName, doc.stored_name, path.basename(String(doc.url || '').split('?')[0]), path.basename(String(doc.fileUrl || '').split('?')[0])].filter(Boolean);
    for (const legacyRoot of legacyRoots) {
      for (const name of legacyNames) {
        const fp = safeStoragePath(legacyRoot, path.basename(String(name)));
        if (fp && fs.existsSync(fp) && fs.statSync(fp).isFile()) return { storageKey: path.basename(String(name)), stored: path.basename(String(name)), fp, provider: 'legacy-local' };
      }
      const wanted = safeOriginalFileName(doc.name || doc.fileName || doc.originalName || '').toLowerCase().replace(/\s+/g, '_');
      if (wanted && fs.existsSync(legacyRoot)) {
        const files = fs.readdirSync(legacyRoot).filter(name => {
          try { return fs.statSync(path.join(legacyRoot, name)).isFile(); } catch { return false; }
        });
        const match = files.find(name => safeOriginalFileName(name).toLowerCase().replace(/\s+/g, '_') === wanted)
          || files.find(name => safeOriginalFileName(name).toLowerCase().replace(/\s+/g, '_').endsWith(wanted));
        if (match) return { storageKey: match, stored: match, fp: path.join(legacyRoot, match), provider: 'legacy-local' };
      }
    }
    return null;
  }

  async function importLegacyFile(doc = {}) {
    const resolved = resolve(doc);
    if (!resolved || resolved.provider !== 'legacy-local') return null;
    const pseudoFile = { path: resolved.fp, originalname: doc.name || doc.fileName || path.basename(resolved.fp), mimetype: doc.mime || doc.mimeType || 'application/octet-stream', size: fs.statSync(resolved.fp).size };
    const tempCopy = path.join(tempRoot, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeOriginalFileName(pseudoFile.originalname)}`);
    fs.copyFileSync(resolved.fp, tempCopy);
    pseudoFile.path = tempCopy;
    return validateAndStore(pseudoFile, { purpose: doc.purpose || doc.type || 'LEGACY' });
  }

  function listObjects() {
    const objects = [];
    if (!fs.existsSync(objectsRoot)) return objects;
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fp = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(fp);
        else if (entry.isFile()) objects.push({ storageKey: path.relative(root, fp).split(path.sep).join('/'), fp, size: fs.statSync(fp).size });
      }
    };
    walk(objectsRoot);
    return objects;
  }

  function softDelete(storageKey, metadata = {}) {
    const source = safeStoragePath(root, storageKey);
    if (!source || !fs.existsSync(source)) return null;
    const date = new Date().toISOString().slice(0, 10);
    const targetDirectory = path.join(trashRoot, date);
    mkdirPrivate(targetDirectory);
    const target = path.join(targetDirectory, `${Date.now()}-${path.basename(source)}`);
    fs.renameSync(source, target);
    fs.writeFileSync(`${target}.json`, JSON.stringify({ storageKey, deletedAt: new Date().toISOString(), ...metadata }, null, 2), { mode: 0o600 });
    return target;
  }

  function health() {
    const probe = path.join(root, `.probe-${process.pid}-${Date.now()}`);
    try {
      fs.writeFileSync(probe, 'ok', { mode: 0o600 });
      fs.unlinkSync(probe);
      return { ok: true, root, writable: true, objects: listObjects().length, antivirusMode, antivirusRequired };
    } catch (error) {
      return { ok: false, root, writable: false, error: error.message, antivirusMode, antivirusRequired };
    }
  }

  return { root, tempRoot, objectsRoot, quarantineRoot, trashRoot, allowedExtensions, antivirusMode, antivirusRequired, tempDestination, validateAndStore, resolve, importLegacyFile, listObjects, softDelete, health, quarantine };
}

export function buildFileReconciliationReport(state = {}, storage, options = {}) {
  const docs = Array.isArray(options.docs) ? options.docs : (state.files || []);
  const references = new Map();
  const missing = [];
  const invalid = [];
  const available = [];
  for (const doc of docs) {
    if (!doc || !doc.id) continue;
    const resolved = storage.resolve(doc);
    const key = String(doc.storageKey || doc.storedName || resolved?.storageKey || '').trim();
    if (key) references.set(key, (references.get(key) || 0) + 1);
    if (!resolved) missing.push({ id: doc.id, caseId: doc.caseId || '', name: doc.name || '', storageKey: key, status: doc.storageStatus || 'MISSING' });
    else if (doc.sha256 && !String(resolved.storageKey || '').includes(String(doc.sha256))) invalid.push({ id: doc.id, name: doc.name || '', reason: 'HASH_KEY_MISMATCH', storageKey: resolved.storageKey });
    else available.push({ id: doc.id, storageKey: resolved.storageKey, provider: resolved.provider, size: fs.statSync(resolved.fp).size });
  }
  const objects = storage.listObjects();
  const orphanObjects = objects.filter(object => !references.has(object.storageKey)).map(({ storageKey, size }) => ({ storageKey, size }));
  return {
    generatedAt: new Date().toISOString(),
    counts: { records: docs.filter(Boolean).length, available: available.length, missing: missing.length, invalid: invalid.length, objects: objects.length, orphanObjects: orphanObjects.length },
    missing,
    invalid,
    orphanObjects,
    available
  };
}
