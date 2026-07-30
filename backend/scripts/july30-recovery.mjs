import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import {
  attendanceHash,
  caseFreshness,
  mergeRecoveryIntoState,
  nonCaseStateHash,
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
const sourcePath = path.resolve(String(args.source || ''));
const reportPath = path.resolve(String(args.report || path.join(process.cwd(), `july30-recovery-${mode}-report.json`)));
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!['plan', 'apply'].includes(mode)) throw new Error('Use --mode=plan or --mode=apply.');
if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error(`Recovery export is missing: ${sourcePath}`);
if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) throw new Error('DATABASE_URL must point to PostgreSQL.');

const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const { Pool } = pg;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000)
});

const writeReport = report => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
};

let original = null;
let committedVersion = 0;
try {
  await runRelationalMigrations(pool);
  const loaded = await reloadRelationalState(pool, { normalizeState: value => value });
  original = loaded.state;
  const originalVersion = Number(loaded.stateVersion || 0);
  const originalAttendanceHash = attendanceHash(original);
  const originalNonCaseHash = nonCaseStateHash(original);
  const recovery = mergeRecoveryIntoState(original, payload);
  const plan = {
    ok: true,
    mode,
    createdAt: new Date().toISOString(),
    source: {
      exportedAt: recovery.evidence.exportedAt,
      sourceHash: recovery.evidence.sourceHash,
      caseCount: recovery.evidence.caseCount,
      tasksAfterCutoff: recovery.evidence.freshCount,
      latestActivityAt: recovery.evidence.latestActivityAt
    },
    target: {
      stateVersionBefore: originalVersion,
      stateHashBefore: stateSnapshotHash(original),
      attendanceCountBefore: (original.attendanceLogs || []).length,
      attendanceHashBefore: originalAttendanceHash,
      nonCaseStateHashBefore: originalNonCaseHash,
      caseCountBefore: (original.cases || []).length
    },
    changes: recovery.summary
  };
  plan.planHash = sha256(plan);

  if (mode === 'plan') {
    writeReport(plan);
    console.log(JSON.stringify(plan, null, 2));
  } else {
    const result = await persistRelationalState(pool, {
      state: recovery.state,
      expectedVersion: originalVersion,
      targetVersion: originalVersion + 1,
      metadata: {
        actor: 'july30-recovery',
        reason: 'july30_project_operations_recovery'
      },
      applyAuthOperationsWithClient: async () => {},
      financeSnapshotHash: sha256,
      revisionRetention: Number(process.env.STATE_REVISION_RETENTION || 500)
    });
    committedVersion = Number(result.stateVersion || originalVersion + 1);

    const verified = await reloadRelationalState(pool, { normalizeState: value => value });
    const verifiedIds = new Set((verified.state.cases || []).map(item => String(item?.id || item?.caseId || item?.projectId || '')));
    const deletedIds = new Set((verified.state.deletedProjectIds || []).map(String));
    const missingRecoveredIds = recovery.evidence.cases
      .map(item => String(item?.id || item?.caseId || item?.projectId || ''))
      .filter(id => !verifiedIds.has(id) && !deletedIds.has(id));
    const attendancePreserved = attendanceHash(verified.state) === originalAttendanceHash
      && (verified.state.attendanceLogs || []).length === (original.attendanceLogs || []).length;
    const nonCasePreserved = nonCaseStateHash(verified.state) === originalNonCaseHash;
    const latestRecoveredActivity = Math.max(
      0,
      ...(verified.state.cases || []).map(item => caseFreshness(item, { maxTimestamp: recovery.evidence.maxTimestamp }))
    );

    if (missingRecoveredIds.length) throw new Error(`Post-recovery verification found ${missingRecoveredIds.length} missing task IDs.`);
    if (!attendancePreserved) throw new Error('Post-recovery verification detected an attendance change.');
    if (!nonCasePreserved) throw new Error('Post-recovery verification detected a non-project state change.');
    if (latestRecoveredActivity < recovery.evidence.latestTimestamp) throw new Error('Post-recovery activity is older than the verified July 30 export.');

    const report = {
      ...plan,
      mode: 'apply',
      appliedAt: new Date().toISOString(),
      target: {
        ...plan.target,
        stateVersionAfter: Number(verified.stateVersion || committedVersion),
        stateHashAfter: stateSnapshotHash(verified.state),
        caseCountAfter: (verified.state.cases || []).length,
        attendanceCountAfter: (verified.state.attendanceLogs || []).length,
        attendanceHashAfter: attendanceHash(verified.state),
        nonCaseStateHashAfter: nonCaseStateHash(verified.state),
        latestRecoveredActivityAt: new Date(latestRecoveredActivity).toISOString()
      },
      verification: {
        ok: true,
        missingRecoveredTaskCount: 0,
        attendancePreserved,
        nonCaseStatePreserved: nonCasePreserved,
        sourceFreshnessPreserved: true
      }
    };
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  if (mode === 'apply' && original && committedVersion) {
    try {
      const current = await reloadRelationalState(pool, { normalizeState: value => value });
      await persistRelationalState(pool, {
        state: original,
        expectedVersion: current.stateVersion,
        targetVersion: Number(current.stateVersion || 0) + 1,
        metadata: { actor: 'july30-recovery', reason: 'july30_recovery_automatic_rollback' },
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

