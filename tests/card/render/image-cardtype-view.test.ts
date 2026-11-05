// Stream E — Image cardtype html views.
//
// The card-mod-format-0.20.0 html format defines the image cardtype's
// :core view (card-mod-format-0.20.0 set/type/image.rb):
//
//     format :html do
//       view :core do
//         # <img src="..."> when card.content is a real image source
//         # (http(s) URL, root-relative path, data: URI, mailto:); "" otherwise
//       end
//     end
//
// The :content view delegates to :core (html/views.rb view :content ->
// before(:content) -> prepare_content_slot -> render_core). The :titled
// view also routes through :core for its d0-card-body (views.ts:799
// titledContentView = renderView("core") inside titledView's body
// wrapper). The byte shape this stream pins:
//
//   - non-image content (the corpus-v2 sweep seeds every image card with
//     random non-URL strings — 1019 image-type cards, all of them
//     carrying strings like "janmbtckiogaqbhlewfngdc"): Ruby's image
//     cardtype returns ""; the slot wrapper renders with EMPTY inner —
//     `<div attrs></div>` for the :content view and
//     `<div class="d0-card-body d0-card-content ..."></div>` inside the
//     :titled view. Without the image :core branch the TS engine falls
//     through to fmt.processContent(fmt.renderRaw()) and dumps the raw
//     dbContent as visible text inside the slot wrapper — the
//     "name-leak" family recorded at corpus:79:render:content,
//     corpus:79:render:open, corpus:1631:render:content,
//     corpus:1631:render:open (and the 4000+ image-cardtype renders
//     across shards not in the 2000-cap aggregate sample).
//
//   - real image source (http://, https://, /-rooted path, data:,
//     mailto:): Ruby emits `<img src="..." alt="">`. This branch is
//     NOT exercised by the captured corpus (the sanitizer replaces every
//     real URL with random text), so the byte surface here is verified
//     by a deterministic seed rather than a corpus pin.
//
// REFERENCE Ruby image cardtype:
//   view :core do
//     image_tag card.content
//   end
// where image_tag is Rails' `image_tag(url, alt: nil)` — defaults to
// `alt=""` when not given. card.content is the card's raw content (no
// process_content wrap: a URL string has no nest-syntax to scan).

import { describe, expect, it } from "vitest";
import { formatImageCore } from "../../../src/card/render/views.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

// ---------------------------------------------------------------------------
// the helper itself (pure function)
// ---------------------------------------------------------------------------

describe("formatImageCore — Ruby's image cardtype :core body", () => {
  // 2026-09-26 page-lane correction (layout-resolver lane): Rails
  // image_tag(source, alt: card.name) emits the tag alt-first with the
  // haml-style close — pinned by the expected-v2 capture on BOTH lanes
  // (view-lane *favicon :open: `<img alt="*favicon"
  // src="http://s3.amazonaws.com//files/103/3649-medium.jpg" />`;
  // page-lane header logo: `<img alt="*logo" src="...3643-small.jpg" />`).
  // The old src-first alt="" shape matched no oracle bytes — the fixture
  // flip is the correction, not a regression (both lanes previously
  // failed these entries with the old shape).
  it.each([
    ["http://example.com/foo.png", "http://example.com/foo.png"],
    ["https://example.com/foo.png", "https://example.com/foo.png"],
    ["/files/sample.png", "/files/sample.png"],
    ["data:image/png;base64,iVBOR", "data:image/png;base64,iVBOR"],
    ["mailto:foo@example.com", "mailto:foo@example.com"],
  ])(
    "URL-shaped content '%s' renders <img alt=\"\" src=\"%s\" />",
    (input, expected) => {
      expect(formatImageCore(input)).toBe(`<img alt="" src="${expected}" />`);
    },
  );

  it.each([
    // every image-cardtype card in the captured corpus carries one of
    // these shapes — random text that is not a real image source.
    ["janmbtckiogaqbhlewfngdc"],
    ["qrnnflnzujrbeynnzjgsorfh"],
    ["dckgqsagaawpczubbkqygntuh"],
    ["nlwejsdqrtxykifvsuzzklza"],
    ["ddtdbcikdpoacuprjdhavynx"],
    ["ivtldvqrfifhzdpgglufngfx"],
    ["qsslcmicknxbwjmoxefzqtgi"],
    ["ghupctzjjqmyfzufgfdedych"],
    ["oxfhvqopllsjvekjdcoyehvz"],
    ["dvornkcvztefnraztottguymxfb"],
  ])(
    "non-URL content '%s' renders empty (matches captured oracle)",
    (input) => {
      expect(formatImageCore(input)).toBe("");
    },
  );

  it("empty / null / undefined content renders empty", () => {
    expect(formatImageCore("")).toBe("");
    expect(formatImageCore(null)).toBe("");
    expect(formatImageCore(undefined)).toBe("");
  });

  it("attribute value is HTML-escaped (Rails' image_tag calls html_escape)", () => {
    // A content string that contains a `"` or `<` must NOT survive into
    // the rendered attribute without escaping — Rails' image_tag uses
    // tag-options escaping. formatImageCore passes the URL through h()
    // to match.
    const url = '/files/foo".png';
    const escaped = formatImageCore(url);
    expect(escaped).toContain("&quot;");
    expect(escaped).not.toContain("/files/foo\".png");
  });
});

