

import { describe, expect, it } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "./render-test-storage.js";

interface ChainCard {
  id: number;
  name?: string;
  leftId?: number;
  rightId?: number;
  dbContent?: string;
}

function chainCards(depth: number): ChainCard[] {
  const cards: ChainCard[] = [
    { id: 701, name: "chain_c1" },
    { id: 702, name: "chain_c2" },
  ];
  if (depth < 2) return cards;

  cards.push({ id: 712, leftId: 701, rightId: 702, dbContent: "junction depth 2 body" });
  let previousId = 712;
  for (let level = 3; level <= depth; level++) {
    const sideId = 700 + level;
    cards.push({ id: sideId, name: `chain_c${level}` });
    const junctionId = 700 + level + 100;
    cards.push({
      id: junctionId,
      leftId: previousId,
      rightId: sideId,
      dbContent: `junction depth ${level} body`,
    });
    previousId = junctionId;
  }
  return cards;
}

describe("depth-3+ junction inclusion closure (deploy-notes finding 2 fix)", () => {
  it("renders a depth-3 junction inclusion chain, covered by the per-key closure rounds", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      for (const card of chainCards(3)) {
        await seedCard(storage, card);
      }
      await seedCard(storage, {
        id: 900,
        name: "Junction Renderer",
        dbContent: "<p>deep: {{chain_c1+chain_c2+chain_c3}}</p>",
      });
      storage.counting.reset();
      const html = await storage.engine.render("Junction Renderer", "content");
      expect(html).toContain("junction depth 3 body");
      expect(html).toContain("titled-view");

      expect(storage.engine.lastRenderStats?.fallbackRounds).toBe(2);

      const snapshot = storage.counting.snapshot();
      expect(snapshot.roundTrips).toBe(4);
      expect(snapshot.statements).toBe(12);
    } finally {
      storage.close();
    }
  });

  it("renders a depth-4 junction inclusion chain, covered by the per-key closure rounds", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      for (const card of chainCards(4)) {
        await seedCard(storage, card);
      }
      await seedCard(storage, {
        id: 900,
        name: "Junction Renderer",
        dbContent: "<p>deeper: {{chain_c1+chain_c2+chain_c3+chain_c4}}</p>",
      });
      storage.counting.reset();
      const html = await storage.engine.render("Junction Renderer", "content");
      expect(html).toContain("junction depth 4 body");
      expect(storage.engine.lastRenderStats?.fallbackRounds).toBe(3);
    } finally {
      storage.close();
    }
  });

  it("resolves a depth-3 junction through the recursive side-id fallback when the SQL key transform misses", async () => {
    const storage = await createRenderTestStorage();
    try {

      await seedCard(storage, { id: 2, name: "RichText" });
      await seedCard(storage, { id: 701, name: "chain_c1" });
      await seedCard(storage, { id: 702, name: "Oracle Basics", dbContent: "stemmed body" });
      await seedCard(storage, { id: 712, leftId: 701, rightId: 702, dbContent: "pair body" });
      await seedCard(storage, { id: 703, name: "chain_c3" });
      await seedCard(storage, { id: 803, leftId: 712, rightId: 703, dbContent: "deep body" });
      await seedCard(storage, {
        id: 900,
        name: "Junction Renderer",
        dbContent: "<p>miss: {{chain_c1+Oracle Basics+chain_c3}}</p>",
      });
      const html = await storage.engine.render("Junction Renderer", "content");
      expect(html).toContain("deep body");
      expect(storage.engine.lastRenderStats!.fallbackRounds).toBeGreaterThanOrEqual(1);
    } finally {
      storage.close();
    }
  });

  it("keeps a depth-2 junction render at the constant query shape (no regression)", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      for (const card of chainCards(2)) {
        await seedCard(storage, card);
      }
      await seedCard(storage, {
        id: 900,
        name: "Junction Renderer",
        dbContent: "<p>pair: {{chain_c1+chain_c2}}</p>",
      });
      storage.counting.reset();
      const html = await storage.engine.render("Junction Renderer", "content");
      expect(html).toContain("junction depth 2 body");
      const snapshot = storage.counting.snapshot();

      expect(snapshot.roundTrips).toBe(3);
      expect(snapshot.statements).toBe(11);
    } finally {
      storage.close();
    }
  });
});
