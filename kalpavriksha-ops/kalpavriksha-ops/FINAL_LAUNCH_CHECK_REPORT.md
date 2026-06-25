# Kalpvriksha Designs Ops — Final Launch Check Report

## Checks completed

- Frontend production build: PASS
- Frontend smoke checks: PASS
- Backend syntax check: PASS
- High-severity dependency audit previously included in preflight flow
- Tailwind CDN removed; compiled CSS build is used
- Large base64/file data is stripped from cross-tab cache to reduce memory pressure
- Broadcast sync uses compact metadata and avoids rebroadcast loops
- Assignment ledger protection remains in place so assigned tasks are not overwritten by older unassigned snapshots
- Error boundary remains active for safer recovery instead of white-screen crashes

## Important launch notes

1. Use production mode for staff usage, not Vite development mode.
2. Configure Email OTP credentials in `backend/.env` before using real password recovery.
3. Configure SMS credentials only if mobile OTP is required.
4. For real multi-computer usage, deploy with a real shared database/backend source of truth. Local browser storage is suitable only for local/demo usage.
5. Keep file uploads on server/cloud storage, not browser localStorage.

## Recommended command

```powershell
npm install
cd backend
npm install
cd ..
npm run build
npm run serve
```

For backend:

```powershell
cd backend
copy .env.example .env
npm install
npm start
```
