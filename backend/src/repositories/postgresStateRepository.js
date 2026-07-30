import crypto from 'crypto';

const ADVISORY_LOCK_ID = 734821;
const KNOWN_STATE_KEYS = new Set([
  'users', 'cases', 'projects', 'deletedProjectIds', 'payments', 'performanceRecords',
  'notifications', 'teamChat', 'chatMessages', 'whatsappInbox', 'audit',
  'attendanceLogs', 'files', 'chatReads'
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function stateSnapshotHash(state) {
  return crypto.createHash('sha256').update(stableStringify(state || {})).digest('hex');
}

function safeText(value) {
  return String(value ?? '').trim();
}

const MIN_OPERATIONAL_TIMESTAMP_MS = Date.UTC(2000, 0, 1);
const MAX_OPERATIONAL_TIMESTAMP_MS = Date.UTC(2101, 0, 1) - 1;

export function normalizeEpochMilliseconds(value) {
  if (value === null || value === undefined || value === '') return null;
  let numeric = null;
  if (typeof value === 'number') numeric = value;
  else if (typeof value === 'string' && /^[+-]?\d{10,19}(?:\.\d+)?$/.test(value.trim())) numeric = Number(value.trim());
  if (!Number.isFinite(numeric)) return null;
  const magnitude = Math.abs(numeric);
  if (magnitude >= 1e17) numeric /= 1e6;      // nanoseconds -> milliseconds
  else if (magnitude >= 1e14) numeric /= 1e3; // microseconds -> milliseconds
  else if (magnitude > 0 && magnitude < 1e11) numeric *= 1e3; // seconds -> milliseconds
  const milliseconds = Math.trunc(numeric);
  if (milliseconds < MIN_OPERATIONAL_TIMESTAMP_MS || milliseconds > MAX_OPERATIONAL_TIMESTAMP_MS) return null;
  return milliseconds;
}

export function timestampValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalizedEpoch = normalizeEpochMilliseconds(value);
  const date = normalizedEpoch === null ? new Date(value) : new Date(normalizedEpoch);
  const milliseconds = date.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < MIN_OPERATIONAL_TIMESTAMP_MS || milliseconds > MAX_OPERATIONAL_TIMESTAMP_MS) return null;
  try {
    return date.toISOString();
  } catch {
    return null;
  }
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function deterministicId(prefix, value, index = 0) {
  const hash = crypto.createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 24);
  return `${prefix}-${hash}-${index}`;
}

function uniqueRows(items = [], keyFactory) {
  const byId = new Map();
  items.forEach((item, index) => {
    if (!item) return;
    const base = safeText(keyFactory(item, index)) || deterministicId('row', item, index);
    let id = base;
    let suffix = 1;
    while (byId.has(id) && stableStringify(byId.get(id).payload) !== stableStringify(item)) {
      id = `${base}-${suffix++}`;
    }
    byId.set(id, { id, sortOrder: index, payload: item });
  });
  return [...byId.values()];
}

export function decomposeState(state = {}) {
  const users = uniqueRows(state.users || [], (item, index) => item.id || item.userId || item.username || deterministicId('user', item, index));
  const cases = uniqueRows(state.cases || state.projects || [], (item, index) => item.id || item.caseId || deterministicId('case', item, index));
  const payments = uniqueRows((state.payments || []).filter(Boolean), (item, index) => item.id || item.paymentId || item.transactionId || item.referenceId || deterministicId('payment', item, index));
  const performanceRecords = uniqueRows(state.performanceRecords || [], (item, index) => item.id || `${item.userId || item.userName || item.name || 'performance'}:${item.period || item.month || item.date || index}`);
  const notifications = uniqueRows(state.notifications || [], (item, index) => item.id || deterministicId('notification', item, index));
  const teamChat = uniqueRows(state.teamChat || state.chatMessages || [], (item, index) => item.id || deterministicId('chat', item, index));
  const whatsappInbox = uniqueRows(state.whatsappInbox || [], (item, index) => item.id || deterministicId('whatsapp', item, index));
  const audit = uniqueRows(state.audit || [], (item, index) => item.id || deterministicId('audit', item, index));
  const attendanceLogs = uniqueRows(state.attendanceLogs || [], (item, index) => item.id || `${item.userId || item.userName || item.name || 'attendance'}:${item.date || item.day || item.createdAt || index}`);
  const files = uniqueRows(state.files || [], (item, index) => item.id || item.storedName || item.url || deterministicId('file', item, index));
  const deletedProjectIds = [...new Set((state.deletedProjectIds || []).map(safeText).filter(Boolean))];
  const chatReads = Object.entries(state.chatReads || {}).map(([readerKey, payload]) => ({ id: safeText(readerKey), payload: Array.isArray(payload) ? payload : [] })).filter(row => row.id);
  const misc = Object.fromEntries(Object.entries(state).filter(([key]) => !KNOWN_STATE_KEYS.has(key)));

  return {
    users,
    cases,
    payments,
    performanceRecords,
    notifications,
    teamChat,
    whatsappInbox,
    audit,
    attendanceLogs,
    files,
    deletedProjectIds,
    chatReads,
    misc
  };
}

