# Deployment Stability Audit

Release: `1.9.11-deployment-stability-audit`

## Scope

This audit was performed on top of the authentication-access correction and the write-performance/backpressure release. It focused on the production failure paths reported after the July 30 recovery: empty Manager workspaces, login restrictions, slow application response, task creation remaining in progress, and file uploads remaining in progress.

## Additional defects found and corrected

1. **Normal state conflicts could be mistaken for permanent task deletion.**
   The browser treated every HTTP 409 response as `PROJECT_DELETED`. A routine state-version conflict could therefore hide a valid task and add it to the local deletion list. Permanent deletion handling now requires the explicit `PROJECT_DELETED` error code.

2. **A foreground write could overwrite a newer presence or attendance update.**
   A task snapshot created before a heartbeat could later replace the newer in-memory user and attendance slices. Foreground writes now merge the newest presence generation before persistence.

3. **A failed database write could discard an unflushed heartbeat.**
   Reloading committed PostgreSQL state after a failed write could replace newer presence data that had not yet reached the database. Reload now preserves the dirty presence generation and schedules it for durable flush.

4. **Successfully uploaded files could lose their attachment-link retry.**
   When file storage succeeded but the follow-up task attachment update failed, the browser removed the durable pending task and asked the user to upload again. The uploaded file references are now retained in the task outbox and linking retries automatically without duplicating the file upload.

5. **Several authenticated requests had no finite response deadline.**
   `authFetch` now applies a 90-second default server-response deadline. Task writes retain their dedicated two-minute deadline. Large chat uploads use a thirty-minute window and profile-photo uploads use five minutes.

6. **The upload processing deadline was too close to the antivirus limit.**
   Browser post-upload processing previously expired at two minutes, equal to the backend antivirus timeout. It now allows five minutes so antivirus completion, metadata persistence, and the final response have a safe margin.

7. **The backend HTTP request window did not match supported large uploads.**
   The Node HTTP server now uses a configurable 35-minute request timeout, a bounded header timeout, and an explicit keep-alive timeout. This aligns the backend with the existing thirty-minute browser upload window while retaining a short header deadline.

8. **Two root verification utilities had invalid relative imports.**
   The duplicate root `clean-install-verify.mjs` and `release-certify.mjs` files referenced a backend directory outside the project. Their imports now resolve to the project backend correctly.

## Verification completed

- 57 backend/frontend Node tests passed.
- Authentication migration compatibility tests passed.
- Persistence generation and row-level write tests passed.
- State-conflict and permanent-deletion classification tests passed.
- Task outbox and attachment-link retry tests passed.
- Request deadline and upload-window tests passed.
- PostgreSQL migration and relational round-trip verification passed.
- Security package audit passed.
- Project doctor passed.
- Regression guard passed.
- Production regression audit passed.
- Phase 9 frontend/UX verification passed.
- JavaScript syntax checks passed for all non-JSX JavaScript modules.
- All relative source imports resolve.
- Package manifests and lockfile root metadata match.
- No duplicate literal Express routes, duplicate test names, merge-conflict markers, or oversized source files were found.

## Verification limitation

A clean dependency installation, full Vite production build, and server-starting integration suites could not be executed in the isolated repair environment because external npm registry/DNS access was unavailable and the supplied archive intentionally did not include complete dependencies. The deployment process must therefore retain `npm ci` and `npm run build` as mandatory stop-on-error gates before PM2 is restarted.

## Data safety

This release does not rerun the July 30 merge, migrate operational data, delete records, reset credentials, or modify existing uploaded file objects. It changes request control, write scheduling, presence preservation, task retry behavior, and server timeout configuration for future operations.
