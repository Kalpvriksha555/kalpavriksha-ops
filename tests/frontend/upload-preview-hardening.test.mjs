import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fileService = fs.readFileSync(new URL('../../frontend/src/services/fileService.js', import.meta.url), 'utf8');
const viewer = fs.readFileSync(new URL('../../frontend/src/components/files/UnifiedFileViewer.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../../frontend/src/components/chat/CommunicationHub.jsx', import.meta.url), 'utf8');
const profile = fs.readFileSync(new URL('../../frontend/src/components/profile/ProfileView.jsx', import.meta.url), 'utf8');
const profileUtils = fs.readFileSync(new URL('../../frontend/src/utils/profileUtils.js', import.meta.url), 'utf8');
const profileService = fs.readFileSync(new URL('../../frontend/src/services/profileService.js', import.meta.url), 'utf8');
const chatUtils = fs.readFileSync(new URL('../../frontend/src/utils/chatUtils.js', import.meta.url), 'utf8');

test('upload preflight rejects empty, oversized, unsupported, duplicate and excessive selections', () => {
  assert.match(fileService, /MAX_PROJECT_UPLOAD_BYTES = 100 \* 1024 \* 1024/);
  assert.match(fileService, /MAX_PROJECT_UPLOAD_FILES = 20/);
  assert.match(fileService, /FILE_EMPTY/);
  assert.match(fileService, /FILE_TOO_LARGE/);
  assert.match(fileService, /FILE_TYPE_NOT_ALLOWED/);
  assert.match(fileService, /was selected more than once/);
  assert.match(fileService, /Choose no more than/);
  assert.match(app, /MAX_PROJECT_UPLOAD_FILES - \(leadFiles \|\| \[\]\)\.length/);
});

test('upload response-loss retry identity survives File object recreation and clears only after confirmation', () => {
  assert.match(fileService, /LEGACY_UPLOAD_MUTATION_STORAGE_KEY = 'kalpavriksha_upload_mutations_v2'/);
  assert.match(fileService, /UPLOAD_MUTATION_STORAGE_KEYS = Object\.freeze\(\['kalpavriksha_upload_mutations_v3_a', 'kalpavriksha_upload_mutations_v3_b'\]\)/);
  assert.match(fileService, /uploadFingerprint = \(file, projectId = '', type = '', uploadedBy = '', scope = ''\)/);
  assert.match(fileService, /form\.append\('mutationId', mutation\.id\)/);
  const request = fileService.indexOf('const payload = await uploadWithXhr');
  const authoritative = fileService.indexOf("payload?.ok !== true || !authoritativeFileId", request);
  const clear = fileService.indexOf('clearUploadMutation(mutation.fingerprint)', request);
  assert.ok(request > 0 && authoritative > request && clear > authoritative);
  assert.match(fileService, /UPLOAD_RESPONSE_UNCONFIRMED/);
  assert.match(fileService, /UPLOAD_IDENTITY_STORAGE_UNAVAILABLE/);
  const durableGuard = fileService.indexOf('if (!mutation.durable)');
  assert.ok(durableGuard > 0 && durableGuard < fileService.indexOf("form.append('file', file)"));
});

