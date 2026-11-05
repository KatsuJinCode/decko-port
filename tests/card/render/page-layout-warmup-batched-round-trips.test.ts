

import { describe, expect, it } from "vitest";
import { renderPageBytes } from "../../../src/card/render/page.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

const CHAIN_DEPTH = 15;
const MENU_ITEMS = 24;

function chainName(i: number): string {
  return `Chain Page ${String(i).padStart(2, "0")}`;
}

async function seedBoundedDeck(): ReturnType<typeof createRenderTestStorage> {
  const storage = await createRenderTestStorage();

  await seedCard(storage, { id: 2, name: "Basic", codename: "basic", typeId: 2 });

  await seedCard(storage, { id: 4, name: "Pointer", codename: "pointer", typeId: 2 });
  await seedCard(storage, { id: 900, name: "*all", codename: "all", typeId: 2 });
  await seedCard(storage, { id: 901, name: "*layout", codename: "layout", typeId: 2 });
  await seedCard(storage, { id: 904, name: "*title", codename: "title", typeId: 2 });
  await seedCard(storage, { id: 905, name: "*favicon", codename: "favicon", typeId: 2 });
  await seedCard(storage, { id: 906, name: "*ace", codename: "ace", typeId: 2 });
  await seedCard(storage, { id: 907, name: "*tiny_mce", codename: "tiny_mce", typeId: 2 });

  await seedCard(storage, {
    id: 910,
    leftId: 900,
    rightId: 901,
    typeId: 2,
    dbContent: "Probe Layout",
  });

  await seedCard(storage, {
    id: 911,
    name: "Probe Layout",
    typeId: 2,
    dbContent: "{{_main|titled}}\n{{:chain start|titled}}\n{{:menu|core}}",
  });

  await seedCard(storage, { id: 920, name: "Chain Start", typeId: 2, dbContent: `{{${chainName(1)}|titled}}` });
  for (let i = 1; i <= CHAIN_DEPTH; i++) {
    const isTail = i === CHAIN_DEPTH;
    await seedCard(storage, {
      id: 1000 + i,
      name: chainName(i),
      typeId: 2,
      dbContent: isTail ? "<p>the-chain-tail</p>" : `{{${chainName(i + 1)}|titled}}`,
    });
  }

  await seedCard(storage, { id: 930, name: "*menu", codename: "menu", typeId: 4, dbContent: Array.from({ length: MENU_ITEMS }, (_, i) => `Menu Item ${String(i + 1).padStart(2, "0")}`).join("\n") });
  for (let i = 1; i <= MENU_ITEMS; i++) {
    await seedCard(storage, {
      id: 2000 + i,
      name: `Menu Item ${String(i).padStart(2, "0")}`,
      typeId: 2,
      dbContent: `<p>menu-item-${i}-body</p>`,
    });
  }

  await seedCard(storage, {
    id: 914,
    name: "Probe Page",
    typeId: 2,
    dbContent: "<p>the body</p>",
  });
  await storage.fetcher.codenames.ensureLoaded();
  storage.fetcher.installNameEnvironment();
  return storage;
}

describe("cold layout warm-up: batched + bounded reference closure", () => {
  it("renders the deep chain tail and the wide menu cold, under a round-trip ceiling", async () => {
    const storage = await seedBoundedDeck();
    storage.counting.reset();
    const page = await renderPageBytes(storage.engine, "Probe Page");

    expect(page).toContain("<p>the body</p>");
    expect(page).toContain("<p>the-chain-tail</p>");

    expect(page).toContain('title="Menu Item 01"');
    expect(page).toContain(`title="Menu Item ${String(MENU_ITEMS).padStart(2, "0")}"`);

    const { roundTrips } = storage.counting.snapshot();
    expect(roundTrips).toBeLessThanOrEqual(60);
  });

  it("warm re-render: the warm-up itself issues zero batches and stays complete", async () => {
    const storage = await seedBoundedDeck();
    await renderPageBytes(storage.engine, "Probe Page");
    const coldRoundTrips = storage.counting.snapshot().roundTrips;
    storage.counting.reset();
    const again = await renderPageBytes(storage.engine, "Probe Page");
    expect(again).toContain("<p>the-chain-tail</p>");

    expect(storage.engine.lastWarmupStats?.batches ?? -1).toBe(0);

    const warmRoundTrips = storage.counting.snapshot().roundTrips;
    expect(warmRoundTrips).toBeLessThan(coldRoundTrips);
  });
});
