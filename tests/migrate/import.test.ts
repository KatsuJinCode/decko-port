// import.test.ts — the dump-to-SQLite importer against SYNTHETIC fixtures.
//
// Covers the import contract from the M4 deliverable:
//   - id preservation (same ids as source)
//   - trash handling (trash=1 rows import as-is)
//   - junctions as-is (left_id/right_id land untouched; the fetch layer's
//     Lexicon composes names from them at read time)
//   - name/key column rules per src/card/fetch (columns copied as-is; the
//     ONLY repair: a simple card missing its key column gets
//     deriveKey(name) — supplied here by the REAL DeckoName algebra)
//   - unknown-table skip + reporting, checksums, fresh-target guard,
//     per-row error isolation.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LocalSqliteToolDriver,
  importDump,
  parseTargetSchema,
} from "../../tools/migrate/import.mjs";
import { DeckoName } from "../../src/card/name.js";
import {
  dumpFile,
  cardsInsert,
  actsInsert,
  actionsInsert,
  changesInsert,
  referencesInsert,
} from "./synthetic-dump.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DDL_PATH = join(REPO_ROOT, "db", "schema.sqlite.sql");

const dirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "decko-import-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  // best-effort cleanup; Windows may still hold a handle briefly
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // leftover %TEMP% dirs are acceptable
    }
  }
});

function writeDump(dir: string, text: string): string {
  const p = join(dir, "dump.sql");
  writeFileSync(p, text, "utf8");
  return p;
}

const SIMPLE_CARDS = [
  { id: 1, name: "Alpha One", dbContent: "<p>the alpha body</p>" },
  { id: 2, name: "Beta Page", dbContent: "beta 'quoted' body" },
  {
    id: 3,
    name: "Trashed Note",
    trash: 1 as const,
    dbContent: "gone but preserved",
  },
  {
    id: 4,
    name: "Compound Parent+child",
    key: null,
    leftId: 1,
    rightId: 5,
    dbContent: "junction content",
  },
  { id: 5, name: "child" },
  { id: 6, name: "No Key Simple", key: null, dbContent: "needs key repair" },
];

function sampleDump(): string {
  return dumpFile([
    cardsInsert(SIMPLE_CARDS),
    actsInsert([
      { id: 11, cardId: 1, actorId: 1 },
      { id: 12, cardId: 4, actorId: 2, ip: null },
    ]),
    actionsInsert([
      [21, 1, 11, null, 0, 0, "created"],
      [22, 4, 12, null, 0, null, null],
    ]),
    changesInsert([
      [31, 21, 0, "Alpha One"],
      [32, 21, 2, "<p>the alpha body</p>"],
    ]),
    referencesInsert([[41, 4, "child", 5, "I", 1]]),
    "INSERT INTO `some_site_custom_table` VALUES (1,'x'),(2,'y');",
  ]);
}

