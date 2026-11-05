// The card-mod-assets mod loader tests: prove the port's view registrations
// match the Ruby source's per-view semantics, byte-for-byte where the
// engine's surface is portable, and document the gap where it isn't.
//
// Proof shape:
//   - The manifest has the ONE set module with portable html views
//     (set/right/group_remote.rb), and that module's :html format registers
//     exactly the two gem-specific views the T6 verdict names
//     (metrics.htmlViewsMissingNames = ["javascript_include_tag",
//     "stylesheet_include_tag"]).
//   - The registered view functions emit the same per-URL byte strings
//     Ruby's asset_tag_helper.rb#javascript_include_tag / tag "link"
//     produce for a remote URL (no asset-pipeline digest lookup).
//   - The ModLoader's reset() restores the pre-registration view table, so
//     this test mutates no shared surface (parity with the help mod test's
//     afterAll.reset()).
//
// What this test does NOT pin: the asset pipeline's filesystem-touching
// views (right/asset_output view :not_found -> update_asset_output_live;
// abstract/asset_file view :javascript_include_tag -> card.existing_source_paths),
// documented in card-mod-assets.ts's NOT-PORTED block.

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
  loader?.reset(); // unregister the mod views from the live HTML_VIEWS record
  loader = undefined;
});

/** A ViewContext stub sized for the two ported views: they only read
 *  ctx.fmt.card.dbContent (the URL list newline-joined - group_remote.rb:30
 *  content = urls.join "\n"). voo / engine / nest processing are not
 *  exercised. */
function ctxForUrls(urls: string): ViewContext {
  return {
    fmt: { card: { dbContent: urls } } as unknown as ViewContext["fmt"],
    voo: {} as unknown as ViewContext["voo"],
  };
}

/** Pull the mod-registered view function out of the live views record. */
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
      // dirs.rb:66-78 + 148-156: cards-installed gems live under
      // "gem-defaults"; card-mod-assets ships as a gem so the group is
      // "gem-defaults".
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
      // group_remote.rb:45 maps the path through javascript_include_tag
      // (Rails emits <script src=\"<url>\"></script> for a remote URL);
      // the join is "\n" with no trailing newline.
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
      // group_remote.rb:25-27 urls filters no blanks explicitly, but the
      // port's url source (card.dbContent = urls.join "\n") carries one
      // trailing newline on cards where the manifest had no remote URLs
      // after the last one. Splitting a trailing newline yields one empty
      // string the helper filters out.
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
      // group_remote.rb:52 `tag "link", href:, media:, rel:, type:` - Rails'
      // tag helper preserves Hash insertion order, so the byte order is
      // href, media, rel, type.
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
      // The beforeAll registered the two views into the SHARED HTML_VIEWS
      // record. After reset() the live record no longer carries the mod
      // views (so a subsequent default-load won't have them). The help mod
      // test asserts the same via afterAll; here we exercise it explicitly.
      const table = loader!.viewsTable();
      expect(typeof table["javascript_include_tag"]).toBe("function");
      expect(typeof table["stylesheet_include_tag"]).toBe("function");

      loader!.reset();

      const after = loader!.viewsTable();
      // HTML_VIEWS has neither in its baseline (the T6 verdict named them
      // as the missing entries), so reset() REMOVES both views.
      expect(after["javascript_include_tag"]).toBeUndefined();
      expect(after["stylesheet_include_tag"]).toBeUndefined();
    });
  });
});
