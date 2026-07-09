# Chat Personal Unread Star Fix

Focused chat-only correction.

## Fixed
- Direct-message unread marker/star now uses a dedicated direct-message check instead of relying only on shared read receipts.
- If someone sends a personal message, the sender's name in Direct Messages shows a yellow star/count until that conversation is opened.
- Opening that direct conversation clears the star for that sender.
- Global chat messages do not trigger the personal star.

## Scope
Only the chat component logic/display was touched. Other application modules were not modified.
