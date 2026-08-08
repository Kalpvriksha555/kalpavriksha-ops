# Performance Isolation and Storage-I/O Audit

Date: 2 August 2026

Baseline audited: `Kalpavriksha_1.9.24_End_to_End_Role_Profile_Workspace_Hardening.zip`

## Objective

Prevent one screen, timer, storage operation, sync path, or background feature from slowing unrelated Kalpavriksha workflows. The audit covered render-time collection scans, timer ownership, localStorage parsing/serialization, cross-tab messages, finance background sync, workspace hydration, chat/meeting activity, PostgreSQL hot-path contracts, request overlap and deployment isolation.

## Confirmed issues corrected

### Assignment ledger storage amplification

Workspace merges previously read and rewrote the assignment ledger while processing individual project rows. Hydrating or merging hundreds of cases could therefore create hundreds of synchronous `localStorage` parse/stringify cycles.

The assignment ledger is now parsed once, reconciled as one project batch, written at most once, and reused while applying assignments. The cache is invalidated when another tab changes the ledger. Timestamp-free legacy rows use a stable fallback version rather than manufacturing a new timestamp on every merge.

### Finance outbox repeated parsing and idle repainting

The durable payment outbox previously parsed both complete storage mirrors repeatedly and the fifteen-second safety timer incremented application state even when the queue was empty. That could repaint the complete application indefinitely while no finance work existed.

The newest valid mirrored generation is now cached by its exact raw storage values. Same-tab edits reuse the parsed generation. Mutations clone the selected record/map so a failed write cannot alter the committed cache. The safety interval exists only while records are pending, and an empty queue returns without changing React state. Cross-tab storage events explicitly invalidate the cache.

### Startup cache compaction

Large legacy browser-cache cleanup ran synchronously during module evaluation, before the first application paint.

Cleanup is now skipped completely in production backend mode. In local/mock mode it runs through `requestIdleCallback`, with a delayed fallback, and can be cancelled during unmount.

### Whole-application Operations clock

A thirty-second Operations clock was owned by the main application shell, so an elapsed-time label could repaint unrelated pages.

The clock now lives inside `ActiveOperationsView`, runs only while that view is mounted and visible, and stops cleanly when hidden or unmounted.

### Full-workspace cross-tab task broadcasts

Backend mode previously broadcast a compact copy of the complete project collection after an individual task change. A storage fallback could also reload stale browser task data.

Backend mode now sends only changed rows, exact replacement IDs, and deleted IDs. BroadcastChannel is the primary transport; the storage ping is used only as a fallback. A backend-mode fallback requests authoritative backend deltas and never reads stale browser project caches.

### Command Centre repeated business scans

Availability ticks caused repeated full scans of projects, users, attendance and activity history.

Today metrics, activity events, active tasks, latest attendance, workload statistics, capacity, team cards and leaderboard member rows are now memoized or built through one-pass lookup maps. The thirty-second tick updates only genuinely time-sensitive availability labels. Live activity changes calendar days using the explicit India date key without rescanning every thirty seconds.

### Productivity analytics recomputation

Member rows, totals and leaderboard inputs could be rebuilt when unrelated local UI state changed.

Stable user/summary inputs and the complete member-row derivation are now memoized. Existing monthly/overall and Admin-baseline rules are unchanged.

### Closed chat and inactive meeting timers

The floating chat is mounted across the application. It previously ran a one-second call timer even when chat was closed and no call existed, causing repeated chat-history filtering and sorting. The meeting page also ticked every second without an active meeting.

Presence timing now runs only while chat is open. Call and voice timers run only for an open, active session and pause while the document is hidden. Meeting duration ticks only while a meeting is active and visible. Chat unread counts are calculated in one memoized pass instead of rescanning all messages once per teammate. Closed chat does not build/sort the active conversation. Temporary file/voice blob URLs are released immediately after a successful durable upload.

## Backend review

No new backend runtime change was justified by this audit. Existing regression coverage confirms that:

- finance endpoints clone and return only the selected task/payment rows;
- task/file/chat/read endpoints use selective relational writes;
- special collections use batched SQL;
- unchanged collections retain object/hash serialization caches;
- request deadlines and in-flight backpressure remain bounded;
- presence writes do not take foreground queue priority;
- full workspace responses are avoided for row-level changes.

Changing the backend without a confirmed defect would add deployment and data-integrity risk without improving the identified frontend bottlenecks.

## Deployment isolation

`scripts/deploy-performance-isolation-only-vps.sh`:

1. fetches and archives the exact target commit without resetting the live checkout;
2. confirms the already-live backend file matches the backend required by the target;
3. runs all frontend tests, Phase 9 UX verification and frontend/backend contract verification;
4. installs only frontend build dependencies in an isolated stage;
5. creates the production frontend bundle;
6. atomically replaces only `frontend/dist` with rollback;
7. does not stop/restart PM2 or touch PostgreSQL.

It does not run the full release matrix, migrations, database repair, a new full backup, backend dependency installation or release certification.

## Preserved behavior

- Durable payment outbox and safe-to-close status
- Immediate non-blocking navigation during payment saves
- Monthly/overall analytics and Admin score baselines
- Role, profile and workspace hardening
- Task/version/idempotency protections
- Private-file and actor-scoped browser storage
- PostgreSQL integrity and backup controls
