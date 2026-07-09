# Phase 25C - Startup Fallback Fix

Fixes the startup screen getting stuck on "Connecting to Secure Cloud".

Changes:
- Backend/PostgreSQL mode no longer waits for Firebase anonymous auth before showing login.
- If backend `/api/state` is unavailable, the app now hydrates from local cache and marks DB ready instead of staying on the loading screen.
- Local fallback banner is shown when backend state cannot be reached.
- Existing task, preview, finance, attendance, and chat business logic untouched.
