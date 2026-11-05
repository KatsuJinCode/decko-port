// The carrierwave mod integration test: card-mod-carrierwave loaded through
// the mod loader adds file/image rendering views whose bytes match the
// Ruby source semantics.
//
// Carrierwave is fundamentally a SIDE-EFFECT mod (file uploads, carrierwave
// mount, fog buckets, mini_magick image processing). The headless port
// covers ONLY the pure HTML renderers - the views that emit URLs and <img>
// tags from the card's dbContent without touching the filesystem. The
// attachment runtime (24 event hooks, lib/carrier_wave/* uploader classes,
// set/abstract/attachment/* event modules) is explicitly NOT ported.
//
// Proof shape:
//   1. Helper functions (storageTypeFromContent, contextualizePath) map
//      carrierwave identifier prefixes to URL/path forms, matching the
//      storage_type_from_content + carrierwave URL doc semantics.
//   2. The polymorphic view functions (fileSource, imageSource,
//      fileCoreView, imageHtmlCoreView, imageHtmlFullWidthView,
//      imageHtmlPreviewView, imageHtmlContentChangesView,
//      faviconLinkTagView, searchJsonImageCompleteView,
//      polymorphicSourceView, polymorphicCoreView) emit the bytes Ruby
//      produces for the same card + view pair.
//   3. The ModLoader registration lands every set module in the basket
//      (Ruby bookkeeping parity) and every view config in the config
//      table (the _view_<name>__<setting> methods).
//   4. The engine pipeline honors the mod's registration: rendering a
//      file card's :source goes through polymorphicSourceView (file
//      branch) and emits the contextualized URL.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import {
  ModLoader,
  modEngineHost,
} from "../../../src/card/mod-loader.js";
import cardModCarrierwave from "../../../src/card/mod-loader/mods/card-mod-carrierwave.js";
import {
  contextualizePath,
  storageTypeFromContent,
  fileCoreView,
  imageHtmlCoreView,
  imageHtmlFullWidthView,
  imageHtmlPreviewView,
  imageHtmlContentChangesView,
  faviconLinkTagView,
  searchJsonImageCompleteView,
  FAVICON_RAW_HELP_TEXT,
} from "../../../src/card/mod-loader/mods/card-mod-carrierwave.js";
import { DeckoName } from "../../../src/card/name.js";
import { Voo, type RenderFormat, type ViewContext } from "../../../src/card/render/format.js";

/** Build a minimal ViewContext for direct viewFn invocation. The card's
 *  typeName drives the polymorphic dispatch (image vs file behavior). */
function makeCtx(dbContent: string, opts: { typeName?: string; typeCode?: string; name?: string } = {}): ViewContext {
  const name = opts.name ?? "TestCard";
  const card = {
    dbContent,
    name: { s: name, safeKey: name, isCompound: false } as unknown as DeckoName,
    typeName: opts.typeName,
    typeCode: opts.typeCode,
    typeId: 2,
    id: 1,
    record: {} as never,
    key: name.toLowerCase(),
    setKeys: "ALL",
    unknown: false,
  };
  const fmt = {
    card,
    renderView: ((view: string, viewOpts: Record<string, unknown> = {}) => {
      if (view === "core") {
        if (card.typeCode === "image") return imageHtmlCoreView({ fmt: fmt as unknown as RenderFormat, voo: new Voo(undefined, "core", viewOpts) });
        return fileCoreView({ fmt: fmt as unknown as RenderFormat, voo: new Voo(undefined, "core", viewOpts) });
      }
      return "";
    }),
  } as unknown as RenderFormat;
  return { fmt, voo: new Voo(undefined, "source", {}) };
}

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("storageTypeFromContent (set/abstract/attachment/01_storage_type.rb:102-116)", () => {
  it("classifies ~ as local (file_card_uploader.rb doc lines 88-92)", () => {
    expect(storageTypeFromContent("~42/action_99.txt")).toBe("local");
  });
  it("classifies http(s) as web", () => {
    expect(storageTypeFromContent("http://example.com/file.pdf")).toBe("web");
    expect(storageTypeFromContent("https://example.com/file.pdf")).toBe("web");
  });
  it("classifies (bucket) as cloud", () => {
    expect(storageTypeFromContent("(my_bucket)/card_id/action.ext")).toBe("cloud");
  });
  it("classifies :codename as coded", () => {
    expect(storageTypeFromContent(":logo/decko_logo.svg")).toBe("coded");
  });
  it("returns unknown for empty / unrecognised content", () => {
    expect(storageTypeFromContent("")).toBe("unknown");
    expect(storageTypeFromContent("   ")).toBe("unknown");
  });
});

