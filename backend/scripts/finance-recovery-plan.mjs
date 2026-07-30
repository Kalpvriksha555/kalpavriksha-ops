import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { buildFinanceRecoveryPlan, databaseFingerprint, extractCasesFromRecoverySource } from '../src/services/releaseCertificationService.js';
import { atomicPrivateJson, loadDatabaseState, parseArgs } from './finance-recovery-lib.mjs';

const args = parseArgs();
const targetDatabaseUrl = String(process.env.DATABASE_URL || '').trim();
const sourceDatabaseUrl = String(args.sourceDatabaseUrl || process.env.RECOVERY_SOURCE_DATABASE_URL || '').trim();
const sourceJsonPath = String(args.sourceJson || process.env.RECOVERY_SOURCE_JSON || '').trim();
const outputPath = path.resolve(String(args.output || process.env.RECOVERY_PLAN_OUTPUT || './finance-recovery-plan.json'));
const actor = String(args.actor || process.env.RECOVERY_ACTOR || 'finance-recovery-operator').trim();

if (!/^postgres(ql)?:\/\//i.test(targetDatabaseUrl)) throw new Error('DATABASE_URL must point to the current live PostgreSQL database.');
if (!!sourceDatabaseUrl === !!sourceJsonPath) throw new Error('Provide exactly one recovery source: --source-database-url or --source-json.');
if (sourceDatabaseUrl && databaseFingerprint(sourceDatabaseUrl) === databaseFingerprint(targetDatabaseUrl)) throw new Error('The recovery source database must not be the live target database. Restore the old backup into an isolated temporary database first.');

const poolOptions = (connectionString) => ({
  connectionString,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000)
});
const targetPool = new pg.Pool(poolOptions(targetDatabaseUrl));
let sourcePool;
try {
  const target = await loadDatabaseState(targetPool);
  let sourceCases = [];
  let sourceLabel = '';
  if (sourceDatabaseUrl) {
    sourcePool = new pg.Pool(poolOptions(sourceDatabaseUrl));
    const source = await loadDatabaseState(sourcePool);
    sourceCases = source.cases;
    sourceLabel = `isolated-database:${databaseFingerprint(sourceDatabaseUrl).slice(0, 16)}`;
  } else {
    const raw = JSON.parse(fs.readFileSync(path.resolve(sourceJsonPath), 'utf8'));
    sourceCases = extractCasesFromRecoverySource(raw);
    sourceLabel = `json:${path.basename(sourceJsonPath)}`;
  }
  const plan = buildFinanceRecoveryPlan({
    sourceCases,
    targetCases: target.cases,
    sourceLabel,
    targetLabel: `live-database:${databaseFingerprint(targetDatabaseUrl).slice(0, 16)}`,
    targetStateVersion: target.stateVersion,
    targetDatabaseFingerprint: databaseFingerprint(targetDatabaseUrl),
    createdBy: actor
  });
  atomicPrivateJson(outputPath, plan);
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    planFile: outputPath,
    planId: plan.id,
    planHash: plan.planHash,
    targetStateVersion: plan.targetStateVersion,
    summary: plan.summary,
    nextStep: plan.summary.recover > 0
      ? `Review every RECOVER item, then run finance-recovery:apply with confirmation: APPLY FINANCE RECOVERY ${plan.id}`
      : 'No automatically recoverable newer finance snapshots were found.'
  }, null, 2));
} finally {
  await targetPool.end().catch(() => {});
  await sourcePool?.end().catch(() => {});
}
