// Set-host rules-editor options-chain boundary: set hosts' :open and
// :content render the rules-editor accordion (card-mod-rules-0.20.0 set/
// type/set/html_views.rb:6-11 + rule_lists.rb), which walks
// setting_categories -> per-setting rule_card lookups (content_options /
// help / structure / default) and the recent_settings list (*recent
// settings+*self+*content options). When the walk resolves a search-type
// or set-type rule card, the nested render hits Abstract::CqlSearch#
// item_type_id (cql_search.rb:14-18) -> parse_json_cql(content) ->
// Card::Error::BadQuery for garbage content, unwinding the host render.
// The gate (src/card/render.ts:469-505) ports this chain via the existing
// itemOptionsParseFailure / findRule helpers (no fork).
//
// Gate census (recapture + original corpus, both capture keys; model
// tmp/recapture-deck/enumeration/set-host-options-gate-model.json,
// oracle probes 7-9): set hosts on :open AND :content. :closed renders
// the compact view (one_line_content) which never raised in either
// capture. Abstract::Permission hosts already short-circuited at the
// *open pointer/list gate above; read-denied hosts render the denial
// span (view/permission.rb:46-50 altered_view wraps the view BEFORE
// view_method dispatches).
//
// Pattern-precedence note (the seed-shape choice): for a SET host whose
// name is "X+*self", the rule_names walk for "*content options" puts
// the *right pattern first (anchor = the host's tag = "*self"), so the
// candidate list contains "*self+*right+*content options" — the rule
// the test seeds hangs off the *self+*right SET, NOT off the host
// itself. This mirrors how Ruby's rule_card cache (lib/card/rule/cache.rb
// + lib/card/rule/all.rb#rule_card_id) walks pattern-precedence and
// the first hit wins.

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
  await seedCard(s, { id: 717, name: "*self", typeId: 2 });
  await seedCard(s, { id: 718, name: "*structure", typeId: 2 });
  await seedCard(s, { id: 719, name: "*default", typeId: 2 });
  await seedCard(s, { id: 720, name: "*help", typeId: 2 });
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

