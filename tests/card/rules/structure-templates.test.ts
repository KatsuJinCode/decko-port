

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import {
  structureRuleUniverseStatement,
  structureUniverseFromResults,
  resolveStructuredContent,
  structuredCardContent,
  templateReferenceNames,
} from "../../../src/card/rules/structure.js";
import { DeckoName } from "../../../src/card/name.js";
import type { SQLQueryResult } from "../../../src/server/driver.js";

const universeOf = (entries: Record<string, string | null>): Map<string, string | null> =>
  new Map(Object.entries(entries));

describe("resolveStructuredContent (templating.rb#structure port)", () => {
  it("walks candidates in pattern precedence: self beats type beats all", () => {
    const universe = universeOf({
      "doc1+*self+*structure": "SELF TEMPLATE",
      "page+*type+*structure": "TYPE TEMPLATE",
      "*all+*structure": "ALL TEMPLATE",
    });
    const card = { name: "Doc1", typeId: 7, typeName: "Page" };
    const resolved = resolveStructuredContent(card, universe);
    expect(resolved?.templateContent).toBe("SELF TEMPLATE");
    expect(resolved?.ruleName).toBe("Doc1+*self+*structure");
    expect(resolved?.matchedIndex).toBe(0);
  });

  it("falls to the *type candidate when no *self rule exists", () => {
    const universe = universeOf({
      "page+*type+*structure": "TYPE TEMPLATE",
      "*all+*structure": "ALL TEMPLATE",
    });
    const resolved = resolveStructuredContent({ name: "Doc1", typeId: 7, typeName: "Page" }, universe);
    expect(resolved?.templateContent).toBe("TYPE TEMPLATE");
    expect(resolved?.matchedIndex).toBe(1);
  });

  it('"_self" content nils the structure and STOPS the walk (no fall-through)', () => {
    const universe = universeOf({
      "doc1+*self+*structure": "  _self\n",
      "*all+*structure": "ALL TEMPLATE",
    });

    const resolved = resolveStructuredContent({ name: "Doc1", typeId: 7, typeName: "Page" }, universe);
    expect(resolved).toBeUndefined();
  });

  it("a NULL template content falls through to the standard path (default_content nil)", () => {
    const universe = universeOf({ "page+*type+*structure": null });
    const resolved = resolveStructuredContent({ name: "Doc1", typeId: 7, typeName: "Page" }, universe);
    expect(resolved).toBeUndefined();
  });

  it('an EMPTY template content WINS (Ruby: "" is truthy in structured_content)', () => {
    const universe = universeOf({ "page+*type+*structure": "" });
    const card = { name: "Doc1", typeId: 7, typeName: "Page" };
    const resolved = resolveStructuredContent(card, universe);
    expect(resolved?.templateContent).toBe("");
    expect(structuredCardContent(card, "own bytes", universe)).toBe("");
  });

  it("no candidates in the universe -> undefined (universe.size gate)", () => {
    const resolved = resolveStructuredContent({ name: "Doc1", typeName: "Page" }, new Map());
    expect(resolved).toBeUndefined();
  });
});

describe("structuredCardContent (content/all.rb#content port)", () => {
  it("template wins over the card's own db_content", () => {
    const universe = universeOf({ "page+*type+*structure": "TEMPLATE" });
    expect(structuredCardContent({ name: "Doc1", typeId: 7, typeName: "Page" }, "own", universe)).toBe(
      "TEMPLATE",
    );
  });

  it("standard path: db_content verbatim when no structure applies", () => {
    const universe = universeOf({});
    expect(structuredCardContent({ name: "Doc1" }, "own bytes", universe)).toBe("own bytes");
  });

  it('standard path: NULL db_content renders "" (content/all.rb:17-19, real card)', () => {
    const universe = universeOf({});
    expect(structuredCardContent({ name: "Doc1" }, null, universe)).toBe("");
  });
});

describe("templateReferenceNames", () => {
  it("collects absolute refs, skips relative ones, uses the real nest parser", () => {
    expect(templateReferenceNames("{{Other Card}} {{_left|open}} {{|core}}")).toEqual([
      "Other Card",
    ]);
  });

  it("round 9: with a context name, plus-shaped refs absolutize against the instance", () => {
    const ctx = DeckoName.parse("Aikido Oak Cliff");

    expect(templateReferenceNames("<p>{{+image|size:large}}</p>", ctx)).toEqual([
      "Aikido Oak Cliff+image",
    ]);

    expect(templateReferenceNames("{{Some Page}}", ctx)).toEqual(["Some Page"]);

    expect(templateReferenceNames("{{_left|open}}{{_main}}", ctx)).toEqual([]);
  });
});

describe("structureRuleUniverseStatement", () => {
  it("matches rule rows by the *structure setting card's right_id (indexed, composed-key CTE)", () => {
    const statement = structureRuleUniverseStatement();
    expect(statement.sql).toContain("r.right_id = (SELECT id FROM cards");

    expect(statement.sql).toContain("WITH RECURSIVE name_walk(id, composed)");
    expect(statement.sql).toContain("COALESCE(w.composed, '') || '+' || COALESCE(r.\"key\", '')");
    expect(statement.params).toEqual([]);
  });
});

