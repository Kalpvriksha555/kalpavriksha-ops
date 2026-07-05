# Finance v2.4 – Payment Filters & Reports

Scope: Finance page only.

Implemented:
- Added admin finance ledger payment-status filter: All, Not Updated, Pending, Partially Paid, Paid, Overpaid.
- Added status summary cards for quick filtering.
- Added payment status column to transaction ledger table.
- Added export-ready Finance Report tab using the same filtered ledger dataset.
- Updated CSV export to include payment status and non-negative pending amount.

No changes made to Archive filtering, Operations filtering, case completion logic, task status logic, or revision logic.

Verification:
- Root build passed.
- Backend syntax check passed.
