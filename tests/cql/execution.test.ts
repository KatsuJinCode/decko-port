/**
 * CQL execution tests: the closed loop parseCql -> generateSql ->
 * LocalSqliteDriver -> typed rows, against a fresh in-memory better-sqlite3
 * database loaded with the CORE schema (db/schema.sqlite.sql) and a fixed
 * seed universe.
 *
 * Coverage mirrors the SQL families the generator emits (see
 * docs/cql-port-notes.md and tests/cql/sql-generation.test.ts for the
 * oracle-verified shapes these statements render to): basic field filters,
 * name/key conditions, match via the REGEXP UDF, conjunction groups, not,
 * junction/plus conditions, card_references joins, editor/act chains,
 * sort/limit/offset, and count semantics.
 *
 * The REGEXP UDF is the LOCAL-path answer (src/cql/sqlite-regexp.ts); the
 * tests also pin the DECIDED edge fallback (docs/cql-execution-notes.md
 * "The REGEXP decision", implemented 2026-09-24): a match query on a driver
 * WITHOUT the UDF post-filters in JS to the same set the UDF path returns,
 * limit/offset leave the SQL, counts post-filter, and a match inside a
 * subselect (unpost-filterable) refuses loudly as CqlBadQuery.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalSqliteDriver } from "../../src/server/drivers/local-sqlite.js";
import { registerSqliteRegexpFunction } from "../../src/cql/sqlite-regexp.js";
import { executeQuery } from "../../src/cql/execute.js";
import type { CqlExecuteOptions } from "../../src/cql/execute.js";
import { CqlBadQuery } from "../../src/cql/ast.js";
import { POSTFILTER_ROW_CAP } from "../../src/cql/sql.js";
import type { CardsRow } from "../../src/server/schema.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// ---------------------------------------------------------------------------
// Seed universe — every row explicit so result sets are computable by hand.
// Timestamps use the canonical storage form ("YYYY-MM-DD HH:MM:SS.mmm",
// db/schema.sqlite.sql mapping decision) so TEXT comparisons are
// chronological.
// ---------------------------------------------------------------------------

interface SeedCard extends Partial<CardsRow> {
  id: number;
}

const T = (date: string): string => `${date} 00:00:00.000`;

/** Created/updated/creator/updater defaults; every seed row overrides what matters. */
function card(seed: SeedCard): CardsRow {
  return {
    name: null,
    key: null,
    codename: null,
    left_id: null,
    right_id: null,
    current_revision_id: null,
    read_rule_class: null,
    read_rule_id: null,
    references_expired: null,
    db_content: null,
    trash: 0,
    type_id: 1,
    creator_id: 10,
    updater_id: 10,
    created_at: T("2026-01-01"),
    updated_at: T("2026-01-01"),
    ...seed,
  };
}

