import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const checks = [];
const check = (label, condition) => checks.push([label, Boolean(condition)]);

const app = read('frontend/src/App.jsx');
const server = read('backend/src/server.js');
const config = read('frontend/src/config/appConfig.js');
const pkg = JSON.parse(read('package.json'));
const db = JSON.parse(read('backend/src/data/db.json'));
const projects = Array.isArray(db.cases) ? db.cases : (Array.isArray(db.projects) ? db.projects : []);

check('Active frontend entry exists', fs.existsSync('frontend/src/App.jsx') && fs.existsSync('frontend/src/main.jsx'));
check('Backend entry exists', fs.existsSync('backend/src/server.js'));
check('Full-stack localhost command starts both services', pkg.scripts?.dev === 'node scripts/start-all.mjs' && pkg.scripts?.start === 'node scripts/start-all.mjs');
check('Frontend defaults to shared production API', config.includes('https://api.kalpvriksha.co.in') && config.includes('VITE_API_URL'));
check('Backend exposes state hydration', server.includes("app.get('/api/state'"));
check('Dedicated task save exists', server.includes("app.post('/api/state/projects'"));
check('Dedicated task delete exists', server.includes("app.delete('/api/state/projects/:id'"));
check('Frontend hydrates backend state', app.includes('fetchBackendState'));
check('Bundled database is readable', Array.isArray(projects));
check('Bundled tasks are present', projects.length > 0);

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  if (!ok) failed += 1;
}
console.log(`Bundled data: ${projects.length} tasks, ${(db.users || []).length} users, ${(db.teamChat || []).length} chat messages, ${(db.notifications || []).length} notifications.`);
if (failed) process.exit(1);
