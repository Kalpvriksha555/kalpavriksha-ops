# Phase 12 — API Contract and Stale-Response Closure

Date: 2026-08-10
Baseline: Kalpavriksha 1.9.30 Phase 11 Frontend Runtime Shape Closure

## Objective

Phase 11 made the browser tolerant of malformed collection shapes. Phase 12 moves the protection one boundary earlier: successful API responses must have an explicit, validated contract, and an older response must never repaint state that has already advanced because of a newer server snapshot, another tab, or a browser-side mutation.

No production data migration or bulk rewrite is required by this phase.

## Concrete defects found while auditing

### 1. Task source-file creation had an invalid runtime call

`frontend/src/App.jsx` contained `Array.fromasArray(files)`. It is syntactically valid JavaScript but `Array.fromasArray` does not exist, so the source-file path could fail at runtime even though ordinary task creation worked.

The path now uses the existing shape-safe `toArray(files).filter(Boolean)` boundary, and the Phase 12 release gate permanently rejects `Array.fromasArray`.

### 2. Chat create responses had two incompatible success shapes

`POST /api/chat` returned a raw message record for both a new message and an idempotent replay, while other chat mutations returned `{ ok:true, ... }`. A strict client could therefore not distinguish a confirmed success envelope from an arbitrary JSON object.

The backend now returns one explicit contract:

- new message: `{ ok:true, message }`
- idempotent replay: `{ ok:true, idempotent:true, message }`

The frontend unwraps `payload.message` and requires a server message id before treating the send as confirmed.

## API response contract

A new `frontend/src/services/apiContractService.js` centralizes JSON success handling.

Successful JSON API responses now fail closed when they are:

- empty;
- malformed JSON;
- an array, scalar or null instead of a record;
- missing explicit `ok:true` where confirmation is required;
- missing a required response field.

HTTP error responses remain readable so useful server error codes/messages and request IDs are preserved instead of being converted into a false success.

The central contract is now used by authentication/session, task/state, finance history, chat/notifications, profile update, OTP, file deletion, system-health/admin requests and Command Centre performance requests. XHR upload paths retain their dedicated transfer handling but already require successful HTTP status plus explicit server confirmation before resolving.

## Workspace state contract

`validateWorkspaceStatePayload()` now validates every `/api/state` response before it can reach React state.

Required synchronization markers:

- `stateVersion`
- `dataRevision`
- `presenceGeneration`
- per-collection revisions for users, cases, deletedProjectIds, teamChat, notifications and attendanceLogs
- a consistent sync token

Full responses must contain array-shaped workspace collections. Presence partials must contain users and attendance arrays. Workspace partials must declare known changed collections and include the matching array field; row-delta IDs are also shape checked.

A focused backend contract test permanently verifies that unchanged, presence-partial and workspace-partial responses all carry the same sync descriptor.

## Stale/out-of-order response protection

A browser-side monotonic mutation generation was added in `requestControlService.js`.

Every authenticated non-safe request increments this generation. The XHR file/profile upload paths do the same explicitly. A `/api/state` GET captures the generation before it starts. If any browser write begins before that GET finishes, the GET is classified as stale and is not allowed to repaint local state.

Workspace revision markers are also compared against the already-applied markers. Responses are rejected if any state/data/presence/collection revision regresses.

Important ordering rule: initial hydration performs freshness classification **before** applying users, tasks, chat, notifications or attendance. A stale initial hydration is retried with a bounded retry. A stale background refresh is discarded and immediately followed by a fresh request.

Cross-tab project broadcasts also advance the client mutation generation so an older in-flight GET cannot overwrite a newer sibling-tab delta.

## Monotonic sync markers

`workspaceSyncUtils.js` owns marker comparison and advancement. Applied markers can only move forward (`Math.max`), so an accidental lower revision cannot reset the client's freshness baseline.

## Permanent release gate

`scripts/phase-12-api-contract-stale-response-check.mjs` is now available as:

`npm run verify:api-contract`

It is inserted into both the normal `npm run verify` sequence and the full release-verifier matrix immediately after the Phase 11 runtime-shape gate.

The gate verifies the central response parser, state validator, mutation generation, monotonic marker logic, discard-before-apply ordering, fresh follow-up behavior, Command Centre contract parsing, chat response envelope and the removal of the invalid `Array.fromasArray` call.

## Scope discipline

This phase intentionally does not reinstall dependencies, repeat PostgreSQL certification, or rerun unrelated backend/database phases. The backend change is limited to the chat-create response envelope and is covered by focused source-contract tests. Production cutover must still run the dependency-installed React bootstrap and Vite production build required by the existing release gate.
