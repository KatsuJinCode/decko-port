// R18 regression pin: the nest `item:<view>` opt reaches the search
// card_list. Mechanism under test (two seams):
//   1. format.ts Voo constructor — `:items` is an heir key
//      (view/options/key_lists.rb keymap[:both]); inherit_options_from_parent!
//      flows the nest's folded items hash down to the internally-dispatched
//      :card_list voo (coreView's renderView("card_list")).
//   2. format.ts nestOptionEntries — the folded hash rides the voo opts, so
//      the slot JSON carries it (live blog receipt:
//      "items":{"view":"titled"} after home_view — audit A-25).
// Consumer: views.ts cardListView — item_view_options[:view]
// (item.rb:157-162) names the item view; html default_item_view :bar when
// absent; wrapper classes parameterize on the same view
// (0_search/views.rb:110 "card-list card-list-#{item_view_options[:view]}
// search-result-list"; views.rb:130-136 "item-#{item_view}").
//
// Wire receipt: blog/Latest_News nest `Latest news item|item:titled`; live
// serves card-list-titled + search-result-item item-titled x9
// (tmp/wrong-goal-hunt captures). Before the fix the engine rendered bar
// items for every item:view — the origin's postProcessSearchCards bridge
// masked it (retired in r18).

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
  // idsByKey warm-up (see search-card-list-render-parity.test.ts — the CQL
  // `left:` value resolves through the enrichment-fed id map).
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
      // wrapper class string parameterizes on the item view
      // (search_views.rb:110).
      expect(html).toContain('<div class="card-list card-list-titled search-result-list">');
      // each result nests through the titled view (views.rb:130-136
      // item-#{item_view}).
      expect(html.match(/<div class="search-result-item item-titled">/g)?.length).toBe(2);
      expect(html).toContain('-titled-view"');
      // the slot JSON carries the folded items hash (audit A-25 shape).
      expect(html).toContain("&quot;items&quot;:{&quot;view&quot;:&quot;titled&quot;}");
      // the result content is present (titled view renders the body).
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
