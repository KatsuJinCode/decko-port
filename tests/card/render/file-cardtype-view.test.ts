// Stream F7 — File cardtype html views.
//
// The card-mod-carrierwave-0.20.0 file format defines the file cardtype's
// :core view (set/type/file.rb:24-28 + set/type/file/core.haml:1):
//
//     view :core do
//       # <a href="SOURCE">SOURCE</a> when card.content resolves to an
//       # attachment source (web URL, cloud bucket ref, local ~/id/action,
//       # coded :codename/mod path); "" when it resolves to nothing
//     end
//
// The :content view delegates to :core, and the :titled view routes through
// :core for its d0-card-body — the same delegation chain the image
// cardtype's branch covers (image-cardtype-view.test.ts). The leak this
// stream pins (the cfcost-r4 failure ledger's card_name_leaked_as_text
// family, 241 views: after_home_view_data_attr + inside_content_view_
// after_data_attr + other_position):
//
//   The corpus deck's 319 file cards ride the file-type card whose
//   anonymized NAME is "guwg" and whose CODENAME is "file" (id 18); their
//   contents are empty (9) or bare random tokens with no storage prefix
//   (310, e.g. corpus:808's "pxzrynkvadsrfwhwnjnirbxo"). Ruby's file :core
//   resolves no source for every one of them and renders "" — the captured
//   oracle at corpus:808:render:content is literally `<div attrs></div>`.
//   Without the file branch in the base coreView (views.ts), the engine
//   fell through to the raw-content dump and emitted the token as visible
//   text right after the slot's data attributes — the representative
//   real_failures corpus:808:render:content/:open and
//   corpus:3737:render:content/:open (nested file card 3741 inside a
//   titled view).
//
// The corpus exercises ONLY the empty-render arm; the source-resolving arms
// (web/cloud/local/coded) are verified by deterministic seeds here.

import { describe, expect, it } from "vitest";
import { formatFileCore } from "../../../src/card/render/views.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

// ---------------------------------------------------------------------------
// the helper itself (pure function)
// ---------------------------------------------------------------------------

describe("formatFileCore — the file cardtype :core body (set/type/file.rb:24-28)", () => {
  it.each([
    // storage-prefix resolution, mirroring the ported carrierwave
    // contextualizePath (card-mod-carrierwave.ts): web/cloud pass through,
    // local ~/... and coded :... become /files/... paths.
    ["https://example.com/attach.png", "https://example.com/attach.png"],
    ["http://example.com/attach.pdf", "http://example.com/attach.pdf"],
    ["(bucket)/808/42.png", "(bucket)/808/42.png"],
    ["~808/42.png", "/files/808/42.png"],
    [":logo/carey.png", "/files/logo.carey.png"],
  ])("source content '%s' renders the <a href> anchor", (input, source) => {
    expect(formatFileCore(input)).toBe(`<a href="${source}">${source}</a>`);
  });

  it.each([
    // every file-cardtype card in the captured corpus carries one of these
    // shapes — empty, or a bare token with no storage prefix (310 of 319).
    ["pxzrynkvadsrfwhwnjnirbxo"],
    ["zugqggbltykshscvyxxwosstkm"],
    ["bctnycubfauuwcwfx"],
  ])("unrecognized content '%s' renders empty (matches captured oracle)", (input) => {
    expect(formatFileCore(input)).toBe("");
  });

  it("empty / null / undefined content renders empty", () => {
    expect(formatFileCore("")).toBe("");
    expect(formatFileCore("   ")).toBe("");
    expect(formatFileCore(null)).toBe("");
    expect(formatFileCore(undefined)).toBe("");
  });

  it("anchor attribute is HTML-escaped", () => {
    const escaped = formatFileCore('https://example.com/a"b.png');
    expect(escaped).toContain("&quot;");
    expect(escaped).not.toContain('a"b.png');
  });
});

// ---------------------------------------------------------------------------
// end-to-end through the render engine — file cardtype byte surface
// ---------------------------------------------------------------------------

