# Kalpavriksha Ops Database Launch Notes

## What changed

This build now uses the backend as the central state source. When `DATABASE_URL` is set in `backend/.env`, the backend persists operational state to PostgreSQL.

The app still keeps browser/local JSON as a safety cache, but the launch target is:

- Frontend -> Backend API
- Backend API -> PostgreSQL
- Uploaded files -> backend/uploads folder

## Required before live launch

1. Create a PostgreSQL database.
2. Copy `backend/.env.example` to `backend/.env`.
3. Set:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/kalpavriksha_ops
DB_SSL=false
```

Use `DB_SSL=true` if your database host requires SSL.

4. Start backend:

```bash
cd backend
npm install
npm run start
```

5. Check database:

```bash
npm run db:health
```

Expected production result:

```json
{
  "ok": true,
  "database": "postgresql",
  "connected": true
}
```

If it says `json-file`, PostgreSQL is not active and it is not a true production database deployment yet.

## Frontend build

```bash
npm install
npm run build
npm run serve
```

## Production checks run in this package

- Frontend production build: PASSED
- Backend JavaScript syntax check: PASSED
- Backend health endpoint: PASSED
- Database health endpoint: PASSED in JSON fallback mode
- State API endpoint: PASSED
- Smoke checks: PASSED

## Important truth

This package has PostgreSQL support and central backend persistence. A real PostgreSQL server was not available inside this build environment, so live PostgreSQL connection must be verified on your hosting/server after setting `DATABASE_URL`.
