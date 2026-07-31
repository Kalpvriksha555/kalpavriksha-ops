# Authentication and Manager Workspace Compatibility Fix

This release corrects the production behaviour introduced by the July 30 secure-authentication cutover.

## Root causes fixed

1. Every password copied from the legacy operational state was incorrectly marked as an administrator-issued temporary password. The backend then returned `428 PASSWORD_CHANGE_REQUIRED` for `/api/state`. The frontend swallowed the response code and displayed an authenticated but empty Manager workspace.
2. A refreshed browser session with a legitimate temporary password went directly to the workspace instead of returning to the password-change screen, again producing empty data.
3. Login failures used one generic “invalid or restricted” message, making password mistakes, deliberate restrictions and temporary locks indistinguishable.
4. Allowing a restricted user to log in again did not clear a stale failed-attempt lock.

## Corrected behaviour

- Approved existing users keep their established password after it is securely hashed.
- On the first startup of this release, obsolete July 30 `must_change_password` flags and stale locks are cleared only for credentials that are provably linked to the read-only legacy snapshot and have never subsequently been reset.
- Admin-created or Admin-reset temporary passwords still require replacement.
- Manager sessions receive the full authorised case/archive state; finance remains Admin-only.
- A real temporary-password session always returns to the password-change form instead of rendering an empty workspace.
- Invalid password, restricted account and temporary login lock now return distinct messages.
- “Allow Login” also clears the account’s failed-attempt lock.

## Data safety

The repair updates only `auth_credentials`. It does not rewrite cases, attendance, finance, files, archive records or operational state.

## Deployment note

Deploy this package through the normal GitHub-main/VPS release flow. Do **not** rerun `Run-July30-Final-Merge.ps1`, `Run-July30-Safe-Deploy.ps1`, or any database merge/recovery command: the July 30 data merge is already complete, and this release is an authentication/access hotfix only.
