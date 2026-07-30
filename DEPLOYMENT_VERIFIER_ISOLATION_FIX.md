# Deployment verifier isolation fix

The Phase 2, 3, 4, 6, 7 and 8 runtime verification servers now explicitly clear `DATABASE_URL` and use isolated temporary runtime paths. This prevents a VPS verification run from inheriting the production Supabase connection and either timing out or touching live production data.

The Phase 2 finance verifier additionally isolates its data directory, private file store, backup directory, legacy upload directory and release-certificate path.
