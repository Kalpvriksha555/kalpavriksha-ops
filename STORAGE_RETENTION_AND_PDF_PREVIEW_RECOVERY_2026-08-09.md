# Storage Retention + PDF Preview Recovery — 2026-08-09

This combined release keeps the previously verified 90-day uploaded-file retention policy with permanent finance and bank-ledger protection, and adds the requested PDF preview recovery so both changes can be pushed and deployed once.

## Storage retention

- Ordinary uploaded files expire after 90 days.
- Parent business records remain intact and expired attachments are represented explicitly.
- Finance records, payment history, bank/payment ledger data, settlement metadata and financial audit history are never deleted by this retention path.
- Files referenced by payment rows, task ledgers/finance objects, payment receipts and profile photos are protected.
- Expired physical objects move through the existing recoverable trash path and are reclaimed after the safety window.
- Automatic retention scheduling remains enabled.

## PDF preview recovery

- PDF previews no longer wait for a blocking authenticated `HEAD` request before the browser begins the actual PDF stream.
- The PDF iframe starts immediately from the authenticated private preview URL; the private server remains authoritative when the browser requests the file.
- Image/video/audio validation retains its existing `HEAD` behavior, so this optimization is scoped to PDFs.
- The unified viewer now has explicit CSS for a near-full-screen desktop height (`94dvh`, capped at 980 px) and full-screen mobile height (`100dvh`).
- The PDF stage and iframe are pinned to the remaining flex height so the viewer cannot collapse when arbitrary Tailwind height utilities are absent from the precompiled stylesheet.
- Existing Fit Width, Fit Page, zoom, rotation, Open and Download controls remain unchanged.

## Scope

No finance persistence, bank ledger, task lifecycle, attendance calculations, authentication, relational-state integrity or PostgreSQL schema behavior is changed by the PDF preview repair.

## CSS production-build closure

The first combined release candidate was correctly rejected by the production Vite/PostCSS gate because the appended PDF viewport rules had been serialized with literal `\n` text instead of real newline characters. Production was not modified.

This closure writes the viewport rules as normal CSS source and adds a focused regression that rejects literal escaped-newline serialization before deployment. The Windows push helper for this closure also runs the focused tests and a real Vite production build with the production API URL before it is allowed to commit or push.
