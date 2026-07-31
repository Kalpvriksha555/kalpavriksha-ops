const clone = (value) => structuredClone(value ?? []);

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
      users: clone(liveState?.users),
      attendanceLogs: clone(liveState?.attendanceLogs)
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
    users: clone(liveState?.users),
    attendanceLogs: clone(liveState?.attendanceLogs)
  };
}
