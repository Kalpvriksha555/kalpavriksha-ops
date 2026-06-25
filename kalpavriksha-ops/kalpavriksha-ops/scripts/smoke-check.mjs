import fs from 'fs';
const src = fs.readFileSync('src/App.jsx', 'utf8');
const checks = [
  ['Command Centre component exists', /const CommandCentreView/.test(src)],
  ['Payment Health is admin-only', /currentUser\?\.role === ROLES\.ADMIN[\s\S]{0,250}Payment Health/.test(src)],
  ['Daily Closing tab is admin-only', src.includes("currentUser.role === ROLES.ADMIN && <button") && src.includes(">Daily Closing</button>") && src.includes("activeTab === 'closing' && currentUser.role === ROLES.ADMIN")],
  ['Attendance excludes admins', /role !== ROLES\.ADMIN/.test(src)],
  ['Khushbu spelling and username are normalized', /Khushbu Pandey/.test(src) && /username: 'khushbu'/.test(src)],
  ['Calculator tools are present', /Calculator & Conversion Tools/.test(src)],
  ['Global search is present', /Search Results/.test(src) && /Search cases/.test(src)],
  ['Completed file upload handler exists', /handleFileUpload\('completed'/.test(src) || /handleFileUpload\("completed"/.test(src)],
  ['WhatsApp completed-file sharing exists', /shareCompletedFileOnWhatsApp/.test(src)],
  ['Duplicate detection UI is absent', !/Possible Duplicate|Duplicate Case Found|duplicate warning/i.test(src)],
  ['Error boundary is present', /class AppErrorBoundary/.test(src)]
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
