/**
 * Parser (interpretation) tests: CQL statement -> QueryNode AST.
 *
 * Every case cites the card-1.110.0 method whose behavior it pins. Cases
 * marked [oracle] were verified against the real Ruby code loaded standalone;
 * others are source-derived (cite given per case).
 */

import { describe, expect, it } from "vitest";
import { parseCql } from "../../src/cql/parser.js";

describe("clause normalization (Normalization#clause_to_hash)", () => {
  it("integer shorthand becomes an id clause", () => {
    const ast = parseCql(5);
    expect(ast.conditions[0]).toEqual({ kind: "value", field: "id", op: "=", values: [5] });
  });

  it("string shorthand resolves through the card resolver, else -2 [oracle]", () => {
    // oracle: not: "Foo" -> LEFT JOIN ... c1.id = '-2'
    const unresolved = parseCql("Foo");
    expect(unresolved.conditions[0]).toMatchObject({ kind: "value", op: "=", values: [-2] });
    const resolved = parseCql("Foo", { resolveCardId: () => 42 });
    expect(resolved.conditions[0]).toMatchObject({ kind: "value", op: "=", values: [42] });
  });

  it("rejects non-clause statements [Normalization#clause_to_hash]", () => {
    expect(() => parseCql(3.5)).toThrow(/Invalid clause/);
    expect(() => parseCql(["a"])).toThrow(/Invalid clause/);
  });

  it("root context and vars are consumed before interpretation [AbstractQuery#init_instance_vars]", () => {
    const ast = parseCql({ name: "$who", context: "A+B", vars: { who: "Joe Admin" } });
    expect(ast.context).toBe("A+B");
    expect(ast.conditions[0]).toMatchObject({ kind: "value", values: ["joe_admin"] });
    // vars/context never become conditions
    expect(ast.conditions).toHaveLength(1);
  });

  it("$var values are stringified and stripped [Normalization#string_value_from_var] [oracle]", () => {
    const ast = parseCql({ name: "$who" }, { vars: { who: " Joe Admin " } });
    expect(ast.conditions[0]).toMatchObject({ values: ["joe_admin"] });
  });

  it("missing vars resolve to empty string (nil.to_s.strip)", () => {
    const ast = parseCql({ name: "$who" });
    expect(ast.conditions[0]).toMatchObject({ values: [""] });
  });

  it("relative names absolutize against the context [Cardname::Contextual#absolute]", () => {
    expect(parseCql({ name: "_self" }, { context: "A+B" }).conditions[0]).toMatchObject({
      values: ["a+b"],
    });
    expect(parseCql({ name: "_left" }, { context: "A+B" }).conditions[0]).toMatchObject({
      values: ["a"],
    });
    expect(parseCql({ name: "_right" }, { context: "A+B" }).conditions[0]).toMatchObject({
      values: ["b"],
    });
    expect(parseCql({ name: "_1" }, { context: "A+B" }).conditions[0]).toMatchObject({
      values: ["a"],
    });
    // no context -> empty (oracle: name: "_left" -> c0.key = '')
    expect(parseCql({ name: "_left" }).conditions[0]).toMatchObject({ values: [""] });
  });

  it("return values skip normalization [Normalization#normalize_clause]", () => {
    const ast = parseCql({ id: 5, return: "$raw" });
    expect(ast.mods.return).toBe("$raw");
  });
});

describe("table aliases (QueryHelper#table_alias)", () => {
  it("root alias is c0 [oracle]", () => {
    expect(parseCql({ id: 5 }).tableAlias).toBe("c0");
  });

  it("subqueries take sequential aliases from a shared counter [oracle]", () => {
    // oracle: editor_of: "Joe" -> cx1 / cn2 / c3 (nested, one shared seq)
    const ast = parseCql({ editor_of: "Joe" });
    expect(ast.subqueries.map((s) => s.tableAlias)).toEqual(["cx1"]);
    expect(ast.subqueries[0].subqueries.map((s) => s.tableAlias)).toEqual(["cn2"]);
    expect(ast.subqueries[0].subqueries[0].subqueries.map((s) => s.tableAlias)).toEqual(["c3"]);
  });

  it("direct subqueries share the superquery alias [oracle]", () => {
    // oracle: any: [{type: "User"}] -> conditions on c0
    const ast = parseCql({ any: [{ type: "User" }] });
    expect(ast.subqueries[0].fasten).toBe("direct");
    expect(ast.subqueries[0].tableAlias).toBe("c0");
  });
});

