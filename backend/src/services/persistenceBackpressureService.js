export function mergeLatestPresenceIntoSnapshot({
  snapshot = {},
  liveState = {},
  snapshotGeneration = 0,
  liveGeneration = 0
} = {}) {
  const includedGeneration = Number(snapshotGeneration || 0);
  const currentGeneration = Number(liveGeneration || 0);
  if (currentGeneration <= includedGeneration) {
    return { state: snapshot, includedPresenceGeneration: includedGeneration, merged: false };
  }
  return {
    state: {
      ...snapshot,
      // Presence writers replace these top-level arrays instead of mutating them
      // in place, so a queued persistence snapshot can safely retain the current
      // references without cloning every historical attendance row.
      users: liveState?.users || [],
      attendanceLogs: liveState?.attendanceLogs || []
    },
    includedPresenceGeneration: currentGeneration,
    merged: true
  };
}

export function preserveDirtyPresenceAfterReload({
  committedState = {},
  liveState = {},
  mutationGeneration = 0,
  persistedGeneration = 0
} = {}) {
  if (Number(mutationGeneration || 0) <= Number(persistedGeneration || 0)) return committedState;
  return {
    ...committedState,
    users: liveState?.users || [],
    attendanceLogs: liveState?.attendanceLogs || []
  };
}
