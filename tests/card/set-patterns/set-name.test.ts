/**
 * Set card name -> pattern + anchor tests (the reverse mapping).
 * Sources: card-mod-rules-0.20.0 set/type/set.rb (#anchor_name,
 * #pattern_name, #pattern, #subclass_for_set, #label,
 * #uncapitalized_label, #compound_only?, #rule_cache_key_base).
 * ORACLE-marked expectations cite set-pattern-oracle-capture.json /
 * set-pattern-oracle-capture2.json.
 */

import { describe, expect, it } from "vitest";
import {
  compoundOnlyForParsedSet,
  labelForParsedSet,
  parseSetName,
  ruleCacheKeyBaseForParsedSet,
  uncapitalizedLabelForParsedSet,
} from "../../../src/card/set-patterns/set-name.js";
import { findPattern } from "../../../src/card/set-patterns/registry.js";
import { PatternInstance } from "../../../src/card/set-patterns/instance.js";
// installs the captured-facts name environment (beforeEach/afterEach side effect)
import "./oracle-environment.js";

describe("parseSetName (set/type/set.rb)", () => {
  it("parses an anchorless set: the pattern card is the set itself", () => {
    // #pattern_name (tag of a simple name is the name) / #anchor_name
    // (left_name of a simple name is nil). ORACLE capture1
    // set_cards["*all"]: anchor_name null, pattern_name "*all".
    const parsed = parseSetName("*all");
    expect(parsed.anchored).toBe(false);
    expect(parsed.patternCardName.s).toBe("*all");
    expect(parsed.anchorName).toBeNull();
    expect(parsed.patternCode).toBe("all");
    expect(parsed.spec?.code).toBe("all");
  });

  it("parses a type set: tag is the pattern card, trunk is the anchor", () => {
    // ORACLE capture1 set_cards["RichText+*type"]: anchor_name "RichText",
    // pattern_name "*type".
    const parsed = parseSetName("RichText+*type");
    expect(parsed.anchored).toBe(true);
    expect(parsed.patternCardName.s).toBe("*type");
    expect(parsed.anchorName?.s).toBe("RichText");
    expect(parsed.patternCode).toBe("type");
  });

  it("parses a right set", () => {
    // ORACLE capture1 set_cards["child_one+*right"]: anchor "child_one",
    // pattern "*right", label 'All "+child_one" cards'.
    const parsed = parseSetName("child_one+*right");
    expect(parsed.patternCode).toBe("right");
    expect(parsed.anchorName?.s).toBe("child_one");
  });

  it("parses a three-part type plus right set: anchor keeps both head parts", () => {
    // ORACLE capture1 set_cards["RichText+child_one+*type plus right"]:
    // anchor_name "RichText+child_one", pattern_name "*type plus right".
    const parsed = parseSetName("RichText+child_one+*type plus right");
    expect(parsed.patternCode).toBe("type_plus_right");
    expect(parsed.anchorName?.s).toBe("RichText+child_one");
  });

  it("parses a self set", () => {
    // ORACLE capture1 set_cards["Oracle Junction+*self"]: anchor
    // "Oracle Junction", pattern "*self", label 'The card "Oracle Junction"'.
    const parsed = parseSetName("Oracle Junction+*self");
    expect(parsed.patternCode).toBe("self");
    expect(parsed.anchorName?.s).toBe("Oracle Junction");
  });

  it("parses every anchorless pattern set through the same simple-name path", () => {
    // ORACLE capture1 set_cards: "*star", "*rstar", "*rule", "*all plus"
    // all have anchor_name null and pattern_name == set name.
    for (const name of ["*star", "*rstar", "*rule", "*all plus"]) {
      const parsed = parseSetName(name);
      expect(parsed.anchored, name).toBe(false);
      expect(parsed.anchorName, name).toBeNull();
      expect(parsed.spec?.patternCardName, name).toBe(name);
    }
  });

  it("resolves the pattern code through the codename registry (subclass_for_set)", () => {
    // #subclass_for_set: Pattern.concrete.find { |set| set.pattern_code ==
    // pattern.codename }. With no codename registry the code is unknown and
    // no spec matches (Ruby: subclass_for_set nil -> label "").
    const parsed = parseSetName("RichText+*type");
    expect(parsed.patternCode).toBe("type");
    expect(parsed.spec?.patternCardName).toBe("*type");
  });

  it("yields a null code and no spec for a tag without a codename", () => {
    // Ruby: pattern.codename nil -> find matches nothing. "SomeTag" is not
    // in the captured lexicon, so no codename resolves.
    const parsed = parseSetName("SomeTag+*right");
    // "*right" resolves fine:
    expect(parsed.spec?.code).toBe("right");
    const unknown = parseSetName("RichText+*not a pattern");
    expect(unknown.patternCode).toBeNull();
    expect(unknown.spec).toBeUndefined();
  });
});