export function recomposeState(parts = {}) {
  return {
    ...(parts.misc || {}),
    users: (parts.users || []).map(row => row.payload),
    cases: (parts.cases || []).map(row => row.payload),
    deletedProjectIds: [...(parts.deletedProjectIds || [])],
    payments: (parts.payments || []).map(row => row.payload).filter(Boolean),
    performanceRecords: (parts.performanceRecords || []).map(row => row.payload),
    notifications: (parts.notifications || []).map(row => row.payload),
    teamChat: (parts.teamChat || []).map(row => row.payload),
    whatsappInbox: (parts.whatsappInbox || []).map(row => row.payload),
    audit: (parts.audit || []).map(row => row.payload),
    attendanceLogs: (parts.attendanceLogs || []).map(row => row.payload),
    files: (parts.files || []).map(row => row.payload),
    chatReads: Object.fromEntries((parts.chatReads || []).map(row => [row.id, row.payload]))
  };
}

function migration(version, name, sql) {
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  return { version, name, checksum, sql };
}

export const RELATIONAL_MIGRATIONS = [
  migration('005.000', 'legacy_support_tables', `
    CREATE TABLE IF NOT EXISTS app_state (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      state_version bigint NOT NULL DEFAULT 0
    );
    ALTER TABLE app_state ADD COLUMN IF NOT EXISTS state_version bigint NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS finance_history (
      id bigserial PRIMARY KEY,
      case_id text NOT NULL,
      case_no text,
      action text NOT NULL,
      actor text,
      state_version bigint NOT NULL,
      previous_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
      next_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
      snapshot_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS finance_history_case_id_created_at_idx ON finance_history(case_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS files_meta (
      id text PRIMARY KEY,
      case_id text,
      name text,
      stored_name text,
      mime text,
      size bigint,
      purpose text,
      uploaded_by text,
      uploaded_at timestamptz DEFAULT now(),
      meta jsonb DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS auth_credentials (
      user_id text PRIMARY KEY,
      username text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL,
      status text NOT NULL DEFAULT 'APPROVED',
      must_change_password boolean NOT NULL DEFAULT false,
      password_version bigint NOT NULL DEFAULT 1,
      failed_attempts integer NOT NULL DEFAULT 0,
      locked_until timestamptz,
      password_changed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash text PRIMARY KEY,
      user_id text NOT NULL,
      csrf_token text NOT NULL,
      password_version bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      ip_address text,
      user_agent text
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS auth_events (
      id bigserial PRIMARY KEY,
      user_id text,
      username text,
      event_type text NOT NULL,
      ip_address text,
      user_agent text,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS auth_events_user_id_created_at_idx ON auth_events(user_id, created_at DESC);
  `),
  migration('005.001', 'relational_state_core', `
    CREATE TABLE IF NOT EXISTS app_state_metadata (
      key text PRIMARY KEY,
      state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
      snapshot_hash text NOT NULL DEFAULT '',
      entity_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(entity_counts) = 'object'),
      source text NOT NULL DEFAULT 'relational',
      migrated_from_legacy_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ops_users (
      id text PRIMARY KEY,
      username text,
      role text,
      status text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ops_users_username_unique_idx ON ops_users(lower(username)) WHERE username IS NOT NULL AND username <> '';
    CREATE INDEX IF NOT EXISTS ops_users_role_status_idx ON ops_users(role, status);

    CREATE TABLE IF NOT EXISTS ops_cases (
      id text PRIMARY KEY,
      case_no text,
      status text,
      assignee_id text,
      assignee_name text,
      location text,
      client text,
      finance_version bigint NOT NULL DEFAULT 0 CHECK (finance_version >= 0),
      updated_at timestamptz NOT NULL DEFAULT now(),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ops_cases_case_no_unique_idx ON ops_cases(case_no) WHERE case_no IS NOT NULL AND case_no <> '';
    CREATE INDEX IF NOT EXISTS ops_cases_status_updated_idx ON ops_cases(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS ops_cases_assignee_updated_idx ON ops_cases(assignee_name, updated_at DESC);
    CREATE INDEX IF NOT EXISTS ops_cases_location_idx ON ops_cases(location);

    CREATE TABLE IF NOT EXISTS ops_payments (
      id text PRIMARY KEY,
      case_id text,
      amount numeric(18,2),
      payment_date timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
    );
    CREATE INDEX IF NOT EXISTS ops_payments_case_date_idx ON ops_payments(case_id, payment_date DESC);

    CREATE TABLE IF NOT EXISTS ops_notifications (
      id text PRIMARY KEY,
      recipient text,
      status text,
      created_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
    );
    CREATE INDEX IF NOT EXISTS ops_notifications_recipient_status_idx ON ops_notifications(recipient, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS ops_chat_messages (
      id text PRIMARY KEY,
      sender text,
      recipient text,
      created_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
    );
    CREATE INDEX IF NOT EXISTS ops_chat_participants_idx ON ops_chat_messages(sender, recipient, created_at DESC);

    CREATE TABLE IF NOT EXISTS ops_attendance_logs (
      id text PRIMARY KEY,
      user_id text,
      attendance_date date,
      updated_at timestamptz NOT NULL DEFAULT now(),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
    );
    CREATE INDEX IF NOT EXISTS ops_attendance_user_date_idx ON ops_attendance_logs(user_id, attendance_date DESC);

    CREATE TABLE IF NOT EXISTS ops_audit_events (
      id text PRIMARY KEY,
      actor text,
      action text,
      created_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
    );
    CREATE INDEX IF NOT EXISTS ops_audit_actor_created_idx ON ops_audit_events(actor, created_at DESC);

    CREATE TABLE IF NOT EXISTS ops_performance_records (
      id text PRIMARY KEY,
      user_id text,
      period text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
    );
    CREATE INDEX IF NOT EXISTS ops_performance_user_period_idx ON ops_performance_records(user_id, period);

    CREATE TABLE IF NOT EXISTS ops_whatsapp_inbox (
      id text PRIMARY KEY,
      sender text,
      case_id text,
      created_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
    );
    CREATE INDEX IF NOT EXISTS ops_whatsapp_case_created_idx ON ops_whatsapp_inbox(case_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS ops_files (
      id text PRIMARY KEY,
      case_id text,
      stored_name text,
      uploaded_by text,
      uploaded_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
    );
    CREATE INDEX IF NOT EXISTS ops_files_case_uploaded_idx ON ops_files(case_id, uploaded_at DESC);
    CREATE INDEX IF NOT EXISTS ops_files_stored_name_idx ON ops_files(stored_name);

    CREATE TABLE IF NOT EXISTS ops_deleted_projects (
      project_id text PRIMARY KEY,
      deleted_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ops_chat_reads (
      reader_key text PRIMARY KEY,
      payload jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(payload) = 'array'),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ops_misc_state (
      key text PRIMARY KEY,
      payload jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `),
  migration('005.002', 'state_revision_ledger', `
    CREATE TABLE IF NOT EXISTS state_revisions (
      id bigserial PRIMARY KEY,
      state_version bigint NOT NULL UNIQUE CHECK (state_version >= 0),
      actor text,
      reason text NOT NULL DEFAULT 'state_update',
      snapshot_hash text NOT NULL,
      entity_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(entity_counts) = 'object'),
      snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS state_revisions_created_at_idx ON state_revisions(created_at DESC);
    CREATE INDEX IF NOT EXISTS state_revisions_actor_created_idx ON state_revisions(actor, created_at DESC);
  `),
  migration('005.003', 'migration_integrity_indexes', `
    CREATE INDEX IF NOT EXISTS finance_history_state_version_idx ON finance_history(state_version DESC);
    CREATE INDEX IF NOT EXISTS auth_events_created_at_idx ON auth_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS auth_sessions_active_user_idx ON auth_sessions(user_id, expires_at DESC) WHERE revoked_at IS NULL;
  `),
  migration('005.004', 'relational_collection_order', `
    ALTER TABLE ops_users ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
    ALTER TABLE ops_cases ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
    ALTER TABLE ops_payments ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
    ALTER TABLE ops_notifications ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
    ALTER TABLE ops_chat_messages ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
    ALTER TABLE ops_attendance_logs ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
    ALTER TABLE ops_audit_events ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
    ALTER TABLE ops_performance_records ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
    ALTER TABLE ops_whatsapp_inbox ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
    ALTER TABLE ops_files ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
    ALTER TABLE ops_deleted_projects ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS ops_cases_sort_order_idx ON ops_cases(sort_order);
    CREATE INDEX IF NOT EXISTS ops_notifications_sort_order_idx ON ops_notifications(sort_order);
    CREATE INDEX IF NOT EXISTS ops_chat_sort_order_idx ON ops_chat_messages(sort_order);
  `),
  migration('005.005', 'future_case_reference_guards', `
    CREATE OR REPLACE FUNCTION enforce_known_ops_case_reference() RETURNS trigger AS $$
    BEGIN
      IF NEW.case_id IS NULL OR btrim(NEW.case_id) = '' THEN RETURN NEW; END IF;
      -- During the one-time legacy import metadata does not yet exist, allowing
      -- old orphan records to be preserved for Phase 6 reconciliation.
      IF NOT EXISTS (SELECT 1 FROM app_state_metadata WHERE key='main') THEN RETURN NEW; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM ops_cases WHERE id=NEW.case_id OR case_no=NEW.case_id
      ) THEN
        RAISE EXCEPTION 'Unknown case reference: %', NEW.case_id USING ERRCODE='23503';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS ops_payments_case_reference_guard ON ops_payments;
    CREATE TRIGGER ops_payments_case_reference_guard
      BEFORE INSERT OR UPDATE OF case_id ON ops_payments
      FOR EACH ROW EXECUTE FUNCTION enforce_known_ops_case_reference();

    DROP TRIGGER IF EXISTS ops_files_case_reference_guard ON ops_files;
    CREATE TRIGGER ops_files_case_reference_guard
      BEFORE INSERT OR UPDATE OF case_id ON ops_files
      FOR EACH ROW EXECUTE FUNCTION enforce_known_ops_case_reference();

    DROP TRIGGER IF EXISTS ops_whatsapp_case_reference_guard ON ops_whatsapp_inbox;
    CREATE TRIGGER ops_whatsapp_case_reference_guard
      BEFORE INSERT OR UPDATE OF case_id ON ops_whatsapp_inbox
      FOR EACH ROW EXECUTE FUNCTION enforce_known_ops_case_reference();
  `),
  migration('006.001', 'private_file_storage_audit', `
    CREATE TABLE IF NOT EXISTS file_storage_events (
      id bigserial PRIMARY KEY,
      file_id text,
      case_id text,
      action text NOT NULL,
      actor text,
      storage_key text,
      sha256 text,
      details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS file_storage_events_file_created_idx ON file_storage_events(file_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS file_storage_events_action_created_idx ON file_storage_events(action, created_at DESC);

    CREATE TABLE IF NOT EXISTS file_reconciliation_runs (
      id bigserial PRIMARY KEY,
      actor text,
      imported_count integer NOT NULL DEFAULT 0,
      missing_count integer NOT NULL DEFAULT 0,
      refreshed_count integer NOT NULL DEFAULT 0,
      before_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(before_counts) = 'object'),
      after_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(after_counts) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `),
  migration('007.001', 'operational_reliability', `
    CREATE TABLE IF NOT EXISTS operational_jobs (
      id text PRIMARY KEY,
      job_type text NOT NULL,
      status text NOT NULL CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
      payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
      result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
      error text NOT NULL DEFAULT '',
      next_run_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS operational_jobs_status_updated_idx ON operational_jobs(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS operational_jobs_type_updated_idx ON operational_jobs(job_type, updated_at DESC);

    CREATE TABLE IF NOT EXISTS operational_events (
      id bigserial PRIMARY KEY,
      event_type text NOT NULL,
      severity text NOT NULL CHECK (severity IN ('DEBUG','INFO','WARN','ERROR','FATAL')),
      actor text NOT NULL DEFAULT 'system',
      request_id text NOT NULL DEFAULT '',
      details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS operational_events_type_created_idx ON operational_events(event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS operational_events_severity_created_idx ON operational_events(severity, created_at DESC);

    CREATE TABLE IF NOT EXISTS backup_runs (
      id text PRIMARY KEY,
      backup_type text NOT NULL,
      status text NOT NULL CHECK (status IN ('STARTED','CREATED','VERIFIED','FAILED','DRILL_PASSED','DRILL_FAILED')),
      manifest_path text NOT NULL DEFAULT '',
      database_file text NOT NULL DEFAULT '',
      files_archive text NOT NULL DEFAULT '',
      database_sha256 text NOT NULL DEFAULT '',
      files_sha256 text NOT NULL DEFAULT '',
      size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
      details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
      started_at timestamptz,
      completed_at timestamptz,
      verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS backup_runs_status_created_idx ON backup_runs(status, created_at DESC);
  `),
  migration('008.001', 'release_certification_and_finance_recovery', `
    CREATE TABLE IF NOT EXISTS release_certifications (
      id text PRIMARY KEY,
      app_version text NOT NULL,
      git_commit text NOT NULL DEFAULT '',
      status text NOT NULL CHECK (status IN ('CERTIFIED','FAILED','EXPIRED','REVOKED')),
      source_hash text NOT NULL,
      certificate_hash text NOT NULL,
      report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
      created_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS release_certifications_status_created_idx ON release_certifications(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS finance_recovery_runs (
      id text PRIMARY KEY,
      plan_hash text NOT NULL,
      actor text NOT NULL,
      status text NOT NULL CHECK (status IN ('PLANNED','APPLIED','FAILED','CANCELLED')),
      source_label text NOT NULL DEFAULT '',
      target_state_version_before bigint NOT NULL DEFAULT 0,
      target_state_version_after bigint,
      recovered_count integer NOT NULL DEFAULT 0 CHECK (recovered_count >= 0),
      skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
      details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS finance_recovery_runs_status_created_idx ON finance_recovery_runs(status, created_at DESC);
  `)
];

