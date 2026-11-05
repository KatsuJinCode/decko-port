// Render+rule integration test: a rule card seeded for a card actually
// transforms the rendered HTML through the RenderEngine.
//
// Demonstrates the full path:
//   1. Seed *all, *open (setting cards) + a junction rule card *all+*open
//      with db_content = JSON {"view":"open","class":"lede"}.
//   2. Render a card of type Basic through RenderEngine.
//   3. The :open view runs; the rule walk finds *all+*open; the override
//      appends "lede" to the card-slot wrapper class.
//   4. The cache hits on the second render, so the same override is
//      applied without another rule walk.

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
  // The catch-all set + the *open setting card + the rule junction.
  await seedCard(storage, { id: 1, name: "*all", codename: "all" });
  await seedCard(storage, { id: 2, name: "*open", codename: "open" });
  await seedCard(storage, {
    id: 3, leftId: 1, rightId: 2,
    dbContent: '{"view":"open","class":"lede"}',
  });
  // The leaf card the test will render.
  await seedCard(storage, { id: 4, name: "Hello", dbContent: "hello body" });
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("RenderEngine + rule engine integration", () => {
  it("applies a *all+*open rule's class override to the rendered HTML", async () => {
    const s = storage!;
    const html = await s.engine.render("Hello", "open");
    // The rule's "class":"lede" was appended to the card-slot wrapper.
    expect(html).toMatch(/<div[^>]*\bclass="[^"]*\blede\b/);
  });

  it("does NOT apply a rule for a different view", async () => {
    const s = storage!;
    // No rule card exists for *content; render must be unchanged from the
    // base view output (no `lede` class).
    const html = await s.engine.render("Hello", "content");
    expect(html).not.toMatch(/\blede\b/);
  });

  it("rule cache hit on second render: override applied, zero extra queries", async () => {
    const s = storage!;
    await s.engine.render("Hello", "open");
    // Reset the counters so we measure ONLY the second render.
    (s.counting as unknown as { reset: () => void }).reset();
    const html2 = await s.engine.render("Hello", "open");
    // The override is still applied (rule cache hit), even if the slot-id
    // (randomized per render) differs between calls.
    expect(html2).toMatch(/\blede\b/);
    // The rule cache should have served the override without re-walking.
    const counts = (s.counting as unknown as { snapshot: () => { statements: number; roundTrips: number } }).snapshot();
    expect(counts.roundTrips).toBe(0);
    expect(counts.statements).toBe(0);
  });

  it("works for compound card names too (junction-resolved)", async () => {
    const s = storage!;
    // Seed a compound card "A+B" with junction row id=10.
    await seedCard(s, { id: 5, name: "A" });
    await seedCard(s, { id: 6, name: "B" });
    await seedCard(s, { id: 10, leftId: 5, rightId: 6, dbContent: "compound body" });
    const html = await s.engine.render("A+B", "open");
    expect(html).toMatch(/\blede\b/);
  });
});
