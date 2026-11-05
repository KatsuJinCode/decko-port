/**
 * Per-pattern semantics - one describe per registered pattern (registration
 * order: lookup order, most specific first). Table-driven; every expectation
 * cites its Ruby source (file#method) and, where marked ORACLE, the captured
 * live-decko output (set-pattern-oracle-capture.json = probe 1,
 * set-pattern-oracle-capture2.json = probe 2; generators:
 * set-pattern-oracle-probe*.rb against card-1.110.0 / decko-0.20.0).
 */

import { describe, expect, it } from "vitest";
import { PATTERN_TABLE, findPattern } from "../../../src/card/set-patterns/registry.js";
import { PatternInstance } from "../../../src/card/set-patterns/instance.js";
import {
  concretePatternsForCard,
  patternsForCard,
  ruleLookupKeysForCard,
  safeSetKeysForCard,
  setNamesForCard,
  typeAssigningModuleKeys,
} from "../../../src/card/set-patterns/card-patterns.js";
import type { PatternCardInput } from "../../../src/card/set-patterns/types.js";
// installs the captured-facts name environment (beforeEach/afterEach side effect)
import "./oracle-environment.js";

// Card inputs whose facts come from the oracle deck captures (ids/type ids
// are deck-specific, see set-pattern-oracle-capture.json).
const ORACLE_BASICS: PatternCardInput = {
  name: "Oracle Basics", id: 605, typeId: 2, typeName: "RichText",
};
const ORACLE_JUNCTION: PatternCardInput = {
  name: "Oracle Junction", id: 606, typeId: 2, typeName: "RichText",
};
const ORACLE_FIELD: PatternCardInput = {
  name: "Oracle Junction+child_one", id: 608, typeId: 2, typeName: "RichText",
  leftTypeName: "RichText",
};
const STAR_SETTING: PatternCardInput = {
  name: "*read", id: 9, typeId: 6, typeName: "Setting",
};
const RULE_CARD: PatternCardInput = {
  name: "*all+*read", id: 10, typeId: 4, typeName: "List", isRule: true,
  // superleft "*all" is a Set card (type name "Set") - drives the
  // *type plus right anchor "Set+*read" (oracle-verified set name).
  leftTypeName: "Set",
};
const NEW_SIMPLE: PatternCardInput = {
  name: "Zz Probe New Simple", isNew: true, typeId: 2, typeName: "RichText",
};
const NEW_FIELD: PatternCardInput = {
  name: "Zz Probe New+field", isNew: true, typeId: 2, typeName: "RichText",
};

function instanceFor(code: string, card: PatternCardInput): PatternInstance {
  const spec = findPattern(code);
  if (!spec) throw new Error(`no pattern ${code}`);
  const instance = PatternInstance.tryNew(spec, card);
  if (!instance) throw new Error(`pattern ${code} does not apply`);
  return instance;
}

describe("*all pattern (01_all.rb)", () => {
  it("applies to every card (no pattern_applies? override, not compound_only)", () => {
    // class_methods.rb#pattern_applies? default: compound_only? ?
    // card.name.compound? : true. ORACLE: every probed card's pattern list
    // ends with "*all" (simple, compound, star, rule cards alike).
    expect(findPattern("all")?.applies(ORACLE_BASICS)).toBe(true);
    expect(findPattern("all")?.applies(ORACLE_FIELD)).toBe(true);
    expect(findPattern("all")?.applies({ name: "*anything at all" })).toBe(true);
  });

  it("is anchorless: set name is the pattern card itself", () => {
    // Base#to_s: anchorless? ? pattern.s : ... (no anchor_name in 01_all.rb,
    // so register marks it anchorless).
    const instance = instanceFor("all", ORACLE_BASICS);
    expect(instance.anchorless).toBe(true);
    expect(instance.setName).toBe("*all"); // ORACLE: set_names last entry
  });

  it("rule lookup key is the bare code", () => {
    // Base#rule_lookup_key: anchorless -> pattern_code.to_s.
    // ORACLE: rule_lookup_keys last entry "all" for every probed card.
    expect(instanceFor("all", ORACLE_FIELD).ruleLookupKey).toBe("all");
  });

  it("prototype_args is the empty hash", () => {
    // 01_all.rb#prototype_args: {}. ORACLE capture1 set_cards["*all"]:
    // prototype_name "" (no name in args), prototype_type "RichText" (deck
    // default type - Card layer, deferred).
    expect(findPattern("all")?.prototypeArgs(undefined)).toEqual({});
  });

  it("labels: 'All cards' / 'everything'; generic_label falls back to label(nil)", () => {
    // 01_all.rb#label/#short_label; class_methods.rb#generic_label default.
    // ORACLE capture1 labels[code=all]: exactly these three strings.
    const spec = findPattern("all");
    expect(spec?.label("Book")).toBe("All cards");
    expect(spec?.shortLabel("Book")).toBe("everything");
    expect(spec?.genericLabel()).toBe("All cards");
  });

  it("safe key is the bare uppercased code", () => {
    // Base#safe_key. ORACLE capture2 cards["Oracle Junction"].safe_keys last
    // entry "ALL".
    expect(instanceFor("all", ORACLE_JUNCTION).safeKey).toBe("ALL");
  });
});

