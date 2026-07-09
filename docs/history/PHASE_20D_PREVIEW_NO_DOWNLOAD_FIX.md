# Phase 20D — Preview Should Not Trigger Download

## Fixed
- Preview buttons now stop click bubbling so parent file cards cannot trigger download at the same time.
- Preview URLs are normalized so forced download endpoints are never used for in-app preview.
- `/api/uploads/:filename?mode=preview` now streams PDF/images inline with `Content-Disposition: inline`.
- Existing `/api/files/:id?mode=preview` and `/api/files/:id/preview` continue to stream inline.

## Result
Clicking Preview should open the in-app viewer only. Download starts only when the user clicks Download.

## Verification
- Backend syntax check passed.
- Frontend service syntax check passed.
