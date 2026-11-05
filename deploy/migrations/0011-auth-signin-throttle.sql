CREATE TABLE IF NOT EXISTS auth_signin_throttle (
  scope TEXT PRIMARY KEY NOT NULL,
  failures INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  locked_until TEXT
);
