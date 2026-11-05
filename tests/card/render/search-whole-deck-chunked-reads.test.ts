// The whole-deck search read path's transport chunking (render.ts#runSearch
// + readCardRowsByIdChunked + composeAndCacheSqlRows): a Search card whose
// CQL matches a whole deck used to cost ONE point query per result row
// (fetchById in the item walk) — the demo's 6,233-row probe measured 12,475
// driver round trips for one page render, far past the Workers free tier's
// 50-per-invocation subrequest cap. The read now rides chunked IN-list
// batches and the item walk consumes the composed records directly.
//
// This suite pins, hermetically (no corpus fixture), for result sets that
// cross chunk boundaries:
//   1. RESULT-SET IDENTITY: the rendered item count equals the CQL row
//      count, and the rendered item ORDER equals the CQL row order
//      (sort: name -> key ascending) — same rows, same order.
//   2. BOUNDED ROUND TRIPS: the render's driver-call count stays flat
//      while the item count scales (roundTrips < itemCount would fail on
//      any return of the per-item point-read shape) and the chunked read
//      itself rides ONE batch call per 20 statements.
//   3. JUNCTION ITEMS: rows whose names compose through side cards stay
//      bounded too (the side rows ride the same chunked read).

import { describe, expect, it } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "./render-test-storage.js";

/** Seed the deck for one whole-deck search scenario and warm the CQL name
 *  resolver the way the render walk does (a warm-up render enriches the
 *  named cards into idsByKey — the same seeding pattern
 *  search-card-list-render-parity.test.ts documents). */
async function seedWholeDeckSearchDeck(
  storage: RenderTestStorage,
  opts: { itemCount: number; junctions: boolean },
): Promise<void> {
  await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
  await seedCard(storage, { id: 3, name: "Cardtype", codename: "cardtype", typeId: 3 });
  await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 3 });
  await seedCard(storage, { id: 70, name: "Chunk Note", typeId: 3 });

  const names: string[] = [];
  if (opts.junctions) {
    await seedCard(storage, { id: 71, name: "Chunk Parent", typeId: 2, dbContent: "parent" });
    for (let i = 1; i <= opts.itemCount; i++) {
      const label = String(i).padStart(3, "0");
      const childId = 9000 + i;
      const junctionId = 8000 + i;
      await seedCard(storage, { id: childId, name: `chunk child ${label}`, typeId: 2, dbContent: `child ${label}` });
      await seedCard(storage, {
        id: junctionId,
        name: `Chunk Parent+junction ${label}`,
        leftId: 71,
        rightId: childId,
        typeId: 2,
        dbContent: `junction ${label}`,
      });
      names.push(`Chunk Parent+junction ${label}`);
    }
    await seedCard(storage, {
      id: 80,
      name: "Whole Deck Junction Probe",
      typeId: 98,
      dbContent: '{"left":"Chunk Parent","sort":"name"}',
    });
    // Warm-up: enrich the parent (the search card's left operand) into
    // idsByKey so the CQL resolves it — the search card's own JSON content
    // has no nest references, so the prefetch closure never touches it.
    await storage.engine.render("Chunk Parent", "content");
  } else {
    for (let i = 1; i <= opts.itemCount; i++) {
      const label = String(i).padStart(3, "0");
      await seedCard(storage, {
        id: 100 + i,
        name: `chunk item ${label}`,
        typeId: 70,
        dbContent: `item ${label} content`,
      });
      names.push(`chunk item ${label}`);
    }
    await seedCard(storage, {
      id: 80,
      name: "Whole Deck Probe",
      typeId: 98,
      dbContent: '{"type":"Chunk Note","sort":"name"}',
    });
    await storage.engine.render("chunk item 001", "content");
  }
  return;
}

/** Extract the rendered item sequence (the name each search-result-item
 *  slot renders) from the card_list bytes. */
function itemNames(html: string): string[] {
  const names: string[] = [];
  const re = /search-result-item item-bar">.*?data-card-name="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) names.push(match[1]!);
  return names;
}

describe("whole-deck search read path rides chunked reads (result identity, bounded round trips)", () => {
  it("120 simple items (3 chunk statements): order + count identity, round trips bounded", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedWholeDeckSearchDeck(storage, { itemCount: 120, junctions: false });
      // Baseline sanity: the per-item point-read shape would spend >= 120
      // round trips on the item walk alone (one fetchById per row); pin the
      // N+1 absence on the SAME snapshot that pins identity.
      storage.counting.reset();
      const html = await storage.engine.render("Whole_Deck_Probe", "content");
      const snapshot = storage.counting.snapshot();

      const rendered = itemNames(html);
      expect(rendered).toHaveLength(120);
      // same rows, same order: sort: name renders key-ascending
      const expectedOrder = [...rendered].sort((a, b) =>
        a.toLowerCase().replace(/\W+/g, "_").localeCompare(b.toLowerCase().replace(/\W+/g, "_")),
      );
      expect(rendered).toEqual(expectedOrder);
      expect(html).toContain('<div class="card-list card-list-bar search-result-list">');

      // Bounded transport: the render may not scale driver calls with the
      // result set. (The per-item point-read shape this lane replaced
      // measures ~1+ round trip per item — 120 here — plus the search.)
      expect(snapshot.roundTrips).toBeLessThan(120);
      expect(snapshot.roundTrips).toBeLessThanOrEqual(20);
    } finally {
      storage.close();
    }
  });

  it("55 junction items whose sides must compose: still bounded, order preserved", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedWholeDeckSearchDeck(storage, { itemCount: 55, junctions: true });
      storage.counting.reset();
      const html = await storage.engine.render("Whole_Deck_Junction_Probe", "content");
      const snapshot = storage.counting.snapshot();

      const rendered = itemNames(html);
      expect(rendered).toHaveLength(55);
      // A junction's rendered name composes from its SIDES (left+right —
      // the 2020 NULL-name convention), so the items render the composed
      // "Chunk Parent+chunk child NNN" names, key-ascending.
      expect(rendered[0]).toBe("Chunk Parent+chunk child 001");
      expect(rendered[54]).toBe("Chunk Parent+chunk child 055");
      expect(snapshot.roundTrips).toBeLessThan(55);
      expect(snapshot.roundTrips).toBeLessThanOrEqual(20);
    } finally {
      storage.close();
    }
  });
});
