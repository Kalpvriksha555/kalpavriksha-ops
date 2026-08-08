# Final Health Probe Closure

Release 1.9.29 closes the final false-negative deployment failure observed in production after 1.9.28 had already reached a healthy permanent backend.

## Production failure reproduced

The 1.9.28 deployment completed clean install, release certification, relational integrity, staged readiness, permanent source parity, frontend atomic switching, permanent PM2 cutover, liveness and readiness. Its final verification then called `/api/db/health` anonymously with `curl -f`. That endpoint is intentionally protected by `requireAdminSession`, so the correct HTTP 401 response became curl exit code 22 and triggered rollback.

## Permanent correction

The deployment controller now validates the database through the existing production CLI integrity command and validates the runtime only through the public liveness/readiness endpoints:

```bash
npm run db:integrity --prefix backend
curl -fsS http://127.0.0.1:8080/api/health/live
curl -fsS http://127.0.0.1:8080/api/health/ready
```

It deliberately does **not** make `/api/db/health` public and does **not** synthesize an administrator session for deployment. The protected endpoint remains protected.

A regression test requires the final deployment block to use CLI database integrity plus `/api/health/live` and `/api/health/ready`, forbids `/api/db/health` there, and verifies the backend route still uses `requireAdminSession`.

All 1.9.28 atomic frontend gate, 1.9.27 source parity, 1.9.26 deployment/backup concurrency, and 1.9.25 relational write integrity protections remain unchanged.
