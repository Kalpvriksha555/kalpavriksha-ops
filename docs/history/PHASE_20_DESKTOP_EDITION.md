# Phase 20 — Kalpavriksha Ops Desktop Edition

## What this phase adds

- Electron desktop wrapper for the existing Kalpavriksha Ops React app.
- Existing web app remains unchanged and usable in browser.
- Desktop-only file cache bridge:
  - Download once, then show/open cached file.
  - 7-day local cache expiry.
  - Missing local file fallback.
  - Native file opening through the OS default app.
- Desktop IPC bridge exposed as `window.kalpavrikshaDesktop`.
- Existing backend/database architecture remains unchanged.

## Development run

```bash
npm install
npm run dev
```

In a second terminal:

```bash
npm run desktop:dev
```

## Production build

```bash
npm install
npm run desktop:pack
```

This creates Windows installer/portable output inside:

```text
release/
```

## Notes

Electron downloads its runtime during `npm install`. If the machine has blocked GitHub/CDN access, install may fail until internet access is available.

## Safety

This phase is intentionally additive:

- No database migration required.
- No backend API breaking change.
- Browser deployment remains the fallback.
- Desktop cache is local to each user's computer and expires automatically after 7 days.
