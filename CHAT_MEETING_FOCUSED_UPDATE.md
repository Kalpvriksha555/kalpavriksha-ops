# Chat & Meeting Focused Update

Only chat and meeting-related code was changed.

## Improved
- Team Meeting room controls: video/audio mode, copy link, open in new tab, and screen-share guidance.
- Direct chat call controls: audio call, video call, and screen-share/help session now use one stable room per user pair.
- Call invites now include a join/open action inside the chat message.
- Direct chat header now shows online/offline and last-seen information for the selected person.
- Chat input supports Enter to send and Shift+Enter for a new line.
- Chat file upload input resets after upload, allowing the same file to be selected again.
- Jitsi meeting URLs are generated through one shared safe helper to avoid broken room names.

## Not changed
- Authentication
- Attendance
- Team availability
- Admin controls
- Case workflows
- Database configuration
- Email OTP
- Existing UI/theme outside chat and meeting areas

## Validation
- Root frontend production build completed successfully with Vite.
- Working .env is not included; keep the existing working .env unchanged.