describe("*all plus pattern (02_all_plus.rb)", () => {
  it("applies to compound cards only (compound_only: true)", () => {
    // 02_all_plus.rb @@options = { compound_only: true } via the
    // pattern_applies? default. ORACLE: "*all plus" appears in the junction
    // card's patterns, not in the simple cards'.
    expect(findPattern("all_plus")?.applies(ORACLE_BASICS)).toBe(false);
    expect(findPattern("all_plus")?.applies(ORACLE_FIELD)).toBe(true);
  });

  it("is anchorless (no anchor_name method) despite filtering by shape", () => {
    // ORACLE capture1 set_cards["*all plus"]: anchor_name null,
    // pattern_name "*all plus".
    const instance = instanceFor("all_plus", ORACLE_FIELD);
    expect(instance.anchorless).toBe(true);
    expect(instance.setName).toBe("*all plus");
    expect(instance.ruleLookupKey).toBe("all_plus"); // ORACLE lookup keys
  });

  it("prototype_args is { name: \"+\" }", () => {
    // 02_all_plus.rb#prototype_args. ORACLE: prototype_name "+".
    expect(findPattern("all_plus")?.prototypeArgs(undefined)).toEqual({ name: "+" });
  });

  it("labels: 'All \"+\" cards' both forms", () => {
    // ORACLE capture1 labels[code=all_plus].
    const spec = findPattern("all_plus");
    expect(spec?.label(undefined)).toBe('All "+" cards');
    expect(spec?.shortLabel(undefined)).toBe('all "+" cards');
    expect(spec?.genericLabel()).toBe('All "+" cards');
  });
});

describe("*type pattern (03_type.rb)", () => {
  it("applies when the card has a type id (pattern_applies?: !!card.type_id)", () => {
    // 03_type.rb#pattern_applies?. ORACLE: new cards (default type
    // RichText) still get the type pattern (capture1 new_cards).
    expect(findPattern("type")?.applies(ORACLE_JUNCTION)).toBe(true);
    expect(findPattern("type")?.applies(NEW_SIMPLE)).toBe(true);
    expect(findPattern("type")?.applies({ name: "X" })).toBe(false);
  });

  it("anchors on the card's type name and id", () => {
    // 03_type.rb#anchor_name (card.type_name) / #anchor_id (card.type_id).
    // ORACLE: "Oracle Basics" patterns include "RichText+*type" with lookup
    // key "2+type".
    const instance = instanceFor("type", ORACLE_BASICS);
    expect(instance.anchorName?.s).toBe("RichText");
    expect(instance.setName).toBe("RichText+*type");
    expect(instance.anchorId).toBe(2);
    expect(instance.ruleLookupKey).toBe("2+type");
  });

  it("prototype_args is { type: anchor }", () => {
    // 03_type.rb#prototype_args. ORACLE: "RichText+*type" prototype has no
    // name and type RichText.
    expect(findPattern("type")?.prototypeArgs("RichText")).toEqual({ type: "RichText" });
  });

  it("labels quote the anchor and plain-append the plural s", () => {
    // 03_type.rb#label / #short_label (string interpolation, no inflector).
    // ORACLE capture1 labels[code=type].
    const spec = findPattern("type");
    expect(spec?.label("Book")).toBe('All "Book" cards');
    expect(spec?.shortLabel("Book")).toBe('all "Books"');
    expect(spec?.genericLabel()).toBe("cards of a given type");
  });

  it("safe key uses the type NAME (TYPE-rich_text), unlike the module key's codename", () => {
    // Base#safe_key vs Base#module_key. ORACLE capture2
    // cards["Oracle Junction"].safe_keys: "TYPE-rich_text".
    expect(instanceFor("type", ORACLE_JUNCTION).safeKey).toBe("TYPE-rich_text");
  });

  it("module key uses the anchor card's CODENAME - RichText's codename is 'basic'", () => {
    // Base#module_key: ([pattern_code] + anchor_codes).map(&:camelize).
    // anchor_codenames resolve the anchor CARD's codename: the RichText
    // cardtype card carries codename "basic" (renamed card, kept codename).
    // ORACLE capture2 cards["Oracle Junction"].module_keys[1] == "Type::Basic".
    expect(instanceFor("type", ORACLE_JUNCTION).moduleKey).toBe("Type::Basic");
  });
});

