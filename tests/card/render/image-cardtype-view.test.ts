

import { describe, expect, it } from "vitest";
import { formatImageCore } from "../../../src/card/render/views.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

describe("formatImageCore — Ruby's image cardtype :core body", () => {

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

    const url = '/files/foo".png';
    const escaped = formatImageCore(url);
    expect(escaped).toContain("&quot;");
    expect(escaped).not.toContain("/files/foo\".png");
  });
});

describe("Image-type card :content view — empty inner for non-URL content", () => {
  it("*logo (image-type) renders <div attrs></div> for non-URL content", async () => {

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

      expect(html).toContain("Xlogo-content-view");
      expect(html).toContain('data-card-name="*logo"');

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

      expect(html).toContain("accordion-body");

      expect(html).not.toContain("janmbtckiogaqbhlewfngdc");
    } finally {
      storage.close();
    }
  });

  it("nested image card inside a titled-view has empty d0-card-body", async () => {

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

      const bodyMarker = /class="d0-card-body d0-card-content[^"]*SELF-poaaawurjfm"/;
      const bodyMatch = html.match(bodyMarker);
      expect(bodyMatch).not.toBeNull();
      const afterBody = html.slice(bodyMatch!.index!);
      const bodyOpenEnd = afterBody.indexOf(">");
      const bodyClose = afterBody.indexOf("</div>");
      const bodyInner = afterBody.slice(bodyOpenEnd + 1, bodyClose);
      expect(bodyInner).not.toContain("dvornkcvztefnraztottguymxfb");
      expect(bodyInner).toBe("");

      expect(html).toContain("<p>before</p>");
      expect(html).toContain("<p>after</p>");
    } finally {
      storage.close();
    }
  });

  it("real image source renders <img alt=\"...\" src=\"...\" /> inside the slot", async () => {

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

describe("captured corpus — Image-type card byte surface", () => {
  it("shard-000000 carries image-type cards whose :content view renders empty inner", async () => {

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

    const contentView = entry79!.views.content;
    const slotEnd = contentView.lastIndexOf("data-slot=");
    const innerStart = contentView.indexOf(">", slotEnd) + 1;
    const innerEnd = contentView.lastIndexOf("</div>");
    const inner = contentView.slice(innerStart, innerEnd);
    expect(inner).toBe("");
    expect(inner).not.toContain("janmbtckiogaqbhlewfngdc");
  });
});