# Phase 19 — Performance, Memory & Long-Session Closure

Phase 19 continues from the Phase 18 persistence/restart baseline and targets degradation that appears only after a browser tab has been open for hours or after operational collections have accumulated for weeks/months.

## Closed failure classes

- Production compact workspace hydration now returns a bounded live chat/notification working set. This is response shaping only; PostgreSQL records are not deleted or shortened.
- Older chat remains available through authenticated, role-scoped, paged `/api/chat/history` reads (maximum 250 records per page).
- Browser chat merge state is bounded to the latest 1,500 live records and notifications to 300 records, preventing row deltas from making React state grow forever.
- Communication Hub renders only 250 messages at a time and progressively reveals/fetches older history instead of mounting an ever-growing DOM.
- Per-user "delete for me" chat IDs are capped at 500; pinned IDs were already capped at 20.
- Global task search returns at most 40 task results rather than rendering every historical match.
- Command Centre and Operations clocks stop recurring 30-second work while the page is hidden and resume immediately on visibility.
- Successfully uploaded profile photos revoke their temporary browser object URL as soon as a server-backed URL replaces it.
- The server exposes `liveWindow` counts so diagnostics can distinguish durable history size from the bounded browser working set.

## Data-safety invariant

No Phase 19 live-window limit performs database deletion, retention, archive trimming, finance trimming, or task-history deletion. The limits apply only to active response/browser working sets. Existing 90-day ordinary-file retention and permanent finance protections remain unchanged.

## Permanent release gate

`scripts/phase-19-performance-memory-long-session-check.mjs` is part of root `npm run verify` and the full release-verifier matrix.
