import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const checks = [];
const check = (label, condition) => checks.push([label, Boolean(condition)]);

const app = read('frontend/src/App.jsx');
const server = read('backend/src/server.js');
const config = read('frontend/src/config/appConfig.js');
const viteConfig = read('frontend/vite.config.js');
const pkg = JSON.parse(read('package.json'));

check('Active frontend entry exists', fs.existsSync('frontend/src/App.jsx') && fs.existsSync('frontend/src/main.jsx'));
check('Backend entry exists', fs.existsSync('backend/src/server.js'));
check('Full-stack localhost command starts both services', pkg.scripts?.dev === 'node scripts/start-all.mjs' && pkg.scripts?.start === 'node scripts/start-all.mjs');
check('Local frontend defaults to local API', config.includes("'http://localhost:8080'") && config.includes('VITE_API_URL'));
check('Production frontend requires explicit API URL', config.includes('Production build requires VITE_API_URL'));
check('Production build blocks missing API URL', viteConfig.includes('Production build blocked: set VITE_API_URL'));
check('Backend exposes state hydration', server.includes("app.get('/api/state'"));
check('Dedicated task save exists', server.includes("app.post('/api/state/projects'"));
check('Dedicated task delete exists', server.includes("app.delete('/api/state/projects/:id'"));
check('Frontend hydrates backend state', app.includes('fetchBackendState'));
check('Private database is not bundled', !fs.existsSync('backend/src/data/db.json'));
check('Production PostgreSQL guard exists', server.includes('Production startup blocked: DATABASE_URL'));
check('Silent PostgreSQL fallback is removed', !server.includes('starting with the bundled JSON snapshot'));

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
