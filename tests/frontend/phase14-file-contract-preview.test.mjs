import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fileService = fs.readFileSync(new URL('../../frontend/src/services/fileService.js', import.meta.url), 'utf8');
const storage = fs.readFileSync(new URL('../../backend/src/services/fileStorageService.js', import.meta.url), 'utf8');
const viewer = fs.readFileSync(new URL('../../frontend/src/components/files/UnifiedFileViewer.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../../frontend/src/components/chat/CommunicationHub.jsx', import.meta.url), 'utf8');

const extractQuotedArray = (source, name) => {
  const match = source.match(new RegExp(`${name}[^\\[]*\\[([\\s\\S]*?)\\]`));
  assert.ok(match, `${name} array missing`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(item => item[1].replace(/^\./, '')).sort();
};

test('browser upload extension contract exactly matches secure backend storage capability', () => {
  const frontend = extractQuotedArray(fileService, 'PROJECT_UPLOAD_EXTENSIONS');
  const backend = extractQuotedArray(storage, 'DEFAULT_ALLOWED_EXTENSIONS');
  assert.deepEqual(frontend, backend);
  assert.doesNotMatch(fileService, /zip\|rar\|7z|odt|ods|odp|dgn|aac|flac|m4v/);
  assert.match(fileService, /heic\|heif/);
});

test('all file pickers consume the canonical browser upload contract', () => {
  assert.match(app, /PROJECT_UPLOAD_ACCEPT/);
  assert.match(app, /PAYMENT_RECEIPT_ACCEPT/);
  assert.equal((app.match(/accept=\{PROJECT_UPLOAD_ACCEPT\}/g) || []).length, 3);
  assert.equal((app.match(/accept=\{PAYMENT_RECEIPT_ACCEPT\}/g) || []).length, 1);
  assert.match(chat, /accept=\{PROJECT_UPLOAD_ACCEPT\}/);
  assert.doesNotMatch(chat, /\.zip,\.rar/);
  assert.doesNotMatch(app, /No upload limit|Attach unlimited/);
});

test('expired, deleted, missing and quarantined records cannot recreate private links from their IDs', () => {
  assert.match(fileService, /unavailableStorageStatus = \(doc = \{\}\) => \['DELETED','EXPIRED','MISSING','QUARANTINED'\]/);
  assert.match(fileService, /getProjectFileDownloadUrl = \(doc = \{\}\) => \{\s*if \(!doc \|\| unavailableStorageStatus\(doc\)\) return '';/);
  assert.match(fileService, /getProjectFilePreviewUrl = \(doc = \{\}\) => \{\s*if \(!doc \|\| unavailableStorageStatus\(doc\)\) return '';/);
  assert.match(fileService, /normalized\.downloadUrl = ''/);
  assert.match(fileService, /normalized\.previewUrl = ''/);
});

test('PDF stream remains immediate while a parallel authoritative status probe surfaces missing/expired files', () => {
  const pdfStart = fileService.indexOf("if (kind === 'pdf')");
  const mediaStart = fileService.indexOf("if (['image', 'video', 'audio'].includes(kind))", pdfStart);
  assert.ok(pdfStart >= 0 && mediaStart > pdfStart);
  assert.doesNotMatch(fileService.slice(pdfStart, mediaStart), /await authFetch/);
  assert.match(fileService, /probeProjectFileAvailability/);
  assert.match(fileService, /\/api\/files\/\$\{encodeURIComponent\(id\)\}\/status/);
  assert.match(viewer, /if \(result\.optimisticStream\)/);
  assert.match(viewer, /probeProjectFileAvailability\(file, \{ signal:controller\.signal \}\)/);
  assert.match(viewer, /blank or browser-native iframe error page/);
});

test('server file id preview fallback accepts the same 80-character bound as download fallback', () => {
  const matches = [...fileService.matchAll(/\^\[A-Za-z0-9_-\]\{6,80\}\$/g)];
  assert.ok(matches.length >= 2, 'download and preview/status id fallbacks must share the 80-character bound');
  assert.doesNotMatch(fileService, /\{6,40\}/);
});
