# Phase 25A - Viewer QA Fullscreen Polish

Scope: production viewer UX polish only. No task, finance, attendance, archive, chat business logic changed.

Changes:
- Expanded shared preview viewer to a document-first workspace.
- Desktop viewer now uses near full-screen sizing instead of compact modal sizing.
- Removed permanent footer/shortcut strip so the document gets more vertical space.
- Merged preview actions into a single compact top toolbar.
- Renamed Save behavior to Download in the viewer.
- Kept zoom, fit width, fit page, rotate, reset, open, download, close controls in one place.
- Improved mobile viewer sizing to use full viewport.
- Kept preview backend and file-service logic untouched.

Validation:
- Frontend build passed.
- Backend syntax check passed.
- Project doctor passed.
- Regression guard passed.
- Production audit passed.
