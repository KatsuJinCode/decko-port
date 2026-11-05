PRAGMA foreign_keys = OFF;


CREATE TABLE "cards" (
  "id"                   INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"                 TEXT,
  "key"                  TEXT,
  "codename"             TEXT,
  "left_id"              INTEGER,
  "right_id"             INTEGER,
  "current_revision_id"  INTEGER,
  "created_at"           TEXT NOT NULL,
  "updated_at"           TEXT NOT NULL,
  "creator_id"           INTEGER NOT NULL,
  "updater_id"           INTEGER NOT NULL,
  "read_rule_class"      TEXT,
  "read_rule_id"         INTEGER,
  "references_expired"   INTEGER,
  "trash"                INTEGER NOT NULL CHECK ("trash" IN (0,1)),
  "type_id"              INTEGER NOT NULL,
  "db_content"           TEXT
);
CREATE UNIQUE INDEX "cards_key_index"   ON "cards" ("key" COLLATE NOCASE);
CREATE UNIQUE INDEX "index_cards_on_left_id_and_right_id" ON "cards" ("left_id", "right_id");
CREATE UNIQUE INDEX "cards_codename_index" ON "cards" ("codename" COLLATE NOCASE);
CREATE INDEX "cards_name_index"         ON "cards" ("name");
CREATE INDEX "cards_type_id_index"      ON "cards" ("type_id");
CREATE INDEX "cards_left_id_index"      ON "cards" ("left_id");
CREATE INDEX "cards_right_id_index"     ON "cards" ("right_id");
CREATE INDEX "cards_read_rule_id_index" ON "cards" ("read_rule_id");
CREATE INDEX "cards_created_at_index"   ON "cards" ("created_at");
CREATE INDEX "cards_updated_at_index"   ON "cards" ("updated_at");
CREATE UNIQUE INDEX "cards_key_binary_index"      ON "cards" ("key");
CREATE UNIQUE INDEX "cards_codename_binary_index" ON "cards" ("codename");
CREATE INDEX "cards_name_trash_index"       ON "cards" ("name", "trash");
CREATE INDEX "cards_right_id_trash_index"   ON "cards" ("right_id", "trash");
CREATE INDEX "cards_codename_present_index" ON "cards" ("codename", "id", "name", "left_id", "right_id") WHERE "codename" IS NOT NULL;
CREATE INDEX "cards_key_last_char_index"    ON "cards" (substr("key", -1));


CREATE TABLE "card_acts" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "card_id"    INTEGER,
  "actor_id"   INTEGER,
  "acted_at"   TEXT,
  "ip_address" TEXT
);
CREATE INDEX "card_acts_actor_id_index" ON "card_acts" ("actor_id");
CREATE INDEX "card_acts_card_id_index"  ON "card_acts" ("card_id");
CREATE INDEX "acts_acted_at_index"      ON "card_acts" ("acted_at");


CREATE TABLE "card_actions" (
  "id"               INTEGER PRIMARY KEY AUTOINCREMENT,
  "card_id"          INTEGER,
  "card_act_id"      INTEGER,
  "super_action_id"  INTEGER,
  "action_type"      INTEGER,
  "draft"            INTEGER CHECK ("draft" IN (0,1)),
  "comment"          TEXT
);
CREATE INDEX "card_actions_card_act_id_index" ON "card_actions" ("card_act_id");
CREATE INDEX "card_actions_card_id_index"     ON "card_actions" ("card_id");


CREATE TABLE "card_changes" (
  "id"              INTEGER PRIMARY KEY AUTOINCREMENT,
  "card_action_id"  INTEGER,
  "field"           INTEGER,
  "value"           TEXT
);
CREATE INDEX "card_changes_card_action_id_index" ON "card_changes" ("card_action_id");


CREATE TABLE "card_references" (
  "id"           INTEGER PRIMARY KEY AUTOINCREMENT,
  "referer_id"   INTEGER NOT NULL DEFAULT 0,
  "referee_key"  TEXT DEFAULT '',
  "referee_id"   INTEGER,
  "ref_type"     TEXT NOT NULL DEFAULT '',
  "is_present"   INTEGER
);
CREATE INDEX "card_references_referee_id_index"  ON "card_references" ("referee_id");
CREATE INDEX "card_references_referee_key_index" ON "card_references" ("referee_key");
CREATE INDEX "card_references_referer_id_index"  ON "card_references" ("referer_id");
CREATE INDEX "card_references_ref_type_index"    ON "card_references" ("ref_type");


