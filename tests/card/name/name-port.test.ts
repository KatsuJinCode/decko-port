

import { afterEach, describe, expect, it } from "vitest";
import { DeckoName, name } from "../../../src/card/name.js";
import {
  pluralize,
  rubyCapitalize,
  rubySucc,
  singularize,
  titleize,
  underscore,
} from "../../../src/card/name/inflect.js";
import { decodeHtmlEntities } from "../../../src/card/name/entities.js";
import {
  NameEnvironment,
  getNameEnvironment,
  setNameEnvironment,
} from "../../../src/card/name/environment.js";

const N = (raw: string): DeckoName => DeckoName.parse(raw);

interface NameCase {
  input: string;
  expected: string;
}
const case_ = (input: string, expected: string): NameCase => ({ input, expected });

const PROBE_ENV: NameEnvironment = {
  session: "Joe User",
  mainName: "MainCard",
  lexicon: {
    name: (id) => ({ 1: "*type", 2: "*email", 5: "Five", 7: "Joe Camper" })[id],

    id: (key) => ({ five: 5, joe_camper: 7 })[key],
  },
  codename: {
    id: (codename) => ({ type: 1, email: 2, password: 3 })[codename],
    name: (codename) =>
      ({ type: "*type", email: "*email", password: "*password" })[codename],
    nameForId: (id) => ({ 1: "*type", 2: "*email", 3: "*password", 5: "company" })[id],
  },
};

const savedEnv = getNameEnvironment();
afterEach(() => {
  DeckoName.bannedCharacters = [];
  setNameEnvironment(savedEnv);
});

describe("Cardname core (cardname-0.20.0 lib/cardname.rb)", () => {

  describe("#s (simple string version; to_s/to_str aliases)", () => {
    it("keeps interior spacing of simple names", () => {
      expect(N("A  B").s).toBe("A  B");
    });

    it("normalizes padding around joints of compound names", () => {

      expect(N("A  +  B").s).toBe("A+B");
    });

    it("strips leading/trailing whitespace", () => {
      expect(N("  C EDT  ").s).toBe("C EDT");
    });
  });

  describe("#key (canonical underscored namespace key)", () => {

    const KEY_TABLE: NameCase[] = [
      case_("Two Words", "two_word"),
      case_("Matthias", "matthias"),
      case_("Book's Cover", "book__cover"),
      case_("A-B", "a_b"),
      case_(" rock&roll ", "rock_roll"),
      case_("First,Second", "first_second"),
      case_("Ünïcödé", "Ünïcödé"),
      case_("don't", "don_t"),
      case_("3rd", "3rd"),
      case_("Mice", "mouse"),
      case_("News", "news"),
      case_("Money", "money"),
      case_("C EDT", "c_edt"),
      case_("MacBook", "mac_book"),
      case_("TwoWords", "two_word"),
      case_("AB", "ab"),
      case_("A::B", "a_b"),
      case_("*self", "*self"),
      case_("A*B", "a*b"),
      case_("", ""),
      case_("A++B", "a++b"),
      case_("Ben&amp;Jerry", "ben_jerry"),
      case_("&#65;", "a"),
      case_("Hello, World!", "hello_world"),
      case_("a1 2b", "a1_2b"),
      case_("5 + 5", "5+5"),
      case_("A  +  B", "a+b"),
      case_(" A+B", "a+b"),
    ];
    it.each(KEY_TABLE.map((c) => [c.input, c.expected]))(
      "key(%j) == %j",
      (input, expected) => {
        expect(N(input).key).toBe(expected);
      },
    );

    it("keeps the original word when singularization is not idempotent", () => {

      expect(N("Matthias").key).toBe("matthias");
    });
  });

  describe("#== (equality is key equality)", () => {
    it("matches names whose keys match", () => {
      expect(N("A+B").equals(N("a+b"))).toBe(true);
      expect(N("a b").equals("a_b")).toBe(true);
      expect(N("A B").equals("a_b")).toBe(true);
      expect(N("75").equals(75)).toBe(true);
      expect(N("A + B").equals(N("A+B"))).toBe(true);
      expect(N("A+B").equals("A+B")).toBe(true);
    });

    it("compares via keys, not raw strings", () => {
      expect(N("a b").equals("a_b")).toBe(true);
      expect(N("A+B").equals("A+C")).toBe(false);
    });
  });

  describe("#[] (name based on part index)", () => {
    it("single index", () => {
      expect(N("A+B+C").get(0).s).toBe("A");
      expect(N("A+B+C").get(-1).s).toBe("C");
      expect(N("+B").get(0).s).toBe("");
      expect(N("A+B+C").get(10).s).toBe("");
    });

    it("start and length window", () => {
      expect(N("A+B+C").get(0, 2).s).toBe("A+B");
    });

    it("inclusive ranges", () => {
      expect(N("A+B+C").getRange(1, 2).s).toBe("B+C");
    });
  });

  describe("#num_parts", () => {
    it("counts joint-separated parts", () => {
      expect(N("A+B").numParts).toBe(2);
      expect(N("A").numParts).toBe(1);
      expect(N("+B").numParts).toBe(2);
    });
  });

  describe("instance cache (class_methods.rb #new)", () => {
    it("returns the same object for the same string", () => {
      expect(N("A+B")).toBe(N("A+B"));
      expect(DeckoName.parse(N("A+B"))).toBe(N("A+B"));
    });

    it("produces frozen value objects", () => {
      expect(Object.isFrozen(N("A"))).toBe(true);
    });
  });
});

