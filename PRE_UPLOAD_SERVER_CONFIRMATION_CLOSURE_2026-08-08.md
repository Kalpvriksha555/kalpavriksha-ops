# Pre-upload server confirmation closure — 2026-08-08

A production screenshot at approximately 16:49 IST showed a newly-created task visible in the UI while an `Add Source File` upload failed with `The target task was not found.`

Root failure class: a task may intentionally remain visible in the durable browser create outbox when its immediate server create confirmation is delayed or fails transiently. Task-detail upload paths previously sent file bytes immediately using that optimistic ID. The backend therefore correctly returned `CASE_NOT_FOUND` when the task had not yet been committed, or when the server had allocated a different ID after a collision.

Closure:

- Every task-detail upload now runs a pre-upload server-confirmation gate.
- A pending create is retried with its original idempotency mutation before file bytes are sent.
- If confirmation cannot be obtained, the file is not sent and the UI reports that server confirmation is still pending.
- The canonical server task replaces an optimistic identity before source, working, completed, revision/discussion and payment-receipt uploads.
- Uploads carry the task-create mutation identity. The backend may resolve a stale optimistic ID through the committed task's `lastTaskMutationId`, then stores and links the file against the canonical immutable task ID.
- XHR upload errors preserve backend `code`, HTTP status and payload so `CASE_NOT_FOUND` and other failures can be handled deterministically instead of as message-only errors.
- Existing create-first/source-upload ordering and upload idempotency protections remain in place.

This closes both causes of the visible symptom: local-only pending creates and stale optimistic IDs after server allocation.
