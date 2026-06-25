# Chat & Meeting Focused Production Update

This update intentionally touches only the chat and meeting experience. It does not change the already-working authentication, case flow, admin controls, attendance, team activity, team availability, finance, calculator, OTP, or dashboard logic.

## Updated areas

### Chat smoothness
- Added in-chat search for the current conversation.
- Added mobile direct-message selector so mobile users can switch between Global Chat and individual chats without relying on the desktop sidebar.
- Added smoother auto-scroll behavior that avoids fighting the user while they are reading older messages or searching.
- Added a “Jump to latest” button when the user scrolls up.
- Disabled the send button for empty messages to prevent accidental blank sends.
- Preserved existing read receipts, unread counts, mentions, file attachments, delete-message permission, and presence badges.

### Individual audio/video/screen calls
- Improved direct-call panel with call type and duration.
- Added safer copy-link feedback for direct calls.
- Kept the same Jitsi-based call room structure so users can join from the same direct chat room.
- Kept screen sharing through the Jitsi toolbar and Open / Share Screen button.

### Team meeting
- Added Start Meeting / End controls without changing existing meeting access.
- Added visible live meeting timer.
- Added quick meeting flow guidance.
- Added local meeting notes for discussion points/action items.
- Kept the same persistent team meeting room so existing users can continue joining consistently.

## Validation
- Root production build passed with `npm run build`.
- Frontend production build passed with Vite.
- `.env` was not changed and should be kept as-is.

## Files intentionally affected
- `src/App.jsx`
- `frontend/src/App.jsx`
- Production build output under `dist/` and `frontend/dist/`
