# Revision Workflow v2.1 – Queue Hardening

Scope: Frontend-only Operations/My Tasks UI hardening.

## Changed
- Added a dedicated admin/manager/designer-visible Revision Queue panel inside Active Operations/My Tasks when active revision work items exist.
- Revision work items now remain visually distinct from normal tasks while preserving the original permanent case ID.
- Kanban view now includes revision statuses so revision tasks do not disappear when users switch from list view to board view.

## Stability Boundaries
- No Archive filtering changes.
- No Operations filtering changes.
- No backend schema changes.
- No Finance/Ledger changes.
- No upload/download changes.

## Regression Target
- Existing completed archive cases remain untouched.
- Existing active operations list remains unchanged except revision visibility polish.
- My Tasks continues to show assigned revision tasks.
