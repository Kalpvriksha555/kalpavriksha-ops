import process from 'node:process';

const trim = value => String(value || '').trim().replace(/\/+$/, '');
const apiPublic = trim(process.env.API_PUBLIC_URL || process.env.VITE_API_URL || 'https://api.kalpvriksha.co.in');
const frontendPublic = trim(process.env.FRONTEND_PUBLIC_URL || 'https://ops.kalpvriksha.co.in');
const localPort = Number(process.env.PORT || 8080);
const localApi = `http://127.0.0.1:${localPort}`;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(new Error('Live stack verification timed out.')), 60_000);

const request = async (label, url, init = {}, validate = () => true) => {
  const response = await fetch(url, { redirect:'manual', cache:'no-store', signal:controller.signal, ...init });
  const text = await response.text();
  if (!response.ok || !validate(response, text)) {
    throw new Error(`${label} failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  console.log(`PASS - ${label} (${response.status})`);
  return { response, text };
};

try {
  await request('Local backend liveness', `${localApi}/api/health/live`, {}, (_res, text) => /ALIVE|"ok"\s*:\s*true/i.test(text));
  await request('Local backend readiness', `${localApi}/api/health/ready`, {}, (_res, text) => /READY|"ready"\s*:\s*true|"ok"\s*:\s*true/i.test(text));
  await request('Public backend liveness', `${apiPublic}/api/health/live`, {}, (_res, text) => /ALIVE|"ok"\s*:\s*true/i.test(text));
  await request('Public frontend HTML', frontendPublic, {}, (res, text) => /text\/html/i.test(res.headers.get('content-type') || '') && /<div[^>]+id=["']root["']/i.test(text));

  const cors = await request('Credentialed login CORS preflight', `${apiPublic}/api/auth/login`, {
    method:'OPTIONS',
    headers:{
      Origin:frontendPublic,
      'Access-Control-Request-Method':'POST',
      'Access-Control-Request-Headers':'content-type,x-csrf-token'
    }
  }, res => {
    const allowedOrigin = res.headers.get('access-control-allow-origin');
    const credentials = res.headers.get('access-control-allow-credentials');
    return allowedOrigin === frontendPublic && credentials === 'true';
  });
  void cors;

  await request('Unauthenticated session contract', `${apiPublic}/api/auth/session`, {
    headers:{ Origin:frontendPublic }
  }, (res, text) => {
    const allowedOrigin = res.headers.get('access-control-allow-origin');
    return allowedOrigin === frontendPublic && /"authenticated"\s*:\s*false/i.test(text);
  });

  await request('Browser-session clearing contract', `${apiPublic}/api/auth/clear-browser-session`, {
    method:'POST',
    headers:{ Origin:frontendPublic }
  }, (res, text) => {
    const allowedOrigin = res.headers.get('access-control-allow-origin');
    const setCookie = res.headers.get('set-cookie') || '';
    return allowedOrigin === frontendPublic && /"authenticated"\s*:\s*false/i.test(text) && /kv_session|expires|max-age/i.test(setCookie);
  });

  console.log(JSON.stringify({ ok:true, frontendPublic, apiPublic, localApi }, null, 2));
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
