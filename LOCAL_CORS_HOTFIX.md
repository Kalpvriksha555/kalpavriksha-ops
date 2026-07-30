# Local CORS and Dynamic Vite Port Hotfix

This hotfix resolves local login failures when Vite starts on a port other than 5173 (for example 5175), or when a production `CORS_ORIGIN` remains present in the local backend environment.

## Changes

- Development backend accepts only genuine loopback origins (`localhost`, `127.x.x.x`, and `::1`) on any local port.
- Production CORS remains strict and accepts only explicitly configured HTTPS origins.
- Local frontend uses Vite's same-origin `/api` and `/uploads` proxy to port 8080.
- Local development ignores an old `VITE_API_URL` unless `VITE_ALLOW_EXTERNAL_DEV_API=true` is explicitly set.
- Added backend CORS policy unit tests.

## Local start

From the project root:

```powershell
Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
Remove-Item Env:VITE_API_BASE -ErrorAction SilentlyContinue
npm run dev
```

Open the exact URL printed by Vite. It may be 5173, 5174, 5175, or another free port.