describe("Parts (cardname-0.20.0 lib/cardname/parts.rb)", () => {
  describe("#parts", () => {
    it("splits on the joint", () => {
      expect(N("A + B").parts).toEqual(["A", "B"]);
      expect(N("A+B+C").parts).toEqual(["A", "B", "C"]);
      expect(N("+B").parts).toEqual(["", "B"]);
      expect(N("").parts).toEqual([]);
      expect(N("A++B").parts).toEqual(["A", "", "B"]);
    });
  });

  describe("#left / #left_name / #left_key", () => {
    it("left is everything before the rightmost joint", () => {
      expect(N("A").left).toBeUndefined();
      expect(N("A+B+C").left).toBe("A+B");
      expect(N("A+B+C").leftKey).toBe("a+b");
      expect(N("+B").left).toBe("");
    });
  });

  describe("#right / #right_name / #right_key", () => {
    it("right is the last part", () => {
      expect(N("A").right).toBeUndefined();
      expect(N("A+B+C").right).toBe("C");
      expect(N("A+B+C").rightKey).toBe("c");
      expect(N("+B").right).toBe("B");
    });
  });

  describe("#parents / #parent_keys / #parent_names", () => {
    it("returns left and right of compound names", () => {
      expect(N("A").parents).toEqual([]);
      expect(N("A+B+C+D").parents).toEqual(["A+B+C", "D"]);
      expect(N("A+B+C+D").parentKeys).toEqual(["a+b+c", "d"]);
      expect(N("+B").parents).toEqual(["", "B"]);
    });
  });

  describe("#trunk / #trunk_name / #trunk_key", () => {
    it("like left, but self for simple cards", () => {
      expect(N("A").trunk).toBe("A");
      expect(N("A+B+C+D").trunk).toBe("A+B+C");
      expect(N("A+B").trunkKey).toBe("a");
    });
  });

  describe("#tag / #tag_name / #tag_key", () => {
    it("like right, but self for simple cards", () => {
      expect(N("A").tag).toBe("A");
      expect(N("A+B+C+D").tag).toBe("D");
      expect(N("A+B").tagKey).toBe("b");
    });
  });
});

describe("Pieces (cardname-0.20.0 lib/cardname/pieces.rb)", () => {
  it("#pieces lists all implied cards", () => {
    expect(N("A+B+C+D").pieces).toEqual([
      "A", "B", "C", "D", "A+B", "A+B+C", "A+B+C+D",
    ]);
    expect(N("A").pieces).toEqual(["A"]);
  });

  it("#ancestors excludes self", () => {
    expect(N("A+B+C+D").ancestors).toEqual(["A", "B", "C", "D", "A+B", "A+B+C"]);
  });

  it("#piece_names returns names", () => {
    expect(N("A+B").pieceNames.map((p) => p.s)).toEqual(["A", "B", "A+B"]);
  });
});

