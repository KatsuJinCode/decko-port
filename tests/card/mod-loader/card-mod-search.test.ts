// The card-mod-search mod loader test: the mod loaded through the loader
// registers its seven ported views (count, search_count, search_error,
// one_line_content, goto_autocomplete_item, add_autocomplete_item,
// select2_option) and each view proves its Ruby-source semantics against
// seeded search decks.
//
// Proof shape (A/B per ported view):
//   WITHOUT the mod: render the view raises the unsupported-view error
//     (render.rb#view_method - the view does not exist on the live registry).
//   WITH the mod: the view renders the port's documented bytes; the
//     set-modules basket records the ported gem-tree entries; view
//     registration order matches the gem's pattern walk.
//
// The count/search_count/search_error views read the mod's prepareEngine
// count warm (card-mod-search.ts prepareSearchCounts - the boot-time
// Rule::Cache analog of 0_search.rb:35-39's lazy count search). Ruby
// computes the count per render; the port pre-executes every Search-typed
// card's count once per engine, recording rescued-BadQuery messages in a
// failure channel (0_search.rb:66-77 rescuing_bad_query RETURNS the
// exception, so search_count renders its message and search_error renders
// class :: message :: content). STATE: the warm maps are module-level,
// last-warm-wins - the big-deck test below therefore runs LAST and uses its
// own storage + engine so its warm does not clobber the main deck's counts
// mid-suite.
//
// Probe deck A (main storage):
//   - id 2 "Basic" (the items' type card), id 5 "Cardtype", id 200 "Search"
//     (type card for search cards, codename "search_type" - the codename
//     registry's SearchTypeID source)
//   - id 301 "A Search" (Search-typed, cql {"type":"Basic"}) with items
//     id 401-403 "Item One/Two/Three" (Basic)
//   - id 302 "Counting Search" (cql {"type":"Basic","return":"count"})
//   - id 303 "A Search+Outer" (junction: found_by "_left" -> A Search's cql)
//   - id 305 "A Search+Size" (found_by "_left" + return "count")
//   - id 307 "Empty Search" (cql matching nothing)
//   - id 308 "Item One+Bad Found" (found_by "_left" with a NON-search left -
//     found_by.rb:23-25 invalid_found_by_card!)
//
// Of the gem's eighteen missing html views (compat-report
// metrics.htmlViewsMissingNames for card-mod-search-0.20.0), seven are
// ported here; the other eleven are not headlessly portable (csv/rss
// formats, json core machinery, request-term params, subformat wrap bytes)
// - each documented with its reason in card-mod-search.ts and reported in
// viewsMissing.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { UnsupportedViewError } from "../../../src/card/render/format.js";
import {
  ModLoader,
  modEngineHost,
  setDefaultModLoader,
} from "../../../src/card/mod-loader.js";
import cardModSearch from "../../../src/card/mod-loader/mods/card-mod-search.js";
import cardModCollection from "../../../src/card/mod-loader/mods/card-mod-collection.js";

