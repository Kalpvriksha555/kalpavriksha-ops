# Deployment Guide

## Backend
1. Upload backend files to the production server.
2. Install dependencies:

```bash
cd backend
npm install --omit=dev
```

3. Configure `.env` using `.env.example`.
4. Start/restart backend:

```bash
pm2 restart kalpavriksha-backend
```

5. Verify health:

```bash
curl http://localhost:8080/api/health
curl http://localhost:8080/api/state
```

## Frontend
1. Install dependencies:

```bash
cd frontend
npm install
```

2. Build:

```bash
npm run build
```

3. Deploy the generated `dist/` folder to the frontend host.

## Important Notes
- Frontend must point to the production backend API URL.
- Backend must have PostgreSQL connection variables configured.
- File storage paths must remain persistent across deployments.