describe("basic attributes (Interpretation INTERPRET_METHOD[:basic])", () => {
  it("maps all basic fields as value conditions", () => {
    const ast = parseCql({
      id: 5,
      key: "k",
      type_id: 1,
      content: "c",
      left_id: 2,
      right_id: 3,
      codename: "type",
      read_rule_id: 4,
      created_at: "2020",
      updated_at: "2021",
      creator_id: 6,
      updater_id: 7,
    });
    expect(ast.conditions).toHaveLength(12);
    expect(ast.conditions.map((c) => (c.kind === "value" ? c.field : ""))).toEqual([
      "id",
      "key",
      "type_id",
      "db_content",
      "left_id",
      "right_id",
      "codename",
      "read_rule_id",
      "created_at",
      "updated_at",
      "creator_id",
      "updater_id",
    ]);
  });
});

describe("conjunctions (CardQuery::Conjunctions)", () => {
  it("any builds an OR group of direct subquery conditions [oracle]", () => {
    const ast = parseCql({ any: [{ type: "User" }, { created_by: "Joe" }] });
    expect(ast.subqueries).toHaveLength(1);
    expect(ast.subqueries[0].conj).toBe("or");
    expect(ast.subqueries[0].conditions).toHaveLength(2);
  });

  it("all/and build AND groups; hash values expand per key [oracle]", () => {
    // oracle: and: {right_plus: "B"} -> (c0.type_id = '-999' AND c1.right_id = '-999') for
    // {type: "A", and: {right_plus: "B"}}
    const ast = parseCql({ all: { type: "A", created_by: "Joe" } });
    expect(ast.subqueries[0].conj).toBe("and");
    expect(ast.subqueries[0].conditions).toHaveLength(2);
  });

  it("multi-value relational lists shift a leading conjunction into a group [Interpretation#relate_multi_value] [oracle]", () => {
    // oracle: type: ["or", "A", "B"] -> (c0.type_id = '-999' OR c0.type_id = '-999')
    // via a :direct subcondition group sharing the root alias
    const ast = parseCql({ type: ["or", "A", "B"] });
    expect(ast.subqueries[0].conj).toBe("or");
    expect(ast.subqueries[0].conditions).toHaveLength(2);
  });

  it("multi-value lists without a conjunction AND flat [Interpretation#relate_multi_value] [oracle]", () => {
    // same conjunction as the container -> flat, no subcondition
    const ast = parseCql({ type: ["A", "B"] });
    expect(ast.conditions).toHaveLength(2);
    expect(ast.subqueries).toHaveLength(0);
  });

  it("bare in: key is intercepted as a content operator [Interpretation#interpret_as_content?] [oracle]", () => {
    // oracle: in: [{type: "A"}] -> BadQuery Invalid property value
    expect(() => parseCql({ in: [{ type: "A" }] })).toThrow(/Invalid property value/);
  });

  it("conj modifier sets the effective conjunction", () => {
    const ast = parseCql({ id: 5, name: "x", conj: "or" });
    expect(ast.conj).toBe("or");
  });
});

describe("restrict-able relations (Tie#restrict, Tie#id_from_val)", () => {
  it("strings resolve via the card resolver, else -999 [oracle]", () => {
    expect(parseCql({ type: "User" }).conditions[0]).toMatchObject({
      kind: "value",
      field: "type_id",
      values: [-999],
    });
    expect(
      parseCql({ type: "User" }, { resolveCardId: (n) => (n === "User" ? 3 : undefined) })
        .conditions[0],
    ).toMatchObject({ values: [3] });
  });

  it("hash values tie a card subquery on the id field [oracle]", () => {
    // oracle: type: {codename: "type"} -> JOIN cards c1 ON c0.type_id = c1.id
    const ast = parseCql({ type: { codename: "type" } });
    expect(ast.joins).toHaveLength(1);
    expect(ast.joins[0]).toMatchObject({
      fromAlias: "c0",
      fromField: "type_id",
      toTable: "cards",
      toAlias: "c1",
      toField: "id",
    });
    expect(ast.subqueries[0].conditions[0]).toMatchObject({ field: "codename", values: ["type"] });
  });

  it("part expands to any(left, right) [RelationalAttributes#part] [oracle]", () => {
    const ast = parseCql({ part: 5 });
    expect(ast.subqueries[0].conj).toBe("or");
    expect(ast.subqueries[0].conditions).toHaveLength(2);
  });
});

