// Regression tests for the permission-verdict lane mechanisms (the
// permission_denied_mismatch class on the dual-lane exam):
//
// 1. THE "_left" RULE-CONTENT DELEGATION on the READ side. Ruby's
//    permission_rule_id (card-mod-permissions-0.20.0 set/all/permissions.rb:
//    55-71): a COMPOUND card whose first applicable read rule's content is
//    "_left" (regex /^\[?\[?_left\]?\]?$/) reads through its LEFT card's
//    permission rule, recursively. This corpus runs on it: "*all plus+*read"
//    = "_left" is the deck's most-precedence compound-wide rule, so every
//    compound card without a more specific rule inherits its left chain —
//    virtual rule cards under a set inherit the set card's, the set card
//    inherits the anchor's. The pre-fix read walk (canReadByRuleLookup)
//    resolved "*all plus+*read" and keyed the verdict on THAT rule's own
//    referenced party (the "_left" name), denying exactly the cards Ruby
//    allows (1,723+ view-lane flips; the *sidebar+*self rules editor alone
//    carries 20 wrongly-denied bars).
//
// 2. THE SET-CARD RULES-EDITOR preloads. preloadSetRules early-returned
//    when the set card stored NO live rule children (the common case),
//    skipping the setting-card preload and the virtual-rule-card verdict
//    preload — findSettingCard then missed and every setting without a
//    stored rule rendered the quiet-denial span. Ruby's setting_list_item
//    (card-mod-rules set/type/set/html_views/rule_lists.rb:96-101) builds
//    a virtual rule card per visible setting and renders its bar unless
//    the live walk denies.
//
// 3. THE SETTING-GROUP ALGEBRA. Card::Setting.groups iteration order per
//    group comes from setting_opts positions (setting.rb:101-110
//    set_position: an occupied slot INSERTS before, an append goes to the
//    tail): templating = [structure, default, autoname] (default pos 2,
//    structure pos 2 inserted before it, autoname pos 4). visible_settings
//    (card-mod-rules set/type/set.rb:77-86) drops settings failing
//    applies_to_cardtype — content_options/content_option_view gate on
//    supports_content_options? which is FALSE deck-wide
//    (card-mod-list set/all/supports_content_options.rb:8-15, no
//    overriding set module in the loaded mods), so they render for NO set
//    card and the editing group's count badge reads 3, not 5.
//
// Deck layout (ids stable so the reference rows are readable):
//   1  *all            codename all   typeId 2 (Set)
//   2  Set             codename set
//   3  *read           codename read
//   4  Basic
//   5  Anyone          codename anyone
//   6  Anonymous       codename anonymous
//   7  Role A
//   8  *all+*read      [[Anyone]]                       - grants everyone
//   15 *type           codename type
//   16 *self           codename self
//   17 *all plus       codename all_plus
//   20 Anyone Signed In codename anyone_signed_in
//   21 *all plus+*read [[_left]]                        - delegates LEFT
//   22 _left           (the reference target of rule 21, as in the corpus)
//   30 Parent Thing    typeId 4 read_rule_id 8          - readable anchor
//   31 Parent Thing+child (left 30 right 32, NO stored rule) - ALLOWED via
//                        the _left delegation (pre-fix: denied)
//   32 child
//   33 Locked Parent   typeId 4 read_rule_id 37         - Role A only
//   34 Locked Parent+child (left 33 right 32, NO stored rule) - DENIED via
//                        the _left delegation (inherits the lock)
//   36 Locked Parent+*self (left 33 right 16, type Set)
//   37 Locked Parent+*self+*read [[Role A]]
//   40 *sidebar
//   42 *sidebar+*self  (left 40 right 16, type Set, NO rule children)
//   50-70 the 21 setting cards the corpus carries (content_options /
//         content_option_view are absent from the corpus deck)

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { quietDenial } from "../../../src/card/permissions/index.js";

const SET_TYPE_ID = 2;
const BASIC_TYPE_ID = 4;

let storage: RenderTestStorage | undefined;

async function seedSetting(
  s: RenderTestStorage,
  id: number,
  name: string,
  codename: string,
): Promise<void> {
  await seedCard(s, { id, name, codename });
}

