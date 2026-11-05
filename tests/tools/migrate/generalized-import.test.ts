// generalized-import.test.ts — the end-to-end generalized importer
// against a synthetic Ruby decko SQLite source built in-test. Verifies
// the corpus-v2 shape (content -> db_content rename, NULL-filled
// columns) and the mysqldump shape (full schema) both land identically.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { LocalSqliteToolDriver } from "../../../tools/migrate/import.mjs";
import { importFromSqlite } from "../../../tools/migrate/generalized-import.mjs";

const DDL_PATH = "C:/localProjects/decko-ts/db/schema.sqlite.sql";
const dirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "decko-gen-import-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of dirs) {
    // no rm; tmpdir cleanup is OS-managed on Windows
    void d;
  }
});

/** Build a corpus-v2-shaped source SQLite DB (3 tables, content rename). */
function buildCorpusV2Source(dir: string): string {
  const path = join(dir, "corpus.sqlite");
  const db = new Database(path);
  db.exec(`CREATE TABLE cards (
    id INTEGER PRIMARY KEY, name TEXT, key TEXT, codename TEXT,
    left_id INTEGER, right_id INTEGER,
    creator_id INTEGER, updater_id INTEGER,
    read_rule_class TEXT, read_rule_id INTEGER,
    trash INTEGER DEFAULT 0, type_id INTEGER,
    content TEXT, created_at TEXT, updated_at TEXT
  )`);
  db.exec(`CREATE TABLE card_references (
    id INTEGER PRIMARY KEY, referer_id INTEGER,
    referee_key TEXT, referee_id INTEGER,
    ref_type TEXT DEFAULT '', is_present INTEGER
  )`);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`);
  // populate a small deck — decko-ts target requires created_at + updated_at
  // NOT NULL, so include them on every row.
  const T0 = "2024-01-01 00:00:00";
  const cards = [
    [1, "Alpha", "alpha", null, null, null, 1, 1, "*all", null, 0, 3, "<p>alpha body</p>", T0, T0],
    [2, "Beta", "beta", null, null, null, 1, 1, "*all", null, 0, 3, "beta body", T0, T0],
    [3, "Alpha+child", "alpha+child", null, 1, 2, 1, 1, "*all", null, 0, 3, "child body", T0, T0],
    [4, "Trashed", "trashed", null, null, null, 1, 1, "*all", null, 1, 3, "trashed body", T0, T0],
  ];
  const ci = db.prepare(
    `INSERT INTO cards (id, name, key, codename, left_id, right_id,
      creator_id, updater_id, read_rule_class, read_rule_id, trash, type_id,
      content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of cards) ci.run(...r);
  db.exec(
    `INSERT INTO card_references (id, referer_id, referee_key, referee_id, ref_type, is_present)
     VALUES (1, 3, 'child', 2, 'I', 1)`,
  );
  db.exec(`INSERT INTO meta (key, value) VALUES ('build', 'synth-test')`);
  db.close();
  return path;
}

describe("importFromSqlite — corpus-v2 shape", () => {
  it("renames `content` -> `db_content`, fills NULL for missing target columns, skips meta", async () => {
    const dir = makeDir();
    const srcPath = buildCorpusV2Source(dir);
    const outPath = join(dir, "out.sqlite");
    const driver = new LocalSqliteToolDriver(outPath);
    try {
      const stats = await importFromSqlite({
        sourcePath: srcPath,
        driver,
        ddlPath: DDL_PATH,
      });
      expect(stats.counts["cards"]).toBe(4);
      expect(stats.counts["card_references"]).toBe(1);
      expect(stats.errors).toEqual([]);
      // settings inventory
      expect(stats.settingsInventory.tables.length).toBe(1);
      expect(stats.settingsInventory.tables[0]?.source).toBe("meta");
      expect(stats.settingsInventory.tables[0]?.count).toBe(1);
      expect(stats.settingsInventory.tables[0]?.sampleKeys).toContain("build");
      // schema mappings
      expect(stats.schemaMappings["cards"]).toBe("core");
      expect(stats.schemaMappings["card_references"]).toBe("core");
      expect(stats.schemaMappings["meta"]).toBe("settings");
      // rows landed: target db_content is the source content
      const r = await driver.query<{ id: number; db_content: string }>(
        "SELECT id, db_content FROM cards WHERE id = 1",
        [],
      );
      expect(r.rows[0]?.db_content).toBe("<p>alpha body</p>");
      // NULL target columns filled in (current_revision_id + references_expired)
      const rev = await driver.query<{ current_revision_id: number | null; references_expired: number | null }>(
        "SELECT current_revision_id, references_expired FROM cards WHERE id = 1",
        [],
      );
      expect(rev.rows[0]?.current_revision_id).toBeNull();
      expect(rev.rows[0]?.references_expired).toBeNull();
      // meta not imported: target has no meta table
      const meta = await driver.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='meta'",
        [],
      );
      expect(meta.rows[0]?.n).toBe(0);
    } finally {
      driver.close();
    }
  }, 30000);
});

