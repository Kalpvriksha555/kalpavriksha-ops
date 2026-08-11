const INDIA_OFFSET = '+05:30';

const positiveInteger = (value) => {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
};

export function parseIndiaAttendanceClock(dateKey = '', clockValue = '') {
  const date = String(dateKey || '').trim();
  const raw = String(clockValue || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !raw || raw === '-') return 0;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  const twelveHour = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (twelveHour) {
    hours = Number(twelveHour[1]);
    minutes = Number(twelveHour[2]);
    seconds = Number(twelveHour[3] || 0);
    if (hours < 1 || hours > 12 || minutes > 59 || seconds > 59) return 0;
    const period = twelveHour[4].toUpperCase();
    if (hours === 12) hours = 0;
    if (period === 'PM') hours += 12;
  } else {
    const twentyFourHour = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!twentyFourHour) return 0;
    hours = Number(twentyFourHour[1]);
    minutes = Number(twentyFourHour[2]);
    seconds = Number(twentyFourHour[3] || 0);
    if (hours > 23 || minutes > 59 || seconds > 59) return 0;
  }

  const iso = `${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${INDIA_OFFSET}`;
  const timestamp = new Date(iso).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function normalizePresenceClientCommand(input = {}) {
  const epoch = String(input.epoch || input.clientPresenceEpoch || '').trim().slice(0, 160);
  const sequence = positiveInteger(input.sequence ?? input.clientPresenceSequence);
  if (!epoch || !sequence) return { legacy:true, epoch:'', sequence:0 };
  return { legacy:false, epoch, sequence };
}

export function classifyPresenceClientCommand(user = {}, action = 'heartbeat', command = {}) {
  if (!command || command.legacy) return { accept:true, legacy:true, stale:false, epochMismatch:false };
  const storedEpoch = String(user?.presenceClientEpoch || '').trim();
  const storedSequence = positiveInteger(user?.presenceClientSequence);
  if (!storedEpoch) return { accept:true, legacy:false, stale:false, epochMismatch:false };
  if (storedEpoch === command.epoch) {
    if (command.sequence <= storedSequence) {
      return { accept:false, legacy:false, stale:true, epochMismatch:false, storedSequence };
    }
    return { accept:true, legacy:false, stale:false, epochMismatch:false, storedSequence };
  }
  if (String(action || '').toLowerCase() === 'login') {
    return { accept:true, legacy:false, stale:false, epochMismatch:false, newEpoch:true, storedSequence };
  }
  return { accept:false, legacy:false, stale:false, epochMismatch:true, storedSequence };
}

export function applyPresenceClientCommandMetadata(user = {}, command = {}) {
  if (!user || !command || command.legacy) return user;
  user.presenceClientEpoch = command.epoch;
  user.presenceClientSequence = command.sequence;
  return user;
}

export function computeAttendanceAccrual({
  lastTick = 0,
  loginAt = 0,
  nowMs = Date.now(),
  remainderMs = 0,
  maxGapMs = 10 * 60 * 1000
} = {}) {
  const now = Number(nowMs) || Date.now();
  const anchor = Math.max(Number(lastTick) || 0, Number(loginAt) || 0);
  const remainder = Math.max(0, Math.min(59_999, Math.floor(Number(remainderMs) || 0)));
  if (!anchor || now <= anchor) return { wholeMinutes:0, remainderMs:remainder, ignoredGapMinutes:0, elapsedMs:0 };
  const elapsedMs = now - anchor;
  if (elapsedMs > Math.max(60_000, Number(maxGapMs) || 0)) {
    return { wholeMinutes:0, remainderMs:0, ignoredGapMinutes:Math.floor(elapsedMs / 60_000), elapsedMs };
  }
  const totalMs = remainder + elapsedMs;
  return {
    wholeMinutes:Math.floor(totalMs / 60_000),
    remainderMs:totalMs % 60_000,
    ignoredGapMinutes:0,
    elapsedMs
  };
}
