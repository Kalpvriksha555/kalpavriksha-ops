# UI Repair Notes

This build fixes the unstyled/plain HTML UI regression by removing runtime dependency on Tailwind compilation for the main stylesheet.

Changes made:
- Replaced `src/index.css` Tailwind directives with the already compiled production Tailwind CSS.
- Added `frontend/src/main.jsx` so the nested frontend can run correctly if opened from the `frontend` folder.
- Replaced `frontend/src/style.css` with the compiled production stylesheet so both root and frontend entry points load the same UI styling.
- No `.env` file is included. Keep the existing working backend `.env` unchanged.

Use:
- Root app: run from project root with `npm start` / `npm run dev`.
- Frontend folder app: run from `frontend` with `npm run dev` if needed.
