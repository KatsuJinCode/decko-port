CREATE TABLE IF NOT EXISTS "decko_tx_state" (
  "id"         INTEGER PRIMARY KEY CHECK ("id" = 1),
  "tx"         TEXT,
  "expires_at" INTEGER,
  "signature"  TEXT
);

INSERT OR IGNORE INTO "decko_tx_state" ("id") VALUES (1);
