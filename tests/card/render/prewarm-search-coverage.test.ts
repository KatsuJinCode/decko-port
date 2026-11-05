

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

  dbContent: string;

  key: string;
}

describe("prewarm-static-deck: Search-type coverage (post-1ec2761 parity fix)", () => {

  it("discovers Search-type cards by codename 'search_type', not by name 'Search' (corpus-shaped fixture)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 1, name: "Basic", codename: "basic", typeId: 1 });

      await seedCard(storage, { id: 2, name: "qnzkqz", codename: "search_type", typeId: 1 });

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

      expect(stats.searches).toBe(failing.length);

      const engine = storage.engine as unknown as EnginePrewarmSeam;
      for (const f of failing) {
        expect(engine.searchResults.has(f.key)).toBe(true);
        expect(engine.searchResults.get(f.key)).toEqual([]);
      }
    } finally {
      storage.close();
    }
  });

  it("after prewarm, closureWarm returns true for every seeded search-type card (the budget-0 contract)", async () => {

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

  it("a non-prewarmed search-type card still raises BadQuery on :open, and :closed renders (the Ruby parity preserve)", async () => {

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

      const closedHtml = await storage.engine.render("search_untreated", "closed");
      expect(closedHtml).toContain("search_untreated-closed-view");

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
