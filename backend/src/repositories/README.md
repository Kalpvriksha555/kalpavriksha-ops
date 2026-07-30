# PostgreSQL repositories

`postgresStateRepository.js` is the Phase 5 authoritative operational-state repository. It owns:

- checksummed schema migrations
- one-time import from the legacy `app_state` row
- relational decomposition/reconstruction
- optimistic state-version locking
- transactional domain-table synchronisation
- canonical count/hash integrity checks
- append-only recovery revisions
- guarded revision restoration

Do not add direct `app_state` writes elsewhere. New schema changes must be introduced as a new immutable migration version; never edit an applied migration.
