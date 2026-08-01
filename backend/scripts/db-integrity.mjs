import 'dotenv/config';
import pg from 'pg';
import {
  auditRelationalIntegrityMetadata,
  getRelationalHealth,
  runRelationalMigrations
} from '../src/repositories/postgresStateRepository.js';

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
  console.error('DATABASE_URL must contain a valid PostgreSQL connection string.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString:databaseUrl,
  ssl:process.env.DB_SSL === 'true' ? { rejectUnauthorized:false } : undefined,
  connectionTimeoutMillis:Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  query_timeout:Number(process.env.DB_QUERY_TIMEOUT_MS || 120000)
});

try {
  await runRelationalMigrations(pool);
  const [health,audit]=await Promise.all([
    getRelationalHealth(pool),
    auditRelationalIntegrityMetadata(pool)
  ]);
  const ok=health.integrity?.ok !== false && audit.healthy;
  console.log(JSON.stringify({
    ok,
    ...health,
    integrity:{
      ok,
      countMismatches:audit.countMismatches,
      hashMatches:audit.hashMatches,
      expectedHash:audit.expectedHash,
      actualHash:audit.actualHash
    }
  },null,2));
  if(!ok) process.exitCode=1;
}catch(error){
  console.error(JSON.stringify({ok:false,code:error.code||'',error:error.message},null,2));
  process.exitCode=1;
}finally{
  await pool.end().catch(()=>{});
}
