// Schema tests: prove db/schema.sqlite.sql is (a) in sync with the
// src/server/schema.ts inventory and (b) actually executable on SQLite,
// with a full insert/select round-trip through cards and card_actions.
// The DDL is the wave-2 fetch layer's foundation; these tests are its
// foundation permit.
//
// Ground truth: db/schema.mysql-reference.sql (verbatim production MySQL)
// and the card-1.110.0 / decko-0.20.0 core migrations. Mapping decisions:
// docs/schema-notes.md.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  TABLES,
  TABLE_ORDER,
  type CardsRow,
  type CardActsRow,
  type CardActionsRow,
  type CardChangesRow,
} from "../../src/server/schema.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DDL_PATH = join(REPO_ROOT, "db", "schema.sqlite.sql");
const DDL = readFileSync(DDL_PATH, "utf8");

// ---------------------------------------------------------------------------
// DDL parsing — the inventory side of the schema.ts <-> DDL sync check.
// ---------------------------------------------------------------------------

interface ParsedTable {
  name: string;
  columns: string[];
}

/** Extract `CREATE TABLE "x" (...);` blocks and their quoted column names. */
function parseDdlTables(ddl: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const createRe = /CREATE TABLE "([a-z_]+)"\s*\(([\s\S]*?)\n\);/g;
  for (const match of ddl.matchAll(createRe)) {
    const name = match[1] as string;
    const body = match[2] as string;
    const columns: string[] = [];
    for (const line of body.split("\n")) {
      // A column definition line starts with a quoted identifier; constraint
      // lines (PRIMARY KEY, UNIQUE, CHECK, FOREIGN KEY) do not.
      const colMatch = line.match(/^\s*"([a-z_]+)"\s+(TEXT|INTEGER)/);
      if (colMatch) columns.push(colMatch[1] as string);
    }
    tables.push({ name, columns });
  }
  return tables;
}

