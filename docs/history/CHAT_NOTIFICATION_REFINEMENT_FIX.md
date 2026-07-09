# Chat Notification Refinement Fix

Focused patch for chatbox notification accuracy.

## Fixed
- Video/audio/screen-call messages no longer appear as generic "New Chat Message".
- Floating chat preview now shows correct labels:
  - Video Call Started
  - Audio Call Started
  - Screen Share Started
  - New Chat Message
  - New Attachment
  - New Voice Note
  - New Reply
- Chat unread badge now counts unread chat messages and excludes call/system call events from the badge count.
- Direct-message notification payload now stores a structured title, message preview, source name, conversation, action, and related message id.
- Notification centre and toast cards now use normalized display labels.
- Sender avatar/photo is used in the floating chat preview when available.

## Scope
Only chat and notification display/metadata were changed. Task, attendance, archive, profile, file, and presence logic were not changed.
