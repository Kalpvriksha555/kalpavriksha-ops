# Phase 6 — File Storage, Upload and Privacy Hardening

Phase 6 replaces direct upload-directory storage with a private, content-addressed storage layer.

## Storage model

- New uploads first enter a private temporary directory.
- The original filename is normalised and stripped of path traversal.
- Extension and file signature must agree.
- Executable, script, HTML, SVG and other active-content formats are rejected.
- Accepted files receive a SHA-256 checksum.
- Files are stored under `objects/<hash-prefix>/<sha256>.<extension>`.
- Identical content is deduplicated without weakening record-level permissions.
- File metadata stores checksum, detected MIME type, security status, storage provider and availability.
- Physical storage is never mounted through `express.static`.
- Downloads and previews require an authenticated session and record-level permission.

## Validation policy

Supported operational formats include PDF, common raster images, DWG/DXF, Word, Excel, PowerPoint, RTF, CSV and plain text. Browser-supplied MIME types are not trusted. The server checks the underlying signature before accepting a file.

Rejected or mismatched uploads are moved to a private quarantine directory with a JSON reason record. Optional ClamAV integration is available through:

```text
FILE_ANTIVIRUS_MODE=clamscan
FILE_ANTIVIRUS_REQUIRED=true
CLAMSCAN_PATH=clamscan
```

Do not make antivirus mandatory until ClamAV is installed and its signatures are updating successfully on the VPS.

## Persistent production configuration

Production startup now requires:

```text
KALPA_FILE_STORAGE_ROOT=/var/lib/kalpavriksha/private-files
FILE_STORAGE_PERSISTENT=true
```

The directory must be on persistent storage outside the Git checkout and deployment replacement path. It should be owned by the backend service account and not directly exposed by Nginx.

The old upload directory can be mounted read-only during the first reconciliation:

```text
KALPA_LEGACY_UPLOAD_DIR=/var/www/kalpavriksha-ops/backend/src/uploads
```

## Legacy reconciliation

Admin-only endpoints:

```text
GET  /api/system/files/storage-health
GET  /api/system/files/reconciliation
POST /api/system/files/reconciliation
```

The POST operation requires the exact confirmation:

```text
RECONCILE FILE STORAGE
```

It imports valid legacy files into private content-addressed storage, refreshes available records and marks genuinely missing records without deleting their history. Original legacy files are not automatically removed.

## Deletion and recovery

Deleting a file removes it from active task/chat views but preserves a tombstone containing the actor, reason and time. An unreferenced private object is moved to a recoverable trash directory instead of being permanently erased. Deduplicated objects remain when another active file record still references them.

## Database migration

Migration `006.001` adds:

- `file_storage_events`
- `file_reconciliation_runs`

These tables retain append-only storage and reconciliation audit history in PostgreSQL.

## Important deployment note

Do not run reconciliation or remove old uploads until a VPS filesystem backup and PostgreSQL dump have been created. Missing July 28 finance recovery remains a separate selective database operation after all hardening phases are complete.