describe("parsed set labels (set/type/set.rb#label)", () => {
  it("labels a set through its pattern class and anchor", () => {
    // ORACLE capture1 set_cards labels:
    expect(labelForParsedSet(parseSetName("*all"))).toBe("All cards");
    expect(labelForParsedSet(parseSetName("RichText+*type"))).toBe('All "RichText" cards');
    expect(labelForParsedSet(parseSetName("child_one+*right"))).toBe('All "+child_one" cards');
    expect(labelForParsedSet(parseSetName("RichText+child_one+*type plus right"))).toBe(
      'All "+child_one" cards on "RichText" cards',
    );
    expect(labelForParsedSet(parseSetName("Oracle Junction+*self"))).toBe(
      'The card "Oracle Junction"',
    );
    expect(labelForParsedSet(parseSetName("*all plus"))).toBe('All "+" cards');
    expect(labelForParsedSet(parseSetName("*rule"))).toBe("All rule cards");
  });

  it("labels an unmatched set as empty string (klass nil branch)", () => {
    // #label: `klass ? klass.label(anchor_name) : ""`.
    expect(labelForParsedSet(parseSetName("RichText+*not a pattern"))).toBe("");
  });

  it("uncapitalized_label always returns the empty string (upstream bug)", () => {
    // #uncapitalized_label assigns `label = label.to_s`, which shadows the
    // method with the fresh local at PARSE time: the RHS `label` reads the
    // nil local, "".to_s -> "", `label[0]` is falsy -> returns "".
    // ORACLE capture2: all_set.uncapitalized_label == "" and
    // tpr_set_labels.uncapitalized_label == "" even though label returns
    // "All cards" / the tpr string. The port reproduces the bug verbatim.
    expect(uncapitalizedLabelForParsedSet(parseSetName("*all"))).toBe("");
    expect(uncapitalizedLabelForParsedSet(parseSetName("RichText+*type"))).toBe("");
  });
});

describe("compound_only? through the parsed set (set/type/set.rb#compound_only?)", () => {
  it("reflects the pattern's compound_only option", () => {
    // ORACLE capture1 set_cards compound_only: true for "*all plus",
    // "*rstar", "*rule", "child_one+*right",
    // "RichText+child_one+*type plus right"; nil (falsy) for "*all",
    // "*star", "RichText+*type", "Oracle Junction+*self". Ruby nil -> false.
    expect(compoundOnlyForParsedSet(parseSetName("*rstar"))).toBe(true);
    expect(compoundOnlyForParsedSet(parseSetName("child_one+*right"))).toBe(true);
    expect(compoundOnlyForParsedSet(parseSetName("RichText+child_one+*type plus right"))).toBe(true);
    expect(compoundOnlyForParsedSet(parseSetName("*all"))).toBe(false);
    expect(compoundOnlyForParsedSet(parseSetName("RichText+*type"))).toBe(false);
    expect(compoundOnlyForParsedSet(parseSetName("Oracle Junction+*self"))).toBe(false);
  });

  it("returns null when no pattern matches (Ruby raises on nil subclass)", () => {
    // Ruby: subclass_for_set.compound_only with subclass_for_set nil raises
    // NoMethodError; the port reports null instead of throwing.
    expect(compoundOnlyForParsedSet(parseSetName("RichText+*not a pattern"))).toBeNull();
  });
});

describe("rule_cache_key_base (set/type/set.rb#rule_cache_key_base)", () => {
  it("builds '<left id>+<pattern code>' for compound sets", () => {
    // `if (l = left) && (r = right); "#{l.id}+#{Codename[r.id]}"`.
    // ORACLE capture2 type_set.rule_cache_key_base == "2+type" - the same
    // key the instance side (Base#rule_lookup_key) produces.
    expect(ruleCacheKeyBaseForParsedSet(parseSetName("RichText+*type"))).toBe("2+type");
  });

  it("builds the bare codename for anchorless sets", () => {
    // `else; Codename[id].to_s; end`. ORACLE capture2
    // all_set.rule_cache_key_base == "all".
    expect(ruleCacheKeyBaseForParsedSet(parseSetName("*all"))).toBe("all");
  });

  it("yields undefined where Ruby would produce a nil-derived partial string", () => {
    // Documented divergence: for sets whose anchor card is missing or whose
    // parts carry no codename, Ruby interpolates nils ("", "5+"-style
    // partials; capture2 tpr_set_labels.rule_cache_key_base == "" because
    // the "RichText+child_one" card and the set card's codename are both
    // absent). The port reports undefined instead of a degenerate string.
    expect(ruleCacheKeyBaseForParsedSet(parseSetName("RichText+child_one+*type plus right"))).toBeUndefined();
  });
});

describe("pattern card names resolve through the registry (Base#pattern)", () => {
  it("PatternInstance.patternCardName prefers the lexicon name for the codename id", () => {
    // Base#pattern: pattern_id.cardname (Integer#cardname ->
    // Card::Lexicon.name, config/initializers/01_core_extensions/
    // integer.rb) where pattern_id = pattern_code.card_id. ORACLE capture2
    // pattern_cards: all nine code -> card name mappings.
    const spec = findPattern("type");
    const card = { name: "Oracle Junction", typeId: 2, typeName: "RichText" };
    const instance = spec && PatternInstance.tryNew(spec, card);
    expect(instance?.patternCardName).toBe("*type");
    expect(instance?.setName).toBe("RichText+*type");
  });
});
