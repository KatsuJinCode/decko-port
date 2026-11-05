// The card-mod-collection mod loader integration test: the mod loaded
// through the loader registers its views and the rendered bytes match
// the Ruby source semantics.
//
// Proof shape (per ported view):
//   - The manifest shape matches the gem's set/ tree (one setModules entry
//     per file; the all/item set carries :count, the abstract/paging/
//     paging_views set carries :paging; everything else is a passive
//     registration so the basket reflects the gem's tree).
//   - The view registrations survive load() and show up in the live views
//     table + the load report.
//   - The view functions emit the byte shape the Ruby source describes.
//     :count uses item.rb#number_with_delimiter (Intl.NumberFormat en-US
//     matches Ruby for non-negative integers); :paging inlines the
//     paging.haml bytes with the page-link `<li>` structure PagingLinks.new
//     computes (the paging_links.rb data-structure port).
//
// What this test does NOT pin (documented in card-mod-collection.ts's
// NOT-PORTED block):
//   - paging_urls: declared on format :json and :jsonld in Ruby; the
//     engine has no json/jsonld registry.
//   - the rest of item.rb's methods (item_names/item_cards/...) and the
//     item_assignment/recursed/abstract/items/paging method-only set
//     modules: no views to assert against.
//
// Limit/offset for paging are carried in voo.opts; the engine.render()
//     public API doesn't pass opts, so the :paging view is exercised
//     through a direct ViewContext stub (the same pattern the card-mod-
//     assets test uses for its URL-source cards).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { UnsupportedViewError, Voo } from "../../../src/card/render/format.js";
import {
  ModLoader,
  modEngineHost,
} from "../../../src/card/mod-loader.js";
import cardModCollection from "../../../src/card/mod-loader/mods/card-mod-collection.js";
import type {
  RenderCard,
  RenderFormat,
  ViewContext,
  ViewFn,
} from "../../../src/card/render/format.js";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

