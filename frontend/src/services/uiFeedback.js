const UI_EVENT = 'kalpa-ui-feedback';
let sequence = 0;
const pending = new Map();

const emit = (detail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UI_EVENT, { detail }));
};

export const notifyUser = (message, options = {}) => {
  const text = String(message || '').trim();
  if (!text) return;
  emit({ kind: 'toast', id: `ui-${Date.now()}-${++sequence}`, message: text, tone: options?.tone || 'info', title: options?.title || '' });
};

const request = (kind, message, options = {}) => {
  if (typeof window === 'undefined') return Promise.resolve(kind === 'confirm' ? false : null);
  const id = `ui-${Date.now()}-${++sequence}`;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    emit({ kind, id, message: String(message || ''), ...options });
  });
};

export const requestConfirmation = (message, options = {}) => request('confirm', message, options);
export const requestInput = (message, options = {}) => request('prompt', message, options);

export const resolveUiRequest = (id, value) => {
  const resolve = pending.get(String(id));
  if (!resolve) return;
  pending.delete(String(id));
  resolve(value);
};

export const UI_FEEDBACK_EVENT = UI_EVENT;
