

import { describe, expect, it } from "vitest";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

async function seedOracleSearchDeck(storage: Awaited<ReturnType<typeof createRenderTestStorage>>): Promise<void> {
  await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
  await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
  await seedCard(storage, { id: 701, name: "child_one", typeId: 2 });
  await seedCard(storage, { id: 702, name: "child_two", typeId: 2 });
  await seedCard(storage, { id: 606, name: "Oracle Junction", typeId: 2, dbContent: "Junction parent card." });
  await seedCard(storage, {
    id: 608,
    name: "Oracle Junction+child_one",
    leftId: 606,
    rightId: 701,
    typeId: 2,
    dbContent: "first child",
  });
  await seedCard(storage, {
    id: 610,
    name: "Oracle Junction+child_two",
    leftId: 606,
    rightId: 702,
    typeId: 2,
    dbContent: "second child",
  });
  await seedCard(storage, {
    id: 614,
    name: "Oracle Search",
    typeId: 98,
    dbContent: '{"left":"Oracle Junction","sort":"name"}',
  });

  await storage.engine.render("Oracle Junction", "content");
}

describe("search card_list item view — the nest item:<view> opt (R18)", () => {
  it("item:titled nest renders card-list-titled with item-titled slots", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      await seedCard(storage, {
        id: 620,
        name: "Titled Host",
        typeId: 2,
        dbContent: "{{Oracle Search|item:titled}}",
      });
      const html = await storage.engine.render("Titled Host", "content");

      expect(html).toContain('<div class="card-list card-list-titled search-result-list">');

      expect(html.match(/<div class="search-result-item item-titled">/g)?.length).toBe(2);
      expect(html).toContain('-titled-view"');

      expect(html).toContain("&quot;items&quot;:{&quot;view&quot;:&quot;titled&quot;}");

      expect(html).toContain("first child");
      expect(html).toContain("second child");
    } finally {
      storage.close();
    }
  });

  it("bare nest keeps the html default_item_view :bar", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      await seedCard(storage, {
        id: 621,
        name: "Bare Host",
        typeId: 2,
        dbContent: "{{Oracle Search}}",
      });
      const html = await storage.engine.render("Bare Host", "content");
      expect(html).toContain('<div class="card-list card-list-bar search-result-list">');
      expect(html.match(/<div class="search-result-item item-bar">/g)?.length).toBe(2);
      expect(html).not.toContain("card-list-titled");
    } finally {
      storage.close();
    }
  });
});
