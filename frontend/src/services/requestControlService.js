let clientMutationGeneration = 0;

export function createRequestDeadline({ timeoutMs = 0, externalSignal } = {}) {
  const parsedTimeoutMs = Number(timeoutMs);
  const safeTimeoutMs = Number.isFinite(parsedTimeoutMs) ? Math.max(0, parsedTimeoutMs) : 0;
  if (!(safeTimeoutMs > 0) || typeof AbortController === 'undefined') {
    return { signal:externalSignal, cleanup:() => {} };
  }

  const controller = new AbortController();
  let timeoutId = null;
  let externalAbortHandler = null;
  if (externalSignal) {
    externalAbortHandler = () => controller.abort(externalSignal.reason);
    if (externalSignal.aborted) externalAbortHandler();
    else externalSignal.addEventListener('abort', externalAbortHandler, { once:true });
  }
  timeoutId = setTimeout(() => {
    const timeoutError = new Error(`Request timed out after ${safeTimeoutMs} ms.`);
    timeoutError.name = 'TimeoutError';
    controller.abort(timeoutError);
    if (externalSignal && externalAbortHandler) externalSignal.removeEventListener('abort', externalAbortHandler);
    externalAbortHandler = null;
    timeoutId = null;
  }, safeTimeoutMs);

  return {
    signal:controller.signal,
    cleanup() {
      if (timeoutId) clearTimeout(timeoutId);
      if (externalSignal && externalAbortHandler) externalSignal.removeEventListener('abort', externalAbortHandler);
    }
  };
}

// Phase 12: every browser-side mutation advances one monotonic generation.
// A workspace GET captures this value before it starts. If any write begins
// before that GET finishes, the GET is an old snapshot by definition and must
// not be allowed to overwrite the mutation's newer local/server-confirmed state.
export const markClientMutationStarted = () => {
  clientMutationGeneration += 1;
  return clientMutationGeneration;
};

export const getClientMutationGeneration = () => clientMutationGeneration;

export const didClientMutationAdvanceSince = (capturedGeneration) => {
  const captured = Number(capturedGeneration);
  return Number.isFinite(captured) && captured !== clientMutationGeneration;
};

export const isProjectDeletedError = (error = {}) => String(error?.code || error?.payload?.code || '').toUpperCase() === 'PROJECT_DELETED';
