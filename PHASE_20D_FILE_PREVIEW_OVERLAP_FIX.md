# Phase 20D – File Preview Overlay Fix

## Fixed
- File preview modal now renders through a React portal into `document.body`.
- Preview overlay z-index increased to `z-[9999]`.
- Payment Ledger / side panels can no longer appear above or overlap the PDF/image preview.
- Preview remains full-screen and independent of task-detail layout stacking contexts.

## Why
The previous preview modal was rendered inside the task detail component. Some parent/layout sections create stacking contexts, so the Payment Ledger panel could visually sit above the preview. Moving the modal to a body-level portal makes it a true global overlay.

## Note
If the preview says the physical file is missing, that is a separate server-file-storage issue: the database record exists, but the actual uploaded file is not present on the server. Re-uploading that file fixes that specific record.
