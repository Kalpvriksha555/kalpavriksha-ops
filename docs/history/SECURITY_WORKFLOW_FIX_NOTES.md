# Security & Workflow Fix Notes

Applied fixes:

- Pending tasks assigned to a user now remain visible in My Tasks until completed, including previous-day carry-forward work.
- Take Break updates user availability immediately; Team Availability now includes the current user and admins as well.
- Forgot Password no longer lets anyone reset an account by knowing a username. It now creates a secure admin-reset request flow message.
- User password changes still require current password inside Profile.
- Admin password reset remains available from Team & Security.
- Chat unread counts now use read receipts instead of stale last-read IDs, so unread badges clear immediately when messages are opened/read.
- Build tested successfully with `npm run build`.
