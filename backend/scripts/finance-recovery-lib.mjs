import fs from 'node:fs';
import path from 'node:path';

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) args[key] = inlineValue;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) args[key] = argv[++index];
    else args[key] = true;
  }
  return args;
}

export function atomicPrivateJson(filePath, payload) {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, absolute);
  fs.chmodSync(absolute, 0o600);
  return absolute;
}

export async function loadDatabaseState(pool) {
  const relation = await pool.query("SELECT to_regclass('public.ops_cases') AS ops_cases, to_regclass('public.app_state_metadata') AS metadata, to_regclass('public.app_state') AS legacy");
  const flags = relation.rows[0] || {};
  if (flags.ops_cases) {
    const [cases, metadata] = await Promise.all([
      pool.query('SELECT payload FROM ops_cases ORDER BY sort_order,id'),
      flags.metadata ? pool.query("SELECT state_version,snapshot_hash FROM app_state_metadata WHERE key='main'") : Promise.resolve({ rows: [] })
    ]);
    return {
      source: 'relational',
      stateVersion: Number(metadata.rows[0]?.state_version || 0),
      snapshotHash: String(metadata.rows[0]?.snapshot_hash || ''),
      cases: cases.rows.map((row) => row.payload).filter(Boolean)
    };
  }
  if (flags.legacy) {
    const legacy = await pool.query("SELECT value,state_version FROM app_state WHERE key='main'");
    const state = legacy.rows[0]?.value || {};
    return {
      source: 'legacy-app-state',
      stateVersion: Number(legacy.rows[0]?.state_version || 0),
      snapshotHash: '',
      cases: Array.isArray(state.cases) ? state.cases : (Array.isArray(state.projects) ? state.projects : [])
    };
  }
  throw new Error('The database does not contain ops_cases or the legacy app_state row.');
}