let storage: RenderTestStorage | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;
  await seedCard(s, { id: 100, name: "Page" });
  await seedCard(s, { id: 101, name: "*type", codename: "type" });
  await seedCard(s, { id: 102, name: "*structure", codename: "structure" });
  await seedCard(s, { id: 103, leftId: 100, rightId: 101 });
  await seedCard(s, { id: 104, leftId: 103, rightId: 102, dbContent: "<p>TYPE TEMPLATE {{_self|title}}</p>" });

  await seedCard(s, { id: 110, name: "Note" });
  await seedCard(s, { id: 111, leftId: 110, rightId: 101 });
  await seedCard(s, { id: 112, leftId: 111, rightId: 102, dbContent: "_self" });

  await seedCard(s, { id: 120, name: "Doc1", typeId: 100, dbContent: null });
  await seedCard(s, { id: 121, name: "Doc2", typeId: 100, dbContent: "OWN BYTES" });
  await seedCard(s, { id: 122, name: "Memo1", typeId: 110, dbContent: "MEMO OWN" });

  await seedCard(s, { id: 130, name: "Loose", dbContent: null });

  await seedCard(s, { id: 140, name: "Target", dbContent: "TARGET BODY" });

  await seedCard(s, { id: 150, name: "Spec" });
  await seedCard(s, { id: 151, leftId: 150, rightId: 101 });
  await seedCard(s, { id: 152, leftId: 151, rightId: 102, dbContent: "<p>SPEC {{Target}}</p>" });
  await seedCard(s, { id: 153, name: "Spec1", typeId: 150, dbContent: null });
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("RenderEngine structured content", () => {
  it("renders the type's *structure template for a NULL-content card", async () => {
    const s = storage!;
    const html = await s.engine.render("Doc1", "content");
    expect(html).toContain("<p>TYPE TEMPLATE ");
    expect(html).toContain(">Doc1</span></p>");
  });

  it("template wins over the card's own db_content (structured_content first)", async () => {
    const s = storage!;
    const html = await s.engine.render("Doc2", "content");
    expect(html).toContain("<p>TYPE TEMPLATE ");
    expect(html).toContain(">Doc2</span></p>");
    expect(html).not.toContain("OWN BYTES");
  });

  it("renders the template through :raw too (base.rb:75-77 structure_card&.content)", async () => {
    const s = storage!;
    const html = await s.engine.render("Doc1", "core");
    expect(html).toContain("<p>TYPE TEMPLATE ");
    expect(html).toContain(">Doc1</span></p>");
  });

  it('a "_self" structure rule renders the card\'s own content', async () => {
    const s = storage!;
    const html = await s.engine.render("Memo1", "content");
    expect(html).toContain("MEMO OWN");
  });

  it("a rule-less NULL-content card renders empty content", async () => {
    const s = storage!;
    const html = await s.engine.render("Loose", "content");

    expect(html).not.toContain("TYPE TEMPLATE");
  });

  it("absolute template refs join the closure: an existing nest target renders its card", async () => {
    const s = storage!;
    const html = await s.engine.render("Spec1", "content");
    expect(html).toContain("TARGET BODY");
    expect(html).toContain("SPEC");
  });

  it("the universe statement folds into the cold batch: one round trip, warm re-render zero queries", async () => {
    const s = storage!;
    const fresh = await createRenderTestStorage();
    try {

      await seedCard(fresh, { id: 100, name: "Page" });
      await seedCard(fresh, { id: 101, name: "*type", codename: "type" });
      await seedCard(fresh, { id: 102, name: "*structure", codename: "structure" });
      await seedCard(fresh, { id: 103, leftId: 100, rightId: 101 });
      await seedCard(fresh, { id: 104, leftId: 103, rightId: 102, dbContent: "T {{_self|title}}" });
      await seedCard(fresh, { id: 120, name: "Doc1", typeId: 100, dbContent: null });
      fresh.counting.reset();
      const html = await fresh.engine.render("Doc1", "title");
      expect(html).toContain("Doc1");
      const cold = fresh.counting.snapshot();

      expect(cold.statements).toBe(13);
      expect(cold.roundTrips).toBe(6);

      fresh.counting.reset();
      await fresh.engine.render("Doc1", "title");
      expect(fresh.counting.snapshot()).toEqual({ statements: 0, roundTrips: 0 });
    } finally {
      fresh.close();
    }
    void s;
  });

  it("universe parse: junction-style composed keys land in the map (driver-level)", async () => {
    const s = storage!;
    const result = await s.fetcher.driver.query(structureRuleUniverseStatement().sql, []);
    const universe = structureUniverseFromResults(result as SQLQueryResult);

    expect(universe.has("page+*type+*structure")).toBe(true);
    expect(universe.get("page+*type+*structure")).toContain("TYPE TEMPLATE");
    expect(universe.has("note+*type+*structure")).toBe(true);
  });

  it("candidate keys and composed universe keys agree (DeckoName.key on both sides)", () => {
    const candidate = DeckoName.parse("Doc1+*type+*structure").key;

    expect(DeckoName.parse("Page+*type+*structure").key).toBe("page+*type+*structure");
    void candidate;
  });

  it("round 9: a nest-miss child renders the *default rule's type on the open view", async () => {

    const fresh = await createRenderTestStorage();
    try {
      await seedCard(fresh, { id: 100, name: "Page" });

      await seedCard(fresh, { id: 102, name: "*default", codename: "default" });
      await seedCard(fresh, { id: 101, name: "*right", codename: "right" });
      await seedCard(fresh, { id: 300, name: "thing" });
      await seedCard(fresh, { id: 303, leftId: 300, rightId: 101 });
      await seedCard(fresh, {
        id: 304,
        leftId: 303,
        rightId: 102,
        typeId: 100,
      });
      await seedCard(fresh, {
        id: 305,
        name: "Thing Host",
        typeId: 100,
        dbContent: "<p>{{+thing|open}}</p>",
      });
      const html = await fresh.engine.render("Thing Host", "open");

      expect(html).toContain("thing-open-view");
      expect(html).toContain('data-card-type-id="100"');
      expect(html).toContain('data-card-type-name="Page"');

      expect(html).toContain("TYPE-page");

      expect(html).toContain('data-card-name="Thing_Host+thing"');
    } finally {
      fresh.close();
    }
  });
});
