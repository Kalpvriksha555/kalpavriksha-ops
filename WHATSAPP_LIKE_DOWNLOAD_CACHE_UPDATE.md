# WhatsApp-like Download Cache Update

## What changed
- Downloaded project files are now saved in the browser's local IndexedDB cache.
- If a file has already been downloaded in the same browser, its action changes from `Download` to `Open`.
- A `Downloaded` badge appears beside files saved locally.
- Clicking `Open` opens the saved browser copy without re-downloading from the server.
- If the browser cache was cleared or the local copy is missing, the app removes the stale downloaded state and asks the user to download again.
- First-time download still shows the local progress bar, percentage, file size, and ETA.

## Important browser limitation
A normal website cannot reliably verify whether a file still exists inside the user's Windows/Android Downloads folder after it was downloaded. This update therefore stores a WhatsApp-like saved copy inside the browser app storage. It is the closest reliable web behavior to WhatsApp's downloaded-file experience.

## Verification
- Root frontend build passed.
- Frontend folder build passed.
- Backend syntax check passed.
