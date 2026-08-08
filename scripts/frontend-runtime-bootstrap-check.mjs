import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendRoot = path.join(root, 'frontend');

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
    key(index) { return [...values.keys()][Number(index)] ?? null; },
    get length() { return values.size; },
  };
};

const createDocumentStub = () => ({
  hidden: false,
  visibilityState: 'visible',
  documentElement: { classList: { toggle() {} } },
  body: { appendChild() {}, removeChild() {} },
  createElement() {
    return {
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {},
      remove() {},
      click() {},
      focus() {},
      select() {},
    };
  },
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return null; },
  activeElement: null,
});

const localStorage = memoryStorage();
const sessionStorage = memoryStorage();
const document = createDocumentStub();
const location = { origin: 'https://ops.kalpvriksha.co.in', href: 'https://ops.kalpvriksha.co.in/', protocol: 'https:', host: 'ops.kalpvriksha.co.in' };
const windowStub = {
  localStorage,
  sessionStorage,
  document,
  location,
  navigator: { onLine: true, userAgent: 'KalpavrikshaReleaseVerifier/1.0' },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame(callback) { return setTimeout(() => callback(Date.now()), 0); },
  cancelAnimationFrame(handle) { clearTimeout(handle); },
  matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
};

for (const [key, value] of Object.entries({
  window: windowStub,
  document,
  localStorage,
  sessionStorage,
  navigator: windowStub.navigator,
  location,
})) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
// Avoid a Node BroadcastChannel keeping this one-shot verifier alive.
globalThis.BroadcastChannel = undefined;

process.env.VITE_API_URL ||= 'https://ops.kalpvriksha.co.in';
process.env.VITE_API_BASE ||= process.env.VITE_API_URL;

let viteServer;
try {
  const [{ createServer }, React, ReactDOMServer] = await Promise.all([
    import('vite'),
    import('react'),
    import('react-dom/server'),
  ]);

  viteServer = await createServer({
    root: frontendRoot,
    mode: 'production',
    appType: 'custom',
    server: { middlewareMode: true },
    logLevel: 'error',
  });

  const appModule = await viteServer.ssrLoadModule('/src/App.jsx');
  if (typeof appModule?.default !== 'function') throw new Error('App.jsx did not expose the expected default React component.');

  const html = ReactDOMServer.renderToString(React.createElement(appModule.default));
  if (!html || html.length < 200) throw new Error('Signed-out App bootstrap produced no meaningful HTML.');
  if (/Something needs attention|Cannot read properties of null|Cannot read properties of undefined/i.test(html)) {
    throw new Error('Signed-out App bootstrap rendered the fatal error boundary.');
  }
  if (!/password|sign\s*in|login|username/i.test(html)) {
    throw new Error('Signed-out App bootstrap did not render an authentication surface.');
  }

  console.log(JSON.stringify({ ok: true, check: 'frontend-runtime-bootstrap', renderedBytes: Buffer.byteLength(html) }, null, 2));
} catch (error) {
  console.error('Frontend runtime bootstrap verification failed.');
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
} finally {
  if (viteServer) await viteServer.close().catch(() => {});
}
