# Isolated candidate certification closure — 2026-08-08

Release family: `1.9.30-runtime-persistence-recovery`

## Why this gate exists

Repeated source-only verification was not enough to prove the real React/Vite dependency graph or the production-sized case/upload persistence path. A guarded deployment previously caught a duplicate-React verifier defect before live cutover, and the production browser exposed an optimistic-task upload timing failure that static checks alone could not reproduce.

This closure makes isolated VPS certification mandatory before the production launcher will start.

## Additional upload safety correction

When a browser task ID collides with an already-existing task, the server can commit the new task under a different canonical ID. If an upload later carries both the stale optimistic ID and the original create mutation ID, the mutation identity is the stronger reference. The backend now resolves `lastTaskMutationId` before the stale ID. This prevents a pathological collision from attaching the new file to the older task that owns the stale ID.

## Mandatory isolated VPS certification

`scripts/candidate-certify-1.9.30-vps.sh`:

1. refuses to run from `/var/www/kalpavriksha-ops`;
2. verifies the candidate is the current GitHub `main` commit;
3. verifies the packaged SHA-256 manifest;
4. installs root, backend and frontend dependencies only inside the candidate;
5. proves React and ReactDOM resolve from the same frontend dependency tree;
6. runs the real React/Vite signed-out bootstrap;
7. runs the complete `npm run verify` chain and production frontend build;
8. runs the clean-install verifier in a second copied source tree;
9. takes a read-only transaction-consistent `pg_dump` of production;
10. restores that dump into a disposable local PostgreSQL database;
11. starts the candidate backend on loopback with isolated private-file/data roots;
12. creates one normal disposable case and measures its server latency;
13. forces a second create with the same optimistic ID and requires canonical server reallocation;
14. replays the same create mutation and requires idempotent recovery of the canonical case;
15. uploads a real 4 MiB PDF using the stale optimistic ID plus the canonical create mutation;
16. proves the upload resolves to the second canonical case and is not attached to the collided first case;
17. downloads the stored file and requires an exact SHA-256 byte match;
18. fails on relational-shadow divergence, metadata CAS, selected-collection mismatch, target-task-not-found, uncaught exception or unhandled rejection markers;
19. checks GitHub `main` did not move during certification;
20. drops the disposable database/role and removes the temporary runtime.

The live PostgreSQL database is read only during the snapshot. All candidate writes happen only in the disposable clone. The live PM2 process, live frontend, live source tree and live private-file root are never changed.

## Production deployment enforcement

`scripts/launch-deploy-1.9.30-vps.sh` now refuses to launch unless:

- `/root/kalpavriksha-certified-candidate.commit` exists;
- `/root/kalpavriksha-certified-candidate.result.json` exists and reports `CERTIFIED_FOR_GUARDED_DEPLOYMENT`;
- the receipt proves download hash equality, canonical stale-ID recovery and wrong-task attachment prevention;
- the current release Git commit exactly equals the certified commit; and
- GitHub `main` still equals that same commit.

This prevents the operator from accidentally deploying an untested or newer commit after candidate certification.

## Runtime bootstrap verifier correction
The first server-rendered App frame intentionally shows `Preparing secure sign-in` because React effects do not run during SSR. Certification therefore verifies that secure pre-authentication frame and separately renders the exported `LoginScreen` with the same frontend React/ReactDOM dependency tree. This prevents the verifier from rejecting the intended boot state while still proving the actual login controls render without hook or null-reference failures.
