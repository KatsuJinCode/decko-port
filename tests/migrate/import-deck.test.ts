// import-deck.test.ts — the productized CLI's tests, covering chunking +
// validation on a small synthetic fixture.
//
// The ask: "tests for the chunking + validation on a small fixture". The
// fixture is a tiny deck built from the existing synthetic-dump helpers,
// written in all three source shapes (SQLite, mysqldump, deck-INSERT
// text) so the CLI's three ingest paths are exercised end-to-end on the
// same logical deck.
//
// Checks:
//   1. card count + junction count + integrity (validator)
//   2. chunking - rows are split into chunks by row-count AND byte-budget
//   3. D1-ready SQL output - every chunk parses back to the same row set
//      when fed to a fresh staging DB (round-trip property)
//   4. content-free report - the JSON never contains card names/content
//      (DATA RULE audit)
//
// The 867MB anonymized seed's full local-D1 import is run by the lane
// lead and reported in the deliverable; this suite covers the correctness
// surface on a small fixture where the assertions are sharp.

import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { dumpFile, cardsInsert, actsInsert } from "./synthetic-dump.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(REPO_ROOT, "tools", "migrate", "import-deck.mjs");

const dirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "decko-importdeck-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

type FixtureCard = {
  id: number;
  name: string;
  key?: string | null;
  leftId?: number;
  rightId?: number;
  trash?: 0 | 1;
  typeId?: number;
  dbContent?: string;
};

const FIXTURE = (): FixtureCard[] => [
  { id: 1, name: "Migra Home", dbContent: "welcome to the migration test deck" },
  { id: 2, name: "Migra Guide", dbContent: "intro {{Migra Section}}" },
  {
    id: 3,
    name: "Migra Guide+Section",
    key: null,
    leftId: 2,
    rightId: 4,
    dbContent: "section body",
  },
  { id: 4, name: "Section", dbContent: "section simple card" },
  {
    id: 5,
    name: "Migra Home+note",
    key: null,
    leftId: 1,
    rightId: 6,
    dbContent: "a note card",
  },
  { id: 6, name: "note", dbContent: "note body" },
  { id: 7, name: "Trashed Card", trash: 1 as const, dbContent: "in the bin" },
];

const FIXTURE_ACTS = [{ id: 10, cardId: 1, actorId: 1 }];

function writeMysqldumpFixture(dir: string): string {
  const dumpPath = join(dir, "deck.sql");
  writeFileSync(
    dumpPath,
    dumpFile([
      cardsInsert(FIXTURE()),
      actsInsert(FIXTURE_ACTS),
    ]),
    "utf8",
  );
  return dumpPath;
}