// ---------------------------------------------------------------------------
// end-to-end through the render engine — image cardtype byte surface
// ---------------------------------------------------------------------------

describe("Image-type card :content view — empty inner for non-URL content", () => {
  it("*logo (image-type) renders <div attrs></div> for non-URL content", async () => {
    // Mirrors the captured oracle at corpus:79:render:content:
    //   <div id="Xlogo-content-view" class="card-slot content-view ..."
    //        data-card-id="79" data-card-name="*logo" ...
    //        data-slot="{&quot;view&quot;:&quot;content&quot;,...}"></div>
    //
    // The :content view wraps :core via slotWrap; the image cardtype's
    // :core body returns "" for non-URL content, so the wrapper's inner
    // is empty. The pre-fix behavior leaked the random dbContent as
    // visible text inside the wrapper ("janmbtckiogaqbhlewfngdc</div>"
    // instead of "</div>").
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, {
        id: 19,
        name: "ImageType",
        codename: "image",
        typeId: 2,
      });
      await seedCard(storage, {
        id: 79,
        name: "*logo",
        codename: "logo",
        typeId: 19,
        dbContent: "janmbtckiogaqbhlewfngdc",
      });
      const html = await storage.engine.render("*logo", "content");
      // Slot wrapper is present.
      expect(html).toContain("Xlogo-content-view");
      expect(html).toContain('data-card-name="*logo"');
      // The dbContent MUST NOT leak as visible text after the slot's
      // data-slot attribute.
      const slotClose = html.indexOf("data-slot=");
      expect(slotClose).toBeGreaterThan(0);
      const afterSlot = html.slice(slotClose);
      const slotEnd = afterSlot.indexOf(">");
      const inner = afterSlot.slice(slotEnd + 1, afterSlot.indexOf("</div>"));
      expect(inner).not.toContain("janmbtckiogaqbhlewfngdc");
      expect(inner).toBe("");
    } finally {
      storage.close();
    }
  });

  it("*logo (image-type) :open view's d0-card-body is empty for non-URL content", async () => {
    // Mirrors the captured oracle at corpus:79:render:open:
    //   <div class='accordion-body d0-card-body'>
    //     <div class="card-slot card-slot-stub" data-stub-url="/*logo/bar_bottom"></div>
    //   </div>
    // The :open view routes through bar_bottom -> :content (views.ts:773)
    // which delegates to :core. The image :core returns "" for non-URL
    // content, so the d0-card-body inside the :content slot is empty
    // (the actual stub div is the nested bar_bottom's slot, not the
    // core's body).
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, {
        id: 19,
        name: "ImageType",
        codename: "image",
        typeId: 2,
      });
      await seedCard(storage, {
        id: 79,
        name: "*logo",
        codename: "logo",
        typeId: 19,
        dbContent: "janmbtckiogaqbhlewfngdc",
      });
      const html = await storage.engine.render("*logo", "open");
      // The captured :open shape: accordion body contains a card-slot-stub.
      expect(html).toContain("accordion-body");
      // The dbContent MUST NOT leak anywhere in the open view.
      expect(html).not.toContain("janmbtckiogaqbhlewfngdc");
    } finally {
      storage.close();
    }
  });

  it("nested image card inside a titled-view has empty d0-card-body", async () => {
    // Mirrors the captured oracle at corpus:1631:render:content:
    // card 1631 (basic) content has {{poaaawurjfm}}; card 10383
    // (poaaawurjfm, image-type) renders inside the titled-view's
    // d0-card-body. The oracle's d0-card-body for the nested image card
    // is empty:
    //   <div class="d0-card-body d0-card-content ALL TYPE-qqddl SELF-poaaawurjfm"></div>
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, {
        id: 19,
        name: "ImageType",
        codename: "image",
        typeId: 2,
      });
      await seedCard(storage, {
        id: 1631,
        name: "ccnwkfkbqybspnrbzjhhzsf",
        typeId: 2,
        dbContent: "<p>before</p>\n{{poaaawurjfm}}\n<p>after</p>",
      });
      await seedCard(storage, {
        id: 10383,
        name: "poaaawurjfm",
        typeId: 19,
        dbContent: "dvornkcvztefnraztottguymxfb",
      });
      const html = await storage.engine.render(
        "ccnwkfkbqybspnrbzjhhzsf",
        "content",
      );
      // The nested card's d0-card-body must be empty (no leaked content).
      // Find the d0-card-body div specifically — it carries the
      // "d0-card-body d0-card-content" class pair. The first SELF-poaaawurjfm
      // match is in the OUTER slot wrapper (the titled-view's data attrs);
      // the d0-card-body div is INSIDE that wrapper, immediately after
      // the d0-card-header. The setKeys are camelCased from the type
      // card name ("ImageType" -> "ALL TYPE-image_type") in this seed;
      // the captured corpus uses the sanitized "qqddl" type name. Both
      // shapes are pinned — the regex below accepts either.
      const bodyMarker = /class="d0-card-body d0-card-content[^"]*SELF-poaaawurjfm"/;
      const bodyMatch = html.match(bodyMarker);
      expect(bodyMatch).not.toBeNull();
      const afterBody = html.slice(bodyMatch!.index!);
      const bodyOpenEnd = afterBody.indexOf(">");
      const bodyClose = afterBody.indexOf("</div>");
      const bodyInner = afterBody.slice(bodyOpenEnd + 1, bodyClose);
      expect(bodyInner).not.toContain("dvornkcvztefnraztottguymxfb");
      expect(bodyInner).toBe("");
      // The surrounding host content still renders normally.
      expect(html).toContain("<p>before</p>");
      expect(html).toContain("<p>after</p>");
    } finally {
      storage.close();
    }
  });

  it("real image source renders <img alt=\"...\" src=\"...\" /> inside the slot", async () => {
    // Outside the corpus: real image URLs must render the <img> tag.
    // The image cardtype's :core body is the image_tag call with the
    // card's content as src. 2026-09-26: oracle shape (alt-first, haml
    // close) — see the page-lane correction note on the it.each above.
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, {
        id: 19,
        name: "ImageType",
        codename: "image",
        typeId: 2,
      });
      await seedCard(storage, {
        id: 500,
        name: "real image",
        typeId: 19,
        dbContent: "/files/sample.png",
      });
      const html = await storage.engine.render("real image", "content");
      expect(html).toContain('<img alt="real image" src="/files/sample.png" />');
    } finally {
      storage.close();
    }
  });
});

