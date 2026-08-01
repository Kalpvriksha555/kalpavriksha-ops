# Relational Integrity Row Count Fix

The production startup guard now compares metadata counts with the physical relational rows that actually exist in PostgreSQL.

Previously, startup recomposed the relational payloads and decomposed them again before counting. Legacy file and performance payloads can omit IDs or share the same derived key, so this second decomposition collapsed distinct database rows and produced a false `RELATIONAL_STATE_INTEGRITY_FAILURE` for `files` and `performanceRecords`.

The corrected guard:

- preserves the snapshot hash verification;
- compares entity counts directly against the physical relational parts;
- continues to reject genuine row-count or hash corruption;
- does not modify operational data; and
- includes regression coverage for duplicate legacy payload keys stored under distinct relational row IDs.
