# End-to-End Lifecycle Integrity Fix

Release: `1.9.20-end-to-end-lifecycle-integrity`  
Backend/Frontend: `2.9.20-end-to-end-lifecycle-integrity`

This release audits and repairs the complete operational lifecycle from task creation through source upload, assignment, drafting, work-file upload, internal review, completion, revision, case editing, file deletion and finance updates.

## Data-integrity corrections

- Task database IDs are immutable. Case edits may change only the display/case reference.
- Renamed tasks keep historical aliases without treating their own immutable ID as superseded.
- Duplicate display references are rejected before two tasks can be merged accidentally.
- Partial Admin/Manager edits merge into the current server task instead of erasing omitted fields.
- Every task write carries an optimistic task version and a stable mutation ID.
- Repeated delivery after a lost response is idempotent and cannot create a duplicate task mutation.
- Stale browser tabs cannot overwrite a newer task or finance record.
- The durable create/update and delete outboxes are scoped to the signed-in actor.
- Permanent validation/permission failures are rolled back and removed from retry queues instead of retrying forever.
- Deleting a task through any current or historical alias removes the immutable task and records every alias as deleted.
- PostgreSQL relational integrity still uses physical row counts and preserves genuine corruption detection.

## File lifecycle corrections

- Source, working, completed, revision, discussion, payment-receipt and chat purposes are recognised consistently.
- A task is created and durably confirmed before source files are uploaded.
- Task-file registration and task attachment linking occur in one backend transaction.
- File deletion and reference removal occur in one backend transaction and return the committed task patch.
- Long uploads are authorised before transfer and reauthorised against a fresh selective task snapshot before commit.
- Failed file persistence retains content-addressed objects as safe garbage-collection candidates and cleans temporary uploads.
- Completed-file upload cannot reopen an already completed task unless an Admin or Manager first opens a revision.
- A task cannot enter review/completion without a stored completed deliverable.

## Completion and revision controls

- Designers can work only on their assigned tasks.
- Designers cannot approve/close tasks.
- Starting work or uploading over a finalised task is rejected until a Manager/Admin opens a revision.
- Manager completion verifies a final deliverable before committing completion.
- Revision work-item creation and assignment/completion notifications are committed with the task write.

## Finance protection

- Finance remains tied to the immutable task accounting month.
- Finance writes remain version-controlled and idempotent.
- Payment receipts remain private stored-file references rather than inline base64 data.
- Finance snapshots clone only the selected case and payment rows linked to that case.
- Payment, case and audit rows are written selectively; unrelated files, chats, notifications and performance history are not rebuilt.
- Finance and payment responses remain compact.

## Performance corrections

- Primary task writes, dedicated lifecycle routes, uploads, deletes and finance writes use selective state snapshots.
- Unrelated workspace collections are preserved by reference and are not deep-cloned for a one-task operation.
- Dedicated task routes transfer ownership of their selective snapshot after validation, avoiding another full-state clone.
- Presence writes remain delayed, coalesced and lower priority than user actions.
- Duplicate frontend notification writes and duplicate post-upload task writes remain removed.
- Adaptive collection synchronization continues to avoid resending unchanged workspace data.
