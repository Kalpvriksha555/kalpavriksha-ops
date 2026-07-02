# Chatbox Final QA + Polish

Scope: chatbox and chat notification UX only.

## Fixed
- Unread preview opens the exact relevant conversation instead of opening an empty chatbox.
- Direct-message matching now supports user name, username, and user id aliases.
- Chat unread count now ignores call/screen-share invite events and counts only real chat messages.
- Read receipts/mark-read logic now supports user aliases.
- Forwarded message text typo fixed.
- Chat menu/picker state resets when switching channels or opening/closing chat.
- Message preview text now handles text, attachments, voice notes, and deleted messages clearly.

## Polished
- Chat panel z-index and layering.
- Desktop panel shadow, radius, and containment.
- Mobile bottom-sheet chat placement.
- Mobile single-chat-surface behavior.
- Attachment preview sizing.
- Emoji quick bar scrolling.
- Dark-mode chat readability.
- Unread preview layout and truncation.

## Not changed
- Task workflow.
- Attendance/presence logic.
- File backend logic.
- Meeting logic.
- Database structure.
