ALTER TABLE jobs ADD COLUMN normalized_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(normalized_json));
ALTER TABLE jobs ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1));
ALTER TABLE tasks ADD COLUMN settings_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE outbox ADD COLUMN completed_at TEXT;
CREATE INDEX task_pending ON tasks(state,created_at);
CREATE INDEX emails_application ON email_events(application_id);
