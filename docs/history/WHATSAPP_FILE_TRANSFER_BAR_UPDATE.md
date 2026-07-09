# WhatsApp-style File Transfer Bar Update

Implemented a clearer upload/download experience for users.

## Changes
- Uploads now show a WhatsApp-like file transfer card.
- Downloads now show a download progress bar when the browser exposes stream progress.
- Transfer UI shows:
  - file name
  - upload/download percentage
  - uploaded/downloaded size
  - estimated time left
  - complete/failed status
- Duplicate upload/download attempts are blocked while a transfer is running.
- Large uploads use XMLHttpRequest progress with speed and ETA calculation.
- Downloads use streamed fetch progress where possible, then save the file locally.

## Verified
- Root frontend build passed.
- Frontend folder build passed.
- Backend syntax check passed.