async function ensureMigrationRegistry(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      execution_ms integer NOT NULL DEFAULT 0,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function runRelationalMigrations(pool) {
  const client = await pool.connect();
  try {
    await ensureMigrationRegistry(client);
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);
    const appliedResult = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
    const applied = new Map(appliedResult.rows.map(row => [String(row.version), String(row.checksum)]));
    const appliedNow = [];

    for (const item of RELATIONAL_MIGRATIONS) {
      if (applied.has(item.version)) {
        if (applied.get(item.version) !== item.checksum) {
          const error = new Error(`Database migration ${item.version} checksum mismatch. The applied migration must never be edited; create a new migration instead.`);
          error.code = 'MIGRATION_CHECKSUM_MISMATCH';
          throw error;
        }
        continue;
      }
      const started = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(item.sql);
        await client.query(
          'INSERT INTO schema_migrations(version,name,checksum,execution_ms) VALUES($1,$2,$3,$4)',
          [item.version, item.name, item.checksum, Date.now() - started]
        );
        await client.query('COMMIT');
        appliedNow.push(item.version);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        error.message = `Migration ${item.version} (${item.name}) failed: ${error.message}`;
        throw error;
      }
    }
    return { appliedNow, currentVersion: RELATIONAL_MIGRATIONS.at(-1)?.version || null };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]).catch(() => {});
    client.release();
  }
}

