# Upload / Download polish-only fix

Changed only the shared file service used by upload/download actions.

- Upload now uses XMLHttpRequest with a long timeout so large PDF/DWG files do not fail early on slow mobile networks.
- Download now prefers the real saved file URL before guessing a `/api/files/:id/download` route, preventing older numeric local ids from showing false missing-file errors.
- Download keeps the browser streaming the file directly instead of loading the whole file into memory, which is safer for mobile and large files.
- Download opens in a browser-safe target to improve behavior on desktop and mobile.

No case status, archive, completion-rate, assignment, or team availability logic was changed.
