// roundtrip-report.test.ts — counts-per-table in vs out for the
// generalized migration tool.
//
// Asserts the shape of the round-trip report (one row per source AND
// per target table; never content; settings rows visible as settings).

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  buildRoundtripReport,
  renderRoundtripMd,
} from "../../../tools/migrate/roundtrip-report.mjs";

const TARGET_TABLES = [
  "cards", "card_acts", "card_actions", "card_changes",
  "card_references", "card_revisions", "card_virtuals",
  "delayed_jobs", "sessions", "schema_migrations",
  "ar_internal_metadata", "transform_migrations",
];

function makeSourceDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "decko-rt-"));
  const path = join(dir, "src.sqlite");
  const db = new Database(path);
  db.exec(`CREATE TABLE cards (id INTEGER PRIMARY KEY, name TEXT, content TEXT)`);
  for (let i = 1; i <= 5; i++) db.exec(`INSERT INTO cards (id, name, content) VALUES (${i}, 'n${i}', 'b${i}')`);
  db.exec(`CREATE TABLE card_references (id INTEGER PRIMARY KEY, referer_id INTEGER)`);
  for (let i = 1; i <= 3; i++) db.exec(`INSERT INTO card_references (id, referer_id) VALUES (${i}, ${i})`);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`);
  db.exec(`INSERT INTO meta (key, value) VALUES ('build', 'synth')`);
  db.exec(`CREATE TABLE unknown_legacy (foo TEXT)`);
  db.exec(`INSERT INTO unknown_legacy (foo) VALUES ('x'),('y')`);
  db.close();
  return path;
}

describe("buildRoundtripReport", () => {
  it("emits one row per source table AND one row per target-only table", () => {
    const path = makeSourceDb();
    const db = new Database(path, { readonly: true });
    try {
      // simulate the import's outcome: cards and card_references landed;
      // meta is settings (not imported); unknown_legacy is unknown
      // (not imported); the other target tables are target-only.
      const targetCounts = {
        cards: 5,
        card_references: 3,
        card_acts: 0,
        card_actions: 0,
        card_changes: 0,
        card_revisions: 0,
        card_virtuals: 0,
        delayed_jobs: 0,
        sessions: 0,
        schema_migrations: 0,
        ar_internal_metadata: 0,
        transform_migrations: 0,
      };
      const report = buildRoundtripReport({
        sourceDb: db,
        sourcePath: path,
        targetCounts,
        targetTableNames: TARGET_TABLES,
      });
      // expected rows: 4 source tables + 10 target-only = 14
      expect(report.rows.length).toBe(4 + 10);
      // cards: imported (5/5, delta 0)
      const cardsRow = report.rows.find((r) => r.sourceTable === "cards");
      expect(cardsRow?.target).toBe(5);
      expect(cardsRow?.delta).toBe(0);
      expect(cardsRow?.map).toBe("core");
      // meta: settings (1 row, not imported)
      const metaRow = report.rows.find((r) => r.sourceTable === "meta");
      expect(metaRow?.map).toBe("settings");
      expect(metaRow?.target).toBe(0);
      expect(metaRow?.delta).toBe(1);
      // unknown_legacy: unknown (2 rows, not imported)
      const unkRow = report.rows.find((r) => r.sourceTable === "unknown_legacy");
      expect(unkRow?.map).toBe("unknown");
      expect(unkRow?.target).toBe(0);
      expect(unkRow?.delta).toBe(2);
      // totals
      expect(report.totals.source).toBe(5 + 3 + 1 + 2);
      expect(report.totals.target).toBe(5 + 3);
      expect(report.dropCount).toBe(2);
      expect(report.unknownTables).toContain("unknown_legacy");
    } finally {
      db.close();
    }
  });
});

describe("renderRoundtripMd", () => {
  it("produces a markdown table that does NOT include any row content", () => {
    const path = makeSourceDb();
    const db = new Database(path, { readonly: true });
    try {
      const targetCounts = { cards: 5, card_references: 3 } as Record<string, number>;
      for (const t of TARGET_TABLES) if (!(t in targetCounts)) targetCounts[t] = 0;
      const report = buildRoundtripReport({
        sourceDb: db,
        sourcePath: path,
        targetCounts,
        targetTableNames: TARGET_TABLES,
      });
      const md = renderRoundtripMd(report);
      expect(md).toMatch(/Round-trip report/);
      expect(md).toMatch(/cards/);
      // content-rule: card content strings do not appear in the markdown
      expect(md).not.toContain("n1");
      expect(md).not.toContain("b1");
      // content-rule: settings VALUES do not appear (only the table name `meta`)
      expect(md).not.toContain("synth");
    } finally {
      db.close();
    }
  });
});