const CARDS: CardsRow[] = [
  // types (type_id 1; content NULL)
  card({ id: 1, name: "Basic", key: "basic", codename: "Basic" }),
  card({ id: 2, name: "User", key: "user", codename: "User", updated_at: T("2026-01-02") }),
  // users (type_id 2)
  card({
    id: 10,
    name: "Joe Admin",
    key: "joe_admin",
    type_id: 2,
    db_content: "Joe Admin biography",
    created_at: T("2026-01-02"),
    updated_at: T("2026-01-02"),
  }),
  card({
    id: 11,
    name: "Sara Sample",
    key: "sara_sample",
    type_id: 2,
    db_content: "Sara Sample biography",
    creator_id: 11,
    updater_id: 11,
    created_at: T("2026-01-02"),
    updated_at: T("2026-01-03"),
  }),
  // content cards (type_id 1)
  card({
    id: 20,
    name: "Home",
    key: "home",
    db_content: "Welcome to the Home page",
    created_at: T("2026-01-05"),
    updated_at: T("2026-03-01"),
  }),
  card({
    id: 21,
    name: "About",
    key: "about",
    db_content: "About this site",
    creator_id: 11,
    created_at: T("2026-01-06"),
    updated_at: T("2026-02-01"),
  }),
  card({
    id: 22,
    name: "Zebra",
    key: "zebra",
    db_content: "stripes and more stripes",
    updater_id: 11,
    created_at: T("2026-01-07"),
    updated_at: T("2026-01-15"),
  }),
  card({
    id: 24,
    name: "Alpha Page",
    key: "alpha_page",
    db_content: "alpha content",
    creator_id: 11,
    updater_id: 11,
    created_at: T("2026-01-08"),
    updated_at: T("2026-04-01"),
  }),
  card({
    id: 25,
    name: "Restricted",
    key: "restricted",
    db_content: "restricted content",
    read_rule_id: 5,
    created_at: T("2026-01-09"),
    updated_at: T("2026-03-15"),
  }),
  card({
    id: 23,
    name: "Trashed",
    key: "trashed",
    db_content: "gone",
    trash: 1,
    created_at: T("2026-01-05"),
    updated_at: T("2026-01-20"),
  }),
  // plus-card parts and junctions (compound rows carry name = key = NULL)
  card({
    id: 31,
    name: "Editor Notes",
    key: "editor_note",
    db_content: "notes",
    created_at: T("2026-01-10"),
    updated_at: T("2026-01-10"),
  }),
  card({
    id: 33,
    name: "status",
    key: "status",
    db_content: "status",
    created_at: T("2026-01-11"),
    updated_at: T("2026-01-11"),
  }),
  card({
    id: 30,
    left_id: 20,
    right_id: 31,
    db_content: "Home+Editor Notes content",
    created_at: T("2026-01-12"),
    updated_at: T("2026-01-12"),
  }),
  card({
    id: 32,
    left_id: 20,
    right_id: 33,
    db_content: "Home+status content",
    created_at: T("2026-01-13"),
    updated_at: T("2026-01-13"),
  }),
];

const REFERENCES = [
  // About (21) links to Home (20)
  { id: 40, referer_id: 21, referee_key: "home", referee_id: 20, ref_type: "L", is_present: 1 },
  // About includes missing_page (referee gone -> is_present 0, referee_id NULL)
  {
    id: 41,
    referer_id: 21,
    referee_key: "missing_page",
    referee_id: null,
    ref_type: "I",
    is_present: 0,
  },
  // Home (20) links to Joe Admin (10)
  { id: 42, referer_id: 20, referee_key: "joe_admin", referee_id: 10, ref_type: "L", is_present: 1 },
];

const ACTS = [
  { id: 50, card_id: 20, actor_id: 10, acted_at: T("2026-03-01") },
  { id: 51, card_id: 21, actor_id: 11, acted_at: T("2026-02-01") },
  { id: 52, card_id: 22, actor_id: 11, acted_at: T("2026-01-15") },
];

const ACTIONS = [
  // update actions (action_type 1) for acts 50/51; a create (0) for act 52
  { id: 60, card_id: 20, card_act_id: 50, action_type: 1 },
  { id: 61, card_id: 21, card_act_id: 51, action_type: 1 },
  { id: 62, card_id: 22, card_act_id: 52, action_type: 0 },
];

