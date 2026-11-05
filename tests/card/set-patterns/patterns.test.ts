

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

import "./oracle-environment.js";

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

    expect(findPattern("all")?.applies(ORACLE_BASICS)).toBe(true);
    expect(findPattern("all")?.applies(ORACLE_FIELD)).toBe(true);
    expect(findPattern("all")?.applies({ name: "*anything at all" })).toBe(true);
  });

  it("is anchorless: set name is the pattern card itself", () => {

    const instance = instanceFor("all", ORACLE_BASICS);
    expect(instance.anchorless).toBe(true);
    expect(instance.setName).toBe("*all");
  });

  it("rule lookup key is the bare code", () => {

    expect(instanceFor("all", ORACLE_FIELD).ruleLookupKey).toBe("all");
  });

  it("prototype_args is the empty hash", () => {

    expect(findPattern("all")?.prototypeArgs(undefined)).toEqual({});
  });

  it("labels: 'All cards' / 'everything'; generic_label falls back to label(nil)", () => {

    const spec = findPattern("all");
    expect(spec?.label("Book")).toBe("All cards");
    expect(spec?.shortLabel("Book")).toBe("everything");
    expect(spec?.genericLabel()).toBe("All cards");
  });

  it("safe key is the bare uppercased code", () => {

    expect(instanceFor("all", ORACLE_JUNCTION).safeKey).toBe("ALL");
  });
});

describe("*all plus pattern (02_all_plus.rb)", () => {
  it("applies to compound cards only (compound_only: true)", () => {

    expect(findPattern("all_plus")?.applies(ORACLE_BASICS)).toBe(false);
    expect(findPattern("all_plus")?.applies(ORACLE_FIELD)).toBe(true);
  });

  it("is anchorless (no anchor_name method) despite filtering by shape", () => {

    const instance = instanceFor("all_plus", ORACLE_FIELD);
    expect(instance.anchorless).toBe(true);
    expect(instance.setName).toBe("*all plus");
    expect(instance.ruleLookupKey).toBe("all_plus");
  });

  it("prototype_args is { name: \"+\" }", () => {

    expect(findPattern("all_plus")?.prototypeArgs(undefined)).toEqual({ name: "+" });
  });

  it("labels: 'All \"+\" cards' both forms", () => {

    const spec = findPattern("all_plus");
    expect(spec?.label(undefined)).toBe('All "+" cards');
    expect(spec?.shortLabel(undefined)).toBe('all "+" cards');
    expect(spec?.genericLabel()).toBe('All "+" cards');
  });
});

describe("*type pattern (03_type.rb)", () => {
  it("applies when the card has a type id (pattern_applies?: !!card.type_id)", () => {

    expect(findPattern("type")?.applies(ORACLE_JUNCTION)).toBe(true);
    expect(findPattern("type")?.applies(NEW_SIMPLE)).toBe(true);
    expect(findPattern("type")?.applies({ name: "X" })).toBe(false);
  });

  it("anchors on the card's type name and id", () => {

    const instance = instanceFor("type", ORACLE_BASICS);
    expect(instance.anchorName?.s).toBe("RichText");
    expect(instance.setName).toBe("RichText+*type");
    expect(instance.anchorId).toBe(2);
    expect(instance.ruleLookupKey).toBe("2+type");
  });

  it("prototype_args is { type: anchor }", () => {

    expect(findPattern("type")?.prototypeArgs("RichText")).toEqual({ type: "RichText" });
  });

  it("labels quote the anchor and plain-append the plural s", () => {

    const spec = findPattern("type");
    expect(spec?.label("Book")).toBe('All "Book" cards');
    expect(spec?.shortLabel("Book")).toBe('all "Books"');
    expect(spec?.genericLabel()).toBe("cards of a given type");
  });

  it("safe key uses the type NAME (TYPE-rich_text), unlike the module key's codename", () => {

    expect(instanceFor("type", ORACLE_JUNCTION).safeKey).toBe("TYPE-rich_text");
  });

  it("module key uses the anchor card's CODENAME - RichText's codename is 'basic'", () => {

    expect(instanceFor("type", ORACLE_JUNCTION).moduleKey).toBe("Type::Basic");
  });
});

describe("*star pattern (04_star.rb)", () => {
  it("applies to simple star names only (pattern_applies?: card.name.star?)", () => {

    expect(findPattern("star")?.applies(STAR_SETTING)).toBe(true);
    expect(findPattern("star")?.applies(ORACLE_JUNCTION)).toBe(false);
    expect(findPattern("star")?.applies(RULE_CARD)).toBe(false);
  });

  it("is anchorless with set name *star and lookup key star", () => {

    const instance = instanceFor("star", STAR_SETTING);
    expect(instance.setName).toBe("*star");
    expect(instance.ruleLookupKey).toBe("star");
  });

  it("prototype_args is { name: \"*dummy\" }", () => {

    expect(findPattern("star")?.prototypeArgs(undefined)).toEqual({ name: "*dummy" });
  });

  it("labels: 'All \"*\" cards'", () => {

    const spec = findPattern("star");
    expect(spec?.label(undefined)).toBe('All "*" cards');
    expect(spec?.shortLabel(undefined)).toBe('all "*" cards');
    expect(spec?.genericLabel()).toBe('All "*" cards');
  });
});