const PAGING_CONTENT =
  "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\niota\nkappa";

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;
  // Cards for :count - the view reads card.dbContent (the newline-joined
  // item list, item.rb#raw_item_strings) and counts the post-split lines.
  await seedCard(s, { id: 200, name: "Collection Count Empty", dbContent: "" });
  await seedCard(s, { id: 201, name: "Collection Count One", dbContent: "alpha" });
  await seedCard(s, {
    id: 202,
    name: "Collection Count Many",
    dbContent: "alpha\nbeta\ngamma\ndelta\nepsilon",
  });
  await seedCard(s, {
    id: 203,
    name: "Collection Count Brackets",
    dbContent: "[[alpha]]\n[[beta]]\n[[gamma]]",
  });
  await seedCard(s, {
    id: 204,
    name: "Collection Count Trailing",
    dbContent: "alpha\nbeta\n",
  });
  // Card for :paging (the direct-stub path exercises limit/offset via voo.opts).
  await seedCard(s, {
    id: 210,
    name: "Collection Paging",
    dbContent: PAGING_CONTENT,
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-collection through the mod loader", () => {
  // -----------------------------------------------------------------------
  // A/B: the views are not in the baseline HTML_VIEWS table.
  // -----------------------------------------------------------------------

  it("WITHOUT the mod: the mod-specific views are unsupported", async () => {
    const s = storage!;
    await expect(s.engine.render("Collection Count Many", "count")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Collection Paging", "paging")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  // -----------------------------------------------------------------------
  // Manifest shape (one setModules entry per gem file).
  // -----------------------------------------------------------------------

  describe("manifest shape (set/<pattern>/<anchor>.rb setModule entries)", () => {
    it("registers exactly six set modules - the full gem tree", () => {
      expect(cardModCollection.setModules).toBeDefined();
      expect(cardModCollection.setModules?.length).toBe(6);
    });

    it("places :count on all/item and :paging on abstract/paging/paging_views", () => {
      const allItem = cardModCollection.setModules?.find(
        (m) => m.setPath === "all/item",
      );
      const pagingViews = cardModCollection.setModules?.find(
        (m) => m.setPath === "abstract/paging/paging_views",
      );
      expect(allItem).toBeDefined();
      expect(pagingViews).toBeDefined();
      const allItemViews = (allItem?.formats?.html?.views ?? []).map(
        (v) => v.view,
      );
      const pagingViewsViews = (pagingViews?.formats?.html?.views ?? []).map(
        (v) => v.view,
      );
      expect(allItemViews).toEqual(["count"]);
      expect(pagingViewsViews).toEqual(["paging"]);
    });

    it("the abstract/paging/paging_views :paging view carries cache: 'never' (paging_views.rb:27)", () => {
      const pagingViews = cardModCollection.setModules?.find(
        (m) => m.setPath === "abstract/paging/paging_views",
      );
      const paging = pagingViews?.formats?.html?.views?.find(
        (v) => v.view === "paging",
      );
      expect(paging?.config?.cache).toBe("never");
    });

    it("the passive set-modules carry no view registrations", () => {
      const passivePaths = [
        "all/item_assignment",
        "all/recursed",
        "abstract/items",
        "abstract/paging",
      ];
      for (const setPath of passivePaths) {
        const mod = cardModCollection.setModules?.find(
          (m) => m.setPath === setPath,
        );
        expect(mod).toBeDefined();
        expect(mod?.formats?.html?.views?.length ?? 0).toBe(0);
      }
    });

    it("the mod's name / gemName / group match the card-mod-collection-0.20.0 manifest", () => {
      expect(cardModCollection.name).toBe("collection");
      expect(cardModCollection.gemName).toBe("card-mod-collection");
      // card-mod-collection ships as a gem (default-load path); the T6
      // verdict's verdict surfaces list it among the gem-defaults group.
      expect(cardModCollection.group).toBe("gem-defaults");
    });
  });

  // -----------------------------------------------------------------------
  // The mod loader registers the views in the live views table.
  // -----------------------------------------------------------------------

  describe("the mod loader registers the views in the live views table", () => {
    it("registers :count and :paging after load()", async () => {
      const s = storage!;
      loader = new ModLoader([{ manifest: cardModCollection }]);
      loader.load();
      await loader.installInto(modEngineHost(s.engine, s.fetcher));
      const touched = loader.viewsTable();
      expect(typeof touched["count"]).toBe("function");
      expect(typeof touched["paging"]).toBe("function");
    });
  });

  // -----------------------------------------------------------------------
  // :count (set/all/item.rb:179-182)
  // -----------------------------------------------------------------------

  describe(":count", () => {
    it("renders the integer-as-string for a small list (no delimiter needed)", async () => {
      const s = storage!;
      const html = await s.engine.render("Collection Count Many", "count");
      // item.rb:201-203 raw_item_strings splits dbContent on /\n+/ and
      // strips each item. "alpha\nbeta\ngamma\ndelta\nepsilon" -> 5 items.
      // item.rb:180-182 number_with_delimiter(5) -> "5" (Intl en-US).
      expect(html).toBe("5");
    });

    it("renders 1 for a single-item list (item.rb#item_count: 1)", async () => {
      const s = storage!;
      const html = await s.engine.render("Collection Count One", "count");
      expect(html).toBe("1");
    });

    it("renders 0 for an empty list (item.rb#item_count: 0)", async () => {
      const s = storage!;
      const html = await s.engine.render("Collection Count Empty", "count");
      expect(html).toBe("0");
    });

    it("strips [[...]] brackets before counting (item.rb#strip_item: gsub /\\[\\[|\\]\\]/, '')", async () => {
      const s = storage!;
      const html = await s.engine.render("Collection Count Brackets", "count");
      // "[[alpha]]\n[[beta]]\n[[gamma]]" -> 3 stripped items -> "3".
      expect(html).toBe("3");
    });

    it("a trailing newline yields no trailing empty item (the /\n+/ split collapses it)", async () => {
      const s = storage!;
      const html = await s.engine.render("Collection Count Trailing", "count");
      // "alpha\nbeta\n" -> split /\n+/ -> ["alpha", "beta", ""]; the
      // TS port filters empties explicitly (Ruby's compact). 2 items.
      expect(html).toBe("2");
    });

    it("formats large counts with thousand separators (number_with_delimiter, en-US)", () => {
      // Direct stub path: the html format's number_with_delimiter adds
      // en-US thousand-separator commas. item.rb:180-182 wires that
      // helper; Intl.NumberFormat('en-US').format(12345) -> "12,345"
      // which matches Rails number_with_delimiter(12345).
      const registered = loader!.viewsTable()["count"] as ViewFn;
      const bigContent = Array.from({ length: 12345 }, () => "x").join("\n");
      expect(registered(ctxWithContent(bigContent))).toBe("12,345");
    });
  });

  // -----------------------------------------------------------------------
  // :paging (set/abstract/paging/paging_views.rb:27 + paging.haml:1-12)
  // -----------------------------------------------------------------------

  describe(":paging", () => {
    it("returns the empty string when limit is 0 (paging.rb:25 total_pages: return 1 if limit.zero?)", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;
      // limit=0 -> total_pages=1 (Ruby's guard); showPaging requires
      // limit < 1 false (limit=0 fails) -> return false -> empty.
      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 0, offset: 0 }));
      expect(html).toBe("");
    });

    it("returns the empty string when limit >= item count (paging_views.rb:7 limit < count_with_params)", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;
      // 10 items, limit=20 -> showPaging false.
      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 20, offset: 0 }));
      expect(html).toBe("");
    });

    it("renders the nav.pagination.paging structure for a multi-page list", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;
      // 10 items, limit=3, offset=0 -> total_pages=floor((10-1)/3)=3,
      // current_page=floor(0/3)=0. Window=5: previous=null (current=0
      // not positive), first page link if window_start>0 (no,
      // window_start=0), ellipse if window_start>1 (no). window_part:
      // pages 0..3 -> 4 entries. right_part: window_end=3, total=3,
      // add_final_page? = total<=100 && total>window_end => 3>3 false.
      // ellipse if total>window_end+1 => 3>4 false. next_page =
      // current<total => 0<3 yes -> next_page_link (page=1, status :next).
      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 3, offset: 0 }));
      expect(html).toContain('<nav class="nav justify-content-between align-items-center">');
      expect(html).toContain('<ul class="pagination paging">');
      expect(html).toContain('<li class="page-item');
      // Page 0 (display "1") is the current page ->
      // PAGE_LI_CLASS[:current]="active" -> <li class="page-item active">.
      expect(html).toContain('<li class="page-item active">');
      // The "next" link is an <a> (page != nil) carrying aria-label="Next".
      // The "previous" link is rendered as a <div> (page == nil when
      // current is 0; paging_views.rb:47 page_link's `unless page` branch)
      // carrying the laquo span but no aria-label - the Ruby page_link
      // drops options when page is nil.
      expect(html).toContain('aria-label="Next"');
      expect(html).toContain('&laquo;');
      // Paging-context: start = offset+1 = 1, end = min(10, 0+3) = 3,
      // total = 10 -> "1-3 of 10".
      expect(html).toContain('<div class="paging-context">');
      expect(html).toContain("1-3 of 10");
    });

    it("emits the <a> page links with the card-paging-link slotter class chain", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;
      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 3, offset: 0 }));
      // page_link text+page (not the next/previous/ellipse): class chain
      // "card-paging-link slotter page-link", data-remote="true",
      // data-path with the JSON-encoded limit/offset payload.
      expect(html).toContain('class="card-paging-link slotter page-link"');
      expect(html).toContain('data-remote="true"');
      expect(html).toContain("data-path=");
      expect(html).toContain('"limit":3');
    });

    it("renders <div class='page-link'> for the ellipses (page nil branch, paging_views.rb:47)", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;
      // 10 items, limit=2, offset=14 -> current=7, total=4.
      // window_start = max(7-5, 0) = 2, window_end = min(7+5, 4) = 4.
      // left_part: window_start > 1 -> ellipse() with page=nil -> the
      // <div class="page-link"><span>...</span></div> branch in
      // paging_views.rb:47.
      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 2, offset: 14 }));
      expect(html).toContain('<li class="page-item disabled">');
      expect(html).toContain('<div class="page-link"><span>...</span></div>');
    });

    it("renders the current page's <li> with class page-item active (PAGE_LI_CLASS[:current])", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;
      // limit=3, offset=3 -> current_page=1. window=[0, 3]. The current
      // entry (page=1, display=2) gets the active class.
      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 3, offset: 3 }));
      expect(html).toContain('<li class="page-item active">');
      // Paging-context: start=4, end=min(10,6)=6, total=10 -> "4-6 of 10".
      expect(html).toContain("4-6 of 10");
    });

    it("renders no paging when offset=0 and items fit under the limit (paging_views.rb:11 fewer_results_than_limit?)", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;
      // 10 items, limit=20, offset=0 -> limit < count? 20<10 false.
      // Also fewer_results_than_limit? = offset==0 && limit > offset+count
      // = 20 > 0+10 true -> showPaging returns false early.
      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 20, offset: 0 }));
      expect(html).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // mod loader bookkeeping
  // -----------------------------------------------------------------------

  describe("the mod loader's reset() restores the pre-registration view table", () => {
    it("undoes each registered view's presence in HTML_VIEWS after reset()", () => {
      const table = loader!.viewsTable();
      expect(typeof table["count"]).toBe("function");
      expect(typeof table["paging"]).toBe("function");

      loader!.reset();

      const after = loader!.viewsTable();
      // HTML_VIEWS has neither in its baseline (the T6 verdict named
      // them as the missing entries), so reset() REMOVES both views.
      expect(after["count"]).toBeUndefined();
      expect(after["paging"]).toBeUndefined();
    });
  });

  it("the mod loader's load report lists the ported views", () => {
    const report = loader!.load();
    expect(report.registeredViews).toContain("count");
    expect(report.registeredViews).toContain("paging");
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal ViewContext stub sized for the :count view (which only
 *  reads card.dbContent). voo / engine / nest processing are not exercised
 *  on the :count direct-stub path. */
function ctxWithContent(dbContent: string): ViewContext {
  const card: RenderCard = {
    record: {} as RenderCard["record"],
    name: { s: "Stub", safeKey: "stub", key: "stub" } as RenderCard["name"],
    key: "stub",
    dbContent,
    id: 999,
    typeId: undefined,
    typeName: undefined,
    typeCode: undefined,
    setKeys: "All::Stub",
  };
  const fmt: RenderFormat = { card } as unknown as RenderFormat;
  const voo: Voo = new Voo(undefined, "count", {});
  return { fmt, voo };
}

/** Build a minimal ViewContext stub carrying limit/offset in voo.opts
 *  (the :paging view reads them via the paging.rb#contextual_param
 *  port - readLimit/readOffset - which first checks voo.opts). The
 *  card's dbContent is the supplied 10-item newline-joined list. */
function ctxWithOpts(dbContent: string, opts: Record<string, unknown>): ViewContext {
  const card: RenderCard = {
    record: {} as RenderCard["record"],
    name: {
      s: "Stub Paging",
      safeKey: "stub_paging",
      key: "stub_paging",
    } as RenderCard["name"],
    key: "stub_paging",
    dbContent,
    id: 210,
    typeId: undefined,
    typeName: undefined,
    typeCode: undefined,
    setKeys: "All::Item",
  };
  const fmt: RenderFormat = { card } as unknown as RenderFormat;
  const voo: Voo = new Voo(undefined, "paging", opts);
  return { fmt, voo };
}
