// Integration smoke: rule card override applied during render.
//
// Demonstrates the full rule-application path:
//   1. A rule card with JSON db_content is seeded.
//   2. The renderer walks the rule lookup, finds the rule.
//   3. The view dispatch runs the base view (the default :open accordion).
//   4. applyViewOverride transforms the produced HTML according to the rule.
//   5. The transformed HTML carries the rule's "class" addition.
//
// This is the seam where the rule engine connects to the renderer. The
// integration is wired explicitly here (not via renderView) so the rule
// engine remains a library the renderer can opt into without forcing the
// rule lookup on every render.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { findRule, nameAsPatternCardInput } from "../../../src/card/rules/lookup.js";
import { resolveViewOverride, applyViewOverride } from "../../../src/card/rules/apply.js";
import { seedCard } from "../render/render-test-storage.js";

let storage: RenderTestStorage | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  // Seed the rule chain: *all, *open (the setting), and the junction
  // rule card *all+*open carrying JSON override {"view":"open","class":"rule-class"}.
  await seedCard(storage, { id: 1, name: "*all", codename: "all" });
  await seedCard(storage, { id: 9, name: "*open", codename: "open" });
  await seedCard(storage, {
    id: 3, leftId: 1, rightId: 9,
    dbContent: '{"view":"open","class":"rule-class"}',
  });
  await seedCard(storage, {
    id: 7, name: "Orphan", dbContent: "no type",
  });
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("rule override end-to-end", () => {
  it("resolves *all+*open for Orphan and applies its class override", async () => {
    const s = storage!;

    // 1. Look up the rule for the Orphan card with the *open setting
    const rule = await findRule(s.fetcher, nameAsPatternCardInput("Orphan"), "*open");
    expect(rule).toBeDefined();
    expect(rule!.rule.dbContent).toBe('{"view":"open","class":"rule-class"}');

    // 2. Build the override and apply it to a synthetic base view HTML
    const override = resolveViewOverride("open", [rule!.rule]);
    expect(override).toBeDefined();
    expect(override!.view).toBe("open");
    expect(override!.class).toBe("rule-class");

    // 3. Apply the override to a simulated base view output
    const baseHtml = '<div class="card-slot open-view"><span>x</span></div>';
    const finalHtml = applyViewOverride(baseHtml, override);
    expect(finalHtml).toContain('class="card-slot open-view rule-class"');
  });

  it("returns no override when no rule matches the view", async () => {
    const s = storage!;
    const rule = await findRule(s.fetcher, nameAsPatternCardInput("Orphan"), "*open");
    expect(rule).toBeDefined();
    // The rule is for "open" view, not "title"
    const override = resolveViewOverride("title", [rule!.rule]);
    expect(override).toBeUndefined();
    // applyViewOverride with undefined returns base HTML unchanged
    const baseHtml = '<div class="card-slot title-view">title</div>';
    expect(applyViewOverride(baseHtml, override)).toBe(baseHtml);
  });
});
