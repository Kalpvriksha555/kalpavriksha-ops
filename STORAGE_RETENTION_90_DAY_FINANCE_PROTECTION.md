# 90-Day Storage Retention with Permanent Finance Protection

This increment adds automatic private-file retention without deleting finance or bank-ledger data.

## Policy

- Ordinary uploaded project/customer/chat/evidence files expire 90 days after their persisted upload timestamp.
- Expiry is logical first: the file registry and nested task/chat references are marked `EXPIRED`, URLs are cleared, and the parent task/chat record remains.
- The physical content-addressed object is moved only after committed state no longer contains an active reference and no upload lease is active.
- Recoverable trash is permanently purged after a short safety window (default 24 hours), which actually returns disk space to the filesystem.
- Files with an unknown/invalid age are retained rather than guessed old.
- Profile photos are retained.

## Finance protection

The automatic retention job never expires:

- `PAYMENT_RECEIPT` files;
- files referenced by payment rows;
- files referenced by a task's `ledger`, `finance`, or `paymentLedger` object;
- finance and bank-ledger database records themselves.

The policy only changes file-storage records and nested attachment metadata. It does not delete `payments`, task ledgers, finance history, bank details, accounting periods, settlement metadata, or finance audit history.

## Runtime schedule

The backend schedules the retention pass automatically after startup and then once every 24 hours by default.

Environment overrides:

- `FILE_RETENTION_DAYS` (default `90`, minimum `30`)
- `FILE_RETENTION_START_DELAY_MS` (default `600000` / 10 minutes)
- `FILE_RETENTION_INTERVAL_MS` (default `86400000` / 24 hours)
- `FILE_TRASH_RETENTION_MS` (default `86400000` / 24 hours)

## Safety

- Financial references are detected before expiry selection.
- Unknown-age files fail closed and remain stored.
- Shared content-addressed objects are retained while any active file reference remains.
- Cross-process upload leases are checked before a physical object is moved.
- The existing relational persistence integrity path commits logical expiry before physical garbage collection.
- The job records structured operational completion/failure events.
