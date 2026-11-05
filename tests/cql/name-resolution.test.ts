// The CQL name->id resolution seam: parseOptionsWithLexicon (src/cql/
// execute.ts) backs ParseOptions.resolveCardId with the fetch layer's
// DbLexicon.peekId — the sync, warm-cache-only mirror of the same walk
// Lexicon.id performs. These tests pin the two properties that keep fetch
// and cql from drifting:
//
// 1. PARITY: on a warmed deck, peekId(name) === await id(name) for every
//    name shape CQL can carry (simple, compound, 3-part junction, key
//    string, unknown, blank, relative fragment).
// 2. HONEST COLD BEHAVIOR: before warming, peekId returns undefined (an
//    unknown name, never a wrong id); after warming one entry, exactly that
//    entry resolves.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeQuery, parseOptionsWithLexicon } from "../../src/cql/execute.js";
import type { DbLexicon } from "../../src/card/fetch/lexicon.js";
import {
  createCqlTestStorage,
  ORACLE_DECK_CARDS,
  seedOracleCaptureDeck,
  type CqlTestStorage,
} from "./cql-test-storage.js";

let storage: CqlTestStorage;
let lexicon: DbLexicon;

beforeAll(async () => {
  storage = await createCqlTestStorage();
  await seedOracleCaptureDeck(storage);
  lexicon = storage.fetcher.lexicon;
});

afterAll(() => {
  storage.close();
});

/** Every resolution shape a CQL name value can need, with the deck ids the
 *  oracle capture deck carries (cql-test-storage.ts). */
const NAME_BATTERY: Array<[string, number | undefined]> = [
  ["Oracle Junction", 606], // simple, left:/"name"-clause shape
  ["child_one", 607], // simple part card (right:/plus: shapes)
  ["Search", 98], // type restrict
  ["Cardtype", 3],
  ["Decko Bot", 1], // created_by restrict (card id 1 in the capture deck)
  ["Oracle Junction+child_one", 608], // compound: left/right id walk
  ["*to+*right+*content options", 157], // 3-part junction (recursive walk)
  ["*recent settings+*self", 484],
  ["Cards with accounts", 278], // singularizing key ("card_with_account")
  ["oracle_junction", 606], // key round-trips (key -> name -> key idempotent)
  ["No Such Card At All", undefined],
  ["", undefined], // blank (lexicon.rb:21)
  ["+child_one", undefined], // relative fragment (lexicon.rb:24)
  ["_left", undefined],
];

describe("DbLexicon.peekId / id parity on the warmed capture deck", () => {
  it("resolves every name shape exactly as the async walk does", async () => {
    const ids = (await storage.driver.query<{ id: number }>("SELECT id FROM cards", [])).rows.map(
      (row) => row.id,
    );
    await storage.fetcher.warmLexicon(ids);
    for (const [name, expected] of NAME_BATTERY) {
      const asyncId = await lexicon.id(name);
      const syncId = lexicon.peekId(name);
      expect(syncId, `${name}: peekId must equal the async walk`).toBe(asyncId);
      expect(syncId, `${name}: unexpected resolution`).toBe(expected);
    }
  });
});

describe("peekId warm-cache contract (sync seam honesty)", () => {
  it("returns undefined before warming and resolves after — never a wrong id", async () => {
    const fresh = await createCqlTestStorage();
    try {
      await seedOracleCaptureDeck(fresh);
      const coldLexicon = fresh.fetcher.lexicon;
      // cold: no db fallback in the sync path — unknown, not wrong
      expect(coldLexicon.peekId("Oracle Junction")).toBeUndefined();
      // warming ONE compound row recursively warms its sides AND the
      // compound's "L-<left>-<right>" reverse entry (idToLex + lexToName
      // recursion) — exactly the entries peekId's walk reads
      await coldLexicon.name(608);
      expect(coldLexicon.peekId("Oracle Junction")).toBe(606);
      expect(coldLexicon.peekId("child_one")).toBe(607);
      expect(coldLexicon.peekId("Oracle Junction+child_one")).toBe(608);
      // a row that was never warmed stays unresolved
      expect(coldLexicon.peekId("Search")).toBeUndefined();
    } finally {
      fresh.close();
    }
  });
});

describe("parseOptionsWithLexicon through executeQuery", () => {
  it("resolves restrict values (type/left/right/created_by) to real ids during interpretation", async () => {
    const ids = (await storage.driver.query<{ id: number }>("SELECT id FROM cards", [])).rows.map(
      (row) => row.id,
    );
    await storage.fetcher.warmLexicon(ids);
    const options = { parse: parseOptionsWithLexicon(lexicon) };

    const collected = async (statement: unknown): Promise<number[]> => {
      const result = await executeQuery(storage.driver, statement, options);
      if ("count" in result) throw new Error("unexpected count result");
      return result.rows.map((row) => row.id).sort((a, b) => a - b);
    };

    expect(await collected({ type: "Search" })).toEqual([100, 101, 157, 160, 163, 166, 170, 275, 278, 304, 352, 487, 614]);
    expect(await collected({ left: "Oracle Junction" })).toEqual([608, 610]);
    expect(await collected({ right: "child_one" })).toEqual([608]);
    expect(await collected({ created_by: "Decko Bot" })).toHaveLength(ORACLE_DECK_CARDS.length); // every modeled card is bot-created
    // unknown names take Ruby's -999 sentinel: an id that matches nothing
    expect(await collected({ left: "No Such Card At All" })).toEqual([]);
  });
});
