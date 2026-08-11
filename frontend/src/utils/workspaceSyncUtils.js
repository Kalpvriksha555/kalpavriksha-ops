import { asRecord } from './runtimeShapeUtils.js';
import { WORKSPACE_SYNC_COLLECTIONS } from '../services/apiContractService.js';

const safeMarker = (value, fallback = -1) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

export const workspaceSyncMarkersFromPayload = (payload = {}) => {
  const source = asRecord(payload);
  const revisions = asRecord(source.collectionRevisions);
  return {
    stateVersion:safeMarker(source.stateVersion),
    dataRevision:safeMarker(source.dataRevision),
    presenceGeneration:safeMarker(source.presenceGeneration),
    collectionRevisions:Object.fromEntries(WORKSPACE_SYNC_COLLECTIONS.map(key => [key, safeMarker(revisions[key])]))
  };
};

export const advanceWorkspaceSyncMarkers = (current = {}, incoming = {}) => {
  const a = workspaceSyncMarkersFromPayload(current);
  const b = workspaceSyncMarkersFromPayload(incoming);
  const collectionRevisions = {};
  for (const key of WORKSPACE_SYNC_COLLECTIONS) collectionRevisions[key] = Math.max(a.collectionRevisions[key], b.collectionRevisions[key]);
  return {
    stateVersion:Math.max(a.stateVersion, b.stateVersion),
    dataRevision:Math.max(a.dataRevision, b.dataRevision),
    presenceGeneration:Math.max(a.presenceGeneration, b.presenceGeneration),
    collectionRevisions
  };
};

export const classifyWorkspaceResponseFreshness = (incoming = {}, current = {}, { clientMutationAdvanced = false } = {}) => {
  const next = workspaceSyncMarkersFromPayload(incoming);
  const prior = workspaceSyncMarkersFromPayload(current);
  const reasons = [];
  if (clientMutationAdvanced) reasons.push('client-mutation-advanced');
  if (prior.stateVersion >= 0 && next.stateVersion < prior.stateVersion) reasons.push('state-version-regressed');
  if (prior.dataRevision >= 0 && next.dataRevision < prior.dataRevision) reasons.push('data-revision-regressed');
  if (prior.presenceGeneration >= 0 && next.presenceGeneration < prior.presenceGeneration) reasons.push('presence-generation-regressed');
  for (const key of WORKSPACE_SYNC_COLLECTIONS) {
    if (prior.collectionRevisions[key] >= 0 && next.collectionRevisions[key] < prior.collectionRevisions[key]) reasons.push(`collection-${key}-regressed`);
  }
  return { stale:reasons.length > 0, reasons, incoming:next, current:prior };
};
