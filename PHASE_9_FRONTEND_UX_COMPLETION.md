# Phase 9 — Frontend Architecture, Performance and UX Completion

Phase 9 completes the nine-phase hardening roadmap while preserving all finance, authentication, authorisation, database, storage, backup and release-certification safeguards from Phases 1–8.

## Architecture and bundle changes

- Removed the Firebase SDK from both root and frontend production dependencies.
- Replaced the unreachable legacy Firebase runtime with a tiny disabled compatibility adapter.
- Added route-level lazy loading for Command Centre, productivity, reports, archive, operations, profile, calculator, meetings and team chat.
- Extracted the large runtime CSS template from `App.jsx` into a dedicated stylesheet.
- Removed unused starter assets, obsolete app-router stubs and unused CSS.
- Added modular archive utilities, UI feedback services and adaptive workspace-sync hook.

## Synchronisation and performance

- Replaced the ten-second full-workspace poll with adaptive synchronisation.
- Visible tabs refresh every 60 seconds.
- Hidden tabs refresh every five minutes.
- Focus, online and visibility-return events trigger an immediate guarded refresh.
- Multiple event bursts are coalesced to avoid duplicate full-state requests.
- Dedicated mutation endpoints remain the immediate source of truth for tasks, finance, chat, files, notifications and presence.

## Archive UX

- Completed tasks are grouped by canonical location.
- Location aliases such as LKO/Lucknow and VNS/Varanasi resolve to one group.
- Groups are collapsible and remember their open state.
- Expand-all and collapse-all controls are included.
- Search covers task ID, customer, bank, location, designer, description, estimate, file and payment status.
- Admin summaries show task count, unpaid/partial count and received amount.
- Desktop tables switch to touch-friendly cards on mobile.
- Existing month, date, bank, location and payment controls remain available.

## Feedback and accessibility

- Removed browser `alert()`, `confirm()` and `prompt()` calls from frontend source.
- Added accessible in-app toasts, confirmation dialogs and secure input dialogs.
- Added skip-to-content navigation, focus-visible rings and reduced-motion support.
- Dialogs use the existing portal focus trap, Escape handling, focus restoration and body-scroll locking.
- Direct project-array state replacement paths were converted to functional updates.

## Deployment note

This package must still pass clean installation and release certification on the deployment machine. Do not deploy before taking live PostgreSQL and private-file backups and performing the selective finance-recovery workflow described in Phase 8.
