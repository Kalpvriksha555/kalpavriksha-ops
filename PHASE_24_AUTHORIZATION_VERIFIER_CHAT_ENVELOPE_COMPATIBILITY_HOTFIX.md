# Phase 24 Authorization Verifier Chat Envelope Compatibility Hotfix

## Live failure

The SSH-independent Phase 24 candidate passed the complete frontend suite, Phases 11-24 source gates, and all 311 backend tests, then stopped safely during `verify:authorization` before production deployment began.

The failure was `Chat sender identity was accepted from the client.` The production chat endpoint was already safe: it derives `sender`, `senderId`, `role`, and `senderRole` from the authenticated server-side actor. The verifier was stale after the Phase 12 API response contract change and still read `payload.sender` / `payload.id` even though successful chat creation now returns `{ ok:true, message:<server-owned chat record> }`.

## Closure

`phase-4-authorization-check.mjs` now unwraps the confirmed `message` envelope before checking sender identity and direct-message visibility. It also requires the explicit `ok:true` confirmation. This changes verification only; it does not weaken chat authorization or alter production data paths.

A permanent regression test proves that the server continues to use authenticated actor identity and that the verifier reads the current response envelope rather than silently accepting client-owned identity fields.

## Deployment safety

The previous live attempt ended during isolated candidate certification with `Production deployment was NOT started.` No production cutover, PM2 stop, fresh deployment backup, migration, or production database write occurred. The existing release-certificate compatibility gate and all fresh FULL backup / physical PostgreSQL integrity requirements remain unchanged.