function entityCounts(parts = {}) {
  return {
    users: parts.users?.length || 0,
    cases: parts.cases?.length || 0,
    payments: parts.payments?.length || 0,
    performanceRecords: parts.performanceRecords?.length || 0,
    notifications: parts.notifications?.length || 0,
    teamChat: parts.teamChat?.length || 0,
    whatsappInbox: parts.whatsappInbox?.length || 0,
    audit: parts.audit?.length || 0,
    attendanceLogs: parts.attendanceLogs?.length || 0,
    files: parts.files?.length || 0,
    deletedProjectIds: parts.deletedProjectIds?.length || 0,
    chatReads: parts.chatReads?.length || 0,
    misc: Object.keys(parts.misc || {}).length
  };
}

function rowTimestamp(payload = {}) {
  return timestampValue(payload.updatedAt || payload.updated_at || payload.createdAt || payload.created_at) || new Date().toISOString();
}

const TABLE_CONFIG = {
  users: {
    table: 'ops_users', idColumn: 'id',
    columns: ['id', 'sort_order', 'username', 'role', 'status', 'updated_at', 'payload'],
    values: row => [row.id, Number(row.sortOrder || 0), safeText(row.payload.username) || null, safeText(row.payload.role) || null, safeText(row.payload.status) || null, rowTimestamp(row.payload), JSON.stringify(row.payload)]
  },
  cases: {
    table: 'ops_cases', idColumn: 'id',
    columns: ['id', 'sort_order', 'case_no', 'status', 'assignee_id', 'assignee_name', 'location', 'client', 'finance_version', 'updated_at', 'payload'],
    values: row => [row.id, Number(row.sortOrder || 0), safeText(row.payload.caseId || row.payload.caseNo) || null, safeText(row.payload.status) || null, safeText(row.payload.assigneeId) || null, safeText(row.payload.assigneeName || row.payload.assignedTo) || null, safeText(row.payload.location || row.payload.city) || null, safeText(row.payload.client || row.payload.bank) || null, Math.max(0, Number(row.payload.financeVersion || 0)), rowTimestamp(row.payload), JSON.stringify(row.payload)]
  },
  payments: {
    table: 'ops_payments', idColumn: 'id',
    columns: ['id', 'sort_order', 'case_id', 'amount', 'payment_date', 'updated_at', 'payload'],
    values: row => [row.id, Number(row.sortOrder || 0), safeText(row.payload.caseId || row.payload.projectId || row.payload.caseNo) || null, numericValue(row.payload.amount ?? row.payload.paymentAmountIn ?? row.payload.received), timestampValue(row.payload.paymentDate || row.payload.createdAt), rowTimestamp(row.payload), JSON.stringify(row.payload)]
  },
  performanceRecords: {
    table: 'ops_performance_records', idColumn: 'id',
    columns: ['id', 'sort_order', 'user_id', 'period', 'updated_at', 'payload'],
    values: row => [row.id, Number(row.sortOrder || 0), safeText(row.payload.userId || row.payload.userName || row.payload.name) || null, safeText(row.payload.period || row.payload.month || row.payload.date) || null, rowTimestamp(row.payload), JSON.stringify(row.payload)]
  },
  notifications: {
    table: 'ops_notifications', idColumn: 'id',
    columns: ['id', 'sort_order', 'recipient', 'status', 'created_at', 'updated_at', 'payload'],
    values: row => [row.id, Number(row.sortOrder || 0), safeText(row.payload.targetUser || row.payload.to || row.payload.targetRole) || null, safeText(row.payload.status) || null, timestampValue(row.payload.createdAt), rowTimestamp(row.payload), JSON.stringify(row.payload)]
  },
  teamChat: {
    table: 'ops_chat_messages', idColumn: 'id',
    columns: ['id', 'sort_order', 'sender', 'recipient', 'created_at', 'updated_at', 'payload'],
    values: row => [row.id, Number(row.sortOrder || 0), safeText(row.payload.sender || row.payload.by) || null, safeText(row.payload.recipient || 'global') || null, timestampValue(row.payload.createdAt || row.payload.time), rowTimestamp(row.payload), JSON.stringify(row.payload)]
  },
  attendanceLogs: {
    table: 'ops_attendance_logs', idColumn: 'id',
    columns: ['id', 'sort_order', 'user_id', 'attendance_date', 'updated_at', 'payload'],
    values: row => [row.id, Number(row.sortOrder || 0), safeText(row.payload.userId || row.payload.userName || row.payload.name) || null, timestampValue(row.payload.date || row.payload.day)?.slice(0, 10) || null, rowTimestamp(row.payload), JSON.stringify(row.payload)]
  },
  audit: {
    table: 'ops_audit_events', idColumn: 'id',
    columns: ['id', 'sort_order', 'actor', 'action', 'created_at', 'updated_at', 'payload'],
    values: row => [row.id, Number(row.sortOrder || 0), safeText(row.payload.actor || row.payload.by || row.payload.user) || null, safeText(row.payload.action || row.payload.title) || null, timestampValue(row.payload.createdAt || row.payload.at || row.payload.time), rowTimestamp(row.payload), JSON.stringify(row.payload)]
  },
  whatsappInbox: {
    table: 'ops_whatsapp_inbox', idColumn: 'id',
    columns: ['id', 'sort_order', 'sender', 'case_id', 'created_at', 'updated_at', 'payload'],
    values: row => [row.id, Number(row.sortOrder || 0), safeText(row.payload.from || row.payload.fromName) || null, safeText(row.payload.caseId) || null, timestampValue(row.payload.createdAt), rowTimestamp(row.payload), JSON.stringify(row.payload)]
  },
  files: {
    table: 'ops_files', idColumn: 'id',
    columns: ['id', 'sort_order', 'case_id', 'stored_name', 'uploaded_by', 'uploaded_at', 'updated_at', 'payload'],
    values: row => [row.id, Number(row.sortOrder || 0), safeText(row.payload.caseId) || null, safeText(row.payload.storedName) || null, safeText(row.payload.uploadedBy) || null, timestampValue(row.payload.uploadedAt), rowTimestamp(row.payload), JSON.stringify(row.payload)]
  }
};

