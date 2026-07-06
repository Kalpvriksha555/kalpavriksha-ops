# Phase 13I — Reaction Picker Layering Fix

Fixed the chat reaction picker so it no longer opens behind the chat panel/composer.

## Changes
- Reaction picker now uses a high z-index portal, same as the restored message options menu.
- Reaction picker opens as a WhatsApp-style floating card near the clicked message/menu.
- Mobile no longer uses a bottom-sheet reaction panel that can be hidden behind chat layers.
- Reaction picker is constrained inside viewport and stays above the chatbox.
- No backend or chat data logic changes.