CREATE TABLE "card_revisions" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "created_at"  TEXT NOT NULL,
  "card_id"     INTEGER NOT NULL,
  "creator_id"  INTEGER NOT NULL,
  "content"     TEXT NOT NULL
);
CREATE INDEX "revisions_card_id_index"    ON "card_revisions" ("card_id");
CREATE INDEX "revisions_created_by_index" ON "card_revisions" ("creator_id");


CREATE TABLE "card_virtuals" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "left_id"     INTEGER,
  "right_id"    INTEGER,
  "content"     TEXT,
  "left_key"    TEXT,
  "updated_at"  TEXT
);
CREATE UNIQUE INDEX "index_card_virtuals_on_left_id_and_right_id" ON "card_virtuals" ("left_id", "right_id");
CREATE INDEX "left_id_index"  ON "card_virtuals" ("right_id");
CREATE INDEX "right_id_index" ON "card_virtuals" ("left_id");


CREATE TABLE "delayed_jobs" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "priority"    INTEGER NOT NULL DEFAULT 0,
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "handler"     TEXT NOT NULL,
  "last_error"  TEXT,
  "run_at"      TEXT,
  "locked_at"   TEXT,
  "failed_at"   TEXT,
  "locked_by"   TEXT,
  "queue"       TEXT,
  "created_at"  TEXT,
  "updated_at"  TEXT
);
CREATE INDEX "delayed_jobs_priority" ON "delayed_jobs" ("priority", "run_at");


CREATE TABLE "sessions" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "session_id"  TEXT,
  "data"        TEXT,
  "updated_at"  TEXT
);
CREATE INDEX "sessions_session_id_index" ON "sessions" ("session_id");


CREATE TABLE "schema_migrations" (
  "version"  TEXT
);
CREATE UNIQUE INDEX "unique_schema_migrations" ON "schema_migrations" ("version");


CREATE TABLE "ar_internal_metadata" (
  "key"         TEXT NOT NULL PRIMARY KEY,
  "value"       TEXT,
  "created_at"  TEXT NOT NULL,
  "updated_at"  TEXT NOT NULL
);


CREATE TABLE "transform_migrations" (
  "version"  TEXT
);
CREATE UNIQUE INDEX "unique_schema_migrations_cards" ON "transform_migrations" ("version");


CREATE TABLE "deck_data_version" (
  "id"      INTEGER PRIMARY KEY CHECK ("id" = 1),
  "version" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "deck_data_version" ("id", "version") VALUES (1, 0);

CREATE TRIGGER "cards_bump_deck_data_version_ins" AFTER INSERT ON "cards" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "cards_bump_deck_data_version_upd" AFTER UPDATE ON "cards" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "cards_bump_deck_data_version_del" AFTER DELETE ON "cards" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_references_bump_deck_data_version_ins" AFTER INSERT ON "card_references" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_references_bump_deck_data_version_upd" AFTER UPDATE ON "card_references" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_references_bump_deck_data_version_del" AFTER DELETE ON "card_references" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_acts_bump_deck_data_version_ins" AFTER INSERT ON "card_acts" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_acts_bump_deck_data_version_upd" AFTER UPDATE ON "card_acts" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_acts_bump_deck_data_version_del" AFTER DELETE ON "card_acts" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_actions_bump_deck_data_version_ins" AFTER INSERT ON "card_actions" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_actions_bump_deck_data_version_upd" AFTER UPDATE ON "card_actions" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_actions_bump_deck_data_version_del" AFTER DELETE ON "card_actions" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_changes_bump_deck_data_version_ins" AFTER INSERT ON "card_changes" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_changes_bump_deck_data_version_upd" AFTER UPDATE ON "card_changes" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_changes_bump_deck_data_version_del" AFTER DELETE ON "card_changes" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_virtuals_bump_deck_data_version_ins" AFTER INSERT ON "card_virtuals" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_virtuals_bump_deck_data_version_upd" AFTER UPDATE ON "card_virtuals" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER "card_virtuals_bump_deck_data_version_del" AFTER DELETE ON "card_virtuals" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
