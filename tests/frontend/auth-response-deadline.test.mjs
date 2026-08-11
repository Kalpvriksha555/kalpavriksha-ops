import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadAuthServiceForNode() {
  let source = fs.readFileSync(new URL('../../frontend/src/services/authService.js', import.meta.url), 'utf8');
  source = source.replace("import { API_BASE } from '../config/appConfig';", "const API_BASE = '';");
  const requestControlUrl = pathToFileURL(path.resolve('frontend/src/services/requestControlService.js')).href;
  source = source.replace(
    "import { createRequestDeadline, markClientMutationStarted } from './requestControlService.js';",
    `import { createRequestDeadline, markClientMutationStarted } from ${JSON.stringify(requestControlUrl)};`
  );
  const apiContractUrl = pathToFileURL(path.resolve('frontend/src/services/apiContractService.js')).href;
  source = source.replace(
    "import { apiHttpError, readApiRecord } from './apiContractService.js';",
    `import { apiHttpError, readApiRecord } from ${JSON.stringify(apiContractUrl)};`
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('authFetch deadline remains active while a response body is stalled', async () => {
  const { authFetch } = await loadAuthServiceForNode();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }), { status:200 });
  try {
    const response = await authFetch('https://example.invalid/stalled', { timeoutMs:20 });
    await assert.rejects(response.text(), error => error?.name === 'TimeoutError');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authFetch deadline also aborts a caller consuming the raw response stream', async () => {
  const { authFetch } = await loadAuthServiceForNode();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }), { status:200 });
  try {
    const response = await authFetch('https://example.invalid/stalled-stream', { timeoutMs:20 });
    const reader = response.body.getReader();
    await assert.rejects(reader.read(), error => error?.name === 'TimeoutError');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
