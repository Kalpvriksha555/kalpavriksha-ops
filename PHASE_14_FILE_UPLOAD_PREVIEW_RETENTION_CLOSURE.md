# Phase 14 — Upload, File Storage, Preview & Retention Closure

Date: 2026-08-10
Baseline: Phase 13 Task Lifecycle & Idempotency Closure
Release line: Kalpvriksha 1.9.30

## Purpose

Phase 14 closes the ordinary-business-file fault domain without changing the production database model or repeating already-passed unrelated deployment phases. The work concentrates on source/final/working/chat uploads, upload retry identity, file registry consistency, PDF preview failure handling, physical-file liveness, expired-file metadata, and the 90-day ordinary-file retention policy while preserving permanent finance/payment/ledger evidence.

## Concrete defects closed

### 1. Browser and secure-storage upload contracts had drifted

The browser advertised file extensions that the secure backend storage did not accept. Users could therefore spend time selecting/transferring a file that the server would reject later. The project uploader, task file inputs and chat attachment input now share one exact extension contract aligned to the backend private-storage allow-list. Unsupported archive/ODF/DGN/AAC/FLAC/M4V/active-content formats are rejected before transfer. HEIC/HEIF are recognized by extension even when a browser supplies an empty MIME type.

The profile-photo picker also no longer advertises the broad `image/*` wildcard when its backend contract accepts only PNG/JPEG/GIF/WebP/BMP.

### 2. Canonical upload registry discarded replay identity fields

The `/api/files/upload` route wrote actor/type/chat/voice-note replay metadata onto the file document, but `addFileRegistryEntry()` did not retain all of it in the authoritative `state.files` registry. A response-loss retry could therefore fail to find the already-committed upload, especially for actors identified by ID and for voice notes.

Registry rows now retain mutation ID, SHA-256, type/folder, actor ID/username/name, chat scope/participants and voice-note evidence. Exact retries can resolve the committed row instead of creating a duplicate.

### 3. Upload mutation IDs could be accepted before byte identity was known

Retry lookup previously occurred before the incoming file had completed secure signature validation and server-side hashing. Mutation ID plus metadata was not a sufficiently strong proof that the retry contained the same bytes.

The route now validates/stores the secure incoming object and obtains its SHA-256 before replay confirmation. Replay matching is actor-scoped, destination-scoped, type-scoped, filename/size/hash-scoped, and for chat is also participant/scope/voice-note scoped. Reusing a mutation ID for a different upload fails closed with HTTP 409 / `UPLOAD_MUTATION_ID_REUSE`. Exact response-loss replay retains the legacy `DUPLICATE_UPLOAD_MUTATION` classification and returns the existing registry row.

### 4. Legacy Unix-second timestamps could be expired as if they were from 1970

The 90-day retention service previously treated every numeric timestamp as milliseconds. A legacy Unix-second timestamp could therefore look decades old and be immediately expired.

Plausible epoch-second values are now normalized to milliseconds before age calculation. Unknown/invalid ages remain retained (fail closed).

### 5. Physical garbage collection did not include every attachment alias

The physical-file liveness collector covered the principal task file arrays but omitted legacy/current aliases such as `uploads`, `attachments`, and singular `file`. A file referenced only through one of those aliases could be missing from the GC live-key set.

Resolution, deletion and garbage-collection liveness now use the same alias family, preventing an active referenced object from being treated as orphaned simply because its reference uses a different historical field name.

### 6. Expired/missing rows could recreate apparently valid actions from their ID

The frontend could synthesize `/api/files/:id/...` URLs from an ID even when a file row was explicitly `EXPIRED`, `DELETED`, `MISSING` or `QUARANTINED`. That left visible preview/download actions which could only fail.

Unavailable rows now retain metadata but expose no reconstructed preview/download URL. The frontend action state explicitly reports the unavailable storage state.

### 7. Immediate PDF preview needed authoritative availability confirmation

The existing fast PDF path intentionally avoids a blocking HEAD request, which is correct for responsiveness, but an expired/missing object could then leave a blank/native iframe error.

PDF streaming remains immediate. In parallel, the viewer calls the authenticated file-status endpoint. If the authoritative row/object is unavailable, the viewer changes to a clear application error without delaying healthy PDF opening.

### 8. Legacy MIME metadata could promote an unsupported active format into inline preview

Stored-file preview classification now remains extension-bound. A legacy MIME string cannot convert a disallowed active format such as SVG into an inline image/video/audio preview. Known safe extensions determine preview kind and canonical stream MIME.

## Finance retention invariant

Automatic 90-day cleanup still applies only to ordinary retained business attachments. It does **not** automatically delete payment receipts, finance/financial evidence, bank-ledger/ledger evidence, profile photos, or files referenced by payment/case finance records. Unknown-age files also remain retained rather than being guessed old.

## Release gate

Phase 14 adds `scripts/phase-14-file-upload-preview-retention-check.mjs` and wires it into both `npm run verify` and the full release-verifier matrix. The gate checks browser/backend extension parity, upload replay evidence and ordering, mutation-ID fail-closed behavior, attachment-alias liveness, Unix-second retention safety, permanent finance protection, unavailable-row URL suppression, PDF parallel availability probing and extension-bound preview classification.

## Files changed from Phase 13

- `backend/src/server.js`
- `backend/src/services/storageRetentionService.js`
- `frontend/src/App.jsx`
- `frontend/src/components/chat/CommunicationHub.jsx`
- `frontend/src/components/files/UnifiedFileViewer.jsx`
- `frontend/src/components/profile/ProfileView.jsx`
- `frontend/src/services/fileService.js`
- `package.json`
- `scripts/full-release-verifier-matrix.mjs`
- `scripts/phase-14-file-upload-preview-retention-check.mjs` (new)
- `tests/backend/phase14-file-lifecycle-closure.test.mjs` (new)
- `tests/backend/upload-preview-hardening.test.mjs`
- `tests/frontend/deep-null-shape-hardening.test.mjs`
- `tests/frontend/phase14-file-contract-preview.test.mjs` (new)
- `tests/frontend/runtime-shape-contract.test.mjs`

No production data rewrite, dependency reinstall, PostgreSQL recertification, or deployment cutover is performed by this phase package itself.
