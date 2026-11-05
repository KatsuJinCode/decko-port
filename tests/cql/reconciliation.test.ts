/**
 * CQL <-> card/name stream reconciliation tests.
 *
 * Closes the documented seam between wave-1 CQL (docs/cql-port-notes.md) and
 * the landed name algebra (docs/name-port-notes.md):
 * 1. name -> key goes through the REAL DeckoName.key semantics (ActiveSupport
 *    singularize inflection included), replacing the no-inflection
 *    approximation of the old defaultNameToKey.
 * 2. relative-name absolutization delegates to DeckoName.absolute (port of
 *    cardname lib/cardname/contextual.rb#absolute), covering _main/_user/_L*R
 *    and the absolutize_extremes guard that the CQL-side approximation lacked.
 *
 * Oracle basis (live `ruby -e` against the installed gems, per the preload
 * trick in docs/name-port-notes.md — `require "active_support/all";
 * require "htmlentities"; require "cardname";` plus
 * cardname-0.20.0/lib/core_ext.rb, with `Cardname.params = {}` to emulate the
 * app context where `Card::Name.params` is overridden to `Card::Env.params`,
 * card-1.110.0 lib/card/name.rb#params):
 *
 *   "Magnus".to_name.key            => "magnu"
 *   "Admins".to_name.key            => "admin"
 *   "Octopi".to_name.key            => "octopus"
 *   "Joe Admin+*self".to_name.key   => "joe_admin+*self"
 *   "A &amp; B".to_name.key         => "a_b"
 *   "_user".to_name.key             => "user"        (session unset)
 *   "_self".absolute("A+B+C")       => "A+B+C"
 *   "_left".absolute("A+B+C")       => "A+B"          (trunk)
 *   "_right".absolute("A+B+C")      => "C"            (tag)
 *   "_left+_right".absolute("A+B+C")=> "A+B+C"
 *   "_left +_right".absolute("A+B") => "A+B"          (joint whitespace)
 *   "_SELF".absolute("A+B")         => "A+B"          (/i branches)
 *   "_Left".absolute("A+B")         => "A"
 *   "_main".absolute("A+B")         => "A+B"  (main_name unset -> "" part ->
 *                                              absolutize_extremes fills with
 *                                              the context)
 *   "_main".absolute("A+B") with params {main_name: "Home Page"} => "Home Page"
 *   "_user".absolute("A+B") with session "Joe Admin"             => "Joe Admin"
 *   "_user+_left".absolute("A+B")   => "Joe Admin+A"
 *   "_main+_right".absolute("A+B")  => "Home Page+B"
 *
 * _N ordinals and _L*R partmaps crash the UNPATCHED cardname 0.20.0 gem
 * ($LAST_MATCH_INFO is nil in the case/when dispatch — docs/name-port-notes.md
 * upstream bug 1), so their values were oracle-verified by probing the gem's
 * own private methods directly (no dispatch involved):
 *
 *   "A+B+C".to_name.send(:ordinal_part, 2, ctx)   => "B"
 *   "A+B+C".to_name.send(:ordinal_part, 4, ctx)   => nil  (string-length clamp)
 *   "A+B+C".to_name.send(:partmap_part, /_LR/ match, ctx) => "B"
 *   "A+B+C".to_name.send(:partmap_part, /_LLR/ match, ctx) => "A"
 *
 * An ordinal that misses the context parts resolves to "" and a blank extreme
 * part then falls back to the context (absolutize_extremes) — the same chain
 * the live _main row above demonstrates.
 */

import { afterEach, describe, expect, it } from "vitest";
import { parseCql } from "../../src/cql/parser.js";
import { absolutizeName, defaultNameToKey } from "../../src/cql/normalize.js";
import { setNameEnvironment } from "../../src/card/name/environment.js";

/** The name environment is process-global; every test starts clean. */
afterEach(() => setNameEnvironment(undefined));

/** name-condition values are key-ified (Value#standard_sql), so most
 *  assertions read the condition's `values` after a full parseCql round. */
function nameCondition(statement: unknown, options = {}) {
  const root = parseCql(statement, options);
  return root.conditions[0];
}