/** Extract `CREATE [UNIQUE] INDEX name ON "table" ("col", ...)` targets. */
function parseDdlIndexes(ddl: string): { name: string; table: string; columns: string[] }[] {
  const out: { name: string; table: string; columns: string[] }[] = [];
  const indexRe = /CREATE (?:UNIQUE )?INDEX "([a-z_0-9]+)"\s+ON "([a-z_]+)"\s*\(([^)]+)\)/g;
  for (const match of ddl.matchAll(indexRe)) {
    const columns = (match[3] as string)
      .split(",")
      .map((c) => c.trim().split(" ")[0] as string)
      .map((c) => c.replace(/"/g, ""));
    out.push({ name: match[1] as string, table: match[2] as string, columns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Executable database — a fresh temp-file DB per test run.
// ---------------------------------------------------------------------------

let dir: string;
let dbPath: string;
let db: InstanceType<typeof Database>;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "decko-ts-schema-"));
  dbPath = join(dir, "schema-test.sqlite");
  db = new Database(dbPath);
  db.exec(DDL);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("schema.sqlite.sql vs src/server/schema.ts inventory", () => {
  it("declares exactly the tables TABLES knows about, in DDL order", () => {
    const parsed = parseDdlTables(DDL);
    expect(parsed.map((t) => t.name)).toEqual([...TABLE_ORDER]);
    expect(parsed.map((t) => t.name)).toEqual(Object.keys(TABLES));
  });

  it("declares exactly the columns each row type / TABLES entry carries", () => {
    for (const table of parseDdlTables(DDL)) {
      const expected = Object.keys(TABLES[table.name as keyof typeof TABLES].columns);
      expect(table.columns, `columns of ${table.name}`).toEqual(expected);
    }
  });

  it("declares an index for every index the production MySQL schema carries", () => {
    // Verbatim inventory from db/schema.mysql-reference.sql (KEY / UNIQUE KEY
    // lines). card_virtuals' swapped names are production truth. The two
    // *_binary_index entries are the ONLY engine-side additions (NOT MySQL
    // truth): BINARY-collation seek twins of the NOCASE key/codename unique
    // indexes — the engine's lookups compare BINARY and cannot seek a NOCASE
    // index, which made every point lookup probe cards_trash_index (whole
    // deck) on D1. Diagnosis + measurement: db/schema.sqlite.sql cards index
    // block and tools/cf-cost/measure-render-reads.test.ts.
    const mysqlIndexes: Record<string, string[]> = {
      cards: [
        "cards_key_index",
        "index_cards_on_left_id_and_right_id",
        "cards_codename_index",
        "cards_name_index",
        "cards_type_id_index",
        "cards_left_id_index",
        "cards_right_id_index",
        "cards_read_rule_id_index",
        "cards_created_at_index",
        "cards_updated_at_index",
        "cards_trash_index",
        "cards_key_binary_index",
        "cards_codename_binary_index",
      ],
      card_acts: ["card_acts_actor_id_index", "card_acts_card_id_index", "acts_acted_at_index"],
      card_actions: ["card_actions_card_act_id_index", "card_actions_card_id_index"],
      card_changes: ["card_changes_card_action_id_index"],
      card_references: [
        "card_references_referee_id_index",
        "card_references_referee_key_index",
        "card_references_referer_id_index",
        "card_references_ref_type_index",
      ],
      card_revisions: ["revisions_card_id_index", "revisions_created_by_index"],
      card_virtuals: [
        "index_card_virtuals_on_left_id_and_right_id",
        "left_id_index",
        "right_id_index",
      ],
      delayed_jobs: ["delayed_jobs_priority"],
      sessions: ["sessions_session_id_index"],
      schema_migrations: ["unique_schema_migrations"],
      ar_internal_metadata: [], // PRIMARY KEY("key") — in-table constraint
      transform_migrations: ["unique_schema_migrations_cards"],
    };
    const ddlIndexes = parseDdlIndexes(DDL);
    for (const [table, names] of Object.entries(mysqlIndexes)) {
      const got = ddlIndexes.filter((i) => i.table === table).map((i) => i.name);
      expect(got.sort(), `indexes on ${table}`).toEqual([...names].sort());
    }
  });
});

describe("schema.sqlite.sql executes on better-sqlite3", () => {
  it("creates all 12 core tables", () => {
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables.sort()).toEqual(Object.keys(TABLES).sort());
  });

  it("round-trips a cards row (insert -> select -> field-for-field equality)", () => {
    const card: CardsRow = {
      id: 0, // 0 lets AUTOINCREMENT assign; asserted below
      name: "Schema Round Trip",
      key: "schema_round_trip",
      codename: "round_trip",
      left_id: null,
      right_id: null,
      current_revision_id: null,
      created_at: "2026-09-19 13:45:00.000",
      updated_at: "2026-09-19 13:45:00.000",
      creator_id: 1,
      updater_id: 1,
      read_rule_class: null,
      read_rule_id: null,
      references_expired: null,
      trash: 0,
      type_id: 2, // Ruby's Card::BasicID in production data
      db_content: "round-trip body **content**",
    };
    const result = db
      .prepare(
        `INSERT INTO "cards"
           ("name","key","codename","left_id","right_id","current_revision_id",
            "created_at","updated_at","creator_id","updater_id","read_rule_class",
            "read_rule_id","references_expired","trash","type_id","db_content")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        card.name,
        card.key,
        card.codename,
        card.left_id,
        card.right_id,
        card.current_revision_id,
        card.created_at,
        card.updated_at,
        card.creator_id,
        card.updater_id,
        card.read_rule_class,
        card.read_rule_id,
        card.references_expired,
        card.trash,
        card.type_id,
        card.db_content
      );
    const id = result.lastInsertRowid;
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);

    const back = db.prepare(`SELECT * FROM "cards" WHERE "id" = ?`).get(id) as CardsRow;
    expect(back).toEqual({ ...card, id });
    // Storage-shape spot checks: INTEGER columns come back numbers,
    // datetime TEXT comes back as the exact string written.
    expect(typeof back.type_id).toBe("number");
    expect(back.created_at).toBe("2026-09-19 13:45:00.000");
    expect(back.trash).toBe(0);
  });

  it("round-trips an act -> action -> change chain with FK-free nullable joins", () => {
    const actResult = db
      .prepare(`INSERT INTO "card_acts" ("card_id","actor_id","acted_at","ip_address") VALUES (?,?,?,?)`)
      .run(null, 1, "2026-09-19 13:45:01.000", "127.0.0.1");
    const actId = actResult.lastInsertRowid as number;
    const act = db.prepare(`SELECT * FROM "card_acts" WHERE "id" = ?`).get(actId) as CardActsRow;
    expect(act).toEqual({
      id: actId,
      card_id: null,
      actor_id: 1,
      acted_at: "2026-09-19 13:45:01.000",
      ip_address: "127.0.0.1",
    });

    const actionResult = db
      .prepare(
        `INSERT INTO "card_actions" ("card_id","card_act_id","super_action_id","action_type","draft","comment")
         VALUES (?,?,?,?,?,?)`
      )
      .run(null, actId, null, 1, 1, "draft comment");
    const actionId = actionResult.lastInsertRowid as number;
    const action = db
      .prepare(`SELECT * FROM "card_actions" WHERE "id" = ?`)
      .get(actionId) as CardActionsRow;
    expect(action).toEqual({
      id: actionId,
      card_id: null,
      card_act_id: actId,
      super_action_id: null,
      action_type: 1,
      draft: 1,
      comment: "draft comment",
    });

    const changeResult = db
      .prepare(`INSERT INTO "card_changes" ("card_action_id","field","value") VALUES (?,?,?)`)
      .run(actionId, 2, "content after value");
    const change = db
      .prepare(`SELECT * FROM "card_changes" WHERE "id" = ?`)
      .get(changeResult.lastInsertRowid) as CardChangesRow;
    expect(change.value).toBe("content after value");
    expect(change.field).toBe(2);
  });

  it("enforces the production unique constraints", () => {
    // cards.key is UNIQUE (cards_key_index) — production rejects a second
    // row with the same key.
    expect(() =>
      db
        .prepare(`INSERT INTO "cards" ("key","created_at","updated_at","creator_id","updater_id","trash","type_id")
                  VALUES (?,?,?,?,?,?,?)`)
        .run("schema_round_trip", "2026-09-19 13:45:02.000", "2026-09-19 13:45:02.000", 1, 1, 0, 2)
    ).toThrow(/UNIQUE/);

    // The collation parity decision: MySQL's utf8mb3_unicode_ci uniqueness is
    // reproduced with COLLATE NOCASE on the unique indexes, so a case-variant
    // duplicate is rejected too.
    expect(() =>
      db
        .prepare(`INSERT INTO "cards" ("key","created_at","updated_at","creator_id","updater_id","trash","type_id")
                  VALUES (?,?,?,?,?,?,?)`)
        .run("SCHEMA_ROUND_TRIP", "2026-09-19 13:45:03.000", "2026-09-19 13:45:03.000", 1, 1, 0, 2)
    ).toThrow(/UNIQUE/);

    // (left_id, right_id) pair is UNIQUE on cards.
    db.prepare(
      `INSERT INTO "cards" ("name","key","left_id","right_id","created_at","updated_at","creator_id","updater_id","trash","type_id")
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("L", "l_card", 900, 901, "2026-09-19 13:45:04.000", "2026-09-19 13:45:04.000", 1, 1, 0, 2);
    expect(() =>
      db
        .prepare(
          `INSERT INTO "cards" ("name","key","left_id","right_id","created_at","updated_at","creator_id","updater_id","trash","type_id")
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
        .run("R", "r_card", 900, 901, "2026-09-19 13:45:05.000", "2026-09-19 13:45:05.000", 1, 1, 0, 2)
    ).toThrow(/UNIQUE/);
  });

  it("enforces boolean CHECK constraints on tinyint(1) columns", () => {
    expect(() =>
      db
        .prepare(`INSERT INTO "cards" ("key","created_at","updated_at","creator_id","updater_id","trash","type_id")
                  VALUES (?,?,?,?,?,?,?)`)
        .run("bad_trash", "2026-09-19 13:45:06.000", "2026-09-19 13:45:06.000", 1, 1, 5, 2)
    ).toThrow(/CHECK/);
  });

  it("never reuses AUTOINCREMENT ids, matching the InnoDB AUTO_INCREMENT contract", () => {
    const insert = db.prepare(
      `INSERT INTO "card_actions" ("action_type") VALUES (?)`
    );
    const first = insert.run(1).lastInsertRowid as number;
    db.prepare(`DELETE FROM "card_actions" WHERE "id" = ?`).run(first);
    const second = insert.run(1).lastInsertRowid as number;
    expect(second).toBeGreaterThan(first);
  });
});
