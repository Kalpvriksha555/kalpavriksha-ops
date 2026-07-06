# Post v1 Phase 11 — Global Search

Implemented a safer enterprise-wide global search layer without changing workflow logic.

## Included

- Case search across task ID, bank, branch, customer, location, assignee, type, status, payment status, and description.
- Team search across name, username, role, availability, and status.
- Notification search across visible notifications for the logged-in user.
- Chat search across sender, message text, channel, recipient, and attachment name.
- Search results grouped into Cases, Team, Notifications, and Chat.
- Case result clicks open the case detail directly.
- Team result clicks open Team view.
- Notification result clicks open the notification panel and mark that notification read.

## Stability Notes

- No Archive filtering changes.
- No Operations filtering changes.
- No backend workflow changes.
- Existing global case search remains compatible with the active board filter.

## Validation

- Frontend production build passed.
- Backend syntax check passed.
