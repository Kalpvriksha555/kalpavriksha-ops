import { getPaymentReceivedAmount, getPaymentTrackingStatus } from './paymentStatusUtils.js';
import { formatDateKey } from './date.js';

const LOCATION_ALIASES = Object.freeze({
  LKO: 'LUCKNOW', LKN: 'LUCKNOW', LUCKNOW: 'LUCKNOW',
  VNS: 'VARANASI', BANARAS: 'VARANASI', KASHI: 'VARANASI', VARANASI: 'VARANASI',
  KNP: 'KANPUR', KANPUR: 'KANPUR', AGR: 'AGRA', AGRA: 'AGRA',
  AYD: 'AYODHYA', FAIZABAD: 'AYODHYA', AYODHYA: 'AYODHYA',
  ALD: 'PRAYAGRAJ', ALLAHABAD: 'PRAYAGRAJ', PRJ: 'PRAYAGRAJ', PRAYAGRAJ: 'PRAYAGRAJ',
});

export const normalizeArchiveValue = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9&]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();

export const getArchiveBank = (project = {}) => normalizeArchiveValue(project.client || project.bankName || project.bank || 'Bank not added');
export const getArchiveLocation = (project = {}) => {
  const value = normalizeArchiveValue(project.location || project.city || 'Location not added');
  return LOCATION_ALIASES[value] || value;
};

export const getCompletedDateKey = (completedAt) => {
  return formatDateKey(completedAt);
};

export const matchesArchiveSearch = (project = {}, query = '', extraValues = []) => {
  const needle = normalizeArchiveValue(query);
  if (!needle) return true;
  return normalizeArchiveValue([
    project.id, project.caseId, project.customerName, project.client, project.location, project.assignedTo,
    project.type, project.description, project.estimateDetails, project.paymentTrackingStatus,
    ...(Array.isArray(extraValues) ? extraValues : []),
  ].filter(Boolean).join(' ')).includes(needle);
};

export const groupArchivedByLocation = (projects = []) => {
  const grouped = new Map();
  for (const project of projects || []) {
    const location = getArchiveLocation(project);
    if (!grouped.has(location)) grouped.set(location, []);
    grouped.get(location).push(project);
  }
  return Array.from(grouped, ([location, items]) => ({
    location,
    items,
    unpaid: items.filter((item) => getPaymentTrackingStatus(item) !== 'Paid').length,
    received: items.reduce((sum, item) => sum + Number(getPaymentReceivedAmount(item) || 0), 0),
    latest: Math.max(0, ...items.map((item) => Number(item.completedAt || 0))),
  })).sort((a, b) => b.latest - a.latest || a.location.localeCompare(b.location));
};
