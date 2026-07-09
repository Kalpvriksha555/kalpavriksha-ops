# RC3 Case Edit + Operations Visibility Fix

Included fixes:
- Edit Case button is now visible inside task details for Admins and Managers.
- Admins/Managers can update scope/case type, customer, bank, location, assignment, priority, due date, estimate, description, and change reason.
- Case edit history is stored in `caseEditHistory` and timeline receives a change note.
- Operations list descriptions and estimates are collapsed to a compact one-line preview with full text available inside the task detail.
- Status column is sticky/visible in Operations list so it does not disappear to the right.
- Daily Operations Board description/estimate previews are shortened.
- Manager delete permission retained.

Build verified with `npm run build`.
