// Rule lookup tests — the storage walk side of the rule system.
//
// Tests use the same render-test-storage helper as the renderer tests
// (in-memory better-sqlite3 + the real LocalSqliteDriver, schema loaded
// from db/schema.sqlite.sql). Rule cards are seeded directly as rows.
//
// Compound names (the rule-card norm, e.g. "*all+*read") are stored with
// name=NULL/key=NULL and ride the junction (left_id/right_id) — see the
// fetch stream's port notes for the 2020 Lexicon convention. We seed them
// explicitly with leftId/rightId so the lookup walks the junction path
// the engine actually uses in production.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { findRule, findRules, nameAsPatternCardInput } from "../../../src/card/rules/lookup.js";
import { parseViewOverride, applyViewOverride, resolveViewOverride } from "../../../src/card/rules/apply.js";

let storage: RenderTestStorage | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  // Seed the minimum deck for rule lookup.
  // The "setting" cards (codenames all/read/write) and the "*all" set
  // module come first; compound rule cards ride the junction.
  await seedCard(storage, { id: 1, name: "*all", codename: "all" });
  await seedCard(storage, { id: 2, name: "Basic", codename: "basic" });
  await seedCard(storage, { id: 9, name: "*read", codename: "read" });
  await seedCard(storage, { id: 10, name: "*write", codename: "write" });
  // The junction row that glues *all + *read into the compound name.
  // leftId=1 (the *all set), rightId=9 (the *read setting).
  await seedCard(storage, { id: 3, leftId: 1, rightId: 9, dbContent: '{"view":"open","class":"custom-all"}' });
  // A type-specific rule on Basic+*type + *read.
  await seedCard(storage, { id: 4, name: "Basic+*type" });
  await seedCard(storage, { id: 5, leftId: 4, rightId: 9, dbContent: '{"view":"open","class":"custom-type"}' });
  // A leaf card of type Basic (so the patternsForCard walk yields Basic+*type)
  await seedCard(storage, { id: 6, name: "Leaf", typeId: 2, typeName: "Basic", dbContent: "leaf content" });
  // An orphan card with no type, so only *all applies
  await seedCard(storage, { id: 7, name: "Orphan", dbContent: "no type" });
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("findRule", () => {
  it("returns undefined when no candidates exist", async () => {
    const s = storage!;
    const result = await findRule(s.fetcher, nameAsPatternCardInput("Leaf"), "*nonexistent");
    expect(result).toBeUndefined();
  });

  it("finds *all+*read when the card has no type-specific rule", async () => {
    const s = storage!;
    const result = await findRule(s.fetcher, nameAsPatternCardInput("Orphan"), "*read");
    expect(result).toBeDefined();
    expect(result!.rule.id).toBe(3);
    expect(result!.rule.dbContent).toBe('{"view":"open","class":"custom-all"}');
    expect(result!.candidates).toContain("*all+*read");
  });

  it("returns all candidates for debugging", async () => {
    const s = storage!;
    const result = await findRule(s.fetcher, nameAsPatternCardInput("Leaf"), "*read");
    expect(result).toBeDefined();
    // Leaf is a real card, so patternsForCard yields at least *self + *all.
    // (*type requires a richer setup; covered by the set-patterns tests.)
    expect(result!.candidates.length).toBeGreaterThanOrEqual(2);
    expect(result!.candidates).toContain("*all+*read");
    expect(result!.candidates).toContain("Leaf+*self+*read");
  });

  it("walks candidates in registry precedence order", async () => {
    // Verified indirectly: the *all candidate appears AFTER the *self
    // candidate in the candidates list (registry precedence puts *self
    // first). The set-patterns tests cover this exhaustively.
    const s = storage!;
    const result = await findRule(s.fetcher, nameAsPatternCardInput("Leaf"), "*read");
    expect(result).toBeDefined();
    expect(result!.candidates.indexOf("Leaf+*self+*read")).toBeLessThan(
      result!.candidates.indexOf("*all+*read"),
    );
  });
});

