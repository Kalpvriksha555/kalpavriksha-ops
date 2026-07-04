# Payment Columns UI Fit Fix

Scope: UI-only polish for admin payment-status columns.

Changed:
- Replaced long `Payment: Not Updated` text with compact status-only badges.
- Added colored status dot inside payment badge.
- Tightened Active Operations grid widths when Payment column is visible.
- Added fixed Archive table column sizing so Payment and Action columns remain inside screen.
- Kept columns admin-only.
- No case, archive, assignment, upload/download, payment ledger, or backend logic was changed.

Build: Passed with `npm run build`.
