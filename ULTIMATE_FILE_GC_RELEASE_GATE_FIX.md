# Ultimate File Garbage-Collection and Release-Gate Fix

## Root cause

The Phase 6 verifier still expected the delete request itself to move an object immediately into trash. The current backend intentionally retained content-addressed objects as safe-GC candidates because an in-flight upload may already have deduplicated to the same hash before its database row is committed. Immediate physical movement would make that valid upload reference a missing object.

## Final design

- Logical deletion commits first and immediately returns HTTP 410 for the deleted record.
- Active deduplicated references keep the shared object available.
- Uploads acquire cross-process lease files after hashing and retain them through the HTTP response, covering the database-commit window.
- Admin garbage collection requires `COLLECT FILE STORAGE GARBAGE`.
- Production uses a 24-hour default grace period (`FILE_STORAGE_GC_GRACE_MS`).
- The collector scans only private content-addressed objects, skips active references, skips active leases, re-reads authoritative state immediately before movement, and moves eligible objects to recoverable trash with audit metadata.
- Stale lease files expire after a bounded lease age so a crashed process cannot block cleanup forever.

## Release verification

Phase 6 now verifies both sides of deduplication: deleting one record cannot break a surviving record, while deleting the final reference followed by a zero-grace isolated GC pass moves the object into recoverable trash. The deployment source audit refuses commits missing the lease, grace-period, final-reference recheck, or Phase 6 runtime probe.


## Complete pre-downtime matrix

Deployment opts into five additional gates after the sixteen application gates: isolated clean install, production-environment validation, backup creation, backup verification and backup health. The matrix continues through every selected gate and reports all failures together. PM2 is not stopped until all twenty-one gates pass.