describe("*star pattern (04_star.rb)", () => {
  it("applies to simple star names only (pattern_applies?: card.name.star?)", () => {
    // 04_star.rb#pattern_applies?. ORACLE: "*read" patterns include "*star";
    // simple non-star and compound cards' patterns do not.
    expect(findPattern("star")?.applies(STAR_SETTING)).toBe(true);
    expect(findPattern("star")?.applies(ORACLE_JUNCTION)).toBe(false);
    expect(findPattern("star")?.applies(RULE_CARD)).toBe(false);
  });

  it("is anchorless with set name *star and lookup key star", () => {
    // ORACLE: "*read" set_names[1] == "*star", rule_lookup_keys[1] == "star".
    const instance = instanceFor("star", STAR_SETTING);
    expect(instance.setName).toBe("*star");
    expect(instance.ruleLookupKey).toBe("star");
  });

  it("prototype_args is { name: \"*dummy\" }", () => {
    // 04_star.rb#prototype_args. ORACLE: prototype_name "*dummy".
    expect(findPattern("star")?.prototypeArgs(undefined)).toEqual({ name: "*dummy" });
  });

  it("labels: 'All \"*\" cards'", () => {
    // ORACLE capture1 labels[code=star].
    const spec = findPattern("star");
    expect(spec?.label(undefined)).toBe('All "*" cards');
    expect(spec?.shortLabel(undefined)).toBe('all "*" cards');
    expect(spec?.genericLabel()).toBe('All "*" cards');
  });
});

describe("*rstar pattern (05_rstar.rb)", () => {
  it("applies to compound cards with a starred tag (pattern_applies?: card.name.rstar?)", () => {
    // 05_rstar.rb#pattern_applies?. ORACLE: "*all+*read" (tag "*read")
    // patterns include "*rstar"; "Oracle Junction+child_one" does not.
    expect(findPattern("rstar")?.applies(RULE_CARD)).toBe(true);
    expect(findPattern("rstar")?.applies(ORACLE_FIELD)).toBe(false);
    expect(findPattern("rstar")?.applies({ name: "A+*right" })).toBe(true);
  });

  it("is anchorless with set name *rstar and lookup key rstar", () => {
    // ORACLE: "*all+*read" set_names include "*rstar", lookup keys "rstar".
    const instance = instanceFor("rstar", RULE_CARD);
    expect(instance.setName).toBe("*rstar");
    expect(instance.ruleLookupKey).toBe("rstar");
  });

  it("prototype_args is { name: \"*dummy+*dummy\" }", () => {
    // 05_rstar.rb#prototype_args. ORACLE: prototype_name "*dummy+*dummy".
    expect(findPattern("rstar")?.prototypeArgs(undefined)).toEqual({ name: "*dummy+*dummy" });
  });

  it("labels: 'All \"+*\" cards'", () => {
    // ORACLE capture1 labels[code=rstar].
    const spec = findPattern("rstar");
    expect(spec?.label(undefined)).toBe('All "+*" cards');
    expect(spec?.shortLabel(undefined)).toBe('all "+*" cards');
    expect(spec?.genericLabel()).toBe('All "+*" cards');
  });
});

