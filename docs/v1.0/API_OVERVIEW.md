# API Overview

## Core API Areas
- Authentication/state loading
- Case state save/load
- Timeline/audit events
- File upload/download
- Notifications
- Chat
- Attendance
- Reports/exports

## Health Checks
- `/api/health`
- `/api/state`

## Operational Rule
All API changes should preserve role-based access and avoid changing Archive/Operations filtering unless explicitly required.
