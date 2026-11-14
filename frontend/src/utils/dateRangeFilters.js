// UI-only date filters; never mutate historical case, finance or attendance data.
// Compare ISO calendar-day keys rather than UTC timestamps so the end date is inclusive.
const VALID_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export function validDateKey(value = '') {
  if (!VALID_DATE.test(String(value || ''))) return '';
  const [year,month,day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month-1 && date.getUTCDate() === day ? value : '';
}
export function dateFilterKey(value) {
  if (typeof value === 'string' && validDateKey(value.trim())) return value.trim();
  if (value == null || value === '') return '';
  const date = new Date(typeof value === 'number' && value > 0 && value < 1e11 ? value*1000 : value);
  if (!Number.isFinite(date.getTime())) return '';
  // Match the rest of the workspace's Asia/Kolkata calendar even for staff
  // viewing the site from a device in a different timezone.
  const india = new Date(date.getTime()+330*60*1000);
  const p = (v) => String(v).padStart(2,'0');
  return [india.getUTCFullYear(),p(india.getUTCMonth()+1),p(india.getUTCDate())].join('-');
}
export function validDateRange(from = '', to = '') {
  if (from && !validDateKey(from)) return false;
  if (to && !validDateKey(to)) return false;
  return !(from && to && from > to);
}
export function matchesDateRange(value, from = '', to = '') {
  if (!from && !to) return true;
  if (!validDateRange(from,to)) return false;
  const key = dateFilterKey(value);
  return Boolean(key && (!from || key >= from) && (!to || key <= to));
}
export function monthOverlapsDateRange(month, from = '', to = '') {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)) || !validDateRange(from,to)) return false;
  const y=Number(month.slice(0,4)),m=Number(month.slice(5));
  const first=month+'-01';
  const last=month+'-'+String(new Date(y,m,0).getDate()).padStart(2,'0');
  return (!from || last>=from) && (!to || first<=to);
}
