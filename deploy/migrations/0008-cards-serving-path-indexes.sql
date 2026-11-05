CREATE INDEX IF NOT EXISTS "cards_name_trash_index"       ON "cards" ("name", "trash");
CREATE INDEX IF NOT EXISTS "cards_right_id_trash_index"   ON "cards" ("right_id", "trash");
CREATE INDEX IF NOT EXISTS "cards_codename_present_index" ON "cards" ("codename", "id", "name", "left_id", "right_id") WHERE "codename" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "cards_key_last_char_index"    ON "cards" (substr("key", -1));
DROP INDEX IF EXISTS "cards_trash_index";
