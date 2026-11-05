

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

    const rule = await findRule(s.fetcher, nameAsPatternCardInput("Orphan"), "*open");
    expect(rule).toBeDefined();
    expect(rule!.rule.dbContent).toBe('{"view":"open","class":"rule-class"}');

    const override = resolveViewOverride("open", [rule!.rule]);
    expect(override).toBeDefined();
    expect(override!.view).toBe("open");
    expect(override!.class).toBe("rule-class");

    const baseHtml = '<div class="card-slot open-view"><span>x</span></div>';
    const finalHtml = applyViewOverride(baseHtml, override);
    expect(finalHtml).toContain('class="card-slot open-view rule-class"');
  });

  it("returns no override when no rule matches the view", async () => {
    const s = storage!;
    const rule = await findRule(s.fetcher, nameAsPatternCardInput("Orphan"), "*open");
    expect(rule).toBeDefined();

    const override = resolveViewOverride("title", [rule!.rule]);
    expect(override).toBeUndefined();

    const baseHtml = '<div class="card-slot title-view">title</div>';
    expect(applyViewOverride(baseHtml, override)).toBe(baseHtml);
  });
});
