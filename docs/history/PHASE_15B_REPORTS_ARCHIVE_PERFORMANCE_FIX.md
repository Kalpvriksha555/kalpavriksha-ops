# Phase 15B — Reports, Archive Return, Performance UI Fix

## Fixed
- Command Centre Attention card now uses the same source of truth as the filtered Operational Queue.
- Attention count and filtered record count now match.
- Bank Report now reads the bank name from the task `client` field used by the Add Case form.
- Branch Report now reads from branch fields first and falls back to task location.
- Branch/location names are normalized so duplicates like `AGRA`/`Agra` and `LKO`/`LKN`/`Lucknow` are grouped together.
- Payment Aging Report remains connected to payment/finance status fields.
- Archive task detail back button now returns to Archive instead of Operations.
- Performance Analytics employee workload section replaced the wide sparse rows with compact cards.

## Validation
- Frontend production build passed.
- Backend syntax check passed.