describe("*rule pattern (06_rule.rb)", () => {
  it("applies to rule cards (pattern_applies?: card.rule?)", () => {
    // 06_rule.rb#pattern_applies?. The port takes card.rule? as the isRule
    // input flag (Ruby derives it in lib/card/rule/all.rb#rule? from the
    // part types: standard_rule? || preference?). ORACLE: "*all+*read"
    // (left Set, right Setting) patterns include "*rule"; plain cards' do not.
    expect(findPattern("rule")?.applies(RULE_CARD)).toBe(true);
    expect(findPattern("rule")?.applies(ORACLE_JUNCTION)).toBe(false);
    expect(findPattern("rule")?.applies(STAR_SETTING)).toBe(false);
  });

  it("is anchorless with set name *rule and lookup key rule", () => {
    // ORACLE: "*all+*read" set_names include "*rule", lookup keys "rule".
    const instance = instanceFor("rule", RULE_CARD);
    expect(instance.setName).toBe("*rule");
    expect(instance.ruleLookupKey).toBe("rule");
  });

  it("prototype_args is { name: \"*all+*create\" }", () => {
    // 06_rule.rb#prototype_args. ORACLE: prototype_name "*all+*create"
    // (prototype type List - rule cards are List cards).
    expect(findPattern("rule")?.prototypeArgs(undefined)).toEqual({ name: "*all+*create" });
  });

  it("labels: 'All rule cards'", () => {
    // ORACLE capture1 labels[code=rule]: label, short_label and
    // generic_label (label(nil) fallback) all agree.
    const spec = findPattern("rule");
    expect(spec?.label(undefined)).toBe("All rule cards");
    expect(spec?.shortLabel(undefined)).toBe("all rule cards");
    expect(spec?.genericLabel()).toBe("All rule cards");
  });
});

describe("*right pattern (07_right.rb)", () => {
  it("applies to compound cards only (compound_only: true)", () => {
    // 07_right.rb @@options + default pattern_applies?. ORACLE: junction
    // card's patterns include "child_one+*right"; simple cards' do not.
    expect(findPattern("right")?.applies(ORACLE_JUNCTION)).toBe(false);
    expect(findPattern("right")?.applies(ORACLE_FIELD)).toBe(true);
  });

  it("anchors on the card's tag (anchor_name: card.name.tag)", () => {
    // 07_right.rb#anchor_name. ORACLE: "Oracle Junction+child_one"
    // patterns include "child_one+*right" with lookup key "607+right"
    // (anchor id = child_one's id through the lexicon).
    const instance = instanceFor("right", ORACLE_FIELD);
    expect(instance.anchorName?.s).toBe("child_one");
    expect(instance.setName).toBe("child_one+*right");
    expect(instance.anchorId).toBe(607);
    expect(instance.ruleLookupKey).toBe("607+right");
  });

  it("set name exists but lookup key is nil when the anchor card is not in the db", () => {
    // Base#rule_lookup_key returns nil without an anchor id
    // (`elsif @anchor_id`), and All#rule_lookup_keys compacts it away.
    // ORACLE capture1 new_cards.field: patterns list "field+*right" while
    // rule_lookup_keys = ["2+type", "all_plus", "all"] - no right key.
    expect(instanceFor("right", NEW_FIELD).setName).toBe("field+*right");
    expect(instanceFor("right", NEW_FIELD).ruleLookupKey).toBeNull();
  });

  it("prototype_args is { name: \"*dummy+<anchor>\" }", () => {
    // 07_right.rb#prototype_args. ORACLE: "child_one+*right" prototype
    // name "*dummy+child_one".
    expect(findPattern("right")?.prototypeArgs("child_one")).toEqual({
      name: "*dummy+child_one",
    });
  });

  it("labels quote the tag; short_label plain-appends the plural s", () => {
    // 07_right.rb#label / #short_label. ORACLE capture1 labels[code=right].
    const spec = findPattern("right");
    expect(spec?.label("Book")).toBe('All "+Book" cards');
    expect(spec?.shortLabel("Book")).toBe('all "+Books"');
    expect(spec?.genericLabel()).toBe("given field cards");
  });

  it("safe key uses the anchor's safe_key (star -> X)", () => {
    // Base#safe_key. ORACLE capture2 cards["*read"].safe_keys:
    // "RIGHT-Xread" (anchor "*read" -> safe_key "Xread").
    expect(instanceFor("right", RULE_CARD).safeKey).toBe("RIGHT-Xread");
  });
});