describe("plus relational (RelationalAttributes#junction)", () => {
  it("right_plus ties a junction subquery on left_id [oracle]", () => {
    // oracle: right_plus: [{codename: "point"}, {type: "Number"}] ->
    //   JOIN cards c1 ON c0.id = c1.left_id / (c1.type_id = '-999' AND c2.codename = 'point')
    const ast = parseCql({ right_plus: [{ codename: "point" }, { type: "Number" }] });
    expect(ast.joins[0]).toMatchObject({ fromField: "id", toField: "left_id", toAlias: "c1" });
    expect(ast.subqueries[0].conditions[0]).toMatchObject({ field: "type_id" });
    expect(ast.subqueries[0].subqueries[0].conditions[0]).toMatchObject({
      field: "codename",
      values: ["point"],
    });
  });

  it("left_plus ties on right_id [oracle]", () => {
    const ast = parseCql({ left_plus: "*x" });
    expect(ast.joins[0].toField).toBe("right_id");
    expect(ast.subqueries[0].conditions[0]).toMatchObject({ field: "left_id" });
  });

  it("the junction part wins when the junction clause reuses the side key [oracle]", () => {
    // oracle: right_plus: ["A", {right: "B"}] -> only c1.right_id = '-999' ("A" overwrote "B")
    const ast = parseCql({ right_plus: ["A", { right: "B" }] });
    const sub = ast.subqueries[0];
    expect(sub.conditions).toHaveLength(1);
    expect(sub.conditions[0]).toMatchObject({ field: "right_id" });
  });
});

describe("editor/act chains (RelationalAttributes + ActQuery/ActionQuery)", () => {
  it("edited_by chains action -> act -> card [oracle]", () => {
    // oracle: edited_by: "Joe" -> cn1 / cx2 / c3 (nested subqueries)
    const ast = parseCql({ edited_by: "Joe" });
    expect(ast.subqueries.map((s) => [s.kind, s.tableAlias])).toEqual([["action", "cn1"]]);
    expect(ast.subqueries[0].subqueries.map((s) => [s.kind, s.tableAlias])).toEqual([
      ["act", "cx2"],
    ]);
    expect(ast.subqueries[0].subqueries[0].subqueries.map((s) => [s.kind, s.tableAlias])).toEqual([
      ["card", "c3"],
    ]);
    expect(ast.subqueries[0].table).toBe("card_actions");
    expect(ast.subqueries[0].subqueries[0].table).toBe("card_acts");
  });

  it("editor_of chains act -> action -> card [oracle]", () => {
    const ast = parseCql({ editor_of: "Joe" });
    expect(ast.subqueries.map((s) => [s.kind, s.tableAlias])).toEqual([["act", "cx1"]]);
    expect(ast.subqueries[0].subqueries.map((s) => [s.kind, s.tableAlias])).toEqual([
      ["action", "cn2"],
    ]);
    expect(ast.subqueries[0].subqueries[0].subqueries.map((s) => [s.kind, s.tableAlias])).toEqual([
      ["card", "c3"],
    ]);
  });

  it("updated_by adds action_type = 1 [ActionQuery#add_update_condition] [oracle]", () => {
    const ast = parseCql({ updated_by: "Joe" });
    expect(ast.subqueries[0].conditions[0]).toEqual({
      kind: "raw",
      sql: "cn1.action_type = 1",
    });
  });

  it("updater_of adds action_type = 1 on the action subquery [oracle]", () => {
    const ast = parseCql({ updater_of: "Joe" });
    expect(
      ast.subqueries[0].subqueries[0].conditions.some(
        (c) => c.kind === "raw" && c.sql.includes("action_type = 1"),
      ),
    ).toBe(true);
  });
});

