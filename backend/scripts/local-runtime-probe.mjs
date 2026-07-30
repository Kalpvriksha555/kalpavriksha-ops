import http from 'node:http';

const url = new URL(process.env.LOCAL_API_HEALTH_URL || 'http://127.0.0.1:8080/api/health/live');
const request = http.get(url, { timeout: 4000 }, response => {
  let body = '';
  response.setEncoding('utf8');
  response.on('data', chunk => { body += chunk; });
  response.on('end', () => {
    if (response.statusCode !== 200) {
      console.error(JSON.stringify({ ok:false, status:response.statusCode, body }, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok:true, status:response.statusCode, url:String(url), body: body ? JSON.parse(body) : null }, null, 2));
  });
});
request.on('timeout', () => request.destroy(new Error('Local API health check timed out.')));
request.on('error', error => {
  console.error(JSON.stringify({ ok:false, url:String(url), error:error.message }, null, 2));
  process.exit(1);
});
