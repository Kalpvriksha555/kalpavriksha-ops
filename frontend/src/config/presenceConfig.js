// Keep browser presence thresholds aligned with the backend default. A 60-second
// heartbeat gets one full missed-beat allowance before a user is considered stale.
export const ONLINE_STALE_MS = 2 * 60 * 1000;
export const PRESENCE_HEARTBEAT_MS = 60 * 1000;
export const ATTENDANCE_MAX_LIVE_GAP_MINUTES = 10;
