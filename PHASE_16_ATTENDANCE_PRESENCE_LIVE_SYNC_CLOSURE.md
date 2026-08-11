# Phase 16 — Attendance, Presence & Live-Sync Closure

Date: 2026-08-10

Phase 16 continues the stability-closure programme from the Phase 15 authentication/session baseline. It is intentionally scoped to presence commands, heartbeat ordering, India-day attendance accounting, break accounting and live-state reconciliation. It does not repeat unchanged dependency installation, PostgreSQL certification, backup creation or production cutover work.

## Concrete failure classes found and closed

### 1. Late heartbeats could overwrite a newer Break/Resume state

The browser sent availability inside every presence request, and the server previously rebuilt presence from that payload. A heartbeat prepared just before a user pressed Break could arrive afterward and put the employee back into the older availability state.

Phase 16 makes `heartbeat` liveness-only on the server. It refreshes the online timestamps but preserves the server's authoritative availability and break start. Break, Resume, Login and Logout remain explicit state transitions.

### 2. Break/Resume/heartbeat requests had no browser ordering identity

Rapid clicks, network retries or delayed requests had no per-page sequence. Phase 16 adds a browser presence epoch plus monotonic sequence to every presence command. The backend accepts only forward progress for the active epoch, treats replayed/lower sequence numbers as idempotent stale commands, and rejects non-login commands from an obsolete epoch with `PRESENCE_CLIENT_EPOCH_STALE`.

A newly authenticated workspace creates a fresh epoch and resets its sequence.

### 3. Presence freshness thresholds disagreed across the product

The backend, App, attendance helpers and chat helpers previously used different stale thresholds. That allowed the same employee to look online in one screen and offline in another.

Phase 16 introduces one frontend presence contract: a 60-second heartbeat and a 120-second online freshness window. The backend default is aligned to the same two-minute freshness policy. App and chat/attendance consumers now use the shared constants rather than independent literals.

### 4. Attendance clock parsing depended on the VPS/server timezone

Legacy attendance clocks could be parsed using the host timezone. Phase 16 parses attendance date/time values explicitly in India time (`Asia/Kolkata`, `+05:30`) and supports both 12-hour and 24-hour stored clock formats.

Browser attendance date keys and displayed fallback clock values are also India-time based.

### 5. A new day could inherit the previous day's login timestamp

When the next accepted presence command created a new daily row, an old `lastLoginAt` could previously be used as the new day's login. Phase 16 starts a missing India-day row at that day's first accepted presence command and normalizes cross-day `firstLoginAt` values instead of carrying yesterday forward.

### 6. Laptop sleep or a long network outage could inflate attendance

Attendance previously derived elapsed time directly from the gap between heartbeat timestamps. A laptop sleeping for hours could therefore add hours after the next heartbeat.

Phase 16 introduces bounded accrual. Gaps longer than the configured ten-minute attendance tolerance add zero attendance minutes, reset the sub-minute remainder and are recorded in `presenceGapMinutes` for diagnostics. Short gaps still tolerate temporary network jitter.

### 7. Per-heartbeat minute flooring lost real working time

Repeatedly flooring each heartbeat interval can discard seconds on every write. Phase 16 persists `attendanceAccrualRemainderMs`, so sub-minute time is carried forward and eventually becomes a complete minute.

### 8. Break history could re-inflate a gap that attendance correctly ignored

Even after a long presence gap was excluded from the attendance counter, closing an open break from raw `end - start` wall time could add the entire disconnected period back through `breakEvents`.

Phase 16 accumulates open break-event minutes from the same bounded heartbeat delta as attendance. Resume/Logout closes the event without recomputing its minutes from raw wall-clock duration. Explicit zero-minute events are preserved as zero rather than being treated as missing values.

### 9. Frontend break totals could double-count an open break

The browser could combine already-accrued stored break minutes with the complete open-break duration from its original start. Backend-v4 attendance rows now use persisted accrued event minutes plus only the bounded live tail since the latest tick. A multi-hour disconnected wall-clock gap no longer appears as a multi-hour break.

### 10. Backend `activeMinutes` was being treated as task productivity

For backend presence rows, `activeMinutes` means online time outside Break; it does not prove that a task was actively being worked on. Phase 16 excludes that field from productivity candidates for backend heartbeat rows. Productive minutes must come from task/productivity evidence.

### 11. Backend mode still had a secondary local attendance writer on Break/Resume

The production mode comment stated the server was the sole attendance writer, but `toggleBreak` still invoked the local attendance mutator. Phase 16 disables that local counter mutation in backend mode. Production attendance counters now have one writer: the backend presence path.

### 12. Newer authoritative server offline state could be preserved as local online

The frontend merge contained a special stale-offline override that could keep an older local online row. Phase 16 removes that exception. Timestamp ordering remains, but a newer authoritative server presence state is not reinterpreted into the older online state.

## New permanent components

- `backend/src/services/presenceProtocolService.js`
  - India-time attendance clock parsing
  - browser presence epoch/sequence normalization
  - stale/old-epoch command classification
  - command metadata persistence
  - bounded attendance accrual with millisecond remainder
- `frontend/src/config/presenceConfig.js`
  - shared heartbeat/freshness/live-gap constants
- `scripts/phase-16-attendance-presence-live-sync-check.mjs`
  - permanent release invariant checker
- `tests/backend/phase16-presence-attendance-closure.test.mjs`
- `tests/frontend/phase16-presence-attendance-closure.test.mjs`

The Phase 16 verifier is wired into the normal `verify` chain immediately after Phase 15 and into the full release-verifier matrix.

## Data-safety behaviour

No production attendance history is bulk-rewritten by this phase. Legacy rows continue to be normalized on read/save boundaries. Long-gap diagnostics are additive. Task, finance, file-retention and authentication semantics from Phases 10–15 remain intact.

## Deployment boundary

This source candidate intentionally does not contain `node_modules` or generated production build output. Dependency-installed React bootstrap, a real Vite production build, production PostgreSQL integrity/backup checks and live cutover health probes remain mandatory before deployment. They were not re-run merely to close this isolated source phase.