describe("importDump", () => {
  it("imports ids, trash rows, junctions and history tables as-is", async () => {
    const dir = makeDir();
    const dumpPath = writeDump(dir, sampleDump());
    const driver = new LocalSqliteToolDriver(join(dir, "out.sqlite"));
    const stats = await importDump({ dumpPath, driver, ddlPath: DDL_PATH });

    expect(stats.counts["cards"]).toBe(6);
    expect(stats.counts["card_acts"]).toBe(2);
    expect(stats.counts["card_actions"]).toBe(2);
    expect(stats.counts["card_changes"]).toBe(2);
    expect(stats.counts["card_references"]).toBe(1);
    expect(stats.skippedTables["some_site_custom_table"]).toBe(2);
    expect(stats.errors).toEqual([]);

    // id preservation + trash as-is + junctions as-is
    const rows = await driver.query<CardsRowLike>(
      "SELECT id, name, key, left_id, right_id, trash FROM cards ORDER BY id",
      [],
    );
    expect(rows.rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
    const trashed = rows.rows.find((r) => r.id === 3);
    expect(trashed?.trash).toBe(1);
    const junction = rows.rows.find((r) => r.id === 4);
    expect(junction?.left_id).toBe(1);
    expect(junction?.right_id).toBe(5);
    // post-2020 convention: compound rows carry NULL name/key columns and
    // the importer must not invent values for them
    expect(junction?.name).toBe("Compound Parent+child"); // came from the dump
    expect(junction?.key).toBe(null);

    const history = await driver.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM card_actions WHERE comment = 'created'",
      [],
    );
    expect(history.rows[0]?.n).toBe(1);
    driver.close();
  }, 30000);

  it("repairs a simple card's missing key through the real DeckoName algebra", async () => {
    const dir = makeDir();
    const dumpPath = writeDump(dir, sampleDump());
    const driver = new LocalSqliteToolDriver(join(dir, "out.sqlite"));
    const stats = await importDump({
      dumpPath,
      driver,
      ddlPath: DDL_PATH,
      deriveKey: (name: string) => DeckoName.parse(name).key,
    });
    // card 6 "No Key Simple" (simple: left_id NULL, key NULL) -> repaired
    expect(stats.keyRepair.derived).toBe(1);
    // card 4 (compound with NULL key) must NOT be touched
    const row = await driver.query<{ key: string | null }>(
      "SELECT key FROM cards WHERE id = 6",
      [],
    );
    expect(row.rows[0]?.key).toBe(DeckoName.parse("No Key Simple").key);
    const junction = await driver.query<{ key: string | null }>(
      "SELECT key FROM cards WHERE id = 4",
      [],
    );
    expect(junction.rows[0]?.key).toBe(null);
    driver.close();
  }, 30000);

  it("counts (not guesses) missing keys when no deriver is supplied", async () => {
    const dir = makeDir();
    const dumpPath = writeDump(dir, sampleDump());
    const driver = new LocalSqliteToolDriver(join(dir, "out.sqlite"));
    const stats = await importDump({ dumpPath, driver, ddlPath: DDL_PATH });
    expect(stats.keyRepair.derived).toBe(0);
    expect(stats.keyRepair.nullSimpleKeys).toBe(1);
    driver.close();
  }, 30000);

  it("refuses to import into a populated target", async () => {
    const dir = makeDir();
    const dumpPath = writeDump(dir, sampleDump());
    const dbPath = join(dir, "out.sqlite");
    const driver = new LocalSqliteToolDriver(dbPath);
    await importDump({ dumpPath, driver, ddlPath: DDL_PATH });
    await expect(
      importDump({ dumpPath, driver, ddlPath: DDL_PATH }),
    ).rejects.toThrow(/already contains cards/);
    driver.close();
  }, 30000);

  it("isolates per-row failures and reports them content-free", async () => {
    const dir = makeDir();
    // a duplicate id violates the primary key on the second row
    const dump = dumpFile([
      cardsInsert([
        { id: 1, name: "Dupe A" },
        { id: 1, name: "Dupe B" },
        { id: 2, name: "Dupe C" },
      ]),
    ]);
    const dumpPath = writeDump(dir, dump);
    const driver = new LocalSqliteToolDriver(join(dir, "out.sqlite"));
    const stats = await importDump({
      dumpPath,
      driver,
      ddlPath: DDL_PATH,
      maxErrors: 10,
    });
    expect(stats.errors.length).toBe(1);
    expect(stats.errors[0]?.table).toBe("cards");
    expect(stats.errors[0]?.rowId).toBe(1);
    expect(stats.counts["cards"]).toBe(3); // source-side count still counts
    // the surviving rows are the non-duplicate ones
    const rows = await driver.query<{ id: number }>(
      "SELECT id FROM cards ORDER BY id",
      [],
    );
    expect(rows.rows.map((r) => r.id)).toEqual([1, 2]);
    driver.close();
  }, 30000);

  it("parses column order from the DDL, not a hardcoded copy", () => {
    const schema = parseTargetSchema(DDL_PATH);
    expect(Object.keys(schema.tableColumns).sort()).toEqual([
      "ar_internal_metadata",
      "card_actions",
      "card_acts",
      "card_changes",
      "card_references",
      "card_revisions",
      "card_virtuals",
      "cards",
      "delayed_jobs",
      "schema_migrations",
      "sessions",
      "transform_migrations",
    ]);
    expect(schema.tableColumns["cards"]).toEqual([
      "id", "name", "key", "codename", "left_id", "right_id",
      "current_revision_id", "created_at", "updated_at", "creator_id",
      "updater_id", "read_rule_class", "read_rule_id", "references_expired",
      "trash", "type_id", "db_content",
    ]);
    expect(schema.createIndexes.length).toBeGreaterThan(10);
  });

  it("produces verifiable source checksums over the target", async () => {
    const dir = makeDir();
    const dumpPath = writeDump(dir, sampleDump());
    const driver = new LocalSqliteToolDriver(join(dir, "out.sqlite"));
    const stats = await importDump({ dumpPath, driver, ddlPath: DDL_PATH });
    const report = JSON.stringify(stats.checksums);
    expect(report.length).toBeGreaterThan(2);
    // (the verify stream checks these against the target tables directly)
    driver.close();
    // content-free checksum JSON guard: no card content strings
    expect(report).not.toContain("the alpha body");
  }, 30000);
});

interface CardsRowLike {
  id: number;
  name: string | null;
  key: string | null;
  left_id: number | null;
  right_id: number | null;
  trash: number;
}

void readFileSync;
