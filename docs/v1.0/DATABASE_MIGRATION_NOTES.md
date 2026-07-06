# Database Migration Notes

## Current Release
This release uses the existing PostgreSQL-backed state model already present in the application.

## Timeline/Audit Data
Phase 5A introduced case timeline/audit event storage in the existing case data structure. The application is designed to merge timeline data safely without changing Archive or Operations filtering.

## Migration Policy
- Always backup before deployment.
- Never run destructive migrations without a verified restore point.
- Preserve existing case IDs and archive records.
- Preserve existing finance ledger entries.

## Verification Queries
After deployment, verify:
- Users count
- Cases count
- Chat messages count
- Notifications count
- Attendance logs count
