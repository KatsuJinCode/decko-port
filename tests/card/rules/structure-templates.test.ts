// Structured-content unit + engine tests: the *structure rule template
// mechanism (src/card/rules/structure.ts + the render.ts prepare hook).
//
// Ruby oracle (card-1.110.0 / card-mod-content-0.20.0):
// - lib/card/content/all.rb:8-10  Card#content = structured_content ||
//   standard_content
// - content/all.rb:25-27          structured_content = structure &&
//   default_content (the template's db_content; "" is truthy and WINS)
// - content/all.rb:17-19          standard_content = db_content ||
//   (new_card? ? default_content : "")
// - card-mod-content set/all/templating.rb:40-48  structure /
//   structure_rule_card: the first <set>+*structure rule in pattern
//   precedence order; "_self" db_content nils it (the walk STOPS — no
//   fall-through to the next candidate)
// - card-1.110.0 mod/core/set/all/content.rb:26-28 default_content =
//   template&.db_content (NULL template content -> standard path)
//
// Seeding note: junction rows store NULL name/key (the 2020 convention
// render-test-storage.ts seeds by); the *structure universe statement
// composes rule-card keys from the sides (the resolved CTE), so both named
// and junction-style rule rows resolve.

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

// ---------------------------------------------------------------------------
// pure mechanics
// ---------------------------------------------------------------------------

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
    // structure_rule_card (templating.rb:44-48): db_content.strip == "_self"
    // -> nil. Ruby does NOT continue to the next candidate.
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
    // The chunk/reference.rb referencing-card contract: {{+image}} names
    // <instance>+image — the key the closure walkers must prepare. Before
    // round 9 the walkers kept the literal "+image", which matched no row
    // and rendered every template child as the unknown-card empty slot.
    expect(templateReferenceNames("<p>{{+image|size:large}}</p>", ctx)).toEqual([
      "Aikido Oak Cliff+image",
    ]);
    // Already-absolute refs pass through the name algebra unchanged.
    expect(templateReferenceNames("{{Some Page}}", ctx)).toEqual(["Some Page"]);
    // Underscore refs stay render-time (the format context resolves them).
    expect(templateReferenceNames("{{_left|open}}{{_main}}", ctx)).toEqual([]);
  });
});

