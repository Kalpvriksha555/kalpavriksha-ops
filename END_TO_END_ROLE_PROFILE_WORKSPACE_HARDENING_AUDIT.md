# End-to-End Role, Profile and Workspace Hardening Audit

Date: 2 August 2026

## Audit scope

The latest Kalpavriksha baseline was reviewed from sign-in through normal daily use for the three operational roles: Administrator, Manager and Designer. The review covered authentication, temporary-password replacement, password recovery, profile/contact registration, role-scoped workspace hydration, task and file access, chat/notifications, attendance, performance, finance sync, navigation, cached browser data, mobile/desktop interaction states and latest-changes-only deployment.

## Loose ends found and fixed

### 1. Profile changes could look saved before backend confirmation

Profile edits and profile-photo changes now use authoritative backend responses. Failed saves retain the draft and show an actionable message instead of presenting false success.

### 2. Profile OTP registration was not sufficiently account-bound

Email/mobile registration challenges are now tied to the authenticated user, username, channel and purpose. Verification atomically saves the contact, registration flag and audit row, then returns the authoritative user.

### 3. Peer profile privacy was too broad

Administrators retain full employee visibility. Managers and Designers receive their own full profile but only public presence/performance fields for colleagues. Email, phone, address, Aadhaar, PAN, emergency contact and bank details are not exposed to peers. Private downloaded-file caches are also actor-scoped so a later user on the same browser cannot open another user's cached file through the application.

### 4. Workspace load failure could resemble an empty operational workspace

Production workspace hydration now fails closed. When the backend cannot provide a valid workspace, the user sees a dedicated retry/sign-out screen and no cached production records are presented as current data.

### 5. Saved UI state could cross users or reopen forbidden areas

Saved global filters and Command Centre presence timing caches are actor-scoped. Filters are revalidated against the current role before being restored. A user whose role changes is redirected away from tabs no longer allowed.

### 6. Browser clients could seed shared user records

The legacy development fallback no longer writes default users into a shared collection from the browser. Real employee accounts remain Admin-API owned.

### 7. India calendar boundaries were inconsistent

Attendance, Operations “done today”, archive date/month filters, reports, daily ledgers and default payment date/time now use explicit `Asia/Kolkata` rules rather than the device or VPS locale. This prevents midnight UTC/device-time boundary errors.

### 8. Secondary authentication audit failures could create false workflow failures

Login, password change, Admin account creation/update/reset and failed-attempt tracking no longer return a false failure after the core credential/session change has already succeeded merely because secondary auth-event recording failed. The audit failure is still logged as an operational warning.

### 9. Admin account creation could be submitted twice

The new-employee form now has an explicit busy state, disables its fields and close control while creating, and shows “Creating…” until the backend confirms. Recovery and account dialogs also have accessible close labels and busy-safe controls.

### 10. Runtime verification assumed peer usernames remained visible

The Admin/Manager/Designer authentication verifier now locates redacted team members by immutable ID or display name rather than requiring a peer username that is intentionally private.

## Role journey coverage

### Administrator

- Legacy/established and current login
- Session and CSRF enforcement
- Employee creation with mandatory temporary-password replacement
- Manager/Designer role and access management
- Password reset and session revocation
- Full private employee profile access
- Finance/payment outbox and global sync status
- System, reports, quality and performance administration

### Manager

- Temporary-password replacement and persistent login
- Own profile update and contact registration
- Password recovery with registered contact
- Team workspace with peer-private fields redacted
- Task assignment/lifecycle, files, chat, notifications, attendance and performance access according to capability rules
- No Admin finance/system/private-profile access

### Designer

- Temporary-password replacement and persistent login
- Own profile update, email registration and password recovery
- Assigned-task lifecycle, uploads, chat, notifications, attendance and personal performance access
- No Admin-only tabs, finance collections or colleague private profile fields
- Account restriction immediately revokes active access

## UX/UI improvements

- Backend-confirmed profile success and retained failed drafts
- Busy indicators for profile, photo, OTP, recovery and employee creation
- Accessible icon-button labels in authentication/account dialogs
- Fail-closed workspace recovery screen with retry and sign-out actions
- Actor-scoped saved filters, Command Centre timing state and downloaded-file cache
- Explicit India date/month rendering in archive and Operations views
- Existing non-blocking payment navigation and green/amber/red finance sync indicator retained

## Verification boundary

All source, isolated tests, syntax, security, database-schema and frontend/backend contract checks passed in the packaging environment. A real runtime Admin/Manager/Designer journey and production frontend build require installed Node dependencies. The packaging environment's internal npm mirror returned HTTP 404 for a required package, so those runtime checks could not be executed locally. The dedicated VPS incremental deployment script runs the Phase 3 and Phase 4 runtime journeys plus the production frontend build before stopping the live backend. A failure at that stage leaves the current live runtime untouched.
