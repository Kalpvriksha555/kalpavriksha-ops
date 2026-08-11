// Central browser/runtime shape guards.
// API responses, localStorage, cross-tab messages and legacy records are all
// untrusted until their structure has been checked. These helpers deliberately
// return fresh safe fallbacks instead of relying on truthiness (`value || []`),
// because a truthy string/object can still crash `.map()`, `.some()`, spread,
// `.length`-dependent UI and nested-object operations.

export const asArray = (value) => (Array.isArray(value) ? value : []);

export const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value === 'string') return [];
  try {
    return typeof value[Symbol.iterator] === 'function' ? Array.from(value) : [];
  } catch {
    return [];
  }
};

export const asRecord = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

export const firstArray = (...values) => {
  for (const value of values) if (Array.isArray(value)) return value;
  return [];
};

export const asStringArray = (value) => asArray(value)
  .map(item => String(item ?? '').trim())
  .filter(Boolean);

export const parseJsonArray = (raw, fallback = []) => {
  const safeFallback = Array.isArray(fallback) ? fallback : [];
  if (raw === null || raw === undefined || raw === '') return safeFallback;
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : safeFallback;
  } catch {
    return safeFallback;
  }
};

export const parseJsonRecord = (raw, fallback = {}) => {
  const safeFallback = asRecord(fallback);
  if (raw === null || raw === undefined || raw === '') return safeFallback;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : safeFallback;
  } catch {
    return safeFallback;
  }
};

export const normalizeArrayFields = (record, fields = []) => {
  const source = asRecord(record);
  const next = { ...source };
  asArray(fields).forEach(field => {
    if (typeof field === 'string' && field) next[field] = asArray(source[field]);
  });
  return next;
};

export const safeObjectValues = (value) => Object.values(asRecord(value));
export const safeObjectEntries = (value) => Object.entries(asRecord(value));
