# Performance stability update

This build removes the two biggest causes of multi-tab CPU/memory growth:

1. Tailwind CDN was removed from `index.html` and replaced with compiled Tailwind CSS through Vite. The CDN version watches/scans the page at runtime and is not suitable for production.
2. Cross-tab assignment sync no longer writes back to localStorage while processing incoming storage/broadcast events. That write-back loop was waking every tab repeatedly.

Recommended production run:

```powershell
npm install
npm run build
npm run serve
```

For development you can still use:

```powershell
npm run dev
```

Expected improvement:
- Lower CPU in idle multi-tab usage.
- Lower memory growth.
- Assignment sync remains active through compact metadata only.
- Large files are not rebroadcast across tabs.

If testing memory, use the production preview (`npm run serve`) rather than the Vite dev server, because dev mode uses extra memory for hot reload and source maps.