describe("Predicates (cardname-0.20.0 lib/cardname/predicates.rb)", () => {
  it("#simple? / #compound?", () => {
    expect(N("A").isSimple).toBe(true);
    expect(N("A").isCompound).toBe(false);
    expect(N("A++B").isSimple).toBe(false);
    expect(N("").isSimple).toBe(true);
  });

  it("#valid? with banned characters (banned_array class default is empty)", () => {
    expect(N("A*B").isValid).toBe(true);
    DeckoName.bannedCharacters = ["*"];
    expect(N("A*B").isValid).toBe(false);
  });

  it("#starts_with_joint?", () => {
    expect(N("+A").startsWithJoint).toBe(true);
  });

  describe("#starts_with_parts?", () => {
    it.each([
      ["A+B+C", ["A"], true],
      ["A+B+C", ["A+B"], true],
      ["A+B+C", ["B"], false],
      ["A+B+C", ["A", "B"], true],
      ["A+B", [], true],
    ] as const)("starts_with_parts?(%j, %j) == %j", (input, prefix, expected) => {
      expect(N(input).startsWithParts(...prefix)).toBe(expected);
    });
  });

  describe("#ends_with_parts?", () => {
    it.each([
      ["A+B+C", ["C"], true],
      ["A+B+C", ["B+C"], true],
      ["A+B+C", ["B", "C"], true],
      ["A+B", [], false],
    ] as const)("ends_with_parts?(%j, %j) == %j", (input, suffix, expected) => {
      expect(N(input).endsWithParts(...suffix)).toBe(expected);
    });
  });

  describe("#include?", () => {
    it("detects part chains by key", () => {
      expect(N("A+B+C").includes("B+C")).toBe(true);
      expect(N("A+B+C").includes("a")).toBe(true);
      expect(N("A+B+C").includes("C+D")).toBe(false);
      expect(N("A+B").includes("A+B")).toBe(true);
    });
  });
});

describe("Star predicates (card-1.110.0 lib/card/name.rb)", () => {
  it("#star? (simple name starting with '*')", () => {
    expect(N("*self").isStar).toBe(true);
    expect(N("A").isStar).toBe(false);
    expect(N("A+B").isStar).toBe(false);
  });

  it("#rstar? (right part is a star name)", () => {
    expect(N("A+*right").isRStar).toBe(true);
    expect(N("A+B").isRStar).toBe(false);
    expect(N("*right+*type").isRStar).toBe(true);
  });
});

describe("Variants (cardname-0.20.0 lib/cardname/variants.rb)", () => {
  describe("#url_key", () => {
    it("keeps case, underscores spaces, keeps '*'", () => {
      expect(N("Two Words").urlKey).toBe("Two_Words");
      expect(N("Mar*co+A").urlKey).toBe("Mar*co+A");
      expect(N("What? Is!").urlKey).toBe("What_Is");
      expect(N("A  B").urlKey).toBe("A_B");
      expect(N("tab\tsep").urlKey).toBe("tab_sep");
      expect(N("Ünïcödé").urlKey).toBe("Ünïcödé");
      expect(N("*series+*type").urlKey).toBe("*series+*type");
    });
  });

  describe("#safe_key", () => {
    it("tr's '*' to 'X' and joint to '-'", () => {
      expect(N("A+*B").safeKey).toBe("a-Xb");
      expect(N("A-XB").safeKey).toBe("a_xb");
      expect(N("*series+*type").safeKey).toBe("Xseries-Xtype");
    });
  });

  describe("#decoded", () => {
    it("decodes HTML entities", () => {
      expect(N("Ben &amp; Jerry").decoded).toBe("Ben & Jerry");
      expect(decodeHtmlEntities("&#65;")).toBe("A");
      expect(decodeHtmlEntities("&wibble;")).toBe("&wibble;");
    });

    it("feeds key generation", () => {
      expect(N("Ben&amp;Jerry").key).toBe("ben_jerry");
    });
  });

  describe("#stripped / #fully_stripped", () => {
    it("removes contextual elements", () => {
      expect(N("_left+B").stripped.s).toBe("+B");
      expect(N("_left+B").fullyStripped.s).toBe("B");
      expect(N("+_left+B").fullyStripped.s).toBe("B");
    });
  });
});

