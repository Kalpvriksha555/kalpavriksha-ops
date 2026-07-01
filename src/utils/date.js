export const formatLastSeenDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const formatCallDuration = (startedAt, nowMs = Date.now()) => {
  if (!startedAt) return '00:00';
  const total = Math.max(0, Math.floor((nowMs - Number(startedAt)) / 1000));
  const mins = Math.floor(total / 60).toString().padStart(2, '0');
  const secs = (total % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};

export const formatDateKey = (value = Date.now()) => {
  try {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch(e) { return new Date().toLocaleDateString('en-CA'); }
};

export const formatDateTime = (value) => {
  if (!value) return '-';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    return '-';
  }
};

export const formatDuration = (start, end = Date.now()) => {
  if (!start) return '-';
  const diff = Math.max(0, (end || Date.now()) - start);
  const totalMins = Math.floor(diff / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
};

export const formatMinutes = (minutes = 0) => {
  const safe = Math.max(0, Math.floor(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
};