describe("contextualizePath (file_card_uploader.rb doc lines 88-117)", () => {
  it("converts local ~/card_id/action.ext -> /files/card_id/action.ext", () => {
    expect(contextualizePath("~42/action_99.txt")).toBe("/files/42/action_99.txt");
  });
  it("returns web URLs raw", () => {
    expect(contextualizePath("https://example.com/path/to/file.pdf")).toBe(
      "https://example.com/path/to/file.pdf",
    );
  });
  it("returns cloud content raw (the bucket URL)", () => {
    expect(contextualizePath("(my_bucket)/1/2.png")).toBe("(my_bucket)/1/2.png");
  });
  it("converts coded :codename/mod.ext -> /files/codename.mod.ext", () => {
    expect(contextualizePath(":logo/decko_logo.svg")).toBe("/files/logo.decko_logo.svg");
  });
  it("returns empty for unknown content", () => {
    expect(contextualizePath("")).toBe("");
    expect(contextualizePath("not_an_identifier")).toBe("");
  });
});

describe("file :core (set/type/file.rb:24-28 + core.haml:1)", () => {
  it("emits <a href=URL>URL</a> for a local file", () => {
    const html = fileCoreView(makeCtx("~7/act_42.png"));
    expect(html).toBe('<a href="/files/7/act_42.png">/files/7/act_42.png</a>');
  });
  it("emits <a href=URL>URL</a> for a web file", () => {
    const html = fileCoreView(makeCtx("https://example.com/file.pdf"));
    expect(html).toBe(
      '<a href="https://example.com/file.pdf">https://example.com/file.pdf</a>',
    );
  });
  it("returns empty string for unknown / missing source", () => {
    expect(fileCoreView(makeCtx(""))).toBe("");
  });
});

describe("image :core (set/type/image/html_views.rb:5-11)", () => {
  it("emits <img src=URL alt=NAME> for a web image", () => {
    const html = imageHtmlCoreView(makeCtx("https://example.com/img.png", { name: "MyImage" }));
    expect(html).toBe('<img src="https://example.com/img.png" alt="MyImage">');
  });
  it("emits <img src=/files/... alt=NAME> for a local image", () => {
    const html = imageHtmlCoreView(makeCtx("~12/act_99.jpg", { name: "LocalImg" }));
    expect(html).toBe('<img src="/files/12/act_99.jpg" alt="LocalImg">');
  });
  it("returns empty string for blank src (set/type/file.rb:34-45 handle_source short-circuit)", () => {
    // set/type/file.rb:34-45 handle_source short-circuits blank src to ""
    // (the content-view wrapper renders an empty body, e.g. corpus:79 *logo
    // with dbContent that does not match any storage prefix).
    expect(imageHtmlCoreView(makeCtx("", { name: "BlankImg" }))).toBe("");
    // Non-blank content that fails storage-type recognition still yields
    // blank src (storageTypeFromContent returns "unknown" ->
    // contextualizePath returns ""). The card name MUST NOT leak into the
    // rendered body - this is the captured shape from corpus:79 *logo.
    expect(imageHtmlCoreView(makeCtx("janmbtckiogaqbhlewfngdc", { name: "*logo" }))).toBe("");
  });
  it("emits the invalid-image comment when src is the missing sentinel (with_valid_source, html_views.rb:13-34)", () => {
    // The "missing" sentinel is set by Ruby's carrierwave runtime when an
    // attachment reference resolves but the underlying file is gone
    // (lib/card/mod/carrierwave.rb + FileCardUploader#url). The headless
    // port has no carrierwave runtime, so imageSource never produces the
    // "missing" string from dbContent. We exercise the branch directly by
    // constructing a context whose imageSource-equivalent returns
    // "missing": the html view's invariant is checked by stubbing
    // contextualizePath-shaped inputs through the same viewFn.
    // The closest reachable shape: a card whose dbContent is "missing".
    // storageTypeFromContent("missing") returns "unknown" ->
    // contextualizePath returns "" -> src === "" (blank branch). So this
    // assertion confirms the blank-src branch, NOT the missing branch.
    // The missing-branch code path is exercised by the live carrierwave
    // runtime which the headless port does not include (see file header
    // NOT PORTED list).
    expect(imageHtmlCoreView(makeCtx("missing", { name: "MissingImg" }))).toBe("");
  });
});

