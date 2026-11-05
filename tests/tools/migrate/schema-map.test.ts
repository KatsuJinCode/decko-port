// schema-map.test.ts — the source-to-target column mapping for the
// generalized migration tool.
//
// DATA RULE: zero real content. The test source tables are SYNTHETIC
// decko-shaped schemas (built in-test with better-sqlite3, never read
// from a real dump). Asserts that the schema-map classifies tables and
// translates columns correctly across the variants we've seen.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  classifySourceTable,
  mapRowToTarget,
  SETTINGS_TABLE_VARIANTS,
  getColumnMap,
} from "../../../tools/migrate/schema-map.mjs";

const TARGET_TABLE_COLUMNS = {
  cards: [
    "id", "name", "key", "codename", "left_id", "right_id",
    "current_revision_id", "created_at", "updated_at", "creator_id",
    "updater_id", "read_rule_class", "read_rule_id", "references_expired",
    "trash", "type_id", "db_content",
  ],
  card_references: ["id", "referer_id", "referee_key", "referee_id", "ref_type", "is_present"],
};

const dirs: string[] = [];
function makeDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "decko-schema-map-"));
  dirs.push(dir);
  const path = join(dir, "src.sqlite");
  const db = new Database(path);
  db.exec(
    `CREATE TABLE cards (
       id INTEGER PRIMARY KEY,
       name TEXT, key TEXT, codename TEXT,
       left_id INTEGER, right_id INTEGER,
       content TEXT,
       creator_id INTEGER, updater_id INTEGER,
       read_rule_class TEXT, read_rule_id INTEGER,
       trash INTEGER, type_id INTEGER,
       created_at TEXT, updated_at TEXT
     )`,
  );
  db.exec(
    `CREATE TABLE card_references (
       id INTEGER PRIMARY KEY,
       referer_id INTEGER, referee_key TEXT, referee_id INTEGER,
       ref_type TEXT, is_present INTEGER
     )`,
  );
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`);
  db.exec(`CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT)`);
  db.exec(`CREATE TABLE custom_extension (foo TEXT, bar INTEGER)`);
  db.close();
  return path;
}

afterAll(() => {
  for (const d of dirs) {
    try {
      // best-effort cleanup; SQLite WAL files may still be open briefly
      const Database = require("better-sqlite3");
      // no-op; tmpdir cleanup is OS-managed on Windows
      void Database;
    } catch {
      // ignore
    }
  }
});

describe("classifySourceTable", () => {
  it("returns 'core' for tables that have a per-table column map", () => {
    expect(classifySourceTable("cards", Object.keys(TARGET_TABLE_COLUMNS))).toBe("core");
    expect(classifySourceTable("card_references", Object.keys(TARGET_TABLE_COLUMNS))).toBe("core");
  });

  it("returns 'settings' for the meta / settings variants", () => {
    expect(classifySourceTable("meta", Object.keys(TARGET_TABLE_COLUMNS))).toBe("settings");
    expect(classifySourceTable("settings", Object.keys(TARGET_TABLE_COLUMNS))).toBe("settings");
    expect(classifySourceTable("setting", Object.keys(TARGET_TABLE_COLUMNS))).toBe("settings");
    for (const v of SETTINGS_TABLE_VARIANTS) {
      expect(classifySourceTable(v, Object.keys(TARGET_TABLE_COLUMNS))).toBe("settings");
    }
  });

  it("returns 'unknown' for tables outside the DDL", () => {
    expect(classifySourceTable("custom_extension", Object.keys(TARGET_TABLE_COLUMNS))).toBe(
      "unknown",
    );
    expect(classifySourceTable("widgets", Object.keys(TARGET_TABLE_COLUMNS))).toBe("unknown");
  });
});

describe("mapRowToTarget — the corpus-v2 case", () => {
  it("renames source `content` to target `db_content` and fills NULL for missing target columns", () => {
    const srcCols = [
      "id", "name", "key", "codename", "left_id", "right_id",
      "creator_id", "updater_id", "read_rule_class", "read_rule_id",
      "trash", "type_id", "content", "created_at", "updated_at",
    ];
    const srcVals = [
      42, "Atom", "atom", null, null, null,
      1, 1, "*all", 6568, 0, 3, "<p>atom body</p>",
      "2024-01-01 00:00:00", "2024-01-01 00:00:00",
    ];
    const tgtCols = TARGET_TABLE_COLUMNS["cards"];
    const { columns, values, warnings } = mapRowToTarget(
      "cards",
      srcCols,
      srcVals,
      tgtCols,
    );
    expect(columns).toEqual(tgtCols);
    // the source `content` lands in the target `db_content` column
    const dbContentIdx = tgtCols.indexOf("db_content");
    expect(values[dbContentIdx]).toBe("<p>atom body</p>");
    // `current_revision_id` and `references_expired` were not in the
    // source schema; the importer fills them with NULL and emits a warning
    const curRevIdx = tgtCols.indexOf("current_revision_id");
    const refExpIdx = tgtCols.indexOf("references_expired");
    expect(values[curRevIdx]).toBeNull();
    expect(values[refExpIdx]).toBeNull();
    expect(warnings.some((w) => w.includes("current_revision_id"))).toBe(true);
    expect(warnings.some((w) => w.includes("references_expired"))).toBe(true);
  });
});

describe("mapRowToTarget — the mysqldump case", () => {
  it("passes db_content through when the source already calls it db_content", () => {
    const srcCols = [
      "id", "name", "key", "codename", "left_id", "right_id",
      "current_revision_id", "created_at", "updated_at",
      "creator_id", "updater_id", "read_rule_class", "read_rule_id",
      "references_expired", "trash", "type_id", "db_content",
    ];
    const srcVals = [
      1, "Page", "page", null, null, null,
      null, "2024-01-01 00:00:00", "2024-01-01 00:00:00",
      1, 1, "*all", null, null, 0, 2, "page body",
    ];
    const tgtCols = TARGET_TABLE_COLUMNS["cards"];
    const { columns, values, warnings } = mapRowToTarget(
      "cards",
      srcCols,
      srcVals,
      tgtCols,
    );
    expect(columns).toEqual(tgtCols);
    expect(values[tgtCols.indexOf("db_content")]).toBe("page body");
    // nothing dropped, nothing filled with NULL: warnings only mention
    // expected coincidences, no missing/extra columns.
    const dropped = warnings.find((w) => w.includes("dropped"));
    expect(dropped ?? "").not.toContain("db_content");
    const filled = warnings.find((w) => w.includes("filled with NULL"));
    expect(filled ?? "").not.toContain("db_content");
  });
});

describe("getColumnMap", () => {
  it("returns the per-table column map for known tables", () => {
    const cardsMap = getColumnMap("cards")!;
    expect(cardsMap["content"]).toBe("db_content");
    expect(cardsMap["db_content"]).toBe("db_content");
    expect(cardsMap["id"]).toBe("id");
  });

  it("returns undefined for unknown target tables", () => {
    expect(getColumnMap("nope")).toBeUndefined();
  });
});

describe("mapRowToTarget — settings-shaped tables are classified, not mapped", () => {
  it("the settings classifier reports meta / settings / setting without attempting to map them", () => {
    // The classifier and the importer share the same settings list.
    // This is the gate that keeps settings rows out of the decko-ts
    // world (settings are cards in decko).
    expect(SETTINGS_TABLE_VARIANTS).toContain("meta");
    expect(SETTINGS_TABLE_VARIANTS).toContain("settings");
    expect(SETTINGS_TABLE_VARIANTS).toContain("setting");
    expect(SETTINGS_TABLE_VARIANTS).toContain("card_settings");
  });
});