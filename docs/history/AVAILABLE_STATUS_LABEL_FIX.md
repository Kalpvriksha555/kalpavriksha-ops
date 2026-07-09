# Available Status Label Fix

Fixed the Team Availability and Team Activity panels so available online users no longer show stale historical text like `Free since 46h`.

Changed behavior:
- Available users now show simply: `Available`.
- Drafting users still show active drafting duration.
- Break users still show current break duration.
- Offline users still show last seen.

Files changed:
- `frontend/src/components/command-centre/CommandCentreView.jsx`
- `frontend/src/components/operations/ActiveOperationsView.jsx`