describe("Contextual names (cardname-0.20.0 lib/cardname/contextual.rb)", () => {
  describe("#relative? / #simple_relative? / #relative_fragment? / #absolute?", () => {
    it.each([
      ["+A", "isRelative", true],
      ["_left", "isRelative", true],
      ["_left+B", "isRelative", true],
      ["AB", "isRelative", false],
      ["+A", "isSimpleRelative", true],
      ["+A", "isRelativeFragment", false],
      ["_left", "isRelativeFragment", true],
      ["_left+B", "isRelativeFragment", false],
      ["_left", "isAbsolute", false],
    ] as const)("relative family: %j %s == %j", (input, predicate, expected) => {
      expect(N(input)[predicate]).toBe(expected);
    });
  });

  describe("#absolute (relativize resolution)", () => {
    const ABS_TABLE: NameCase2[] = [
      case2_("_self", "C", "C"),
      case2_("_whole", "C+D", "C+D"),
      case2_("_right", "C+D", "D"),
      case2_("_left", "C+D", "C"),
      case2_("_1", "C+D", "C"),
      case2_("_2", "C+D", "D"),
      case2_("_3", "C+D", "C+D"),
      case2_("_LR", "C+D", "C"),
      case2_("_LL", "C+D+E", "C"),
      case2_("_L", "C+D+E", "C+D"),
      case2_("_R", "C+D+E", "E"),
      case2_("_LEFT", "C+D", "C"),
      case2_("_LR+B", "C+D", "C+B"),
      case2_("_self+B", "C", "C+B"),
      case2_("_left+_right", "C+D", "C+D"),
      case2_("+A", "", "+A"),
      case2_("+A", "+A", "+A"),
      case2_("+A", "C+*A", "C+*A+A"),
      case2_("+A", "C", "C+A"),
      case2_("+B", "C", "C+B"),
      case2_("_left+A", "A+B", "A+A"),
    ];
    it.each(ABS_TABLE.map((c) => [c.input, c.context, c.expected]))(
      "absolute(%j in %j) == %j",
      (input, context, expected) => {
        expect(N(input).absolute(context)).toBe(expected);
      },
    );

    it("resolves _user from the session and keeps the part when unset", () => {

      expect(N("_user").absolute("C")).toBe("_user");
      setNameEnvironment({ session: "Joe User" });
      expect(N("_user").absolute("C")).toBe("Joe User");
    });

    it("resolves _main from environment params", () => {
      setNameEnvironment({ mainName: "MainCard" });
      expect(N("_main").absolute("C")).toBe("MainCard");
      expect(N("_main+_self").absolute("C")).toBe("MainCard+C");
    });

    it("oracle-verification pending note: _N and _L*R? branches crash unpatched upstream", () => {

      expect(N("_1").absolute("C+D")).toBe("C");
    });
  });

  describe("#name_from / #from", () => {
    it.each([
      ["A+B+C", "A+B", "+C"],
      ["C", "A+B", "C"],
      ["A+B", "A+B", "A+B"],
      ["A+B", "A", "+B"],
      ["A+B", null, "A+B"],
      ["A+C", "A", "+C"],
    ] as const)("name_from(%j from %j) == %j", (input, from, expected) => {
      expect(N(input).nameFrom(from).s).toBe(expected);
    });

    it("#from returns the string form", () => {
      expect(N("A+B+C").from("A+B")).toBe("+C");
    });
  });

  describe("#nth_left_name", () => {
    it("walks left by part count, with Ruby String#length as the guard", () => {
      expect(N("A+B+C+D").nthLeftName(1).s).toBe("A+B+C");
      expect(N("A+B+C+D").nthLeftName(2).s).toBe("A+B");
      expect(N("A+B+C+D").nthLeftName(4).s).toBe("");
      expect(N("A+B+C+D").nthLeftName(9).s).toBe("A");
    });
  });

  describe("#child_of?", () => {
    it("checks parent keys of the absolutized name", () => {
      expect(N("A+B+_left").childOf("A+B")).toBe(true);
      expect(N("A+B").childOf("A")).toBe(true);
      expect(N("A").childOf("A")).toBe(false);
      expect(N("A+B+C").childOf("A+B")).toBe(true);
    });
  });
});

