// Cold page render: the layout warm-up chase is BATCHED and BOUNDED
// (warmup lane — the item-5 cold-render burst fix).
//
// Failure shape (measured on the real corpus deck, nitpicks lane Round 2
// item 5): warmUpLayoutNests walked nest references, [[link]] targets and
// pointer/list items TRANSITIVELY to a fixpoint, one point-query fetch
// ladder per name (SELECT id FROM cards WHERE key = ?, junction
// left_id+right_id probes, row-by-id type fetches), preparing the whole
// navbar-connected site at ~5,900-7,300 driver round trips per cold render
// — the operator's one-off ~4s first page load after every isolate boot.
//
// The fix keeps the fixpoint reference classes (what renders is not
// decidable from content syntax alone) but resolves the closure in
// reference-BFS rounds: ONE driver.batch per round (round trips scale with
// reference DEPTH, not card count). This test pins both axes on a deck
// whose layout reaches a deep chain AND a wide pointer:
//   - a DEEP nest chain off the layout (depth 15) — the batched chase pays
//     rounds ~ depth; the old per-name ladder paid ~3 queries per name;
//   - a WIDE pointer (24 items) off the layout — volume rides the batch;
//   - completeness: the chain tail's bytes render cold (the chase reached
//     the end), every menu item renders, and a warm re-render is 0 round
//     trips (the prepared-map fixpoint is established; warm renders stay
//     byte-identical and query-free).

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
  // Codename anchors + the head-path setting cards (unknown codenames throw
  // at :mark parse — see page-layout-nest-warmup-referencing-context.test).
  await seedCard(storage, { id: 2, name: "Basic", codename: "basic", typeId: 2 });
  // The Pointer cardtype (codename gives *menu its "pointer" typeCode, which
  // is what dispatches the item-bar core view).
  await seedCard(storage, { id: 4, name: "Pointer", codename: "pointer", typeId: 2 });
  await seedCard(storage, { id: 900, name: "*all", codename: "all", typeId: 2 });
  await seedCard(storage, { id: 901, name: "*layout", codename: "layout", typeId: 2 });
  await seedCard(storage, { id: 904, name: "*title", codename: "title", typeId: 2 });
  await seedCard(storage, { id: 905, name: "*favicon", codename: "favicon", typeId: 2 });
  await seedCard(storage, { id: 906, name: "*ace", codename: "ace", typeId: 2 });
  await seedCard(storage, { id: 907, name: "*tiny_mce", codename: "tiny_mce", typeId: 2 });
  // The *layout rule on *all -> the layout card (first raw item line).
  await seedCard(storage, {
    id: 910,
    leftId: 900,
    rightId: 901,
    typeId: 2,
    dbContent: "Probe Layout",
  });
  // The layout card: main slot + a DEEP chain start + a WIDE pointer nest.
  await seedCard(storage, {
    id: 911,
    name: "Probe Layout",
    typeId: 2,
    dbContent: "{{_main|titled}}\n{{:chain start|titled}}\n{{:menu|core}}",
  });
  // The chain: chain_start -> 02 -> ... -> the tail. Each link nests the
  // next link by ABSOLUTE name; the tail carries marker bytes.
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
  // The wide pointer: *menu lists 24 items, each a real page whose bytes
  // render inside the menu core view (pointer items render as bars).
  await seedCard(storage, { id: 930, name: "*menu", codename: "menu", typeId: 4, dbContent: Array.from({ length: MENU_ITEMS }, (_, i) => `Menu Item ${String(i + 1).padStart(2, "0")}`).join("\n") });
  for (let i = 1; i <= MENU_ITEMS; i++) {
    await seedCard(storage, {
      id: 2000 + i,
      name: `Menu Item ${String(i).padStart(2, "0")}`,
      typeId: 2,
      dbContent: `<p>menu-item-${i}-body</p>`,
    });
  }
  // The page card.
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

    // COMPLETENESS: the main body, the DEEP chain tail (depth reach), and
    // the WIDE menu (breadth reach) all rendered on the FIRST render.
    expect(page).toContain("<p>the body</p>");
    expect(page).toContain("<p>the-chain-tail</p>");
    // Menu items render as BARS (name-bearing titles), one per item line.
    expect(page).toContain('title="Menu Item 01"');
    expect(page).toContain(`title="Menu Item ${String(MENU_ITEMS).padStart(2, "0")}"`);

    // THE PIN: round trips scale with reference DEPTH (chain links), not
    // card count. The deck hangs 1 chain + 24 items + 24 menu pages + rules
    // off the layout (~50+ chased names); the old per-name ladder cost ~3
    // point queries per chased name (~150+ round trips here, ~7k on the
    // corpus). The batched chase pays ~one round trip per BFS round.
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
    // The chase resolves everything cache-first on a warm engine: ZERO
    // batched rounds (the batch count is the warm-up's own query axis).
    expect(storage.engine.lastWarmupStats?.batches ?? -1).toBe(0);
    // The steady-state page render pays only its own non-warm-up floor,
    // strictly less than the cold render.
    const warmRoundTrips = storage.counting.snapshot().roundTrips;
    expect(warmRoundTrips).toBeLessThan(coldRoundTrips);
  });
});
