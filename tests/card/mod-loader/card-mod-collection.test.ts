

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

  it("WITHOUT the mod: the mod-specific views are unsupported", async () => {
    const s = storage!;
    await expect(s.engine.render("Collection Count Many", "count")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Collection Paging", "paging")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

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

      expect(cardModCollection.group).toBe("gem-defaults");
    });
  });

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

  describe(":count", () => {
    it("renders the integer-as-string for a small list (no delimiter needed)", async () => {
      const s = storage!;
      const html = await s.engine.render("Collection Count Many", "count");

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

      expect(html).toBe("3");
    });

    it("a trailing newline yields no trailing empty item (the /\n+/ split collapses it)", async () => {
      const s = storage!;
      const html = await s.engine.render("Collection Count Trailing", "count");

      expect(html).toBe("2");
    });

    it("formats large counts with thousand separators (number_with_delimiter, en-US)", () => {

      const registered = loader!.viewsTable()["count"] as ViewFn;
      const bigContent = Array.from({ length: 12345 }, () => "x").join("\n");
      expect(registered(ctxWithContent(bigContent))).toBe("12,345");
    });
  });

  describe(":paging", () => {
    it("returns the empty string when limit is 0 (paging.rb:25 total_pages: return 1 if limit.zero?)", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;

      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 0, offset: 0 }));
      expect(html).toBe("");
    });

    it("returns the empty string when limit >= item count (paging_views.rb:7 limit < count_with_params)", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;

      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 20, offset: 0 }));
      expect(html).toBe("");
    });

    it("renders the nav.pagination.paging structure for a multi-page list", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;

      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 3, offset: 0 }));
      expect(html).toContain('<nav class="nav justify-content-between align-items-center">');
      expect(html).toContain('<ul class="pagination paging">');
      expect(html).toContain('<li class="page-item');

      expect(html).toContain('<li class="page-item active">');

      expect(html).toContain('aria-label="Next"');
      expect(html).toContain('&laquo;');

      expect(html).toContain('<div class="paging-context">');
      expect(html).toContain("1-3 of 10");
    });

    it("emits the <a> page links with the card-paging-link slotter class chain", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;
      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 3, offset: 0 }));

      expect(html).toContain('class="card-paging-link slotter page-link"');
      expect(html).toContain('data-remote="true"');
      expect(html).toContain("data-path=");
      expect(html).toContain('"limit":3');
    });

    it("renders <div class='page-link'> for the ellipses (page nil branch, paging_views.rb:47)", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;

      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 2, offset: 14 }));
      expect(html).toContain('<li class="page-item disabled">');
      expect(html).toContain('<div class="page-link"><span>...</span></div>');
    });

    it("renders the current page's <li> with class page-item active (PAGE_LI_CLASS[:current])", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;

      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 3, offset: 3 }));
      expect(html).toContain('<li class="page-item active">');

      expect(html).toContain("4-6 of 10");
    });

    it("renders no paging when offset=0 and items fit under the limit (paging_views.rb:11 fewer_results_than_limit?)", () => {
      const registered = loader!.viewsTable()["paging"] as ViewFn;

      const html = registered(ctxWithOpts(PAGING_CONTENT, { limit: 20, offset: 0 }));
      expect(html).toBe("");
    });
  });

  describe("the mod loader's reset() restores the pre-registration view table", () => {
    it("undoes each registered view's presence in HTML_VIEWS after reset()", () => {
      const table = loader!.viewsTable();
      expect(typeof table["count"]).toBe("function");
      expect(typeof table["paging"]).toBe("function");

      loader!.reset();

      const after = loader!.viewsTable();

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
