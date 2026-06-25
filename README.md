# Kalpvriksha v3.7 Completed File + WhatsApp Fix

Only requested behavior was changed. UI/look is kept the same.

Fixes:
- Completed uploads are saved as completed documents and displayed in the Completed Work section.
- Completed documents are visible/downloadable for all roles.
- Share PDF on WhatsApp button becomes active when a completed file exists.
- WhatsApp sharing tries native file share first with file only and no message.
- Desktop fallback downloads the completed file and opens WhatsApp Web without any pre-filled message.
- Firebase Storage is used for uploads when available to avoid Firestore document-size failures.
- Added missing src/main.jsx entry file for Vite build.

Run:
npm install
npm run dev

Build checked:
npm run build


## Launch note

This package runs the frontend from the project root, not from the older `frontend/` placeholder folder.
Use these commands from the main project folder:

```powershell
npm install
npm run build
npm run serve
```

Run the backend separately from `backend/` when OTP/API features are needed.

## Production database launch

See `DATABASE_LAUNCH_README.md` before going live. PostgreSQL is active only when `backend/.env` contains a valid `DATABASE_URL`.