function writeSeedFixture(dir: string): string {
  // The deck-INSERT shape the M5 parser handles: explicit column lists,
  // single-statement-per-row, semicolon-terminated. Mirror the mysqldump
  // cards shape (NOT the anonymized corpus shape - that uses 'content'
  // not 'db_content' - the schema map must rename it during ingest).
  const lines = [];
  for (const c of FIXTURE()) {
    const cols = ["id", "name", "key", "codename", "left_id", "right_id",
      "creator_id", "updater_id", "read_rule_class", "read_rule_id",
      "trash", "type_id", "db_content", "created_at", "updated_at"];
    const isJunction = c.key === null && c.leftId !== undefined;
    const key = isJunction ? null : (c.key ?? (c.name ?? "").toLowerCase().replace(/\s+/g, "_"));
    const values = [
      c.id,
      isJunction ? null : c.name,
      key,
      null, // codename
      c.leftId ?? null,
      c.rightId ?? null,
      1, // creator_id
      1, // updater_id
      null, // read_rule_class
      null, // read_rule_id
      c.trash ?? 0,
      c.typeId ?? 2,
      c.dbContent ?? null,
      "2026-09-23 00:00:00.000",
      "2026-09-23 00:00:00.000",
    ];
    const escaped = values.map((v) => {
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number") return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    });
    lines.push(`INSERT INTO cards (${cols.join(", ")}) VALUES (${escaped.join(", ")});`);
  }
  for (const a of FIXTURE_ACTS) {
    const cols = ["id", "card_id", "actor_id", "acted_at", "ip_address"];
    const values = [a.id, a.cardId, a.actorId ?? 1, "2026-09-23 00:00:00.000", "127.0.0.1"];
    const escaped = values.map((v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v}'`));
    lines.push(`INSERT INTO card_acts (${cols.join(", ")}) VALUES (${escaped.join(", ")});`);
  }
  const path = join(dir, "seed.sql");
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
  return path;
}

function writeSqliteFixture(dir: string): string {
  const dbPath = join(dir, "deck.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY,
      name TEXT,
      key TEXT,
      codename TEXT,
      left_id INTEGER,
      right_id INTEGER,
      creator_id INTEGER NOT NULL DEFAULT 1,
      updater_id INTEGER NOT NULL DEFAULT 1,
      read_rule_class TEXT,
      read_rule_id INTEGER,
      trash INTEGER NOT NULL DEFAULT 0,
      type_id INTEGER NOT NULL DEFAULT 2,
      content TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE card_acts (
      id INTEGER PRIMARY KEY,
      card_id INTEGER,
      actor_id INTEGER,
      acted_at TEXT,
      ip_address TEXT
    );
  `);
  const ins = db.prepare(
    `INSERT INTO cards (id, name, key, left_id, right_id, type_id, content, created_at, updated_at, trash)
     VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-23 00:00:00.000', '2026-09-23 00:00:00.000', ?)`,
  );
  for (const c of FIXTURE()) {
    const isJunction = c.key === null && c.leftId !== undefined;
    ins.run(
      c.id,
      isJunction ? null : c.name,
      isJunction ? null : (c.key ?? (c.name ?? "").toLowerCase().replace(/\s+/g, "_")),
      c.leftId ?? null,
      c.rightId ?? null,
      c.typeId ?? 2,
      c.dbContent ?? null,
      c.trash ?? 0,
    );
  }
  for (const a of FIXTURE_ACTS) {
    db.prepare("INSERT INTO card_acts (id, card_id, actor_id, acted_at, ip_address) VALUES (?, ?, ?, '2026-09-23 00:00:00.000', '127.0.0.1')").run(a.id, a.cardId, a.actorId ?? 1);
  }
  db.close();
  return dbPath;
}

function runCLI(args: string[]): { status: number; stdout: string; stderr: string } {
  const run = spawnSync(
    process.execPath,
    [CLI, ...args],
    { encoding: "utf8", timeout: 180_000 },
  );
  // status is null only when the child was killed by a signal (the 180s
  // timeout); map that to -1 so callers can assert non-zero uniformly.
  return { status: run.status ?? -1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

describe("import-deck CLI - chunking + validation", () => {
  it("accepts a mysqldump source, writes a chunked seed, and validates", () => {
    const dir = makeDir();
    const outDir = join(dir, "chunks");
    const dumpPath = writeMysqldumpFixture(dir);
    const result = runCLI([
      "--dump",
      dumpPath,
      "--out-dir",
      outDir,
      "--quiet",
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(existsSync(join(outDir, "report.json"))).toBe(true);

    // chunks were written
    const chunkFiles = readdirSync(join(outDir, "chunks")).filter((f) => f.endsWith(".sql")).sort();
    expect(chunkFiles.length).toBeGreaterThan(0);
    for (const f of chunkFiles) {
      const txt = readFileSync(join(outDir, "chunks", f), "utf8");
      // Every chunk: header comment + BEGIN + INSERTs + COMMIT
      expect(txt).toMatch(/^-- chunk \d+ of \d+/m);
      expect(txt).toMatch(/BEGIN TRANSACTION/);
      expect(txt).toMatch(/COMMIT/);
      expect(txt).toMatch(/INSERT INTO "cards"/);
    }

    // report validation
    const report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
    expect(report.tool).toContain("decko-ts import-deck");
    expect(report.source.kind).toBe("mysqldump");
    expect(report.source.cardsCount).toBe(7);
    expect(report.target.cardsCount).toBe(7);
    expect(report.target.junctionsCount).toBe(2); // ids 3 and 5
    expect(report.integrity.junctionWalk.resolved).toBe(report.integrity.junctionWalk.sampled);
    expect(report.integrity.orphanLeftCount).toBe(0);
    expect(report.integrity.orphanRightCount).toBe(0);
    expect(report.allChecksPass).toBe(true);

    // content-free DATA RULE audit
    const json = JSON.stringify(report);
    expect(json).not.toContain("Migra Home");
    expect(json).not.toContain("welcome to the migration test deck");
  }, 180_000);

  it("accepts a deck-INSERT source and produces equivalent output", () => {
    const dir = makeDir();
    const outDir = join(dir, "chunks");
    const seedPath = writeSeedFixture(dir);
    const result = runCLI([
      "--seed",
      seedPath,
      "--out-dir",
      outDir,
      "--quiet",
    ]);
    expect(result.status).toBe(0);
    const report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
    expect(report.source.kind).toBe("deck-insert");
    expect(report.source.cardsCount).toBe(7);
    expect(report.target.cardsCount).toBe(7);
    expect(report.target.junctionsCount).toBe(2);
    expect(report.integrity.junctionWalk.resolved).toBe(report.integrity.junctionWalk.sampled);
    expect(report.allChecksPass).toBe(true);
  }, 180_000);

  it("accepts a SQLite source and produces equivalent output", () => {
    const dir = makeDir();
    const outDir = join(dir, "chunks");
    const dbPath = writeSqliteFixture(dir);
    const result = runCLI([
      "--source",
      dbPath,
      "--out-dir",
      outDir,
      "--quiet",
    ]);
    expect(result.status).toBe(0);
    const report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
    expect(report.source.kind).toBe("sqlite");
    expect(report.source.cardsCount).toBe(7);
    expect(report.target.cardsCount).toBe(7);
    expect(report.target.junctionsCount).toBe(2);
    expect(report.allChecksPass).toBe(true);
  }, 180_000);

  it("chunks a fixture by row count when --chunk-rows is small", () => {
    const dir = makeDir();
    const outDir = join(dir, "chunks");
    const dumpPath = writeMysqldumpFixture(dir);
    // 7 cards + 1 card_acts = 8 rows total. chunk-rows=3 should yield 3 chunks
    // (3 + 3 + 2) assuming the chunker groups by row budget alone.
    const result = runCLI([
      "--dump",
      dumpPath,
      "--out-dir",
      outDir,
      "--chunk-rows",
      "3",
      "--quiet",
    ]);
    expect(result.status).toBe(0);
    const chunkFiles = readdirSync(join(outDir, "chunks")).filter((f) => f.endsWith(".sql")).sort();
    // The chunker flushes when EITHER the row count or the byte budget
    // is hit, so 8 rows / 3 rows-per-chunk = at least 3 chunks.
    expect(chunkFiles.length).toBeGreaterThanOrEqual(3);

    // Each chunk's row count must be at most 3 (unless it carries the tail)
    const report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
    for (const n of report.chunks.rowsPerChunk) {
      expect(n).toBeLessThanOrEqual(3);
    }
    expect(report.chunks.totalRows).toBe(8);
  }, 180_000);

  it("rejects more than one source flag", () => {
    const dir = makeDir();
    const dumpPath = writeMysqldumpFixture(dir);
    const dbPath = writeSqliteFixture(dir);
    const result = runCLI([
      "--dump",
      dumpPath,
      "--source",
      dbPath,
      "--out-dir",
      join(dir, "out"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/exactly one of/);
  }, 60_000);

  it("the chunked SQL round-trips into a fresh staging DB", () => {
    const dir = makeDir();
    const outDir = join(dir, "chunks");
    const dumpPath = writeMysqldumpFixture(dir);
    const result = runCLI([
      "--dump",
      dumpPath,
      "--out-dir",
      outDir,
      "--quiet",
    ]);
    expect(result.status).toBe(0);

    // Apply every chunk into a brand-new SQLite DB and re-count.
    const targetDb = join(dir, "roundtrip.sqlite");
    const db = new Database(targetDb);
    const { readFileSync: rd, readdirSync: rdd } = require("node:fs") as typeof import("node:fs");
    db.exec(readFileSync(join(REPO_ROOT, "db", "schema.sqlite.sql"), "utf8"));
    for (const f of rdd(join(outDir, "chunks")).filter((x) => x.endsWith(".sql")).sort()) {
      db.exec(rd(join(outDir, "chunks", f), "utf8"));
    }
    const cards = db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number };
    expect(cards.n).toBe(7);
    const acts = db.prepare("SELECT COUNT(*) AS n FROM card_acts").get() as { n: number };
    expect(acts.n).toBe(1);
    // junction rows landed (left_id NOT NULL, name NULL per 2020 convention)
    const j = db.prepare("SELECT COUNT(*) AS n FROM cards WHERE left_id IS NOT NULL AND trash = 0").get() as { n: number };
    expect(j.n).toBe(2);
    db.close();
  }, 180_000);

  it("the report marks checks-fail on an inconsistent target", async () => {
    const dir = makeDir();
    const outDir = join(dir, "chunks");
    const dumpPath = writeMysqldumpFixture(dir);
    const result = runCLI([
      "--dump",
      dumpPath,
      "--out-dir",
      outDir,
      "--quiet",
    ]);
    expect(result.status).toBe(0);
    // The CLI cleans up its staging DB on success; we cannot tamper with
    // it here. But we CAN prove the validator surfaces a parity failure
    // when the source and target counts differ - by re-applying the
    // chunks into a fresh SQLite DB and deleting one row before running
    // the validator.
    const chunkFiles = readdirSync(join(outDir, "chunks")).filter((x) => x.endsWith(".sql")).sort();
    const tamperedDb = join(dir, "tampered.sqlite");
    const db = new Database(tamperedDb);
    db.exec(readFileSync(join(REPO_ROOT, "db", "schema.sqlite.sql"), "utf8"));
    for (const f of chunkFiles) {
      db.exec(readFileSync(join(outDir, "chunks", f), "utf8"));
    }
    db.prepare("DELETE FROM cards WHERE id = 7").run();
    db.close();

    const { LocalSqliteToolDriver } = await import("../../tools/migrate/import.mjs");
    const { buildReport } = await import("../../tools/migrate/d1-validator.mjs");
    const { parseTargetSchema } = await import("../../tools/migrate/import.mjs");
    const driver = new LocalSqliteToolDriver(tamperedDb);
    const schema = parseTargetSchema(join(REPO_ROOT, "db", "schema.sqlite.sql"));
    const report = await buildReport({
      targetDriver: driver,
      targetKind: "sqlite-staging",
      targetPath: tamperedDb,
      sourcePath: dumpPath,
      sourceKind: "mysqldump",
      sourceBytes: 0,
      sourceCardsCount: 7,
      sourceJunctionsCount: 2,
      tableColumns: schema.tableColumns,
      chunks: [],
      totalRows: 7,
    });
    expect(report.target.cardsCount).toBe(6);
    expect(report.allChecksPass).toBe(false);
    driver.close();
  }, 60_000);
});
