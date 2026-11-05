import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../server/driver.js";
import {
  absorbSideKeyArmRows,
  buildDriftArmIndex,
  decomposeMergedRows,
  foldRenderPlanEntries,
  replayFoldWantsMerge,
} from "./replay-fold.js";
import type { DriftArmIndex } from "./replay-fold.js";

export const RESIDUE_CLASSES: ReadonlyMap<string, string> = new Map([
  [
    "engine-boot-codenames",
    "The codename registry's one-time load (two loaders exist — the registry's and the admin runtime's) plus the session-actor codename probe (codename IN ('anyone',...)); engine boot, not per-page state.",
  ],
  [
    "engine-fold-type-names",
    "The structure machinery's type-name fold (SELECT DISTINCT c.type_id, t.name ...) — engine-level state loaded once per engine, not page-dependent row data.",
  ],
  [
    "engine-fold-head-reads",
    "The head read-set fold (HEAD_READ_SET_KEYS IN-list re-read once per engine) — the payload pre-seats those cards; the fold's own statement still runs cold-once per engine (headReadsCold gate).",
  ],
  [
    "lexicon-id-to-name",
    "The lexicon's id→name db fallback for ids outside the payload (dangling junction sides et al.) — the durable-map/plan-priming class.",
  ],
  [
    "lexicon-key-to-id",
    "The lexicon's key→id db fallback (nameToLex miss) — same priming class as lexicon-id-to-name.",
  ],
  [
    "engine-boot-dangling-canonical",
    "The dangling-side canonical map (engine-lifetime memoized deck statement; search-result collision class bookkeeping).",
  ],
  [
    "freshness-stamp",
    "The freshness gate's per-request deck_data_version stamp read (src/card/render.ts DECK_DATA_VERSION_STATEMENT, the freshness-stamp requirement) — one PK point SELECT at every render entry; a moved stamp clears the engine's derived caches. Per-request gate state, never page data: the payload cannot cover it and a plan must not record it. One registry entry, one shape predicate: isFreshnessStampRead.",
  ],
  [
    "permission-gate-count",
    "The read-permission state's gate counters (read-rules.ts statement 3: hasReadRules / hasCatchAllReadRule — one 0-bind COUNT over the deck's read-rule cards). Viewer-independent deck GATE state, resolved once per engine and cleared by the stamp-move reset: the one-trip seat head carries it as a zero-bind column (spec §a.4's \"settings count\" arm — stamp-as-column change); every other posture issues it inside the cold closure batch. Never a plan entry: a plan-served gate count would be re-armed from recording-time rows after a bump's reset+re-seat and answer the permission resolver with pre-move state (the exact stale-verdict class the freshness-stamp exclusion exists for).",
  ],
  [
    "closure-prefetch-batch",
    "The render's own prefetch batches (prelude folds, side priming, rule anchors, permission/codename/structure folds; key IN-lists and pair joins) — engine-level state issued per cold render; the payload's seeded cache empties their ROUNDS, not the batch itself.",
  ],
  [
    "point-row-by-key",
    "A simple-name point read that missed the payload's cache (simple-name misses consult `cards` by key directly — retrieve.ts — so no lexicon negative can stop them; rule candidates whose card does not exist are the bulk).",
  ],
  [
    "point-row-by-id",
    "An id point read that missed the payload's cache (enrichment ladders, lattice follow-on reads for cards outside the payload).",
  ],
  [
    "pair-exists-probe",
    "The (left_id, right_id) junction existence probe (retrieve's compound-name path); negative knowledge for compound names is seated by the replay plan's lexicon priming.",
  ],
  [
    "reached-rules-cte",
    "The engine's own permission/rule walk (WITH RECURSIVE reached/anc/name_walk) — reads the rule lattice directly from SQL in ONE statement; the payload never carries lattice rows (measured: any transitive lattice walk reaches the whole deck).",
  ],
  [
    "template-link-id-read",
    "The template-link prepare sweep's junction reads by id (SELECT id, db_content FROM cards WHERE id IN ...) — structure/template machinery follow-ons.",
  ],
  [
    "search-cql",
    "The search nest's live CQL execution — irreducible without render-path integration (runSearch always executes); the write-time posture's materialized rows pre-seat the RESULT cards, not the execution.",
  ],
  [
    "search-count",
    "The search paging count query (runs when the result window fills its limit) — same irreducibility class as search-cql.",
  ],
  [
    "search-result-chunked-read",
    "The search results' transport-chunked row read (SELECT c.* ... id IN (...) batches) — runSearch re-reads unconditionally (no cache short-circuit) so the payload cannot remove it without render-path integration.",
  ],
  [
    "layout-warmup",
    "The page layout warm-up's reference chase — a fixed class the payload's layout-connected closure mostly covers; residual rounds are named here.",
  ],
]);

export function isFreshnessStampRead(sql: string): boolean {
  return /SELECT "version" FROM "deck_data_version" WHERE "id" = 1/i.test(sql);
}

export function isPermissionGateCountRead(sql: string): boolean {
  return (
    /^SELECT COUNT\(\*\) AS c/i.test(sql.trim()) &&
    /catchAll/i.test(sql) &&
    /FROM cards WHERE cards\.right_id/i.test(sql)
  );
}

