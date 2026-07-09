# Phase 25P – Preview Final Repair

Focused fixes only for preview regressions observed in localhost:

- Chat image previews now stay inside the unified preview shell instead of showing only the dark backdrop.
- PDF zoom no longer shrinks the preview panel width; the panel remains full-size while the PDF viewer zooms internally.
- Preview/open fallback no longer opens raw preview URLs that can trigger browser/download-manager downloads.
- Chat image/PDF buttons now use Preview for previewable files and keep Download separate.
- The preview shell now has a stable full viewport container with a visible top bar/close button.

Validation:
- Frontend build passed.
- Backend syntax check passed.
