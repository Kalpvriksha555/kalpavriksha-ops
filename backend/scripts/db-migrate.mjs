import 'dotenv/config';
import pg from 'pg';
import { runRelationalMigrations } from '../src/repositories/postgresStateRepository.js';

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
  console.error('DATABASE_URL must contain a valid PostgreSQL connection string.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000)
});

try {
  const result = await runRelationalMigrations(pool);
  console.log(JSON.stringify({ ok:true, database:'postgresql-relational', ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok:false, code:error.code || '', error:error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
