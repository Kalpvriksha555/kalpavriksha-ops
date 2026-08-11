import { asArray } from './runtimeShapeUtils.js';
// Task/project display helpers extracted during Modularization Phase 3.
// These helpers are intentionally data-only so UI components can reuse the
// same labels/metadata without duplicating fallback logic.

export const formatTaskId = (value = '') => {
  const raw = String(value || '').trim();
  return raw.replace(/-(\d+)$/, (_match, digits) => {
    const numeric = Number(digits);
    return '-' + (Number.isFinite(numeric) ? String(numeric).padStart(2, '0') : digits);
  });
};
export const allProjectDocs = (project = {}) => {
  const singleCompletedFields = [
    project?.completedFile,
    project?.completedDocument,
    project?.finalFile,
    project?.finalDocument,
  ].filter(Boolean);
  const docs = [
    ...asArray(project?.documents),
    ...asArray(project?.completedFiles),
    ...asArray(project?.finalFiles),
    ...singleCompletedFields,
  ];
  const seen = new Set();
  return docs.filter((doc) => {
    if (!doc) return false;
    const key = doc?.id || doc?.fileId || doc?.url || doc?.downloadUrl || `${doc?.name || doc?.fileName}-${doc?.type}-${doc?.uploadedBy}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const isCompletedDocument = (doc = {}) => {
  const name = String(doc?.name || doc?.fileName || '').toLowerCase();
  if (!doc || name.includes('qr')) return false;
  const markers = [
    doc?.purpose,
    doc?.type,
    doc?.folder,
    doc?.category,
    doc?.documentType,
    doc?.status,
    doc?.label,
  ].map(v => String(v || '').toLowerCase());

  return markers.some(value => (
    value === 'final'
    || value === 'revision_final'
    || value === 'completed'
    || value === 'submitted'
    || value === 'finished'
    || value.includes('completed file')
    || value.includes('completed work')
    || value.includes('final file')
    || value.includes('revised file')
  ));
};

const fileTime = (doc = {}) => {
  const raw = doc?.uploadedAt || doc?.createdAt || doc?.updatedAt || doc?.at || doc?.time || doc?.id || 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const getCompletedDocuments = (project = {}) => allProjectDocs(project)
  .filter(isCompletedDocument)
  .sort((a, b) => fileTime(a) - fileTime(b));

export const getLatestCompletedFileName = (project = {}) => {
  const completed = getCompletedDocuments(project);
  const latest = completed.length ? completed[completed.length - 1] : null;
  return latest ? (latest.name || latest.fileName || latest.originalName || '') : '';
};

const displayTextValue = (value) => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';

  // Some historical/cache payloads may wrap a display value in a small record.
  // Only read known scalar fields; never stringify arbitrary objects into
  // "[object Object]" for user-facing task metadata.
  for (const candidate of [
    value.text, value.value, value.label, value.details, value.description, value.note, value.amount,
  ]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
    if (typeof candidate === 'bigint') return String(candidate);
  }
  return '';
};

const firstDisplayText = (...values) => {
  for (const value of values) {
    const text = displayTextValue(value);
    if (text) return text;
  }
  return '';
};

export const getTaskDescription = (project = {}) => firstDisplayText(
  project?.description,
  project?.taskDescription,
  project?.task_description,
  project?.instructions,
  project?.specialInstructions,
  project?.special_instructions,
  project?.otherDescription,
  project?.other_description,
  project?.taskNote,
  project?.task_note,
  project?.workDescription,
  project?.work_description,
  project?.details,
);

export const getEstimateDetails = (project = {}) => firstDisplayText(
  project?.estimateDetails,
  project?.estimate_details,
  project?.propertyEstimateValue,
  project?.property_estimate_value,
  project?.estimateInstruction,
  project?.estimate_instruction,
  project?.estimateNote,
  project?.estimate_note,
);

export const getCompletedFileBadge = (project = {}) => getLatestCompletedFileName(project) || '';
