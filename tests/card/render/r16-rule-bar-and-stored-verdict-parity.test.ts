// R16 residual-lane regression pins (2026-09-27). The failure families the
// dual-lane verifier exposed on the set-page rules editor, each cited to the
// Ruby mechanism it ports and the oracle byte that pinned it:
//
// 1. STORED RULE VERDICTS + STORED-WINS (render.ts prepare pipeline +
//    views.ts renderSettingListItems). The stored rule children cached by
//    preloadSetRules landed after the last ensureVerdicts pass, so
//    deniedVerdicts had no entry for their ids and every stored rule card
//    whose stored read rule denies rendered a BAR (e.g. *all+*default,
//    corpus read_rule_id 22283 = "BasicCs+*type+*read" -> "Anyone Signed
//    In" -> Anonymous denied; the oracle pins the quiet span on the *all
//    page's templating group: [DENIED, DENIED, *all+*autoname]). The
//    renderer also fell through a denied stored child to the VIRTUAL
//    construction, whose more general walk allows — Ruby's
//    setting_list_item is `card.fetch setting, new: {}`
//    (card-mod-rules set/type/set/html_views/rule_lists.rb:89-93): the
//    stored card wins whenever it exists; the nest's view gate decides
//    bar vs quiet span.
// 2. SET/RULE SET MEMBERSHIP for 2-part rule cards (bar_view.rb:2-11).
//    The rule SET is every card whose RIGHT part is a Setting — the
//    2-part virtual `*all+*autoname` is as much a rule item as the
//    3-part preference shape. Oracle pins on the *all page: the
//    `*all+*autoname` slot carries `_rule-item _category-all` (rule-list
//    class_up) and the bar renders three-column md cols
//    (bar_cols 5,4,3 — bar_view.rb:2) with bar_nav hidden
//    (`voo.hide :bar_nav unless existing_rule_card`, bar_view.rb:11).
// 3. CATEGORY MEMBERSHIP (card-mod-rules set/type/set/setting_categories.rb
//    categories(setting)): `_category-field` only for
//    [default, help, input_type, content_options, content_option_view];
//    `_category-recent` only for the *recent settings card's items
//    (corpus row 23808 — autoname is NOT a member);
//    `_category-common` only for [create, read, update, delete,
//    structure, default, guide]. The prior blanket "always recent" made
//    autoname bars carry `_category-recent` the oracle never emits
//    (*captcha+*right:render:content exp `_category-all" data-card-name=...`
//    got `_category-all _category-recent" ...`).
// 4. EXISTING-RULE RESOLUTION for virtual rule cards (find_existing_rule_card,
//    editor.rb:119-131: new_card? -> the prototype's winning stored rule).
//    The prototype of `*home+*self` is the REAL *home card
//    (prototype_args {name: anchor}); its `*default` walk hits the stored
//    `HTML+*type+*default` rule (RichText-typed, empty content), so the
//    virtual's bar_right nests THAT rule's one-line content
//    (`rule_short_content`, bar_view.rb:39-44) -> "RichText :
//    <em>empty</em>" with the bar_nav SHOWN (existing rule found). A
//    virtual with NO existing rule renders an EMPTY bar-right and the
//    hidden bar_nav (the oracle's *all+*autoname bar).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "./render-test-storage.js";

let storage: RenderTestStorage | undefined;

const SET_TYPE_ID = 1;
const SETTING_TYPE_ID = 2;
const LIST_TYPE_ID = 3;
const RICH_TYPE_ID = 4;
const HTML_TYPE_ID = 5;

