import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import {
  FINANCE_FIELDS,
  mergeActiveLegacyIntoRecoveredState,
  sha256
} from './july30-recovery-lib.mjs';
import {
  persistRelationalState,
  reloadRelationalState,
  runRelationalMigrations,
  stateSnapshotHash
} from '../src/repositories/postgresStateRepository.js';

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const mode = String(args.mode || 'plan').toLowerCase();
const reportPath = path.resolve(String(args.report || path.join(process.cwd(), `july30-final-${mode}.json`)));
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!['plan', 'apply'].includes(mode)) throw new Error('Use --mode=plan or --mode=apply.');
if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) throw new Error('DATABASE_URL must point to PostgreSQL.');

const { Pool } = pg;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000)
});

const recordId = record => String(record?.id || record?.caseId || record?.projectId || '').trim();
const records = (state, key) => Array.isArray(state?.[key]) ? state[key] : [];
const caseRecords = state => Array.isArray(state?.cases)
  ? state.cases
  : (Array.isArray(state?.projects) ? state.projects : []);
const recordCoverageKey = (key, record, index) => {
  if (key === 'attendanceLogs') {
    const attendanceId = String(record?.id || '').trim();
    return attendanceId
      ? `${key}:id:${attendanceId}`
      : `${key}:${String(record?.userId || record?.userName || record?.name || '')}:${String(record?.date || record?.day || record?.createdAt || index)}`;
  }
  const explicit = String(record?.id || record?.userId || record?.fileId || record?.messageId || '').trim();
  if (explicit) return `${key}:id:${explicit}`;
  return `${key}:hash:${sha256(record)}`;
};
const coverage = (state, key) => new Set(records(state, key).map((item, index) => recordCoverageKey(key, item, index)));
const missingCoverage = (source, target, key) => [...coverage(source, key)].filter(value => !coverage(target, key).has(value));
const financeHash = (state, allowedIds = null, fieldReference = state) => {
  const referenceById = new Map(caseRecords(fieldReference).map(item => [recordId(item), item]));
  return sha256(
    caseRecords(state)
      .filter(item => !allowedIds || allowedIds.has(recordId(item)))
      .map(item => {
        const reference = referenceById.get(recordId(item)) || {};
        return [
          recordId(item),
          Object.fromEntries(FINANCE_FIELDS
            .filter(field => Object.prototype.hasOwnProperty.call(reference, field))
            .map(field => [field, item[field]]))
        ];
      })
      .sort(([left], [right]) => left.localeCompare(right))
  );
};
const writeReport = report => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
};

