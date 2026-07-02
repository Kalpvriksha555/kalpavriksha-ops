# Internal Review Approval Workflow

Added a final approval gate after completed work upload.

## Flow
1. Designer/assigned user uploads completed work file.
2. Task moves to `Internal Review` instead of direct `Completed`.
3. Admin/Manager reviews the file.
4. If revision is needed, use `Revert` to send it back to Drafting.
5. If file is correct, Admin/Manager clicks `Approve Final`.
6. Task becomes `Completed` with final conclusion `Approved`.
7. WhatsApp sharing is enabled only after approval.

No unrelated modules were changed.
