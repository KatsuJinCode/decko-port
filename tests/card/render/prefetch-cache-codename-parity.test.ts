// Codename parity through the prefetch cache: regression test for the
// corpus:274 record real-fail (benchmarks/results/corpus-v2/
// replay-full-results.json, card-engine "codename":"all" vs null).
//
// Mechanism: prefetchInclusionClosure composes every walked card into the
// FETCH cache (PrefetchContext.cacheRecord). When the prefetch dropped the
// cards.codename column on the way through, the cached record lost it, and
// a later FetchEngine#fetchByName served the codename-less record - the
// corpus oracle then showed "codename":null for a card whose row carries
// codename "all". The fix threads codename through the prefetch rows; this
// test pins it end-to-end (render first, fetch after - the poisoning order).

import { describe, expect, it } from "vitest";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

describe("prefetch cache keeps the codename column (corpus:274 mechanism)", () => {
  it("fetchByName preserves the seeded codename before any render", async () => {
    const storage = await createRenderTestStorage();
    try {
      // the corpus row, verbatim shape (id 274, name "*all", codename "all",
      // type_id 259, content "fr")
      await seedCard(storage, {
        id: 274,
        name: "*all",
        key: "*all",
        codename: "all",
        typeId: 259,
        dbContent: "fr",
      });
      const card = await storage.fetcher.fetchByName("*all");
      expect(card?.codename).toBe("all");
    } finally {
      storage.close();
    }
  });

  it("a render whose inclusion closure reaches the codename card does not poison it", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, {
        id: 274,
        name: "*all",
        key: "*all",
        codename: "all",
        typeId: 259,
        dbContent: "fr",
      });
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      // the nesting card puts "*all" inside the prefetch's walked closure
      await seedCard(storage, {
        id: 300,
        name: "host page",
        typeId: 2,
        dbContent: "see {{*all|content}}",
      });
      await storage.engine.render("host page", "content");
      const after = await storage.fetcher.fetchByName("*all");
      expect(after?.codename).toBe("all");
    } finally {
      storage.close();
    }
  });
});
