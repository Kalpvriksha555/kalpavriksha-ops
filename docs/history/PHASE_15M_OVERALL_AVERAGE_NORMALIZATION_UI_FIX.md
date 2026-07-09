# Phase 15M — Overall Average, Global Normalization & Paid UI Fix

## Completed

- Performance average now uses overall completed task history rather than only the selected day/range.
- Case-type productivity timing also uses overall history so values gradually improve/degrade as more tasks complete.
- Location/city input is canonicalized for future tasks.
- Bank input is canonicalized for future tasks.
- Ledger area filters use normalized city names.
- Ledger bank filters use normalized bank names.
- Prayagraj and Allahabad are treated as the same city.
- LKO/LKN/Lucknow, AGRA/Agra, KANP/Kanpur style duplicates are normalized in filters and reports.
- Paid payment control has stronger green styling in Operations/Archive to visually separate it from Pending yellow.

## Validation

- Frontend production build passed.
- Backend syntax check passed.
