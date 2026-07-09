# Phase 24A - Modal Foundation Stabilization

Focused stabilization pass for the Create Task dialog.

## Changes
- Create Task now uses one fixed portal overlay with a single card layout.
- Modal header is outside the scroll body, so it no longer covers or clips form fields.
- The form has one dedicated scroll container; body/page scroll is locked while open.
- Submit button is sticky inside the form scroll area and remains reachable.
- Mobile modal is full-screen and avoids side clipping/double scrollbars.
- Removed reliance on negative margins and parent layout positioning for the modal header.

## Scope
No feature logic was changed. Task creation, backend sync, assignment, preview, chat, attendance and finance logic were left intact.

## Validation
- Frontend build passed.
- Backend syntax check passed.
