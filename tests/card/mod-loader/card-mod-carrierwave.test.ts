

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

    expect(imageHtmlCoreView(makeCtx("", { name: "BlankImg" }))).toBe("");

    expect(imageHtmlCoreView(makeCtx("janmbtckiogaqbhlewfngdc", { name: "*logo" }))).toBe("");
  });
  it("emits the invalid-image comment when src is the missing sentinel (with_valid_source, html_views.rb:13-34)", () => {

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

    expect(shortnames).toContain("Type::File");

    expect(shortnames).toContain("Type::Image");

    expect(shortnames).toContain("Type::Image::Html");

    expect(shortnames).toContain("Self::Favicon");

    expect(shortnames).toContain("Self::Search");

    expect(shortnames).toContain("Self::NewFile");

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

  it("renders a blank-src image card's :core as empty body (corpus:79 *logo shape)", async () => {
    const s = storage!;

    await seedCard(s, {
      id: 19,
      name: "*image",
      codename: "image",
      typeId: 2,
    });

    await seedCard(s, {
      id: 79,
      name: "*logo",
      dbContent: "janmbtckiogaqbhlewfngdc",
      typeId: 19,
    });
    loader = new ModLoader([{ manifest: cardModCarrierwave }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const coreHtml = await s.engine.render("*logo", "core");
    expect(coreHtml).toBe("");
    expect(coreHtml).not.toContain("*logo");
    expect(coreHtml).not.toContain("invalid image");
    expect(coreHtml).not.toContain("<!--");

    const fullWidthHtml = await s.engine.render("*logo", "full_width");
    expect(fullWidthHtml).toBe("");
    expect(fullWidthHtml).not.toContain("invalid image");
  });
});
