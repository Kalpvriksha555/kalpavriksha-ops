# Phase 13C – Calculator + Chat Hotfix

## Fixed

- Rebuilt calculator keypad rendering with hard-forced 4-column grid behavior on mobile.
- Added inline grid fallback so old global button/flex styles cannot force calculator buttons into a vertical list.
- Improved calculator quick-action grid on mobile.
- Improved chat message three-dot menu tap handling on mobile and desktop.
- Message option trigger now stops pointer/touch/mouse propagation reliably.
- Added voice note cancel flow.
- Recording voice note now has:
  - Cancel
  - Stop & Send
- Cancelled voice notes are discarded and not uploaded/sent.

## Validation

- Frontend build passed.
- Backend syntax check passed.
