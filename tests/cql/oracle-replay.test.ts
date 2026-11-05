// CQL oracle parity: replays the 11 captured query entries in
// fixtures/captured/cql-basic.json through the REAL execution path —
// executeQuery (parseCql -> generateSql -> LocalSqliteDriver) — against a
// seeded reconstruction of the oracle capture deck
// (cql-test-storage.ts#seedOracleCaptureDeck), and byte-compares each name
// result set against Ruby's recording. 11/11 strict.
//
// Name->id resolution rides the fetch layer's Lexicon walk: the parse-time
// resolveCardId (parseOptionsWithLexicon) answers through DbLexicon.peekId
// over cache-warmed entries, and result names recompose through
// DbLexicon.name — the same walk both times, shared with the fetch stream.
//
// match_sentinel is the one entry WITHOUT an oracle result set: the capture
// itself failed ("CAPTURE_ERROR: RuntimeError: %{func} not implemented" —
// Ruby's CQL match is MySQL/PG-only; SQLite has no REGEXP,
// docs/oracle-harness.md). Byte-comparison is impossible BY CAPTURE, so the
// replay pins the error sentinel (a re-capture that records a real result
// set fails loudly here and upgrades the comparison), then RUNS the query
// through the engine with the REGEXP UDF (src/cql/sqlite-regexp.ts) and
// asserts the set the generator+UDF semantics imply for this seed.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { executeQuery, parseOptionsWithLexicon } from "../../src/cql/execute.js";
import type { DbLexicon } from "../../src/card/fetch/lexicon.js";
import type { CardsRow } from "../../src/server/schema.js";
import {
  createCqlTestStorage,
  seedOracleCaptureDeck,
  type CqlTestStorage,
} from "./cql-test-storage.js";

interface CapturedQuery {
  query: Record<string, unknown>;
  result: string[] | string;
}

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Result names recomposed through the fetch layer's Lexicon walk (the
 *  compound rows come back with NULL name columns; Card#name is the
 *  left+right Lexicon composition). Sorted: the comparison is name-SET
 *  parity — the captured files' row order is not part of the contract the
 *  generator pins (ORDER BY shapes are pinned in sql-generation tests). */
async function resultNames(lexicon: DbLexicon, rows: CardsRow[]): Promise<string[]> {
  const names: string[] = [];
  for (const row of rows) {
    const composed = await lexicon.name(row.id);
    if (composed !== undefined && composed.s !== "") names.push(composed.s);
  }
  return names.sort();
}

/** Warm the Lexicon so the sync resolveCardId seam can answer during
 *  interpretation (peekId is warm-cache-only by contract). */
async function warmDeckLexicon(storage: CqlTestStorage): Promise<void> {
  const result = await storage.driver.query<{ id: number }>("SELECT id FROM cards", []);
  await storage.fetcher.warmLexicon(result.rows.map((row) => row.id));
}

describe("oracle replay: CQL engine (11/11, strict)", () => {
  it("byte-compares every captured query's result set against the Ruby oracle", async () => {
    const fixture = JSON.parse(
      readFileSync(`${REPO_ROOT}/fixtures/captured/cql-basic.json`, "utf8"),
    ) as { queries: Record<string, CapturedQuery> };
    const storage = await createCqlTestStorage();
    try {
      await seedOracleCaptureDeck(storage);
      await warmDeckLexicon(storage);
      const parse = parseOptionsWithLexicon(storage.fetcher.lexicon);

      const failures: string[] = [];
      for (const [name, captured] of Object.entries(fixture.queries)) {
        if (!Array.isArray(captured.result)) {
          // No oracle result set exists for this entry (capture adapter
          // failed) — pin the sentinel so a re-capture upgrades to a real
          // comparison instead of silently keeping the semantic fallback.
          expect(`${name}: ${String(captured.result)}`).toContain("CAPTURE_ERROR");
          const result = await executeQuery(storage.fetcher.driver, captured.query, { parse });
          if ("count" in result) throw new Error(`${name}: unexpected count result`);
          const tsNames = await resultNames(storage.fetcher.lexicon, result.rows);
          // match "Oracle" = name REGEXP /oracle/i (simple cards: 605, 606,
          // 611, 614, 615; compound rows carry NULL names and never match —
          // UDF NULL propagation) OR db_content REGEXP /oracle/i (605, 611,
          // 614). Derived from the generator+UDF semantics over this seed;
          // the oracle recorded no result to compare against.
          expect(`${name}: ${tsNames.join(", ")}`).toBe(
            `${name}: ${[
              "Oracle Basics",
              "Oracle Junction",
              "Oracle Rich",
              "Oracle Restricted",
              "Oracle Search",
            ].sort().join(", ")}`,
          );
          continue;
        }

        const result = await executeQuery(storage.fetcher.driver, captured.query, { parse });
        if ("count" in result) throw new Error(`${name}: unexpected count result`);
        const tsNames = await resultNames(storage.fetcher.lexicon, result.rows);
        const rubyNames = [...captured.result].sort();
        const pass =
          tsNames.length === rubyNames.length && tsNames.every((n, i) => n === rubyNames[i]);
        if (!pass) {
          failures.push(
            `${name} MISMATCH: ruby=${JSON.stringify(rubyNames)} ts=${JSON.stringify(tsNames)} sql=${result.sql}`,
          );
        }
      }
      expect(failures).toEqual([]);
    } finally {
      storage.close();
    }
  });
});
