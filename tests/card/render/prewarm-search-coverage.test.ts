// Pin the byte-level contract of the render-perf prewarm fix (benchmarks/
// corpus-v2/prewarm-static-deck.ts:162-236): the prewarm must discover
// every Search-type card in the seeded deck by the SAME codename the engine
// gates on (card.typeCode === "search_type", the codename the type card's
// codehash carries — src/card/render.ts:1189 sets card.typeCode =
// peekNameForId(typeId) + render.ts:1258 + render.ts:1131). The original
// discovery gate read the type card's NAME ("Search") instead of its
// codename ("search_type"); corpus search-type cards carry a random-named
// type card (deck:30 codename=search_type, name=qnzkqz) so the old
// discovery skipped every card → searches=0 → closureWarm returned false
// for every search-type rule card after prewarm → warm-render-sample
// averaged 127-150ms (with a ~750ms cold-closure spike cluster, the 9
// "*right+*structure" rule cards in the first 60) and closureWarm-coverage
// was 47 cold cards.
//
// The fix: prewarm gates on codename, not name. Since the R4 lazy-parse
// seam (render.ts prepareSearches) a search card whose cql parse fails is
// recorded IN THE ENGINE (searchFailures marker + empty seat) and the walk
// completes — the raise moved to the dispatch boundary (engine.resolveView,
// view-gated on :open/:content per the capture census), so the prewarm's
// catch arm no longer feeds the render path at all. The pins below lock
// both halves: the seat coverage (closureWarm budget-0) and the boundary
// raise/NoRaise per view.

import { describe, expect, it } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
} from "./render-test-storage.js";
import { prewarmStaticDeck } from "../../../benchmarks/corpus-v2/prewarm-static-deck.js";
import type { RenderCard } from "../../../src/card/render.js";
import type { CardRecord } from "../../../src/card/fetch/card-record.js";

interface EnginePrewarmSeam {
  searchResults: Map<string, RenderCard[]>;
  renderCards: Map<string, RenderCard>;
  closureWarm(record: CardRecord): boolean;
}

interface PrewarmFailingSeed {
  id: number;
  name: string;
  /** The corrupted content (empty or non-JSON) that should trigger the
   *  prewarm's try/catch wrapper and seed searchResults with [] instead
   *  of propagating the BadQuery raise. */
  dbContent: string;
  /** Card key (DeckoName.parse(name).key — pre-canonicalized here). */
  key: string;
}

