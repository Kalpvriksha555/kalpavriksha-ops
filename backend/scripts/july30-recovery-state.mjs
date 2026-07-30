import {
  loadRelationalState,
  reloadRelationalState
} from '../src/repositories/postgresStateRepository.js';

export async function loadStateForJuly30Recovery(pool, {
  mode,
  normalizeState = value => value,
  loadRelationalStateFn = loadRelationalState,
  reloadRelationalStateFn = reloadRelationalState
} = {}) {
  const relations = await pool.query(
    "SELECT to_regclass('public.app_state_metadata') AS metadata, to_regclass('public.app_state') AS legacy"
  );
  const flags = relations.rows[0] || {};

  if (flags.metadata) {
    const metadata = await pool.query("SELECT state_version FROM app_state_metadata WHERE key='main'");
    if (metadata.rows.length) {
      return reloadRelationalStateFn(pool, { normalizeState });
    }
  }

  if (flags.legacy) {
    const legacy = await pool.query("SELECT value,state_version FROM app_state WHERE key='main'");
    if (legacy.rows.length) {
      if (mode === 'plan') {
        return {
          state: normalizeState(legacy.rows[0].value || {}),
          stateVersion: Number(legacy.rows[0].state_version || 0),
          source: 'legacy-app-state-read-only'
        };
      }
      return loadRelationalStateFn(pool, { normalizeState });
    }
  }

  throw new Error('No authoritative live state was found in relational metadata or the legacy app_state row.');
}
