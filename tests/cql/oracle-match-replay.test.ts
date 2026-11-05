// CQL match oracle parity: replays the 30 captured query entries in
// fixtures/captured/cql-mysql-match.json through the REAL execution path —
// executeQuery (parseCql -> generateSql -> LocalSqliteDriver with the
// REGEXP UDF, src/cql/sqlite-regexp.ts) — against a seeded reconstruction
// of the MySQL-rung probe deck (tools/oracle/cql_match_capture.rb), and
// name-SET-compares each result against Ruby's recording.
//
// PROVENANCE: the fixture was captured on the MySQL rung of the oracle
// harness — the same oracle app as cql-basic.json but running on a scratch
// MariaDB 11.4.5 server (utf8mb4_general_ci), where card 1.110's CQL `match`
// compiles to `name REGEXP ? OR db_content REGEXP ?` and actually executes
// (on SQLite the oracle can only record the raise — see the match_sentinel
// in cql-basic.json). docs/oracle-harness.md "MySQL rung" has the full
// mechanism chain with citations.
//
// KNOWN DIVERGENCES (pinned, not swept aside): the JS RegExp behind the UDF
// does not speak the full PCRE/ICU dialect MariaDB/MySQL accept. Three
// `~~` raw-regex entries diverge TODAY with three distinct failure shapes:
//   - raw_posix_alpha: JS has no [[:alpha:]] — silently mismatches (compiles
//     as a character class of the literal chars) instead of erroring;
//   - raw_mysql57_wordstart: [[:<:]] silently mismatches the same way
//     (MariaDB accepts it; MySQL 8 ICU errors on it — server-side variance);
//   - raw_unicode_class: \p{Han} without the `u` flag degrades to a literal
//     "p{Han}" match (the `u` flag is not available: the escaped-literal
//     shape relies on Annex-B identity escapes).
// Each pin asserts the exact TS result against the Ruby result; upgrading
// the UDF to translate these constructs fails the pin and the test must be
// upgraded with it. Everything else is strict set parity, 27/30.
//
// rendered_match_search is in the fixture but not replayed here: it is the
// byte oracle for the render stream's Search-result views (slot-id and
// card-id normalized per house rules), not a CQL result set.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { executeQuery, parseOptionsWithLexicon } from "../../src/cql/execute.js";
import type { DbLexicon } from "../../src/card/fetch/lexicon.js";
import type { CardsRow } from "../../src/server/schema.js";
import {
  createCqlTestStorage,
  seedOracleCaptureDeck,
  type CqlSeedCard,
  type CqlTestStorage,
} from "./cql-test-storage.js";
import { DeckoName } from "../../src/card/name.js";

interface CapturedMatch {
  mechanism: Record<string, unknown>;
  queries: Record<string, { query: Record<string, unknown>; result: string[] | string }>;
}

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Result names recomposed through the fetch layer's Lexicon walk, sorted:
 *  the comparison is name-SET parity (same contract as oracle-replay). */
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

// ---------------------------------------------------------------------------
// The MySQL-rung probe deck, modeled (tools/oracle/cql_match_capture.rb
// SEEDS; ids 700+ — above every modeled standard card, preserving the
// id-order sort windows the standard deck's entries depend on).
// ---------------------------------------------------------------------------
export const MATCHPROBE_DECK_CARDS: CqlSeedCard[] = [
  { id: 700, name: "Matchprobe Alpha", typeId: 2, dbContent: "the quick brown fox jumps over the lazy dog" },
  { id: 701, name: "Matchprobe Beta", typeId: 2, dbContent: "a calm brown cow grazes quietly" },
  { id: 702, name: "Matchprobe UPPER", typeId: 2, dbContent: "shouting UPPERCASE token inside lowercase text" },
  { id: 703, name: "matchprobe lower", typeId: 2, dbContent: "quiet lowercase body" },
  { id: 704, name: "Matchprobe Punct", typeId: 2, dbContent: "grep (regex) [braces] + plus.dot? no! a|b ^carat $end" },
  { id: 705, name: "Matchprobe Dots", typeId: 2, dbContent: "wel.come welxcome wellcome welwel version v2.0 beta" },
  { id: 706, name: "Matchprobe Unicode", typeId: 2, dbContent: "words: naïve café Zürich NAÏVE repeat 日本語テキスト" },
  { id: 707, name: "Matchprobe Compound", typeId: 2, dbContent: "compound parent carries the token" },
  { id: 708, name: "zeta", typeId: 2 },
  { id: 709, name: "Matchprobe Compound+zeta", leftId: 707, rightId: 708, typeId: 2, dbContent: "child body without the magic word" },
  { id: 710, name: "Matchprobe Search", typeId: 98, dbContent: '{"match":"matchprobe","sort":"name"}' },
];

// db_content corrections on the modeled standard deck, required by two
// captured entries (nullness is the load-bearing property, read off the
// capture deck's own rows):
// - *all+*read matched raw_posix_alpha's [[:alpha:]]+ through CONTENT
//   (its name column is NULL) -> db_content non-null ("Anyone", the real
//   rule value per docs/oracle-harness.md).
// - *all+*default did NOT match it (absent from Ruby's result despite the
//   lowest ids) -> its db_content is NULL in the capture deck. NULL stays.
const STANDARD_CONTENT_PATCH: Record<number, string> = {
  10: "Anyone",
  14: "Cardtype description body",
  19: "User description body",
  29: "Cardtype type rule body",
};

