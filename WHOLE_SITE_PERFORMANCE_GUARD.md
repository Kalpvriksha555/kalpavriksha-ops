# Whole-Site Performance Guard

This release audits foreground writes, adaptive synchronization, React rendering, response shaping, and PostgreSQL persistence so activity in one option does not make unrelated screens slow.

## Corrections

- Notification filtering, category totals, and activity-timeline construction run only while the notification panel is open.
- Assignment recommendations run only while the new-task form is open.
- Operations sorting/filtering runs only on Operations or My Tasks.
- Designer navigation no longer schedules a state update from inside render.
- Admin task responses reuse authoritative task rows instead of deep-cloning every task on each poll.
- Row-level writes preserve unrelated records even inside a changed collection, so adding one audit or notification row no longer deep-clones the complete audit or notification table.
- Canonical integrity hashing caches immutable row serializations while retaining an uncached full startup verification, reducing hash work without weakening corruption detection.
- Non-admin redacted task responses are cached by stable task object and mutation stamp.
- Deleted-task IDs, chat-read state, and miscellaneous state use batched PostgreSQL upserts instead of one SQL round-trip per record.
- Routine selective writes keep full PostgreSQL durability but spread heavy recovery snapshots over 100 writes or 60 minutes by default. Critical routes can still force or request shorter snapshot intervals.

## Durability boundary

Every successful operational write still commits its selected relational rows and updates canonical integrity metadata in the same PostgreSQL transaction. The less-frequent `state_revisions` snapshot is secondary recovery history, not the authoritative write path.
