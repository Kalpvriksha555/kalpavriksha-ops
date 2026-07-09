# Navigation Return Fix

Focused navigation-only patch.

## Fixed
- Opening a case from Archive and pressing Back now returns to Archive instead of Operations.
- Case details now remember the page that opened them.
- Back restores the previous scroll position where possible.
- Same behavior is applied consistently for Command Centre, Finance/Ledger, Archive, Operations/My Tasks, Search Results, and Chat task references.

## Not touched
- Case completion/status logic
- Archive data logic
- Upload/download logic
- Assignment logic
- Backend/database logic
