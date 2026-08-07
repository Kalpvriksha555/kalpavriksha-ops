import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = fs.readFileSync(new URL('../../frontend/src/config/appConfig.js', import.meta.url), 'utf8');
const rootVercel = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const frontendVercel = JSON.parse(fs.readFileSync(new URL('../../frontend/vercel.json', import.meta.url), 'utf8'));

test('production browser requests use the reachable frontend origin', () => {
  assert.match(config, /export const API_BASE = import\.meta\.env\.PROD[\s\S]*?\? ''/);
  assert.match(config, /Production build requires VITE_API_URL/);
});

test('Vercel forwards API and upload paths to the existing backend', () => {
  for (const vercel of [rootVercel, frontendVercel]) {
    assert.deepEqual(vercel.rewrites, [
      {
        source:'/api/:path*',
        destination:'https://api.kalpvriksha.co.in/api/:path*'
      },
      {
        source:'/uploads/:path*',
        destination:'https://api.kalpvriksha.co.in/uploads/:path*'
      }
    ]);
  }
});
