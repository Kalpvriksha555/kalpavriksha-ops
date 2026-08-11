# Phase 15 — Authentication, Session & Multi-User Browser Closure

Date: 2026-08-10

## Purpose

Close user-specific browser/session failure paths that can make the same deployment behave correctly for one employee and incorrectly for another, especially after another tab/device signs in, a session rotates, or a slow authenticated request completes after the user context has changed.

## Root cause class found

The browser session cookie is HTTP-only and therefore shared by all tabs for the site, while the frontend's CSRF/session context is page-instance state. Before this phase, an older tab could still display User A while a newer tab had replaced the shared cookie with User B's session. Unsafe writes normally failed CSRF, but safe GET requests did not bind themselves to the page token, so an old tab could read through the newer tab's cookie and mix account-specific state.

A second timing issue affected long multipart requests. Express authenticates before multer consumes a large upload body. On a slow link, the originating user could log out or be replaced while the upload was still arriving, yet the handler could otherwise continue using the authentication captured at request start.

## Implemented closure

- Added unique page-instance authentication ownership with localStorage generation plus BroadcastChannel/storage-event propagation.
- CSRF/session secrets remain memory-only; legacy persisted CSRF values are actively removed.
- Safe GET/HEAD requests now send the page session token whenever available. A token/cookie mismatch returns `409 AUTH_SESSION_CONTEXT_CHANGED` without revoking or clearing the newer valid shared cookie.
- Every fetch captures an authentication generation. Responses whose headers or bodies finish after logout/account replacement are rejected as `AUTH_REQUEST_CONTEXT_STALE` before application state can consume them.
- Added explicit browser authentication rejection propagation for fetch and XHR paths.
- XHR uploads perform page-ownership preflight before sending bytes and surface 401/409 session replacement immediately.
- PostgreSQL session creation serializes per user with `FOR UPDATE`, revokes existing live sessions, and inserts the replacement within one transaction. Development auth storage enforces the same one-live-session policy.
- Durable pending create/delete/recent-task browser records are actor-scoped. Unknown legacy ownership is preserved but never adopted by a later user.
- Meeting notes/start state and production QA signoff keys are actor-scoped.
- Authentication boundaries clear user-derived transient React state, revoke preview object URLs, abort create-task uploads, reset file/search/filter/panel state, clear workspace collections and invalidate older Phase 12 workspace-read generations.
- Chat attachment transfers and microphone recording stop on authenticated workspace unmount.
- Task-detail source/working/final, revision/discussion and payment-receipt uploads now use AbortController signals; task-detail unmount aborts the active transfer and the visible Cancel Upload control is connected to the actual XHR.
- Main task file operations use the AbortController ref as a synchronous lock as well as rendered transfer state, closing same-render double-start races.
- Added post-body authentication revalidation middleware for authenticated multipart writes. The original cookie token/session and user are re-resolved after body parsing; a revoked/replaced session fails closed, temporary bytes are cleaned up and nothing is committed.
- The post-body guard is applied to canonical file upload, profile photo, case create, legacy source/final upload and authenticated WhatsApp mock upload routes. Role/case authorization is re-run after revalidation where applicable.

## Compatibility and data safety

The server still permits direct safe resource requests that have no page token, preserving authenticated file/media/browser compatibility. The stricter stale-page comparison is applied when a page token is supplied. Session mismatch never destroys the newer tab's valid session. Failed multipart revalidation removes temporary upload bytes before persistence and cannot mutate task/file/profile state.

## Permanent regression protection

`scripts/phase-15-auth-session-browser-isolation-check.mjs` is wired into both normal verification and the full release-verifier matrix. Focused frontend/backend tests cover stale-tab reads, delayed response headers/bodies, one-live-session enforcement, actor-scoped browser state, transient cleanup, upload cancellation and post-body session revalidation.

## Deferred to Phase 16

Attendance/presence heartbeat ownership, day rollover, multiple-tab presence writers, stale generation reconciliation and live-sync fault injection remain Phase 16 so authentication closure and presence semantics stay independently testable.
