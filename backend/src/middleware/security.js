import crypto from 'crypto';

const stores = new Map();

const clientKey = (req = {}, prefix = 'default') => {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
  return `${prefix}:${ip}`;
};

export const createRateLimiter = ({ windowMs = 60_000, max = 60, prefix = 'api', key } = {}) => {
  const safeWindow = Math.max(1000, Number(windowMs) || 60_000);
  const safeMax = Math.max(1, Number(max) || 60);
  return (req, res, next) => {
    const now = Date.now();
    const storeKey = typeof key === 'function' ? String(key(req) || clientKey(req, prefix)) : clientKey(req, prefix);
    const record = stores.get(storeKey);
    const active = record && record.resetAt > now ? record : { count: 0, resetAt: now + safeWindow };
    active.count += 1;
    stores.set(storeKey, active);
    res.setHeader('RateLimit-Limit', String(safeMax));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, safeMax - active.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(active.resetAt / 1000)));
    if (active.count > safeMax) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((active.resetAt - now) / 1000))));
      return res.status(429).json({ ok:false, code:'RATE_LIMITED', error:'Too many requests. Please try again shortly.' });
    }
    next();
  };
};

export const attachRequestId = (req, res, next) => {
  const supplied = String(req.get?.('x-request-id') || '').trim();
  req.requestId = /^[A-Za-z0-9._:-]{8,100}$/.test(supplied) ? supplied : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

export const secureResponseHeaders = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
  next();
};

const dangerousKey = (key = '') => ['__proto__', 'prototype', 'constructor'].includes(String(key));
const inspect = (value, depth = 0) => {
  if (depth > 24) return false;
  if (!value || typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.every(item => inspect(item, depth + 1));
  for (const [key, nested] of Object.entries(value)) {
    if (dangerousKey(key) || !inspect(nested, depth + 1)) return false;
  }
  return true;
};

export const rejectDangerousJson = (req, res, next) => {
  if (!inspect(req.body)) return res.status(400).json({ ok:false, code:'UNSAFE_JSON', error:'Request contains an unsafe object key.' });
  next();
};

export const requireJsonForBody = (req, res, next) => {
  const method = String(req.method || '').toUpperCase();
  if (['POST', 'PUT', 'PATCH'].includes(method) && !req.is('application/json') && Object.keys(req.body || {}).length) {
    return res.status(415).json({ ok:false, code:'JSON_REQUIRED', error:'This endpoint requires application/json.' });
  }
  next();
};
