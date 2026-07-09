# Modularization Phase 7 Runtime Hotfix

Fixed post-login runtime errors introduced during Active Operations extraction.

## Fixed
- `DailyClosingReport is not defined`
- `ProductivityDashboard is not defined`

## Cause
These components were moved into the Command Centre module during earlier extraction, but App.jsx still rendered them directly on their own tabs.

## Change
- Exported `ProductivityDashboard` from `components/command-centre/CommandCentreView.jsx`
- Exported `DailyClosingReport` from `components/command-centre/CommandCentreView.jsx`
- Imported both components explicitly in App.jsx
- Applied the same fix to both `frontend/src` and root `src`

No business logic changed.
