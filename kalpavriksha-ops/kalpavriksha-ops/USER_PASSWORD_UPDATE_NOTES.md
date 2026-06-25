# User & Password Update Notes

Applied in this build:

- Renamed Ali/Ali Waqar to Waqar across seeded users and normalization logic.
- Changed Waqar login username from `ali` to `waqar`.
- Existing saved users named Ali/Ali Waqar are normalized to Waqar when loaded or updated.
- Added Change Password section in every user's Profile page.
- Added Admin Reset Password button in Team & Security Control.
- Admins can still view user passwords in Team & Security Control.
- Forgot Password / Recovery updates the user password and lets the user log in with the new password.
- Build and smoke checks completed.

Default password remains unchanged unless reset.