describe("name -> key through the real inflections (ParseOptions.nameToKey default wired to DeckoName.key)", () => {
  it("singularizes: Magnus -> magnu [oracle: 'Magnus'.to_name.key => 'magnu']", () => {
    expect(defaultNameToKey("Magnus")).toBe("magnu");
    expect(nameCondition({ name: "Magnus" })).toMatchObject({
      kind: "value",
      field: "key",
      op: "=",
      values: ["magnu"],
    });
  });

  it("plural forms take the singular key [oracle: 'Admins' => 'admin', 'Octopi' => 'octopus']", () => {
    expect(defaultNameToKey("Admins")).toBe("admin");
    expect(defaultNameToKey("Octopi")).toBe("octopus");
  });

  it("key-ifies every value of an in-list (value.rb#standard_sql)", () => {
    expect(nameCondition({ name: ["in", "Admins", "Joe Admin"] })).toMatchObject({
      values: ["admin", "joe_admin"],
    });
  });

  it("compound and star names key per part [oracle: 'Joe Admin+*self' => 'joe_admin+*self']", () => {
    expect(defaultNameToKey("Joe Admin+*self")).toBe("joe_admin+*self");
  });

  it("decodes HTML entities before keying [oracle: 'A &amp; B' => 'a_b']", () => {
    expect(defaultNameToKey("A &amp; B")).toBe("a_b");
  });

  it("strips surrounding whitespace [oracle: '  Joe Admin  ' => 'joe_admin']", () => {
    expect(defaultNameToKey("  Joe Admin  ")).toBe("joe_admin");
  });

  it("match exact-name term keys through the same path (match_value.rb#exact_name_match:25)", () => {
    expect(nameCondition({ name: ["~", "=Magnus"] })).toMatchObject({
      kind: "match",
      prefix: "=",
      term: "Magnus",
      termKey: "magnu",
    });
  });

  it("complete keys its LIKE prefix (match_attributes.rb#complete:26)", () => {
    // complete also adds the key IS NOT NULL condition (name_not_null)
    const like = parseCql({ complete: "Magnus" }).conditions.find((c) => c.kind === "like");
    expect(like).toMatchObject({ kind: "like", field: "key", value: "magnu" });
  });

  it("the ParseOptions.nameToKey injection point still overrides the default", () => {
    expect(
      nameCondition({ name: "Admins" }, { nameToKey: (n: string) => n.toLowerCase() }),
    ).toMatchObject({ values: ["admins"] });
  });

  it("non-name fields are not key-ified", () => {
    expect(nameCondition({ content: "Magnus" })).toMatchObject({ field: "db_content", values: ["Magnus"] });
  });
});

