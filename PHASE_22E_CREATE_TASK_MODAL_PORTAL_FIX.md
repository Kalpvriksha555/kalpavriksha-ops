# Phase 22E – Create Task Modal Portal Fix

Fixes the Create Task modal being clipped/overlapped by the app shell.

## Changes
- Rendered Create Task modal through a body-level React portal.
- Increased modal z-index above all app UI.
- Locked both body and html scrolling while modal is open.
- Reset modal scroll to the top whenever opened.
- Rebuilt modal sizing to use 100dvh safely on desktop and mobile.
- Removed negative sticky header offsets that could hide the Create Task header.
- Kept task creation data flow unchanged.

## Validation
- Frontend build passed.