describe("*rstar pattern (05_rstar.rb)", () => {
  it("applies to compound cards with a starred tag (pattern_applies?: card.name.rstar?)", () => {

    expect(findPattern("rstar")?.applies(RULE_CARD)).toBe(true);
    expect(findPattern("rstar")?.applies(ORACLE_FIELD)).toBe(false);
    expect(findPattern("rstar")?.applies({ name: "A+*right" })).toBe(true);
  });

  it("is anchorless with set name *rstar and lookup key rstar", () => {

    const instance = instanceFor("rstar", RULE_CARD);
    expect(instance.setName).toBe("*rstar");
    expect(instance.ruleLookupKey).toBe("rstar");
  });

  it("prototype_args is { name: \"*dummy+*dummy\" }", () => {

    expect(findPattern("rstar")?.prototypeArgs(undefined)).toEqual({ name: "*dummy+*dummy" });
  });

  it("labels: 'All \"+*\" cards'", () => {

    const spec = findPattern("rstar");
    expect(spec?.label(undefined)).toBe('All "+*" cards');
    expect(spec?.shortLabel(undefined)).toBe('all "+*" cards');
    expect(spec?.genericLabel()).toBe('All "+*" cards');
  });
});

describe("*rule pattern (06_rule.rb)", () => {
  it("applies to rule cards (pattern_applies?: card.rule?)", () => {

    expect(findPattern("rule")?.applies(RULE_CARD)).toBe(true);
    expect(findPattern("rule")?.applies(ORACLE_JUNCTION)).toBe(false);
    expect(findPattern("rule")?.applies(STAR_SETTING)).toBe(false);
  });

  it("is anchorless with set name *rule and lookup key rule", () => {

    const instance = instanceFor("rule", RULE_CARD);
    expect(instance.setName).toBe("*rule");
    expect(instance.ruleLookupKey).toBe("rule");
  });

  it("prototype_args is { name: \"*all+*create\" }", () => {

    expect(findPattern("rule")?.prototypeArgs(undefined)).toEqual({ name: "*all+*create" });
  });

  it("labels: 'All rule cards'", () => {

    const spec = findPattern("rule");
    expect(spec?.label(undefined)).toBe("All rule cards");
    expect(spec?.shortLabel(undefined)).toBe("all rule cards");
    expect(spec?.genericLabel()).toBe("All rule cards");
  });
});

describe("*right pattern (07_right.rb)", () => {
  it("applies to compound cards only (compound_only: true)", () => {

    expect(findPattern("right")?.applies(ORACLE_JUNCTION)).toBe(false);
    expect(findPattern("right")?.applies(ORACLE_FIELD)).toBe(true);
  });

  it("anchors on the card's tag (anchor_name: card.name.tag)", () => {

    const instance = instanceFor("right", ORACLE_FIELD);
    expect(instance.anchorName?.s).toBe("child_one");
    expect(instance.setName).toBe("child_one+*right");
    expect(instance.anchorId).toBe(607);
    expect(instance.ruleLookupKey).toBe("607+right");
  });

  it("set name exists but lookup key is nil when the anchor card is not in the db", () => {

    expect(instanceFor("right", NEW_FIELD).setName).toBe("field+*right");
    expect(instanceFor("right", NEW_FIELD).ruleLookupKey).toBeNull();
  });

  it("prototype_args is { name: \"*dummy+<anchor>\" }", () => {

    expect(findPattern("right")?.prototypeArgs("child_one")).toEqual({
      name: "*dummy+child_one",
    });
  });

  it("labels quote the tag; short_label plain-appends the plural s", () => {

    const spec = findPattern("right");
    expect(spec?.label("Book")).toBe('All "+Book" cards');
    expect(spec?.shortLabel("Book")).toBe('all "+Books"');
    expect(spec?.genericLabel()).toBe("given field cards");
  });

  it("safe key uses the anchor's safe_key (star -> X)", () => {

    expect(instanceFor("right", RULE_CARD).safeKey).toBe("RIGHT-Xread");
  });
});