describe("*type plus right pattern (08_type_plus_right.rb)", () => {
  it("applies to compound cards only (compound_only: true)", () => {
    // 08_type_plus_right.rb @@options. ORACLE: any compound card's patterns
    // include a *type plus right set ("*all+*read" has
    // "Set+*read+*type plus right").
    expect(findPattern("type_plus_right")?.applies(ORACLE_JUNCTION)).toBe(false);
    expect(findPattern("type_plus_right")?.applies(ORACLE_FIELD)).toBe(true);
    expect(findPattern("type_plus_right")?.applies(RULE_CARD)).toBe(true);
  });

  it("anchors on '<left type>+<tag>' (anchor_name: left_type(card) + card.name.tag)", () => {
    // 08_type_plus_right.rb#anchor_name. ORACLE: "Oracle Junction+child_one"
    // patterns include "RichText+child_one+*type plus right".
    const instance = instanceFor("type_plus_right", ORACLE_FIELD);
    expect(instance.anchorName?.s).toBe("RichText+child_one");
    expect(instance.setName).toBe("RichText+child_one+*type plus right");
  });

  it("falls back to RichText for unknown left types (left_type -> quick_type)", () => {
    // 08_type_plus_right.rb#left_type: superleft&.type_name ||
    // quick_type(left_name); quick_type fetches with new: {} so unknown
    // names become new cards with the default type RichText.
    // ORACLE capture1 new_cards.field: "RichText+field+*type plus right".
    expect(instanceFor("type_plus_right", NEW_FIELD).setName).toBe(
      "RichText+field+*type plus right",
    );
  });

  it("lookup key is nil while the anchor CARD does not exist", () => {
    // Base#initialize find_anchor_id: no anchor_id override here ->
    // anchor_name.card_id; Base#rule_lookup_key needs it. ORACLE:
    // "Oracle Junction+child_one" lists the tpr set name but its
    // rule_lookup_keys contain no tpr entry (the "RichText+child_one" card
    // does not exist in the oracle deck). The positive branch (existing
    // anchor card -> "<id>+<code>") is the same code path verified for
    // *right ("607+right") and *type ("2+type").
    expect(instanceFor("type_plus_right", ORACLE_FIELD).ruleLookupKey).toBeNull();
    expect(ruleLookupKeysForCard(ORACLE_FIELD)).toEqual([
      "608+self", "607+right", "2+type", "all_plus", "all",
    ]);
  });

  it("anchor_parts_count is 2 and anchor_parts split the anchor", () => {
    // 08_type_plus_right.rb @@options anchor_parts_count: 2;
    // Base#anchor_parts. ORACLE capture2: tpr safe key
    // "TYPE_PLUS_RIGHT-rich_text-child_one" (anchor safe_key
    // "rich_text-child_one" joins both parts).
    const instance = instanceFor("type_plus_right", ORACLE_FIELD);
    expect(instance.anchorPartsCount).toBe(2);
    expect(instance.anchorParts.map((p) => p.s)).toEqual(["RichText", "child_one"]);
    expect(instance.safeKey).toBe("TYPE_PLUS_RIGHT-rich_text-child_one");
  });

  it("module key needs codenames on BOTH anchor parts (all-or-nothing)", () => {
    // Base#anchor_codenames: map with `|| break` collapses to nil on the
    // first missing codename. ORACLE capture2
    // cards["Oracle Junction+child_one"].module_keys[1] == null.
    expect(instanceFor("type_plus_right", ORACLE_FIELD).moduleKey).toBeNull();
    expect(typeAssigningModuleKeys(ORACLE_FIELD)).toEqual([]);
  });

  it("prototype_args: relative name plus a *dummy supercard of the anchor's trunk type", () => {
    // 08_type_plus_right.rb#prototype_args:
    // { name: "+#{anchor.tag}", supercard: Card.new(name: "*dummy",
    // type: anchor.trunk_name) }. ORACLE: "RichText+child_one+*type plus
    // right" prototype name "*dummy+child_one" (resolved THROUGH the
    // supercard context) with type RichText.
    expect(findPattern("type_plus_right")?.prototypeArgs("RichText+child_one")).toEqual({
      name: "+child_one",
      supercard: { name: "*dummy", type: "RichText" },
    });
  });

  it("labels split the anchor into tag and left", () => {
    // 08_type_plus_right.rb#label / #short_label. ORACLE
    // capture2 tpr_set_labels: exact strings below; capture1 labels[code=
    // type_plus_right] shows the one-part-anchor quirk (left "" -> "s").
    const spec = findPattern("type_plus_right");
    expect(spec?.label("RichText+child_one")).toBe('All "+child_one" cards on "RichText" cards');
    expect(spec?.shortLabel("RichText+child_one")).toBe('all "+child_one" on "RichTexts"');
    expect(spec?.label("Book")).toBe('All "+Book" cards on "" cards');
    expect(spec?.shortLabel("Book")).toBe('all "+Book" on "s"');
    expect(spec?.genericLabel()).toBe("given field cards on a given type");
  });
});