async function seedDeck(): Promise<void> {
  const s = storage!;
  // Type cards (the codename column feeds the codehash).
  await seedCard(s, { id: 1, name: "Set", codename: "set" });
  await seedCard(s, { id: 2, name: "Setting", codename: "setting" });
  await seedCard(s, { id: 3, name: "List", codename: "list" });
  await seedCard(s, { id: 4, name: "RichText", codename: "rich_text" });
  await seedCard(s, { id: 5, name: "HTML", codename: "html" });
  await seedCard(s, { id: 9, name: "Basic", codename: "basic" });
  // Parties.
  await seedCard(s, { id: 6, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 7, name: "Anyone Signed In", codename: "anyone_signed_in" });
  await seedCard(s, { id: 8, name: "Anonymous", codename: "anonymous" });
  // The catch-all set card + setting cards + pattern cards.
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: SET_TYPE_ID, dbContent: "{}" });
  const settings: Array<[number, string, string]> = [
    [20, "*read", "read"],
    [21, "*default", "default"],
    [22, "*autoname", "autoname"],
    [23, "*structure", "structure"],
    [24, "*create", "create"],
    [25, "*update", "update"],
    [26, "*delete", "delete"],
    [27, "*captcha", "captcha"],
    [28, "*head", "head"],
    [29, "*layout", "layout"],
    [30, "*style", "style"],
    [31, "*script", "script"],
    [32, "*help", "help"],
    [33, "*input type", "input_type"],
    [34, "*guide", "guide"],
    [35, "*thanks", "thanks"],
    [36, "*follow", "follow"],
  ];
  for (const [id, name, codename] of settings) {
    await seedCard(s, { id, name, codename, typeId: SETTING_TYPE_ID });
  }
  await seedCard(s, { id: 39, name: "*self", codename: "self", typeId: SETTING_TYPE_ID });
  await seedCard(s, { id: 40, name: "*right", codename: "right", typeId: SETTING_TYPE_ID });
  await seedCard(s, { id: 41, name: "*type", codename: "type", typeId: SETTING_TYPE_ID });

  // The deck's readable grant: *all+*read -> [[Anyone]].
  await seedCard(s, { id: 50, leftId: 10, rightId: 20, typeId: LIST_TYPE_ID, dbContent: "[[Anyone]]" });
  await seedReference(s, 50, 6, "anyone");

  // The stored *all+*default with a RESTRICTIVE stored read rule — the
  // corpus's *all+*default (id 28, read_rule_id 22283 = the
  // "BasicCs+*type+*read" -> "Anyone Signed In" rule). The rule row the
  // read_rule_id points at must exist for the permission state to classify
  // it (readable only for signed-in parties, never for Anonymous).
  await seedCard(s, { id: 51, leftId: 10, rightId: 21, typeId: LIST_TYPE_ID, dbContent: "", readRuleId: 52, readRuleClass: "*type" });
  await seedCard(s, { id: 61, leftId: 9, rightId: 41, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 52, leftId: 61, rightId: 20, dbContent: "[[Anyone Signed In]]" });
  await seedReference(s, 52, 7, "anyone_signed_in");
  void SETTING_TYPE_ID;

  // *structure rules deny Anonymous deck-wide at RIGHT precedence
  // (*structure+*right+*read -> [[Anyone Signed In]], the corpus rule 22417):
  // the templating group's FIRST li must stay a quiet span.
  await seedCard(s, { id: 53, leftId: 23, rightId: 40, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 54, leftId: 53, rightId: 20, dbContent: "[[Anyone Signed In]]" });
  await seedReference(s, 54, 7, "anyone_signed_in");

  // The self-set prototype family: *home is HTML-typed; the stored
  // `HTML+*type+*default` rule (RichText-typed, empty content) is the
  // prototype's winning *default rule — the corpus's id 201/21450 pair.
  await seedCard(s, { id: 70, name: "*home", codename: "home", typeId: HTML_TYPE_ID });
  await seedCard(s, { id: 71, leftId: 70, rightId: 39, typeId: SET_TYPE_ID, dbContent: "{}" });
  await seedCard(s, { id: 72, leftId: 5, rightId: 41, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 73, leftId: 72, rightId: 21, typeId: RICH_TYPE_ID, dbContent: "" });
  void SET_TYPE_ID;
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedDeck();
  // Warm the setting cards into the render-card map (the corpus pipeline
  // gets the same effect through its full-deck seed; see
  // rule-editor-set-page-internals.test.ts for the long form).
  const settingNames = [
    "*read", "*default", "*autoname", "*structure", "*create", "*update",
    "*delete", "*captcha", "*head", "*layout", "*style", "*script", "*help",
    "*input type", "*guide", "*thanks", "*follow",
  ];
  for (const name of settingNames) {
    try {
      await storage.engine.render(name, "open");
    } catch {
      // best-effort warm-up only
    }
  }
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("stored rule children: stored-wins + verdict coverage", () => {
  it("renders the stored *all+*default as the quiet denial span (stored read rule denies)", async () => {
    const html = await storage!.engine.render("*all", "content");
    // The templating group: [structure DENIED, default DENIED, autoname bar]
    // — the oracle's *all page lis. The stored *all+*default must render
    // the quiet span through ITS OWN stored read rule, never a virtual bar.
    const templating = html.indexOf("card-Xall-templating-collapse-id");
    const body = html.slice(templating, html.indexOf("card-Xall-webpage-collapse-id"));
    const structureAt = body.indexOf("Xall-Xstructure-bar-view");
    const defaultAt = body.indexOf("Xall-Xdefault-bar-view");
    const autonameAt = body.indexOf("Xall-Xautoname-bar-view");
    const spanCount = body.split('<span class="denied">').length - 1;
    // structure + default denied; autoname renders its bar.
    expect(spanCount).toBe(2);
    expect(defaultAt).toBe(-1); // no default BAR slot — the li is the span
    expect(autonameAt).toBeGreaterThan(-1);
    void structureAt;
  });
});

