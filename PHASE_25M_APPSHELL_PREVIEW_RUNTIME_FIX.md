# Phase 25M – AppShell Preview Runtime Fix

Fixed the actual runtime stack trace from DevTools:

- `ReferenceError: openUnifiedFilePreview is not defined`
- Location: `AppShell`, where `CommunicationHub` received `onPreviewFile={openUnifiedFilePreview}`

Root cause:

- `openUnifiedFilePreview` existed inside the task-detail component scope.
- `AppShell` could not access that function.
- Chat preview rendered from `AppShell`, so React crashed before the page could load.

Fix:

- Added an AppShell-level `openUnifiedFilePreview` handler.
- Added AppShell-level preview state and viewer portal for chat/global previews.
- Kept the existing task-detail preview handler intact.
- Chat `onPreviewFile` now has a valid in-scope function.
- Download remains separate from preview.

Validation performed:

- Searched active frontend source for stale `openProjectFilePreview` references: none found.
- Confirmed `CommunicationHub` is passed an in-scope `openUnifiedFilePreview` from `AppShell`.

Important local install note:

- Delete the old project folder before extracting this ZIP.
- Do not overwrite old folders, because stale root `src` / old bundles can keep serving old code.
