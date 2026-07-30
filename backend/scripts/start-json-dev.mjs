process.env.NODE_ENV ||= 'development';
process.env.ALLOW_JSON_FALLBACK ||= 'true';
process.env.HOST ||= '127.0.0.1';
await import('../src/server.js');
