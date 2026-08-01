# Finance & Payment Write Stability Fix

## Corrected behaviour

- Payment Ledger fields update immediately on screen.
- Payment fields save automatically after a 650 ms pause or immediately when the field loses focus; there is no dedicated save button.
- The debounce prevents a server write for every keystroke, and only one finance request can run at a time.
- A finance save no longer triggers a second full task save.
- The same mutation ID is retained after a timeout, making an automatic or field-blur retry idempotent.
- A payment receipt is uploaded as a private file reference rather than embedded as base64 in the task JSON.
- Refund, amount and date validation runs in both the browser and backend.
- Finance remains assigned to the task's immutable accounting month while retaining the actual payment date.
- The backend updates one case row, at most one payment row, one audit row and one immutable finance-history row.
- The finance hot path no longer clones or decomposes unrelated files, performance records, chats or notifications.
- The API returns a compact finance patch instead of the entire task and all of its documents.
- Full recovery snapshots remain periodic while every finance change still writes immutable finance history and updates the integrity hash.

## Durability and concurrency

- Finance version checks prevent stale screens from overwriting newer values.
- Committed-state idempotency handles responses lost after a successful database commit.
- Existing payment rows are resolved through all task identifier aliases to prevent duplicates.
- Payment audit history and task history are bounded to prevent unbounded payload growth.
- Failed saves leave the entered draft on screen and do not present the values as saved.

## Verification

- Frontend and backend test suites cover responsive drafting, debounced automatic save, idempotency, validation, monthly accounting, compact responses and selective relational persistence.
- A synthetic selective-write benchmark verifies that 10,000 file rows and 5,000 performance rows are not cloned by a payment mutation.
