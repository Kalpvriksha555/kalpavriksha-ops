import 'dotenv/config';
const API = process.env.API_URL || `http://localhost:${process.env.PORT || 8080}`;
const res = await fetch(`${API}/api/db/health`);
const body = await res.json().catch(()=>({}));
console.log(body);
process.exit(res.ok ? 0 : 1);
