# Phase 25L - Preview Runtime Final Elimination

Fixed the remaining runtime crash by removing the last active `openProjectFilePreview` references from the active frontend source.

Changes:
- Removed the `openProjectFilePreview` alias from `frontend/src/App.jsx`.
- File action buttons now call `openUnifiedFilePreview` directly.
- Chat preview receives `openUnifiedFilePreview` directly.
- Removed stale root `src/`, `dist/`, `.git/`, root `node_modules/`, raw `.env`, and backup files from the package.

Important local installation rule:
- Delete the old project folder before extracting this ZIP.
- Do not extract over the existing folder, because old root `src/` files can remain and keep serving stale code.
