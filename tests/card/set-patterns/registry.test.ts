/**
 * Registry-table tests: registration order, per-pattern options, module-level
 * accessors. Every expectation cites its Ruby source (file#method) and, where
 * marked ORACLE, the captured live-decko output in
 * set-pattern-oracle-capture.json (probe 1) / set-pattern-oracle-capture2.json
 * (probe 2), produced by set-pattern-oracle-probe*.rb against
 * card-1.110.0 / decko-0.20.0.
 */

import { describe, expect, it } from "vitest";
import {
  PATTERN_TABLE,
  findPattern,
  groupedCodes,
  patternCodes,
  patternIds,
  reloadableCodes,
} from "../../../src/card/set-patterns/registry.js";
import { ORACLE_ENV } from "./oracle-environment.js";

describe("pattern table registration order", () => {
  it("lists the nine core patterns in lookup order: self first, all last", () => {
    // ORACLE capture1 "codes": concrete table order after register's
    // front-insert (lib/card/set/pattern/class_methods.rb#register inserts at
    // opts.delete(:index).to_i == 0 for every core pattern).
    expect(patternCodes()).toEqual([
      "self",
      "type_plus_right",
      "right",
      "rule",
      "rstar",
      "star",
      "type",
      "all_plus",
      "all",
    ]);
  });

  it("mirrors the reverse of the file load order 01..09 (loader sorts, register front-inserts)", () => {
    // lib/cardio/mod/loader.rb#each_file_in_dir loads sorted filenames;
    // class_methods.rb#register front-inserts. So loadIndex descends as the
    // table ascends.
    const loadIndexes = PATTERN_TABLE.map((spec) => spec.loadIndex);
    expect(loadIndexes).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect([...loadIndexes].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("cites the mod/core/set_pattern file that registers each pattern", () => {
    // The SetPatternLoader template (lib/cardio/mod/loader/set_pattern_loader.rb
    // SetPatternTemplate#postamble) wraps each file and calls register at its end.
    expect(PATTERN_TABLE.map((spec) => spec.registerSite)).toEqual([
      "card-1.110.0 mod/core/set_pattern/09_self.rb",
      "card-1.110.0 mod/core/set_pattern/08_type_plus_right.rb",
      "card-1.110.0 mod/core/set_pattern/07_right.rb",
      "card-1.110.0 mod/core/set_pattern/06_rule.rb",
      "card-1.110.0 mod/core/set_pattern/05_rstar.rb",
      "card-1.110.0 mod/core/set_pattern/04_star.rb",
      "card-1.110.0 mod/core/set_pattern/03_type.rb",
      "card-1.110.0 mod/core/set_pattern/02_all_plus.rb",
      "card-1.110.0 mod/core/set_pattern/01_all.rb",
    ]);
  });

  it("maps each pattern code to its canonical pattern card name", () => {
    // ORACLE capture2 "pattern_cards": code -> pattern card name via
    // ClassMethods#pattern (pattern_id.cardname through lexicon).
    const cards = Object.fromEntries(
      PATTERN_TABLE.map((spec) => [spec.code, spec.patternCardName]),
    );
    expect(cards).toEqual({
      self: "*self",
      type_plus_right: "*type plus right",
      right: "*right",
      rule: "*rule",
      rstar: "*rstar",
      star: "*star",
      type: "*type",
      all_plus: "*all plus",
      all: "*all",
    });
  });
});

describe("pattern options (@@options per mod/core/set_pattern file)", () => {
  // Each row cites the file whose @@options (or their absence) the values
  // port; ORACLE capture1 "concrete" confirms compound_only/assigns_type/
  // anchorless per pattern through compound_only?/assigns_type/anchorless?.
  it.each([
    ["self", { compoundOnly: false, assignsType: false, anchorless: false, staticAnchorPartsCount: 1 }],
    ["type_plus_right", { compoundOnly: true, assignsType: true, anchorless: false, staticAnchorPartsCount: 2 }],
    ["right", { compoundOnly: true, assignsType: true, anchorless: false, staticAnchorPartsCount: 1 }],
    ["rule", { compoundOnly: true, assignsType: false, anchorless: true, staticAnchorPartsCount: 0 }],
    ["rstar", { compoundOnly: true, assignsType: false, anchorless: true, staticAnchorPartsCount: 0 }],
    ["star", { compoundOnly: false, assignsType: false, anchorless: true, staticAnchorPartsCount: 0 }],
    ["type", { compoundOnly: false, assignsType: false, anchorless: false, staticAnchorPartsCount: 1 }],
    ["all_plus", { compoundOnly: true, assignsType: false, anchorless: true, staticAnchorPartsCount: 0 }],
    ["all", { compoundOnly: false, assignsType: false, anchorless: true, staticAnchorPartsCount: 0 }],
  ])("pattern %s carries its source-file options", (code, expected) => {
    const spec = findPattern(code);
    expect(spec).toBeDefined();
    expect(spec?.compoundOnly).toBe(expected.compoundOnly);
    expect(spec?.assignsType).toBe(expected.assignsType);
    // anchorless derives from "no anchor_name method"
    // (class_methods.rb#register: self.anchorless = !respond_to?(:anchor_name))
    expect(spec?.anchorName === undefined).toBe(expected.anchorless);
    expect(spec?.staticAnchorPartsCount).toBe(expected.staticAnchorPartsCount);
  });
});

describe("Pattern module accessors (lib/card/set/pattern.rb)", () => {
  it("find returns the spec for a registered code, undefined otherwise (Pattern.find)", () => {
    expect(findPattern("type")?.patternCardName).toBe("*type");
    // ORACLE capture1 "find": Card::Set::Pattern.find(:type) => Card::Set::Type,
    // find(:nope) => nil.
    expect(findPattern("nope")).toBeUndefined();
  });

  it("patternIds resolves pattern card ids through the codename registry (Pattern.ids)", () => {
    // ORACLE capture1 "ids" (deck-specific ids) and
    // "pattern_card_ids_by_codename"; ClassMethods#pattern_id =
    // pattern_code.card_id.
    expect(patternIds((code) => ORACLE_ENV.codename?.id(code))).toEqual([
      27, 25, 26, 24, 23, 22, 21, 20, 7,
    ]);
  });

  it("patternIds yields undefined for codes missing from the registry", () => {
    expect(patternIds(() => undefined)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("groupedCodes returns load-order groups (Pattern.grouped_codes)", () => {
    // ORACLE capture1 "grouped_codes":
    // [["all"], ["abstract"], ["all_plus","type","star","rstar","rule","right","type_plus_right","self"]]
    expect(groupedCodes()).toEqual([
      ["all"],
      ["abstract"],
      ["all_plus", "type", "star", "rstar", "rule", "right", "type_plus_right", "self"],
    ]);
    // grouped_codes(with_all: false) drops the [:all] group.
    expect(groupedCodes(false)).toEqual([
      ["abstract"],
      ["all_plus", "type", "star", "rstar", "rule", "right", "type_plus_right", "self"],
    ]);
  });

  it("reloadableCodes is the table minus All, plus Abstract last (Pattern.reloadables)", () => {
    // lib/card/set/pattern.rb#reloadables: concrete - [Set::All] + Abstract
    // - lookup order, All excluded, the abstract pseudo-pattern appended.
    expect(reloadableCodes()).toEqual([
      "self", "type_plus_right", "right", "rule", "rstar", "star", "type",
      "all_plus", "abstract",
    ]);
  });
});