let originalRelational = null;
let committedVersion = 0;
try {
  await runRelationalMigrations(pool);
  const relational = await reloadRelationalState(pool, { normalizeState: value => value });
  const legacyResult = await pool.query("SELECT value,state_version,updated_at FROM app_state WHERE key='main'");
  if (!legacyResult.rows.length) throw new Error('The active legacy app_state row is missing.');
  originalRelational = relational.state;
  const activeLegacy = legacyResult.rows[0].value || {};
  const recoveredCases = caseRecords(originalRelational);
  const activeCases = caseRecords(activeLegacy);
  if (recoveredCases.length < 404) throw new Error(`Recovered relational state has only ${recoveredCases.length} cases; expected at least 404.`);
  if (activeCases.length < 378) throw new Error(`Active legacy state has only ${activeCases.length} cases; expected at least 378.`);
  if (records(originalRelational, 'attendanceLogs').length < 156 || records(activeLegacy, 'attendanceLogs').length < 156) {
    throw new Error('Attendance evidence is incomplete in one of the authoritative states.');
  }

  const merged = mergeActiveLegacyIntoRecoveredState(originalRelational, activeLegacy);
  const activeIds = new Set(activeCases.map(recordId).filter(Boolean));
  const deletedIds = new Set((merged.state.deletedProjectIds || []).map(String));
  const finalIds = new Set(records(merged.state, 'cases').map(recordId));
  const missingActiveCases = [...activeIds].filter(id => !deletedIds.has(id) && !finalIds.has(id));
  const recoveredIds = new Set(recoveredCases.map(recordId).filter(Boolean));
  const missingRecoveredCases = [...recoveredIds].filter(id => !deletedIds.has(id) && !finalIds.has(id));
  const attendanceMissingFromActive = missingCoverage(activeLegacy, merged.state, 'attendanceLogs');
  const attendanceMissingFromRecovery = missingCoverage(originalRelational, merged.state, 'attendanceLogs');
  const activeFinanceHash = financeHash(activeLegacy, activeIds);
  const mergedActiveFinanceHash = financeHash(merged.state, activeIds, activeLegacy);
  if (missingActiveCases.length || missingRecoveredCases.length) throw new Error('Final merge would omit an authoritative case.');
  if (attendanceMissingFromActive.length || attendanceMissingFromRecovery.length) throw new Error('Final merge would omit an attendance record.');
  if (activeFinanceHash !== mergedActiveFinanceHash) throw new Error('Final merge would alter active finance fields.');

  const plan = {
    ok: true,
    mode,
    createdAt: new Date().toISOString(),
    relational: {
      stateVersion: Number(relational.stateVersion || 0),
      stateHash: stateSnapshotHash(originalRelational),
      cases: recoveredCases.length,
      attendance: records(originalRelational, 'attendanceLogs').length
    },
    activeLegacy: {
      stateVersion: Number(legacyResult.rows[0].state_version || 0),
      updatedAt: legacyResult.rows[0].updated_at || null,
      stateHash: stateSnapshotHash(activeLegacy),
      cases: activeCases.length,
      attendance: records(activeLegacy, 'attendanceLogs').length,
      financeHash: activeFinanceHash
    },
    final: {
      stateHash: stateSnapshotHash(merged.state),
      cases: records(merged.state, 'cases').length,
      attendance: records(merged.state, 'attendanceLogs').length,
      files: records(merged.state, 'files').length,
      activeFinanceHash: mergedActiveFinanceHash
    },
    changes: merged.summary,
    verification: {
      activeCasesPreserved: true,
      recoveredCasesPreserved: true,
      attendanceFromBothPreserved: true,
      activeFinancePreserved: true
    }
  };
  plan.planHash = sha256(plan);

  if (mode === 'plan') {
    writeReport(plan);
    console.log(JSON.stringify(plan, null, 2));
  } else {
    const result = await persistRelationalState(pool, {
      state: merged.state,
      expectedVersion: Number(relational.stateVersion || 0),
      targetVersion: Number(relational.stateVersion || 0) + 1,
      metadata: { actor: 'july30-final-merge', reason: 'merge_active_legacy_with_recovered_relational_state' },
      applyAuthOperationsWithClient: async () => {},
      financeSnapshotHash: sha256,
      revisionRetention: Number(process.env.STATE_REVISION_RETENTION || 500)
    });
    committedVersion = Number(result.stateVersion || 0);
    const verified = await reloadRelationalState(pool, { normalizeState: value => value });
    const verifiedIds = new Set(records(verified.state, 'cases').map(recordId));
    const missingAfter = [...finalIds].filter(id => !verifiedIds.has(id));
    if (missingAfter.length) throw new Error(`Post-write verification is missing ${missingAfter.length} final cases.`);
    if (stateSnapshotHash(verified.state) !== stateSnapshotHash(merged.state)) throw new Error('Post-write state hash differs from the verified final merge.');
    if (financeHash(verified.state, activeIds, activeLegacy) !== activeFinanceHash) throw new Error('Post-write verification detected an active finance change.');
    if (missingCoverage(activeLegacy, verified.state, 'attendanceLogs').length) throw new Error('Post-write verification lost active attendance.');
    const report = {
      ...plan,
      mode: 'apply',
      appliedAt: new Date().toISOString(),
      final: {
        ...plan.final,
        stateVersion: Number(verified.stateVersion || committedVersion),
        stateHash: stateSnapshotHash(verified.state)
      },
      verification: { ...plan.verification, postWriteVerified: true }
    };
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  if (mode === 'apply' && originalRelational && committedVersion) {
    try {
      const current = await reloadRelationalState(pool, { normalizeState: value => value });
      await persistRelationalState(pool, {
        state: originalRelational,
        expectedVersion: Number(current.stateVersion || 0),
        targetVersion: Number(current.stateVersion || 0) + 1,
        metadata: { actor: 'july30-final-merge', reason: 'automatic_rollback' },
        applyAuthOperationsWithClient: async () => {},
        financeSnapshotHash: sha256,
        revisionRetention: Number(process.env.STATE_REVISION_RETENTION || 500)
      });
    } catch (rollbackError) {
      error.message = `${error.message} Automatic rollback also failed: ${rollbackError.message}`;
    }
  }
  const failure = { ok: false, mode, failedAt: new Date().toISOString(), error: error.message || String(error) };
  writeReport(failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