describe("references (ReferenceAttributes#define_reference_method, ReferenceQuery)", () => {
  it("refer_to ties card_references on referer_id with L+I reftypes [oracle]", () => {
    // oracle: refer_to: "A" -> JOIN card_references cr1 ON c0.id = cr1.referer_id /
    //   (cr1.ref_type IN ('L','I') AND cr1.referee_id = -999)
    const ast = parseCql({ refer_to: "A" });
    expect(ast.joins[0]).toMatchObject({
      toTable: "card_references",
      toAlias: "cr1",
      fromField: "id",
      toField: "referer_id",
    });
    expect(ast.subqueries[0].conditions[0]).toEqual({
      kind: "value",
      field: "ref_type",
      op: "IN",
      values: ["L", "I"],
    });
    expect(ast.subqueries[0].conditions[1]).toMatchObject({ field: "referee_id", values: [-999] });
  });

  it("link_to restricts to L reftype [oracle]", () => {
    const ast = parseCql({ link_to: "A" });
    expect(ast.subqueries[0].conditions[0]).toEqual({
      kind: "value",
      field: "ref_type",
      op: "=",
      values: ["L"],
    });
  });

  it("referred_to_by flips the tie to referee_id [oracle]", () => {
    const ast = parseCql({ referred_to_by: { right: "A" } });
    expect(ast.joins[0].toField).toBe("referee_id");
    // the card subquery hangs off referer_id and interprets right: "A"
    expect(ast.subqueries[0].subqueries[0].conditions[0]).toMatchObject({ field: "right_id" });
  });

  it("id lists OR-optimized into a single reference join [Interpretation#as_list_of_ids?] [oracle]", () => {
    // oracle: refer_to: ["or", 5, 6] -> one cr1 join, cr1.referee_id in (5, 6)
    const ast = parseCql({ refer_to: ["or", 5, 6] });
    expect(ast.joins).toHaveLength(1);
    expect(ast.subqueries[0].conditions[1]).toEqual({
      kind: "value",
      field: "referee_id",
      op: "in",
      values: [5, 6],
    });
  });

  it("AND id lists create one join per value [oracle]", () => {
    const ast = parseCql({ refer_to: [5, 6] });
    expect(ast.joins).toHaveLength(2);
    expect(ast.subqueries).toHaveLength(2);
  });

  it("member_of expands to referred_to_by with the members codename [ReferenceAttributes#member_of] [oracle]", () => {
    const ast = parseCql({ member_of: "A" });
    expect(ast.joins[0].toTable).toBe("card_references");
    // right: {codename: "members"} ties a third card query on c2.right_id
    expect(ast.subqueries[0].subqueries[0].subqueries[0].conditions[0]).toMatchObject({
      field: "codename",
      values: ["members"],
    });
  });

  it("member needs codename resolution for Card::RoleID [ReferenceAttributes#member]", () => {
    expect(() => parseCql({ member: "A" })).toThrow(/codename resolution/);
    const ast = parseCql({ member: "A" }, { resolveCodename: (c) => (c === "role" ? 14 : undefined) });
    expect(ast.conditions[0]).toMatchObject({ field: "type_id", values: [14] });
  });
});

describe("negation (Conjunctions#not + Tie#negate_join)", () => {
  it("not ties a negated card subquery and adds the is-null condition [oracle]", () => {
    // oracle: not: {type: "User"} -> LEFT JOIN cards c1 ON c0.id = c1.id AND c1.type_id = '-999'
    //   AND c1.trash is false WHERE c1.id is null
    const ast = parseCql({ not: { type: "User" } });
    expect(ast.subqueries[0].negate).toBe(true);
    expect(ast.subqueries[0].conditionsOnJoin).toBe(true);
    expect(ast.joins[0].side).toBe("LEFT");
    expect(ast.conditions[0]).toEqual({ kind: "raw", sql: "c1.id is null" });
  });

  it("ties inside an or-conjunction go LEFT [Join#inside_or?]", () => {
    const ast = parseCql({ conj: "or", type: { codename: "x" } });
    expect(ast.joins[0].side).toBe("LEFT");
  });
});

describe("match attributes (CardQuery::MatchAttributes)", () => {
  it("top-level match builds a name OR content group [oracle]", () => {
    // oracle: match: "joe" -> (c0.name REGEXP 'joe' OR c0.db_content REGEXP 'joe')
    const ast = parseCql({ match: "joe" });
    expect(ast.conditions[0].kind).toBe("group");
    if (ast.conditions[0].kind === "group") {
      expect(ast.conditions[0].conj).toBe("or");
      expect(ast.conditions[0].conditions.map((c) => (c.kind === "match" ? c.field : ""))).toEqual([
        "name",
        "db_content",
      ]);
    }
  });

  it("empty match values are skipped [MatchAttributes#match]", () => {
    expect(parseCql({ match: "" }).conditions).toHaveLength(0);
  });

  it("name_match adds the match and key-not-null [MatchAttributes#name_match] [oracle]", () => {
    const ast = parseCql({ name_match: "joe" });
    expect(ast.conditions).toHaveLength(2);
    expect(ast.conditions[1]).toEqual({ kind: "raw", sql: "c0.key IS NOT NULL" });
  });

  it("complete builds a LIKE prefix condition plus key-not-null [MatchAttributes#complete] [oracle]", () => {
    const ast = parseCql({ complete: "joe" });
    expect(ast.conditions[0]).toEqual({ kind: "like", field: "key", value: "joe" });
    expect(ast.conditions[1]).toEqual({ kind: "raw", sql: "c0.key IS NOT NULL" });
  });

  it("compound complete splits into left + right parts [MatchAttributes#complete_compound]", () => {
    const ast = parseCql({ complete: "A+B" });
    // left: "A" restricts left_id directly (unresolved -> -999);
    // right: {complete: "B"} ties a card subquery with the LIKE condition
    expect(ast.conditions[0]).toMatchObject({ kind: "value", field: "left_id", values: [-999] });
    expect(ast.subqueries).toHaveLength(1);
    expect(ast.subqueries[0].conditions[0]).toEqual({ kind: "like", field: "key", value: "b" });
    expect(ast.subqueries[0].conditions[1]).toEqual({ kind: "raw", sql: "c1.key IS NOT NULL" });
  });
});

