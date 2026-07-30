import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { applyFinanceRecoveryPlanToCases, databaseFingerprint, verifyFinanceRecoveryPlan } from '../src/services/releaseCertificationService.js';
import { financeSnapshotHash } from '../src/services/financeIntegrityService.js';
import { persistRelationalState, reloadRelationalState, runRelationalMigrations } from '../src/repositories/postgresStateRepository.js';
import { atomicPrivateJson, parseArgs } from './finance-recovery-lib.mjs';

const args = parseArgs();
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const planPath = path.resolve(String(args.plan || process.env.RECOVERY_PLAN_FILE || './finance-recovery-plan.json'));
const confirmation = String(args.confirmation || process.env.RECOVERY_CONFIRMATION || '').trim();
const actor = String(args.actor || process.env.RECOVERY_ACTOR || 'finance-recovery-operator').trim();
const receiptPath = path.resolve(String(args.receipt || process.env.RECOVERY_RECEIPT_OUTPUT || `${planPath}.applied.json`));

if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) throw new Error('DATABASE_URL must point to the live PostgreSQL database.');
if (!fs.existsSync(planPath)) throw new Error(`Recovery plan not found: ${planPath}`);
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000)
});
try {
  await runRelationalMigrations(pool);
  const current = await reloadRelationalState(pool, { normalizeState: (state) => state });
  const verified = verifyFinanceRecoveryPlan(plan, {
    targetStateVersion: current.stateVersion,
    targetDatabaseFingerprint: databaseFingerprint(databaseUrl)
  });
  if (!verified.ok) {
    const error = new Error(`Recovery plan is no longer safe: ${verified.failures.join(' ')}`);
    error.code = 'FINANCE_RECOVERY_PLAN_INVALID';
    throw error;
  }
  const currentCases = Array.isArray(current.state.cases) ? current.state.cases : (Array.isArray(current.state.projects) ? current.state.projects : []);
  const applied = applyFinanceRecoveryPlanToCases(currentCases, plan, { confirmation, actor, now: Date.now() });
  if (!applied.recoveredCount) throw new Error('The plan contains no RECOVER actions. Nothing was changed.');
  const nextState = structuredClone(current.state);
  nextState.cases = applied.updatedCases;
  if (Array.isArray(nextState.projects)) nextState.projects = applied.updatedCases;
  const targetVersion = Number(current.stateVersion) + 1;
  const result = await persistRelationalState(pool, {
    state: nextState,
    expectedVersion: current.stateVersion,
    targetVersion,
    metadata: {
      actor,
      reason: 'selective_finance_recovery',
      financeEvents: applied.financeEvents,
      financeRecoveryRun: {
        id: plan.id,
        planHash: plan.planHash,
        actor,
        sourceLabel: plan.sourceLabel,
        targetStateVersionBefore: current.stateVersion,
        recoveredCount: applied.recoveredCount,
        skippedCount: Number(plan.summary?.skipped || 0),
        createdAt: plan.createdAt,
        details: { sourceLabel: plan.sourceLabel, caseIds: applied.financeEvents.map((event) => event.caseId) }
      }
    },
    applyAuthOperationsWithClient: async () => {},
    financeSnapshotHash,
    revisionRetention: Number(process.env.STATE_REVISION_RETENTION || 200)
  });
  const receipt = {
    ok: true,
    status: 'APPLIED',
    planId: plan.id,
    planHash: plan.planHash,
    actor,
    appliedAt: new Date().toISOString(),
    targetStateVersionBefore: current.stateVersion,
    targetStateVersionAfter: result.stateVersion,
    recoveredCount: applied.recoveredCount,
    recoveredCases: applied.financeEvents.map((event) => event.caseId),
    databaseFingerprint: databaseFingerprint(databaseUrl),
    snapshotHash: result.snapshotHash
  };
  atomicPrivateJson(receiptPath, receipt);
  console.log(JSON.stringify({ ...receipt, receiptFile: receiptPath }, null, 2));
} finally {
  await pool.end().catch(() => {});
}
