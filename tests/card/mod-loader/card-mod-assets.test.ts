

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ModLoader } from "../../../src/card/mod-loader.js";
import cardModAssets from "../../../src/card/mod-loader/mods/card-mod-assets.js";
import type { ViewContext, ViewFn } from "../../../src/card/render/format.js";

let loader: ModLoader | undefined;

beforeAll(() => {
  loader = new ModLoader([{ manifest: cardModAssets }]);
  loader.load();
});

afterAll(() => {
  loader?.reset();
  loader = undefined;
});

function ctxForUrls(urls: string): ViewContext {
  return {
    fmt: { card: { dbContent: urls } } as unknown as ViewContext["fmt"],
    voo: {} as unknown as ViewContext["voo"],
  };
}

function viewFor(name: string): ViewFn {
  const table = loader!.viewsTable();
  const fn = table[name];
  if (fn === undefined) throw new Error(`view not registered: ${name}`);
  return fn;
}

describe("card-mod-assets mod loader", () => {
  describe("manifest shape (set/right/group_remote.rb setModule entries)", () => {
    it("registers exactly one set module - the only gem file with portable html views", () => {
      expect(cardModAssets.setModules).toBeDefined();
      expect(cardModAssets.setModules?.length).toBe(1);
      expect(cardModAssets.setModules?.[0]?.setPath).toBe("right/group_remote");
    });

    it("the right/group_remote format :html block lists both verdict-named views", () => {
      const html = cardModAssets.setModules?.[0]?.formats?.html;
      expect(html).toBeDefined();
      const viewNames = (html?.views ?? []).map((v) => v.view).sort();
      expect(viewNames).toEqual(
        ["javascript_include_tag", "stylesheet_include_tag"].sort(),
      );
    });

    it("the javascript_include_tag view carries cache: 'never' (group_remote.rb:44)", () => {
      const view = cardModAssets.setModules?.[0]?.formats?.html?.views?.find(
        (v) => v.view === "javascript_include_tag",
      );
      expect(view?.config?.cache).toBe("never");
    });

    it("the stylesheet_include_tag view has no cache config (group_remote.rb:50 defines none)", () => {
      const view = cardModAssets.setModules?.[0]?.formats?.html?.views?.find(
        (v) => v.view === "stylesheet_include_tag",
      );
      expect(view?.config?.cache).toBeUndefined();
    });

    it("the mod's name / gemName / group match the card-mod-assets-0.20.0 manifest", () => {
      expect(cardModAssets.name).toBe("assets");
      expect(cardModAssets.gemName).toBe("card-mod-assets");

      expect(cardModAssets.group).toBe("gem-defaults");
    });
  });

  describe("the mod loader registers the views in the live views table", () => {
    it("registers :javascript_include_tag and :stylesheet_include_tag", () => {
      const touched = loader!.viewsTable();
      expect(typeof touched["javascript_include_tag"]).toBe("function");
      expect(typeof touched["stylesheet_include_tag"]).toBe("function");
    });
  });

  describe("view :javascript_include_tag - group_remote.rb:44-48", () => {
    let registered: ViewFn;
    beforeAll(() => {
      registered = viewFor("javascript_include_tag");
    });

    it("a single URL emits one <script src=...></script> tag with no leading whitespace", () => {

      expect(registered(ctxForUrls("https://cdn.example.com/lib.js"))).toBe(
        '<script src="https://cdn.example.com/lib.js"></script>',
      );
    });

    it("multiple URLs emit one tag per URL joined by a single newline (group_remote.rb:47 .join \"\\n\")", () => {
      const out = registered(
        ctxForUrls("https://a.example/x.js\nhttps://b.example/y.js"),
      );
      expect(out).toBe(
        '<script src="https://a.example/x.js"></script>\n' +
          '<script src="https://b.example/y.js"></script>',
      );
    });

    it("empty content emits the empty string (the join of an empty array is \"\")", () => {
      expect(registered(ctxForUrls(""))).toBe("");
    });

    it("a trailing newline is filtered so the output has no trailing newline either", () => {

      expect(registered(ctxForUrls("https://cdn.example.com/lib.js\n"))).toBe(
        '<script src="https://cdn.example.com/lib.js"></script>',
      );
    });
  });

  describe("view :stylesheet_include_tag - group_remote.rb:50-54", () => {
    let registered: ViewFn;
    beforeAll(() => {
      registered = viewFor("stylesheet_include_tag");
    });

    it("a single URL emits one <link href=... media=all rel=stylesheet type=text/css /> with the Ruby argument order", () => {

      expect(registered(ctxForUrls("https://cdn.example.com/lib.css"))).toBe(
        '<link href="https://cdn.example.com/lib.css" media="all" rel="stylesheet" type="text/css" />',
      );
    });

    it("multiple URLs emit one tag per URL joined by a single newline", () => {
      const out = registered(
        ctxForUrls("https://a.example/x.css\nhttps://b.example/y.css"),
      );
      expect(out).toBe(
        '<link href="https://a.example/x.css" media="all" rel="stylesheet" type="text/css" />\n' +
          '<link href="https://b.example/y.css" media="all" rel="stylesheet" type="text/css" />',
      );
    });

    it("empty content emits the empty string", () => {
      expect(registered(ctxForUrls(""))).toBe("");
    });

    it("a trailing newline produces no trailing newline in the output", () => {
      expect(registered(ctxForUrls("https://cdn.example.com/lib.css\n"))).toBe(
        '<link href="https://cdn.example.com/lib.css" media="all" rel="stylesheet" type="text/css" />',
      );
    });
  });

  describe("the mod loader's reset() restores the pre-registration view table", () => {
    it("undoes each registered view's presence in HTML_VIEWS after reset()", () => {

      const table = loader!.viewsTable();
      expect(typeof table["javascript_include_tag"]).toBe("function");
      expect(typeof table["stylesheet_include_tag"]).toBe("function");

      loader!.reset();

      const after = loader!.viewsTable();

      expect(after["javascript_include_tag"]).toBeUndefined();
      expect(after["stylesheet_include_tag"]).toBeUndefined();
    });
  });
});
