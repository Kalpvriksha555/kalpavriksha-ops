import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const DEFAULT_ALLOWED_EXTENSIONS = Object.freeze([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.heif',
  '.dwg', '.dxf', '.xlsx', '.xls', '.csv', '.docx', '.doc', '.rtf', '.pptx', '.ppt', '.txt',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.mp3', '.wav', '.m4a', '.ogg'
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
  '.ppt': 'application/vnd.ms-powerpoint', '.txt': 'text/plain',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg'
});

const OOXML_EXTENSIONS = new Set(['.xlsx', '.docx', '.pptx']);
const OLE_EXTENSIONS = new Set(['.xls', '.doc', '.ppt']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.heif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg']);
const FILE_QUARANTINE_RETENTION_MS = Number(process.env.FILE_QUARANTINE_RETENTION_MS || 7 * 24 * 60 * 60 * 1000);
const FILE_QUARANTINE_MAX_BYTES = Number(process.env.FILE_QUARANTINE_MAX_BYTES || 512 * 1024 * 1024);
const FILE_STORAGE_HEALTH_CACHE_MS = Number(process.env.FILE_STORAGE_HEALTH_CACHE_MS || 30 * 1000);
const FILE_INCOMING_RETENTION_MS = Number(process.env.FILE_INCOMING_RETENTION_MS || 60 * 60 * 1000);

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
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
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
  const isoBrand = buffer.subarray(4, 32).toString('ascii');
  if (/ftyp(?:heic|heif|heix|hevc|mif1|msf1)/.test(isoBrand)) return { family: 'image', mime: MIME_BY_EXTENSION[extension] || 'image/heic' };
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return { family: extension === '.webm' ? 'webm' : 'matroska', mime: MIME_BY_EXTENSION[extension] || 'video/webm' };
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return { family: 'wav', mime: 'audio/wav' };
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'AVI ') return { family: 'avi', mime: 'video/x-msvideo' };
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return { family: 'ogg', mime: 'audio/ogg' };
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3' || startsWith(buffer, [0xff, 0xfb]) || startsWith(buffer, [0xff, 0xf3]) || startsWith(buffer, [0xff, 0xf2])) return { family: 'mp3', mime: 'audio/mpeg' };
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return { family: 'iso-media', mime: MIME_BY_EXTENSION[extension] || 'application/octet-stream' };
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
  if (extension === '.webm') return signature.family === 'webm';
  if (extension === '.mkv') return signature.family === 'matroska' || signature.family === 'webm';
  if (extension === '.wav') return signature.family === 'wav';
  if (extension === '.avi') return signature.family === 'avi';
  if (extension === '.ogg') return signature.family === 'ogg';
  if (extension === '.mp3') return signature.family === 'mp3';
  if (['.mp4', '.mov', '.m4a'].includes(extension)) return signature.family === 'iso-media';
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

function readZipCentralDirectoryNames(filePath) {
  const stat = fs.statSync(filePath);
  const tailSize = Math.min(stat.size, 65_557 + 22);
  const fd = fs.openSync(filePath, 'r');
  try {
    const tail = Buffer.alloc(tailSize);
    fs.readSync(fd, tail, 0, tailSize, Math.max(0, stat.size - tailSize));
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return [];
    const totalEntries = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (!Number.isFinite(centralOffset) || !Number.isFinite(centralSize) || centralOffset + centralSize > stat.size) return [];
    const central = Buffer.alloc(centralSize);
    fs.readSync(fd, central, 0, centralSize, centralOffset);
    const names = [];
    let offset = 0;
    for (let entry = 0; entry < totalEntries && offset + 46 <= central.length; entry += 1) {
      if (central.readUInt32LE(offset) !== 0x02014b50) return [];
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32);
      const nameStart = offset + 46;
      const nameEnd = nameStart + nameLength;
      if (nameEnd > central.length) return [];
      names.push(central.subarray(nameStart, nameEnd).toString('utf8'));
      offset = nameEnd + extraLength + commentLength;
    }
    return names;
  } finally {
    fs.closeSync(fd);
  }
}