let storage: RenderTestStorage | undefined;
let bigStorage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;
let bigLoader: ModLoader | undefined;
let loadReport: ReturnType<ModLoader["load"]> | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  // type/codename cards (id 5 self-typed so it stays OUT of Basic matches)
  await seedCard(s, { id: 5, name: "Cardtype", typeId: 5 });
  await seedCard(s, { id: 2, name: "Basic", typeId: 5 });
  // the Search cardtype card: codename search_type = the SearchTypeID source
  await seedCard(s, { id: 200, name: "Search", codename: "search_type", typeId: 5 });

  // search cards (typeId 200 -> typeName "Search"); A Search's cql uses a
  // name-in list (key comparison - resolvable by BOTH the mod's count warm
  // and the engine's executeSearch, which only resolves names inside its
  // prefetch closure)
  await seedCard(s, {
    id: 301,
    name: "A Search",
    typeId: 200,
    dbContent: '{"name":["in","Item One","Item Two","Item Three"]}',
  });
  await seedCard(s, {
    id: 302,
    name: "Counting Search",
    typeId: 200,
    dbContent: '{"type":"Basic","return":"count"}',
  });
  // junctions: "A Search+Outer" (found_by _left), "A Search+Size"
  // (found_by _left + return count)
  await seedCard(s, { id: 304, name: "Outer", typeId: 5 });
  await seedCard(s, {
    id: 303,
    leftId: 301,
    rightId: 304,
    typeId: 200,
    dbContent: '{"found_by":"_left"}',
  });
  await seedCard(s, { id: 306, name: "Size", typeId: 5 });
  await seedCard(s, {
    id: 305,
    leftId: 301,
    rightId: 306,
    typeId: 200,
    dbContent: '{"found_by":"_left","return":"count"}',
  });
  // empty search (matches nothing)
  await seedCard(s, {
    id: 307,
    name: "Empty Search",
    typeId: 200,
    dbContent: '{"type":"No Such Type"}',
  });
  // found_by whose left is NOT a search card -> BadQuery at the warm
  await seedCard(s, { id: 309, name: "Bad Found", typeId: 5 });
  await seedCard(s, {
    id: 308,
    leftId: 401,
    rightId: 309,
    typeId: 200,
    dbContent: '{"found_by":"_left"}',
  });

  // the search results (Basic items)
  await seedCard(s, { id: 401, name: "Item One", typeId: 2, dbContent: "one body" });
  await seedCard(s, { id: 402, name: "Item Two", typeId: 2, dbContent: "two body" });
  await seedCard(s, { id: 403, name: "Item Three", typeId: 2, dbContent: "three body" });

  // the big deck for the number_with_delimiter grouping (storage B)
  bigStorage = await createRenderTestStorage();
  const b = bigStorage;
  await seedCard(b, { id: 5, name: "Cardtype", typeId: 5 });
  await seedCard(b, { id: 2, name: "Basic", typeId: 5 });
  await seedCard(b, { id: 200, name: "Search", codename: "search_type", typeId: 5 });
  await seedCard(b, {
    id: 501,
    name: "Big Search",
    typeId: 200,
    dbContent: '{"type":"Basic"}',
  });
  // 1001 Basic rows in bulk INSERTs (500 per statement)
  for (let chunkStart = 0; chunkStart < 1001; chunkStart += 500) {
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = chunkStart; i < Math.min(chunkStart + 500, 1001); i++) {
      values.push("(?, ?, ?, ?, ?, ?, ?, ?, ?)");
      params.push(600 + i, `Bulk Item ${i}`, `bulk_item_${i}`, 2, 0, 1, 1,
        "2026-09-19 00:00:00.000", "2026-09-19 00:00:00.000");
    }
    await b.counting.query(
      `INSERT INTO cards (id, name, key, type_id, trash, creator_id, updater_id, created_at, updated_at)
       VALUES ${values.join(", ")}`,
      params,
    );
  }
}, 60_000);

afterAll(() => {
  setDefaultModLoader(undefined);
  loader?.reset();
  bigLoader?.reset();
  storage?.close();
  bigStorage?.close();
});