describe("prewarm-static-deck: Search-type coverage (post-1ec2761 parity fix)", () => {
  // ----- the discovery gate itself ---------------------------------------

  it("discovers Search-type cards by codename 'search_type', not by name 'Search' (corpus-shaped fixture)", async () => {
    // Prewarm fix: the type card's NAME is "qnzkqz" (NOT "Search"),
    // matching the bench-corpus shape; the codename is "search_type".
    // The fix discovers this card via peekNameForId(typeId) which reads
    // the codehash (src/card/fetch/codename.ts:80-82). The old
    // typeRecord?.name?.s !== 'Search' gate silently skipped it.
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 1, name: "Basic", codename: "basic", typeId: 1 });
      // The corpus-shaped type card: random name "qnzkqz",
      // codename "search_type".
      await seedCard(storage, { id: 2, name: "qnzkqz", codename: "search_type", typeId: 1 });
      // A pair of search-type cards, both with malformed content (the
      // prewarm's try/catch will catch runSearch throws here).
      const failing: PrewarmFailingSeed[] = [
        { id: 10, name: "search empty", dbContent: "", key: "search_empty" },
        {
          id: 11,
          name: "search non json",
          dbContent: "not even close to json",
          key: "search_non_json",
        },
      ];
      for (const f of failing) {
        await seedCard(storage, { id: f.id, name: f.name, typeId: 2, dbContent: f.dbContent });
      }

      const stats = await prewarmStaticDeck(storage);
      // Pin: the prewarm's `searches` counter must reflect BOTH failing
      // cards. Pre-fix: searches=0 (the name === "Search" gate skipped).
      // Post-fix: searches=2 (the try/catch counted them too).
      expect(stats.searches).toBe(failing.length);

      // Pin: each failing card's seat in searchResults is populated.
      // The engine's closureWarm check (src/card/render.ts:1131) reads
      // searchResults.has(key) — false before the fix, true after.
      const engine = storage.engine as unknown as EnginePrewarmSeam;
      for (const f of failing) {
        expect(engine.searchResults.has(f.key)).toBe(true);
        expect(engine.searchResults.get(f.key)).toEqual([]);
      }
    } finally {
      storage.close();
    }
  });

  // ----- the warm-closure contract the prewarm enables -------------------

  it("after prewarm, closureWarm returns true for every seeded search-type card (the budget-0 contract)", async () => {
    // The render-perf harness asserts closureWarm-coverage <= 0 (zero
    // cold cards on shard-0 after prewarm); this is the unit-level
    // pin for that promise. The harness scans shard-0 = 1000 cards;
    // we mirror the pattern at the fixture scale (3 search-type
    // cards of varying content validity) so a future prewarm
    // regression lands here before it lands in the 42-second harness
    // run.
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 1, name: "Basic", codename: "basic", typeId: 1 });
      await seedCard(storage, { id: 2, name: "qnzkqz", codename: "search_type", typeId: 1 });
      const failing: PrewarmFailingSeed[] = [
        { id: 20, name: "search a", dbContent: "", key: "search_a" },
        { id: 21, name: "search b", dbContent: "x", key: "search_b" },
        { id: 22, name: "search c", dbContent: '{"left":"name"}', key: "search_c" },
      ];
      for (const f of failing) {
        await seedCard(storage, { id: f.id, name: f.name, typeId: 2, dbContent: f.dbContent });
      }

      await prewarmStaticDeck(storage);
      const engine = storage.engine as unknown as EnginePrewarmSeam;

      for (const f of failing) {
        const rec: CardRecord | undefined = await storage.fetcher.fetchByName(f.key);
        if (rec === undefined) throw new Error(`seed-missing ${f.key}`);
        expect(engine.closureWarm(rec)).toBe(true);
      }
    } finally {
      storage.close();
    }
  });

  // ----- the byte-level interaction with the BadQuery sentinel -----------

  it("a non-prewarmed search-type card still raises BadQuery on :open, and :closed renders (the Ruby parity preserve)", async () => {
    // The prewarm's try/catch is permissive ONLY for itself. A direct
    // cold render of a Search-type card with malformed content must
    // still raise BadQueryError exactly as Ruby raises
    // Card::Error::BadQuery — the perf fix MUST NOT silence the
    // corpus's capture-error sentinel (search-bad-query-error.test.ts
    // pins the same shape with a unit fixture; this pin covers the
    // prewarm boundary so the fix's catch arm cannot leak into the
    // public render path).
    //
    // R4 lazy-parse seam: the raise moved from the prepare walk to the
    // dispatch boundary (engine.resolveView) and is VIEW-GATED — Ruby
    // parses only the result-rendering views. Capture census over all 105
    // corpus search-type cards: :closed/:title = real bytes 105/105 each
    // (:closed never raises — the previous shape of this pin asserted a
    // :closed raise, which mismatched the corpus on every search card);
    // :open/:content = CAPTURE_ERROR on the 24 invalid-content cards.
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 1, name: "Basic", codename: "basic", typeId: 1 });
      await seedCard(storage, { id: 2, name: "qnzkqz", codename: "search_type", typeId: 1 });
      await seedCard(storage, {
        id: 50,
        name: "search untreated",
        typeId: 2,
        dbContent: "garbage content the parse must reject",
      });

      // :closed renders real bytes (the 105/105 census shape).
      const closedHtml = await storage.engine.render("search_untreated", "closed");
      expect(closedHtml).toContain("search_untreated-closed-view");

      // :open raises the capture sentinel (the prewarm did not run here).
      let captured: unknown;
      try {
        await storage.engine.render("search_untreated", "open");
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(Error);
      const err = captured as Error;
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe(
        "Invalid JSON search query: garbage content the parse must reject",
      );
    } finally {
      storage.close();
    }
  });
});