function validateStructuredContainer(filePath, extension) {
  if (!OOXML_EXTENSIONS.has(extension)) return true;
  const names = readZipCentralDirectoryNames(filePath);
  if (!names.length) return false;
  const expectedFolder = extension === '.docx' ? 'word/' : extension === '.xlsx' ? 'xl/' : 'ppt/';
  return names.includes('[Content_Types].xml') && names.some(name => name.startsWith(expectedFolder));
}

function safeStoragePath(root, storageKey) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, String(storageKey || ''));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return resolved;
}

export function createFileStorage(options = {}) {
  options = options && typeof options === 'object' ? options : {};
  const root = path.resolve(options.root || path.join(process.cwd(), 'private-files'));
  const antivirusMode = String(options.antivirusMode ?? process.env.FILE_ANTIVIRUS_MODE ?? 'disabled').trim().toLowerCase();
  const antivirusRequired = options.antivirusRequired ?? String(process.env.FILE_ANTIVIRUS_REQUIRED || '').trim().toLowerCase() === 'true';
  const clamScanPath = String(options.clamScanPath || process.env.CLAMSCAN_PATH || 'clamscan').trim();
  const tempRoot = path.resolve(options.tempRoot || path.join(root, '.incoming'));
  const objectsRoot = path.resolve(options.objectsRoot || path.join(root, 'objects'));
  const quarantineRoot = path.resolve(options.quarantineRoot || path.join(root, 'quarantine'));
  const trashRoot = path.resolve(options.trashRoot || path.join(root, 'trash'));
  const locksRoot = path.resolve(options.locksRoot || path.join(root, '.leases'));
  const requestedLeaseMaxAgeMs = Number(options.leaseMaxAgeMs || process.env.FILE_STORAGE_LEASE_MAX_AGE_MS || 30 * 60 * 1000);
  const leaseMaxAgeMs = Number.isFinite(requestedLeaseMaxAgeMs) ? Math.max(60_000, requestedLeaseMaxAgeMs) : 30 * 60 * 1000;
  const legacyRoots = [...new Set((options.legacyRoots || []).filter(Boolean).map(item => path.resolve(item)))];
  const allowedExtensions = new Set((options.allowedExtensions || DEFAULT_ALLOWED_EXTENSIONS).map(value => String(value).toLowerCase().startsWith('.') ? String(value).toLowerCase() : `.${String(value).toLowerCase()}`));
  const incomingRetentionMs = Math.max(60_000, Number(options.incomingRetentionMs || FILE_INCOMING_RETENTION_MS));
  const quarantineRetentionMs = Math.max(60_000, Number(options.quarantineRetentionMs || FILE_QUARANTINE_RETENTION_MS));
  const quarantineMaxBytes = Math.max(1024 * 1024, Number(options.quarantineMaxBytes || FILE_QUARANTINE_MAX_BYTES));
  const healthCacheMs = Math.max(1_000, Number(options.healthCacheMs || FILE_STORAGE_HEALTH_CACHE_MS));
  let objectCountCache = { at:0, value:0 };

  [root, tempRoot, objectsRoot, quarantineRoot, trashRoot, locksRoot].forEach(mkdirPrivate);

  function pruneIncoming(referenceTime = Date.now()) {
    const cutoff = referenceTime - incomingRetentionMs;
    for (const name of fs.readdirSync(tempRoot)) {
      const fp = path.join(tempRoot, name);
      try {
        const stat = fs.statSync(fp);
        if (stat.isFile() && stat.mtimeMs < cutoff) fs.unlinkSync(fp);
      } catch {}
    }
  }

  function pruneQuarantine(referenceTime = Date.now()) {
    const files = [];
    const walk = directory => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
        const fp = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(fp);
        else if (entry.isFile()) { try { const stat=fs.statSync(fp); files.push({ fp, size:stat.size, mtimeMs:stat.mtimeMs }); } catch {} }
      }
    };
    walk(quarantineRoot);
    const cutoff = referenceTime - quarantineRetentionMs;
    for (const item of files.filter(item => item.mtimeMs < cutoff)) { try { fs.unlinkSync(item.fp); } catch {} }
    const remaining = files.filter(item => item.mtimeMs >= cutoff).sort((a,b)=>b.mtimeMs-a.mtimeMs);
    let total = remaining.reduce((sum,item)=>sum+item.size,0);
    for (const item of [...remaining].reverse()) {
      if (total<=quarantineMaxBytes) break;
      try { fs.unlinkSync(item.fp); total -= item.size; } catch {}
    }
  }

  pruneIncoming();
  pruneQuarantine();

  function tempDestination() {
    mkdirPrivate(tempRoot);
    return tempRoot;
  }


  function leaseDirectory(storageKey = '') {
    const digest = crypto.createHash('sha256').update(String(storageKey || '')).digest('hex');
    return path.join(locksRoot, digest.slice(0, 2), digest);
  }

  function pruneStaleLeases(storageKey = '') {
    const directory = leaseDirectory(storageKey);
    if (!fs.existsSync(directory)) return 0;
    let removed = 0;
    const cutoff = Date.now() - leaseMaxAgeMs;
    for (const name of fs.readdirSync(directory)) {
      const fp = path.join(directory, name);
      try {
        const stat = fs.statSync(fp);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.unlinkSync(fp);
          removed += 1;
        }
      } catch {}
    }
    try { if (!fs.readdirSync(directory).length) fs.rmdirSync(directory); } catch {}
    return removed;
  }

  async function acquireLease(storageKey = '', metadata = {}) {
    const key = String(storageKey || '').trim();
    if (!key.startsWith('objects/')) return () => {};
    const directory = leaseDirectory(key);
    const gcLockPath = path.join(directory, '.gc-lock');
    for (let attempt = 0; attempt < 40; attempt += 1) {
      pruneStaleLeases(key);
      mkdirPrivate(directory);
      if (fs.existsSync(gcLockPath)) {
        await new Promise(resolve => setTimeout(resolve, 25));
        continue;
      }
      const leasePath = path.join(directory, `${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.lease`);
      try {
        fs.writeFileSync(leasePath, JSON.stringify({ storageKey:key, pid:process.pid, createdAt:new Date().toISOString(), ...metadata }), { mode:0o600, flag:'wx' });
      } catch {
        await new Promise(resolve => setTimeout(resolve, 25));
        continue;
      }
      // A collector may have acquired its exclusive marker between our first
      // check and the lease-file creation. Relinquish and retry in that case.
      if (fs.existsSync(gcLockPath)) {
        try { fs.unlinkSync(leasePath); } catch {}
        await new Promise(resolve => setTimeout(resolve, 25));
        continue;
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try { fs.unlinkSync(leasePath); } catch {}
        try { if (fs.existsSync(directory) && !fs.readdirSync(directory).length) fs.rmdirSync(directory); } catch {}
      };
    }
    throw new FileValidationError('FILE_STORAGE_BUSY', 'Private file storage is completing recoverable cleanup. Please retry the upload.', 503);
  }

  function hasActiveLease(storageKey = '') {
    const key = String(storageKey || '').trim();
    if (!key.startsWith('objects/')) return false;
    pruneStaleLeases(key);
    const directory = leaseDirectory(key);
    try { return fs.existsSync(directory) && fs.readdirSync(directory).some(name => name.endsWith('.lease')); }
    catch { return true; }
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
    pruneQuarantine();
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
    const releaseStorageLease = context.acquireLease
      ? await acquireLease(storageKey, { purpose:String(context.purpose || '').toUpperCase() })
      : null;
    try {
      const destination = safeStoragePath(root, storageKey);
      if (!destination) throw new FileValidationError('INVALID_STORAGE_KEY', 'A secure storage key could not be generated.', 500);
      mkdirPrivate(path.dirname(destination));
      let deduplicated = false;
      let repairedCorruptObject = false;
      if (fs.existsSync(destination)) {
        const existingStat = fs.statSync(destination);
        const existingHash = existingStat.size === stat.size ? await sha256File(destination) : '';
        if (existingStat.size === stat.size && existingHash === sha256) {
          deduplicated = true;
          fs.unlinkSync(file.path);
        } else {
          const repairPath = `${destination}.repair-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
          fs.renameSync(file.path, repairPath);
          try { fs.chmodSync(repairPath, 0o600); } catch {}
          fs.renameSync(repairPath, destination);
          repairedCorruptObject = true;
        }
      } else {
        fs.renameSync(file.path, destination);
        try { fs.chmodSync(destination, 0o600); } catch {}
      }
      objectCountCache.at = 0;
      const result = {
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
        repairedCorruptObject,
        storedAt: new Date().toISOString(),
        purpose: String(context.purpose || '').toUpperCase()
      };
      if (releaseStorageLease) Object.defineProperty(result, 'releaseStorageLease', { value:releaseStorageLease, enumerable:false });
      return result;
    } catch (error) {
      try { releaseStorageLease?.(); } catch {}
      throw error;
    }
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
    const key = String(storageKey || '').trim();
    if (!key.startsWith('objects/')) return null;
    pruneStaleLeases(key);
    const directory = leaseDirectory(key);
    mkdirPrivate(directory);
    const gcLockPath = path.join(directory, '.gc-lock');
    let lockFd;
    try { lockFd = fs.openSync(gcLockPath, 'wx', 0o600); }
    catch { return null; }
    try {
      if (hasActiveLease(key)) return null;
      const source = safeStoragePath(root, key);
      if (!source || !fs.existsSync(source)) return null;
      const date = new Date().toISOString().slice(0, 10);
      const targetDirectory = path.join(trashRoot, date);
      mkdirPrivate(targetDirectory);
      const target = path.join(targetDirectory, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${path.basename(source)}`);
      fs.renameSync(source, target);
      try {
        fs.writeFileSync(`${target}.json`, JSON.stringify({ storageKey:key, deletedAt: new Date().toISOString(), ...metadata }, null, 2), { mode: 0o600 });
      } catch (error) {
        try { fs.renameSync(target, source); } catch {}
        throw error;
      }
      return target;
    } finally {
      try { if (lockFd !== undefined) fs.closeSync(lockFd); } catch {}
      try { fs.unlinkSync(gcLockPath); } catch {}
      try { if (fs.existsSync(directory) && !fs.readdirSync(directory).length) fs.rmdirSync(directory); } catch {}
    }
  }

  function health() {
    const probe = path.join(root, `.probe-${process.pid}-${Date.now()}`);
    try {
      fs.writeFileSync(probe, 'ok', { mode: 0o600 });
      fs.unlinkSync(probe);
      if (!objectCountCache.at || Date.now() - objectCountCache.at >= healthCacheMs) {
        objectCountCache = { at:Date.now(), value:listObjects().length };
      }
      return { ok: true, root, writable: true, objects: objectCountCache.value, antivirusMode, antivirusRequired };
    } catch (error) {
      return { ok: false, root, writable: false, error: error.message, antivirusMode, antivirusRequired };
    }
  }

  return { root, tempRoot, objectsRoot, quarantineRoot, trashRoot, locksRoot, allowedExtensions, antivirusMode, antivirusRequired, tempDestination, validateAndStore, resolve, importLegacyFile, listObjects, acquireLease, hasActiveLease, softDelete, health, quarantine, pruneIncoming, pruneQuarantine };
}

export function buildFileReconciliationReport(state = {}, storage, options = {}) {
  state = state && typeof state === 'object' ? state : {};
  options = options && typeof options === 'object' ? options : {};
  const docs = Array.isArray(options.docs) ? options.docs : (Array.isArray(state.files) ? state.files : []);
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
