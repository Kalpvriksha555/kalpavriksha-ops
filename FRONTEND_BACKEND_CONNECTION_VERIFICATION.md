# Frontend–Backend Connection Verification

This release verifies and hardens the complete connection contract between the React frontend and Express/PostgreSQL backend.

- Production frontend builds require an explicit API origin.
- Local development uses the Vite same-origin proxy for `/api` and `/uploads`.
- Credentialed requests include cookies and CSRF tokens.
- Production CORS origins are canonicalized, so a trailing slash or explicit default HTTPS port cannot cause a false `Failed to fetch`.
- Static route/method verification covers authentication, state, tasks, finance, files, chat, notifications, profile, OTP, performance, system and health endpoints.
- A deployment-host live verifier checks local/public health, frontend HTML, credentialed CORS, unauthenticated session behavior and browser-session clearing.
- The outdated smoke assertion that expected a hardcoded localhost API URL has been corrected to verify the actual Vite proxy architecture.

Run `npm run verify:integration` for the source contract and `npm run verify:live-stack` on the VPS after deployment.