describe("*self pattern (09_self.rb)", () => {
  it("applies to every card (no override, not compound_only)", () => {
    expect(findPattern("self")?.applies(ORACLE_JUNCTION)).toBe(true);
    expect(findPattern("self")?.applies(ORACLE_FIELD)).toBe(true);
  });

  it("anchors on the card's full name (anchor_name: card.name)", () => {
    // 09_self.rb#anchor_name. ORACLE: "Oracle Junction" patterns[0] is
    // "Oracle Junction+*self"; the junction card's is
    // "Oracle Junction+child_one+*self".
    expect(instanceFor("self", ORACLE_JUNCTION).setName).toBe("Oracle Junction+*self");
    expect(instanceFor("self", ORACLE_FIELD).setName).toBe("Oracle Junction+child_one+*self");
  });

  it("anchors on the card's id (anchor_id: card.id)", () => {
    // 09_self.rb#anchor_id. ORACLE: lookup keys "606+self" (junction),
    // "608+self" (junction field), "9+self" (*read), "10+self" (*all+*read).
    expect(instanceFor("self", ORACLE_JUNCTION).anchorId).toBe(606);
    expect(instanceFor("self", ORACLE_JUNCTION).ruleLookupKey).toBe("606+self");
    expect(instanceFor("self", RULE_CARD).ruleLookupKey).toBe("10+self");
  });

  it("falls back to the name's lexicon id when the card itself has none", () => {
    // Base#find_anchor_id: `self.class.try(:anchor_id, card) ||
    // @anchor_name.card_id` - the || also fires when anchor_id returns nil
    // (new card). A new card whose name is lexicon-registered still yields
    // the id-based lookup key.
    const instance = instanceFor("self", { ...ORACLE_JUNCTION, isNew: true, id: null });
    expect(instance.anchorId).toBe(606);
    expect(instance.ruleLookupKey).toBe("606+self");
  });

  it("anchor_parts_count is the anchor's part count (dynamic override)", () => {
    // 09_self.rb#anchor_parts_count: anchor_name&.part_names&.size || 1.
    expect(instanceFor("self", ORACLE_JUNCTION).anchorPartsCount).toBe(1);
    expect(instanceFor("self", ORACLE_FIELD).anchorPartsCount).toBe(2);
    const deep = instanceFor("self", { name: "A+B+C" });
    expect(deep.anchorPartsCount).toBe(3);
    expect(deep.anchorParts.map((p) => p.s)).toEqual(["A", "B", "C"]);
    // safe_key = key.tr("*", "X").tr("+", "-") (cardname variants.rb) -
    // part-internal underscores stay, joints become dashes.
    expect(deep.safeKey).toBe("SELF-a-b-c");
  });

  it("module key uses the card's codename when it has one", () => {
    // Base#module_key. ORACLE capture2 cards["*read"].module_keys[0] ==
    // "Self::Read" ("*read" codename "read"); junction cards have no
    // codename -> null.
    expect(instanceFor("self", STAR_SETTING).moduleKey).toBe("Self::Read");
    expect(instanceFor("self", ORACLE_JUNCTION).moduleKey).toBeNull();
  });

  it("labels: 'The card \"<name>\"', short label is the name", () => {
    // 09_self.rb#label / #short_label. ORACLE: labels[code=self] and
    // set_cards["Oracle Junction+*self"] label 'The card "Oracle Junction"'.
    const spec = findPattern("self");
    expect(spec?.label("Book")).toBe('The card "Book"');
    expect(spec?.shortLabel("Book")).toBe("Book");
    expect(spec?.genericLabel()).toBe("a single card");
  });
});

