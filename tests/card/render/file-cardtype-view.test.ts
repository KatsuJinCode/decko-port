

import { describe, expect, it } from "vitest";
import { formatFileCore } from "../../../src/card/render/views.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

describe("formatFileCore — the file cardtype :core body (set/type/file.rb:24-28)", () => {
  it.each([

    ["https://example.com/attach.png", "https://example.com/attach.png"],
    ["http://example.com/attach.pdf", "http://example.com/attach.pdf"],
    ["(bucket)/808/42.png", "(bucket)/808/42.png"],
    ["~808/42.png", "/files/808/42.png"],
    [":logo/carey.png", "/files/logo.carey.png"],
  ])("source content '%s' renders the <a href> anchor", (input, source) => {
    expect(formatFileCore(input)).toBe(`<a href="${source}">${source}</a>`);
  });

  it.each([

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

describe("File-type card :content view — empty inner for prefix-less content", () => {
  it("a file-typed card renders <div attrs></div> for bare-token content", async () => {

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

      expect(html).toContain('data-card-name="bctnycubfauuwcwfx+syryhpllh"');

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

      expect(html).toContain("<p>before</p>");
      expect(html).toContain("<p>after</p>");
    } finally {
      storage.close();
    }
  });

  it("file card with a real web source renders the <a href> anchor inside the slot", async () => {

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

describe("captured corpus — File-type card byte surface", () => {
  it("shard-000000 corpus:808's oracle :content is the empty-inner wrapper", async () => {

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

    const contentView = entry808!.views.content;
    const slotEnd = contentView.lastIndexOf("data-slot=");
    const innerStart = contentView.indexOf(">", slotEnd) + 1;
    const innerEnd = contentView.lastIndexOf("</div>");
    const inner = contentView.slice(innerStart, innerEnd);
    expect(inner).toBe("");
    expect(inner).not.toContain("pxzrynkvadsrfwhwnjnirbxo");
  });
});
