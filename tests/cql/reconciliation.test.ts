

import { afterEach, describe, expect, it } from "vitest";
import { parseCql } from "../../src/cql/parser.js";
import { absolutizeName, defaultNameToKey } from "../../src/cql/normalize.js";
import { setNameEnvironment } from "../../src/card/name/environment.js";

afterEach(() => setNameEnvironment(undefined));

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

      expect(nameCondition({ name: "_main+_right" }, { context: "A+B" })).toMatchObject({
        values: ["home_page+b"],
      });
    });

    it("_user resolves through the environment session [oracle: session 'Joe Admin' => 'Joe Admin']", () => {
      setNameEnvironment({ mainName: "Home Page", session: "Joe Admin" });
      expect(nameCondition({ name: "_user" }, { context: "A+B" })).toMatchObject({ values: ["joe_admin"] });

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
      ).toMatchObject({ values: ["user"] });
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
