# Phase 20A - In-App PDF Preview

Implemented PDF preview inside the web app so users can view PDFs without downloading them first.

## Added
- Preview button for PDF files in source, working, completed, and revised completed file sections.
- Full-screen in-app PDF preview modal.
- Optional Download button remains available from the preview modal.
- Backend `/api/files/:id/preview` endpoint streams PDFs with inline content disposition.
- Non-PDF files continue to use Download/Open behavior.

## Stability
- Existing upload/download progress bars are preserved.
- Existing 7-day download cache remains unchanged.
- Desktop work is not required for this feature.
- Browser/mobile web users can use Preview immediately.
