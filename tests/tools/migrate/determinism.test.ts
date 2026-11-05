// determinism.test.ts — the determinism proof (import twice, prove
// byte-identical output via per-row hashes).
//
// Asserts the contract: same source + same importer = same target.
// Uses synthetic databases built in-test (DATA RULE: zero real content).

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { hashTable, proveDeterminism } from "../../../tools/migrate/determinism.mjs";
import { LocalSqliteToolDriver } from "../../../tools/migrate/import.mjs";
import { importFromSqlite } from "../../../tools/migrate/generalized-import.mjs";

function makeSourceDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "decko-det-src-"));
  const path = join(dir, "src.sqlite");
  const db = new Database(path);
  db.exec(`CREATE TABLE cards (id INTEGER PRIMARY KEY, name TEXT, key TEXT, content TEXT, type_id INTEGER, trash INTEGER, left_id INTEGER, right_id INTEGER, creator_id INTEGER, updater_id INTEGER, created_at TEXT, updated_at TEXT)`);
  for (let i = 1; i <= 50; i++) {
    db.exec(
      `INSERT INTO cards (id, name, key, content, type_id, trash, left_id, right_id, creator_id, updater_id, created_at, updated_at) VALUES (${i}, 'n${i}', 'k${i}', 'body${i}', 3, 0, NULL, NULL, 1, 1, '2024-01-01', '2024-01-01')`,
    );
  }
  db.exec(`CREATE TABLE card_references (id INTEGER PRIMARY KEY, referer_id INTEGER, referee_id INTEGER, ref_type TEXT)`);
  for (let i = 1; i <= 20; i++) {
    db.exec(`INSERT INTO card_references (id, referer_id, referee_id, ref_type) VALUES (${i}, ${i}, ${i + 1}, 'L')`);
  }
  db.close();
  return path;
}

const REPO_ROOT = mkdtempSync(join(tmpdir(), "decko-det-repo-"));
const DDL_PATH = process.env.DECKO_MIGRATE_DDL ?? "C:/localProjects/decko-ts/db/schema.sqlite.sql";

describe("hashTable", () => {
  it("produces a deterministic per-row hash and a single total hash", () => {
    const dir = mkdtempSync(join(tmpdir(), "decko-det-ht-"));
    const path = join(dir, "db.sqlite");
    const db = new Database(path);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, n INTEGER)`);
    db.exec(`INSERT INTO t (id, name, n) VALUES (1, 'a', 10), (2, 'b', 20), (3, 'c', 30)`);
    db.close();
    const src = new Database(path, { readonly: true });
    try {
      const a = hashTable(src, "t");
      const b = hashTable(src, "t");
      expect(a.ids).toEqual([1, 2, 3]);
      expect(a.totalHash).toBe(b.totalHash);
      expect(a.totalHash.length).toBeGreaterThan(20);
    } finally {
      src.close();
    }
  });
});

describe("proveDeterminism", () => {
  it("two imports of the same source produce byte-identical target rows", async () => {
    const srcPath = makeSourceDb();
    const freshA = join(REPO_ROOT, `det-A-${Date.now()}.sqlite`);
    const freshB = join(REPO_ROOT, `det-B-${Date.now()}.sqlite`);
    try {
      const result = await proveDeterminism({
        importFn: ({ driver, ddlPath }) =>
          importFromSqlite({
            sourcePath: srcPath,
            driver,
            ddlPath,
            batchSize: 100,
          }),
        ddlPath: DDL_PATH,
        freshPathA: freshA,
        freshPathB: freshB,
        tableList: ["cards", "card_references"],
      });
      expect(result.allTablesDeterministic).toBe(true);
      expect(result.tables["cards"]?.countA).toBe(50);
      expect(result.tables["cards"]?.countB).toBe(50);
      expect(result.tables["cards"]?.idsMatch).toBe(true);
      expect(result.tables["cards"]?.hashesMatch).toBe(true);
      expect(result.tables["cards"]?.totalHashA).toBe(
        result.tables["cards"]?.totalHashB,
      );
      expect(result.tables["card_references"]?.countA).toBe(20);
      expect(result.tables["card_references"]?.hashesMatch).toBe(true);
    } finally {
      // best-effort cleanup (no rm: leave the temp dirs; they are OS-managed)
      void LocalSqliteToolDriver;
    }
  }, 120_000);
});