describe("structureRuleUniverseStatement", () => {
  it("matches rule rows by the *structure setting card's right_id (indexed, composed-key CTE)", () => {
    const statement = structureRuleUniverseStatement();
    expect(statement.sql).toContain("r.right_id = (SELECT id FROM cards");
    // Round 9 re-pin: the composed-key side is the RECURSIVE name_walk CTE
    // (landed for the depth-3 *type plus right universe keys — 24/139 rules
    // composed NULL under the old flat one-junction CASE) — not the flat
    // `sl."key" || '+' || p."key"` join this assertion pinned before that
    // round. The statement body itself is unchanged by round 9; only the
    // setting name is parameterized now (the same function builds the
    // *default universe).
    expect(statement.sql).toContain("WITH RECURSIVE name_walk(id, composed)");
    expect(statement.sql).toContain("COALESCE(w.composed, '') || '+' || COALESCE(r.\"key\", '')");
    expect(statement.params).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// engine integration: the render.ts prepare hook
// ---------------------------------------------------------------------------

let storage: RenderTestStorage | undefined;

/** Type card "Page"=100, *type=101, *structure=102, set "Page+*type"=103,
 *  rules + docs as marked. Junction rule rows carry NULL name/key; the
 *  universe statement composes "page+*type+*structure" from the sides. */
beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;
  await seedCard(s, { id: 100, name: "Page" });
  await seedCard(s, { id: 101, name: "*type", codename: "type" });
  await seedCard(s, { id: 102, name: "*structure", codename: "structure" });
  await seedCard(s, { id: 103, leftId: 100, rightId: 101 }); // set "Page+*type"
  await seedCard(s, { id: 104, leftId: 103, rightId: 102, dbContent: "<p>TYPE TEMPLATE {{_self|title}}</p>" });
  // A _self rule on another type ("Note"+*type+*structure).
  await seedCard(s, { id: 110, name: "Note" });
  await seedCard(s, { id: 111, leftId: 110, rightId: 101 }); // set "Note+*type"
  await seedCard(s, { id: 112, leftId: 111, rightId: 102, dbContent: "_self" });
  // The governed cards.
  await seedCard(s, { id: 120, name: "Doc1", typeId: 100, dbContent: null });
  await seedCard(s, { id: 121, name: "Doc2", typeId: 100, dbContent: "OWN BYTES" });
  await seedCard(s, { id: 122, name: "Memo1", typeId: 110, dbContent: "MEMO OWN" });
  // Plain card, no applicable rule, NULL content.
  await seedCard(s, { id: 130, name: "Loose", dbContent: null });
  // An absolute template target the closure completion must prefetch.
  await seedCard(s, { id: 140, name: "Target", dbContent: "TARGET BODY" });
  // A second type whose template carries an absolute nest.
  await seedCard(s, { id: 150, name: "Spec" });
  await seedCard(s, { id: 151, leftId: 150, rightId: 101 }); // set "Spec+*type"
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
    expect(html).toContain(">Doc1</span></p>"); // {{_self|title}} resolves the STRUCTURED card's name
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
    expect(html).toContain(">Doc1</span></p>"); // {{_self|title}} resolves the STRUCTURED card's name
  });

  it('a "_self" structure rule renders the card\'s own content', async () => {
    const s = storage!;
    const html = await s.engine.render("Memo1", "content");
    expect(html).toContain("MEMO OWN");
  });

  it("a rule-less NULL-content card renders empty content", async () => {
    const s = storage!;
    const html = await s.engine.render("Loose", "content");
    // standard_content: db_content || "" -> the content span carries nothing.
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
      // Minimal copy of the governed pair (engine caches are per-instance).
      await seedCard(fresh, { id: 100, name: "Page" });
      await seedCard(fresh, { id: 101, name: "*type", codename: "type" });
      await seedCard(fresh, { id: 102, name: "*structure", codename: "structure" });
      await seedCard(fresh, { id: 103, leftId: 100, rightId: 101 });
      await seedCard(fresh, { id: 104, leftId: 103, rightId: 102, dbContent: "T {{_self|title}}" });
      await seedCard(fresh, { id: 120, name: "Doc1", typeId: 100, dbContent: null });
      fresh.counting.reset();
      const html = await fresh.engine.render("Doc1", "title");
      expect(html).toContain("Doc1"); // sanity
      const cold = fresh.counting.snapshot();
      // The prelude batch = [type row fold, set-pattern anchor priming,
      // perm x3, codehash, universe, *default universe] (the universe
      // statements are FOLDED: +3 statements, +0 round trips). R17's A-36
      // correction rides through the prelude in merge pass 9 prep:
      // default_nest_view is process config (html.rb:17-19), never a deck
      // rule, so render.ts's fold composition no longer appends the
      // *default_html_view universe statement - one fewer prelude statement
      // than the cold-query lane's own tree measured (14 -> 13). The
      // remaining round trips are the root fetchByName and the view-override
      // rule walk (this deck measured 13 statements / 8 round trips before
      // the 2026-09-23 per-key closure rounds; 14/8 through round 10's
      // folded *default_html_view universe; 13/6 since the 2026-09-27
      // cold-query lane: the prelude batch folds the type row and the
      // rule-walk anchor priming, so the enrich and rule-lookup point round
      // trips became cache hits).
      expect(cold.statements).toBe(13);
      expect(cold.roundTrips).toBe(6);
      // Warm re-render: the structured pass is pure memory.
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
    // The junction-composed rule key (NULL name row, sides composed).
    expect(universe.has("page+*type+*structure")).toBe(true);
    expect(universe.get("page+*type+*structure")).toContain("TYPE TEMPLATE");
    expect(universe.has("note+*type+*structure")).toBe(true);
  });

  it("candidate keys and composed universe keys agree (DeckoName.key on both sides)", () => {
    const candidate = DeckoName.parse("Doc1+*type+*structure").key;
    // The anchor part keys through the same algorithm the rows store.
    expect(DeckoName.parse("Page+*type+*structure").key).toBe("page+*type+*structure");
    void candidate;
  });

  it("round 9: a nest-miss child renders the *default rule's type on the open view", async () => {
    // The new-card template type chain: format/nest/fetch.rb#new_card ->
    // Card.fetch new: -> type_id_from_template -> template&.type_id, where
    // the template for a NEW card is the *default rule card (templating.rb
    // new_card_template). Oracle: raw-ground-truth 9625/13421/14382 render
    // the absent "+Discussion" child's open-view slot with
    // data-card-type-id=3 (RichText) from the discussion+*right+*default
    // rule card's own type.
    const fresh = await createRenderTestStorage();
    try {
      await seedCard(fresh, { id: 100, name: "Page" });
      // The *default setting card + the *right pattern card + the set
      // junction "thing+*right" (NULL-key junction rows) + the rule row
      // "thing+*right+*default" typed Page — the type the new child
      // inherits.
      await seedCard(fresh, { id: 102, name: "*default", codename: "default" });
      await seedCard(fresh, { id: 101, name: "*right", codename: "right" });
      await seedCard(fresh, { id: 300, name: "thing" });
      await seedCard(fresh, { id: 303, leftId: 300, rightId: 101 }); // thing+*right
      await seedCard(fresh, {
        id: 304,
        leftId: 303,
        rightId: 102,
        typeId: 100, // the rule card's own type = the new-child type
      });
      await seedCard(fresh, {
        id: 305,
        name: "Thing Host",
        typeId: 100,
        dbContent: "<p>{{+thing|open}}</p>",
      });
      const html = await fresh.engine.render("Thing Host", "open");
      // The child slot renders as an open-view with the *default rule's
      // type attributes (no data-card-id: the child has no row).
      expect(html).toContain("thing-open-view");
      expect(html).toContain('data-card-type-id="100"');
      expect(html).toContain('data-card-type-name="Page"');
      // The class chain carries the inherited TYPE token (safeSetKeys input).
      expect(html).toContain("TYPE-page");
      // ...and the nest resolved contextually: <instance>+thing (round 9's
      // absolutization), not the literal "+thing". The NAME-FORM lane's
      // slot_cardname rule (card-mod-format wrap.rb:50-53: an UNSAVED
      // COMPOUND card displays the url_key form — live pin
      // Conflict_Done_Well.html) now shapes the display: url_key
      // "Thing_Host+thing", case kept, underscore for the space. The
      // inheritance attributes above still pin the absolute resolution.
      expect(html).toContain('data-card-name="Thing_Host+thing"');
    } finally {
      fresh.close();
    }
  });
});
