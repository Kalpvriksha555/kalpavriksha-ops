# Phase 13G — Chat Action Menu Layering Fix

## Fixed

- Message three-dot action menu no longer renders behind the chatbox/composer.
- Mobile message options now open as a high-priority bottom sheet above the full-screen chat.
- Desktop message options are constrained within the viewport and stay above the composer.
- Portal overlay uses the highest layer and isolates pointer events from the chat panel beneath it.
- Direct-message horizontal/user scrolling remains unchanged.

## Validation

- Frontend production build passed.
- Backend syntax check passed.
