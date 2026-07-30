# Local runtime stability fix

This patch addresses local Vite proxy HTTP 502 errors observed with Node 26 on Windows.

## Changes

- The default backend development command now runs without Node's watch mode.
- `npm run dev:watch` remains available as an optional watcher.
- The local API binds explicitly to `127.0.0.1:8080`, matching the Vite proxy target.
- Startup now waits for the HTTP server's `listening` event, handles bind failures, and explicitly retains the server handle.
- `npm run dev:probe` checks the local API health endpoint.

## Expected local startup log

The backend should remain running and should not print `Completed running ... Waiting for file changes` when using the default `npm run dev`.
