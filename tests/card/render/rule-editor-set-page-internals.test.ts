// Regression pins for the rules-editor internals parity family (2026-09-26
// lane, dual-lane expected-v2 evidence). Three mechanisms, each cited to the
// Ruby source it ports and to the oracle bytes that pinned it:
//
// 1. Rule-bar one-line pointer items classify known/wanted and build the
//    href from the url_key (card-mod-format set/all/base.rb:35-44 link_view
//    `opts[:known] = card.known?` + links.rb:140-143
//    add_known_or_wanted_class + cardname variants.rb #url_key href form).
//    The pre-lane engine emitted `wanted-card` and the authored-name href
//    for EVERY item; the raw oracle pins `known-card` + url_key href for
//    items that resolve to cards (e.g. *all+*delete bar_right:
//    `<a class="known-card" href="/Administrator">`).
// 2. The category-accordion group lis follow the registration-position
//    order (Card::Setting.groups[group]; register_setting set_position,
//    card-1.110.0 lib/card/setting.rb:101-110). Templating is
//    [structure, default, autoname] — autoname registered at position 4
//    by the core mod (which loads first, leaving sparse nils the
//    visible_settings reject compacts), then default/structure at
//    position 2 (structure inserts before default). Oracle: *all
//    templating lis are [DENIED, DENIED, *all+*autoname] (autoname LAST);
//    fixture corpus shard-000000:119 (*input type+*right): default SECOND.
// 3. The editing group's content_options/content_option_view lis are
//    gated by restricted_to_type (card-mod-list set/self/content_options.rb:2
//    `%i[list pointer session]`; card-mod-rules set/type/set.rb:73-81
//    visible_settings rejects settings whose restriction excludes the
//    set's PROTOTYPE type). The prototype chain
//    (prototype_args per set pattern + ensure_type's
//    type_id_from_code -> type_id_from_template) resolves: *all -> no
//    type (nameless new card) -> restricted settings rejected (editing
//    badge 3, the 809-page oracle signature); a +*self set of a
//    Pointer-typed card -> prototype type pointer -> all five editing
//    settings visible (editing badge 5, the 35-page oracle signature).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "./render-test-storage.js";

let storage: RenderTestStorage | undefined;

const SET_TYPE_ID = 100;
const LIST_TYPE_ID = 101;
const POINTER_TYPE_ID = 102;
const SETTING_TYPE_ID = 103;

