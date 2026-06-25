# Kalpavriksha Ops Database Migration

This version adds PostgreSQL support to the backend.

## What changed

- Backend can now use PostgreSQL as the central database when `DATABASE_URL` is set.
- Existing local `backend/src/data/db.json` is still supported as a fallback for development.
- New database health endpoint: `GET /api/db/health`.
- New migration endpoint: `POST /api/db/migrate-json-to-postgres`.
- New scripts:
  - `cd backend && npm run db:health`
  - `cd backend && npm run db:migrate-json`

## Recommended production setup

Use PostgreSQL for operational data and keep uploaded files on the server disk or move them later to S3/Firebase Storage.

### 1. Create PostgreSQL database

```sql
CREATE DATABASE kalpavriksha_ops;
```

### 2. Backend `.env`

```env
PORT=8080
PUBLIC_APP_URL=https://your-domain.com
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/kalpavriksha_ops
DB_SSL=false
```

For hosted PostgreSQL providers, set:

```env
DB_SSL=true
```

### 3. Install and run backend

```powershell
cd backend
npm install
npm run dev
```

### 4. Check database connection

```powershell
npm run db:health
```

### 5. Migrate existing JSON data

Keep the backend running in one terminal, then in another terminal:

```powershell
cd backend
npm run db:migrate-json
```

This moves the current JSON data into PostgreSQL.

## Important note

The React frontend still has Firebase/local cache code in parts of the app, but the backend now has a PostgreSQL central persistence layer for API-based workflows and OTP. The next hardening step is to move all frontend case/user/chat/attendance writes to backend API endpoints only, so Firebase/localStorage can be removed fully.