test('uploads and downloads have progress, bounded deadlines and explicit cancellation', () => {
  assert.match(fileService, /xhr\.upload\.onprogress/);
  assert.match(fileService, /signal\?\.addEventListener\?\.\('abort'/);
  assert.match(fileService, /xhr\.timeout = 30 \* 60 \* 1000/);
  assert.match(fileService, /UPLOAD_RESPONSE_TIMEOUT_MS = 5 \* 60 \* 1000/);
  assert.match(fileService, /Download cancelled\./);
  assert.match(fileService, /reader\.cancel\(\)/);
  assert.match(app, /fileTransferAbortRef\.current = controller/);
  assert.match(app, /Download cancelled/);
});

test('large PDF and media previews stream directly rather than buffering the complete file', () => {
  assert.match(fileService, /if \(kind === 'pdf'\)/);
  assert.match(fileService, /\['image', 'video', 'audio'\]\.includes\(kind\)/);
  const pdfStart = fileService.indexOf("if (kind === 'pdf')");
  const mediaStart = fileService.indexOf("if (['image', 'video', 'audio'].includes(kind))");
  assert.ok(pdfStart > 0 && mediaStart > pdfStart);
  assert.doesNotMatch(fileService.slice(pdfStart, mediaStart), /method: 'HEAD'/);
  assert.match(fileService.slice(mediaStart), /method: 'HEAD'/);
  assert.match(fileService, /directStream: true/);
  assert.doesNotMatch(fileService, /fetchProjectFilePreview[\s\S]*\/preview-data/);
  assert.match(fileService, /MAX_TEXT_PREVIEW_BYTES = 2 \* 1024 \* 1024/);
  assert.match(fileService, /maxBytes: kind === 'text' \? MAX_TEXT_PREVIEW_BYTES : 0/);
  assert.match(fileService, /reader\.cancel\(\).*TEXT_PREVIEW_TOO_LARGE/s);
  assert.match(fileService, /if \(!reader\) \{[\s\S]*blob\.size > maxBytes[\s\S]*TEXT_PREVIEW_TOO_LARGE/);
});

test('the unified viewer owns every preview lifecycle and supports safe formats', () => {
  assert.match(viewer, /releaseProjectFilePreview/);
  assert.match(viewer, /kind === 'video'/);
  assert.match(viewer, /kind === 'audio'/);
  assert.match(viewer, /kind === 'text'/);
  assert.match(viewer, /\['office', 'cad', 'file'\]/);
  assert.match(viewer, /closeButtonRef\.current\?\.focus/);
  assert.match(viewer, /event\.key === 'Tab'/);
  assert.match(viewer, /previousFocusRef/);
  assert.match(viewer, /Cancel preview/);
  assert.match(viewer, /Cancel download/);
  assert.match(viewer, /downloadAbortRef/);
  assert.match(viewer, /completionConfirmed === false/);
  assert.match(viewer, /Retry preview/);
  assert.equal((app.match(/<UnifiedFileViewer /g) || []).length, 2);
});

test('new task source files continue in a visible cancelable background batch with partial retry', () => {
  assert.match(app, /runCreatedTaskSourceUploads/);
  assert.match(app, /createdTaskUploadAbortRef/);
  assert.match(app, /beforeunload/);
  assert.match(app, /Retry \{createdTaskUpload\.failedFiles\.length\}/);
  assert.match(app, /confirmed file/);
  assert.match(app, /Keep this browser tab open/);
});

test('chat retries message delivery without reuploading a file already confirmed by the server', () => {
  assert.match(chat, /uploadedFileMeta = null/);
  assert.match(chat, /let fileMeta = uploadedFileMeta/);
  assert.match(chat, /fileMeta = await uploadChatFileToServer\(file, target, extra, controller\.signal\)/);
  assert.match(chat, /await onSendMessage\(buildAttachmentMessage/);
  assert.match(chat, /error\.uploadedFileMeta = fileMeta/);
  assert.match(chat, /Retry sends only the message/);
  assert.doesNotMatch(chat, /localPreviewOnly:\s*true/);
});

test('profile photo preflight matches the five megabyte backend contract', () => {
  assert.match(profile, /MAX_PROFILE_PHOTO_BYTES = 5 \* 1024 \* 1024/);
  assert.match(profile, /The selected image is empty/);
  assert.match(profile, /Profile photos must be no larger than 5 MB/);
  assert.match(profile, /\.png,\.jpg,\.jpeg,\.gif,\.webp,\.bmp/);
});

test('payment receipts are constrained to PDF or image in both selection and upload service paths', () => {
  assert.match(app, /validateProjectUploadSelection\(event\?\.target\?\.files, \{ maxFiles: 1, allowedKinds: \['pdf', 'image'\] \}\)/);
  assert.match(fileService, /normalizedType === 'payment-receipt' \? \{ allowedKinds: PAYMENT_RECEIPT_KINDS \}/);
});

test('private file links fail closed for external and unrelated same-origin routes while retaining server-id fallback', () => {
  assert.match(fileService, /isTrustedNetworkUrl/);
  assert.match(fileService, /if \(!isTrustedNetworkUrl\(value\)\) return ''/);
  assert.match(fileService, /isAllowedPrivateFileUrl/);
  assert.match(fileService, /const fileMatch = parsed\.pathname\.match/);
  assert.match(fileService, /const legacyMatch = parsed\.pathname\.match/);
  assert.match(fileService, /const authoritativeFileId/);
  assert.match(fileService, /looksLikeServerFileId \? `\$\{API_BASE\}\/api\/files/);
  assert.match(chatUtils, /isAllowedPrivateFileUrl/);
});

test('legacy inline previews are size bounded before base64 decoding', () => {
  assert.match(fileService, /MAX_INLINE_DATA_URL_BYTES = 15 \* 1024 \* 1024/);
  const estimate = fileService.indexOf('const estimatedBytes');
  const decode = fileService.indexOf('const binary = atob(body)');
  assert.ok(estimate > 0 && decode > estimate);
  assert.match(fileService, /INLINE_PREVIEW_TOO_LARGE/);
});

test('download completion distinguishes durable cache success from browser-only fallback', () => {
  assert.match(fileService, /cached: Boolean\(cachedMeta\)/);
  assert.match(fileService, /completionConfirmed: false/);
  assert.match(app, /Browser download started\. Confirm completion in your browser downloads list/);
  assert.match(app, /Browser storage was unavailable/);
});

test('voice-note WebM records remain audio even when legacy MIME metadata is blank', () => {
  assert.match(fileService, /extension === 'webm' && \/\(voice\|audio\)\//);
});


test('upload mutation durability is mirrored, bounded and target scoped', () => {
  assert.match(fileService, /schemaVersion: 3/);
  assert.match(fileService, /UPLOAD_MUTATION_MAX_RECORDS = 500/);
  assert.match(fileService, /UPLOAD_IDENTITY_CAPACITY_REACHED/);
  assert.match(fileService, /Object\.keys\(next\)\.length >= UPLOAD_MUTATION_MAX_RECORDS/);
  assert.match(fileService, /scope = ''/);
  assert.match(fileService, /options\?\.chatScope, options\?\.recipientId, options\?\.recipientUsername, options\?\.recipient/);
  assert.match(fileService, /options\?\.isVoiceNote \? 'voice-note' : ''/);
  assert.match(fileService, /addEventListener\?\.\('storage'/);
});

test('chat attachment upload freezes its destination, supports cancellation and uses tracked downloads', () => {
  assert.match(chat, /captureAttachmentTarget/);
  assert.match(chat, /target: captureAttachmentTarget\(\)/);
  assert.match(chat, /voiceTargetRef\.current = captureAttachmentTarget\(\)/);
  assert.match(chat, /attachmentUploadAbortRef\.current\?\.abort/);
  assert.match(chat, /stage === 'upload'/);
  assert.match(chat, /window\.addEventListener\('beforeunload'/);
  assert.match(chat, /typeof onDownloadFile === 'function'/);
  assert.match(chatUtils, /absoluteApiUrl\(value\)/);
  assert.match(chatUtils, /isAllowedPrivateFileUrl/);
  assert.doesNotMatch(chatUtils, /\^\(blob:\|data:\|https\?:\)/);
});

test('profile photo upload has real progress, cancellation and no base64 buffering', () => {
  assert.match(profileService, /new XMLHttpRequest\(\)/);
  assert.match(profileService, /xhr\.upload\.onprogress/);
  assert.match(profileService, /signal\.addEventListener\('abort'/);
  assert.match(profile, /photoUploadAbortRef/);
  assert.match(profile, /photoProgress/);
  assert.match(profile, /URL\.createObjectURL\(file\)/);
  assert.doesNotMatch(profile, /fileToBase64/);
  assert.doesNotMatch(app, /fileToBase64|cleanFileName|utils\/fileUtils/);
});

test('file transfer completion timers cannot erase a newer transfer and download results reach the viewer', () => {
  assert.match(app, /fileTransferGenerationRef/);
  assert.match(app, /if \(fileTransferGenerationRef\.current !== generation\) return/);
  assert.doesNotMatch(app, /setTimeout\(\(\) => resetFileTransfer\(\)/);
  assert.match(app, /return \{ ok:true, \.\.\.result \}/);
  assert.match(app, /return \{ ok:false, error, cancelled \}/);
  assert.match(app, /onDownloadFile=\{handleTrackedDownload\}/);
});


test('upload identity creation is cross-tab serialized and scoped to immutable actor identity when available', () => {
  assert.match(fileService, /navigator\?\.locks/);
  assert.match(fileService, /UPLOAD_MUTATION_LOCK_KEY/);
  assert.match(fileService, /verified\?\.token === token/);
  assert.match(fileService, /UPLOAD_IDENTITY_LOCK_TIMEOUT/);
  assert.match(fileService, /kalpavriksha-upload-mutation-ledger-v3/);
  assert.match(fileService, /options\?\.actorId \|\| options\?\.actorUsername \|\| uploadedBy/);
  assert.match(fileService, /alternateFingerprints/);
  assert.match(fileService, /\[options\?\.actorUsername, uploadedBy\]/);
  assert.match(app, /actorId:\s*(?:currentUser|user)\.?id/);
  assert.match(chat, /actorId:\s*currentUser\?\.id/);
});

test('older browsers do not buffer an entire private download when response streaming is unavailable', () => {
  const fallback = fileService.slice(fileService.indexOf('if (!reader) {', fileService.indexOf('export const downloadProjectFile')), fileService.indexOf('const chunks = []', fileService.indexOf('export const downloadProjectFile')));
  assert.match(fallback, /triggerBrowserDownload\(url, fileName\)/);
  assert.match(fallback, /method: 'browser-native'/);
  assert.match(fallback, /completionConfirmed: false/);
  assert.doesNotMatch(fallback, /await res\.blob\(\)/);
});

test('private downloaded-file cache uses actor scope and a collision-resistant resource identity', () => {
  assert.match(fileService, /kalpavriksha_downloaded_file_index_v3/);
  assert.match(fileService, /0xcbf29ce484222325n/);
  assert.match(fileService, /0x100000001b3n/);
  assert.match(fileService, /return resourceKey \? `\$\{activeFileCacheActor\}::/);
});


test('profile-photo rendering blocks external trackers and active inline payloads', () => {
  assert.match(profileUtils, /SAFE_INLINE_PROFILE_PHOTO/);
  assert.match(profileUtils, /MAX_LEGACY_INLINE_PROFILE_PHOTO_CHARS/);
  assert.match(profileUtils, /if \(!url\.startsWith\('\/api\/profile\/photo\/'\)\) return ''/);
  assert.match(profileUtils, /else \{\s*return '';\s*\}/s);
  assert.doesNotMatch(profileUtils, /return url;\s*\/\/ external/);
});

test('file cache actor scope is set globally without render-time storage side effects', () => {
  assert.match(app, /useEffect\(\(\) => \{ setProjectFileCacheActor\(currentUser \|\| \{\}\); \}, \[currentUser\?\.id, currentUser\?\.username, currentUser\?\.name\]\)/);
  const taskDetailStart = app.indexOf('const TaskDetailView =');
  const taskDetailHooks = app.indexOf('const financeActorId', taskDetailStart);
  assert.ok(taskDetailStart > 0 && taskDetailHooks > taskDetailStart);
  assert.doesNotMatch(app.slice(taskDetailStart, taskDetailHooks), /setProjectFileCacheActor\(/);
  assert.match(fileService, /if \(nextActor === activeFileCacheActor\) return activeFileCacheActor/);
});

test('preview metadata preserves the original filename while extension checks remain case insensitive', () => {
  assert.match(fileService, /const getProjectFileName = \(doc = \{\}\) => String\([^\n]+\)\.trim\(\);/);
  assert.match(fileService, /getProjectFileName\(doc\)\.split\('\.'\)\.pop\(\)\?\.toLowerCase\(\)/);
  assert.doesNotMatch(fileService, /const getProjectFileName[^\n]+toLowerCase/);
});

test('large browser downloads bypass multi-copy JavaScript buffering', () => {
  assert.match(fileService, /MAX_TRACKED_BROWSER_DOWNLOAD_BYTES = 32 \* 1024 \* 1024/);
  assert.match(fileService, /declaredSize > MAX_TRACKED_BROWSER_DOWNLOAD_BYTES/);
  assert.match(fileService, /method: 'browser-native-large'/);
  const largeGuard = fileService.indexOf('declaredSize > MAX_TRACKED_BROWSER_DOWNLOAD_BYTES');
  const chunks = fileService.indexOf('const chunks = []', fileService.indexOf('export const downloadProjectFile'));
  assert.ok(largeGuard > 0 && chunks > largeGuard);
});

test('WhatsApp Web preparation is memory bounded and does not falsely record delivery', () => {
  assert.match(app, /MAX_NATIVE_SHARE_BYTES = 32 \* 1024 \* 1024/);
  assert.match(app, /await handleTrackedDownload\(docToShare\)/);
  assert.match(app, /then use “Mark as sent” to record actual delivery/);
  assert.doesNotMatch(app, /recordCompletedFileSent\(fileName, 'WhatsApp Web'/);
  assert.match(app, /recordCompletedFileSent\(fileName, 'Native file share completed'/);
});
