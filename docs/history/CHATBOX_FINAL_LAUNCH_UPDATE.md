# Chatbox Final Launch Update

Focused scope only: chatbox and the small message handlers required by chat.

## Fixed / Improved
- Restored stable chatbox layout without touching other modules.
- Kept Global Chat and Direct Messages available together.
- Added persistent direct-message unread marker/star on the sender name until that DM is opened.
- Added message actions menu:
  - Reply
  - Copy
  - Forward to input
  - Edit own message
  - Delete own message / Admin delete
- Added reply preview inside messages.
- Added edit mode with clear editing indicator.
- Kept multi-emoji selection before sending.
- Improved emoji/reaction handling.
- Reactions are now saved with the message when possible, not only locally.
- Voice note functionality preserved.
- Attachment preview/download functionality preserved.
- Local state now updates immediately after deleting a message.

## Validation
- Root frontend production build: passed.
- Frontend folder production build: passed.
- Working `.env` files are not included in this ZIP for safety.

## Notes
Keep your existing working `.env` unchanged.
