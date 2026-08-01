const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

export const normalizeCorsOrigin = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!HTTP_PROTOCOLS.has(parsed.protocol)) return '';
    return parsed.origin;
  } catch {
    return '';
  }
};

export const parseCorsOrigins = value => [...new Set(
  String(value || '')
    .split(',')
    .map(normalizeCorsOrigin)
    .filter(Boolean)
)];

export const isLoopbackDevelopmentOrigin = origin => {
  if (!origin) return false;
  try {
    const parsed = new URL(String(origin));
    if (!HTTP_PROTOCOLS.has(parsed.protocol)) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (hostname === 'localhost' || hostname === '::1') return true;
    if (!/^127(?:\.\d{1,3}){3}$/.test(hostname)) return false;
    return hostname.split('.').slice(1).every(part => Number(part) >= 0 && Number(part) <= 255);
  } catch {
    return false;
  }
};

export const createCorsOriginPolicy = ({ configuredOrigins = [], production = false } = {}) => {
  const trustedOrigins = new Set(
    configuredOrigins
      .map(normalizeCorsOrigin)
      .filter(Boolean)
  );

  return origin => {
    // Requests without an Origin header are server-to-server, same-origin, curl,
    // health checks, or local tooling. CORS does not apply to them.
    if (!origin) return true;
    if (trustedOrigins.has(normalizeCorsOrigin(origin))) return true;
    // Development may move from 5173 to another Vite port when the preferred
    // port is already occupied. Permit only genuine loopback hosts, never
    // lookalike domains, and keep production strictly allowlisted.
    return !production && isLoopbackDevelopmentOrigin(origin);
  };
};
