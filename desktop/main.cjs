const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const APP_NAME = 'Kalpavriksha Ops';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let mainWindow;

const cacheRoot = () => path.join(app.getPath('userData'), 'file-cache');
const metaPath = () => path.join(cacheRoot(), 'metadata.json');

const safeFileName = (name = 'download') => String(name || 'download')
  .replace(/[\\/:*?"<>|]+/g, '_')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 180) || 'download';

const hashKey = (key = '') => require('crypto').createHash('sha256').update(String(key || '')).digest('hex').slice(0, 24);

const readMeta = async () => {
  try { return JSON.parse(await fsp.readFile(metaPath(), 'utf8')) || {}; } catch { return {}; }
};

const writeMeta = async (meta) => {
  await fsp.mkdir(cacheRoot(), { recursive: true });
  await fsp.writeFile(metaPath(), JSON.stringify(meta || {}, null, 2));
};

const getCachedEntry = async (key) => {
  const meta = await readMeta();
  const entry = meta[key];
  if (!entry) return null;
  const fresh = Number(entry.expiresAt || 0) > Date.now();
  const exists = entry.path && fs.existsSync(entry.path);
  if (fresh && exists) return entry;
  delete meta[key];
  await writeMeta(meta);
  return null;
};

const pruneExpired = async () => {
  const meta = await readMeta();
  let changed = false;
  for (const [key, entry] of Object.entries(meta)) {
    const expired = Number(entry.expiresAt || 0) <= Date.now();
    const missing = !entry.path || !fs.existsSync(entry.path);
    if (expired || missing) {
      if (entry.path && fs.existsSync(entry.path)) await fsp.unlink(entry.path).catch(() => {});
      delete meta[key];
      changed = true;
    }
  }
  if (changed) await writeMeta(meta);
  return meta;
};

const sendProgress = (transferId, data) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('kv:file:progress', { transferId, ...data });
};

const downloadToFile = ({ transferId, url, targetPath, fileName, expectedSize }) => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const client = parsed.protocol === 'https:' ? https : http;
  const startedAt = Date.now();

  const request = client.get(parsed, { headers: { 'Cache-Control': 'no-store' } }, (response) => {
    if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
      response.resume();
      return resolve(downloadToFile({ transferId, url: new URL(response.headers.location, parsed).toString(), targetPath, fileName, expectedSize }));
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => reject(new Error(body || `Download failed (${response.statusCode})`)));
      return;
    }

    const total = Number(response.headers['content-length'] || expectedSize || 0);
    let loaded = 0;
    const stream = fs.createWriteStream(targetPath);
    response.on('data', (chunk) => {
      loaded += chunk.length;
      const elapsedSeconds = Math.max(0.5, (Date.now() - startedAt) / 1000);
      const speedBps = loaded / elapsedSeconds;
      const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
      const remainingBytes = total > loaded ? total - loaded : 0;
      const etaSeconds = speedBps > 0 && remainingBytes > 0 ? Math.ceil(remainingBytes / speedBps) : 0;
      sendProgress(transferId, { percent, loaded, total, speedBps, etaSeconds, fileName });
    });
    response.pipe(stream);
    stream.on('finish', () => stream.close(() => resolve({ size: loaded, mimeType: response.headers['content-type'] || 'application/octet-stream' })));
    stream.on('error', reject);
  });
  request.on('error', reject);
  request.setTimeout(30 * 60 * 1000, () => request.destroy(new Error('Download timed out. Please try again on a stable connection.')));
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: APP_NAME,
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  const devUrl = process.env.KV_DESKTOP_DEV_URL || process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    const indexPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
    mainWindow.loadFile(indexPath);
  }
}

app.whenReady().then(async () => {
  await pruneExpired().catch(() => {});
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('kv:file:prune-expired', async () => {
  await pruneExpired();
  return { ok: true };
});

ipcMain.handle('kv:file:open-cached', async (_event, payload = {}) => {
  const key = String(payload.key || '');
  if (!key) return { ok: false, message: 'File cache key missing.' };
  const entry = await getCachedEntry(key);
  if (!entry) return { ok: false, message: 'Downloaded copy is missing or expired.' };
  const result = await shell.openPath(entry.path);
  if (result) return { ok: false, message: result };
  return { ok: true, path: entry.path };
});

ipcMain.handle('kv:file:clear-cached', async (_event, payload = {}) => {
  const key = String(payload.key || '');
  if (!key) return { ok: true };
  const meta = await readMeta();
  const entry = meta[key];
  if (entry?.path && fs.existsSync(entry.path)) await fsp.unlink(entry.path).catch(() => {});
  delete meta[key];
  await writeMeta(meta);
  return { ok: true };
});

ipcMain.handle('kv:file:download-open', async (_event, payload = {}) => {
  const key = String(payload.key || '');
  const url = String(payload.url || '');
  const transferId = String(payload.transferId || '');
  const fileName = safeFileName(payload.fileName || 'download');
  if (!key || !url) return { ok: false, message: 'File download information is incomplete.' };

  await fsp.mkdir(cacheRoot(), { recursive: true });
  const existing = await getCachedEntry(key);
  if (existing) {
    const openResult = await shell.openPath(existing.path);
    if (openResult) return { ok: false, message: openResult };
    return { ok: true, openedExisting: true, size: existing.size || 0, mimeType: existing.mimeType || payload.mimeType || 'application/octet-stream' };
  }

  const ext = path.extname(fileName);
  const targetName = `${hashKey(key)}-${fileName}`;
  const targetPath = path.join(cacheRoot(), targetName || `${hashKey(key)}${ext || '.file'}`);
  sendProgress(transferId, { percent: 1, loaded: 0, total: Number(payload.size || 0), fileName, etaSeconds: 0 });
  const result = await downloadToFile({ transferId, url, targetPath, fileName, expectedSize: Number(payload.size || 0) });

  const meta = await readMeta();
  meta[key] = {
    key,
    name: fileName,
    path: targetPath,
    size: result.size || 0,
    mimeType: result.mimeType || payload.mimeType || 'application/octet-stream',
    savedAt: Date.now(),
    expiresAt: Date.now() + Number(payload.ttlMs || CACHE_TTL_MS),
  };
  await writeMeta(meta);
  sendProgress(transferId, { percent: 100, loaded: result.size || 0, total: result.size || 0, fileName, etaSeconds: 0 });

  const openResult = await shell.openPath(targetPath);
  if (openResult) return { ok: false, message: openResult };
  return { ok: true, openedExisting: false, size: result.size || 0, mimeType: result.mimeType || payload.mimeType || 'application/octet-stream' };
});