describe("2-part virtual rule bars: set/rule membership + categories", () => {
  it("renders the *all+*autoname bar with rule-item classes, three cols, hidden bar_nav, wanted/create menu", async () => {
    const html = await storage!.engine.render("*all", "content");
    const at = html.indexOf("Xall-Xautoname-bar-view");
    expect(at).toBeGreaterThan(-1);
    const slotStart = html.lastIndexOf("<div", at);
    const slot = html.slice(slotStart, slotStart + 3000);
    // bar_view.rb:10 class_up (the 2-part rule shape is in the rule SET).
    expect(slot).toContain("_rule-item");
    expect(slot).toContain("_category-all");
    // recent is a MEMBERSHIP list; autoname is not a member (the *captcha+
    // *right byte-diff family: exp `_category-all"` got `_category-all
    // _category-recent"`).
    expect(slot).not.toContain("_category-recent");
    // bar_view.rb:2 three-column bar cols (5,4,3) with bar_middle kept.
    expect(slot).toContain("col-md-5");
    // bar_view.rb:11 voo.hide :bar_nav unless existing_rule_card (no
    // existing autoname rule for the *all set).
    expect(slot).toContain("&quot;hide&quot;:[&quot;bar_nav&quot;]");
    // bar.rb:70 menu: new card -> wanted page link + create label.
    expect(slot).toContain("wanted-card");
    expect(slot).toContain("create</a>");
    // The three-col md middle column renders (bar_middle NOT hidden).
    expect(slot).toContain("col-md-4");
  });

  it("shows default/structure lis with their own category memberships", async () => {
    const html = await storage!.engine.render("*home+*self", "content");
    // default ∈ field + recent + common (setting_categories.rb:6-7).
    const at = html.indexOf("Xhome-Xself-Xdefault-bar-view");
    expect(at).toBeGreaterThan(-1);
    const slotStart = html.lastIndexOf("<div", at);
    const slot = html.slice(slotStart, slotStart + 800);
    expect(slot).toContain("_category-all _category-field _category-recent _category-common");
  });
});

describe("existing-rule resolution for virtual rule cards", () => {
  it("nests the prototype's winning default rule one-line with bar_nav shown", async () => {
    const html = await storage!.engine.render("*home+*self", "content");
    const at = html.indexOf("Xhome-Xself-Xdefault-bar-view");
    expect(at).toBeGreaterThan(-1);
    const slotStart = html.lastIndexOf("<div", at);
    const slot = html.slice(slotStart, slotStart + 1600);
    // existing_rule_card found (HTML+*type+*default, RichText, empty):
    // bar_nav SHOWN (no hide entry) and the bar-right nests THAT rule's
    // one-line (right::default: "TypeName : content-or-empty").
    expect(slot).not.toContain("&quot;hide&quot;:[&quot;bar_nav&quot;]");
    expect(slot).toContain("RichText : <em>empty</em>");
  });
});