describe("findRules (multiple settings)", () => {
  it("finds both *read and *write rules independently", async () => {
    const s = storage!;
    // Seed a *write rule on *all (junction row).
    await seedCard(s, { id: 8, leftId: 1, rightId: 10, dbContent: '{"view":"content","wrap":"div"}' });
    const results = await findRules(s.fetcher, nameAsPatternCardInput("Orphan"), ["*read", "*write"]);
    expect(results.length).toBe(2);
    const settings = results.map((r) => r.rule.name?.s ?? "").sort();
    expect(settings).toEqual(["*all+*read", "*all+*write"]);
  });
});

describe("parseViewOverride", () => {
  it("parses a valid JSON rule with view + class", () => {
    const override = parseViewOverride({ dbContent: '{"view":"open","class":"custom-all"}' } as never);
    expect(override).toEqual({ view: "open", class: "custom-all", opts: undefined });
  });

  it("puts unknown keys in opts (forward-compat)", () => {
    const override = parseViewOverride({
      dbContent: '{"view":"open","wrap":"accordion","newKey":"newValue"}',
    } as never);
    expect(override?.view).toBe("open");
    expect(override?.wrap).toBe("accordion");
    expect(override?.opts).toEqual({ newKey: "newValue" });
  });

  it("returns undefined for empty content", () => {
    expect(parseViewOverride({ dbContent: "" } as never)).toBeUndefined();
    expect(parseViewOverride({ dbContent: undefined } as never)).toBeUndefined();
    expect(parseViewOverride({ dbContent: null } as never)).toBeUndefined();
  });

  it("returns undefined for non-JSON content (legacy HAML deferred)", () => {
    expect(parseViewOverride({ dbContent: "%h1 Hello" } as never)).toBeUndefined();
    expect(parseViewOverride({ dbContent: "= link_to 'foo'" } as never)).toBeUndefined();
  });

  it("returns undefined for JSON without a view field", () => {
    expect(parseViewOverride({ dbContent: '{"class":"x"}' } as never)).toBeUndefined();
  });

  it("returns undefined when view is not a string", () => {
    expect(parseViewOverride({ dbContent: '{"view":42}' } as never)).toBeUndefined();
  });
});

describe("applyViewOverride", () => {
  it("returns the base HTML unchanged when override is undefined", () => {
    const base = '<div class="card-slot"><span>hi</span></div>';
    expect(applyViewOverride(base, undefined)).toBe(base);
  });

  it("appends class to the card-slot wrapper", () => {
    const base = '<div class="card-slot d0-card-content"><span>x</span></div>';
    const out = applyViewOverride(base, { view: "open", class: "lede" });
    expect(out).toContain('class="card-slot d0-card-content lede"');
  });

  it("swaps the title span class", () => {
    const base = '<span class="card-title" title="x">X</span>';
    const out = applyViewOverride(base, { view: "title", titleClass: "card-title-large" });
    expect(out).toContain('class="card-title-large"');
    expect(out).not.toContain('class="card-title"');
  });

  it("swaps the heading tag (h1/h2/h3)", () => {
    const base = '<h1 class="x"><span class="card-title">Title</span></h1>';
    const out = applyViewOverride(base, { view: "title", tag: "h3" });
    expect(out).toContain("<h3");
    expect(out).not.toContain("<h1");
  });

  it("styles the joint '+' separator", () => {
    const base = '<span class="card-title">A<span>+</span>B</span>';
    const out = applyViewOverride(base, { view: "title", jointClass: "joint-em" });
    expect(out).toContain('<span class="joint-em">+</span>');
  });
});

describe("resolveViewOverride (per-view rule selection)", () => {
  it("returns the rule matching the requested view", () => {
    const openRule = { dbContent: '{"view":"open"}' } as never;
    const contentRule = { dbContent: '{"view":"content"}' } as never;
    expect(resolveViewOverride("open", [openRule, contentRule])?.view).toBe("open");
    expect(resolveViewOverride("content", [openRule, contentRule])?.view).toBe("content");
  });

  it("returns undefined when no rule matches the view", () => {
    const openRule = { dbContent: '{"view":"open"}' } as never;
    expect(resolveViewOverride("title", [openRule])).toBeUndefined();
  });

  it("skips rules with non-matching content (legacy HAML etc)", () => {
    const hamlRule = { dbContent: "%h1 legacy" } as never;
    const openRule = { dbContent: '{"view":"open"}' } as never;
    expect(resolveViewOverride("open", [hamlRule, openRule])?.view).toBe("open");
  });
});
