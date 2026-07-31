# Deep Runtime Integrity Fix

This release is based on `Kalpavriksha_Deployment_Stability_Audit_Fix.zip` and keeps all prior authentication, PostgreSQL integrity, persistence-backpressure, finance-protection, backup, and frontend stability work.

## Additional defects found and corrected

1. **Detached case mutations** — case authorization middleware and case handlers could use different cloned state objects. A route could return success while persisting an unchanged row. Middleware and handlers now share one request-scoped state snapshot.
2. **Long-upload stale snapshots** — source/final upload routes could pin the state version for the entire multipart transfer. Upload access is now checked before transfer, then rechecked against a fresh snapshot after transfer before mutation.
3. **Profile-photo stale write** — the live user object could be changed while a stale clone was saved. The cloned row is now the only mutated and persisted record.
4. **Response-body timeout gap** — authenticated request deadlines ended after response headers, allowing JSON parsing or file streams to hang forever. Deadlines remain active until the body or stream completes.
5. **Slow large downloads** — default 90-second deadlines were too short for supported large files. Downloads now receive a 35-minute window and previews receive five minutes.
6. **False local file deletion** — the frontend removed a file card even when the server rejected deletion. Non-success responses now stop local removal and show the server error.
7. **Physical-file-before-database deletion** — storage objects could disappear before PostgreSQL committed the logical deletion. Logical deletion now commits first.
8. **Content-hash deletion races** — immediate cleanup could remove an object already deduplicated by another concurrent upload whose row had not committed yet. Deleted/replaced/failed objects are retained privately as safe garbage-collection candidates instead of being moved immediately.
9. **Unrolled reconciliation imports** — a failed reconciliation write could leave newly imported objects without a durable row. They are now recorded as retained safe-GC candidates on failure.
10. **Multipart temp-file leaks** — early validation, authorization failure, parser errors, persistence errors, and client disconnects could leave temporary uploads on disk. All multipart paths now clean private temporary files.
11. **Generic environment-number failure** — invalid numeric environment values could become `NaN` and destabilize timeouts, limits, and server settings. Runtime limits now use finite bounded parsing.
12. **Overbroad relational writes** — routine task, file, profile, chat, notification, finance, and authentication mutations now select only the changed relational collections/rows wherever safe.
13. **Presence write races** — foreground writes preserve newer attendance/presence data and failed persistence reloads retain unflushed presence.
14. **Task conflict misclassification** — state-version conflicts are no longer treated as permanent task deletion.
15. **Attachment confirmation loss** — uploaded task attachments remain in the durable retry outbox until linking is confirmed.

## Storage behavior

Logical deletion immediately removes authorized access and marks the database record deleted. Content-addressed objects are not physically moved in the same request because concurrent deduplication makes immediate removal unsafe. They remain in private storage for a future grace-period garbage-collection process.
