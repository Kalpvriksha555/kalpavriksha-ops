# Phase 13H — WhatsApp Floating Message Menu

## What changed

- Converted the restored message action menu from bottom-sheet style into a compact WhatsApp-like floating card.
- Mobile menu now anchors near the tapped message instead of opening at the bottom.
- Menu stays above the chatbox/composer through a document-body portal and maximum z-index layering.
- Desktop menu keeps the same reliable portal layering and stays near the clicked message.
- Removed dark mobile backdrop for message options so the menu feels lightweight and floating.
- Kept all existing chat actions unchanged: Reply, Pin/Unpin, React, Forward, Copy, Edit, Hide for me, Delete for everyone.

## Validation

- Frontend build passed.
- Backend syntax check passed.
- No backend/chat data logic changed.
