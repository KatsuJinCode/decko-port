// Pointer/list item slot shape splits on the item's READ permission.
//
// Pins the read-denial gate on the pointer/list item's slot shape
// (src/card/render/views.ts#renderPointerListItem):
//
//   * READABLE item -> the `bar-view` slot the standard nestRecord bar
//     dispatch produced: id `${safeKey}-bar-view`, class
//     `card-slot bar-view ...`, data-card-id present, full titled bar
//     body. Two independent oracles pin this shape:
//       - corpus v2 recapture (fixtures/corpus-v2/recapture): 42
//         readable pointer-item slots carry `bar-view` (e.g. shard
//         entry id 45410 "yol" content view -> items
//         `id="awheasxlcszvy-bar-view"` with data-card-id and the
//         bar-left card-title body).
//       - live wire (tmp/live-wire/Aikido_Oak_Cliff.html): the
//         Aikido Oak Cliff+related list renders its readable items as
//         `<div id="aikido_oak_cliff-gallery-bar-view"
//         class="card-slot bar-view ..." data-card-id="44345" ...>`
//         with the full bar body.
//   * READ-DENIED item with a REAL row -> the BARE quiet-denial span
//     inside the pointer-item div: the nested :bar render short-circuits
//     at the view-permission gate (view/permission.rb:19-23
//     altered_view) before any slot wrap. The dual-lane raw oracle
//     pins this 538 times (expected-v2 census) — e.g. "ABCglobal
//     20100722 Iris Nick Leon Brandon" under
//     "Center for Embodied Change+Pages" open — and NEVER renders a
//     mini_bar wrap for a denied item with a row. The mini_bar slot is
//     bar.rb:9's UNKNOWN-card substitution (`view :bar, unknown:
//     :mini_bar`): all 270 mini_bar-with-denial-body oracle slots wrap
//     ABSENT-ROW items (the anonymizer-renamed BasicCs family — yzzw,
//     "Test Person 01" et al. have no cards row), which the engine's
//     phantom path (pointer-list.ts phantomPointerListItem) covers.
//
// The prior revisions of this file pinned mini_bar for denied REAL
// items — a shape no oracle byte carries (the anonymized-corpus capture
// had blurred row-absence into row-denial).
//
// The prior revision swapped bar-view -> mini_bar-view UNCONDITIONALLY
// for every known item, producing mini_bar for readable items and
// failing both oracle families above.

import { describe, it, expect, afterAll } from "vitest";
import {
  createStructureSeededStorageFor,
  readShardLines,
} from "./structure-corpus-seeding.js";
import { createRenderTestStorage, seedCard, type RenderTestStorage } from "./render-test-storage.js";

let plainStorage: RenderTestStorage | undefined;
let corpusStorage: Awaited<ReturnType<typeof createStructureSeededStorageFor>> | undefined;

afterAll(() => {
  plainStorage?.close();
  corpusStorage?.close();
});

describe("pointer/list item slot: readable items keep the bar-view slot, denied real items render the bare span", () => {
  it(
    "a List card renders its readable item as a bar-view slot with data-card-id and the titled bar body",
    async () => {
      // Rule-less storage: the read-permission state's rule-less
      // allowance keeps every card readable (render.ts readPermission
      // gate), isolating the readable half of the split.
      plainStorage = await createRenderTestStorage();
      // The List cardtype card (codename drives the pointer/list
      // dispatch's typeCode check) + the host list + the item.
      await seedCard(plainStorage, { id: 7, name: "List", codename: "list", typeId: 2 });
      await seedCard(plainStorage, {
        id: 99100,
        name: "deferred lane list",
        typeId: 7,
        dbContent: "readable item",
      });
      await seedCard(plainStorage, {
        id: 99101,
        name: "readable item",
        typeId: 2,
        dbContent: "<p>readable body</p>",
      });
      const html = await plainStorage.engine.render("deferred lane list", "content");

      // Readable item: the bar-view slot nestRecord produced — id,
      // class, and the data-card-id the slot's card carries. The slot
      // must NOT carry the mini_bar swap.
      expect(html).toContain('id="readable_item-bar-view"');
      expect(html).toMatch(/class="card-slot bar-view [^"]*"/);
      expect(html).toContain('data-card-name="readable item"');
      expect(html).toContain('data-card-id="99101"');
      expect(html).not.toContain('id="readable_item-mini_bar-view"');
      // The readable item renders the titled bar body (bar-left with
      // the card-title span — live Aikido +Gallery shape).
      expect(html).toMatch(/bar-left[\s\S]{0,200}card-title/);
    },
  );

  it(
    "a List card renders its read-denied item (a real row) as the bare quiet span, not a mini_bar wrap",
    async () => {
      // Corpus-seeded storage (the read-rule universe included): the
      // item stores the corpus's denying swtktey+*type+*read rule
      // (22283, party anyone_signed_in) exactly like the corpus's
      // denied items do. The item HAS a row, so the nested :bar render
      // denies at the view-permission gate — the bare span — and the
      // mini_bar (unknown-card) substitution must not fire.
      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(22281); // the swtktey type card (set-key TYPE token)
      baseIds.add(22282); // the swtktey+*type set card
      corpusStorage = await createStructureSeededStorageFor(baseIds);
      await seedCard(corpusStorage, {
        id: 99102,
        name: "deferred lane denied list",
        typeId: 47,
        dbContent: "denied item",
      });
      await seedCard(corpusStorage, {
        id: 99103,
        name: "denied item",
        typeId: 22281,
        readRuleId: 22283,
        readRuleClass: "*type",
      });
      const html = await corpusStorage.engine.render("deferred lane denied list", "content");
      expect(html).toContain('pointer-item item-bar"><span class="denied">');
      expect(html).not.toContain('id="denied_item-mini_bar-view"');
      expect(html).not.toContain('id="denied_item-bar-view"');
    },
  );
});
