# Phase 15A – Command Attention + Reports Data Fix

## Fixes

- Aligned Command Centre Attention count with the actual filtered Operational Queue.
- Attention card now uses the same de-duplicated source of truth as the opened list.
- Bank report now reads bank data directly from task/case fields with broader supported field names.
- Branch report now falls back to task location when branch is not separately entered.
- Payment Aging report now uses finance/payment tracking fields instead of only raw text status.
- Pending and received finance summaries now use estimate and received ledger/payment values.

## Validation

- Frontend build passed.
- Backend syntax check passed.
