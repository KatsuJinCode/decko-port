

import { describe, it, expect, afterAll } from "vitest";
import {
  createStructureSeededStorageFor,
  readShardLines,
} from "./structure-corpus-seeding.js";
import { type RenderTestStorage, seedCard } from "./render-test-storage.js";
import { isPointerOrListCard, rawItemStrings } from "../../../src/card/render/pointer-list.js";
import { DeckoName } from "../../../src/card/name.js";

let storage: RenderTestStorage | undefined;

afterAll(() => {
  storage?.close();
});

describe("pointer/list content view (stream M3 structural shape)", () => {
  it("rawItemStrings splits content on /\\n+/ and strips [[ ]] brackets", () => {

    expect(rawItemStrings("a\nb\nc")).toEqual(["a", "b", "c"]);
    expect(rawItemStrings("a\n\nb")).toEqual(["a", "b"]);
    expect(rawItemStrings("[[a]]\n[[b]]")).toEqual(["a", "b"]);
    expect(rawItemStrings("  a  \n  b  ")).toEqual(["a", "b"]);
    expect(rawItemStrings("")).toEqual([""]);
  });

  it("isPointerOrListCard matches Ruby `card.type_code` for pointer + list cardtypes", () => {

    expect(
      isPointerOrListCard({ typeCode: "pointer" } as unknown as Parameters<typeof isPointerOrListCard>[0]),
    ).toBe(true);
    expect(
      isPointerOrListCard({ typeCode: "list" } as unknown as Parameters<typeof isPointerOrListCard>[0]),
    ).toBe(true);
    expect(
      isPointerOrListCard({ typeCode: "search_type" } as unknown as Parameters<typeof isPointerOrListCard>[0]),
    ).toBe(false);
    expect(
      isPointerOrListCard({ typeCode: "cardtype" } as unknown as Parameters<typeof isPointerOrListCard>[0]),
    ).toBe(false);
    expect(
      isPointerOrListCard({} as unknown as Parameters<typeof isPointerOrListCard>[0]),
    ).toBe(false);
  });

  it(
    "*home pointer content view renders the card-list pointer-list wrapper with item-wrap and mini_bar slot",
    async () => {
      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(77);
      baseIds.add(34840);
      baseIds.add(22283);
      storage = await createStructureSeededStorageFor(baseIds);

      const html = await storage.engine.render("*home", "content");

      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');

      expect(html).toContain('<div class="pointer-item item-bar">');

      expect(html).toContain('id="yzzw-mini_bar-view"');
      expect(html).toContain('class="card-slot mini_bar-view');

      expect(html).toMatch(/data-slot="[^"]*&quot;view&quot;:&quot;bar&quot;/);

      expect(html).toContain('&quot;nest_name&quot;:&quot;yzzw&quot;');
    },
  );

  it(
    "*all+*layout list content view renders the card-list pointer-list wrapper (list cardtype dispatches to the same code path)",
    async () => {
      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(275);
      baseIds.add(22283);
      storage = await createStructureSeededStorageFor(baseIds);

      const html = await storage.engine.render("*all+*layout", "content");

      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');
      expect(html).toContain('id="bifaarykabanhm-mini_bar-view"');
      expect(html).toMatch(/data-slot="[^"]*&quot;view&quot;:&quot;bar&quot;/);
    },
  );
});
