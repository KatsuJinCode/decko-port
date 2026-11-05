// Tests for the DB-backed lexicon port (src/card/fetch/lexicon.ts <-
// card-1.110.0 lib/card/lexicon.rb) against real SQLite storage. Every
// expectation cites the Ruby method it derives from.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFetchTestStorage,
  seedCard,
  type FetchTestStorage,
} from "./fetch-test-storage.js";
import { cacheKey } from "../../../src/card/fetch/lexicon.js";

let storage: FetchTestStorage;

beforeEach(async () => {
  storage = await createFetchTestStorage();
});

afterEach(() => {
  storage.close();
});

describe("DbLexicon.id (lexicon.rb#id)", () => {
  it("resolves simple names by their key (lex_query { key: })", async () => {
    await seedCard(storage, { id: 10, name: "Home Page" });
    expect(await storage.engine.lexicon.id("Home Page")).toBe(10);
    // an already-canonical key string round-trips (name.to_name.key is idempotent)
    expect(await storage.engine.lexicon.id("home_page")).toBe(10);
  });

  it("resolves compound names through side-card ids (lexicon.rb#name_to_lex)", async () => {
    await seedCard(storage, { id: 10, name: "Left Part" });
    await seedCard(storage, { id: 11, name: "Right Part" });
    await seedCard(storage, { id: 12, name: "Left Part+Right Part" });
    expect(await storage.engine.lexicon.id("Left Part+Right Part")).toBe(12);
  });

  it("excludes trashed cards (lex_to_id merges trash: false, lexicon.rb:122)", async () => {
    await seedCard(storage, { id: 10, name: "Doomed", trash: true });
    expect(await storage.engine.lexicon.id("Doomed")).toBeUndefined();
  });

  it("returns undefined when a compound side is missing (name_to_lex &&)", async () => {
    await seedCard(storage, { id: 10, name: "Left Part" });
    expect(await storage.engine.lexicon.id("Left Part+Nobody")).toBeUndefined();
  });

  it("returns undefined for blank and relative-fragment inputs (lexicon.rb:21-26)", async () => {
    expect(await storage.engine.lexicon.id("")).toBeUndefined();
    expect(await storage.engine.lexicon.id("_left")).toBeUndefined();
  });
});

describe("DbLexicon.name (lexicon.rb#name)", () => {
  it("returns the stored name for simple cards (id_to_lex)", async () => {
    await seedCard(storage, { id: 10, name: "Home Page" });
    const name = await storage.engine.lexicon.name(10);
    expect(name?.s).toBe("Home Page");
  });

  it("composes compound names from side names (lex_to_name joins sides)", async () => {
    await seedCard(storage, { id: 10, name: "Left Part" });
    await seedCard(storage, { id: 11, name: "Right Part" });
    await seedCard(storage, { id: 12, name: "Left Part+Right Part" });
    const name = await storage.engine.lexicon.name(12);
    expect(name?.s).toBe("Left Part+Right Part");
  });

  it("resolves TRASHED cards' names by id - id_to_lex has NO trash filter (lexicon.rb:101-110)", async () => {
    await seedCard(storage, { id: 10, name: "Doomed", trash: true });
    expect((await storage.engine.lexicon.name(10))?.s).toBe("Doomed");
  });

  it("returns undefined when a side card is missing (lex_to_name's `name side_id or return`)", async () => {
    // junction row pointing at a nonexistent right card (broken lexicon)
    await seedCard(storage, { id: 10, name: "Left Part" });
    await seedCard(storage, { id: 12, name: "Left Part+Ghost", leftId: 10, rightId: 999 });
    expect(await storage.engine.lexicon.name(12)).toBeUndefined();
  });

  it("returns undefined for unknown ids (Ruby's (name || '').to_name blank fallback)", async () => {
    expect(await storage.engine.lexicon.name(4242)).toBeUndefined();
  });
});

describe("DbLexicon caching (Card::Cache[Lexicon])", () => {
  it("serves repeat lookups from cache without re-querying the database", async () => {
    await seedCard(storage, { id: 10, name: "Cached Card" });
    storage.counting.reset();

    await storage.engine.lexicon.id("Cached Card"); // miss: queries the db
    const afterFirst = storage.counting.queries;
    expect(afterFirst).toBeGreaterThan(0);
    await storage.engine.lexicon.id("Cached Card"); // cached: zero queries
    expect(storage.counting.queries).toBe(afterFirst);
    // simple lexes do NOT get a reverse (id -> name) entry (lexicon.rb:124
    // "don't store name, because lex might not be the canonical name"), so
    // name(10) queries once, and only once
    await storage.engine.lexicon.name(10);
    const afterName = storage.counting.queries;
    expect(afterName).toBeGreaterThan(afterFirst);
    await storage.engine.lexicon.name(10);
    expect(storage.counting.queries).toBe(afterName);
  });

  it("cacheKey uses 'L-<key>' for simple lexes and 'L-<left>-<right>' for arrays (lexicon.rb#cache_key)", () => {
    expect(cacheKey("Home Page")).toBe("L-home_page");
    expect(cacheKey([10, 11])).toBe("L-10-11");
  });

  it("writeTemp mirrors id->name and lex->id into the temp cache (lexicon.rb#write_to_temp_cache)", async () => {
    const lexicon = storage.engine.lexicon;
    lexicon.writeTemp(77, undefined, "mirrored_card");
    // the lex->id entry serves id() straight from cache - exactly Ruby's
    // "temp cache ahead of the database" semantics (cache.rb module doc);
    // no db row exists, so nothing else is known
    expect(await storage.engine.lexicon.id("mirrored_card")).toBe(77);
    expect(storage.counting.queries).toBe(0); // served from temp, not the db
    expect(lexicon.cache.temp.read("77")).toBeUndefined(); // name was nil
    // deleting the lex entry (as the write path does) restores the miss
    lexicon.deleteFor(77, "mirrored_card");
    expect(await storage.engine.lexicon.id("mirrored_card")).toBeUndefined();
  });

  it("compound id resolution caches the reverse id->lex entry (lex_to_id tap, lexicon.rb:125)", async () => {
    await seedCard(storage, { id: 10, name: "Left Part" });
    await seedCard(storage, { id: 11, name: "Right Part" });
    await seedCard(storage, { id: 12, name: "Left Part+Right Part" });
    await storage.engine.lexicon.id("Left Part+Right Part");
    // lex_to_id wrote id->lex under "12" so name(12) needs no db query
    expect(storage.engine.lexicon.cache.temp.read("12")).toEqual([10, 11]);
  });
});
