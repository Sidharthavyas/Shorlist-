CREATE TABLE IF NOT EXISTS owner_login_attempts (
  window_start INTEGER PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0
);
