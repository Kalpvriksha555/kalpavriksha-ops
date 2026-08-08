import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const envPath = new URL('../../backend/.env.example', import.meta.url);
const envExample = fs.readFileSync(envPath, 'utf8');

test('clean source package includes a safe backend environment template', () => {
  assert.match(envExample, /^NODE_ENV=development$/m);
  assert.match(envExample, /^DATABASE_URL=postgresql:\/\//m);
  assert.match(envExample, /^MAX_UPLOAD_SIZE_MB=100$/m);
  assert.match(envExample, /^MAX_UPLOAD_FILES=20$/m);
  assert.match(envExample, /^KALPA_FILE_STORAGE_ROOT=\/absolute\/path\//m);
  assert.match(envExample, /^FILE_STORAGE_PERSISTENT=false$/m);
  assert.match(envExample, /^ATTENDANCE_TIMEZONE=Asia\/Kolkata$/m);
  assert.doesNotMatch(envExample, /187\.127\.189\.38|api\.kalpvriksha\.co\.in|ops\.kalpvriksha\.co\.in/);
  const secretValues = envExample.split(/\r?\n/).filter(line => /(?:PASSWORD|TOKEN|SECRET|API_KEY)=/.test(line)).map(line => line.split('=').slice(1).join('='));
  assert.ok(secretValues.every(value => !value || /change|placeholder|example/i.test(value)));
});
