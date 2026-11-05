

import { describe, expect, it } from "vitest";
import { parseNestOptions, scanNests } from "../../../src/card/render/nest-syntax.js";
import { ruleBarRightHtml } from "../../../src/card/render/rule-bar-right.js";
import type { RenderCard } from "../../../src/card/render/format.js";

describe("nest item: options fold into items.view (nest.rb:54-57)", () => {
  it("parseNestOptions folds a lone item: option into items.view", () => {
    expect(parseNestOptions("item: title")).toEqual({
      extra: {},
      items: { view: "title" },
    });
  });

  it("item: coexists with shark keys in one option list", () => {
    expect(parseNestOptions("hide:menu;item:title")).toEqual({
      extra: {},
      hide: "menu",
      items: { view: "title" },
    });
  });

  it("scanNests preserves the item: option bytes through the parsed nest", () => {
    const pieces = scanNests("look at {{My Card|item: title}} here");
    expect(pieces).toHaveLength(3);
    expect(pieces[1].kind).toBe("nest");
    expect(pieces[1].nest?.options).toEqual({
      extra: {},
      items: { view: "title" },
    });
  });

  it("a non-shark, non-item key is still dropped (nest.rb:57)", () => {
    expect(parseNestOptions("bogus:x")).toEqual({ extra: {} });
  });
});

describe("rule bar one-line fallback truncates at 60 (content.rb:1)", () => {
  const base = (content: string): RenderCard =>
    ({
      name: { s: "User+*create", rightName: { s: "*create" } },
      setKeys: "type PlusRight RULE",
      typeName: "Type",
      dbContent: content,
    }) as unknown as RenderCard;

  it("content at exactly the limit passes through untruncated", () => {
    const content = "a".repeat(60);
    expect(ruleBarRightHtml(base(content))).toContain(content);
  });

  it("content over the limit truncates Rails-style: 57 chars + ... (total 60)", () => {

    const html = ruleBarRightHtml(base("b".repeat(61)));
    expect(html).toContain("b".repeat(57) + "...");
    expect(html).not.toContain("b".repeat(58));
    expect(html).not.toContain("b".repeat(61));
  });
});

describe("rule bar one-line for list/pointer typeCode dispatches to pointer-list body", () => {

  const listRuleCard = (content: string, typeCode: "list" | "pointer" = "list"): RenderCard =>
    ({
      name: { s: "*star+*delete", rightName: { s: "*delete" } },
      setKeys:
        "ALL ALL_PLUS TYPE-xhor RSTAR RULE RIGHT-Xdelete TYPE_PLUS_RIGHT-exi-Xdelete SELF-Xstar-Xdelete",
      typeName: "xhor",
      typeCode,
      dbContent: content,
    }) as unknown as RenderCard;

  it("renders the captured corpus:6560 wrapper shape for a list-typed rule card", () => {
    const html = ruleBarRightHtml(listRuleCard("uflluwkwvaenx"));

    expect(html).toContain('<div class="text-muted one-line">');

    expect(html).toContain('<div class="pointer-list">');

    expect(html).toContain('<div class="pointer-item item-link">');

    expect(html).toContain('<a class="wanted-card" href="/uflluwkwvaenx">');
    expect(html).toContain('<span class="card-title" title="uflluwkwvaenx">uflluwkwvaenx</span>');

    expect(html).not.toMatch(/<div class="text-muted one-line">uflluwkwvaenx</);
  });

  it("dispatches to pointer-list for typeCode=pointer as well", () => {
    const html = ruleBarRightHtml(listRuleCard("uflluwkwvaenx", "pointer"));
    expect(html).toContain('<div class="pointer-list">');
    expect(html).toContain('<div class="pointer-item item-link">');
    expect(html).toContain('<a class="wanted-card" href="/uflluwkwvaenx">');
  });

  it("renders each dbContent item as its own pointer-item item-link (newlines split)", () => {
    const html = ruleBarRightHtml(listRuleCard("foo\nbar\nbaz"));
    expect(html.match(/<div class="pointer-item item-link">/g)).toHaveLength(3);
    expect(html).toContain('href="/foo"');
    expect(html).toContain('href="/bar"');
    expect(html).toContain('href="/baz"');
  });

  it("strips [[ ]] brackets from item names (item.rb#strip_item)", () => {
    const html = ruleBarRightHtml(listRuleCard("[[foo]]"));
    expect(html).toContain('href="/foo"');
    expect(html).not.toContain("[[");
  });
});