// ---------------------------------------------------------------------------
// captured corpus pin — shard-000000 image-type card byte surface
// ---------------------------------------------------------------------------

describe("captured corpus — Image-type card byte surface", () => {
  it("shard-000000 carries image-type cards whose :content view renders empty inner", async () => {
    // Direct corpus pin: the recorded oracle at corpus:79:render:content
    // is literally `<div attrs></div>` for *logo. This test reads the
    // corpus entry's `views.content` and confirms it matches the empty-
    // inner shape — the canonical "no leak" oracle. If a future
    // corpus regen seeds *logo with a real URL, this assertion would
    // fail and surface here as a flag to revisit the byte-parity
    // expectation for the image-URL path (which the
    // "real image source" test above covers).
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = new URL("../../..", import.meta.url);
    const repoRoot = url.pathname.replace(/^\//, "");
    const shardPath = path.join(repoRoot, "fixtures/corpus/shard-000000.jsonl");
    const text = await fs.readFile(shardPath, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const entry79 = lines
      .map((l) => JSON.parse(l))
      .find((e: { id: number }) => e.id === 79) as
      | {
          id: number;
          name: string;
          record: { content: string; type_code: string };
          views: Record<string, string>;
        }
      | undefined;
    expect(entry79).toBeDefined();
    expect(entry79!.record.type_code).toBe("image");
    // The captured :content ends with </div></div> right after the
    // data-slot value — i.e. the inner between the slot's `>` and its
    // closing `</div>` is empty. The oracle shape:
    //   data-slot="{...}"></div>
    const contentView = entry79!.views.content;
    const slotEnd = contentView.lastIndexOf("data-slot=");
    const innerStart = contentView.indexOf(">", slotEnd) + 1;
    const innerEnd = contentView.lastIndexOf("</div>");
    const inner = contentView.slice(innerStart, innerEnd);
    expect(inner).toBe("");
    expect(inner).not.toContain("janmbtckiogaqbhlewfngdc");
  });
});