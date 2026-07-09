Kalpvriksha Ops - Employee Sync ONLY Patch

Changed file:
- frontend/src/App.jsx

Purpose:
- When Admin adds, restricts, resets password, changes role, or deletes an employee, the user list is immediately synced to backend state instead of waiting for delayed autosave.
- No admin UI, chatbox, attendance, team workload, meeting, or backend logic is changed.

Apply option 1:
- Copy frontend/src/App.jsx from this patch folder into your project frontend/src/App.jsx.

Apply option 2:
- From project root, run:
  git apply employee-sync-only.patch

Then test:
1. npm run build inside frontend
2. Add a test designer
3. Verify assignment dropdown, team workload, chat user list, team availability, and login list
4. Delete/restrict test user and verify they disappear/hide from lists
