import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendRoot = path.join(root, 'frontend');
const frontendRequire = createRequire(path.join(frontendRoot, 'package.json'));

const importFrontendDependency = async (specifier) => {
  const resolved = frontendRequire.resolve(specifier);
  const namespace = await import(pathToFileURL(resolved).href);
  return { resolved, module: namespace.default || namespace };
};

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
let reactResolved = '';
let reactDomServerResolved = '';
try {
  const [{ createServer }, frontendReact, frontendReactDOMServer] = await Promise.all([
    import('vite'),
    importFrontendDependency('react'),
    importFrontendDependency('react-dom/server'),
  ]);
  reactResolved = frontendReact.resolved;
  reactDomServerResolved = frontendReactDOMServer.resolved;
  const React = frontendReact.module;
  const ReactDOMServer = frontendReactDOMServer.module;

  // The verifier must use the same React installation as the frontend SSR module graph.
  // Root and frontend dependencies are intentionally installed separately during release
  // verification; mixing root react-dom with frontend React produces a false invalid-hook
  // failure even though the browser bundle itself is healthy.
  viteServer = await createServer({
    root: frontendRoot,
    mode: 'production',
    appType: 'custom',
    resolve: { dedupe: ['react', 'react-dom'] },
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
  // Effects do not run during server rendering, so the first App render is expected
  // to show the secure-session preparation screen. Verify that real first-render
  // state separately from the LoginScreen component that appears after boot cleanup.
  if (!/Preparing secure sign-in|Clearing any stale browser session|password|sign\s*in|login|username/i.test(html)) {
    throw new Error('Signed-out App bootstrap did not render the expected secure pre-authentication surface.');
  }
  if (typeof appModule?.LoginScreen !== 'function') {
    throw new Error('App.jsx did not expose the LoginScreen component for runtime verification.');
  }
  const loginHtml = ReactDOMServer.renderToString(React.createElement(appModule.LoginScreen, {
    onLogin: async () => ({}),
    onChangePassword: async () => ({}),
    onRequestRecovery: async () => ({}),
    onResetRecovery: async () => ({}),
  }));
  if (!loginHtml || loginHtml.length < 200) throw new Error('LoginScreen runtime verification produced no meaningful HTML.');
  if (/Something needs attention|Cannot read properties of null|Cannot read properties of undefined/i.test(loginHtml)) {
    throw new Error('LoginScreen runtime verification rendered a fatal error state.');
  }
  if (!/password|sign\s*in|login|username/i.test(loginHtml)) {
    throw new Error('LoginScreen runtime verification did not render authentication controls.');
  }

  console.log(JSON.stringify({
    ok: true,
    check: 'frontend-runtime-bootstrap',
    renderedBytes: Buffer.byteLength(html),
    loginRenderedBytes: Buffer.byteLength(loginHtml),
    initialSurface: /Preparing secure sign-in/i.test(html) ? 'secure-sign-in-bootstrap' : 'authentication',
    reactResolved: path.relative(root, reactResolved),
    reactDomServerResolved: path.relative(root, reactDomServerResolved),
  }, null, 2));
} catch (error) {
  console.error('Frontend runtime bootstrap verification failed.');
  if (reactResolved || reactDomServerResolved) {
    console.error(`React renderer resolution: react=${reactResolved || 'unresolved'} react-dom/server=${reactDomServerResolved || 'unresolved'}`);
  }
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
} finally {
  if (viteServer) await viteServer.close().catch(() => {});
}
