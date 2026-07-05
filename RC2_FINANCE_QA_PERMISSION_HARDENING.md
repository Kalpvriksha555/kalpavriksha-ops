# RC2 – Finance QA & Permission Hardening

## Scope
Focused security and data-integrity pass for Admin-only finance features.

## Changed Areas
- Backend `/api/state` finance sanitization and preservation
- Backend payment update endpoints permission guard
- Frontend backend-state requests include current user role headers
- Non-admin saves no longer overwrite finance fields or payment ledger data

## What This Fix Protects
- Managers/designers cannot fetch payments/audit through `/api/state` or `/api/app-state`.
- Managers/designers cannot update `/api/state/projects/:id/payment-status`.
- Managers/designers cannot post `/api/cases/:id/payment`.
- Manager/designer state saves preserve existing finance fields instead of blanking them.
- Finance dashboard/ledger remains Admin-only in the UI.

## Regression Safety
No changes were made to:
- Archive filtering
- Operations filtering
- Task completion logic
- Revision logic
- Upload/download logic
- Chat/attendance logic

## Verification Performed
- Frontend production build passed using Vite.
- Backend syntax check passed using `node --check backend/src/server.js`.
