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

export function isDeferredPersistenceOperation({ metadata = {}, reason = '' } = {}) {
  const normalizedReason = String(reason || metadata?.reason || '').trim().toLowerCase();
  return metadata?.background === true || normalizedReason.startsWith('presence_');
}

export function persistenceCommitEvidenceMatches(error = {}, recovered = {}) {
  if (error?.commitOutcomeUnknown !== true) return false;
  const evidence = error?.commitEvidence || {};
  const expectedVersion = Number(evidence.stateVersion);
  const recoveredVersion = Number(recovered?.stateVersion);
  const expectedHash = String(evidence.snapshotHash || '').trim();
  const recoveredHash = String(recovered?.snapshotHash || '').trim();
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0 || recoveredVersion !== expectedVersion) return false;
  if (!expectedHash || !recoveredHash || recoveredHash !== expectedHash) return false;
  return true;
}

export function runtimeRecoveryCanRun({ queueDepth = 0, inFlight = 0, activeForegroundWrites = 0 } = {}) {
  return Number(queueDepth || 0) <= 0
    && Number(inFlight || 0) <= 0
    && Number(activeForegroundWrites || 0) <= 0;
}

export function classifyPersistenceFailure({
  metadata = {},
  reason = '',
  recoverySucceeded = false,
  verifiedFallbackRestored = false,
  usePostgres = true
} = {}) {
  const deferred = isDeferredPersistenceOperation({ metadata, reason });
  // A verified shadow is a safe temporary fallback only for deferred telemetry.
  // For foreground business writes, a failed database reload means commit outcome
  // is still unresolved even if we can serve the last verified shadow read-only.
  const safelyRecovered = Boolean(recoverySucceeded || (deferred && verifiedFallbackRestored));
  return {
    deferred,
    safelyRecovered,
    critical: !deferred && (!usePostgres || !recoverySucceeded),
    jobType: deferred ? 'PRESENCE_PERSISTENCE' : 'STATE_PERSISTENCE'
  };
}

export function persistenceReadiness({ criticalFailure = null } = {}) {
  return criticalFailure === null || criticalFailure === undefined;
}
