import 'dotenv/config';
const API = process.env.API_URL || `http://localhost:${process.env.PORT || 8080}`;
const res = await fetch(`${API}/api/db/migrate-json-to-postgres`, { method:'POST' });
const body = await res.json().catch(()=>({}));
if (!res.ok) {
  console.error('Migration failed:', body);
  process.exit(1);
}
console.log('Migration successful:', body);
