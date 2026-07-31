/**
 * Return one mutable state snapshot for the lifetime of a request.
 * Middleware and handlers must share this exact object so mutations authorised
 * against one snapshot are the same mutations that are later persisted.
 */
export function getRequestStateSnapshot(req = {}, createSnapshot) {
  if (!req || typeof req !== 'object') throw new TypeError('A request object is required.');
  if (typeof createSnapshot !== 'function') throw new TypeError('A state snapshot factory is required.');
  if (req.kalpaStateSnapshot) return req.kalpaStateSnapshot;
  const snapshot = createSnapshot();
  Object.defineProperty(req, 'kalpaStateSnapshot', {
    value:snapshot,
    writable:false,
    configurable:false,
    enumerable:false
  });
  return snapshot;
}
