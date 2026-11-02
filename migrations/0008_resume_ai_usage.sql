CREATE TABLE IF NOT EXISTS resume_ai_usage (
 scope TEXT NOT NULL, utc_day TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(scope,utc_day)
);