async function seedMatchprobeDeck(storage: CqlTestStorage): Promise<void> {
  const insert =
    "INSERT INTO cards (id, name, key, codename, left_id, right_id, current_revision_id, " +
    "created_at, updated_at, creator_id, updater_id, read_rule_class, read_rule_id, " +
    "references_expired, trash, type_id, db_content) " +
    "VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, 1, NULL, NULL, NULL, 0, ?, ?)";
  for (const card of [...MATCHPROBE_DECK_CARDS].sort((a, b) => a.id - b.id)) {
    const compound = card.name !== undefined && card.name.includes("+");
    if (compound && (card.leftId === undefined || card.rightId === undefined)) {
      throw new Error(`compound seed ${card.id} (${card.name}) needs leftId and rightId`);
    }
    const nameColumn = compound ? null : (card.name ?? null);
    const keyValue =
      compound || card.name === undefined ? null : DeckoName.parse(card.name).key;
    await storage.driver.query(insert, [
      card.id,
      nameColumn,
      keyValue,
      card.codename ?? null,
      compound ? card.leftId! : null,
      compound ? card.rightId! : null,
      "2026-09-21 00:00:00.000",
      "2026-09-21 00:00:00.000",
      card.typeId ?? 2,
      card.dbContent ?? null,
    ]);
  }
  // patch standard-deck contents the captured entries depend on
  for (const [id, content] of Object.entries(STANDARD_CONTENT_PATCH)) {
    await storage.driver.query("UPDATE cards SET db_content = ? WHERE id = ?", [
      content,
      Number(id),
    ]);
  }
}

// The three pinned dialect divergences: entry name -> why (see header).
const KNOWN_DIVERGENCES = new Set([
  "raw_posix_alpha",
  "raw_mysql57_wordstart",
  "raw_unicode_class",
]);

describe("oracle replay: CQL match (MySQL rung, 30 entries)", () => {
  it("strict name-set parity for the 27 dialect-clean entries", async () => {
    const fixture = JSON.parse(
      readFileSync(`${REPO_ROOT}/fixtures/captured/cql-mysql-match.json`, "utf8"),
    ) as CapturedMatch;
    const storage = await createCqlTestStorage();
    try {
      await seedOracleCaptureDeck(storage);
      await seedMatchprobeDeck(storage);
      await warmDeckLexicon(storage);
      const parse = parseOptionsWithLexicon(storage.fetcher.lexicon);

      const failures: string[] = [];
      for (const [name, captured] of Object.entries(fixture.queries)) {
        if (KNOWN_DIVERGENCES.has(name)) continue;
        if (!Array.isArray(captured.result)) {
          failures.push(`${name}: non-array oracle result (unexpected on the MySQL rung)`);
          continue;
        }
        const rubyNames = [...captured.result].sort();
        let tsNames: string[];
        try {
          const result = await executeQuery(storage.fetcher.driver, captured.query, { parse });
          if ("count" in result) throw new Error(`${name}: unexpected count result`);
          tsNames = await resultNames(storage.fetcher.lexicon, result.rows);
        } catch (e) {
          tsNames = [`EXECUTE_ERROR: ${(e as Error).message}`];
        }
        const pass =
          tsNames.length === rubyNames.length && tsNames.every((n, i) => n === rubyNames[i]);
        if (!pass) {
          failures.push(
            `${name} MISMATCH: ruby=${JSON.stringify(rubyNames)} ts=${JSON.stringify(tsNames)}`,
          );
        }
      }
      expect(failures).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("pinned dialect divergences: 3 raw-regex entries where JS loses to PCRE (upgrade fails these loudly)", async () => {
    const fixture = JSON.parse(
      readFileSync(`${REPO_ROOT}/fixtures/captured/cql-mysql-match.json`, "utf8"),
    ) as CapturedMatch;
    const storage = await createCqlTestStorage();
    try {
      await seedOracleCaptureDeck(storage);
      await seedMatchprobeDeck(storage);
      await warmDeckLexicon(storage);
      const parse = parseOptionsWithLexicon(storage.fetcher.lexicon);

      for (const name of KNOWN_DIVERGENCES) {
        const captured = fixture.queries[name];
        if (!captured || !Array.isArray(captured.result)) {
          throw new Error(`${name}: pin references a missing/non-array fixture entry`);
        }
        const rubyNames = [...captured.result].sort();
        const result = await executeQuery(storage.fetcher.driver, captured.query, { parse });
        if ("count" in result) throw new Error(`${name}: unexpected count result`);
        const tsNames = await resultNames(storage.fetcher.lexicon, result.rows);
        const same =
          tsNames.length === rubyNames.length && tsNames.every((n, i) => n === rubyNames[i]);
        // The pin holds only while the TS side silently returns less than
        // Ruby. Three failure shapes are all "silent no-match" today — the
        // most dangerous kind for a search engine (no error, just missing
        // rows). An upgrade that translates these constructs (see
        // docs/cql-match-decision.md) flips `same` to true and fails here;
        // upgrade this test together with the UDF.
        expect(same, `${name}: pin stale — TS now matches Ruby`).toBe(false);
      }
    } finally {
      storage.close();
    }
  });
});
