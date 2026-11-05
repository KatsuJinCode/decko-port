// The options-card CQL parse boundary: rendering :open of a pointer/list
// card runs standard_pointer_core (card-mod-list set/abstract/01_list/
// html_views.rb:6-13) whose wrapper class needs item_view_options ->
// item_type_name -> Abstract::Items#item_type_id (card-mod-collection
// set/abstract/items.rb:5-11): options_card (card-mod-layout set/abstract/
// items/options_api.rb:47-48 = rule_card(:content_options) ||
// right_type_options || Card[:all]) resolves, pointer/list options cards
// recurse, and a search/set-type terminal parses its content as CQL
// (cql_search.rb:14-18 -> parse_json_cql) -> Card::Error::BadQuery unwinds
// the whole render. The corpus capture pins this as the CAPTURE_ERROR
// sentinel on the HOST (e.g. *home :open -> "Invalid JSON search query: fr"
// where "fr" is *all's content, shard-000000.jsonl id=77; *all+*layout
// :open -> its *layout+*right+*content options rule content).
//
// Gate census (recapture + original corpus, both capture keys — see the
// render.ts gate comment and tmp/recapture-deck/enumeration/
// options-gate-model.json): :open ONLY, pointer/list hosts only,
// Abstract::Permission hosts (right part *read/*create/*update/*delete)
// excluded (both captures pinned 1,537/1,537 REAL :open bytes there),
// :closed/:content never fire.
//
// Junction seeding note: a rule card "<set>+*content options" is a
// junction whose trunk is the SET card ("<anchor>+*self", "<tag>+*right",
// ...), so the seeds carry the trunk rows (left_id -> trunk, right_id ->
// *content options) exactly like the corpus rows.

import { describe, expect, it } from "vitest";
import { createRenderTestStorage, seedCard, type RenderTestStorage } from "./render-test-storage.js";

/** The cardtype cards the codename registry needs for typeCode gates. */
async function seedCardtypes(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 2, name: "Basic", codename: "basic", typeId: 2 });
  await seedCard(s, { id: 5, name: "Cardtype", codename: "cardtype", typeId: 5 });
  await seedCard(s, { id: 30, name: "Search", codename: "search_type", typeId: 5 });
  await seedCard(s, { id: 47, name: "List", codename: "list", typeId: 5 });
  await seedCard(s, { id: 259, name: "Set", codename: "set", typeId: 5 });
  await seedCard(s, { id: 34843, name: "Pointer", codename: "pointer", typeId: 5 });
}

/** The settings/sides the rule walks and junction fetches resolve. */
async function seedSettings(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 700, name: "*right", typeId: 2 });
  await seedCard(s, { id: 701, name: "*content options", typeId: 2 });
  await seedCard(s, { id: 702, name: "*input type", typeId: 2 });
  await seedCard(s, { id: 703, name: "*layout", typeId: 2 });
  await seedCard(s, { id: 704, name: "*read", codename: "read", typeId: 2 });
  await seedCard(s, { id: 708, name: "*self", typeId: 2 });
  await seedCard(s, { id: 274, name: "*all", codename: "all", typeId: 259, dbContent: "fr" });
}

async function captureError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the render to raise");
}

