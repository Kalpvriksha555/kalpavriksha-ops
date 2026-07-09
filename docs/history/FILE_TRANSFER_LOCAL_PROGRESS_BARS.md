# File Transfer Local Progress Bars

Updated the upload/download progress behavior so users see transfer status at the exact place where the action happens.

## Changes
- Removed the large global transfer banner from the top of Documents & Files.
- Source file uploads now show the WhatsApp-style progress bar next to the Add Source File control.
- Working file uploads now show the progress bar next to Upload Work File.
- Final/completed upload progress stays inside the Submit Work area.
- Revision and discussion attachments show progress near their attachment controls.
- Downloads now show progress inside the same file row/card that was clicked.
- Duplicate transfer protection retained.

## Checks
- Backend syntax check passed.
- Frontend build passed.
