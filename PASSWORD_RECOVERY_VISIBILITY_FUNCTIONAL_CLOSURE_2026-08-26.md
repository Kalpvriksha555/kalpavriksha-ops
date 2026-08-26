# Password Recovery Visibility & Functional Closure — 2026-08-26

## Problem
The sign-in screen's **Forgot password?** action opened the recovery UI through `PortalLayer`, but the dialog relied on the arbitrary Tailwind class `z-[1000]`. That class was not present in the shipped precompiled stylesheet. Because the login card itself is a positioned `z-10` layer, the portaled recovery dialog could render behind the sign-in card and appear missing or partially hidden.

## Closure
- Password recovery now uses the canonical `LAYER_Z.modal` runtime layer (`2147483000`) plus a dedicated CSS fallback tied to `--kalpa-z-modal`.
- The Forgot password trigger is explicitly kept in the visible login stacking context.
- The recovery card is viewport bounded and independently scrollable on short/mobile displays.
- Switching Email OTP / Mobile OTP clears any stale challenge so an OTP from one recovery channel cannot remain active while the UI shows another channel.
- Username, email and mobile recovery inputs are normalized/validated before a network request.
- Existing recovery security stays intact: registered-profile matching, five-minute OTP expiry, bounded incorrect attempts, password policy enforcement, credential password replacement, revocation of existing sessions, one-time challenge deletion and recovery auditing.

## Verification
A dedicated frontend contract test covers layering, viewport containment, channel invalidation, client validation, API wiring, backend recovery request protections and reset/session-revocation behavior. Existing login-hardening tests and the full frontend test suite are also required to remain green before packaging.