export function rowsRequiringRelationalWrite(rows = [], existingRows = []) {
  const existingById = new Map(existingRows.map(row => [String(row.id), row]));
  return rows.filter(row => {
    const existing = existingById.get(String(row.id));
    if (!existing) return true;
    return Number(existing.sortOrder || 0) !== Number(row.sortOrder || 0)
      || stableStringify(existing.payload) !== stableStringify(row.payload);
  });
}

async function upsertRows(client, config, rows = []) {
  const columns = config.columns;
  const updateColumns = columns.filter(column => column !== config.idColumn);
  const chunkSize = 150;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const existing = await client.query(
      `SELECT ${config.idColumn} AS id,sort_order AS "sortOrder",payload
         FROM ${config.table}
        WHERE ${config.idColumn} = ANY($1::text[])`,
      [chunk.map(row => row.id)]
    );
    const pending = rowsRequiringRelationalWrite(chunk, existing.rows);
    if (!pending.length) continue;
    const values = [];
    const tuples = pending.map((row, rowIndex) => {
      const rowValues = config.values(row);
      values.push(...rowValues);
      const offset = rowIndex * columns.length;
      return `(${columns.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(',')})`;
    });
    const updates = updateColumns.map(column => `${column}=EXCLUDED.${column}`).join(',');
    await client.query(
      `INSERT INTO ${config.table}(${columns.join(',')}) VALUES ${tuples.join(',')}
       ON CONFLICT (${config.idColumn}) DO UPDATE SET ${updates}
       WHERE ${config.table}.payload IS DISTINCT FROM EXCLUDED.payload
          OR ${config.table}.sort_order IS DISTINCT FROM EXCLUDED.sort_order`,
      values
    );
  }
  const ids = rows.map(row => row.id);
  if (ids.length) await client.query(`DELETE FROM ${config.table} WHERE NOT (${config.idColumn} = ANY($1::text[]))`, [ids]);
  else await client.query(`DELETE FROM ${config.table}`);
}

