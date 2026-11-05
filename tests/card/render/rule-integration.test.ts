

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "./render-test-storage.js";
import { DeckoName } from "../../../src/card/name.js";

let storage: RenderTestStorage | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();

  await seedCard(storage, { id: 1, name: "*all", codename: "all" });
  await seedCard(storage, { id: 2, name: "*open", codename: "open" });
  await seedCard(storage, {
    id: 3, leftId: 1, rightId: 2,
    dbContent: '{"view":"open","class":"lede"}',
  });

  await seedCard(storage, { id: 4, name: "Hello", dbContent: "hello body" });
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("RenderEngine + rule engine integration", () => {
  it("applies a *all+*open rule's class override to the rendered HTML", async () => {
    const s = storage!;
    const html = await s.engine.render("Hello", "open");

    expect(html).toMatch(/<div[^>]*\bclass="[^"]*\blede\b/);
  });

  it("does NOT apply a rule for a different view", async () => {
    const s = storage!;

    const html = await s.engine.render("Hello", "content");
    expect(html).not.toMatch(/\blede\b/);
  });

  it("rule cache hit on second render: override applied, zero extra queries", async () => {
    const s = storage!;
    await s.engine.render("Hello", "open");

    (s.counting as unknown as { reset: () => void }).reset();
    const html2 = await s.engine.render("Hello", "open");

    expect(html2).toMatch(/\blede\b/);

    const counts = (s.counting as unknown as { snapshot: () => { statements: number; roundTrips: number } }).snapshot();
    expect(counts.roundTrips).toBe(0);
    expect(counts.statements).toBe(0);
  });

  it("works for compound card names too (junction-resolved)", async () => {
    const s = storage!;

    await seedCard(s, { id: 5, name: "A" });
    await seedCard(s, { id: 6, name: "B" });
    await seedCard(s, { id: 10, leftId: 5, rightId: 6, dbContent: "compound body" });
    const html = await s.engine.render("A+B", "open");
    expect(html).toMatch(/\blede\b/);
  });
});