describe("instance selection over the whole table (lib/card/set/pattern/all.rb)", () => {
  it("computes a simple card's sets in lookup order", () => {
    // All#concrete_patterns + Base#to_s. ORACLE capture1
    // cards["Oracle Basics"].set_names.
    expect(setNamesForCard(ORACLE_BASICS)).toEqual([
      "Oracle Basics+*self",
      "RichText+*type",
      "*all",
    ]);
  });

  it("computes a compound card's sets: tpr, right, all_plus join in table order", () => {
    // ORACLE capture1 cards["Oracle Junction+child_one"].set_names.
    expect(setNamesForCard(ORACLE_FIELD)).toEqual([
      "Oracle Junction+child_one+*self",
      "RichText+child_one+*type plus right",
      "child_one+*right",
      "RichText+*type",
      "*all plus",
      "*all",
    ]);
  });

  it("computes a star setting card's sets", () => {
    // ORACLE capture1 cards["*read"].set_names.
    expect(setNamesForCard(STAR_SETTING)).toEqual([
      "*read+*self",
      "*star",
      "Setting+*type",
      "*all",
    ]);
  });

  it("computes a rule card's sets (rule and rstar apply)", () => {
    // ORACLE capture1 cards["*all+*read"].set_names - 8 sets; note the tpr
    // set name "Set+*read+*type plus right" (anchor "Set+*read" has no
    // card, so no tpr lookup key below).
    expect(setNamesForCard(RULE_CARD)).toEqual([
      "*all+*read+*self",
      "Set+*read+*type plus right",
      "*read+*right",
      "*rule",
      "*rstar",
      "List+*type",
      "*all plus",
      "*all",
    ]);
    expect(ruleLookupKeysForCard(RULE_CARD)).toEqual([
      "10+self", "9+right", "rule", "rstar", "4+type", "all_plus", "all",
    ]);
  });

  it("new cards skip the first concrete pattern (the *self set)", () => {
    // All#patterns: `new_card? ? concrete_patterns[1..] :
    // concrete_patterns`; concrete[0] is always *self (applies to
    // everything, first in the table). ORACLE capture1 new_cards:
    // simple -> ["RichText+*type", "*all"];
    // field -> ["RichText+field+*type plus right", "field+*right",
    //           "RichText+*type", "*all plus", "*all"].
    expect(setNamesForCard(NEW_SIMPLE)).toEqual(["RichText+*type", "*all"]);
    expect(ruleLookupKeysForCard(NEW_SIMPLE)).toEqual(["2+type", "all"]);
    expect(setNamesForCard(NEW_FIELD)).toEqual([
      "RichText+field+*type plus right",
      "field+*right",
      "RichText+*type",
      "*all plus",
      "*all",
    ]);
    expect(ruleLookupKeysForCard(NEW_FIELD)).toEqual(["2+type", "all_plus", "all"]);
  });

  it("safe_set_keys reverses the instance order (general first)", () => {
    // All#safe_set_keys: patterns.map(&:safe_key).reverse * " ".
    // ORACLE capture1 cards[*].safe_set_keys, e.g.:
    expect(safeSetKeysForCard(ORACLE_BASICS)).toBe("ALL TYPE-rich_text SELF-oracle_basic");
    expect(safeSetKeysForCard(ORACLE_FIELD)).toBe(
      "ALL ALL_PLUS TYPE-rich_text RIGHT-child_one " +
      "TYPE_PLUS_RIGHT-rich_text-child_one SELF-oracle_junction-child_one",
    );
    expect(safeSetKeysForCard(RULE_CARD)).toBe(
      "ALL ALL_PLUS TYPE-list RSTAR RULE RIGHT-Xread " +
      "TYPE_PLUS_RIGHT-set-Xread SELF-Xall-Xread",
    );
  });

  it("lists every pattern's spec in table order", () => {
    expect(PATTERN_TABLE.map((spec) => spec.code)).toEqual([
      "self", "type_plus_right", "right", "rule", "rstar", "star", "type",
      "all_plus", "all",
    ]);
  });
});

describe("patternsForCard returns PatternInstance objects", () => {
  it("exposes spec, set name and lookup key per instance", () => {
    const instances = patternsForCard(ORACLE_FIELD);
    expect(instances.map((p) => p.patternCode)).toEqual([
      "self", "type_plus_right", "right", "type", "all_plus", "all",
    ]);
    expect(instances.every((p) => p instanceof PatternInstance)).toBe(true);
    expect(concretePatternsForCard(NEW_SIMPLE).length).toBe(
      patternsForCard(NEW_SIMPLE).length + 1,
    );
  });
});
