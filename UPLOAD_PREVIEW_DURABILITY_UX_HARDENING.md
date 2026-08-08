# Kalpavriksha 1.9.24 Upload and Preview Durability & UX Hardening

Date: 2 August 2026

This release audits every active upload, preview, download, attachment and private-file route used by Administrator, Manager and Designer workflows. It keeps the existing private, content-addressed storage architecture and changes only confirmed gaps.

## Upload flow

- Project uploads accept a single canonical set of approved PDF, image, video, audio, text, Office and CAD extensions.
- Empty files, unsupported extensions, files above 100 MB, duplicate selections and batches above 20 files are rejected before network transfer.
- Uploads use bounded XHR transfer and server-processing deadlines with live percentage, bytes, speed and ETA.
- Browser transfers can be cancelled; already confirmed files remain attached and only the unfinished remainder stops.
- A stable seven-day actor/task/file mutation identity survives refresh and response loss, so a retry cannot create a duplicate server file record.
- The mutation identity is removed only after an authoritative success response, including when browser storage is unavailable and the in-memory fallback was used.
- Multi-file task uploads apply each authoritative server task patch immediately. A later failure cannot erase files already confirmed by PostgreSQL.
- New-task source files upload after task creation in a non-blocking background batch. The user can continue working, cancel the remaining batch, retry only failed local files, or explicitly discard the retry.
- Closing the tab while local File objects remain produces a browser warning because browsers cannot durably persist arbitrary selected files across a restart.
- Payment receipts use the same tracked, cancellable private upload flow and are linked through the durable finance queue.
- Chat attachments and voice notes retain an already uploaded server file when only message creation fails. Retry sends the message again without uploading the binary twice.
- Profile photos are limited to 5 MB and browser-displayable PNG, JPG, GIF, WebP or BMP files.

## Preview flow

- One shared accessible viewer handles task files and global file cards, eliminating divergent preview behavior.
- PDF, video and audio previews use authenticated server streaming with byte-range support instead of loading the complete file into browser memory.
- Images and bounded text previews show loading progress and can be cancelled.
- Text preview is limited to 2 MB; oversized text is offered as a download rather than freezing the page.
- Office and CAD files receive safe metadata previews and download actions. No private document is sent to an external preview provider.
- Image preview includes zoom, pan, pinch, rotation and reset controls.
- Native PDF controls remain available.
- Video and audio preserve verified MIME information, including separate audio/webm and video/webm handling.
- The viewer traps focus, restores previous focus on close, supports Escape, reports embedded-media errors and releases temporary object URLs.

## Backend file delivery

- Download and preview routes share one authorization and delivery path.
- Private responses use `no-store`, `nosniff`, safe content disposition, content security policy and range support.
- PDF, image, video, audio and text previews stream through `sendFile`; they are not converted into large base64 payloads.
- The legacy `/preview-data` compatibility route is asynchronous and capped at 15 MB.
- Profile-photo delivery preserves its verified MIME type even when the physical content-addressed object has no extension.
- HEIC/HEIF, WebM, WAV, OGG and MP3 signatures are recognized in the correct order; generic ISO media detection cannot misclassify HEIC.
- Active HTML/script content remains excluded from upload and inline preview support.

## Download and storage UX

- Browser downloads report progress, speed and ETA and use an actual stream abort when Cancel is pressed.
- Desktop-shell downloads do not display a false Cancel action when the native bridge owns the transfer.
- Successful downloads are stored in an actor-scoped seven-day cache when browser/desktop storage permits it.
- Cached files from one signed-in employee cannot be opened by another employee on the same device through the application.
- Blob URLs created for downloads, previews, chat attachments and voice notes are released after use.

## Deployment

`scripts/deploy-upload-preview-only-vps.sh` extracts the exact GitHub commit into an isolated stage, runs upload/preview tests, authorization, Phase 6 private-file verification, Phase 9 UX and contract checks, and builds the frontend before downtime. It then replaces only:

- `backend/src/server.js`
- `backend/src/services/fileStorageService.js`
- `frontend/dist`

It does not run the full matrix, migrations, database repair, a new full backup or backend dependency installation, and it does not rewrite operational PostgreSQL rows.
