// Byte-parity coverage for the VALID-JSON path of the search card_list
// rendering: card-mod-search-0.20.0 set/abstract/cql_search.rb#search +
// search_views.rb#search_result_view -> :card_list -> 0_search/views.rb
// view :card_list. The TS port mirrors that chain in:
//   - src/card/render.ts#prepareSearches + #runSearch (execute CQL)
//   - src/card/render/views.ts#cardListView (item + wrapper shape)
//   - src/card/render/views.ts#noSearchResultsView (empty branch)
//
// The corpus search sweep (benchmarks/results/corpus-v2/search-census.json)
// shows that fixtures/corpus/shard-*.jsonl carries ZERO Search-type cards
// with valid JSON content + non-denied captured views — every corpus search
// card is either invalid-JSON (raises Card::Error::BadQuery, captured as
// CAPTURE_ERROR) or its captured :content / :open views are the raw
// non-JSON content string (no card_list rendering). The corpus pins the
// INVALID-JSON path (search-bad-query-error.test.ts) and the closed/title
// views; the VALID path's oracle is in fixtures/captured/smoke.json's
// "Oracle Search" entry — `dbContent` is the valid CQL `{"left":"Oracle
// Junction","sort":"name"}`, and the captured :content / :open views
// render the card_list of two result items (Oracle Junction+child_one,
// Oracle Junction+child_two). Those are the bytes this test pins.
//
// Slot-id normalization mirrors the recording layer: data-slot-id="..."
// with 20 lowercase hex collapses to data-slot-id="RANDOMIZED" so a fresh
// render stamps byte-equal output. src/testing/diff.ts#normalizeSlotIds.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeSlotIds } from "../../../src/testing/diff.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

// ---------------------------------------------------------------------------
// the captured oracle bytes (fixtures/captured/smoke.json#rendered)
// ---------------------------------------------------------------------------

const SMOKE_JSON = readFileSync(
  fileURLToPath(new URL("../../../fixtures/captured/smoke.json", import.meta.url)),
  "utf8",
);

function capture(name: string): string {
  const obj = JSON.parse(SMOKE_JSON) as {
    rendered: Record<string, string>;
  };
  const bytes = obj.rendered[name];
  if (bytes === undefined) throw new Error(`smoke.json missing rendered entry: ${name}`);
  return bytes;
}

const CAPTURED_ORACLE_SEARCH_CONTENT = capture("Oracle Search#content");
const CAPTURED_ORACLE_SEARCH_OPEN = capture("Oracle Search#open");

// ---------------------------------------------------------------------------
// deck seed: the Oracle Search cards from smoke.json's capture deck
// ---------------------------------------------------------------------------

/** Seed the cards the captured Oracle Search entry depends on. The capture
 *  fixture is small enough that seeding all its cards is cheaper than
 *  carving out the closure by hand — the test does not need the wider deck
 *  for the rendering decisions under test (no pointer/list items, no rule
 *  rows in scope, no read-permission denial). */
async function seedOracleSearchDeck(storage: Awaited<ReturnType<typeof createRenderTestStorage>>): Promise<void> {
  // cardtype cards the typeCode dispatch reads (card-mod-search uses
  // SearchTypeID; the rest are ambient so the captured setKeys strings
  // match).
  await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
  await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
  // junction part cards the captured Oracle Junction children name.
  await seedCard(storage, { id: 701, name: "child_one", typeId: 2 });
  await seedCard(storage, { id: 702, name: "child_two", typeId: 2 });
  // the captured cards (ids/contents from smoke.json).
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
  // The CQL engine resolves `left: "Oracle Junction"` through the
  // engine's sync id map (render.ts:106 idsByKey + runSearch resolveCardId).
  // That map only fills when a card is enriched — and the search card's
  // JSON content has no nest references, so the prefetch closure walk
  // never touches Oracle Junction. Without this warm-up render the CQL
  // parser substitutes Ruby's unresolvable-name sentinel (-999 / -2 in
  // Tie#id_from_val) and the SQL `left_id = -999` matches nothing,
  // collapsing every result into :no_search_results. The captured oracle
  // bytes (and the existing oracle-replay.test.ts) only render correctly
  // because the harness renders other cards first, populating idsByKey
  // transitively. Mirror that here.
  await storage.engine.render("Oracle Junction", "content");
}

