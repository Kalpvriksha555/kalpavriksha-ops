# Chatbox Overflow Final Fix

Focused chat-only update.

What was changed:
- Restored/bounded chat window size so it no longer stretches across the full screen.
- Kept chat floating at bottom-right with safe max width/height.
- Fixed attachment/image preview so uploaded images display inside the message card instead of taking over the chatbox.
- Kept the chat sidebar visible on desktop with stable width.
- Protected the message area from overflow using bounded message bubbles and contained previews.

No backend, attendance, team availability, case workflow, admin controls, finance, operations, command centre, authentication, or email files were changed intentionally.

Keep the existing working .env unchanged.
