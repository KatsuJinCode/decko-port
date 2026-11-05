

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

  await seedCard(s, { id: 5, name: "Cardtype", typeId: 5 });
  await seedCard(s, { id: 2, name: "Basic", typeId: 5 });

  await seedCard(s, { id: 200, name: "Search", codename: "search_type", typeId: 5 });

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

  await seedCard(s, {
    id: 307,
    name: "Empty Search",
    typeId: 200,
    dbContent: '{"type":"No Such Type"}',
  });

  await seedCard(s, { id: 309, name: "Bad Found", typeId: 5 });
  await seedCard(s, {
    id: 308,
    leftId: 401,
    rightId: 309,
    typeId: 200,
    dbContent: '{"found_by":"_left"}',
  });

  await seedCard(s, { id: 401, name: "Item One", typeId: 2, dbContent: "one body" });
  await seedCard(s, { id: 402, name: "Item Two", typeId: 2, dbContent: "two body" });
  await seedCard(s, { id: 403, name: "Item Three", typeId: 2, dbContent: "three body" });

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

    expect(await s.engine.render("Empty Search", "search_count")).toBe("[]");
  });

  it("WITH the mod: :search_count on a rescued-BadQuery card renders the exception message (views.rb:2-4 + 0_search.rb:72-77 rescuing_bad_query returns the exception)", async () => {
    const s = storage!;

    expect(await s.engine.render("Item One+Bad Found", "search_count")).toBe(
      '"found_by" value must be valid Search, but Item One is a Basic',
    );
  });

  it("WITH the mod: :search_error renders class :: message :: content (views.rb:6-8)", async () => {
    const s = storage!;

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

    expect(html).toContain("card-list card-list-link search-result-list");

    expect(html).toContain('<div class="search-result-item item-link">');

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

    expect(html).toContain("<div class='autocomplete-item autocomplete-item-goto'>");
    expect(html).toContain("<div class='autocomplete-icon'>");

    expect(html).toContain('<i class="notranslate material-icons">arrow_forward</i>');

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

    const baseShortnames = basket.base.map((m) => m.shortname);
    expect(baseShortnames).toContain("All::Autocomplete");

    const abstractShortnames = basket.abstract.map((m) => m.shortname);
    expect(abstractShortnames).toContain("Abstract::Search");
    expect(abstractShortnames).toContain("Abstract::Search::Views");
    expect(abstractShortnames).toContain("Abstract::SearchViews");

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

    expect(loader!.viewConfigFor("count")?.cache).toBe("never");

    expect(loader!.viewConfigFor("search_count")?.cache).toBe("never");

    expect(loader!.viewConfigFor("search_error")?.cache).toBe("never");

    expect(loader!.viewConfigFor("one_line_content")?.cache).toBe("never");

    expect(loader!.viewConfigFor("add_autocomplete_item")?.unknown).toBe(true);

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

    const bothLoader = new ModLoader([
      { manifest: cardModCollection },
      { manifest: cardModSearch },
    ]);
    bothLoader.load();
    setDefaultModLoader(bothLoader);
    try {

      expect(await s.engine.render("Item One", "count")).toBe("1");

      expect(await s.engine.render("A Search", "count")).toBe("3");
    } finally {
      setDefaultModLoader(undefined);
      bothLoader.reset();
    }
  });

  it("WITH the mod: :count groups digits with number_with_delimiter above 999 (collection item.rb:180-182)", async () => {
    const b = bigStorage!;
    bigLoader = new ModLoader([{ manifest: cardModSearch }]);
    bigLoader.load();
    await bigLoader.installInto(modEngineHost(b.engine, b.fetcher));

    const html = await b.engine.render("Big Search", "count");
    expect(html).toBe("1,001");
  });
});
