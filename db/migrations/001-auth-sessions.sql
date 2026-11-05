CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "token_hash"      TEXT NOT NULL PRIMARY KEY,
  "account_card_id" INTEGER NOT NULL,
  "created_at"      TEXT NOT NULL,
  "expires_at"      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "index_auth_sessions_on_account_card_id"
  ON "auth_sessions" ("account_card_id");

CREATE INDEX IF NOT EXISTS "index_auth_sessions_on_expires_at"
  ON "auth_sessions" ("expires_at");
