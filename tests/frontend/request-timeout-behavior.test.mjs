import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestDeadline, isProjectDeletedError } from '../../frontend/src/services/requestControlService.js';

test('request deadline aborts a stalled request at its configured timeout', async () => {
  const deadline = createRequestDeadline({ timeoutMs:20 });
  try {
    const error = await new Promise(resolve => {
      if (deadline.signal?.aborted) return resolve(deadline.signal.reason);
      deadline.signal?.addEventListener('abort', () => resolve(deadline.signal.reason), { once:true });
    });
    assert.equal(error?.name, 'TimeoutError');
  } finally {
    deadline.cleanup();
  }
});

test('only the explicit PROJECT_DELETED code is treated as a permanent deletion', () => {
  assert.equal(isProjectDeletedError({ status:409, code:'STATE_VERSION_CONFLICT' }), false);
  assert.equal(isProjectDeletedError({ status:409, code:'PROJECT_DELETED' }), true);
  assert.equal(isProjectDeletedError({ payload:{ code:'PROJECT_DELETED' } }), true);
});