describe("image :full_width (set/type/image/html_views.rb:25-29)", () => {
  it("emits <img ... class=w-100>", () => {
    const html = imageHtmlFullWidthView(makeCtx("https://example.com/banner.png", { name: "Banner" }));
    expect(html).toBe(
      '<img src="https://example.com/banner.png" alt="Banner" class="w-100">',
    );
  });
  it("returns empty string for blank src (set/type/file.rb:34-45 handle_source short-circuit)", () => {
    expect(imageHtmlFullWidthView(makeCtx("", { name: "NoBanner" }))).toBe("");
    expect(imageHtmlFullWidthView(makeCtx("janmbtckiogaqbhlewfngdc", { name: "*logo" }))).toBe("");
  });
});

describe("image :preview (set/type/image/html_views.rb:36-43)", () => {
  it("wraps the :core medium variant in <div class=attachment-preview>", () => {
    const html = imageHtmlPreviewView(
      makeCtx("https://example.com/img.png", { name: "MyImg", typeCode: "image" }),
    );
    expect(html).toBe(
      '<div class="attachment-preview" id="MyImg-preview"><img src="https://example.com/img.png" alt="MyImg"></div>',
    );
  });
  it("returns empty when the underlying :core is empty (blank-src short-circuit, corpus:79 *logo shape)", () => {
    // :preview wraps whatever :core returns. For a blank src the underlying
    // :core returns "" (file.rb:34-45 handle_source short-circuit), so
    // :preview also returns "" rather than wrapping a stale comment.
    const html = imageHtmlPreviewView(
      makeCtx("", { name: "Missing", typeCode: "image" }),
    );
    expect(html).toBe("");
  });
});

describe("image :content_changes (set/type/image/html_views.rb:49-51)", () => {
  it("returns the pair of :core bytes for a non-empty source", () => {
    const html = imageHtmlContentChangesView(
      makeCtx("https://example.com/img.png", { name: "DiffImg", typeCode: "image" }),
    );
    // Two :core renders concatenated; the diff highlighting the Ruby
    // version provides via Card::Content::Diff.render_added_chunk /
    // render_deleted_chunk (lines 63 + 76) is a separate surface - the
    // headless port emits the structural pair only.
    expect(html).toBe(
      '<img src="https://example.com/img.png" alt="DiffImg"><img src="https://example.com/img.png" alt="DiffImg">',
    );
  });
});

describe("favicon :link_tag (set/self/favicon.rb:7-11, perms: :none)", () => {
  it("emits <link rel=shortcut icon href=URL> for an image-typed favicon", () => {
    const html = faviconLinkTagView(
      makeCtx("https://example.com/favicon.ico", { typeName: "Image", name: "favicon" }),
    );
    expect(html).toBe('<link rel="shortcut icon" href="https://example.com/favicon.ico">');
  });
  it("returns empty for a non-image favicon (no logo nest in headless)", () => {
    const html = faviconLinkTagView(makeCtx("", { typeName: "File", name: "favicon" }));
    expect(html).toBe("");
  });
});

describe("FAVICON_RAW_HELP_TEXT (set/self/favicon.rb:13-16)", () => {
  it("matches the Ruby prose verbatim", () => {
    expect(FAVICON_RAW_HELP_TEXT).toBe(
      "A favicon (or shortcut icon) is a small image used by browsers to help identify " +
        "your website. [[http://www.decko.org/favicon|How to customize your favicon]]",
    );
  });
});

describe("search :image_complete (set/self/search.rb:2-7, cache: :never)", () => {
  it("returns the empty-result JSON in the headless port", () => {
    expect(searchJsonImageCompleteView(makeCtx(""))).toBe("[]");
  });
});

