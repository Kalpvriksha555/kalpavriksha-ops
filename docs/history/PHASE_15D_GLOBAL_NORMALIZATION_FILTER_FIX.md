# Phase 15D – Global Normalization & Filter Fix

## Fixed

- Archive filters now work even when no external archive view state is passed.
- Ledger area/city filter now treats uppercase/lowercase/aliases as one value.
- Finance ledger bank filter now uses normalized bank names.
- Reports bank names now read from the task bank/client field.
- Reports branch/location names now normalize aliases such as LKO/LKN/Lucknow and AGRA/Agra.
- All report grouping uses canonical keys so capital/small spelling differences do not create duplicate categories.

## Validation

- Frontend build passed.
- Backend syntax check passed.
