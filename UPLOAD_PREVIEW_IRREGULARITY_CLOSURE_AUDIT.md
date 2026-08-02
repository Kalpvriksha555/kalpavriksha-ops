# Kalpavriksha 1.9.24 Upload and Preview Irregularity Closure Audit

Date: 2 August 2026

## Scope

This audit reviewed the complete private-file lifecycle across task source, work, final and revision files; new-task attachments; payment receipts; profile photos; chat attachments and voice notes; previews; downloads; browser/desktop cache; retry identity; cancellation; deletion; private storage; and the latest-changes deployment path.

## Confirmed irregularities closed

### Packaging and environment consistency

- The clean source package again includes a safe `backend/.env.example` with local placeholders, canonical upload/file-storage limits and no production host or real secret.
- The targeted deployment preflight refuses a source commit that is missing this template.

### Upload identity and retry safety

- Upload retry identities are now mirrored, generation-versioned, actor/task/type/target scoped and serialized across tabs.
- Safari and older browsers use a verified expiring storage lease when Web Locks are unavailable.
- Actor identity migrates from older username/display-name fingerprints to immutable user IDs without losing a response-loss retry identity.
- The browser refuses a new upload before network transfer when it cannot durably store the mutation identity or when 500 unresolved identities already exist. It no longer silently evicts an unresolved identity.
- Upload identities clear only after an authoritative `ok:true` response containing a server file ID.
- Chat message retry reuses an already confirmed file instead of uploading the binary again.
- Backend upload idempotency is actor and destination scoped, including chat target and voice-note evidence.

### Validation and storage consistency

- Frontend and backend now share the same 100 MB per-file and 20-file selection caps.
- The obsolete second Multer upload middleware with conflicting limits was removed.
- Empty, unsupported, duplicate and excessive selections fail before transfer.
- Payment receipts accept only PDF or approved image formats.
- Profile photos accept only PNG, JPG, GIF, WebP or BMP and remain capped at 5 MB.
- Active HTML, script, SVG and executable formats remain excluded.
- HEIC/HEIF, WebM, WAV, OGG, MP3, RIFF and ISO-media signatures are classified consistently.
- OOXML files are checked through their central directory and expected package folder rather than trusting a ZIP header alone.
- Stored filenames remove path separators, control characters, bidirectional controls and zero-width characters while preserving safe Unicode display names.
- Preview metadata preserves the original filename casing; only extension comparison is case-insensitive.

### Content-addressed object integrity

- A deduplicated destination is no longer trusted solely because its path exists.
- Existing object size and SHA-256 are verified before the good retry is discarded.
- A valid retry atomically repairs a corrupted content-addressed object and records the repair evidence.
- Old incoming temporary files and bounded quarantine artifacts are cleaned without touching current uploads or committed business rows.
- Request-close cleanup removes temporary multipart files without releasing a storage lease while an asynchronous handler can still commit.

### Private URL and authorization safety

- File URLs fail closed unless they use the configured API origin and an approved private-file route.
- External URLs, protocol-relative URLs and unrelated same-origin API routes cannot be used as preview or download links.
- Server file IDs remain the authoritative fallback when legacy URL metadata is missing.
- Profile-photo rendering blocks external trackers, SVG/HTML payloads and arbitrary data URLs; only own profile-photo routes, temporary blob previews and bounded raster legacy data are accepted.
- Preview and download routes use one authorization and delivery helper with no-store, nosniff, safe disposition and range support.

### Preview correctness and resource use

- PDF, image, video and audio previews use an authenticated authorization probe and direct streaming rather than base64 or full-memory buffering.
- Text preview is capped at 2 MB.
- Legacy inline preview data is capped before base64 decoding, and the backend legacy endpoint is capped at 15 MB.
- Unsafe or mismatched inline MIME types fail closed.
- Office and CAD remain private metadata-only previews and are never sent to an external viewer.
- One shared viewer owns focus trapping/restoration, Escape handling, cancellation, retry, image transformations, embedded-media errors and object-URL cleanup.

### Download and sharing truthfulness

- Browser downloads have tracked progress, speed, ETA and real stream cancellation for safely buffered sizes.
- Files above 32 MB bypass multi-copy JavaScript buffering and are handed to the browser's native download manager.
- Older browsers without response streaming also use the native download manager instead of `response.blob()`.
- UI distinguishes a confirmed cached download from a browser-managed download whose completion cannot be proven by the application.
- Download cache keys are actor scoped and use a 64-bit resource identity.
- The cache actor is now set once at the application/session layer rather than through a render-time localStorage side effect inside Task Detail.
- WhatsApp Web preparation no longer buffers a large file unnecessarily and no longer marks a final file as sent merely because a download and WhatsApp tab were opened. Web users attach and send the file, then use the explicit Mark as sent action. Native file-share success may record delivery.

### UX and cancellation

- Task, chat, profile-photo and new-task uploads show real progress and cancellation states.
- New-task source files run as a visible non-blocking background batch with failed-file-only retry and explicit discard.
- Multi-file partial success remains durable.
- The browser warns before closing only while unsaved local File objects remain.
- Download Cancel aborts the actual browser stream; desktop/native or browser-managed transfers do not display a false application-level completion claim.
- Temporary preview, attachment, voice-note and downloaded blob URLs are released.

## Deployment containment

`scripts/deploy-upload-preview-irregularity-closure-only-vps.sh` now uses a locked, pinned and hash-verified safe cutover. It proves the permanent PM2 path, available disk, exact backend dependency versions and incremental runtime completeness; runs isolated upload/preview/profile-cache tests plus Phase 4, Phase 6, Phase 9 and contract checks; prepares frontend dependencies offline-first through a lock-hash cache; builds and validates every referenced frontend asset; and creates a complete hash-verified runtime rollback copy before downtime.

The cutover flag is set before the first active file move, so failure at any partial-switch point restores both backend files and the previous frontend. After restart, liveness, readiness, PM2 path/cwd and process generation are verified. Re-running an already active target is a no-op, and `KALPA_PREFLIGHT_ONLY=1` performs all checks without stopping PM2.

Only these runtime paths are replaced:

- `backend/src/server.js`
- `backend/src/services/fileStorageService.js`
- `frontend/dist`

The script does not run the full release matrix, migrations, database repair, a new full backup, backend dependency installation or operational PostgreSQL rewrites. See `UPLOAD_PREVIEW_DEPLOYMENT_FAILURE_PROOFING_AUDIT.md` for the failure analysis and cutover guarantees.
