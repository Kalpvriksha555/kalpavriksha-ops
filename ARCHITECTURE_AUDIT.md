# Kalpvriksha Designs Ops — Architecture Audit

## Current state

The current stable project is a working operations platform with the majority of frontend business logic concentrated in:

- `frontend/src/App.jsx` — ~5,300 lines
- `src/App.jsx` — mirror copy of the frontend app
- `backend/src/server.js` — ~680 lines

The app currently includes:

- Authentication and recovery
- User/admin management
- Smart employee lifecycle profiles
- Task/case management
- Assignment recommendations
- Attendance and break tracking
- Team availability
- Team workload overview
- Productivity dashboard
- Chat/direct messages
- Jitsi meetings
- Notifications
- Backend JSON/PostgreSQL state sync

## Key frontend modules currently inside App.jsx

### Foundation helpers

- Firebase config
- Backend API config
- localStorage cache helpers
- cross-tab broadcast helpers
- file sanitization helpers
- task assignment ledger helpers
- date/time helpers
- role/status normalization

### Employee/user lifecycle

Important functions:

- `normalizeRole`
- `normalizeStatus`
- `isApprovedUser`
- `getOperationalUsers`
- `createEmployeeLifecycleProfile`
- `normalizeTeamUser`
- `normalizeTeamUsers`
- `getManagedTeamUsers`
- `makeEmployeeLifecycleEvent`
- `detectEmployeeLifecycleEventType`

This area is now the correct foundation for future employee lifecycle improvements.

### Task/case lifecycle

Important functions:

- `normalizeProjectRecord`
- `mergeProjectRecordSafely`
- `mergeProjectsByFreshness`
- `generateTraceableTaskId`
- `getAssignmentRecommendations`
- `getDailyTaskLimit`

### Attendance/presence

Important functions:

- `getAttendanceUser`
- `getBreakMinutesFromLog`
- `formatDateKey`
- `isUserActuallyOnline`
- `userLastActivityAt`

Important rule preserved:

- Admins are visible for admin/team awareness where needed.
- Admins are hidden from attendance reporting.
- Admins should not display “Free since” like designers/managers.

### Communication/chat

Main component:

- `CommunicationHub`

Includes:

- global chat
- direct messages
- unread counters
- read tracking
- mentions
- attachments
- Jitsi call launcher

### Command Centre

Main component:

- `CommandCentreView`

Current responsibilities:

- team availability
- workload visibility
- active task summaries
- pending/completed overview
- role-aware dashboard sections

This is the safest next feature target after cleanup because it is already localized inside one component.

### Admin/team management

Main component:

- `TeamPerformanceView`

Current responsibilities:

- workload overview
- add users
- role/status/user controls
- reset/change/restrict/delete style actions
- performance visibility

## Backend architecture

Main backend file:

- `backend/src/server.js`

Current backend responsibilities:

- express API
- JSON file persistence
- optional PostgreSQL persistence
- upload handling
- OTP/email handling
- case APIs
- chat APIs
- state bootstrap/sync
- presence/user cleanup
- notification/audit helpers

Important backend user functions:

- `normalizeRole`
- `normalizeStatus`
- `cleanTeamUsers`
- `sanitizePresenceUser`
- `sanitizePresenceUsers`
- `mergeUsersPreservingLatestPresence`

These should remain the backend source of truth for user cleanup and presence normalization.

## Main risk

`App.jsx` is carrying too many responsibilities. Any change in shared helpers can affect:

- login
- attendance
- chat
- command centre
- workload
- employee lifecycle
- admin controls
- meeting behavior

This is why future changes must be scoped carefully and tested module-by-module.

## Recommended next implementation order

1. Command Centre 2.0 polish
2. Notifications center/activity timeline
3. Chat 2.0
4. UI polish
5. Refactor App.jsx into modules after the feature set is stable

## Immediate technical recommendation

Do not split `App.jsx` yet. First, improve one contained feature at a time. The best next target is `CommandCentreView`, because it can be enhanced without touching chat, attendance, admin controls, or meeting logic.