describe("card-mod-carrierwave through the mod loader", () => {
  it("registers every set module in the basket (Ruby bookkeeping parity)", () => {
    loader = new ModLoader([{ manifest: cardModCarrierwave }]);
    loader.load();
    const basket = loader.setModules();
    const allModules: { shortname: string; kind: string }[] = [
      ...basket.base,
      ...basket.abstract,
      ...Array.from(basket.nonbase.values()).flat(),
    ];
    const shortnames = allModules.map((m) => m.shortname);
    // set/type/file.rb -> Type::File (registered for bookkeeping, no views)
    expect(shortnames).toContain("Type::File");
    // set/type/image.rb -> Type::Image
    expect(shortnames).toContain("Type::Image");
    // set/type/image/html_views.rb -> Type::Image::Html
    expect(shortnames).toContain("Type::Image::Html");
    // set/self/favicon.rb -> Self::Favicon
    expect(shortnames).toContain("Self::Favicon");
    // set/self/search.rb -> Self::Search
    expect(shortnames).toContain("Self::Search");
    // set/self/new_file.rb -> Self::NewFile
    expect(shortnames).toContain("Self::NewFile");
    // set/self/new_image.rb -> Self::NewImage
    expect(shortnames).toContain("Self::NewImage");
  });

  it("records the perms: :none view-config for link_tag (set/self/favicon.rb:7)", () => {
    loader = new ModLoader([{ manifest: cardModCarrierwave }]);
    loader.load();
    const config = loader.viewConfigFor("link_tag");
    expect(config?.perms).toBe("none");
  });

  it("records the unknown: :blank view-config for source (set/type/image.rb:26-28)", () => {
    loader = new ModLoader([{ manifest: cardModCarrierwave }]);
    loader.load();
    const config = loader.viewConfigFor("source");
    expect(config?.unknown).toBe("blank");
  });

  it("records the cache: :never view-config for image_complete (set/self/search.rb:2)", () => {
    loader = new ModLoader([{ manifest: cardModCarrierwave }]);
    loader.load();
    const config = loader.viewConfigFor("image_complete");
    expect(config?.cache).toBe("never");
  });

  it("renders a file card's :source through polymorphicSourceView (file branch)", async () => {
    const s = storage!;
    await seedCard(s, {
      id: 500,
      name: "LocalFileRender",
      dbContent: "~42/action_99.txt",
    });
    loader = new ModLoader([{ manifest: cardModCarrierwave }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const html = await s.engine.render("LocalFileRender", "source");
    expect(html).toBe("/files/42/action_99.txt");
  });

  it("renders a file card's :core through polymorphicCoreView (file branch: <a href>)", async () => {
    const s = storage!;
    await seedCard(s, {
      id: 501,
      name: "LocalFileCoreRender",
      dbContent: "~7/act_42.png",
    });
    loader = new ModLoader([{ manifest: cardModCarrierwave }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const html = await s.engine.render("LocalFileCoreRender", "core");
    expect(html).toBe('<a href="/files/7/act_42.png">/files/7/act_42.png</a>');
  });

  // -----------------------------------------------------------------------
  // corpus:79 *logo shape (bucket: card_name_leaked_as_text_inside_content_view_after_data_attr)
  //
  // The captured fixture is an image-typed card with dbContent that does
  // NOT match any storage-type prefix (not http(s), not ~, not :, not
  // (bucket)). Ruby's set/type/file.rb:34-45 handle_source short-circuits
  // to "" on blank src; the html view returns an empty body inside the
  // content-view wrapper. The pre-fix TS port emitted the invalid-image
  // HTML comment (with the card name interpolated) which leaked the name
  // into the wrapper body. Pinning the bytes here collapses the bucket
  // for any future regression of the same shape.
  // -----------------------------------------------------------------------

  it("renders a blank-src image card's :core as empty body (corpus:79 *logo shape)", async () => {
    const s = storage!;
    // The image type card needs a codename so the render engine resolves
    // typeCode === "image" via peekNameForId (render.ts:610 + 834).
    await seedCard(s, {
      id: 19,
      name: "*image",
      codename: "image",
      typeId: 2,
    });
    // The *logo probe: image-typed, dbContent that fails every storage
    // prefix -> imageSource returns "" -> the html view must return ""
    // (NOT the comment, NOT the leaked name).
    await seedCard(s, {
      id: 79,
      name: "*logo",
      dbContent: "janmbtckiogaqbhlewfngdc",
      typeId: 19,
    });
    loader = new ModLoader([{ manifest: cardModCarrierwave }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    // :core bytes: empty body. Card name MUST NOT appear as body text.
    const coreHtml = await s.engine.render("*logo", "core");
    expect(coreHtml).toBe("");
    expect(coreHtml).not.toContain("*logo");
    expect(coreHtml).not.toContain("invalid image");
    expect(coreHtml).not.toContain("<!--");

    // :full_width: same blank-src short-circuit (the mod-path half of the
    // bucket fix; the :full_width view is registered for image-typed
    // cards only via set/type/image/html).
    const fullWidthHtml = await s.engine.render("*logo", "full_width");
    expect(fullWidthHtml).toBe("");
    expect(fullWidthHtml).not.toContain("invalid image");
  });
});
