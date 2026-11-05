

import { describe, expect, it } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "./render-test-storage.js";

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

      storage.counting.reset();
      const html = await storage.engine.render("Whole_Deck_Probe", "content");
      const snapshot = storage.counting.snapshot();

      const rendered = itemNames(html);
      expect(rendered).toHaveLength(120);

      const expectedOrder = [...rendered].sort((a, b) =>
        a.toLowerCase().replace(/\W+/g, "_").localeCompare(b.toLowerCase().replace(/\W+/g, "_")),
      );
      expect(rendered).toEqual(expectedOrder);
      expect(html).toContain('<div class="card-list card-list-bar search-result-list">');

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

      expect(rendered[0]).toBe("Chunk Parent+chunk child 001");
      expect(rendered[54]).toBe("Chunk Parent+chunk child 055");
      expect(snapshot.roundTrips).toBeLessThan(55);
      expect(snapshot.roundTrips).toBeLessThanOrEqual(20);
    } finally {
      storage.close();
    }
  });
});
