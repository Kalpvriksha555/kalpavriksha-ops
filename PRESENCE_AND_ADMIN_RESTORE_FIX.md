# Presence and Admin Controls Restore Fix

This package restores the working admin controls and applies a focused presence fix without changing the UI structure.

Fixed:
- Team Activity now shows manager/designer availability using the same real online heartbeat logic used by Attendance.
- Offline users no longer appear Available/Drafting from stale `isOnline` values.
- Team Attendance excludes Admin users and the old placeholder Operations Manager.
- Team Availability keeps Admin users visible, but filters out placeholder Operations Manager/test seed users.
- Team & Security Control keeps Add Employee, Reset Password, Restrict/Allow Login, Delete Login, Role change, and View Analytics.
- Backend seed no longer re-adds the placeholder Operations Manager.

Keep your existing backend `.env` unchanged.
