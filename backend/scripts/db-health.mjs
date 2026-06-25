const base = process.env.API_BASE || 'http://localhost:8080';
try {
  const res = await fetch(`${base}/api/db/health`);
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
  if (!json.ok) process.exit(1);
  if (json.database !== 'postgresql') {
    console.warn('WARNING: PostgreSQL is not active. Set DATABASE_URL before production launch.');
  }
} catch (err) {
  console.error('Database health check failed:', err.message);
  process.exit(1);
}