describe("relative-name absolutization via DeckoName.absolute (contextual.rb#absolute)", () => {
  describe("with a context", () => {
    it("_self/_whole/_ become the context", () => {
      expect(nameCondition({ name: "_self" }, { context: "A+B" })).toMatchObject({ values: ["a+b"] });
      expect(nameCondition({ name: "_whole" }, { context: "A+B" })).toMatchObject({ values: ["a+b"] });
    });

    it("_left resolves to the context trunk [oracle: 'A+B+C'] ", () => {
      expect(absolutizeName("_left", "A+B+C")).toBe("A+B");
      expect(nameCondition({ name: "_left" }, { context: "A+B+C" })).toMatchObject({ values: ["a+b"] });
    });

    it("_right resolves to the context tag [oracle: 'A+B+C' => 'C']", () => {
      expect(absolutizeName("_right", "A+B+C")).toBe("C");
      expect(nameCondition({ name: "_right" }, { context: "A+B+C" })).toMatchObject({ values: ["c"] });
    });

    it("_N ordinal resolves by part position [oracle: ordinal_part(2, A+B+C) => 'B', private probe]", () => {
      expect(nameCondition({ name: "_2" }, { context: "A+B+C" })).toMatchObject({ values: ["b"] });
    });

    it("_N past the parts resolves to '' and the blank extreme falls back to the context", () => {
      // oracle: ordinal_part(4, "A+B+C") => nil (string-length clamp quirk,
      // docs/name-port-notes.md); "" extreme -> absolutize_extremes fills the
      // context — the same chain the live _main row demonstrates.
      expect(nameCondition({ name: "_4" }, { context: "A+B+C" })).toMatchObject({ values: ["a+b+c"] });
    });

    it("_L*R partmaps navigate ordinals [oracle: partmap_part(_LR) => 'B', partmap_part(_LLR) => 'A', private probes]", () => {
      expect(nameCondition({ name: "_LR" }, { context: "A+B+C" })).toMatchObject({ values: ["b"] });
      expect(nameCondition({ name: "_LLR" }, { context: "A+B+C" })).toMatchObject({ values: ["a"] });
    });

    it("forms are case-insensitive [oracle: '_SELF' => 'A+B', '_Left' => 'A']", () => {
      expect(nameCondition({ name: "_SELF" }, { context: "A+B" })).toMatchObject({ values: ["a+b"] });
      expect(nameCondition({ name: "_Left" }, { context: "A+B" })).toMatchObject({ values: ["a"] });
    });

    it("joint whitespace around parts is tolerated [oracle: '_left +_right' with A+B => 'A+B']", () => {
      expect(nameCondition({ name: "_left +_right" }, { context: "A+B" })).toMatchObject({ values: ["a+b"] });
    });

    it("_main resolves through the environment main name [oracle: params {main_name: 'Home Page'} => 'Home Page']", () => {
      setNameEnvironment({ mainName: "Home Page", session: "Joe Admin" });
      expect(nameCondition({ name: "_main" }, { context: "A+B" })).toMatchObject({ values: ["home_page"] });
      // oracle: '_main+_right'.absolute('A+B') => 'Home Page+B'
      expect(nameCondition({ name: "_main+_right" }, { context: "A+B" })).toMatchObject({
        values: ["home_page+b"],
      });
    });

    it("_user resolves through the environment session [oracle: session 'Joe Admin' => 'Joe Admin']", () => {
      setNameEnvironment({ mainName: "Home Page", session: "Joe Admin" });
      expect(nameCondition({ name: "_user" }, { context: "A+B" })).toMatchObject({ values: ["joe_admin"] });
      // oracle: '_user+_left'.absolute('A+B') => 'Joe Admin+A'
      expect(nameCondition({ name: "_user+_left" }, { context: "A+B" })).toMatchObject({
        values: ["joe_admin+a"],
      });
    });

    it("_main with no main name fills the blank extreme with the context [oracle: '_main'.absolute('A+B') => 'A+B']", () => {
      expect(absolutizeName("_main", "A+B")).toBe("A+B");
      expect(nameCondition({ name: "_main" }, { context: "A+B" })).toMatchObject({ values: ["a+b"] });
    });

    it("the statement's own context key wins (AbstractQuery#init_instance_vars :context)", () => {
      expect(nameCondition({ context: "X+Y", name: "_self" })).toMatchObject({ values: ["x+y"] });
    });

    it("subqueries inherit the superquery context (AbstractQuery#context, abstract_query.rb:73)", () => {
      const root = parseCql({ any: [{ name: "_right" }], context: "A+B+C" });
      const sub = root.subqueries[0];
      expect(sub?.context).toBe("A+B+C");
      expect(sub?.conditions[0]).toMatchObject({ values: ["c"] });
    });

    it("names without relative parts pass through untouched (normalization.rb /\\b_/ gate)", () => {
      // oracle: 'get_user_name'.to_name.key => 'get_user_name'
      expect(defaultNameToKey("get_user_name")).toBe("get_user_name");
    });
  });

  describe("without a context (Ruby resolves against '' — port warns instead of failing)", () => {
    it("_left against an empty context yields '' and warns", () => {
      const warnings: string[] = [];
      expect(nameCondition({ name: "_left" }, { onWarning: (w: string) => warnings.push(w) })).toMatchObject({
        values: [""],
      });
      expect(warnings.join("\n")).toMatch(/empty context/);
    });

    it("_self against an empty context yields '' and warns", () => {
      const warnings: string[] = [];
      expect(
        nameCondition({ name: "_self" }, { onWarning: (w: string) => warnings.push(w) }),
      ).toMatchObject({ values: [""] });
      expect(warnings.join("\n")).toMatch(/empty context/);
    });

    it("_user with no session stays relative and warns [oracle: '_user'.absolute('') => '_user']", () => {
      const warnings: string[] = [];
      expect(
        nameCondition({ name: "_user" }, { onWarning: (w: string) => warnings.push(w) }),
      ).toMatchObject({ values: ["user"] }); // oracle: '_user'.to_name.key => 'user'
      expect(warnings.join("\n")).toMatch(/_user/);
    });

    it("_main with no main name and no context yields '' and warns", () => {
      const warnings: string[] = [];
      expect(
        nameCondition({ name: "_main" }, { onWarning: (w: string) => warnings.push(w) }),
      ).toMatchObject({ values: [""] });
      expect(warnings.join("\n")).toMatch(/_main/);
    });

    it("no warnings when every part resolves (context present, environment set)", () => {
      setNameEnvironment({ mainName: "Home", session: "Joe Admin" });
      const warnings: string[] = [];
      expect(
        nameCondition({ name: "_left +_user" }, { context: "A+B", onWarning: (w: string) => warnings.push(w) }),
      ).toMatchObject({ values: ["a+joe_admin"] });
      expect(warnings).toEqual([]);
    });

    it("plain names never warn", () => {
      const warnings: string[] = [];
      expect(
        nameCondition({ name: "Joe Admin" }, { onWarning: (w: string) => warnings.push(w) }),
      ).toMatchObject({ values: ["joe_admin"] });
      expect(warnings).toEqual([]);
    });
  });
});
