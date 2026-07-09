# Mobile Team Availability + File Upload/Download Fix

Applied fixes:

1. Team Availability card
   - Mobile layout now uses 2 columns for status cards and 4 columns from small screens upward.
   - Offline count excludes Admin users so Admins do not incorrectly inflate Offline.
   - Member rows now wrap safely and no longer push content outside the card.
   - List height increased for mobile/desktop and keeps a proper internal scrollbar.

2. Mobile/desktop downloads
   - Download now streams directly from the backend instead of loading the file into browser memory.
   - Mobile browsers open the backend download URL in a new tab/window, which works more reliably on Android/iOS.
   - Desktop still uses a direct download anchor with backend Content-Disposition.

3. Upload/download durability
   - Uploaded files are now also persisted into PostgreSQL `files_meta.file_data` when DATABASE_URL is configured.
   - If the Render/VPS local upload folder loses a file after restart/redeploy, the backend restores the file from PostgreSQL during download or `/api/uploads/:filename` access.
   - Existing upload metadata is still preserved in app state and file registry.