async function seedDeck(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 2, name: "Set", codename: "set" });
  await seedCard(s, { id: 3, name: "*read", codename: "read" });
  await seedCard(s, { id: 4, name: "Basic" });
  await seedCard(s, { id: 5, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 6, name: "Anonymous", codename: "anonymous" });
  await seedCard(s, { id: 7, name: "Role A" });
  await seedCard(s, { id: 15, name: "*type", codename: "type" });
  await seedCard(s, { id: 16, name: "*self", codename: "self" });
  await seedCard(s, { id: 17, name: "*all plus", codename: "all_plus" });
  await seedCard(s, { id: 18, name: "*right", codename: "right" });
  await seedCard(s, { id: 20, name: "Anyone Signed In", codename: "anyone_signed_in" });
  // *all+*read -> [[Anyone]]
  await seedCard(s, { id: 8, leftId: 1, rightId: 3, dbContent: "[[Anyone]]" });
  await seedReference(s, 8, 5, "anyone");
  // *all plus+*read -> [[_left]] : EVERY compound card's most-precedence
  // common rule delegates to its left chain (the corpus's *all plus+*read
  // id 6569 is exactly this shape, content "_left").
  await seedCard(s, { id: 21, leftId: 17, rightId: 3, dbContent: "[[_left]]" });
  await seedCard(s, { id: 22, name: "_left" });
  await seedReference(s, 21, 22, "_left");

  // The _left delegation pair: readable anchor + compound child.
  await seedCard(s, {
    id: 30, name: "Parent Thing", typeId: BASIC_TYPE_ID,
    dbContent: "parent body", readRuleId: 8, readRuleClass: "*all",
  });
  await seedCard(s, { id: 32, name: "child" });
  await seedCard(s, {
    id: 31, leftId: 30, rightId: 32, typeId: BASIC_TYPE_ID,
    dbContent: "child body",
  });
  // The denied pair: locked anchor + compound child (inherits the lock).
  await seedCard(s, {
    id: 33, name: "Locked Parent", typeId: BASIC_TYPE_ID,
    dbContent: "locked body", readRuleId: 37, readRuleClass: "*self",
  });
  await seedCard(s, { id: 36, leftId: 33, rightId: 16, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 37, leftId: 36, rightId: 3, dbContent: "[[Role A]]" });
  await seedReference(s, 37, 7, "role_a");
  await seedCard(s, {
    id: 34, leftId: 33, rightId: 32, typeId: BASIC_TYPE_ID,
    dbContent: "locked child body",
  });

  // The set card "*sidebar+*self" with NO stored rule children (the corpus's
  // id 315 shape) + the 21 setting cards the deck carries.
  await seedCard(s, { id: 40, name: "*sidebar" });
  await seedCard(s, { id: 42, leftId: 40, rightId: 16, typeId: SET_TYPE_ID });
  const settings: Array<[number, string, string]> = [
    [50, "*structure", "structure"],
    [51, "*default", "default"],
    [52, "*autoname", "autoname"],
    [53, "*create", "create"],
    // *read is already card id 3 (codename read) — the setting cards ARE
    // the codename cards; the list omits it to keep ids unique.
    [55, "*update", "update"],
    [56, "*delete", "delete"],
    [57, "*captcha", "captcha"],
    [58, "*head", "head"],
    [59, "*layout", "layout"],
    [60, "*style", "style"],
    [61, "*script", "script"],
    [62, "*help", "help"],
    [63, "*input type", "input_type"],
    [64, "*guide", "guide"],
    [65, "*on_create", "on_create"],
    [66, "*on_update", "on_update"],
    [67, "*on_delete", "on_delete"],
    [68, "*thanks", "thanks"],
    [69, "*follow fields", "follow_fields"],
    [70, "*follow", "follow"],
  ];
  for (const [id, name, codename] of settings) await seedSetting(s, id, name, codename);
  // *structure rules deny for Anonymous deck-wide: *structure+*right+*read
  // -> [[Anyone Signed In]] (the corpus's rule id 22417). The *right pattern
  // precedes *all plus in candidate precedence, so the *structure bar's
  // walk resolves THIS rule (not the _left delegator) and denies — matching
  // the captured oracle's single denied bar in the templating group.
  await seedCard(s, { id: 72, leftId: 50, rightId: 18, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 71, leftId: 72, rightId: 3, dbContent: "[[Anyone Signed In]]" });
  await seedReference(s, 71, 20, "anyone_signed_in");
  // The pointer-item shape host (see the last describe): a Pointer-typed
  // list holding one readable and one denied REAL row. Seeded here (not in
  // the test body) so the typeCode codehash — folded once per engine at the
  // first cold render — knows the Pointer type card.
  await seedCard(s, { id: 81, name: "Pointer", codename: "pointer" });
  await seedCard(s, {
    id: 80, name: "Tag Collection", typeId: 81,
    dbContent: "[[Parent Thing]]\n[[Locked Parent]]",
  });
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedDeck(storage);
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("read-rule _left delegation (permissions.rb:55-71, read side)", () => {
  it("renders a compound card whose winning read rule says _left through its LEFT card's rule", async () => {
    const s = storage!;
    // Parent Thing+child has no stored read_rule_id; the live walk resolves
    // *all plus+*read ([[_left]]) and must follow the delegation to the
    // readable parent. Pre-fix the walk keyed the verdict on the _left rule
    // itself and rendered the quiet denial.
    const html = await s.engine.render("Parent Thing+child", "content");
    expect(html).toContain("child body");
    expect(html).not.toContain('class="denied"');
  });

  it("denies the compound when the LEFT card's rule denies (the lock inherits)", async () => {
    const s = storage!;
    // The delegation walks up to Locked Parent, whose *self+*read rule
    // grants Role A only — Anonymous cannot read the child either.
    expect(await s.engine.render("Locked Parent+child", "content")).toBe(quietDenial());
  });

  it("the left card's own verdict still comes from its stored rule", async () => {
    const s = storage!;
    expect(await s.engine.render("Parent Thing", "content")).toContain("parent body");
    expect(await s.engine.render("Locked Parent", "content")).toBe(quietDenial());
  });
});

