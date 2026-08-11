# Kalpvriksha Designs Ops — Stability Closure Programme

The original hardening roadmap phases 1–9 remain completed. This programme continues from Phase 10 and is designed to close runtime-error classes systematically without repeatedly redoing already-passed deployment phases.

## Phase 10 — Read-marker contract closure — implemented in this candidate
Close notification/chat `readBy` scalar-vs-array drift, protect legacy rows, make notification read state actor-specific, and add focused regression tests.

## Phase 11 — Frontend runtime shape boundary closure — implemented
Audit every render path and state merge for unchecked `.map`, `.filter`, `.some`, `.includes`, `.flatMap`, spread, `.length`, object iteration and nested persisted fields. Normalize at ingestion boundaries rather than scattering fragile fallbacks.

## Phase 12 — API response contract and stale-response closure — implemented
Define/verify response schemas for bootstrap, state deltas, tasks, files, chat, notifications, attendance, finance and profiles. Reject impossible shapes, protect against stale/out-of-order responses, and verify partial/delta payloads.

## Phase 13 — Task lifecycle and mutation/idempotency closure — implemented
Exercise create/update/delete/reopen/revision/assignment/completion/backdate flows under retries, duplicate clicks, slow networks, stale versions, cross-tab writes and server-confirmation delays. Mutation IDs are now payload-bound, lifecycle routes are versioned/idempotent, rejected optimistic writes roll back locally, and backend-mode cloud mirroring waits for authoritative confirmation.

## Phase 14 — Upload, preview, retention and file-reference closure — implemented
The browser/backend upload contracts are aligned; response-loss retries are byte-identity/actor/destination scoped; mutation-ID reuse fails closed; legacy Unix-second retention timestamps are normalized; every task-file alias participates in file liveness/deletion/resolution; unavailable rows cannot recreate working links; PDF preview remains immediate while checking authoritative availability in parallel; legacy MIME cannot promote unsafe active formats into inline preview; finance/payment/ledger evidence remains permanently exempt from ordinary automatic retention.

## Phase 15 — Authentication, session and multi-user browser closure — implemented
Page-instance authentication ownership, shared-cookie tab replacement, response-generation binding, one-live-session serialization, actor-scoped browser state and post-body multipart reauthentication are closed and permanently gated.

## Phase 16 — Attendance, presence and live-sync closure — implemented
Presence commands are epoch/sequence ordered; heartbeats are liveness-only; browser/backend freshness thresholds are aligned; India-day attendance accrual is bounded and preserves sub-minute remainder; long suspended/network gaps cannot inflate attendance or break history; backend mode has one attendance writer; backend non-break time is no longer misreported as task productivity.

## Phase 17 — Finance, reports and ledger invariants closure — implemented
Finance merges are now version-first and compact-patch safe; committed mutations carry payload/operation-bound bounded receipts; exact retries wait for durable commit rather than conflicting with their own queued write; the legacy payment endpoint shares idempotency/date/refund rules; browser outbox versions are monotonic and can rebase after terminal conflicts; both frontend task merge paths share one finance-aware helper; relational finance classification recognizes the new metadata; task-month reporting and append-only finance history remain permanently gated.

## Phase 18 — PostgreSQL relational-state and restart closure — implemented
Relational load/reload/health now verify one repeatable-read PostgreSQL snapshot; ambiguous COMMIT acknowledgements are reconciled only by exact version/hash plus physical-state proof; any failed optimistic foreground state is replaced by the last verified shadow and kept read-only until PostgreSQL reload succeeds; runtime recovery waits for the write/persistence pipeline to drain and reloads without resetting live bookkeeping; queued commits republish verified state as they drain; revision restore shares the exact COMMIT-evidence rule; and every current PM2 start persists a kill timeout longer than the backend graceful-shutdown ceiling.

## Phase 19 — Performance, memory and long-session soak closure — implemented
Production workspace/browser live sets are bounded without deleting durable history; older chat is paged on demand; large conversation DOM/search/local metadata are capped; hidden-tab recurring clocks suspend; temporary profile-photo object URLs are released; and live-window diagnostics distinguish durable history from the active browser set.

## Phase 20 — Error observability and self-diagnosis closure — implemented
Every frontend request is correlatable; browser/API failures are classified into bounded sanitized diagnostics with stable `KD-...` IDs; internal 5xx responses expose only a safe message, request ID and fingerprint; authenticated client diagnostics are rate-limited/duplicate-suppressed and persisted as safe operational events; and Command Centre can surface the reviewed diagnostic metadata without storing raw browser errors or business payloads.

## Phase 21 — Resume-aware release and rollback closure — implemented
Candidate/source/build evidence is content-hash bound and reusable; exact recertification reruns are skipped; production deployment reuses unchanged candidate/dependency/database phases while retaining fresh backup/environment/live gates; frontend bytes are hash-proven through atomic cutover; exact deployed releases become safe no-ops; rollback is source/health verified and escalates distinctly if automatic recovery cannot be proven.

## Phase 22 — End-to-end fault matrix and final stability soak — implemented
The final source-stability gate combines stale workspace reads, compact finance deltas, ordered presence, attendance gap handling, persistence ambiguity and sanitized diagnostics in a 25,000-iteration deterministic soak. Focused adversarial tests cover malformed browser state and cross-phase fail-closed behavior. The Phase 21 ZIP round-trip also exposed a real packaging omission of `backend/.env.example`; Phase 22 restores it and requires the release manifest to match the complete distributable source tree exactly, including mandatory dotfiles.

## Working rule
No phase may trade data safety for UI continuity. Existing production data is never bulk-rewritten merely to repair a frontend shape issue when a backward-compatible read boundary can safely normalize it.
