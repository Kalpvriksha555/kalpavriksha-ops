# Kalpvriksha Designs Ops – Production Stabilization RC1

## Scope
This release is a stabilization checkpoint only. No business workflow, Archive filtering, Operations filtering, completion logic, assignment logic, upload/download flow, chat, attendance, or revision lifecycle was intentionally changed in this RC.

## Verified Commands
- Root frontend production build: `npm run build` ✅
- Backend syntax check: `node --check backend/src/server.js` ✅

## Stability Rules Confirmed
- Archive and Operations logic must not be modified by future Finance-only updates.
- Finance UI must remain Admin-only.
- Managers and Designers must not see payment status, payment controls, ledger, reports, finance reminders, or finance notifications.
- Ledger/payment features should read finance data without changing task lifecycle status.

## Regression Checklist for Deployment
Before deploying this RC, verify in browser:

### Admin
- Login works.
- Operations shows active/pending tasks correctly.
- Archive shows completed tasks for today and previous dates.
- My Tasks shows assigned work correctly.
- Command Centre counts match Operations/Archive.
- Finance ledger opens without runtime errors.
- Payment badges/controls are visible only to Admin.
- Upload and download work on desktop and mobile.
- Chat opens and sends messages.
- Attendance page loads.

### Manager
- No payment column or finance controls are visible.
- Operations/My Tasks workflows remain normal.
- Archive visibility remains unchanged by finance features.

### Designer
- No payment column or finance controls are visible.
- My Tasks and completed-task workflow remain normal.

## Known Risk Areas
- Finance features and case lifecycle share project/case objects. Future updates must avoid changing shared status filters.
- Any payment filtering must be applied only inside Finance, not Archive or Operations.
- Any ledger status should be derived from ledger/payment data, not from task completion status.

## Release Note
This RC is intended to be used as a safe checkpoint before continuing with Finance v2.8 or Command Centre payment reminders.
