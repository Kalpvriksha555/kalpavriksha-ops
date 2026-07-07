# Phase 21C - Mobile Friendly Preview + Performance UX

Implemented mobile hardening for the unified preview system and the simplified Performance Analytics UI.

## Preview fixes
- Full-screen mobile viewer uses `100dvh` and no rounded desktop frame on phones.
- Viewer now stretches above chat, drawers, sidebars, and floating chat buttons.
- Mobile-safe header with smaller title and controls.
- Bottom horizontal mobile toolbar added for zoom in/out, fit, rotate, open and download.
- Images are constrained inside the viewer on mobile and do not overflow behind chat.
- PDF iframe height is constrained for mobile viewport.
- Safe-area padding added for mobile bottom bars/notches.
- Touch scrolling and overscroll containment improved.

## Performance Analytics mobile polish
- Performance page headings scale down on phones.
- Filters/buttons become full-width on mobile.
- Grids use tighter spacing on mobile.
- Tables keep horizontal scroll with smooth touch scrolling.

## Stability
- Attendance V3 untouched.
- Preview backend untouched.
- Archive/Operations/Finance logic untouched.
- Frontend production build passed.