describe("Fields (cardname-0.20.0 lib/cardname/fields.rb)", () => {
  it("#field / #field_name", () => {
    expect(N("A").field("B")).toBe("A+B");
    expect(N("A").fieldName("+B").s).toBe("A+B");
    expect(N("A").fieldName("B").s).toBe("A+B");
  });

  describe("#field_of?", () => {
    it.each([
      ["A+B", "A", true],
      ["A+B+C", "A+B", true],
      ["+B", "", true],
      ["A", "A", false],
      ["+A", "A", true],
      ["B+A", "A", false],
    ] as const)("field_of?(%j, %j) == %j", (input, context, expected) => {
      expect(N(input).fieldOf(context)).toBe(expected);
    });
  });

  it("#field_only?", () => {
    expect(N("+B").fieldOnly).toBe(true);
    expect(N("+_left+B").fieldOnly).toBe(true);
    expect(N("_left").fieldOnly).toBe(false);
  });

  it("#relative_field_name", () => {
    expect(N("A+B").relativeFieldName("C").s).toBe("+C");
  });
});

describe("Manipulation (cardname-0.20.0 lib/cardname/manipulate.rb)", () => {
  describe("#swap", () => {
    it.each([
      ["A+B+C", "B", "X", "A+X+C"],
      ["A+B+C", "A+B", "X", "X+C"],
      ["A+A+B", "A+B", "X", "A+X"],
      ["A+B+C", "B+C", "X", "A+X"],
      ["A+B+C", "D", "X", "A+B+C"],
      ["AB+AB", "AB", "X", "X+X"],
      ["a+b", "A", "X", "X+b"],
      ["A+A+A", "A+A", "X", "X+A"],
      ["A+B+C", "A+B", "X+Y", "X+Y+C"],
      ["A+B", "B", "X+Y", "A+X+Y"],
    ] as const)("swap(%j, %j -> %j) == %j", (input, oldPart, newPart, expected) => {
      expect(N(input).swap(oldPart, newPart).s).toBe(expected);
    });
  });

  describe("#prepend_joint (to_field)", () => {
    it("adds the joint unless already present", () => {
      expect(N("A").prependJoint).toBe("+A");
      expect(N("+A").prependJoint).toBe("+A");
    });
  });

  describe("#[]= and #<< as pure functions", () => {
    it("withPartAt replaces one part", () => {
      expect(N("A+B+C").withPartAt(1, "X").s).toBe("A+X+C");
    });

    it("append adds a part", () => {
      expect(N("A+B").append("C").s).toBe("A+B+C");
    });
  });

  describe("#sub_in", () => {
    it("substitutes case/inflection variants of the name", () => {
      expect(N("Mouse").subIn("A Mouse here", "Wolf")).toBe("A Wolf here");
      expect(N("mouse").subIn("two mice", "wolf")).toBe("two wolves");
      expect(N("mood").subIn("Moods and mood and moodiness", "face")).toBe(
        "Faces and face and moodiness",
      );
    });
  });
});

describe("NameVariants (card-1.110.0 lib/card/name/name_variants.rb)", () => {
  describe("#vary", () => {
    it.each([
      ["a b", "capitalized", "A b"],
      ["a b", "plural, upcase", "A BS"],
      ["cards", "singular", "card"],
      ["a b", "title", "A B"],
      ["a b", "wibble", "a b"],
    ] as const)("vary(%j, %j) == %j", (input, variants, expected) => {
      expect(N(input).vary(variants).s).toBe(expected);
    });
  });

  describe("#standard", () => {
    it("maps parts to their lexicon-registered names", () => {
      setNameEnvironment(PROBE_ENV);

      expect(name("Five").standard.s).toBe("Five");
      expect(name("five+Joe Camper").standard.s).toBe("Five+Joe Camper");
      expect(N("Nosuch").standard.s).toBe("Nosuch");
    });
  });

  describe("#card_id / #codename / #codename_or_string", () => {
    it("resolves through the lexicon and codename registry", () => {
      setNameEnvironment(PROBE_ENV);
      expect(name("Five").cardId).toBe(5);
      expect(name("Five").codename).toBe("company");
      expect(name("Five").codenameOrString).toBe("company");
      expect(N("Nonexistent").codenameOrString).toBe("Nonexistent");
    });
  });
});