async function syncRelationalParts(client, parts = {}) {
  for (const [key, config] of Object.entries(TABLE_CONFIG)) await upsertRows(client, config, parts[key] || []);

  const deletedIds = parts.deletedProjectIds || [];
  if (deletedIds.length) {
    for (let index = 0; index < deletedIds.length; index += 1) {
      await client.query(
        `INSERT INTO ops_deleted_projects(project_id,sort_order) VALUES($1,$2)
         ON CONFLICT(project_id) DO UPDATE SET sort_order=EXCLUDED.sort_order
         WHERE ops_deleted_projects.sort_order IS DISTINCT FROM EXCLUDED.sort_order`,
        [deletedIds[index], index]
      );
    }
    await client.query('DELETE FROM ops_deleted_projects WHERE NOT (project_id = ANY($1::text[]))', [deletedIds]);
  } else await client.query('DELETE FROM ops_deleted_projects');

  const readRows = parts.chatReads || [];
  if (readRows.length) {
    for (const row of readRows) {
      await client.query(
        `INSERT INTO ops_chat_reads(reader_key,payload,updated_at) VALUES($1,$2::jsonb,now())
         ON CONFLICT(reader_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()
         WHERE ops_chat_reads.payload IS DISTINCT FROM EXCLUDED.payload`,
        [row.id, JSON.stringify(row.payload)]
      );
    }
    await client.query('DELETE FROM ops_chat_reads WHERE NOT (reader_key = ANY($1::text[]))', [readRows.map(row => row.id)]);
  } else await client.query('DELETE FROM ops_chat_reads');

  const miscEntries = Object.entries(parts.misc || {});
  if (miscEntries.length) {
    for (const [key, payload] of miscEntries) {
      await client.query(
        `INSERT INTO ops_misc_state(key,payload,updated_at) VALUES($1,$2::jsonb,now())
         ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()
         WHERE ops_misc_state.payload IS DISTINCT FROM EXCLUDED.payload`,
        [key, JSON.stringify(payload)]
      );
    }
    await client.query('DELETE FROM ops_misc_state WHERE NOT (key = ANY($1::text[]))', [miscEntries.map(([key]) => key)]);
  } else await client.query('DELETE FROM ops_misc_state');
}

async function readRows(client, table, orderBy = 'sort_order,id') {
  const result = await client.query(`SELECT ${table === 'ops_deleted_projects' ? 'project_id AS id, to_jsonb(project_id) AS payload' : table === 'ops_chat_reads' ? 'reader_key AS id, payload' : 'id, sort_order AS "sortOrder", payload'} FROM ${table} ORDER BY ${orderBy}`);
  return result.rows;
}

async function readRelationalParts(client) {
  // A pg Client executes one query at a time. Keep this snapshot read on one
  // connection and sequence the reads so pg@9 does not reject overlapping
  // client.query() calls.
  const users = await readRows(client, 'ops_users');
  const cases = await readRows(client, 'ops_cases');
  const payments = await readRows(client, 'ops_payments');
  const performanceRecords = await readRows(client, 'ops_performance_records');
  const notifications = await readRows(client, 'ops_notifications');
  const teamChat = await readRows(client, 'ops_chat_messages');
  const whatsappInbox = await readRows(client, 'ops_whatsapp_inbox');
  const audit = await readRows(client, 'ops_audit_events');
  const attendanceLogs = await readRows(client, 'ops_attendance_logs');
  const files = await readRows(client, 'ops_files');
  const deletedRows = await client.query('SELECT project_id FROM ops_deleted_projects ORDER BY sort_order,project_id');
  const chatReads = await readRows(client, 'ops_chat_reads', 'reader_key');
  const miscRows = await client.query('SELECT key,payload FROM ops_misc_state ORDER BY key');
  return {
    users, cases, payments, performanceRecords, notifications, teamChat, whatsappInbox, audit, attendanceLogs, files,
    deletedProjectIds: deletedRows.rows.map(row => row.project_id),
    chatReads,
    misc: Object.fromEntries(miscRows.rows.map(row => [row.key, row.payload]))
  };
}

function compareCounts(expected = {}, actual = {}) {
  return Object.keys(expected).filter(key => Number(expected[key] || 0) !== Number(actual[key] || 0));
}

