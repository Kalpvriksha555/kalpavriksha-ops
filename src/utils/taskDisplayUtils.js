// Task/project display helpers extracted during Modularization Phase 3.
// These helpers are intentionally data-only so UI components can reuse the
// same labels/metadata without duplicating fallback logic.

export const allProjectDocs = (project = {}) => {
  const docs = [...(project?.documents || []), ...(project?.completedFiles || [])];
  const seen = new Set();
  return docs.filter((doc) => {
    const key = doc?.id || doc?.url || `${doc?.name}-${doc?.type}-${doc?.uploadedBy}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const isCompletedDocument = (doc = {}) => {
  const value = String(doc?.type || doc?.folder || doc?.category || doc?.documentType || doc?.status || '').toLowerCase();
  return ['completed', 'final', 'finished', 'submitted'].includes(value) && !String(doc?.name || '').toLowerCase().includes('qr');
};

export const getCompletedDocuments = (project = {}) => allProjectDocs(project).filter(isCompletedDocument);

export const getLatestCompletedFileName = (project = {}) => {
  const completed = getCompletedDocuments(project);
  return completed.length ? completed[completed.length - 1].name : '';
};

export const getTaskDescription = (project = {}) => {
  const raw = project.description
    ?? project.taskDescription
    ?? project.task_description
    ?? project.instructions
    ?? project.specialInstructions
    ?? project.special_instructions
    ?? project.otherDescription
    ?? project.other_description
    ?? project.taskNote
    ?? project.task_note
    ?? project.workDescription
    ?? project.work_description
    ?? project.details
    ?? '';
  return String(raw || '').trim();
};

export const getEstimateDetails = (project = {}) => {
  const raw = project.estimateDetails
    ?? project.estimate_details
    ?? project.propertyEstimateValue
    ?? project.property_estimate_value
    ?? project.estimateInstruction
    ?? project.estimate_instruction
    ?? project.estimateNote
    ?? project.estimate_note
    ?? '';
  return String(raw || '').trim();
};

export const getCompletedFileBadge = (project = {}) => getLatestCompletedFileName(project) || '';