describe("File-type card :content view — empty inner for prefix-less content", () => {
  it("a file-typed card renders <div attrs></div> for bare-token content", async () => {
    // Mirrors the captured oracle at corpus:808:render:content (the
    // 241-view leak family's canonical shape):
    //   <div id="...-content-view" class="card-slot content-view ..." ...
    //        data-slot="{&quot;view&quot;:&quot;content&quot;,...}"></div>
    // Pre-fix, the token leaked as text after the data-slot attribute
    // ("...}">pxzrynkvadsrfwhwnjnirbxo</div>" instead of "...}"></div>").
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, {
        id: 18,
        name: "guwg",
        codename: "file",
        typeId: 2,
      });
      await seedCard(storage, {
        id: 808,
        name: "bctnycubfauuwcwfx+syryhpllh",
        leftId: 580,
        rightId: 675,
        typeId: 18,
        dbContent: "pxzrynkvadsrfwhwnjnirbxo",
      });
      await seedCard(storage, {
        id: 580,
        name: "bctnycubfauuwcwfx",
        typeId: 398,
      });
      await seedCard(storage, {
        id: 675,
        name: "syryhpllh",
        typeId: 18,
      });
      const html = await storage.engine.render("bctnycubfauuwcwfx+syryhpllh", "content");
      // Slot wrapper is present.
      expect(html).toContain('data-card-name="bctnycubfauuwcwfx+syryhpllh"');
      // The dbContent MUST NOT leak as visible text after the slot's
      // data-slot attribute.
      const slotClose = html.indexOf("data-slot=");
      expect(slotClose).toBeGreaterThan(0);
      const afterSlot = html.slice(slotClose);
      const slotEnd = afterSlot.indexOf(">");
      const inner = afterSlot.slice(slotEnd + 1, afterSlot.indexOf("</div>"));
      expect(inner).not.toContain("pxzrynkvadsrfwhwnjnirbxo");
      expect(inner).toBe("");
    } finally {
      storage.close();
    }
  });

  it("nested file card inside a titled view has an empty d0-card-body", async () => {
    // Mirrors the captured oracle at corpus:3737:render:content: host card
    // 3737 (basic) nests {{larrbprwotxjggyxboj}}; card 3741 (file-type)
    // rendered INSIDE the titled-view's d0-card-body must be empty:
    //   <div class="d0-card-body d0-card-content ALL TYPE-guwg
    //        SELF-larrbprwotxjggyxboj"></div>
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, {
        id: 18,
        name: "guwg",
        codename: "file",
        typeId: 2,
      });
      await seedCard(storage, {
        id: 3737,
        name: "ysvdssjkmomnhmdguvegxjpzkylyrxnokoomykwcnrofcpwcoklkpcvyhidxdkjfqtppnvjigvcyaxwfhq",
        typeId: 814,
        dbContent: "<p>before</p>\n{{larrbprwotxjggyxboj}}\n<p>after</p>",
      });
      await seedCard(storage, {
        id: 814,
        name: "udxrgkjqv",
        typeId: 2,
      });
      await seedCard(storage, {
        id: 3741,
        name: "larrbprwotxjggyxboj",
        typeId: 18,
        dbContent: "zugqggbltykshscvyxxwosstkm",
      });
      const html = await storage.engine.render(
        "ysvdssjkmomnhmdguvegxjpzkylyrxnokoomykwcnrofcpwcoklkpcvyhidxdkjfqtppnvjigvcyaxwfhq",
        "content",
      );
      const bodyMarker = /class="d0-card-body d0-card-content[^"]*SELF-larrbprwotxjggyxboj"/;
      const bodyMatch = html.match(bodyMarker);
      expect(bodyMatch).not.toBeNull();
      const afterBody = html.slice(bodyMatch!.index!);
      const bodyOpenEnd = afterBody.indexOf(">");
      const bodyClose = afterBody.indexOf("</div>");
      const bodyInner = afterBody.slice(bodyOpenEnd + 1, bodyClose);
      expect(bodyInner).not.toContain("zugqggbltykshscvyxxwosstkm");
      expect(bodyInner).toBe("");
      // The surrounding host content still renders normally.
      expect(html).toContain("<p>before</p>");
      expect(html).toContain("<p>after</p>");
    } finally {
      storage.close();
    }
  });

  it("file card with a real web source renders the <a href> anchor inside the slot", async () => {
    // Outside the corpus: resolvable sources render the anchor
    // (set/type/file/core.haml:1). Not exercised by the captured corpus
    // (the sanitizer strips every real source); deterministic-seed proof.
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, {
        id: 18,
        name: "guwg",
        codename: "file",
        typeId: 2,
      });
      await seedCard(storage, {
        id: 900,
        name: "real attachment",
        typeId: 18,
        dbContent: "https://example.com/attach.png",
      });
      const html = await storage.engine.render("real attachment", "content");
      expect(html).toContain('<a href="https://example.com/attach.png">');
    } finally {
      storage.close();
    }
  });
});

// ---------------------------------------------------------------------------
// captured corpus pin — shard-000000 file-type junction byte surface
// ---------------------------------------------------------------------------

describe("captured corpus — File-type card byte surface", () => {
  it("shard-000000 corpus:808's oracle :content is the empty-inner wrapper", async () => {
    // Direct corpus pin: the recorded oracle at corpus:808:render:content
    // is literally `<div attrs></div>` — the "no leak" shape the engine
    // must produce for file cards with prefix-less content. If a future
    // corpus regen seeds card 808 with a resolvable storage source, this
    // assertion fails and surfaces the byte-parity expectation for the
    // anchor path (covered by the deterministic-seed test above).
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = new URL("../../..", import.meta.url);
    const repoRoot = url.pathname.replace(/^\//, "");
    const shardPath = path.join(repoRoot, "fixtures/corpus/shard-000000.jsonl");
    const text = await fs.readFile(shardPath, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const entry808 = lines
      .map((l) => JSON.parse(l))
      .find((e: { id: number }) => e.id === 808) as
      | {
          id: number;
          name: string;
          record: { content: string; type_code: string };
          views: Record<string, string>;
        }
      | undefined;
    expect(entry808).toBeDefined();
    expect(entry808!.record.type_code).toBe("file");
    expect(entry808!.record.content).toBe("pxzrynkvadsrfwhwnjnirbxo");
    // The captured :content's inner between the slot's `>` and its closing
    // `</div>` is empty — the canonical no-leak oracle.
    const contentView = entry808!.views.content;
    const slotEnd = contentView.lastIndexOf("data-slot=");
    const innerStart = contentView.indexOf(">", slotEnd) + 1;
    const innerEnd = contentView.lastIndexOf("</div>");
    const inner = contentView.slice(innerStart, innerEnd);
    expect(inner).toBe("");
    expect(inner).not.toContain("pxzrynkvadsrfwhwnjnirbxo");
  });
});