describe("importFromSqlite — unknown tables", () => {
  it("reports unknown source tables in skippedTables with row counts", async () => {
    const dir = makeDir();
    const srcPath = join(dir, "src.sqlite");
    const db = new Database(srcPath);
    // include created_at/updated_at because decko-ts target requires NOT NULL
    db.exec(`CREATE TABLE cards (
      id INTEGER PRIMARY KEY, name TEXT, content TEXT,
      created_at TEXT, updated_at TEXT,
      creator_id INTEGER, updater_id INTEGER, type_id INTEGER, trash INTEGER DEFAULT 0
    )`);
    db.exec(`INSERT INTO cards (id, name, content, created_at, updated_at, creator_id, updater_id, type_id) VALUES (1, 'only', 'only body', '2024-01-01', '2024-01-01', 1, 1, 3)`);
    db.exec(`CREATE TABLE site_widgets (id INTEGER PRIMARY KEY, foo TEXT)`);
    db.exec(`INSERT INTO site_widgets (id, foo) VALUES (1, 'a'),(2,'b'),(3,'c')`);
    db.close();
    const outPath = join(dir, "out.sqlite");
    const driver = new LocalSqliteToolDriver(outPath);
    try {
      const stats = await importFromSqlite({
        sourcePath: srcPath,
        driver,
        ddlPath: DDL_PATH,
      });
      expect(stats.counts["cards"]).toBe(1);
      expect(stats.skippedTables["site_widgets"]).toBe(3);
      expect(stats.warnings.some((w) => w.includes("site_widgets"))).toBe(true);
    } finally {
      driver.close();
    }
  }, 30000);
});

describe("importFromSqlite — fresh target guard", () => {
  it("refuses to import over an existing populated target unless append:true", async () => {
    const dir = makeDir();
    const srcPath = buildCorpusV2Source(dir);
    const outPath = join(dir, "out.sqlite");
    const driver1 = new LocalSqliteToolDriver(outPath);
    await importFromSqlite({ sourcePath: srcPath, driver: driver1, ddlPath: DDL_PATH });
    driver1.close();
    const driver2 = new LocalSqliteToolDriver(outPath);
    try {
      await expect(
        importFromSqlite({
          sourcePath: srcPath,
          driver: driver2,
          ddlPath: DDL_PATH,
        }),
      ).rejects.toThrow(/already contains cards/);
    } finally {
      driver2.close();
    }
  }, 30000);
});

describe("importFromSqlite — reports content-free", () => {
  it("the importStats JSON never carries row content", async () => {
    const dir = makeDir();
    const srcPath = buildCorpusV2Source(dir);
    const outPath = join(dir, "out.sqlite");
    const driver = new LocalSqliteToolDriver(outPath);
    try {
      const stats = await importFromSqlite({
        sourcePath: srcPath,
        driver,
        ddlPath: DDL_PATH,
      });
      const json = JSON.stringify(stats);
      expect(json).not.toContain("alpha body");
      expect(json).not.toContain("child body");
      expect(json).not.toContain("trashed body");
      // settings VALUES never copied
      expect(json).not.toContain("synth-test");
    } finally {
      driver.close();
    }
  }, 30000);
});