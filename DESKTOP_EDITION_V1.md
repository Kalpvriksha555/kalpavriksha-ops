# Kalpavriksha Ops Desktop Edition V1

This update adds a safe Electron desktop shell without replacing the existing web app.

## What changed

- Added `desktop/main.cjs` and `desktop/preload.cjs`.
- Added desktop scripts in root `package.json`.
- Added a desktop-only file cache bridge.
- Web version remains usable and unchanged.

## Desktop file behaviour

In the desktop app:

1. First click downloads the file into the app's private cache folder.
2. The file opens immediately in the default PDF/image/DWG viewer.
3. For 7 days, the same file opens from local cache instead of downloading again.
4. If the local file is missing or the 7-day cache expires, the UI falls back to Download.
5. Expired cached files are pruned automatically on app start.

## Commands

Install desktop dependencies:

```bash
npm install
```

Run frontend and desktop during development:

```bash
npm run dev
npm run desktop:dev
```

Create a Windows installer/portable build:

```bash
npm run desktop:pack
```

The output will be created in the `release/` folder.

## Stability note

This is an additive desktop wrapper. It does not replace backend, database, finance, archive, attendance, performance, operations, chat, or reports logic.
