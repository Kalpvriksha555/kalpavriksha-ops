# End-to-End Certified Deployment Closure V2 — 2026-08-08

This closure removes the final certification harness permission dependency observed on the VPS.

## Root cause closed

The previous integrated preflight created a root-owned mode-0700 directory and then invoked `pg_restore` as the Linux `postgres` user. Changing only the dump file ownership was insufficient because directory traversal was still blocked.

## Permanent design

- Only `initdb` and `pg_ctl` run as the Linux `postgres` account.
- `psql`, `createdb`, `dropdb`, `pg_dump`, and `pg_restore` run as the root operator process while explicitly authenticating to the private temporary PostgreSQL cluster as database superuser `postgres`.
- Dump files remain root-private mode 0600; restore no longer depends on OS-level file traversal by `postgres`.
- The realistic candidate clone creates its schema from the exact release migrations and imports only the 15 authoritative relational-state tables from production. Supabase-owned schemas/extensions and production authentication credentials are not cloned.
- The production state snapshot is transaction-consistent and read-only. All mutations remain confined to the disposable local database.
- The candidate still must pass collision allocation, idempotent replay, stale optimistic-ID upload resolution, 4 MiB upload/download hash equality, runtime error scan, and exact certification receipt before production deployment can start.
