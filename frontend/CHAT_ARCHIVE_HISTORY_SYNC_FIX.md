# Chat + Archive History Sync Fix

Focused fixes:
- Archive now detects completed files saved as `Completed File`, `Final`, `FINAL`, `REVISION_FINAL`, `Revised File`, or legacy completed fields.
- Previous-day completed files remain visible in Task History Catalog.
- Backend state polling now merges incoming chat history, so previously received messages appear when chat opens.
- Chat notifications are merged during polling without replacing local state unnecessarily.
- No attendance/task workflow/theme logic changed.
