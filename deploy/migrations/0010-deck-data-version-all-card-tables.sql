CREATE TABLE IF NOT EXISTS "deck_data_version" (
  "id"      INTEGER PRIMARY KEY CHECK ("id" = 1),
  "version" INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO "deck_data_version" ("id", "version") VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS "cards_bump_deck_data_version_ins" AFTER INSERT ON "cards" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "cards_bump_deck_data_version_upd" AFTER UPDATE ON "cards" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "cards_bump_deck_data_version_del" AFTER DELETE ON "cards" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_references_bump_deck_data_version_ins" AFTER INSERT ON "card_references" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_references_bump_deck_data_version_upd" AFTER UPDATE ON "card_references" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_references_bump_deck_data_version_del" AFTER DELETE ON "card_references" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_acts_bump_deck_data_version_ins" AFTER INSERT ON "card_acts" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_acts_bump_deck_data_version_upd" AFTER UPDATE ON "card_acts" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_acts_bump_deck_data_version_del" AFTER DELETE ON "card_acts" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_actions_bump_deck_data_version_ins" AFTER INSERT ON "card_actions" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_actions_bump_deck_data_version_upd" AFTER UPDATE ON "card_actions" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_actions_bump_deck_data_version_del" AFTER DELETE ON "card_actions" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_changes_bump_deck_data_version_ins" AFTER INSERT ON "card_changes" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_changes_bump_deck_data_version_upd" AFTER UPDATE ON "card_changes" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_changes_bump_deck_data_version_del" AFTER DELETE ON "card_changes" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_virtuals_bump_deck_data_version_ins" AFTER INSERT ON "card_virtuals" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_virtuals_bump_deck_data_version_upd" AFTER UPDATE ON "card_virtuals" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
CREATE TRIGGER IF NOT EXISTS "card_virtuals_bump_deck_data_version_del" AFTER DELETE ON "card_virtuals" BEGIN
  UPDATE "deck_data_version" SET "version" = "version" + 1 WHERE "id" = 1;
END;
