// source-sqlite.test.ts — the source-side SQLite reader (the generalized
// migration tool's input layer). All inputs are SYNTHETIC databases
// built in-test; zero real content.

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  openSourceSqlite,
  inventorySource,
  sourceTableRows,
} from "../../../tools/migrate/source-sqlite.mjs";

function makeDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "decko-source-sqlite-"));
  const path = join(dir, "src.sqlite");
  const db = new Database(path);
  db.exec(`CREATE TABLE cards (id INTEGER PRIMARY KEY, name TEXT, key TEXT, content TEXT, type_id INTEGER)`);
  db.exec(`CREATE TABLE card_references (id INTEGER PRIMARY KEY, referer_id INTEGER, referee_id INTEGER)`);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`);
  // populate
  const ins = db.prepare("INSERT INTO cards (id, name, key, content, type_id) VALUES (?, ?, ?, ?, ?)");
  ins.run(1, "Alpha", "alpha", "alpha body", 3);
  ins.run(2, "Beta", "beta", "beta body", 3);
  ins.run(3, "Compound A+B", null, "compound body", 3);
  ins.run(4, "Gamma", "gamma", null, 5);
  db.exec(`INSERT INTO card_references (id, referer_id, referee_id) VALUES (1, 1, 2)`);
  db.exec(`INSERT INTO card_references (id, referer_id, referee_id) VALUES (2, 1, 3)`);
  db.exec(`INSERT INTO meta (key, value) VALUES ('version', '1')`);
  db.close();
  return path;
}

describe("openSourceSqlite + inventorySource", () => {
  it("opens a SQLite file read-only and lists every table with columns + row counts", () => {
    const path = makeDb();
    const db = openSourceSqlite(path);
    try {
      const inv = inventorySource(db);
      expect(Object.keys(inv).sort()).toEqual(["card_references", "cards", "meta"]);
      expect(inv["cards"].rowCount).toBe(4);
      expect(inv["cards"].columns).toEqual(["id", "name", "key", "content", "type_id"]);
      expect(inv["cards"].columnTypes["name"]).toMatch(/TEXT|CHAR/i);
      expect(inv["card_references"].rowCount).toBe(2);
      expect(inv["meta"].rowCount).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("sourceTableRows", () => {
  it("yields every row of one table as { table, values, columns }", async () => {
    const path = makeDb();
    const db = openSourceSqlite(path);
    try {
      const out: Array<{ table: string; values: unknown[]; columns: string[] }> = [];
      for await (const row of sourceTableRows(db, "cards")) {
        out.push(row);
      }
      expect(out.length).toBe(4);
      expect(out[0]?.table).toBe("cards");
      expect(out[0]?.columns).toEqual(["id", "name", "key", "content", "type_id"]);
      expect(out[0]?.values[0]).toBe(1);
      expect(out[0]?.values[1]).toBe("Alpha");
      expect(out[0]?.values[2]).toBe("alpha");
      // the compound card (id=3) carries a NULL key column
      expect(out[2]?.values[0]).toBe(3);
      expect(out[2]?.values[2]).toBeNull();
    } finally {
      db.close();
    }
  });

  it("uses keyset pagination so memory is bounded for large tables", async () => {
    const path = makeDb();
    const db = openSourceSqlite(path);
    try {
      const out: unknown[] = [];
      for await (const row of sourceTableRows(db, "cards", { chunkRows: 2 })) {
        out.push(row);
      }
      expect(out.length).toBe(4);
    } finally {
      db.close();
    }
  });

  it("yields zero rows for an empty table", async () => {
    const dir = mkdtempSync(join(tmpdir(), "decko-source-empty-"));
    const path = join(dir, "empty.sqlite");
    const db = new Database(path);
    db.exec(`CREATE TABLE empty (id INTEGER PRIMARY KEY)`);
    db.close();
    const src = openSourceSqlite(path);
    try {
      const out: unknown[] = [];
      for await (const row of sourceTableRows(src, "empty")) {
        out.push(row);
      }
      expect(out.length).toBe(0);
    } finally {
      src.close();
    }
  });
});