export function classifyResidueStatement(sql: string): string | undefined {
  if (isFreshnessStampRead(sql)) {
    return "freshness-stamp";
  }
  if (isPermissionGateCountRead(sql)) {
    return "permission-gate-count";
  }
  if (/codename IS NOT NULL/i.test(sql) || /codename IN \('anyone'/i.test(sql)) {
    return "engine-boot-codenames";
  }
  if (/rules\.id AS ruleId/i.test(sql)) return "reached-rules-cte";
  if (/left_id IS NOT NULL AND \(NOT EXISTS/i.test(sql)) return "engine-boot-dangling-canonical";
  if (/WITH RECURSIVE\s+(reached|anc|name_walk|setting\(id\))/i.test(sql)) return "reached-rules-cte";
  if (/SELECT DISTINCT c\.type_id AS type_id/i.test(sql)) return "engine-fold-type-names";
  if (/SELECT \* FROM cards WHERE key IN \(/i.test(sql)) return "engine-fold-head-reads";
  if (/SELECT name, left_id, right_id FROM cards WHERE id = \? LIMIT 1/i.test(sql)) {
    return "lexicon-id-to-name";
  }
  if (/SELECT id FROM cards WHERE key = \? AND trash = 0 LIMIT 1/i.test(sql)) {
    return "lexicon-key-to-id";
  }
  if (/SELECT c\.\* FROM cards c WHERE c\.trash = 0 AND c\.id IN \(/i.test(sql)) {
    return "search-result-chunked-read";
  }
  if (/SELECT id, db_content FROM cards WHERE id IN \(/i.test(sql)) return "template-link-id-read";
  if (/SELECT id FROM cards WHERE left_id = \? AND right_id = \?/i.test(sql)) {
    return "pair-exists-probe";
  }
  if (/SELECT \* FROM cards WHERE key = \? AND trash = 0 LIMIT 1/i.test(sql)) {
    return "point-row-by-key";
  }
  if (/SELECT \* FROM cards WHERE id = \?( AND trash = 0)?( LIMIT 1)?$/i.test(sql.trim())) {
    return "point-row-by-id";
  }
  if (
    /JOIN cards (l|r|s) ON/i.test(sql) ||
    /j\.left_id = \? AND j\.right_id = \?/i.test(sql) ||
    /COLLATE NOCASE IN \(/i.test(sql) ||
    /WHERE id IN \(/i.test(sql) ||
    /read_rule/i.test(sql)
  ) {
    return "closure-prefetch-batch";
  }
  if (/search/i.test(sql) || /json_group_array/i.test(sql)) return "search-cql";
  if (/COUNT\(\*\)/i.test(sql)) return "search-count";
  return undefined;
}

const ORDER_DEPENDENT_CLASSES: ReadonlySet<string> = new Set(["search-count", "search-cql"]);

export function isPipelineAbleRenderStatement(sql: string): boolean {
  const t = sql.trim();
  if (!/^SELECT\b/i.test(t) && !/^WITH\b/i.test(t)) return false;
  if (/one_trip_/i.test(t)) return false;
  const family = classifyResidueStatement(sql);
  if (family === undefined) {
    return /^SELECT id FROM cards WHERE name = \? AND trash = 0 LIMIT 1$/i.test(t);
  }
  if (isFreshnessStampRead(sql)) return false;
  if (isPermissionGateCountRead(sql)) return false;
  return !ORDER_DEPENDENT_CLASSES.has(family);
}

export interface RenderPlanEntry {
  sql: string;
  params: unknown[];
}

export interface RenderPlan {
  pageKey: string;
  recordedAt: string;
  entries: RenderPlanEntry[];
}

export function recordRenderPlan(
  pageKey: string,
  statements: { sql: string; params: unknown[] }[],
): RenderPlan {
  const seen = new Set<string>();
  const entries: RenderPlanEntry[] = [];
  for (const stmt of statements) {
    const key = `${stmt.sql}::${JSON.stringify(stmt.params)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ sql: stmt.sql, params: stmt.params });
  }
  return { pageKey, recordedAt: new Date().toISOString(), entries };
}

export async function replayRenderPlan(
  driver: SQLDatabaseDriver,
  plan: RenderPlan,
): Promise<unknown[]> {
  return (await replayRenderPlanWithIndex(driver, plan)).results;
}

export interface ReplayedPlanWithIndex {
  results: unknown[];
  index: DriftArmIndex;
}

export async function replayRenderPlanWithIndex(
  driver: SQLDatabaseDriver,
  plan: RenderPlan,
): Promise<ReplayedPlanWithIndex> {
  if (replayFoldWantsMerge()) {
    const folded = foldRenderPlanEntries(plan.entries);
    try {
      const results = await driver.batch(folded.statements);
      const perEntry: unknown[] = new Array(plan.entries.length);
      for (const slice of folded.merged) {
        const result = results[slice.statementIndex] as SQLQueryResult | undefined;
        const perEntryRows = decomposeMergedRows(slice, result);
        for (const [entryIndex, rows] of perEntryRows) {
          perEntry[entryIndex] = { rows, rowsAffected: 0 };
        }
      }
      for (const u of folded.unfolded) {
        perEntry[u.entryIndex] = results[u.statementIndex];
      }
      for (let i = 0; i < plan.entries.length; i++) {
        if (perEntry[i] === undefined) perEntry[i] = { rows: [], rowsAffected: 0 };
      }
      const index = buildDriftArmIndex(plan.entries, perEntry);
      absorbSideKeyArmRows(index, plan.entries, folded, results);
      return { results: perEntry, index };
    } catch {
    }
  }
  const statements: SQLStatement[] = plan.entries.map((entry) => ({
    sql: entry.sql,
    params: entry.params,
  }));
  const results = await driver.batch(statements);
  return { results, index: buildDriftArmIndex(plan.entries, results) };
}
