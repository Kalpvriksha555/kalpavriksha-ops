# Phase 13F – Chat Action Menu Real Fix

## Fixed

- Restored the message three-dot menu as a real portal-based floating menu.
- Menu now anchors to the clicked three-dot button instead of appearing under the composer.
- Mobile message options now open above the message area with very high layering.
- Desktop message options no longer get clipped or hidden behind the chat panel/input area.
- Added touch-end and pointer-up handling so mobile taps reliably open the menu.
- Direct-message horizontal/user scrolling remains preserved.

## Validation

- Frontend build passed.
- Backend syntax check passed.

## Scope

- No backend logic changes.
- No Archive/Operations filtering changes.
- No chat data model changes.
