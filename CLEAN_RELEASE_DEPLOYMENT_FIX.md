# Clean Release and Deployment Fix

- Added the missing `backend/.env.example`.
- Removed obsolete July 30 deployment launchers.
- Replaced stale release evidence.
- Added guarded legacy normalized-shadow integrity classification and repair.
- Repair requires a recent verified full database/private-files backup, stops writes, changes no operational rows, writes a new canonical revision from physical PostgreSQL rows, and then requires strict integrity to pass.
- Drift outside `files` and `performanceRecords`, unexpected count direction, or any unrecognized condition remains blocked.