describe("Card::Name construction and marks (card-1.110.0 lib/card/name.rb)", () => {
  describe("Card::Name[...] (from_cardish)", () => {
    it("interprets strings, arrays, nil, integers, and codenames", () => {
      setNameEnvironment(PROBE_ENV);
      expect(name("A+B").s).toBe("A+B");
      expect(name("A+B").key).toBe("a+b");
      expect(name("  A  ").s).toBe("A");
      expect(name(["A", "B"]).s).toBe("A+B");
      expect(name(null).s).toBe("");
      expect(name(5).s).toBe("Five");
      expect(name("~5").s).toBe("Five");
      expect(name(":email").s).toBe("*email");
      expect(name({ codename: "type" }).s).toBe("*type");
    });

    it("normalizes compound strings through the mark-resolving parser", () => {
      setNameEnvironment(PROBE_ENV);
      expect(name("A  +  B").s).toBe("A+B");
    });

    it("raises for unsupported identifiers", () => {
      setNameEnvironment(PROBE_ENV);
      expect(() => name(99)).toThrow("Integer not supported as name identifier");
      expect(() => name("~99")).toThrow("id doesn't exist: 99");
      expect(() => name(":bogus")).toThrow("codename doesn't exist: bogus");
      expect(() => name({ codename: "bogus" })).toThrow("unknown codename: bogus");
    });
  });

  describe("Card::Name.compose", () => {
    it("composes parts interpreting each as cardish", () => {
      setNameEnvironment(PROBE_ENV);
      expect(DeckoName.compose(["A", "*type"]).s).toBe("A+*type");
      expect(DeckoName.compose([5, ":email"]).s).toBe("Five+*email");
    });
  });

  describe("#id_from_string / #id_from_string!", () => {
    it("parses id and codename marks", () => {
      setNameEnvironment(PROBE_ENV);
      expect(DeckoName.idFromString("~7")).toBe(7);
      expect(DeckoName.idFromString(":email")).toBe(2);
      expect(DeckoName.idFromString("plain")).toBeUndefined();
      expect(DeckoName.idFromStringStrict("~7")).toBe(7);
      expect(() => DeckoName.idFromStringStrict("~99")).toThrow("id doesn't exist: 99");
    });
  });
});

