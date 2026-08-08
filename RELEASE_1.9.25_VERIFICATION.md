# Release 1.9.25 Verification

Release: `1.9.25-permanent-relational-write-integrity`  
Backend: `2.9.25-permanent-relational-write-integrity`  
Frontend: `2.9.25-permanent-relational-write-integrity`

## Completed before packaging

- Backend regression tests: **140 passed, 0 failed**.
- Frontend regression tests: **72 passed, 0 failed**.
- Frontend/backend contract verification: **72 checks passed across 83 backend routes**.
- Security package audit: **passed**.
- Regression guard: **passed**.
- Production regression audit: **passed**.
- Database-integrity source verifier: **passed**, including all ten relational migrations and 16 verified tables.
- Release-certification source verifier: **passed**.
- Frontend/UX verifier: **passed**.
- JavaScript syntax checks passed for the backend server, PostgreSQL repository and reliability service.
- Deployment shell syntax check passed.

## Deployment-time mandatory gates

The packaged deployment script repeats clean dependency installation and the complete verification suite on the VPS. It then requires:

- a verified full pre-deployment backup;
- successful PostgreSQL migration checks;
- strict relational integrity before the new backend starts;
- exact release certification and release gate approval;
- staged liveness and readiness;
- permanent-path liveness and readiness;
- final database integrity;
- a verified post-deployment backup.

A failed gate automatically restores the previous runtime, environment file, certificate and frontend build. No deployment gate rewrites business rows or restores an old database automatically.
