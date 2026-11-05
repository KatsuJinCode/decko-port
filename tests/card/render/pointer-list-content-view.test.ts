// Pointer / List cardtype content-view shape (stream M3).
//
// Pins the structural byte shape the captured corpus bytes pin for
// pointer/list content rendering (card-mod-list-0.20.0
// set/abstract/01_list/html_views.rb:6-30: standard_pointer_core +
// standard_pointer_items + listing_list + nest_item + wrap_item).
// The exact slot data-attributes vary with the test seed (the
// corpus's yzzw has no row id; a port that backs everything in the
// cards table auto-assigns one — a divergence documented in
// `remainder`, not a render-shape gap), so the assertions here
// check the wrapper and slot-class shapes that DO survive any
// sensible seed (the div classes + the data-slot's `view` field +
// the item view + the deny/permit branch on the bar view).
//
// The shape pinned here:
//   * outer content-view slot (id `Xhome-content-view`)
//   * `<div class="card-list card-list-bar pointer-list">` wrapper
//   * per item: `<div class="pointer-item item-bar">…</div>` wrap
//   * inner item slot: slot id `${name}-mini_bar-view`, slot class
//     `card-slot mini_bar-view`, data-slot's view field `bar`
//     (the captured divergence Ruby's bar-and-box rendering
//     produces for items nested from inside a pointer/list content
//     view — slot id uses `mini_bar`, data-slot's view uses `bar`)

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
    // card-mod-list set/all/item.rb#raw_item_strings: content.split(/\n+/),
    // each item stripped of [[ / ]] brackets and surrounding whitespace.
    expect(rawItemStrings("a\nb\nc")).toEqual(["a", "b", "c"]);
    expect(rawItemStrings("a\n\nb")).toEqual(["a", "b"]);
    expect(rawItemStrings("[[a]]\n[[b]]")).toEqual(["a", "b"]);
    expect(rawItemStrings("  a  \n  b  ")).toEqual(["a", "b"]);
    expect(rawItemStrings("")).toEqual([""]);
  });

  it("isPointerOrListCard matches Ruby `card.type_code` for pointer + list cardtypes", () => {
    // The render's pointer/list dispatch checks this directly; the
    // canonical Ruby check is `card.type_code == :pointer || :list`.
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
      baseIds.add(34843);
      baseIds.add(22283);
      storage = await createStructureSeededStorageFor(baseIds);
      // Seed NOTHING for yzzw (the *home pointer's single item): the
      // corpus's yzzw has NO row (verified directly against the corpus
      // db), so the oracle's mini_bar slot came from the UNKNOWN-card
      // path — bar.rb:9 `view :bar, unknown: :mini_bar` on a fetch miss.
      // The mini_bar body's two quiet-denial spans fall out of the
      // phantom path the engine already exercises for absent items
      // (pointer-list.ts phantomPointerListItem). Seeding yzzw as a real
      // denied row here made the engine route through the readable-card
      // denial shape instead — which the dual-lane raw oracle renders as
      // the BARE quiet span (538 bare-span denied real items, zero
      // mini_bar wraps), a shape pinned in
      // tests/card/permissions/read-rule-left-delegation.test.ts.
      const html = await storage.engine.render("*home", "content");
      // The card-list wrapper (standard_pointer_core).
      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');
      // The per-item wrap (html_views.rb#wrap_item).
      expect(html).toContain('<div class="pointer-item item-bar">');
      // The inner item slot (mini_bar slot id, bar data-slot view).
      expect(html).toContain('id="yzzw-mini_bar-view"');
      expect(html).toContain('class="card-slot mini_bar-view');
      // data-slot.view = "bar" (the captured divergence Ruby's
      // bar-and-box rendering produces for items nested from inside
      // a pointer/list content view).
      expect(html).toMatch(/data-slot="[^"]*&quot;view&quot;:&quot;bar&quot;/);
      // yzzw's slot records the nested-name the captured bytes pin.
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
      // bifaarykabanhm has NO row in the corpus db (verified directly) —
      // same absent-item mini_bar path as yzzw above; no seed.
      const html = await storage.engine.render("*all+*layout", "content");
      // The list cardtype dispatches to the SAME standard_pointer_core
      // path (card-mod-list set/type/list.rb `include_set Abstract::List`
      // — there is no per-type list rendering override).
      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');
      expect(html).toContain('id="bifaarykabanhm-mini_bar-view"');
      expect(html).toMatch(/data-slot="[^"]*&quot;view&quot;:&quot;bar&quot;/);
    },
  );
});
