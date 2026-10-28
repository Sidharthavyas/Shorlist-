ALTER TABLE outbox ADD COLUMN dispatch_token TEXT;
ALTER TABLE outbox ADD COLUMN dispatch_until TEXT;
ALTER TABLE source_sync_state ADD COLUMN queued_until TEXT;
CREATE TABLE durable_work (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  state TEXT NOT NULL DEFAULT 'PENDING',
  available_at TEXT NOT NULL,
  next_available_at TEXT,
  lease_token TEXT,
  lease_until TEXT,
  rerun INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  priority INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX durable_work_due ON durable_work(state,available_at,priority);
CREATE TABLE work_runtime (
  id TEXT PRIMARY KEY,
  blocked_until TEXT,
  lease_until TEXT,
  lease_token TEXT,
  error_code TEXT
);