describe("custom and deprecated (CardQuery::Custom)", () => {
  it("compound true/false produce structural raw conditions [oracle]", () => {
    expect(parseCql({ compound: true }).conditions[0]).toEqual({
      kind: "raw",
      sql: "left_id IS NOT NULL",
    });
    expect(parseCql({ compound: false }).conditions[0]).toEqual({
      kind: "raw",
      sql: "left_id IS NULL",
    });
  });

  it("deprecated keys warn and are ignored [Interpretation#deprecated_attribute]", () => {
    const warnings: string[] = [];
    const ast = parseCql({ view: "open", id: 5 }, { onWarning: (m) => warnings.push(m) });
    expect(ast.conditions).toHaveLength(1);
    expect(warnings).toEqual(["Card queries no longer support view attribute"]);
  });

  it("ignore keys are consumed silently [Interpretation#no_method_for_attribute_type]", () => {
    const ast = parseCql({ prepend: "x", append: "y", id: 5 });
    expect(ast.conditions).toHaveLength(1);
    expect(ast.statementExtras).toEqual({ prepend: "x", append: "y" });
  });
});

describe("sorting (CardQuery::Sorting)", () => {
  it("sort hash with item join builds a LEFT JOIN and sort_by mod [oracle]", () => {
    // oracle: sort: {right: {}} -> LEFT JOIN (cards c1 ...) ON c0.id = c1.left_id,
    //   ORDER BY c1.db_content asc
    const ast = parseCql({ sort: { right: {} } });
    expect(ast.joins[0]).toMatchObject({
      side: "LEFT",
      fromField: "id",
      toField: "left_id",
      toAlias: "c1",
    });
    expect(ast.subqueries[0].conditionsOnJoin).toBe(true);
    expect(ast.mods.sortBy).toEqual(["c1.db_content"]);
  });

  it("sort hash with item right and return name [oracle]", () => {
    const ast = parseCql({ sort: { item: "right", return: "name", right: {} } });
    expect(ast.joins[0].toField).toBe("right_id");
    expect(ast.mods.sortBy).toEqual(["c1.name"]);
  });

  it("count sorts raise (deferred; Ruby Sorting#sort_by_count_referred_to)", () => {
    expect(() =>
      parseCql({ sort: { return: "count", item: "referred_to", referred_to_by: { right: "*x" } } }),
    ).toThrow(/#count/);
  });

  it("unknown sort items raise [Sorting#sort_by_item_join_field]", () => {
    expect(() => parseCql({ sort: { item: "middle" } })).toThrow(/#join\/middle/);
  });

  it("sort hash on count queries is skipped [Sorting#sort -> full?]", () => {
    const ast = parseCql({ return: "count", sort: { right: {} } });
    expect(ast.joins).toHaveLength(0);
    expect(ast.mods.sortBy).toBeUndefined();
  });
});

describe("modifiers (Interpretation#interpret_modifier)", () => {
  it("limit/offset/return/group/index are stringified into mods", () => {
    const ast = parseCql({ limit: 10, offset: 5, return: "name", group: "c0.type_id", index: "foo" });
    expect(ast.mods).toMatchObject({
      limit: "10",
      offset: "5",
      return: "name",
      group: "c0.type_id",
      index: "foo",
    });
  });

  it("sort arrays are kept per directive", () => {
    const ast = parseCql({ sort: ["update", "name"], sort_dir: ["desc", "asc"] });
    expect(ast.mods.sort).toEqual(["update", "name"]);
    expect(ast.mods.sortDir).toEqual(["desc", "asc"]);
  });
});

describe("found_by (CardQuery::FoundBy)", () => {
  it("records a foundBy condition node (generation deferred)", () => {
    const ast = parseCql({ found_by: { id: 5 } });
    expect(ast.conditions[0]).toEqual({ kind: "foundBy", value: { id: 5 } });
  });
});
