# Attendance Engine v2 Active Task Refinement

This focused patch refines the Attendance Engine v2 calculation.

## Fixed

- `Total Logged-in` remains the full online session duration.
- `Active Duration` is now calculated from actual assigned task busy intervals for the selected date.
- Active task intervals are clamped to the attendance date and merged to avoid double-counting overlapping work.
- Admin users are excluded from attendance rows and active/logged-in summary calculations.
- Attendance export now uses task-active minutes instead of full logged-in minutes.

## Notes

- No task workflow logic was changed.
- No profile, chat, notification, archive, or file module logic was changed.
