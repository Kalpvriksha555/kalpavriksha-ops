import { nanoid } from 'nanoid';

function now(){ return new Date().toISOString(); }

export function timelineEventTitle(type = '') {
  const map = {
    created: 'Case Created',
    assigned: 'Assigned',
    started: 'Designer Started',
    source_uploaded: 'Source File Uploaded',
    completion_uploaded: 'Completion Uploaded',
    revision_uploaded: 'Revision Completion Uploaded',
    internal_review: 'Internal Review Pending',
    approved: 'Approved',
    revision_created: 'Revision Created',
    payment_updated: 'Payment Updated',
    archived: 'Archived',
    delivery_prepared: 'Delivery Prepared',
    manual: 'Timeline Event'
  };
  return map[String(type || '').trim().toLowerCase()] || 'Timeline Event';
}

export function normalizeTimelineEvent(event = {}, fallback = {}) {
  const at = event.at || event.time || event.createdAt || fallback.at || now();
  const type = String(event.type || fallback.type || 'manual').trim().toLowerCase() || 'manual';
  const title = event.title || event.action || event.text || fallback.title || timelineEventTitle(type);
  return {
    id: String(event.id || fallback.id || nanoid(10)),
    type,
    title: String(title || timelineEventTitle(type)),
    text: String(event.text || title || timelineEventTitle(type)),
    by: String(event.by || event.user || event.createdBy || fallback.by || 'System'),
    at,
    time: event.time || at,
    remarks: String(event.remarks || event.note || event.details || fallback.remarks || ''),
    meta: event.meta && typeof event.meta === 'object' ? event.meta : (fallback.meta || {})
  };
}

export function normalizeCaseTimeline(c = {}) {
  const hasExplicitTimeline = Object.prototype.hasOwnProperty.call(c || {}, 'timeline');
  const existing = Array.isArray(c.timeline) ? c.timeline : [];
  const fromHistory = !hasExplicitTimeline && Array.isArray(c.history)
    ? c.history.map(h => normalizeTimelineEvent(h, { type:'manual', by:h.by, at:h.at, title:h.action }))
    : [];
  const timeline = [...existing, ...fromHistory].map(e => normalizeTimelineEvent(e));
  const seen = new Set();
  return timeline
    .filter(e => {
      const key = [e.type, e.title, e.by, e.at, e.remarks].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.at || a.time || 0).getTime() - new Date(b.at || b.time || 0).getTime());
}

export function addCaseTimelineEvent(c = {}, event = {}) {
  c.timeline = normalizeCaseTimeline(c);
  const normalized = normalizeTimelineEvent(event);
  c.timeline.push(normalized);
  c.timeline = normalizeCaseTimeline(c);
  c.updatedAt = Date.now();
  c.syncVersion = Date.now();
  return normalized;
}

export function mergeTimelineEvents(...sources) {
  const merged = [];
  for (const source of sources) {
    if (Array.isArray(source)) merged.push(...source);
  }
  return normalizeCaseTimeline({ timeline: merged });
}
