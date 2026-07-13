# Kalpavriksha Designs Ops - Repaired Package

## Run locally

```powershell
npm install
npm run dev
```

This starts the frontend at `http://localhost:5173` and the local fallback API at `http://localhost:8080`.

The frontend uses `https://api.kalpvriksha.co.in` by default so localhost shows and updates the same PostgreSQL tasks as the production site. To run against only the local backend, create `frontend/.env.local` containing `VITE_API_URL=http://localhost:8080`.

The bundled fallback snapshot contains the latest synchronized task state available when this package was built. If the production API is unavailable, the interface displays an offline-snapshot warning.

## Checks

```powershell
npm run data:check
npm run verify
```