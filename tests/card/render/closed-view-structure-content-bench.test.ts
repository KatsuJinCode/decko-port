// Closed-view hot-spot regression: the closed view of a basic-type card
// with non-trivial content on the prewarmed corpus deck used to spend
// ~26-33 s of CPU in applyStructureContent's per-card loop. That loop
// resolved every prepared card's pattern input via 4 awaited fetches
// even when every fetch was a cache hit — 37k compound cards × 4 awaits
// = ~150k microtask hops, all to derive the SAME pattern input that
// enrichAndStore had already encoded on the render card. The fix builds
// the pattern input synchronously from the already-enriched RenderCard:
// leftTypeName from the render-card map, isRule from a sync walk of
// right/left record typeIds against ruleTypeIds.
//
// Measured numbers (shard-000000, 47,113 prepared render cards,
// ~37k compound):
//   BEFORE: applyStructureContent cold       33,495 ms
//           applyStructureContent cold run 2 26,236 ms
//           closed-view render (cold-equiv) 27,339 ms
//   AFTER:  applyStructureContent cold          1,072 ms
//           applyStructureContent cold run 2    1,084 ms
//           closed-view render (cold-equiv)       896 ms
//           warm closed-view render                21 ms
//
// New complexity class: O(n) over render-cards with zero awaits in the
// inner loop, where n = renderCards.size. Old: O(n × awaited-fetches)
// where each "cache-hit fetch" still paid a microtask boundary.
//
// Run: node C:/localProjects/decko-ts/node_modules/vitest/vitest.mjs run
//   --root C:/localProjects/decko-ts
//   tests/card/render/closed-view-structure-content-bench.test.ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  CORPUS_DB,
  createStructureSeededStorageFor,
  readShardLines,
} from "./structure-corpus-seeding.js";
import { prewarmStaticDeck } from "../../../benchmarks/corpus-v2/prewarm-static-deck.js";

/** Compare two HTML strings ignoring the random data-slot-id field
 *  (capture-time placeholder is the literal "RANDOMIZED"; engine emits
 *  a fresh per-render id). */
function bytesEqualModuloRandomSlotId(actual: string, expected: string): boolean {
  const norm = (s: string): string => s.replace(/data-slot-id="[^"]*"/g, 'data-slot-id="RANDOMIZED"');
  return norm(actual) === norm(expected);
}

describe("closed-view hot-spot: applyStructureContent sync pattern input", () => {
  it(
    "renders ynxkmsesggismplqulbsud:closed in O(renderCards) with byte parity",
    { timeout: 600_000 },
    async () => {
      const corpus = new Database(CORPUS_DB, { readonly: true });
      const ids = corpus.prepare("SELECT id FROM cards WHERE trash = 0").all().map((r: any) => r.id);
      corpus.close();
      const storage = await createStructureSeededStorageFor(new Set(ids));
      const tPre = Date.now();
      await prewarmStaticDeck(storage);
      console.log("[bench] prewarm ms:", Date.now() - tPre);

      // Capture expected closed-view bytes from the fixture.
      const targetName = "ynxkmsesggismplqulbsud";
      let expectedClosed = "";
      for (const line of readShardLines()) {
        if (line.name === targetName && line.views && line.views.closed) {
          expectedClosed = line.views.closed as string;
          break;
        }
      }
      expect(expectedClosed).not.toBe("");

      // Warm-settle: one render populates the prepare-phase caches.
      const tSettle = Date.now();
      const settled = await storage.engine.render(targetName, "closed");
      console.log("[bench] first render (settle) ms:", Date.now() - tSettle);
      expect(bytesEqualModuloRandomSlotId(settled, expectedClosed)).toBe(true);

      // Time a cold-equivalent render: drop the prepare-phase caches so
      // applyStructureContent must walk the whole render-cards map again.
      const engAny = storage.engine as unknown as {
        structureProcessed: Set<string>;
      };
      engAny.structureProcessed = new Set();
      const tCold = Date.now();
      const coldActual = await storage.engine.render(targetName, "closed");
      const coldMs = Date.now() - tCold;
      console.log(`[bench] cold-equivalent closed-view render ms: ${coldMs}`);
      // Pre-fix measured 26-33 s for this same call (the applyStructureContent
      // loop dominated). The sync pattern input reduces it to roughly the
      // time of an O(n) loop over renderCards (~1-2 s on the 47k-card deck).
      expect(coldMs).toBeLessThan(10_000);
      expect(bytesEqualModuloRandomSlotId(coldActual, expectedClosed)).toBe(true);

      // Same again: the second cold-equivalent pass must also stay in budget.
      engAny.structureProcessed = new Set();
      const tCold2 = Date.now();
      const coldActual2 = await storage.engine.render(targetName, "closed");
      const coldMs2 = Date.now() - tCold2;
      console.log(`[bench] cold-equivalent closed-view render (run 2) ms: ${coldMs2}`);
      expect(coldMs2).toBeLessThan(10_000);
      expect(bytesEqualModuloRandomSlotId(coldActual2, expectedClosed)).toBe(true);

      // Warm render (prepare-phase caches populated): must stay sub-second.
      const tWarm = Date.now();
      const warmActual = await storage.engine.render(targetName, "closed");
      const warmMs = Date.now() - tWarm;
      console.log(`[bench] warm closed-view render ms: ${warmMs}`);
      expect(warmMs).toBeLessThan(1_000);
      expect(bytesEqualModuloRandomSlotId(warmActual, expectedClosed)).toBe(true);

      storage.close();
    }
  );
});
