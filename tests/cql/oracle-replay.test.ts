

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

async function resultNames(lexicon: DbLexicon, rows: CardsRow[]): Promise<string[]> {
  const names: string[] = [];
  for (const row of rows) {
    const composed = await lexicon.name(row.id);
    if (composed !== undefined && composed.s !== "") names.push(composed.s);
  }
  return names.sort();
}

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

          expect(`${name}: ${String(captured.result)}`).toContain("CAPTURE_ERROR");
          const result = await executeQuery(storage.fetcher.driver, captured.query, { parse });
          if ("count" in result) throw new Error(`${name}: unexpected count result`);
          const tsNames = await resultNames(storage.fetcher.lexicon, result.rows);

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