describe("options-card CQL parse boundary (pointer/list :open)", () => {
  it(":open of a pointer host falls back to Card[:all] (set-typed) and raises with its content", async () => {
    // Corpus pin: *home (pointer, content "yzzw") :open ->
    // CAPTURE_ERROR: Card::Error::BadQuery: Invalid JSON search query: fr
    // — "fr" is *all's db_content, not the host's.
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 77, name: "*home", codename: "home", typeId: 34843, dbContent: "yzzw" });
      const err = await captureError(() => s.engine.render("*home", "open"));
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("Invalid JSON search query: fr");
    } finally {
      s.close();
    }
  });

  it(":open of a list host resolves a *content options rule card and raises with ITS content", async () => {
    // Corpus pin: *all+*layout :open -> the *layout+*right+*content options
    // rule card's content (the right-pattern rule candidate wins the walk).
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      // the set card "*layout+*right" the rule hangs off
      await seedCard(s, { id: 720, name: "*layout+*right", leftId: 703, rightId: 700, typeId: 259 });
      await seedCard(s, {
        id: 500,
        name: "*all+*layout",
        leftId: 274,
        rightId: 703,
        typeId: 47,
        dbContent: "layout-items",
      });
      await seedCard(s, {
        id: 316,
        name: "*layout+*right+*content options",
        leftId: 720,
        rightId: 701,
        typeId: 30,
        dbContent: "lkxchgttdixjvgdasd",
      });
      const err = await captureError(() => s.engine.render("*all+*layout", "open"));
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("Invalid JSON search query: lkxchgttdixjvgdasd");
    } finally {
      s.close();
    }
  });

  it("recurses through pointer-typed options cards before the parse (items.rb:5-11)", async () => {
    // Corpus pin: *style+*right+*input type :open -> options card
    // "*input type+*right+*content options" is POINTER-typed (its content
    // is the radio/checkbox item list) -> item_type_id recurses into ITS
    // options card -> *all -> "fr" (probe 5, diagnose-capture-error5.rb).
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 710, name: "*style", typeId: 2 });
      // trunks: the *style+*right set and the *input type+*right set
      await seedCard(s, { id: 722, name: "*style+*right", leftId: 710, rightId: 700, typeId: 259 });
      await seedCard(s, { id: 721, name: "*input type+*right", leftId: 702, rightId: 700, typeId: 259 });
      await seedCard(s, {
        id: 511,
        name: "*style+*right+*input type",
        leftId: 722,
        rightId: 702,
        typeId: 47,
        dbContent: "style-rule-items",
      });
      await seedCard(s, {
        id: 512,
        name: "*input type+*right+*content options",
        leftId: 721,
        rightId: 701,
        typeId: 34843,
        dbContent: "radio\ncheckbox\nselect",
      });
      const err = await captureError(() => s.engine.render("*style+*right+*input type", "open"));
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("Invalid JSON search query: fr");
    } finally {
      s.close();
    }
  });

  it("valid-JSON options content parses and the view renders without raising", async () => {
    // cql_search.rb:14-18: a valid CQL JSON hash answers item_type_id from
    // cql_hash[:type] — no raise — and the pointer core renders.
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 520, name: "layout host", typeId: 47, dbContent: "" });
      // the *self-set rule card "<host>+*self+*content options"
      await seedCard(s, { id: 724, name: "layout host+*self", leftId: 520, rightId: 708, typeId: 259 });
      await seedCard(s, {
        id: 521,
        name: "layout host+*self+*content options",
        leftId: 724,
        rightId: 701,
        typeId: 30,
        dbContent: '{"type":"Basic"}',
      });
      const html = await s.engine.render("layout_host", "open");
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    } finally {
      s.close();
    }
  });

  it(":closed and :content of a pointer host never consult the options chain", async () => {
    // Gate census: both captures recorded ZERO sentinels for pointer/list
    // :closed (plain lists render labeled/one_line_content) and :content
    // (0/46 recapture entries) — Ruby's :closed/:content view bodies for
    // plain pointers never call item_view_options.
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 530, name: "closed pointer", typeId: 34843, dbContent: "" });
      for (const view of ["closed", "content"]) {
        const html = await s.engine.render("closed_pointer", view);
        expect(typeof html).toBe("string");
      }
    } finally {
      s.close();
    }
  });

  it("Abstract::Permission hosts (right part a permission setting) are excluded from the gate", async () => {
    // Both captures pinned REAL :open bytes for permission-right hosts
    // (original corpus 1,537/1,537) even though today's Ruby raises —
    // a capture-time divergence the fixtures pin as bytes. The gate must
    // not fire for them (dn+*right+*read :open renders in both captures).
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 541, name: "dn", typeId: 2, dbContent: "dn body" });
      await seedCard(s, { id: 542, name: "dn+*right", leftId: 541, rightId: 700, typeId: 259 });
      await seedCard(s, {
        id: 540,
        name: "dn+*right+*read",
        leftId: 542,
        rightId: 704,
        typeId: 47,
        dbContent: "Role_A1, Role_A2",
      });
      const html = await s.engine.render("dn+*right+*read", "open");
      expect(typeof html).toBe("string");
    } finally {
      s.close();
    }
  });

  it("empty-content terminal raises the distinct empty-query BadQuery", async () => {
    // cql_search.rb:36-38: parse_json_cql raises
    // "can't run search with empty content" BEFORE JSON.parse.
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 550, name: "empty options host", typeId: 34843, dbContent: "" });
      await seedCard(s, {
        id: 723,
        name: "empty options host+*self",
        leftId: 550,
        rightId: 708,
        typeId: 259,
      });
      await seedCard(s, {
        id: 551,
        name: "empty options host+*self+*content options",
        leftId: 723,
        rightId: 701,
        typeId: 30,
        dbContent: "",
      });
      const err = await captureError(() => s.engine.render("empty_options_host", "open"));
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("can't run search with empty content");
    } finally {
      s.close();
    }
  });

  it("right_type_options: a cardtype-typed right part stops the chain (virtual by-name card)", async () => {
    // options_api.rb:57-59: Card.fetch [right.name, :type, :by_name] is a
    // VIRTUAL card whose Ruby content is a CQL Hash — cql_content never
    // parses, item_type_id returns nil, no raise (probe 5, cixvol+jzuqht).
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 560, name: "jzuqht", typeId: 5 });
      await seedCard(s, { id: 562, name: "cixvol", typeId: 2, dbContent: "left body" });
      await seedCard(s, {
        id: 561,
        name: "cixvol+jzuqht",
        leftId: 562,
        rightId: 560,
        typeId: 47,
        dbContent: "some-items",
      });
      const html = await s.engine.render("cixvol+jzuqht", "open");
      expect(typeof html).toBe("string");
    } finally {
      s.close();
    }
  });
});