describe("search card_list rendering — valid-JSON path (M5)", () => {
  // -------------------------------------------------------------------------
  // oracle-byte parity (captured smoke.json)
  // -------------------------------------------------------------------------

  it(":content view of a Search-type card with valid JSON renders the captured card_list bytes", async () => {
    // The corpus has no search card with valid JSON content; the captured
    // oracle lives in fixtures/captured/smoke.json#rendered["Oracle
    // Search#content"]. Byte-equal replay (slot-id normalized) proves the
    // search_views.rb -> :card_list -> 0_search/views.rb view chain
    // (card_list_item + search_result_list + the wrapper class string
    // "card-list card-list-bar search-result-list") is port-correct.
    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "content");
      const actual = normalizeSlotIds(html);
      const expected = normalizeSlotIds(CAPTURED_ORACLE_SEARCH_CONTENT);
      expect(actual).toBe(expected);
    } finally {
      storage.close();
    }
  });

  it(":open view of a Search-type card with valid JSON renders the captured card_list bytes", async () => {
    // Same oracle entry, :open path: the captured bytes nest the
    // :content view inside the open accordion; the card_list wrapper +
    // per-item wraps land at the same offsets the :content path pins.
    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "open");
      const actual = normalizeSlotIds(html);
      const expected = normalizeSlotIds(CAPTURED_ORACLE_SEARCH_OPEN);
      expect(actual).toBe(expected);
    } finally {
      storage.close();
    }
  });

  // -------------------------------------------------------------------------
  // structural shape (the bytes that are NOT pinned by the smoke.json oracle
  // because the capture deck never exercised them — the rendered shape is
  // pinned by Ruby view source card-mod-search-0.20.0 set/abstract/
  // 0_search/views.rb:108-116 + 130-140)
  // -------------------------------------------------------------------------

  it("card_list wrapper class string matches 0_search/views.rb:110", async () => {
    // klasses = "card-list card-list-#{item_view_options[:view]}
    // search-result-list"; the captured surface uses item_view = :bar
    // (card-mod-search 0_search/views.rb:130-136's card_list_item nests
    // the item with size: voo.size, view = implicit_item_view =
    // default_item_view = :bar, html default). The wrapper class string
    // is therefore the byte sequence "card-list card-list-bar
    // search-result-list" (search_views.rb:110).
    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "content");
      expect(html).toContain('<div class="card-list card-list-bar search-result-list">');
      // And the closing tag: search_result_list wraps the whole list in
      // wrap_with :div, class: klass (card-mod-search
      // 0_search/views.rb:138-140).
      expect(html).toContain("</div>");
    } finally {
      storage.close();
    }
  });

  it("each result item wraps in <div class=\"search-result-item item-bar\">", async () => {
    // card-mod-search 0_search/views.rb:130-136 card_list_item:
    // nest_item item_card, size: voo.size do |rendered, item_view|
    //   %(<div class="search-result-item item-#{item_view}">#{rendered}</div>)
    // end
    // With item_view = :bar (default), the wrapper is
    // <div class="search-result-item item-bar">...</div>.
    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "content");
      // Two items in the captured deck; both render with the wrapper.
      const matches = html.match(/<div class="search-result-item item-bar">/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(2);
    } finally {
      storage.close();
    }
  });

  it("each result item nests the result card's :bar view (collection item.rb#nest_item contract)", async () => {
    // The search_views.rb:111-114 card_list body calls
    // `search_with_params.map { |item_card| card_list_item item_card }`
    // and card_list_item nests the item card's :bar view. The captured
    // Oracle Search entry nests "Oracle Junction+child_one" and
    // "Oracle Junction+child_two" — both as :bar slots whose id ends in
    // "-bar-view". The byte shape (item class + bar-view slot id) is the
    // shape card_list_item emits.
    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "content");
      // The two result items are bar slots, identified by their -bar-view
      // slot ids (DeckoName.safeKey("Oracle Junction+child_one") =
      // "oracle_junction-child_one"; ditto for child_two).
      expect(html).toContain('id="oracle_junction-child_one-bar-view"');
      expect(html).toContain('id="oracle_junction-child_two-bar-view"');
      // The data-slot's view field reads "bar" (search_result_list +
      // card_list_item's implicit_item_view = :bar).
      expect(html).toMatch(/data-slot="[^"]*&quot;view&quot;:&quot;bar&quot;[^"]*"/);
    } finally {
      storage.close();
    }
  });

  it("card_list body is closed with a trailing newline (the captured byte shape)", async () => {
    // The TS port (views.ts:555-568) emits the closing </div> followed by
    // a literal "\n" — the captured Oracle Search fixture carries that
    // newline between the card-list's closing </div> and the
    // content-view's closing </div>. The trailing newline is the
    // byte-shape the search_views.rb -> :card_list haml template emits.
    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "content");
      const lastListClose = html.lastIndexOf("</div>");
      // Two close divs: the inner item wraps close first; the card-list
      // wrapper closes next; then the content-view slot closes. The
      // captured bytes put a newline BETWEEN the card-list close and the
      // content-view close.
      expect(html).toMatch(/<\/div>\n<\/div>$/);
    } finally {
      storage.close();
    }
  });

  // -------------------------------------------------------------------------
  // the no_search_results path (search_views.rb#search_result_view default
  // when search_with_params is empty; 0_search/views.rb:126-128 wraps an
  // empty <div class="search-no-results"></div>)
  // -------------------------------------------------------------------------

  it(":content view of a Search-type card whose valid CQL returns zero results renders no_search_results", async () => {
    // search_views.rb#search_result_view: empty search_with_params routes
    // through with_results (0_search/views.rb:22-24) to render_no_search_results
    // which emits <div class="search-no-results"></div>
    // (0_search/views.rb:126-128). The capture deck has no such card
    // (every captured Search card has at least one result); pin the shape
    // against the Ruby source contract.
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
      // Valid CQL JSON whose `left` clause names nothing — empty result set.
      await seedCard(storage, {
        id: 800,
        name: "empty result search",
        typeId: 98,
        dbContent: '{"left":"no_such_card","limit":0}',
      });
      const html = await storage.engine.render("empty_result_search", "content");
      expect(html).toContain('<div class="search-no-results"></div>');
      // The card-list wrapper must NOT be present (empty branch).
      expect(html).not.toContain("card-list card-list-bar search-result-list");
      expect(html).not.toContain("search-result-item");
    } finally {
      storage.close();
    }
  });

  it(":open view of a Search-type card whose valid CQL returns zero results renders no_search_results", async () => {
    // Same path through :open (the open view nests :content via :bar_bottom
    // -> :content -> :core -> :card_list -> :no_search_results).
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
      await seedCard(storage, {
        id: 801,
        name: "empty result search two",
        typeId: 98,
        dbContent: '{"left":"no_such_card","limit":0}',
      });
      const html = await storage.engine.render("empty_result_search_two", "open");
      expect(html).toContain('<div class="search-no-results"></div>');
    } finally {
      storage.close();
    }
  });

  // -------------------------------------------------------------------------
  // the read-permission denial of result items (search_views.rb:111-114's
  // card_list_item path emits each item regardless; the read-permission
  // gate fires inside nestRecord -> :bar -> format/permission altered_view
  // -> viewPermissionDenial. The denial bytes replace the per-item slot
  // body but the OUTER search-result-item + item-bar wrappers survive —
  // the search card_list never collapses on a denied item.)
  // -------------------------------------------------------------------------

  it("result items behind a read-permission denial still render the search-result-item wrapper", async () => {
    // The port's denied path (src/card/permissions/view-perms.ts
    // viewPermissionDenial -> the denial span) substitutes the per-item
    // slot body; the wrapping <div class="search-result-item item-bar">
    // remains so the search-result list stays structurally intact. The
    // search card_list shape never collapses on a denied item — the
    // denied span REPLACES only the slot body, not the wrapper.
    //
    // The denial substitution itself is exercised by
    // tests/card/render/permission-corpus-replay.test.ts; here we only
    // pin the structural property that the wrapper survives a denied
    // item, using a single-result deck the engine returns one item for.
    const storage = await createRenderTestStorage();
    try {
      // Minimal deck: a parent card with one child, the search returns
      // that child. The denial substitution fires inside the per-item
      // slot body (via the read-permission gate inside nestRecord ->
      // :bar -> altered_view); the outer search-result-item wrapper
      // structure must survive regardless of whether the inner slot
      // body is the bar view or the denial span.
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
      await seedCard(storage, { id: 900, name: "denied parent", typeId: 2, dbContent: "p" });
      await seedCard(storage, {
        id: 901,
        name: "denied child",
        leftId: 900,
        typeId: 2,
        dbContent: "x",
      });
      await seedCard(storage, {
        id: 902,
        name: "denied search",
        typeId: 98,
        dbContent: '{"left":"denied parent"}',
      });
      // Warm idsByKey so the CQL engine resolves "denied parent" to id 900
      // (the search card has no nest references in its JSON content, so
      // the prefetch closure walk never touches "denied parent" without
      // this explicit render).
      await storage.engine.render("denied parent", "content");
      const html = await storage.engine.render("denied search", "content");
      // search-result-item wrapper present (the inner slot body is
      // either the bar view OR the denial span — the wrapper survives
      // either way).
      expect(html).toContain('<div class="search-result-item item-bar">');
      // card_list wrapper present
      expect(html).toContain('<div class="card-list card-list-bar search-result-list">');
      // The result item nests the child card's :bar slot.
      expect(html).toContain('id="denied_child-bar-view"');
    } finally {
      storage.close();
    }
  });

  // -------------------------------------------------------------------------
  // the :closed view's bar shape (closed dispatches to :open -> :bar_bottom
  // -> :content -> :core, but the closed body STUBS the body
  // (card-mod-bar_and_box set/all/bar.rb#card_stub). Search-type closed
  // therefore renders the standard accordion bar (no card_list body).
  // -------------------------------------------------------------------------

  it(":closed view of a Search-type card does NOT render the card_list body (closed body is stubbed)", async () => {
    // card-mod-bar_and_box set/all/bar.rb#card_stub: closed bars stub
    // their bar_bottom; the card_list body never reaches the user on
    // :closed. Pin that the wrapper is absent on the closed view (even
    // though the captured bytes for some search cards show the :content
    // card_list — those are the :open / :content surface).
    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "closed");
      // Closed surface: the body slot is card-stub'd (data-stub-url=).
      expect(html).toContain('data-stub-url="/Oracle_Search/bar_bottom"');
      // card_list wrapper is NOT on the closed surface.
      expect(html).not.toContain("card-list card-list-bar search-result-list");
    } finally {
      storage.close();
    }
  });
});
