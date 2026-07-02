# RC3 Compact Layout + Task ID Codes Fix

## Fixed
- Operations list columns are now more compact to reduce wasted screen space.
- Case description is removed from the Operations list to keep rows clean; users can open the case to read full instructions.
- Estimate summary remains compact.
- Assigned, elapsed, and status remain visible in the list layout.
- Edit Case now recalculates the task ID when bank/client, customer name, or location changes.
- Old task ID is stored in `previousTaskIds` and the timeline/change log records the ID change.

## Station Codes Added
- Varanasi: VNS
- Lucknow: LKO
- Agra: AGR
- Mathura: MTR
- Ayodhya: AYD
- Gorakhpur: GKP
- Prayagraj: PRJ
- Kanpur: KNP
- Noida: NDA
- Raebareli: RBL
- Additional common UP fallback codes added.

## Verification
- Root build verified with `npm run build`.
- Frontend build verified with `cd frontend && npm run build`.