export function verifyPersistedRelationalSnapshot(parts = {}, metadata = {}) {
  const persistedState = recomposeState(parts);
  const counts = entityCounts(decomposeState(persistedState));
  const expectedCounts = metadata.entity_counts || {};
  const countMismatches = compareCounts(expectedCounts, counts);
  const hash = stateSnapshotHash(persistedState);
  const expectedHash = String(metadata.snapshot_hash || '');
  if (countMismatches.length || (expectedHash && expectedHash !== hash)) {
    const error = new Error(`Relational state integrity check failed${countMismatches.length ? ` for: ${countMismatches.join(', ')}` : ''}. Restore the last verified revision before starting the API.`);
    error.code = 'RELATIONAL_STATE_INTEGRITY_FAILURE';
    throw error;
  }
  return { persistedState, counts, hash };
}

export async function loadRelationalState(pool, { normalizeState, seedState }) {
  await runRelationalMigrations(pool);
  const client = await pool.connect();
  try {
    const metadata = await client.query('SELECT * FROM app_state_metadata WHERE key=$1', ['main']);
    if (!metadata.rows.length) {
      const legacy = await client.query('SELECT value,state_version,updated_at FROM app_state WHERE key=$1', ['main']);
      const rawState = legacy.rows[0]?.value || structuredClone(seedState || {});
      const normalized = normalizeState(rawState);
      const version = Math.max(0, Number(legacy.rows[0]?.state_version || 0));
      const parts = decomposeState(normalized);
      const counts = entityCounts(parts);
      const hash = stateSnapshotHash(normalized);
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_ID]);
        const concurrentMetadata = await client.query('SELECT state_version FROM app_state_metadata WHERE key=$1 FOR UPDATE', ['main']);
        if (concurrentMetadata.rows.length) {
          await client.query('COMMIT');
          const currentParts = await readRelationalParts(client);
          const currentState = normalizeState(recomposeState(currentParts));
          return { state:currentState, stateVersion:Number(concurrentMetadata.rows[0].state_version || 0), source:'relational', legacyState:null };
        }
        await syncRelationalParts(client, parts);
        await client.query(
          `INSERT INTO app_state_metadata(key,state_version,snapshot_hash,entity_counts,source,migrated_from_legacy_at,updated_at)
           VALUES('main',$1,$2,$3::jsonb,$4,now(),now())`,
          [version, hash, JSON.stringify(counts), legacy.rows.length ? 'legacy_app_state_import' : 'empty_seed']
        );
        await client.query(
          `INSERT INTO state_revisions(state_version,actor,reason,snapshot_hash,entity_counts,snapshot)
           VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) ON CONFLICT(state_version) DO NOTHING`,
          [version, 'system', legacy.rows.length ? 'legacy_import' : 'initial_seed', hash, JSON.stringify(counts), JSON.stringify(normalized)]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
      return { state: normalized, stateVersion: version, source: legacy.rows.length ? 'legacy_app_state_import' : 'empty_seed', legacyState: rawState };
    }

    const parts = await readRelationalParts(client);
    const { persistedState } = verifyPersistedRelationalSnapshot(parts, metadata.rows[0]);
    const state = normalizeState(persistedState);
    return { state, stateVersion: Number(metadata.rows[0].state_version || 0), source: 'relational', legacyState: null };
  } finally {
    client.release();
  }
}

export async function reloadRelationalState(pool, { normalizeState }) {
  const client = await pool.connect();
  try {
    const metadata = await client.query('SELECT * FROM app_state_metadata WHERE key=$1', ['main']);
    if (!metadata.rows.length) throw new Error('Relational state metadata is missing.');
    const parts = await readRelationalParts(client);
    const state = normalizeState(recomposeState(parts));
    return { state, stateVersion: Number(metadata.rows[0].state_version || 0) };
  } finally {
    client.release();
  }
}