describe("card-mod-search through the mod loader (A/B)", () => {
  it("WITHOUT the mod: every ported view raises UnsupportedViewError", async () => {
    const s = storage!;
    await expect(s.engine.render("A Search", "count")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("A Search", "search_count")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("A Search", "search_error")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("A Search", "one_line_content")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Item One", "goto_autocomplete_item")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Item One", "select2_option")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :count renders the warmed search count (set/abstract/0_search.rb:86 -> collection item.rb:180-182)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModSearch }]);
    loadReport = loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    // A Search's cql name-in list matches the three item cards
    const html = await s.engine.render("A Search", "count");
    expect(html).toBe("3");
  });

  it("WITH the mod: :count on a count-returning cql renders the same digits (0_search.rb:35-39 count forces return count)", async () => {
    const s = storage!;
    const html = await s.engine.render("Counting Search", "count");
    expect(html).toBe("3");
  });

  it("WITH the mod: :count through found_by '_left' resolves the left search card's count (found_by.rb:7-19)", async () => {
    const s = storage!;
    const html = await s.engine.render("A Search+Outer", "count");
    expect(html).toBe("3");
  });

  it("WITH the mod: :count on a found_by card whose left is not a Search card raises the Ruby BadQuery message (found_by.rb:23-25)", async () => {
    const s = storage!;
    await expect(s.engine.render("Item One+Bad Found", "count")).rejects.toThrow(
      /"found_by" value must be valid Search/,
    );
  });

  it("WITH the mod: :search_count renders the Integer branch for count-returning cql (0_search/views.rb:2-4)", async () => {
    const s = storage!;
    // Integer#to_s - no delimiter (the count view's html delimiter is
    // collection item.rb's, not this view's)
    expect(await s.engine.render("Counting Search", "search_count")).toBe("3");
  });

  it("WITH the mod: :search_count through found_by '_left' + return count renders the left card's count (views.rb:2-4)", async () => {
    const s = storage!;
    expect(await s.engine.render("A Search+Size", "search_count")).toBe("3");
  });

  it("WITH the mod: :search_count on a plain (non-count) cql refuses the ActiveRecord-inspect branch (views.rb:2-4 Array#to_s)", async () => {
    const s = storage!;
    await expect(s.engine.render("A Search", "search_count")).rejects.toThrow(
      /ActiveRecord#inspect/,
    );
  });

  it("WITH the mod: :search_count on an EMPTY result list renders '[]' (Array#to_s of [] - no objects to inspect)", async () => {
    const s = storage!;
    // the warm's count of 0 is exactly the empty result list; Ruby's
    // [].to_s == "[]" byte-for-byte
    expect(await s.engine.render("Empty Search", "search_count")).toBe("[]");
  });

  it("WITH the mod: :search_count on a rescued-BadQuery card renders the exception message (views.rb:2-4 + 0_search.rb:72-77 rescuing_bad_query returns the exception)", async () => {
    const s = storage!;
    // Ruby: search_with_params RESCUES the BadQuery and returns it; .to_s
    // renders the MESSAGE - found_by.rb:23-25's invalid_found_by_card!
    expect(await s.engine.render("Item One+Bad Found", "search_count")).toBe(
      '"found_by" value must be valid Search, but Item One is a Basic',
    );
  });

  it("WITH the mod: :search_error renders class :: message :: content (views.rb:6-8)", async () => {
    const s = storage!;
    // Card::Error::BadQuery = card-1.110.0 lib/card/error.rb:78; content =
    // the card's raw cql text
    expect(await s.engine.render("Item One+Bad Found", "search_error")).toBe(
      'Card::Error::BadQuery :: "found_by" value must be valid Search, but Item One is a Basic :: {"found_by":"_left"}',
    );
  });

  it("WITH the mod: :search_error on a healthy card refuses (Ruby's Integer/Array .message raises NoMethodError - no defined bytes)", async () => {
    const s = storage!;
    await expect(s.engine.render("A Search", "search_error")).rejects.toThrow(
      /rescued BadQuery/,
    );
  });

  it("WITH the mod: :one_line_content renders the link-item list (search_views.rb:40-48 + 0_search/views.rb:108-136)", async () => {
    const s = storage!;
    const html = await s.engine.render("A Search", "one_line_content");
    // klasses = "card-list card-list-#{item_view_options[:view]}
    // search-result-list" with the items view forced to :link
    expect(html).toContain("card-list card-list-link search-result-list");
    // card_list_item wraps each nest in .search-result-item.item-<view>
    expect(html).toContain('<div class="search-result-item item-link">');
    // each item renders the :link view (known-card anchor)
    expect(html).toContain('class="known-card"');
    expect(html).toContain("Item One");
    expect(html).toContain("Item Two");
    expect(html).toContain("Item Three");
  });

  it("WITH the mod: :one_line_content on empty results renders :no_search_results (0_search/views.rb:22-24 with_results)", async () => {
    const s = storage!;
    const html = await s.engine.render("Empty Search", "one_line_content");
    expect(html).toContain("search-no-results");
  });

  it("WITH the mod: :one_line_content on a NON-search card raises (the base compact view, card-mod-format base.rb:97, is not ported)", async () => {
    const s = storage!;
    await expect(s.engine.render("Item One", "one_line_content")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :goto_autocomplete_item renders the haml item with the forward icon (autocomplete.rb:6-8 + haml)", async () => {
    const s = storage!;
    const html = await s.engine.render("Item One", "goto_autocomplete_item");
    // autocomplete_item.haml: Haml single-quoted attrs, nested divs
    expect(html).toContain("<div class='autocomplete-item autocomplete-item-goto'>");
    expect(html).toContain("<div class='autocomplete-icon'>");
    // no +image card -> icon_tag(:forward) -> basket forward: :arrow_forward
    // (card-mod-bootstrap icon.rb:26, material library, Rails double quotes)
    expect(html).toContain('<i class="notranslate material-icons">arrow_forward</i>');
    // label = card.name (escaped by Haml)
    expect(html).toContain("<div class='autocomplete-label'>");
    expect(html).toContain("Item One");
  });

  it("WITH the mod: :add_autocomplete_item renders the add icon (autocomplete.rb:10-12; :add falls through icon_lookup)", async () => {
    const s = storage!;
    const html = await s.engine.render("Item Two", "add_autocomplete_item");
    expect(html).toContain("<div class='autocomplete-item autocomplete-item-add'>");
    expect(html).toContain('<i class="notranslate material-icons">add</i>');
    expect(html).toContain("Item Two");
  });

  it("WITH the mod: :select2_option renders the json hash bytes (autocomplete.rb:52-56)", async () => {
    const s = storage!;
    const json = await s.engine.render("Item One", "select2_option");
    expect(json).toBe('{"id":"~401","text":"Item One"}');
  });

  it("WITH the mod: every ported set module from the gem tree is in the basket", () => {
    const basket = loader!.setModules();
    // all/* -> base bucket (loader.ts#kindOfSetPath)
    const baseShortnames = basket.base.map((m) => m.shortname);
    expect(baseShortnames).toContain("All::Autocomplete");
    // abstract/* -> abstract bucket
    const abstractShortnames = basket.abstract.map((m) => m.shortname);
    expect(abstractShortnames).toContain("Abstract::Search");
    expect(abstractShortnames).toContain("Abstract::Search::Views");
    expect(abstractShortnames).toContain("Abstract::SearchViews");
    // the port registers no nonbase set modules (self/right/type files are
    // method-only)
    expect([...basket.nonbase.values()].flat()).toHaveLength(0);
  });

  it("WITH the mod: the mod loader's load report lists every ported view", () => {
    const report = loadReport ?? loader!.load();
    expect(report.registeredViews).toContain("count");
    expect(report.registeredViews).toContain("search_count");
    expect(report.registeredViews).toContain("search_error");
    expect(report.registeredViews).toContain("one_line_content");
    expect(report.registeredViews).toContain("goto_autocomplete_item");
    expect(report.registeredViews).toContain("add_autocomplete_item");
    expect(report.registeredViews).toContain("select2_option");
  });

  it("WITH the mod: the view configs match the gem's view settings", () => {
    // 0_search.rb:56/:86 view(:count, cache: :never)
    expect(loader!.viewConfigFor("count")?.cache).toBe("never");
    // 0_search/views.rb:2 view :search_count, cache: :never
    expect(loader!.viewConfigFor("search_count")?.cache).toBe("never");
    // 0_search/views.rb:6 view :search_error, cache: :never
    expect(loader!.viewConfigFor("search_error")?.cache).toBe("never");
    // search_views.rb:40 view :one_line_content, cache: :never
    expect(loader!.viewConfigFor("one_line_content")?.cache).toBe("never");
    // autocomplete.rb:10 view :add_autocomplete_item, unknown: true
    expect(loader!.viewConfigFor("add_autocomplete_item")?.unknown).toBe(true);
    // autocomplete.rb:53 view :select2_option, perms: :none
    expect(loader!.viewConfigFor("select2_option")?.perms).toBe("none");
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Item One", "content");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("one body");
  });

  it("WITH the mod: :count on a non-Search card delegates down the loader's view chain to card-mod-collection's count (set/format.rb:146-150 MRO)", async () => {
    const s = storage!;
    // Both mods, collection registered FIRST: the search mod's flat
    // registration wins the :count slot, and its fn hands non-Search
    // cards to the chain's next entry (All::Item - item.rb:118-120).
    const bothLoader = new ModLoader([
      { manifest: cardModCollection },
      { manifest: cardModSearch },
    ]);
    bothLoader.load();
    setDefaultModLoader(bothLoader);
    try {
      // Item One's dbContent "one body" -> the All::Item item count 1
      // (card-mod-collection item.rb:104-106 itemCount)
      expect(await s.engine.render("Item One", "count")).toBe("1");
      // Search cards still resolve the warm count, not the item split
      expect(await s.engine.render("A Search", "count")).toBe("3");
    } finally {
      setDefaultModLoader(undefined);
      bothLoader.reset(); // restores the pre-test flat registrations
    }
  });

  // LAST: this warm replaces the module-level count maps (last-warm-wins),
  // so every warm-reading assertion above must have run already.
  it("WITH the mod: :count groups digits with number_with_delimiter above 999 (collection item.rb:180-182)", async () => {
    const b = bigStorage!;
    bigLoader = new ModLoader([{ manifest: cardModSearch }]);
    bigLoader.load();
    await bigLoader.installInto(modEngineHost(b.engine, b.fetcher));
    // 1001 Basic cards
    const html = await b.engine.render("Big Search", "count");
    expect(html).toBe("1,001");
  });
});
