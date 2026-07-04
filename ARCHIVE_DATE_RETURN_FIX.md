# Archive Date Return Fix

Implemented a navigation-state refinement for Archive case opening.

## Fixed
- Archive no longer resets to the current date after opening a case from an older archive date.
- Archive filters are now stored in the parent app state while case detail is open.
- Back from a case returns to Archive with the same selected date/month and previous scroll position.

## Scope
- Navigation/UI state only.
- No changes to case data, completion status, assignment, upload/download, payment status, or database schema.