describe("set-host rules-editor options-chain boundary", () => {
  it(":open of a set host raises via the *content options rule walk with the rule's content", async () => {
    // Corpus pin: a SET host X+*self whose *content_options rule_card
    // resolves (via the *right pattern, anchor = tag = *self) to a
    // search-type rule "*self+*right+*content options" hanging off the
    // *self+*right SET, with garbage content -> raises with that
    // content.
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      // the set host
      await seedCard(s, { id: 7000, name: "*all+*self", leftId: 274, rightId: 717, typeId: 259, dbContent: "qhmdkcvehcrhiuzs" });
      // the *self+*right SET trunk (the rule hangs off this)
      await seedCard(s, { id: 7001, name: "*self+*right", leftId: 717, rightId: 700, typeId: 259, dbContent: "" });
      // the search-type rule with garbage content
      await seedCard(s, { id: 7002, name: "*self+*right+*content options", leftId: 7001, rightId: 701, typeId: 30, dbContent: "garbage_cql_content" });
      const err = await captureError(() => s.engine.render("*all+*self", "open"));
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("Invalid JSON search query: garbage_cql_content");
    } finally {
      s.close();
    }
  });

  it(":content of a set host fires the same gate (both views delegate to :core)", async () => {
    // Gate census: both :open AND :content render the rules-editor
    // accordion via :core delegation (html/views.rb -> set/type/set/
    // html_views.rb:6-11). The :content view passes through the same
    // chain.
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 7010, name: "*all+*self", leftId: 274, rightId: 717, typeId: 259, dbContent: "qhmdkcvehcrhiuzs" });
      await seedCard(s, { id: 7011, name: "*self+*right", leftId: 717, rightId: 700, typeId: 259, dbContent: "" });
      await seedCard(s, { id: 7012, name: "*self+*right+*content options", leftId: 7011, rightId: 701, typeId: 30, dbContent: "garbage_content_for_content_view" });
      const err = await captureError(() => s.engine.render("*all+*self", "content"));
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("Invalid JSON search query: garbage_content_for_content_view");
    } finally {
      s.close();
    }
  });

  it(":closed of a set host never consults the rules-editor chain", async () => {
    // Gate census: 0 set|closed sentinels in either capture. :closed
    // renders the compact one_line_content which never enters the
    // rules-editor walk.
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 7020, name: "*all+*self", leftId: 274, rightId: 717, typeId: 259, dbContent: "qhmdkcvehcrhiuzs" });
      await seedCard(s, { id: 7021, name: "*self+*right", leftId: 717, rightId: 700, typeId: 259, dbContent: "" });
      await seedCard(s, { id: 7022, name: "*self+*right+*content options", leftId: 7021, rightId: 701, typeId: 30, dbContent: "garbage_for_closed_view" });
      const html = await s.engine.render("*all+*self", "closed");
      expect(typeof html).toBe("string");
    } finally {
      s.close();
    }
  });

  it("valid-JSON options content parses and the view renders without raising", async () => {
    // A *content_options rule with valid CQL JSON answers item_type_id
    // from cql_hash[:type] -- no raise -- and the rules editor renders
    // the real accordion bytes.
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 7030, name: "*all+*self", leftId: 274, rightId: 717, typeId: 259, dbContent: "qhmdkcvehcrhiuzs" });
      await seedCard(s, { id: 7031, name: "*self+*right", leftId: 717, rightId: 700, typeId: 259, dbContent: "" });
      await seedCard(s, { id: 7032, name: "*self+*right+*content options", leftId: 7031, rightId: 701, typeId: 30, dbContent: '{"type":"Basic"}' });
      const html = await s.engine.render("*all+*self", "open");
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    } finally {
      s.close();
    }
  });

  it("Abstract::Permission set hosts are excluded from the gate", async () => {
    // The *open pointer/list gate's isPermissionRightHost check
    // (right part *read/*create/*update/*delete) excludes these hosts.
    // The set-host gate mirrors the same exclusion so a *read-typed
    // right set doesn't raise from a content_options rule walk.
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      // *read codename (the right-side codename of an Abstract::Permission set)
      await seedCard(s, { id: 7040, name: "*read", codename: "read", typeId: 2 });
      // the SET host "*all+*read" — its right codename is "read"
      await seedCard(s, { id: 7041, name: "*all+*read", leftId: 274, rightId: 7040, typeId: 259, dbContent: "fr" });
      await seedCard(s, { id: 7042, name: "*read+*right", leftId: 7040, rightId: 700, typeId: 259, dbContent: "" });
      await seedCard(s, { id: 7043, name: "*read+*right+*content options", leftId: 7042, rightId: 701, typeId: 30, dbContent: "garbage_for_permission_host" });
      const htmlOpen = await s.engine.render("*all+*read", "open");
      expect(typeof htmlOpen).toBe("string");
    } finally {
      s.close();
    }
  });

  it("empty content raises the distinct empty-query BadQuery (cql_search.rb:29-38 parity)", async () => {
    // The empty-content branch raises "can't run search with empty content"
    // (cql_search.rb:29-38) -- a distinct BadQuery subclass message --
    // before JSON.parse. The gate mirrors this with emptyQueryError().
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 7060, name: "*all+*self", leftId: 274, rightId: 717, typeId: 259, dbContent: "qhmdkcvehcrhiuzs" });
      await seedCard(s, { id: 7061, name: "*self+*right", leftId: 717, rightId: 700, typeId: 259, dbContent: "" });
      await seedCard(s, { id: 7062, name: "*self+*right+*content options", leftId: 7061, rightId: 701, typeId: 30, dbContent: "" });
      const err = await captureError(() => s.engine.render("*all+*self", "open"));
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("can't run search with empty content");
    } finally {
      s.close();
    }
  });

  it("a set host with no resolvable *content options rule chain renders normally", async () => {
    // Gate is conservative: when NO chain fires (no host-local rule
    // resolves, recent_settings rule absent), the gate's fall-through
    // is the host's OWN options_card chain. If THAT chain's terminal
    // is a search/set-typed card with VALID JSON, the parse succeeds
    // and the view renders normally.
    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      // the set host with no rules (host = *all+*self, simple)
      await seedCard(s, { id: 7070, name: "*all+*self", leftId: 274, rightId: 717, typeId: 259, dbContent: "qhmdkcvehcrhiuzs" });
      // the *self+*right SET trunk (no rule hangs off it)
      await seedCard(s, { id: 7071, name: "*self+*right", leftId: 717, rightId: 700, typeId: 259, dbContent: "" });
      // a *content_options rule on the *self+*right SET with VALID JSON
      await seedCard(s, { id: 7072, name: "*self+*right+*content options", leftId: 7071, rightId: 701, typeId: 30, dbContent: '{"type":"Basic"}' });
      const html = await s.engine.render("*all+*self", "open");
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    } finally {
      s.close();
    }
  });
});
