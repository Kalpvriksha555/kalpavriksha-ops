import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const REDACT_KEYS = /(password|secret|token|cookie|authorization|database_url|smtp|api[_-]?key|private[_-]?key)/i;

function safeJson(value, depth = 0) {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => safeJson(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = REDACT_KEYS.test(key) ? '[redacted]' : safeJson(item, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 4000) return `${value.slice(0, 4000)}…`;
  return value;
}

export function structuredLog(level, event, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level: String(level || 'info').toLowerCase(),
    event: String(event || 'application_event'),
    ...safeJson(details)
  };
  const line = JSON.stringify(payload);
  if (payload.level === 'error' || payload.level === 'fatal') console.error(line);
  else if (payload.level === 'warn' || payload.level === 'warning') console.warn(line);
  else console.log(line);
  return payload;
}

export function requestLogMiddleware(req, res, next) {
  const started = process.hrtime.bigint();
  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    structuredLog(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'http_request', {
      requestId: req.requestId || res.getHeader('X-Request-ID') || '',
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      userId: req.auth?.user?.id || '',
      role: req.auth?.user?.role || '',
      ip: req.ip || req.socket?.remoteAddress || ''
    });
  });
  next();
}

export function filesystemUsage(targetPath) {
  try {
    fs.mkdirSync(targetPath, { recursive: true });
    const stats = fs.statfsSync(targetPath);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedPercent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : 0;
    return { ok: true, path: path.resolve(targetPath), totalBytes, freeBytes, usedBytes, usedPercent };
  } catch (error) {
    return { ok: false, path: path.resolve(targetPath), error: error.message || String(error) };
  }
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes = 0;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function readManifest(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ...parsed, manifestPath: filePath };
  } catch (error) {
    return { ok: false, status: 'INVALID', manifestPath: filePath, error: error.message || String(error) };
  }
}

export function inspectBackupManifests(backupRoot, { maxAgeHours = 26 } = {}) {
  const root = path.resolve(backupRoot);
  fs.mkdirSync(root, { recursive: true });
  const manifests = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.manifest.json'))
    .map(entry => readManifest(path.join(root, entry.name)))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const latest = manifests[0] || null;
  const latestVerified = manifests.find(item => item.status === 'VERIFIED' && item.ok !== false) || null;
  const verifiedCreatedMs = latestVerified?.createdAt ? new Date(latestVerified.createdAt).getTime() : 0;
  const ageHours = verifiedCreatedMs > 0 ? Number(((Date.now() - verifiedCreatedMs) / 3_600_000).toFixed(2)) : null;
  const fresh = !!latestVerified && ageHours !== null && ageHours <= Number(maxAgeHours || 26);
  const latestAttemptOk = !!latest && latest.status === 'VERIFIED' && latest.ok !== false;
  const latestAttemptFailed = !!latest && !latestAttemptOk;
  return {
    root,
    count: manifests.length,
    latest,
    latestVerified,
    latestAttemptOk,
    latestAttemptFailed,
    ageHours,
    maxAgeHours: Number(maxAgeHours || 26),
    ok: fresh,
    status: !latestVerified ? (latest ? 'NO_VERIFIED_BACKUP' : 'MISSING') : fresh ? 'HEALTHY' : 'STALE',
    warning: latestAttemptFailed && fresh ? 'LATEST_BACKUP_ATTEMPT_FAILED' : '',
    manifests: manifests.slice(0, 25)
  };
}

function localJobFile(dataDir) {
  return path.join(path.resolve(dataDir), 'operational-jobs.json');
}

function readLocalJobs(dataDir) {
  const fp = localJobFile(dataDir);
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')) || []; } catch { return []; }
}

function writeLocalJobs(dataDir, jobs) {
  fs.mkdirSync(path.resolve(dataDir), { recursive: true });
  const fp = localJobFile(dataDir);
  const temp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(jobs, null, 2));
  fs.renameSync(temp, fp);
}

