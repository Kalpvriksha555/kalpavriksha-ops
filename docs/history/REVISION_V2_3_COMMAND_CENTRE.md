# Revision v2.3 – Command Centre Integration

## Scope
Focused Command Centre-only enhancement for revision visibility.

## Changed
- Added Revision Dashboard section in Command Centre.
- Added revision KPI cards:
  - Pending
  - Under Review
  - Approved Today
  - Average Time
  - Oldest Pending
  - Over 3 Days
- Added clickable filters for revision queue, review queue, approved-today revisions, and oldest pending revision.
- Added compact revision timeline chips for active revision items.
- Existing Archive and Operations filtering logic was not changed.

## Verification
- Frontend build checked with `node node_modules/vite/bin/vite.js build`.
- Backend syntax checked with `node --check` on backend JS files.

## Files Modified
- `src/components/command-centre/CommandCentreView.jsx`
- `REVISION_V2_3_COMMAND_CENTRE.md`
