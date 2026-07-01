# Command Centre 2.0 — Safe Implementation Plan

## Goal

Improve the Command Centre without changing the rest of the app.

## Files to touch

Preferred:

- `frontend/src/App.jsx`
- `src/App.jsx`

Avoid touching:

- `backend/src/server.js`
- package files
- attendance logic
- chat logic
- admin/user controls
- meeting logic

## Features for first Command Centre patch

### 1. Live KPI cards

Add small cards for:

- online team members
- active tasks
- pending today
- completed today
- overdue/urgent tasks
- people on break

### 2. Workload visualization

For each designer/manager:

- active task count
- daily task limit
- progress bar
- status badge: Free / Busy / Break / Offline

### 3. Pending vs completed trend

Simple visual summary using existing task data:

- today pending
- today completed
- carry-forward pending
- revisions urgent

### 4. Designer performance cards

For each designer/manager:

- completed today
- active workload
- revision count
- average status indication

## Safety rules

- Use existing `users` and `projects` props only.
- Do not change global helper behavior.
- Do not change employee filtering logic.
- Do not change attendance filtering.
- Do not change chat user list.
- Do not change admin permissions.

## Test checklist after patch

- Login works
- Team Workload Overview still shows users
- Admin controls still visible
- Attendance still hides admins
- Chat opens
- Faraz/new employee appears everywhere
- Command Centre loads
- Command Centre stats look correct
- Frontend build passes