export async function persistRelationalState(pool, {
  state,
  expectedVersion,
  targetVersion,
  metadata = {},
  applyAuthOperationsWithClient,
  financeSnapshotHash,
  revisionRetention = 200
}) {
  const normalized = state;
  const parts = decomposeState(normalized);
  const counts = entityCounts(parts);
  const hash = stateSnapshotHash(normalized);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_ID]);
    const current = await client.query('SELECT state_version FROM app_state_metadata WHERE key=$1 FOR UPDATE', ['main']);
    const currentVersion = Number(current.rows[0]?.state_version || 0);
    if (currentVersion !== Number(expectedVersion)) {
      const error = new Error(`State changed on the server while this update was being saved. Expected version ${expectedVersion}, current version ${currentVersion}. Refresh and retry.`);
      error.statusCode = 409;
      error.code = 'STATE_VERSION_CONFLICT';
      throw error;
    }

    await syncRelationalParts(client, parts);
    const financeEvents = Array.isArray(metadata.financeEvents)
      ? metadata.financeEvents
      : (metadata.financeEvent ? [metadata.financeEvent] : []);
    for (const event of financeEvents) {
      const nextSnapshot = event.nextSnapshot || {};
      await client.query(
        `INSERT INTO finance_history(case_id,case_no,action,actor,state_version,previous_snapshot,next_snapshot,snapshot_hash)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
        [event.caseId, event.caseNo || '', event.action || 'Finance updated', event.actor || '', targetVersion, JSON.stringify(event.previousSnapshot || {}), JSON.stringify(nextSnapshot), financeSnapshotHash(nextSnapshot)]
      );
    }
    if (metadata.financeRecoveryRun) {
      const recovery = metadata.financeRecoveryRun;
      await client.query(
        `INSERT INTO finance_recovery_runs(id,plan_hash,actor,status,source_label,target_state_version_before,target_state_version_after,recovered_count,skipped_count,details,created_at,completed_at)
         VALUES($1,$2,$3,'APPLIED',$4,$5,$6,$7,$8,$9::jsonb,$10,now())`,
        [recovery.id,recovery.planHash,recovery.actor || 'system',recovery.sourceLabel || '',Number(recovery.targetStateVersionBefore || expectedVersion),Number(targetVersion),Number(recovery.recoveredCount || 0),Number(recovery.skippedCount || 0),JSON.stringify(recovery.details || {}),recovery.createdAt || new Date().toISOString()]
      );
    }
    if (Array.isArray(metadata.authOperations) && metadata.authOperations.length) {
      await applyAuthOperationsWithClient(client, metadata.authOperations);
    }

    const actor = safeText(metadata.actor || metadata.financeEvent?.actor || metadata.authOperations?.[0]?.actor || 'system');
    const reason = safeText(metadata.reason || (metadata.financeEvent ? 'finance_update' : metadata.authOperations?.length ? 'authentication_update' : 'state_update'));
    await client.query(
      `INSERT INTO state_revisions(state_version,actor,reason,snapshot_hash,entity_counts,snapshot)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [targetVersion, actor || 'system', reason, hash, JSON.stringify(counts), JSON.stringify(normalized)]
    );
    await client.query(
      `UPDATE app_state_metadata SET state_version=$2,snapshot_hash=$3,entity_counts=$4::jsonb,source='relational',updated_at=now() WHERE key=$1`,
      ['main', targetVersion, hash, JSON.stringify(counts)]
    );

    const keep = Math.max(25, Math.min(5000, Number(revisionRetention || 200)));
    await client.query(
      `DELETE FROM state_revisions WHERE id IN (
         SELECT id FROM state_revisions ORDER BY state_version DESC OFFSET $1
       )`,
      [keep]
    );

    await client.query('COMMIT');
    return { stateVersion: targetVersion, persistedAt: new Date().toISOString(), database: 'postgresql-relational', snapshotHash: hash, counts };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getRelationalHealth(pool) {
  const client = await pool.connect();
  try {
    const clock = await client.query('SELECT now() AS now');
    const metadata = await client.query('SELECT * FROM app_state_metadata WHERE key=$1', ['main']);
    const migrations = await client.query('SELECT version,name,checksum,applied_at FROM schema_migrations ORDER BY version');
    const revisions = await client.query('SELECT count(*)::int AS count,max(state_version)::bigint AS latest_version,max(created_at) AS latest_at FROM state_revisions');
    const tableCounts = await client.query(`SELECT
        (SELECT count(*)::int FROM ops_users) AS users,
        (SELECT count(*)::int FROM ops_cases) AS cases,
        (SELECT count(*)::int FROM ops_payments) AS payments,
        (SELECT count(*)::int FROM ops_notifications) AS notifications,
        (SELECT count(*)::int FROM ops_chat_messages) AS team_chat,
        (SELECT count(*)::int FROM ops_attendance_logs) AS attendance_logs,
        (SELECT count(*)::int FROM ops_files) AS files`);
    const meta = metadata.rows[0] || null;
    const actual = tableCounts.rows[0] || {};
    const expected = meta?.entity_counts || {};
    const mappedActual = {
      users: Number(actual.users || 0), cases: Number(actual.cases || 0), payments: Number(actual.payments || 0),
      notifications: Number(actual.notifications || 0), teamChat: Number(actual.team_chat || 0),
      attendanceLogs: Number(actual.attendance_logs || 0), files: Number(actual.files || 0)
    };
    const countMismatches = compareCounts(Object.fromEntries(Object.keys(mappedActual).map(key => [key, expected[key] || 0])), mappedActual);
    return {
      database: 'postgresql-relational',
      connected: true,
      time: clock.rows[0].now,
      stateVersion: Number(meta?.state_version || 0),
      snapshotHash: meta?.snapshot_hash || '',
      source: meta?.source || '',
      updatedAt: meta?.updated_at || null,
      counts: mappedActual,
      integrity: { ok: countMismatches.length === 0, countMismatches },
      migrations: { count: migrations.rows.length, currentVersion: migrations.rows.at(-1)?.version || null },
      revisions: revisions.rows[0]
    };
  } finally {
    client.release();
  }
}

export async function restoreRelationalRevision(pool, { revisionId, actor = 'system', applyAuthOperationsWithClient, financeSnapshotHash }) {
  const revision = await pool.query('SELECT id,state_version,snapshot FROM state_revisions WHERE id=$1', [revisionId]);
  if (!revision.rows.length) {
    const error = new Error('State revision not found.');
    error.statusCode = 404;
    error.code = 'STATE_REVISION_NOT_FOUND';
    throw error;
  }
  const metadata = await pool.query('SELECT state_version FROM app_state_metadata WHERE key=$1', ['main']);
  const expectedVersion = Number(metadata.rows[0]?.state_version || 0);
  return persistRelationalState(pool, {
    state: revision.rows[0].snapshot,
    expectedVersion,
    targetVersion: expectedVersion + 1,
    metadata: { actor, reason: `restore_revision_${revisionId}` },
    applyAuthOperationsWithClient,
    financeSnapshotHash,
    revisionRetention: 200
  });
}
