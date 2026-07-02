# Chat unread target fix

Fixes a chat preview/unread issue where messages that were not visible to the current user could still appear in the floating chat preview. This caused a preview toast to appear, but opening chat showed an empty conversation.

Changes:
- Unread chat count now includes only global messages or direct messages addressed to the current user.
- Direct messages sent between other users no longer appear in the current user's chat unread preview/count.
- Opening the floating preview now routes to the exact visible channel for the current user.
- Channel message rendering now uses the same visibility guard as unread detection.