export function createOperationalJobStore({ pool = null, dataDir, usePostgres = false } = {}) {
  const normalizeJob = (job = {}) => ({
    id: String(job.id || crypto.randomUUID()),
    jobType: String(job.jobType || job.job_type || 'UNKNOWN'),
    status: String(job.status || 'PENDING').toUpperCase(),
    attempts: Number(job.attempts || 0),
    maxAttempts: Math.max(1, Number(job.maxAttempts || job.max_attempts || 3)),
    payload: safeJson(job.payload || {}),
    result: safeJson(job.result || {}),
    error: String(job.error || ''),
    nextRunAt: job.nextRunAt || job.next_run_at || null,
    startedAt: job.startedAt || job.started_at || null,
    completedAt: job.completedAt || job.completed_at || null,
    createdAt: job.createdAt || job.created_at || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  async function upsert(job) {
    const row = normalizeJob(job);
    if (usePostgres && pool) {
      await pool.query(
        `INSERT INTO operational_jobs(id,job_type,status,attempts,max_attempts,payload,result,error,next_run_at,started_at,completed_at,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13)
         ON CONFLICT(id) DO UPDATE SET job_type=EXCLUDED.job_type,status=EXCLUDED.status,attempts=EXCLUDED.attempts,max_attempts=EXCLUDED.max_attempts,payload=EXCLUDED.payload,result=EXCLUDED.result,error=EXCLUDED.error,next_run_at=EXCLUDED.next_run_at,started_at=EXCLUDED.started_at,completed_at=EXCLUDED.completed_at,updated_at=EXCLUDED.updated_at`,
        [row.id,row.jobType,row.status,row.attempts,row.maxAttempts,JSON.stringify(row.payload),JSON.stringify(row.result),row.error,row.nextRunAt,row.startedAt,row.completedAt,row.createdAt,row.updatedAt]
      );
      return row;
    }
    const jobs = readLocalJobs(dataDir);
    const index = jobs.findIndex(item => String(item.id) === row.id);
    if (index >= 0) jobs[index] = row; else jobs.unshift(row);
    writeLocalJobs(dataDir, jobs.slice(0, 1000));
    return row;
  }

  async function list({ status = '', limit = 100 } = {}) {
    const capped = Math.max(1, Math.min(500, Number(limit || 100)));
    if (usePostgres && pool) {
      const values = [];
      let where = '';
      if (status) { values.push(String(status).toUpperCase()); where = 'WHERE status=$1'; }
      values.push(capped);
      const result = await pool.query(`SELECT * FROM operational_jobs ${where} ORDER BY updated_at DESC LIMIT $${values.length}`, values);
      return result.rows.map(normalizeJob);
    }
    return readLocalJobs(dataDir).filter(job => !status || String(job.status).toUpperCase() === String(status).toUpperCase()).slice(0, capped).map(normalizeJob);
  }

  async function retry(id, actor = 'system') {
    const jobs = await list({ limit: 500 });
    const existing = jobs.find(item => item.id === String(id));
    if (!existing) return null;
    return upsert({ ...existing, status:'PENDING', attempts:0, error:'', nextRunAt:new Date().toISOString(), result:{ retriedBy:actor, retriedAt:new Date().toISOString() } });
  }

  async function recordFailure(jobType, error, payload = {}, options = {}) {
    const deterministicId = options.id || (options.dedupKey
      ? `failure-${crypto.createHash('sha256').update(`${jobType}:${options.dedupKey}`).digest('hex').slice(0, 32)}`
      : undefined);
    const job = await upsert({
      id: deterministicId,
      jobType,
      status:'FAILED',
      attempts:Number(options.attempts || 1),
      maxAttempts:Number(options.maxAttempts || 3),
      payload,
      error:error?.message || String(error || 'Unknown failure'),
      completedAt:new Date().toISOString()
    });
    structuredLog('error','operational_job_failed',{jobId:job.id,jobType:job.jobType,error:job.error});
    return job;
  }

  async function resolveFailures(jobType, result = {}) {
    const normalizedType = String(jobType || '').trim();
    if (!normalizedType) return 0;
    if (usePostgres && pool) {
      const updated = await pool.query(
        `UPDATE operational_jobs
            SET status='SUCCEEDED',result=$2::jsonb,error='',completed_at=COALESCE(completed_at,now()),updated_at=now()
          WHERE job_type=$1 AND status='FAILED'`,
        [normalizedType, JSON.stringify(safeJson(result || {}))]
      );
      return Number(updated.rowCount || 0);
    }
    const jobs = readLocalJobs(dataDir);
    let changed = 0;
    const updatedAt = new Date().toISOString();
    for (const job of jobs) {
      if (String(job.jobType || job.job_type || '') !== normalizedType || String(job.status || '').toUpperCase() !== 'FAILED') continue;
      job.status = 'SUCCEEDED';
      job.result = safeJson(result || {});
      job.error = '';
      job.completedAt = job.completedAt || updatedAt;
      job.updatedAt = updatedAt;
      changed += 1;
    }
    if (changed) writeLocalJobs(dataDir, jobs.slice(0, 1000));
    return changed;
  }

  return { upsert, list, retry, recordFailure, resolveFailures };
}

export async function recordOperationalEvent(pool, usePostgres, event = {}) {
  const row = {
    eventType: String(event.eventType || 'SYSTEM_EVENT'),
    severity: String(event.severity || 'INFO').toUpperCase(),
    actor: String(event.actor || 'system'),
    requestId: String(event.requestId || ''),
    details: safeJson(event.details || {}),
    createdAt: event.createdAt || new Date().toISOString()
  };
  if (usePostgres && pool) {
    await pool.query(
      `INSERT INTO operational_events(event_type,severity,actor,request_id,details,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
      [row.eventType,row.severity,row.actor,row.requestId,JSON.stringify(row.details),row.createdAt]
    );
  }
  structuredLog(row.severity.toLowerCase(), row.eventType.toLowerCase(), { actor:row.actor, requestId:row.requestId, ...row.details });
  return row;
}