async function seedDeck(): Promise<void> {
  const s = storage!;
  // Type cards (codename column feeds the codehash the engine pre-folds).
  await seedCard(s, { id: SET_TYPE_ID, name: "Set", codename: "set" });
  await seedCard(s, { id: LIST_TYPE_ID, name: "List", codename: "list" });
  await seedCard(s, { id: POINTER_TYPE_ID, name: "Pointer", codename: "pointer" });
  await seedCard(s, { id: SETTING_TYPE_ID, name: "Setting", codename: "setting" });
  // The catch-all set card.
  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  // Setting cards (the 23 the accordion iterates beyond *all itself).
  const settings: Array<[number, string, string]> = [
    [2, "*read", "read"],
    [3, "*create", "create"],
    [4, "*update", "update"],
    [5, "*delete", "delete"],
    [6, "*captcha", "captcha"],
    [7, "*structure", "structure"],
    [8, "*default", "default"],
    [9, "*autoname", "autoname"],
    [10, "*help", "help"],
    [11, "*input type", "input_type"],
    [12, "*guide", "guide"],
    [13, "*content options", "content_options"],
    [14, "*content option view", "content_option_view"],
    [15, "*head", "head"],
    [16, "*layout", "layout"],
    [17, "*style", "style"],
    [18, "*script", "script"],
    [19, "*on create", "on_create"],
    [20, "*on update", "on_update"],
    [21, "*on delete", "on_delete"],
    [22, "*thanks", "thanks"],
    [23, "*follow fields", "follow_fields"],
    [24, "*follow", "follow"],
  ];
  for (const [id, name, codename] of settings) {
    await seedCard(s, { id, name, codename, typeId: SETTING_TYPE_ID });
  }
  // Set-pattern cards (the right parts that name a set card's pattern).
  await seedCard(s, { id: 25, name: "*self", codename: "self", typeId: SETTING_TYPE_ID });
  await seedCard(s, { id: 26, name: "*right", codename: "right", typeId: SETTING_TYPE_ID });
  // One stored rule: *all+*read, List-typed (the deck's read grant —
  // the real deck's rule lists Administrator + Anyone). Pointer items
  // are newline-separated; the last item names a card the deck does
  // NOT contain (the wanted side of pin 1).
  await seedCard(s, {
    id: 31,
    leftId: 1,
    rightId: 2,
    typeId: LIST_TYPE_ID,
    dbContent: "Administrator\nAnyone\nNobody",
  });
  // The known item targets: Administrator (a plain card) + Anyone (the
  // role the read grant admits) + Anonymous (the default viewer's party
  // id — statement 1 of the permission batch resolves it by codename).
  await seedCard(s, { id: 40, name: "Administrator", dbContent: "admin body" });
  await seedCard(s, { id: 41, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 42, name: "Anonymous", codename: "anonymous" });
  // The read-rule walk resolves the rule's items through card_references
  // (the same wiring search-permission-filter.test.ts pins).
  await seedReference(s, 31, 40, "administrator");
  await seedReference(s, 31, 41, "anyone");
  // A Pointer-typed card whose +*self set pins the editing-badge-5 side.
  await seedCard(s, { id: 30, name: "*home", codename: "home", typeId: POINTER_TYPE_ID });
  await seedCard(s, { id: 32, leftId: 30, rightId: 25, typeId: SET_TYPE_ID });
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedDeck();
  // Warm the setting cards into the render-card map: the *all set page's
  // stored rule (*all+*read) trips preloadSetRules' haveAny skip guard, so
  // preloadAllSettingCards never runs on that path and findSettingCard
  // would miss every setting (each virtual falls through to quietDenial).
  // One bare render per setting card loads it; the corpus pipeline gets
  // the same effect through its full-deck seed.
  const settingNames = [
    "*read", "*create", "*update", "*delete", "*captcha", "*structure",
    "*default", "*autoname", "*help", "*input type", "*guide",
    "*content options", "*content option view", "*head", "*layout",
    "*style", "*script", "*on create", "*on update", "*on delete",
    "*thanks", "*follow fields", "*follow",
  ];
  for (const name of settingNames) {
    try {
      await storage.engine.render(name, "open");
    } catch {
      // A setting card render is best-effort warm-up only.
    }
  }
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("rule-bar one-line items: known/wanted + url_key href", () => {
  it("classifies a stored item known-card and a missing item wanted-card", async () => {
    const html = await storage!.engine.render("*all+*read", "bar_right");
    // Known item: known-card class + url_key href + resolved display name.
    expect(html).toContain('<a class="known-card" href="/Administrator">');
    expect(html).toContain(
      '<span class="card-title" title="Administrator">Administrator</span>',
    );
    // Missing item: wanted-card (links.rb add_known_or_wanted_class,
    // Card.known? = fetch(mark).present? -> nil here).
    expect(html).toContain('<a class="wanted-card" href="/Nobody">');
    // The old always-wanted shape must be gone for the known item.
    expect(html).not.toContain('<a class="wanted-card" href="/Administrator">');
  });
});

describe("category accordion group lis", () => {
  it("renders the templating group in registration-position order (structure, default, autoname)", async () => {
    const html = await storage!.engine.render("*all", "content");
    const groupStart = html.indexOf("card-Xall-templating-collapse-id");
    expect(groupStart).toBeGreaterThan(-1);
    const body = html.slice(groupStart, groupStart + 12_000);
    const structureAt = body.indexOf("Xall-Xstructure-bar-view");
    const defaultAt = body.indexOf("Xall-Xdefault-bar-view");
    const autonameAt = body.indexOf("Xall-Xautoname-bar-view");
    // All three virtual bars render (setting_list_item builds a virtual
    // rule card per setting) and in the oracle-pinned order.
    expect(structureAt).toBeGreaterThan(-1);
    expect(defaultAt).toBeGreaterThan(structureAt);
    expect(autonameAt).toBeGreaterThan(defaultAt);
  });

  it("keeps the badge the visible-setting count (rule_lists.rb:87 list.size)", async () => {
    const html = await storage!.engine.render("*all", "content");
    // templating 3, permission 5, webpage 4, editing 3, event 3, other 3 —
    // the 809-page oracle badge signature for sets whose prototype has no
    // list/pointer/session type.
    expect(html).toContain('_count badge bg-secondary ms-3">3</span>');
    expect(html).toContain('_count badge bg-secondary ms-3">5</span>');
    expect(html).toContain('_count badge bg-secondary ms-3">4</span>');
    // The editing group must NOT expose the restricted settings for *all.
    // (Slot-id membership is the pin; the id spelling carries the name
    // key's singularization, which is the name-key lane's surface, so the
    // content_options id is matched tolerantly.)
    const editingStart = html.indexOf("card-Xall-editing-collapse-id");
    const editingBody = html.slice(editingStart, html.indexOf("card-Xall-event-collapse-id"));
    expect(editingBody).not.toMatch(/Xall-Xcontent_options?-bar-view/);
    expect(editingBody).not.toMatch(/Xall-Xcontent_option_view-bar-view/);
    expect(editingBody).toContain("Xall-Xhelp-bar-view");
    expect(editingBody).toContain("Xall-Xinput_type-bar-view");
    expect(editingBody).toContain("Xall-Xguide-bar-view");
  });

  it("shows all five editing settings when the prototype type is Pointer (+*self set of a Pointer card)", async () => {
    const html = await storage!.engine.render("*home+*self", "content");
    // Prototype = the real *home card (Pointer) -> restricted_to_type
    // %i[list pointer session] admits content_options + content_option_view.
    const editingStart = html.indexOf("card-Xhome-Xself-editing-collapse-id");
    expect(editingStart).toBeGreaterThan(-1);
    const editingBody = html.slice(
      editingStart,
      html.indexOf("card-Xhome-Xself-event-collapse-id"),
    );
    expect(editingBody).toMatch(/Xhome-Xself-Xcontent_options?-bar-view/);
    expect(editingBody).toContain("Xhome-Xself-Xcontent_option_view-bar-view");
  });
});
