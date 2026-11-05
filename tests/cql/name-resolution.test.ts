

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

const NAME_BATTERY: Array<[string, number | undefined]> = [
  ["Oracle Junction", 606],
  ["child_one", 607],
  ["Search", 98],
  ["Cardtype", 3],
  ["Decko Bot", 1],
  ["Oracle Junction+child_one", 608],
  ["*to+*right+*content options", 157],
  ["*recent settings+*self", 484],
  ["Cards with accounts", 278],
  ["oracle_junction", 606],
  ["No Such Card At All", undefined],
  ["", undefined],
  ["+child_one", undefined],
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

      expect(coldLexicon.peekId("Oracle Junction")).toBeUndefined();

      await coldLexicon.name(608);
      expect(coldLexicon.peekId("Oracle Junction")).toBe(606);
      expect(coldLexicon.peekId("child_one")).toBe(607);
      expect(coldLexicon.peekId("Oracle Junction+child_one")).toBe(608);

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
    expect(await collected({ created_by: "Decko Bot" })).toHaveLength(ORACLE_DECK_CARDS.length);

    expect(await collected({ left: "No Such Card At All" })).toEqual([]);
  });
});
