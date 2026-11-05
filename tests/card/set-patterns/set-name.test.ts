

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

import "./oracle-environment.js";

describe("parseSetName (set/type/set.rb)", () => {
  it("parses an anchorless set: the pattern card is the set itself", () => {

    const parsed = parseSetName("*all");
    expect(parsed.anchored).toBe(false);
    expect(parsed.patternCardName.s).toBe("*all");
    expect(parsed.anchorName).toBeNull();
    expect(parsed.patternCode).toBe("all");
    expect(parsed.spec?.code).toBe("all");
  });

  it("parses a type set: tag is the pattern card, trunk is the anchor", () => {

    const parsed = parseSetName("RichText+*type");
    expect(parsed.anchored).toBe(true);
    expect(parsed.patternCardName.s).toBe("*type");
    expect(parsed.anchorName?.s).toBe("RichText");
    expect(parsed.patternCode).toBe("type");
  });

  it("parses a right set", () => {

    const parsed = parseSetName("child_one+*right");
    expect(parsed.patternCode).toBe("right");
    expect(parsed.anchorName?.s).toBe("child_one");
  });

  it("parses a three-part type plus right set: anchor keeps both head parts", () => {

    const parsed = parseSetName("RichText+child_one+*type plus right");
    expect(parsed.patternCode).toBe("type_plus_right");
    expect(parsed.anchorName?.s).toBe("RichText+child_one");
  });

  it("parses a self set", () => {

    const parsed = parseSetName("Oracle Junction+*self");
    expect(parsed.patternCode).toBe("self");
    expect(parsed.anchorName?.s).toBe("Oracle Junction");
  });

  it("parses every anchorless pattern set through the same simple-name path", () => {

    for (const name of ["*star", "*rstar", "*rule", "*all plus"]) {
      const parsed = parseSetName(name);
      expect(parsed.anchored, name).toBe(false);
      expect(parsed.anchorName, name).toBeNull();
      expect(parsed.spec?.patternCardName, name).toBe(name);
    }
  });

  it("resolves the pattern code through the codename registry (subclass_for_set)", () => {

    const parsed = parseSetName("RichText+*type");
    expect(parsed.patternCode).toBe("type");
    expect(parsed.spec?.patternCardName).toBe("*type");
  });

  it("yields a null code and no spec for a tag without a codename", () => {

    const parsed = parseSetName("SomeTag+*right");

    expect(parsed.spec?.code).toBe("right");
    const unknown = parseSetName("RichText+*not a pattern");
    expect(unknown.patternCode).toBeNull();
    expect(unknown.spec).toBeUndefined();
  });
});

describe("parsed set labels (set/type/set.rb#label)", () => {
  it("labels a set through its pattern class and anchor", () => {

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

    expect(labelForParsedSet(parseSetName("RichText+*not a pattern"))).toBe("");
  });

  it("uncapitalized_label always returns the empty string (upstream bug)", () => {

    expect(uncapitalizedLabelForParsedSet(parseSetName("*all"))).toBe("");
    expect(uncapitalizedLabelForParsedSet(parseSetName("RichText+*type"))).toBe("");
  });
});

describe("compound_only? through the parsed set (set/type/set.rb#compound_only?)", () => {
  it("reflects the pattern's compound_only option", () => {

    expect(compoundOnlyForParsedSet(parseSetName("*rstar"))).toBe(true);
    expect(compoundOnlyForParsedSet(parseSetName("child_one+*right"))).toBe(true);
    expect(compoundOnlyForParsedSet(parseSetName("RichText+child_one+*type plus right"))).toBe(true);
    expect(compoundOnlyForParsedSet(parseSetName("*all"))).toBe(false);
    expect(compoundOnlyForParsedSet(parseSetName("RichText+*type"))).toBe(false);
    expect(compoundOnlyForParsedSet(parseSetName("Oracle Junction+*self"))).toBe(false);
  });

  it("returns null when no pattern matches (Ruby raises on nil subclass)", () => {

    expect(compoundOnlyForParsedSet(parseSetName("RichText+*not a pattern"))).toBeNull();
  });
});

describe("rule_cache_key_base (set/type/set.rb#rule_cache_key_base)", () => {
  it("builds '<left id>+<pattern code>' for compound sets", () => {

    expect(ruleCacheKeyBaseForParsedSet(parseSetName("RichText+*type"))).toBe("2+type");
  });

  it("builds the bare codename for anchorless sets", () => {

    expect(ruleCacheKeyBaseForParsedSet(parseSetName("*all"))).toBe("all");
  });

  it("yields undefined where Ruby would produce a nil-derived partial string", () => {

    expect(ruleCacheKeyBaseForParsedSet(parseSetName("RichText+child_one+*type plus right"))).toBeUndefined();
  });
});

describe("pattern card names resolve through the registry (Base#pattern)", () => {
  it("PatternInstance.patternCardName prefers the lexicon name for the codename id", () => {

    const spec = findPattern("type");
    const card = { name: "Oracle Junction", typeId: 2, typeName: "RichText" };
    const instance = spec && PatternInstance.tryNew(spec, card);
    expect(instance?.patternCardName).toBe("*type");
    expect(instance?.setName).toBe("RichText+*type");
  });
});