describe("Inflection substrate (activesupport via cardname)", () => {
  describe("singularize", () => {
    const SINGULARIZE_TABLE: NameCase[] = [
      case_("words", "word"),
      case_("boxes", "box"),
      case_("mice", "mouse"),
      case_("people", "person"),
      case_("Matthias", "Matthia"),
      case_("Matthia", "Matthium"),
      case_("axes", "axis"),
      case_("buses", "bus"),
      case_("movies", "movie"),
      case_("series", "series"),
      case_("news", "news"),
      case_("oxen", "ox"),
      case_("quizzes", "quiz"),
      case_("aliases", "alias"),
      case_("statuses", "status"),
      case_("crises", "crisis"),
      case_("analyses", "analysis"),
      case_("elves", "elf"),
      case_("wives", "wife"),
      case_("tries", "try"),
      case_("cities", "city"),
      case_("is", "i"),
      case_("gas", "ga"),
      case_("s", ""),
      case_("1980s", "1980"),
      case_("Heroes", "Hero"),
      case_("useless", "useless"),
      case_("cactus", "cactu"),
      case_("5", "5"),
      case_("geese", "geese"),
    ];
    it.each(SINGULARIZE_TABLE.map((c) => [c.input, c.expected]))(
      "singularize(%j) == %j",
      (input, expected) => {
        expect(singularize(input)).toBe(expected);
      },
    );
  });

  describe("pluralize", () => {
    const PLURALIZE_TABLE: NameCase[] = [
      case_("card", "cards"),
      case_("box", "boxes"),
      case_("mouse", "mice"),
      case_("person", "people"),
      case_("man", "men"),
      case_("child", "children"),
      case_("sex", "sexes"),
      case_("move", "moves"),
      case_("zombie", "zombies"),
      case_("quiz", "quizzes"),
      case_("matrix", "matrices"),
      case_("vertex", "vertices"),
      case_("index", "indices"),
      case_("alias", "aliases"),
      case_("status", "statuses"),
      case_("crisis", "crises"),
      case_("analysis", "analyses"),
      case_("elf", "elves"),
      case_("wolf", "wolves"),
      case_("wife", "wives"),
      case_("city", "cities"),
      case_("key", "keys"),
      case_("bus", "buses"),
      case_("gas", "gas"),
      case_("hero", "heros"),
      case_("tomato", "tomatoes"),
      case_("dwarf", "dwarves"),
      case_("wharf", "wharves"),
      case_("census", "census"),
    ];
    it.each(PLURALIZE_TABLE.map((c) => [c.input, c.expected]))(
      "pluralize(%j) == %j",
      (input, expected) => {
        expect(pluralize(input)).toBe(expected);
      },
    );
  });

  describe("underscore", () => {
    const UNDERSCORE_TABLE: NameCase[] = [
      case_("MacBook", "mac_book"),
      case_("HTMLParser", "html_parser"),
      case_("A-B", "a_b"),
      case_("A::B", "a/b"),
      case_("ABRACADABRA", "abracadabra"),
      case_("CamelCase", "camel_case"),
      case_("Dashed-Case", "dashed_case"),
      case_("XYZController", "xyz_controller"),
      case_("apiV2", "api_v2"),
      case_("V2Api", "v2_api"),
      case_("X86", "x86"),
      case_("Straße", "straße"),
      case_("Ünïcödé", "Ünïcödé"),
    ];
    it.each(UNDERSCORE_TABLE.map((c) => [c.input, c.expected]))(
      "underscore(%j) == %j",
      (input, expected) => {
        expect(underscore(input)).toBe(expected);
      },
    );
  });

  describe("String#succ (used by autoname flows)", () => {
    const SUCC_TABLE: NameCase[] = [
      case_("A", "B"),
      case_("az", "ba"),
      case_("Z", "AA"),
      case_("zz", "aaa"),
      case_("A9", "B0"),
      case_("Name 1", "Name 2"),
      case_("Name 9", "Name 10"),
      case_("1999", "2000"),
      case_("*self", "*selg"),
      case_("zzz99", "aaaa00"),
      case_("Name 99", "Name 100"),
      case_("zz9", "aaa0"),
      case_("a b", "a c"),
      case_(" thing ", " thinh "),
      case_("+", ","),
      case_("x.", "y."),
    ];
    it.each(SUCC_TABLE.map((c) => [c.input, c.expected]))(
      "succ(%j) == %j",
      (input, expected) => {
        expect(rubySucc(input)).toBe(expected);
      },
    );

    it("DeckoName#succ returns a name", () => {
      expect(N("A").succ().s).toBe("B");
      expect(N("A+B").succ().s).toBe("A+C");
    });
  });

  describe("String#capitalize / titleize (used by vary and sub_in)", () => {
    const CAPITALIZE_TABLE: NameCase[] = [
      case_("two words", "Two words"),
      case_("TWO WORDS", "Two words"),
      case_("a", "A"),
      case_("x-y", "X-y"),
    ];
    it.each(CAPITALIZE_TABLE.map((c) => [c.input, c.expected]))(
      "capitalize(%j) == %j",
      (input, expected) => {
        expect(rubyCapitalize(input)).toBe(expected);
      },
    );

    const TITLEIZE_TABLE: NameCase[] = [
      case_("two words", "Two Words"),
      case_("x-y", "X Y"),
      case_("under_score", "Under Score"),
      case_("already Capitalized", "Already Capitalized"),
    ];
    it.each(TITLEIZE_TABLE.map((c) => [c.input, c.expected]))(
      "titleize(%j) == %j",
      (input, expected) => {
        expect(titleize(input)).toBe(expected);
      },
    );
  });
});

interface NameCase2 {
  input: string;
  context: string;
  expected: string;
}
function case2_(input: string, context: string, expected: string): NameCase2 {
  return { input, context, expected };
}