describe("*type plus right pattern (08_type_plus_right.rb)", () => {
  it("applies to compound cards only (compound_only: true)", () => {

    expect(findPattern("type_plus_right")?.applies(ORACLE_JUNCTION)).toBe(false);
    expect(findPattern("type_plus_right")?.applies(ORACLE_FIELD)).toBe(true);
    expect(findPattern("type_plus_right")?.applies(RULE_CARD)).toBe(true);
  });

  it("anchors on '<left type>+<tag>' (anchor_name: left_type(card) + card.name.tag)", () => {

    const instance = instanceFor("type_plus_right", ORACLE_FIELD);
    expect(instance.anchorName?.s).toBe("RichText+child_one");
    expect(instance.setName).toBe("RichText+child_one+*type plus right");
  });

  it("falls back to RichText for unknown left types (left_type -> quick_type)", () => {

    expect(instanceFor("type_plus_right", NEW_FIELD).setName).toBe(
      "RichText+field+*type plus right",
    );
  });

  it("lookup key is nil while the anchor CARD does not exist", () => {

    expect(instanceFor("type_plus_right", ORACLE_FIELD).ruleLookupKey).toBeNull();
    expect(ruleLookupKeysForCard(ORACLE_FIELD)).toEqual([
      "608+self", "607+right", "2+type", "all_plus", "all",
    ]);
  });

  it("anchor_parts_count is 2 and anchor_parts split the anchor", () => {

    const instance = instanceFor("type_plus_right", ORACLE_FIELD);
    expect(instance.anchorPartsCount).toBe(2);
    expect(instance.anchorParts.map((p) => p.s)).toEqual(["RichText", "child_one"]);
    expect(instance.safeKey).toBe("TYPE_PLUS_RIGHT-rich_text-child_one");
  });

  it("module key needs codenames on BOTH anchor parts (all-or-nothing)", () => {

    expect(instanceFor("type_plus_right", ORACLE_FIELD).moduleKey).toBeNull();
    expect(typeAssigningModuleKeys(ORACLE_FIELD)).toEqual([]);
  });

  it("prototype_args: relative name plus a *dummy supercard of the anchor's trunk type", () => {

    expect(findPattern("type_plus_right")?.prototypeArgs("RichText+child_one")).toEqual({
      name: "+child_one",
      supercard: { name: "*dummy", type: "RichText" },
    });
  });

  it("labels split the anchor into tag and left", () => {

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

    expect(instanceFor("self", ORACLE_JUNCTION).setName).toBe("Oracle Junction+*self");
    expect(instanceFor("self", ORACLE_FIELD).setName).toBe("Oracle Junction+child_one+*self");
  });

  it("anchors on the card's id (anchor_id: card.id)", () => {

    expect(instanceFor("self", ORACLE_JUNCTION).anchorId).toBe(606);
    expect(instanceFor("self", ORACLE_JUNCTION).ruleLookupKey).toBe("606+self");
    expect(instanceFor("self", RULE_CARD).ruleLookupKey).toBe("10+self");
  });

  it("falls back to the name's lexicon id when the card itself has none", () => {

    const instance = instanceFor("self", { ...ORACLE_JUNCTION, isNew: true, id: null });
    expect(instance.anchorId).toBe(606);
    expect(instance.ruleLookupKey).toBe("606+self");
  });

  it("anchor_parts_count is the anchor's part count (dynamic override)", () => {

    expect(instanceFor("self", ORACLE_JUNCTION).anchorPartsCount).toBe(1);
    expect(instanceFor("self", ORACLE_FIELD).anchorPartsCount).toBe(2);
    const deep = instanceFor("self", { name: "A+B+C" });
    expect(deep.anchorPartsCount).toBe(3);
    expect(deep.anchorParts.map((p) => p.s)).toEqual(["A", "B", "C"]);

    expect(deep.safeKey).toBe("SELF-a-b-c");
  });

  it("module key uses the card's codename when it has one", () => {

    expect(instanceFor("self", STAR_SETTING).moduleKey).toBe("Self::Read");
    expect(instanceFor("self", ORACLE_JUNCTION).moduleKey).toBeNull();
  });

  it("labels: 'The card \"<name>\"', short label is the name", () => {

    const spec = findPattern("self");
    expect(spec?.label("Book")).toBe('The card "Book"');
    expect(spec?.shortLabel("Book")).toBe("Book");
    expect(spec?.genericLabel()).toBe("a single card");
  });
});

describe("instance selection over the whole table (lib/card/set/pattern/all.rb)", () => {
  it("computes a simple card's sets in lookup order", () => {

    expect(setNamesForCard(ORACLE_BASICS)).toEqual([
      "Oracle Basics+*self",
      "RichText+*type",
      "*all",
    ]);
  });

  it("computes a compound card's sets: tpr, right, all_plus join in table order", () => {

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

    expect(setNamesForCard(STAR_SETTING)).toEqual([
      "*read+*self",
      "*star",
      "Setting+*type",
      "*all",
    ]);
  });

  it("computes a rule card's sets (rule and rstar apply)", () => {

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
