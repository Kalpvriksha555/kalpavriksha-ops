# Memory Stability Fix

This build fixes the multi-tab memory crash / Chrome Out of Memory issue.

What changed:
- Cross-tab sync no longer broadcasts large file/base64 payloads.
- Project and chat caches are compacted before React loads them.
- Large browser-only file previews are stripped from localStorage/Firebase sync metadata.
- Chat attachments now use local blob URLs instead of base64 strings for the active tab.
- Project uploads use local blob URLs for instant preview without storing huge base64 data in app state.
- Removed unnecessary focus-triggered project storage sync that repeatedly parsed large project payloads.
- Assignment/status sync still works through compact project metadata.

Expected result:
- Opening Admin + Manager + Designer tabs should not quickly climb into 700MB–1GB per tab.
- Existing giant localStorage blobs will be compacted automatically on first load of this build.

Note:
- If a file was only stored as a huge browser-local base64 preview in an older build, this build keeps its file name/metadata but may remove the old oversized preview to protect the app from crashing. For permanent production file downloads, configure backend/cloud file storage.
