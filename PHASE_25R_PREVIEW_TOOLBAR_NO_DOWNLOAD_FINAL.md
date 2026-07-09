# Phase 25R – Preview Toolbar Visibility and No-Download Final Repair

- Kept chat/global preview close button visible by stabilizing preview toolbar layout.
- Ensured zoom controls remain visible/scrollable on desktop and mobile.
- Removed raw preview fallback URLs from preview error paths so failed preview cannot trigger browser/IDM download.
- Kept Download as the only action that opens download endpoint.
- Backend syntax and project doctor passed.

Note: build was not run in this packaging environment because dependencies were intentionally not bundled in the cleaned ZIP. Run `npm install` then `npm run build` locally.