describe("set-card rules editor (the *sidebar+*self corpus shape)", () => {
  let html = "";
  beforeAll(async () => {
    html = await storage!.engine.render("*sidebar+*self", "content");
  }, 60_000);

  it("renders the per-setting rule bars, not quiet denials", () => {
    // The set card stores no rule children; every visible setting builds a
    // VIRTUAL rule card whose read verdict must come from the live walk.
    // The pre-fix early return skipped the setting preload entirely and
    // every li fell to the denial span.
    expect(html).toContain('data-card-name="*sidebar+*self+*default"');
    expect(html).toContain('data-card-name="*sidebar+*self+*autoname"');
    expect(html).toContain('data-card-name="*sidebar+*self+*create"');
    expect(html.match(/class="denied"/g)?.length).toBe(1);
  });

  it("orders templating [structure, default, autoname] with the *structure bar denied", () => {
    // structure pos 2 inserted before default pos 2 (setting.rb:105-106);
    // the *structure virtual resolves *structure+*right+*read
    // ([[Anyone Signed In]]) BEFORE the _left delegator -> denied.
    const order = [
      ...html.matchAll(/<li class="nav-item">(<span class="denied">|<div id="[^"]+"[^>]*data-card-name="([^"]*)")/g),
    ].map((m) => (m[1].startsWith("<span") ? "DENIED" : m[2]));
    const templating = order.slice(0, 3);
    expect(templating).toEqual([
      "DENIED",
      "*sidebar+*self+*default",
      "*sidebar+*self+*autoname",
    ]);
  });

  it("excludes the deck-wide-invisible content settings from the editing group", () => {
    // supports_content_options? is false for every card in the loaded mods
    // (card-mod-list set/all/supports_content_options.rb:8-15), so Ruby's
    // visible_settings drops content_options/content_option_view for every
    // prototype.
    expect(html).not.toContain("content_options");
    expect(html).not.toContain("content_option_view");
    expect(html).toContain('data-card-name="*sidebar+*self+*input');
  });

  it("badge counts read the VISIBLE setting list (editing 3, not 5)", () => {
    const badges = [
      ...html.matchAll(/_count badge bg-secondary ms-3">(\d+)</g),
    ].map((m) => m[1]);
    expect(badges).toEqual(["3", "5", "4", "3", "3", "3"]);
  });
});

describe("pointer-item denial shapes (expected-v2 census)", () => {
  it("renders a real read-denied pointer item as the bare quiet span, not a mini_bar wrap", async () => {
    const s = storage!;
    // A pointer whose items are one readable and one denied REAL row: the
    // denied item must short-circuit at the nested view gate into the bare
    // span (view/permission.rb:19-23 altered_view) — the mini_bar slot is
    // bar.rb:9's UNKNOWN-card substitution (the absent-row phantom path),
    // never the readable-card denial shape. (Host + type card are seeded
    // in seedDeck: the codehash folds once per engine, before the tests
    // run, so cards seeded here would resolve no typeCode.)
    const html = await s.engine.render("Tag Collection", "content");
    expect(html).toContain("pointer-item item-bar\"><span class=\"denied\">");
    expect(html).not.toContain("mini_bar-view");
  });
});