/** Name -> id resolver standing in for Card::Lexicon.id (ParseOptions). */
const RESOLVER = (name: string): number => {
  const ids: Record<string, number> = {
    "Joe Admin": 10,
    "Sara Sample": 11,
    Home: 20,
    About: 21,
    User: 2,
  };
  return ids[name] ?? -999;
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let driver: LocalSqliteDriver;

/** Load db/schema.sqlite.sql through the same driver.query seam the engine
 *  uses: strip line comments, split on statement-terminating semicolons,
 *  run each DDL statement. The DDL is static repo truth with no semicolons
 *  inside comments or values, so the split is exact. */
async function loadCoreSchema(target: LocalSqliteDriver): Promise<void> {
  const ddl = readFileSync(`${REPO_ROOT}db/schema.sqlite.sql`, "utf8");
  const statements = ddl
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  for (const statement of statements) {
    await target.query(statement, []);
  }
}

async function insertCards(target: LocalSqliteDriver): Promise<void> {
  const columns = Object.keys(CARDS[0]) as (keyof CardsRow)[];
  const placeholders = columns.map(() => "?").join(", ");
  for (const row of CARDS) {
    const values = columns.map((c) => row[c]);
    await target.query(
      `INSERT INTO cards (${columns.join(", ")}) VALUES (${placeholders})`,
      values,
    );
  }
  for (const ref of REFERENCES) {
    await target.query(
      "INSERT INTO card_references (id, referer_id, referee_key, referee_id, ref_type, is_present) VALUES (?,?,?,?,?,?)",
      [ref.id, ref.referer_id, ref.referee_key, ref.referee_id, ref.ref_type, ref.is_present],
    );
  }
  for (const act of ACTS) {
    await target.query("INSERT INTO card_acts (id, card_id, actor_id, acted_at) VALUES (?,?,?,?)", [
      act.id,
      act.card_id,
      act.actor_id,
      act.acted_at,
    ]);
  }
  for (const action of ACTIONS) {
    await target.query(
      "INSERT INTO card_actions (id, card_id, card_act_id, action_type) VALUES (?,?,?,?)",
      [action.id, action.card_id, action.card_act_id, action.action_type],
    );
  }
}

beforeAll(async () => {
  driver = new LocalSqliteDriver();
  await loadCoreSchema(driver);
  registerSqliteRegexpFunction(driver);
  await insertCards(driver);
});

afterAll(() => {
  driver.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default execution options: names resolve during interpretation, so the
 *  parse-time resolver rides on every call (CqlExecuteOptions.parse). */
const EXEC_OPTS = { parse: { resolveCardId: RESOLVER } };

/** executeQuery narrowed to the rows shape (everything but count results). */
async function runRows(statement: unknown, options: CqlExecuteOptions = EXEC_OPTS) {
  const result = await executeQuery(driver, statement, options);
  if ("count" in result) throw new Error(`unexpected count result for ${JSON.stringify(statement)}`);
  return result;
}

async function ids(statement: unknown, options: CqlExecuteOptions = EXEC_OPTS): Promise<number[]> {
  const result = await runRows(statement, options);
  return result.rows.map((row) => row.id).sort((a, b) => a - b);
}

/** The full non-trashed type_id-1 set: type cards 1 and 2, content cards
 *  20-25 minus trashed 23, junctions 30-33. */
const ALL_TYPE_1 = [1, 2, 20, 21, 22, 24, 25, 30, 31, 32, 33];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("execution bootstrap and row typing", () => {
  it("returns full card rows typed as CardsRow for the default select", async () => {
    const result = await runRows({ name: "Home" });
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.id).toBe(20);
    expect(row.name).toBe("Home");
    expect(row.key).toBe("home");
    expect(row.trash).toBe(0);
    expect(row.type_id).toBe(1);
    expect(row.created_at).toBe(T("2026-01-05"));
    expect(result.sql).toContain("SELECT c0.* FROM cards c0");
    expect(result.params).toEqual(["home"]);
  });

  it("runs the CORE schema DDL through the driver query seam (cards table present)", async () => {
    const result = await driver.query("SELECT count(*) AS n FROM cards", []);
    expect(result.rows[0]).toEqual({ n: CARDS.length });
  });
});

describe("basic field filters", () => {
  it("name equality maps to the key column and key form", async () => {
    expect(await ids({ name: "Joe Admin" })).toEqual([10]);
  });

  it("name in-list key-ifies every value", async () => {
    expect(await ids({ name: ["in", "Home", "About"] })).toEqual([20, 21]);
  });

  it("content equality maps to db_content", async () => {
    expect(await ids({ content: "About this site" })).toEqual([21]);
  });

  it("codename equality", async () => {
    expect(await ids({ codename: "Basic" })).toEqual([1]);
  });

  it("type: string resolves to a direct type_id condition", async () => {
    expect(await ids({ type: "User" })).toEqual([10, 11]);
  });

  it("type: hash ties a codename join", async () => {
    expect(await ids({ type: { codename: "User" } })).toEqual([10, 11]);
  });

  it("created_at gt comparison (canonical TEXT form compares chronologically)", async () => {
    // '2026-01-07 00:00:00.000' > '2026-01-07' string-wise, so the Jan 7
    // card is included — the fixed-width format keeps TEXT ordering equal
    // to time ordering for full-form values on both sides of the operator.
    expect(await ids({ created_at: ["gt", "2026-01-07"] })).toEqual([
      22, 24, 25, 30, 31, 32, 33,
    ]);
  });
});

describe("implicit conditions (trash + permissions)", () => {
  it("trashed cards never come back", async () => {
    expect(await ids({ name: "Trashed" })).toEqual([]);
    expect(await ids({ type_id: 1 })).toEqual(ALL_TYPE_1);
  });

  it("readRuleIds restrict to the IN-list (NULL read_rule_id excluded)", async () => {
    expect(await ids({ type_id: 1 }, { alwaysOk: false, readRuleIds: [5] })).toEqual([25]);
  });

  it("empty rule list uses the Ruby sentinel IN (1) and returns nothing", async () => {
    const result = await runRows({ type_id: 1 }, { alwaysOk: false });
    expect(result.sql).toContain("c0.read_rule_id IN (1)");
    expect(result.rows).toEqual([]);
  });

  it("default always-ok skips the permission condition", async () => {
    const result = await runRows({ type_id: 1 });
    expect(result.sql).not.toContain("read_rule_id");
  });
});

describe("match via the REGEXP UDF", () => {
  it("match ORs name and content", async () => {
    expect(await ids({ match: "About" })).toEqual([21]);
  });

  it("escaped literal terms survive the UDF (space, case)", async () => {
    expect(await ids({ content: ["~", "the Home page"] })).toEqual([20]);
  });

  it("matching is case-insensitive (MySQL REGEXP default)", async () => {
    expect(await ids({ content: ["~", "STRIPES"] })).toEqual([22]);
  });

  it("name match hits the name column; NULL names never match", async () => {
    // name contains 'a': Basic, Joe Admin, Sara Sample, About, Zebra,
    // Alpha Page, status ("restricted"/"Editor Notes" have no letter 'a');
    // junction rows have NULL names and never match.
    expect(await ids({ name: ["~", "a"] })).toEqual([1, 10, 11, 21, 22, 24, 33]);
  });

  it("= prefix on name becomes an exact key comparison", async () => {
    expect(await ids({ name: ["~", "=Home"] })).toEqual([20]);
  });

  it("~~ raw pattern passes through unescaped (anchors work)", async () => {
    expect(await ids({ content: ["~", "~~^stripes"] })).toEqual([22]);
  });

  it("complete completes on key LIKE", async () => {
    expect(await ids({ complete: "alp" })).toEqual([24]);
  });

  it("an invalid raw pattern surfaces as a query error, never silently-empty", async () => {
    await expect(executeQuery(driver, { match: "~~(unclosed" })).rejects.toThrow(
      /invalid REGEXP pattern/,
    );
  });
});

describe("conjunctions and negation", () => {
  it("any ORs subconditions", async () => {
    expect(await ids({ any: [{ creator_id: 11 }, { updater_id: 11 }] })).toEqual([11, 21, 22, 24]);
  });

  it("all ANDs subconditions", async () => {
    expect(await ids({ all: [{ creator_id: 11 }, { type_id: 1 }] })).toEqual([21, 24]);
  });

  it("conj modifier joins top-level conditions with OR", async () => {
    expect(await ids({ id: 20, name: "About", conj: "or" })).toEqual([20, 21]);
  });

  it("not excludes matching rows via LEFT JOIN + id is null", async () => {
    expect(await ids({ not: { type: "User" } })).toEqual(ALL_TYPE_1);
  });

  it("any with a join condition renders the parenthesized LEFT JOIN group and runs", async () => {
    // the generator's riskiest shape for SQLite: LEFT JOIN (card_actions cn1
    // JOIN card_acts cx2 ... JOIN cards c3 ...) ON ...
    expect(await ids({ any: [{ edited_by: "Sara Sample" }] })).toEqual([21, 22]);
  });
});

describe("junction / plus conditions", () => {
  it("part matches either side", async () => {
    expect(await ids({ part: "Home" })).toEqual([30, 32]);
  });

  it("right_plus finds the left part of a junction by its right part", async () => {
    expect(await ids({ right_plus: { name: "Editor Notes" } })).toEqual([20]);
  });

  it("left_plus finds right parts of junctions anchored at the given left part", async () => {
    // left_plus: X -> "X+C exists": junctions Home+Editor Notes and
    // Home+status make the right parts 31 and 33
    expect(await ids({ left_plus: { name: "Home" } })).toEqual([31, 33]);
  });
});

describe("card_references joins", () => {
  it("refer_to follows referee_id", async () => {
    expect(await ids({ refer_to: "Home" })).toEqual([21]);
  });

  it("linked_to_by follows Home's links to their referees", async () => {
    expect(await ids({ linked_to_by: "Home" })).toEqual([10]);
  });

  it("referred_to_by includes both reftypes; NULL referees match nothing", async () => {
    expect(await ids({ referred_to_by: "About" })).toEqual([20]);
  });

  it("_none finds broken references via is_present = 0", async () => {
    expect(await ids({ refer_to: "_none" })).toEqual([21]);
  });

  it("link_to restricts to L reftypes", async () => {
    expect(await ids({ link_to: "Home" })).toEqual([21]);
  });
});

describe("editor / act chains", () => {
  it("edited_by follows actions regardless of action_type", async () => {
    // Sara acted on About (update) and Zebra (create)
    expect(await ids({ edited_by: "Sara Sample" })).toEqual([21, 22]);
  });

  it("updated_by adds the action_type = 1 condition", async () => {
    expect(await ids({ updated_by: "Sara Sample" })).toEqual([21]);
  });

  it("creator_of finds the creator user of a card", async () => {
    expect(await ids({ creator_of: "Home" })).toEqual([10]);
  });

  it("last_edited_by restricts on updater_id directly", async () => {
    expect(await ids({ last_edited_by: "Sara Sample" })).toEqual([11, 22, 24]);
  });
});

describe("sort / limit / offset", () => {
  // names containing 'a' (case-insensitive), junction NULL names excluded:
  // Basic, Joe Admin, Sara Sample, About, Zebra, Alpha Page, status
  // ("restricted" has no letter 'a').
  const NAME_MATCH_SET = [1, 10, 11, 21, 22, 24, 33];
  // keys in binary order: about < alpha_page < basic < joe_admin
  // < sara_sample < status < zebra
  const NAME_ASC_ORDER = [21, 24, 1, 10, 11, 33, 22];

  it("sort by name asc orders by key", async () => {
    const result = await runRows({ name: ["~", "a"], sort: "name", sort_dir: "asc" });
    expect(result.rows.map((r) => r.id)).toEqual(NAME_ASC_ORDER);
  });

  it("sort: update defaults to desc", async () => {
    const result = await runRows({ type_id: 1, sort: "update" });
    expect(result.rows.map((r) => r.id)).toEqual([
      24, 25, 20, 21, 22, 32, 30, 33, 31, 2, 1,
    ]);
  });

  it("limit truncates after sorting", async () => {
    const result = await runRows({
      name: ["~", "a"],
      sort: "name",
      sort_dir: "asc",
      limit: 3,
    });
    expect(result.rows.map((r) => r.id)).toEqual(NAME_ASC_ORDER.slice(0, 3));
  });

  it("limit + offset round-trips the requested window", async () => {
    const result = await runRows({
      name: ["~", "a"],
      sort: "name",
      sort_dir: "asc",
      limit: 3,
      offset: 2,
    });
    expect(result.rows.map((r) => r.id)).toEqual(NAME_ASC_ORDER.slice(2, 5));
  });

  it("offset without limit renders no LIMIT (Ruby quirk preserved in execution)", async () => {
    const result = await runRows({ name: ["~", "a"], offset: 2 });
    expect(result.sql).not.toContain("LIMIT");
    expect(result.rows).toHaveLength(NAME_MATCH_SET.length);
  });
});

describe("count semantics", () => {
  it("return: count collapses to the integer (Run#alter_result shape)", async () => {
    const result = await executeQuery(driver, { return: "count", type_id: 2 });
    if (!("count" in result)) throw new Error("expected a count result");
    expect(result.count).toBe(2);
    expect(result.sql).toContain("coalesce(count(distinct c0.id),0) as count");
  });

  it("executeCount forces the count shape and ignores limit (CardQuery#full?)", async () => {
    const { executeCount } = await import("../../src/cql/execute.js");
    expect(await executeCount(driver, { type_id: 1 })).toBe(ALL_TYPE_1.length);
    expect(await executeCount(driver, { type_id: 1, limit: 1 })).toBe(ALL_TYPE_1.length);
  });

  it("count honors the permission condition", async () => {
    const { executeCount } = await import("../../src/cql/execute.js");
    expect(
      await executeCount(driver, { type_id: 1 }, { alwaysOk: false, readRuleIds: [5] }),
    ).toBe(1);
  });

  it("group by runs and returns one row per group", async () => {
    const result = await runRows({ type_id: [1, 2], return: "type_id", group: "c0.type_id" });
    const values = result.rows.map((r) => r["type_id"]).sort((a, b) => Number(a) - Number(b));
    expect(values).toEqual([1, 2]);
  });
});

describe("REGEXP without the UDF: the JS post-filter fallback (the REGEXP decision's edge path)", () => {
  function rowIds(result: { rows: CardsRow[] } | { count: number }): number[] {
    if ("count" in result) throw new Error("expected a rows result");
    return result.rows.map((row) => row.id).sort((a, b) => a - b);
  }

  it("a match query without the UDF post-filters to the SAME set the UDF path returns", async () => {
    const bare = new LocalSqliteDriver();
    try {
      await loadCoreSchema(bare);
      await insertCards(bare);
      const viaUdf = await ids({ match: "home" });
      // First query on the bare driver: the statement fails UDF-missing and
      // the executor flips to the post-filter (one failed attempt, then the
      // match-free SQL + JS filtering).
      const first = await executeQuery(bare, { match: "home" }, EXEC_OPTS);
      expect(rowIds(first)).toEqual(viaUdf);
      expect(viaUdf.length).toBeGreaterThan(0);
      expect(first.sql).not.toContain("REGEXP");
      // The driver memo: a SECOND match query routes straight to the
      // post-filter (no second failed attempt) and still matches.
      const again = await executeQuery(bare, { match: "about" }, EXEC_OPTS);
      expect(rowIds(again)).toEqual(await ids({ match: "about" }));
      expect(again.sql).not.toContain("REGEXP");
    } finally {
      bare.close();
    }
  });

  it("post-filter applies limit AFTER filtering (the SQL carries only the cap)", async () => {
    const bare = new LocalSqliteDriver();
    try {
      await loadCoreSchema(bare);
      await insertCards(bare);
      const all = await executeQuery(bare, { match: "a" }, EXEC_OPTS);
      const limited = await executeQuery(bare, { match: "a", limit: 1 }, EXEC_OPTS);
      expect(all.sql).toContain(`LIMIT ${POSTFILTER_ROW_CAP}`);
      if ("count" in all || "count" in limited) throw new Error("expected rows results");
      expect(limited.rows).toHaveLength(1);
      // The user limit applies in JS over the FILTERED set: the single
      // returned row is the filtered set's first row (same SQL order).
      expect(limited.rows[0]!.id).toBe(all.rows[0]!.id);
    } finally {
      bare.close();
    }
  });

  it("count with match post-filters (the row select runs; the count matches)", async () => {
    const bare = new LocalSqliteDriver();
    try {
      await loadCoreSchema(bare);
      await insertCards(bare);
      const expected = await ids({ match: "home" });
      const result = await executeQuery(bare, { return: "count", match: "home" }, EXEC_OPTS);
      if (!("count" in result)) throw new Error("expected a count result");
      expect(result.count).toBe(expected.length);
    } finally {
      bare.close();
    }
  });

  it("a match inside a subselect refuses loudly (CqlBadQuery), never silently drops", async () => {
    const bare = new LocalSqliteDriver();
    try {
      await loadCoreSchema(bare);
      await insertCards(bare);
      // Root-level match post-filters fine, but the any-subselect's match
      // would be dropped from the SQL with no JS way to re-apply it — the
      // executor refuses instead of returning wrong rows.
      const statement = { match: "home", any: [{ match: "about" }] };
      await expect(executeQuery(bare, statement, EXEC_OPTS)).rejects.toThrow(CqlBadQuery);
    } finally {
      bare.close();
    }
  });
});

describe("deferred keys surface honestly at execution time", () => {
  it("found_by rejects with the generator's wave-2 pointer", async () => {
    await expect(executeQuery(driver, { found_by: { id: 5 } })).rejects.toThrow(
      /found_by requires runtime query execution/,
    );
  });

  it("found_by's refusal is CqlBadQuery (the 400-mappable class, not a crash)", async () => {
    // The refusal is BY DESIGN (deferred wave 2), so it must ride the
    // BadQuery class the API layer maps to 400 "bad CQL" — a plain Error
    // surfaced as 500 "CQL execution failed", indistinguishable from an
    // engine crash (the probe battery's api-query-found-by-refused).
    const error = await executeQuery(driver, { found_by: { id: 5 } }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CqlBadQuery);
  });
});
