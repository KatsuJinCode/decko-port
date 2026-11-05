// name-reconstruct.test.ts — the name-reconstruction ladder for junction
// cards with NULL name/key columns. All inputs are SYNTHETIC.

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { LocalSqliteToolDriver } from "../../../tools/migrate/import.mjs";
import {
  reconstructCardName,
  countNullNameJunctions,
} from "../../../tools/migrate/name-reconstruct.mjs";

function makeTargetDb(): { path: string; driver: InstanceType<typeof LocalSqliteToolDriver> } {
  const dir = mkdtempSync(join(tmpdir(), "decko-name-recon-"));
  const path = join(dir, "target.sqlite");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY, name TEXT, key TEXT,
      left_id INTEGER, right_id INTEGER, trash INTEGER
    )
  `);
  // simple cards (left_id NULL) with non-null names
  db.exec(`INSERT INTO cards (id, name, key, left_id, right_id, trash) VALUES (1, 'Alpha', 'alpha', NULL, NULL, 0)`);
  db.exec(`INSERT INTO cards (id, name, key, left_id, right_id, trash) VALUES (2, 'Beta',  'beta',  NULL, NULL, 0)`);
  db.exec(`INSERT INTO cards (id, name, key, left_id, right_id, trash) VALUES (3, 'child', 'child', NULL, NULL, 0)`);
  // junction card whose name/key columns ARE present (corpus-v2 shape)
  db.exec(`INSERT INTO cards (id, name, key, left_id, right_id, trash) VALUES (10, 'Alpha+child', 'alpha+child', 1, 3, 0)`);
  // junction card with NULL name/key (the fallback case)
  db.exec(`INSERT INTO cards (id, name, key, left_id, right_id, trash) VALUES (11, NULL, NULL, 2, 3, 0)`);
  db.close();
  const driver = new LocalSqliteToolDriver(path);
  return { path, driver };
}

describe("reconstructCardName — fallback ladder", () => {
  it("fallback 1: in-column non-null name returns it via 'in-column'", async () => {
    const { driver } = makeTargetDb();
    try {
      const r = await reconstructCardName({
        sourceName: "Alpha",
        sourceKey: "alpha",
        leftId: null,
        rightId: null,
        driver,
      });
      expect(r.name).toBe("Alpha");
      expect(r.via).toBe("in-column");
      expect(r.resolved).toBe(true);
    } finally {
      driver.close();
    }
  });

  it("fallback 2: NULL name with junction sides returns the walk-composed name", async () => {
    const { driver } = makeTargetDb();
    try {
      const r = await reconstructCardName({
        sourceName: null,
        sourceKey: null,
        leftId: 2, // Beta
        rightId: 3, // child
        driver,
      });
      expect(r.name).toBe("Beta+child");
      expect(r.via).toBe("lexicon");
      expect(r.resolved).toBe(true);
    } finally {
      driver.close();
    }
  });

  it("returns 'unresolved' when one side of the junction is missing from the target", async () => {
    const { driver } = makeTargetDb();
    try {
      const r = await reconstructCardName({
        sourceName: null,
        sourceKey: null,
        leftId: 99999, // nonexistent
        rightId: 3,
        driver,
      });
      expect(r.resolved).toBe(false);
      expect(r.via).toBe("unresolved");
    } finally {
      driver.close();
    }
  });

  it("returns 'unresolved' when both name and junction are absent", async () => {
    const { driver } = makeTargetDb();
    try {
      const r = await reconstructCardName({
        sourceName: null,
        sourceKey: null,
        leftId: null,
        rightId: null,
        driver,
      });
      expect(r.resolved).toBe(false);
      expect(r.via).toBe("unresolved");
    } finally {
      driver.close();
    }
  });
});

describe("countNullNameJunctions", () => {
  it("counts junction rows whose name column is NULL or empty", async () => {
    const { driver } = makeTargetDb();
    try {
      const n = await countNullNameJunctions(driver);
      // only id=11 is junction with NULL/empty name
      expect(n).toBe(1);
    } finally {
      driver.close();
    }
  });
});