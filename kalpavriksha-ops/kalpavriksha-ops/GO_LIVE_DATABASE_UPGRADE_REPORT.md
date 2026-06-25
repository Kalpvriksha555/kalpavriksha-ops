# Go-Live Database Upgrade Report

## Result

This build adds a production database path using PostgreSQL.

## Verified

- Frontend production build passed with `npm run build`.
- Backend syntax check passed with `node --check backend/src/server.js`.
- Backend database health endpoint tested successfully in JSON fallback mode.
- Backend now supports PostgreSQL when `DATABASE_URL` is configured.

## Important

The backend now supports a central PostgreSQL database using `DATABASE_URL`.
If `DATABASE_URL` is not set, it will continue using local JSON file storage for development.

For production, do not leave `DATABASE_URL` empty.

## New Backend Endpoints

- `GET /api/db/health`
- `POST /api/db/migrate-json-to-postgres`

## New Backend Scripts

```powershell
cd backend
npm run db:health
npm run db:migrate-json
```

## Production Database Setup

1. Create PostgreSQL database.
2. Update `backend/.env`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/kalpavriksha_ops
DB_SSL=false
```

For hosted databases requiring SSL:

```env
DB_SSL=true
```

3. Start backend:

```powershell
cd backend
npm install
npm run dev
```

4. In another terminal, migrate existing JSON data:

```powershell
cd backend
npm run db:migrate-json
```

## Remaining Hardening Recommendation

The frontend still contains Firebase/local cache synchronization code in places. The database foundation is now ready, but the next hardening step should be to move all case/user/chat/attendance reads and writes through backend APIs only. That will fully remove Firebase/localStorage dependency for multi-computer production use.
