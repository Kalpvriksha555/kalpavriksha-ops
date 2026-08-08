# Login Experience Speed and Reliability Hardening

Date: 2 August 2026

This revision audits the complete sign-in path for Administrator, Manager and Designer accounts while preserving the deliberate policy that every new browser page instance starts with a fresh sign-in.

## Confirmed problems corrected

- A `401` returned by login, current-password validation or password recovery could dispatch the global session-expired event and clear an unrelated active workspace.
- Login and recovery actions shared an unnecessarily broad request timeout and could leave users waiting without action-specific guidance.
- Repeated Enter/click actions could start duplicate login, password-change or recovery requests.
- Unknown usernames returned before password hashing, making them observably faster than known usernames with an incorrect password.
- Successful login waited for secondary audit logging and performed avoidable credential maintenance work.
- Password replacement performed an unnecessary second scrypt verification and an avoidable credential lookup.
- Session, password-change and recovery infrastructure failures could expose internal error text.
- The login UI did not clearly distinguish initial secure-session preparation from post-login workspace hydration.
- Offline, Caps Lock, retry-delay and in-progress states were incomplete.
- Password recovery lacked keyboard-submit behaviour, while temporary-password acceptance did not focus the next required field.
- Production backend mode could briefly fall back to seeded users while authoritative users were empty.

## Resulting behaviour

- Public authentication-form errors never sign out an already authenticated workspace.
- Login, session preparation, password changes and recovery use bounded action-specific deadlines.
- Timeout guidance explains when an action may already have completed, preventing unnecessary repeated password changes or resets.
- Each login/password/recovery action is single-flight until its request settles.
- Known and unknown invalid usernames both execute a valid scrypt verification and return the same public error.
- Existing stale browser sessions are revoked before issuing a new login session.
- Successful login responds after the session is committed; secondary audit recording continues without delaying the user.
- Already-clear failed-login metadata is not rewritten.
- Password change uses one current-password verification plus one new-password hash, and reuses the already loaded credential.
- Session/recovery infrastructure errors are logged with request IDs but return generic retryable messages.
- The login page shows network state, Caps Lock, accessible progress, retry timing and clear offline feedback.
- Username input is normalized and mobile keyboards receive next/go hints.
- Recovery supports Enter-key submission and a bounded resend cooldown.
- Temporary-password acceptance focuses the new-password field.
- Initial sign-in preparation and authorised workspace loading have separate progress messages.
- Backend mode never substitutes bundled example users for an empty authoritative user result.

## Role-path verification

The Phase 3 runtime verifier now checks:

- Administrator, Manager and Designer login latency budget and `Server-Timing` evidence.
- Equivalent unknown-user and known-user invalid-login responses.
- Temporary-password replacement and protected-workspace blocking until replacement.
- Incorrect current-password rejection without revoking the valid Manager session.
- Profile persistence, actor-bound OTP registration and recovery.
- Manager peer-profile privacy.
- Password and verified-profile persistence across backend restart.
- Public browser-session revocation.
- Account restriction revoking active sessions.
- Absence of plaintext credentials.

## Incremental deployment

Use `scripts/deploy-login-experience-only-vps.sh` for this revision. It extracts the exact GitHub target into an isolated stage, runs only login/role/session/profile tests plus Phase 3, Phase 4, Phase 9 and contract verification, builds the frontend, then briefly replaces only:

- `backend/src/server.js`
- `frontend/dist`

The script includes rollback and does not invoke the full release matrix, migrations, database integrity repair, a new full backup or backend dependency installation.
