/**
 * SQL generation tests: QueryNode AST -> parameterized SQLite SQL.
 *
 * Every expected SQL string was captured from the REAL card-1.110.0 code by
 * loading lib/card/query/** standalone with a stubbed Card/ActiveRecord
 * environment and running Card::Query.new(statement).sql ("live oracle").
 * The port parameterizes values (the oracle inlines quoted literals) and
 * normalizes whitespace (the oracle emits comment-slot double spaces and
 * "LIMIT  10 " quirks) — the oracle output is quoted per case with those
 * two mechanical differences applied.
 */

import { describe, expect, it } from "vitest";
import { parseCql } from "../../src/cql/parser.js";
import { generateSql } from "../../src/cql/sql.js";

function sql(cql: Record<string, unknown>, opts?: Parameters<typeof generateSql>[1]) {
  return generateSql(parseCql(cql), opts);
}

describe("single-table queries", () => {
  it("basic equality [oracle: SELECT  c0.* FROM cards c0  WHERE c0.id = '5' AND c0.trash is false]", () => {
    expect(sql({ id: 5 })).toEqual({
      sql: "SELECT c0.* FROM cards c0 WHERE c0.id = ? AND c0.trash is false",
      params: [5],
    });
  });

  it("in-list [oracle: ... WHERE c0.id in ('1','2') AND c0.trash is false]", () => {
    expect(sql({ id: [1, 2] }).sql).toBe(
      "SELECT c0.* FROM cards c0 WHERE c0.id in (?,?) AND c0.trash is false",
    );
  });

  it("name maps to key [oracle: ... WHERE c0.key = 'joe_admin' AND c0.trash is false]", () => {
    expect(sql({ name: "Joe Admin" })).toEqual({
      sql: "SELECT c0.* FROM cards c0 WHERE c0.key = ? AND c0.trash is false",
      params: ["joe_admin"],
    });
  });

  it("hash-valued type ties with conditions in WHERE and trash in ON [oracle]", () => {
    // oracle:
    // SELECT DISTINCT c0.* FROM cards c0
    //  JOIN cards c1 ON c0.type_id = c1.id AND c1.trash is false  WHERE c1.codename = 'type' AND c0.trash is false
    expect(sql({ type: { codename: "type" } })).toEqual({
      sql:
        "SELECT DISTINCT c0.* FROM cards c0 JOIN cards c1 ON c0.type_id = c1.id AND c1.trash is false WHERE c1.codename = ? AND c0.trash is false",
      params: ["type"],
    });
  });

  it("top-level conditions join with the conj modifier [Where#condition_joint]", () => {
    expect(sql({ id: 5, name: "Joe", conj: "or" }).sql).toBe(
      "SELECT c0.* FROM cards c0 WHERE (c0.id = ? OR c0.key = ?) AND c0.trash is false",
    );
  });

  it("bare operator keys apply to content [Interpretation#interpret_as_content?] [oracle: '!' => 5 -> c0.db_content is not '5']", () => {
    expect(sql({ "!": 5 }).sql).toBe(
      "SELECT c0.* FROM cards c0 WHERE c0.db_content is not ? AND c0.trash is false",
    );
  });

  it("compound conditions use structural raw SQL [oracle: left_id IS NOT NULL]", () => {
    expect(sql({ compound: true }).sql).toBe(
      "SELECT c0.* FROM cards c0 WHERE left_id IS NOT NULL AND c0.trash is false",
    );
    expect(sql({ compound: false }).sql).toContain("left_id IS NULL");
  });

  it("ranges via operator arrays [oracle: created_at: ['gt', d] -> c0.created_at > 'd']", () => {
    expect(sql({ created_at: ["gt", "2020-01-01"] })).toEqual({
      sql: "SELECT c0.* FROM cards c0 WHERE c0.created_at > ? AND c0.trash is false",
      params: ["2020-01-01"],
    });
  });
});

describe("match family", () => {
  it("top-level match ORs name and content [oracle: (c0.name REGEXP 'joe' OR c0.db_content REGEXP 'joe')]", () => {
    expect(sql({ match: "joe" })).toEqual({
      sql:
        "SELECT c0.* FROM cards c0 WHERE (c0.name REGEXP ? OR c0.db_content REGEXP ?) AND c0.trash is false",
      params: ["joe", "joe"],
    });
  });

  it("name_match [oracle: (c0.name REGEXP 'joe' AND c0.key IS NOT NULL)]", () => {
    expect(sql({ name_match: "joe" }).sql).toBe(
      "SELECT c0.* FROM cards c0 WHERE (c0.name REGEXP ? AND c0.key IS NOT NULL) AND c0.trash is false",
    );
  });

  it("complete [oracle: (c0.key LIKE 'joe%' AND c0.key IS NOT NULL)]", () => {
    expect(sql({ complete: "joe" })).toEqual({
      sql:
        "SELECT c0.* FROM cards c0 WHERE (c0.key LIKE ? AND c0.key IS NOT NULL) AND c0.trash is false",
      params: ["joe%"],
    });
  });
});

describe("limit / offset / count quirks", () => {
  it("limit and offset [oracle: LIMIT  10 OFFSET 5 ]", () => {
    expect(sql({ limit: 10, offset: 5 }).sql).toBe(
      "SELECT c0.* FROM cards c0 WHERE c0.trash is false LIMIT 10 OFFSET 5",
    );
  });

  it("limit alone [oracle: LIMIT  10 ]", () => {
    expect(sql({ limit: 10 }).sql).toBe("SELECT c0.* FROM cards c0 WHERE c0.trash is false LIMIT 10");
  });

  it("offset without limit renders nothing [SqlStatement#limit_and_offset quirk] [oracle]", () => {
    expect(sql({ offset: 5 }).sql).toBe("SELECT c0.* FROM cards c0 WHERE c0.trash is false");
  });

  it("count return [oracle: SELECT  coalesce(count( distinct c0.id),0) as count ...]", () => {
    expect(sql({ return: "count" }).sql).toBe(
      "SELECT coalesce(count(distinct c0.id),0) as count FROM cards c0 WHERE c0.trash is false",
    );
  });

  it("count ignores limit [oracle: count with limit: 10 has no LIMIT]", () => {
    expect(sql({ return: "count", limit: 10 }).sql).toBe(
      "SELECT coalesce(count(distinct c0.id),0) as count FROM cards c0 WHERE c0.trash is false",
    );
  });

  it("name return selects the name triple [oracle: SELECT  c0.name, c0.left_id, c0.right_id]", () => {
    expect(sql({ return: "name" }).sql).toBe(
      "SELECT c0.name, c0.left_id, c0.right_id FROM cards c0 WHERE c0.trash is false",
    );
  });

  it("underscore-prefixed returns fall back to card [oracle: return: '_left' -> c0.*]", () => {
    expect(sql({ id: 5, return: "_left" }).sql).toContain("SELECT c0.*");
  });

  it("arbitrary returns pass safe_sql [oracle: return: 'random' -> SELECT random]", () => {
    expect(sql({ return: "random" }).sql).toContain("SELECT random FROM cards c0");
  });

  it("group by [oracle: ... GROUP BY c0.type_id]", () => {
    expect(sql({ group: "c0.type_id", type_id: [1, 2], return: "type_id" }).sql).toBe(
      "SELECT c0.type_id FROM cards c0 WHERE c0.type_id in (?,?) AND c0.trash is false GROUP BY c0.type_id",
    );
  });

  it("safe_sql rejects disallowed characters [Query.safe_sql]", () => {
    expect(() => sql({ group: "c0.type_id; DROP TABLE" })).toThrow(/disallowed characters/);
  });
});

describe("sorting", () => {
  it("ORDER_MAP mapping and default dir [oracle: sort: 'update' -> ORDER BY c0.updated_at desc]", () => {
    expect(sql({ sort: "update" }).sql).toBe(
      "SELECT c0.*, c0.updated_at FROM cards c0 WHERE c0.trash is false ORDER BY c0.updated_at desc",
    );
  });

  it("explicit sort_dir [oracle: ... ORDER BY c0.key desc]", () => {
    expect(sql({ return: "name", sort: "name", sort_dir: "desc" }).sql).toBe(
      "SELECT c0.name, c0.left_id, c0.right_id, c0.key FROM cards c0 WHERE c0.trash is false ORDER BY c0.key desc",
    );
  });

  it("multiple sorts with per-directive dirs [oracle: ORDER BY c0.updated_at desc, c0.key asc]", () => {
    expect(sql({ sort: ["update", "name"], sort_dir: ["desc", "asc"] }).sql).toBe(
      "SELECT c0.*, c0.updated_at, c0.key FROM cards c0 WHERE c0.trash is false ORDER BY c0.updated_at desc, c0.key asc",
    );
  });

  it("deprecated dir behaves like sort_dir [oracle]", () => {
    expect(sql({ sort: "name", dir: "desc" }).sql).toContain("ORDER BY c0.key desc");
  });

  it("sort hash builds the LEFT JOIN and orders by the joined field [oracle]", () => {
    // oracle:
    // SELECT DISTINCT c0.*, c1.db_content FROM cards c0
    //  LEFT JOIN (cards c1
    //  JOIN cards c2 ON c1.right_id = c2.id AND c2.trash is false ) ON c0.id = c1.left_id AND c1.trash is false WHERE c0.trash is false ORDER BY c1.db_content asc
    expect(sql({ sort: { right: {} } }).sql).toBe(
      "SELECT DISTINCT c0.*, c1.db_content FROM cards c0 " +
        "LEFT JOIN (cards c1 JOIN cards c2 ON c1.right_id = c2.id AND c2.trash is false) " +
        "ON c0.id = c1.left_id AND c1.trash is false WHERE c0.trash is false ORDER BY c1.db_content asc",
    );
  });

  it("sort_as casts the field (SQLite type approximation)", () => {
    expect(sql({ sort: "name", sort_as: "numeric" }).sql).toContain(
      "ORDER BY CAST(c0.key AS REAL) asc",
    );
  });
});

describe("plus relational", () => {
  it("right_plus with a string part [oracle: JOIN cards c1 ON c0.id = c1.left_id ... c1.right_id = '-999']", () => {
    expect(sql({ type: "Search", right_plus: "*title" })).toEqual({
      sql:
        "SELECT DISTINCT c0.* FROM cards c0 JOIN cards c1 ON c0.id = c1.left_id AND c1.trash is false " +
        "WHERE (c0.type_id = ? AND c1.right_id = ?) AND c0.trash is false",
      params: [-999, -999],
    });
  });

  it("right_plus with part + junction clause [oracle]", () => {
    // oracle: right_plus: [{codename: "point"}, {type: "Number"}] ->
    //   JOIN cards c1 ON c0.id = c1.left_id AND c1.trash is false
    //   JOIN cards c2 ON c1.right_id = c2.id AND c2.trash is false
    //   WHERE (c1.type_id = '-999' AND c2.codename = 'point') AND c0.trash is false
    expect(sql({ right_plus: [{ codename: "point" }, { type: "Number" }] })).toEqual({
      sql:
        "SELECT DISTINCT c0.* FROM cards c0 " +
        "JOIN cards c1 ON c0.id = c1.left_id AND c1.trash is false " +
        "JOIN cards c2 ON c1.right_id = c2.id AND c2.trash is false " +
        "WHERE (c1.type_id = ? AND c2.codename = ?) AND c0.trash is false",
      params: [-999, "point"],
    });
  });

  it("left_plus ties on right_id [oracle]", () => {
    expect(sql({ left_plus: "*x" }).sql).toBe(
      "SELECT DISTINCT c0.* FROM cards c0 JOIN cards c1 ON c0.id = c1.right_id AND c1.trash is false WHERE c1.left_id = ? AND c0.trash is false",
    );
  });
});

describe("negation", () => {
  it("not with a hash value [oracle]", () => {
    // oracle:
    // SELECT DISTINCT c0.* FROM cards c0
    //  LEFT JOIN cards c1 ON c0.id = c1.id AND c1.type_id = '-999' AND c1.trash is false  WHERE c1.id is null AND c0.trash is false
    expect(sql({ not: { type: "User" } })).toEqual({
      sql:
        "SELECT DISTINCT c0.* FROM cards c0 " +
        "LEFT JOIN cards c1 ON c0.id = c1.id AND c1.type_id = ? AND c1.trash is false " +
        "WHERE c1.id is null AND c0.trash is false",
      params: [-999],
    });
  });

  it("not with a string uses the -2 clause sentinel [oracle: c1.id = '-2']", () => {
    expect(sql({ not: "Foo" })).toEqual({
      sql:
        "SELECT DISTINCT c0.* FROM cards c0 " +
        "LEFT JOIN cards c1 ON c0.id = c1.id AND c1.id = ? AND c1.trash is false " +
        "WHERE c1.id is null AND c0.trash is false",
      params: [-2],
    });
  });

  it("nested not inside an or group [oracle]", () => {
    // oracle: {not: {type: "User"}, or: [{created_by: "A"}, {not: {created_by: "B"}}]}
    expect(sql({ not: { type: "User" }, or: [{ created_by: "A" }, { not: { created_by: "B" } }] }).sql).toBe(
      "SELECT DISTINCT c0.* FROM cards c0 " +
        "LEFT JOIN cards c1 ON c0.id = c1.id AND c1.type_id = ? AND c1.trash is false " +
        "LEFT JOIN cards c2 ON c0.id = c2.id AND c2.creator_id = ? AND c2.trash is false " +
        "WHERE (c1.id is null AND (c0.creator_id = ? OR c2.id is null)) AND c0.trash is false",
    );
  });
});

describe("conjunction groups", () => {
  it("any [oracle: (c0.type_id = '-999' OR c0.creator_id = '-999')]", () => {
    expect(sql({ any: [{ type: "User" }, { created_by: "Joe" }] }).sql).toBe(
      "SELECT c0.* FROM cards c0 WHERE (c0.type_id = ? OR c0.creator_id = ?) AND c0.trash is false",
    );
  });

  it("all [oracle: (c0.type_id = '-999' AND c0.creator_id = '-999')]", () => {
    expect(sql({ all: [{ type: "User" }, { created_by: "Joe" }] }).sql).toBe(
      "SELECT c0.* FROM cards c0 WHERE (c0.type_id = ? AND c0.creator_id = ?) AND c0.trash is false",
    );
  });

  it("conjunction-shifted list [oracle: type: ['or','A','B']]", () => {
    expect(sql({ type: ["or", "A", "B"] }).sql).toBe(
      "SELECT c0.* FROM cards c0 WHERE (c0.type_id = ? OR c0.type_id = ?) AND c0.trash is false",
    );
  });

  it("joins inside an or group go LEFT and nest in parens [oracle]", () => {
    // oracle: any: [{edited_by: "Joe"}] ->
    //  LEFT JOIN (card_actions cn1
    //  JOIN card_acts cx2 ON cn1.card_act_id = cx2.id
    //  JOIN cards c3 ON cx2.actor_id = c3.id AND c3.trash is false ) ON c0.id = cn1.card_id WHERE c3.id = '-2' AND c0.trash is false
    expect(sql({ any: [{ edited_by: "Joe" }] })).toEqual({
      sql:
        "SELECT DISTINCT c0.* FROM cards c0 " +
        "LEFT JOIN (card_actions cn1 JOIN card_acts cx2 ON cn1.card_act_id = cx2.id " +
        "JOIN cards c3 ON cx2.actor_id = c3.id AND c3.trash is false) ON c0.id = cn1.card_id " +
        "WHERE c3.id = ? AND c0.trash is false",
      params: [-2],
    });
  });
});

describe("editor / act chains", () => {
  it("edited_by [oracle]", () => {
    // oracle:
    // SELECT DISTINCT c0.* FROM cards c0
    //  JOIN card_actions cn1 ON c0.id = cn1.card_id
    //  JOIN card_acts cx2 ON cn1.card_act_id = cx2.id
    //  JOIN cards c3 ON cx2.actor_id = c3.id AND c3.trash is false  WHERE c3.id = '-2' AND c0.trash is false
    expect(sql({ edited_by: "Joe" })).toEqual({
      sql:
        "SELECT DISTINCT c0.* FROM cards c0 " +
        "JOIN card_actions cn1 ON c0.id = cn1.card_id " +
        "JOIN card_acts cx2 ON cn1.card_act_id = cx2.id " +
        "JOIN cards c3 ON cx2.actor_id = c3.id AND c3.trash is false " +
        "WHERE c3.id = ? AND c0.trash is false",
      params: [-2],
    });
  });

  it("editor_of [oracle: cx1 / cn2 / c3 order]", () => {
    expect(sql({ editor_of: "Joe" }).sql).toBe(
      "SELECT DISTINCT c0.* FROM cards c0 " +
        "JOIN card_acts cx1 ON c0.id = cx1.actor_id " +
        "JOIN card_actions cn2 ON cx1.id = cn2.card_act_id " +
        "JOIN cards c3 ON cn2.card_id = c3.id AND c3.trash is false " +
        "WHERE c3.id = ? AND c0.trash is false",
    );
  });

  it("updated_by adds the action_type condition [oracle: (cn1.action_type = 1 AND c3.id = '-2')]", () => {
    expect(sql({ updated_by: "Joe" }).sql).toBe(
      "SELECT DISTINCT c0.* FROM cards c0 " +
        "JOIN card_actions cn1 ON c0.id = cn1.card_id " +
        "JOIN card_acts cx2 ON cn1.card_act_id = cx2.id " +
        "JOIN cards c3 ON cx2.actor_id = c3.id AND c3.trash is false " +
        "WHERE (cn1.action_type = 1 AND c3.id = ?) AND c0.trash is false",
    );
  });

  it("updater_of [oracle: (cn2.action_type = 1 AND c3.id = '-2')]", () => {
    expect(sql({ updater_of: "Joe" }).sql).toBe(
      "SELECT DISTINCT c0.* FROM cards c0 " +
        "JOIN card_acts cx1 ON c0.id = cx1.actor_id " +
        "JOIN card_actions cn2 ON cx1.id = cn2.card_act_id " +
        "JOIN cards c3 ON cn2.card_id = c3.id AND c3.trash is false " +
        "WHERE (cn2.action_type = 1 AND c3.id = ?) AND c0.trash is false",
    );
  });

  it("last_editor_of restricts directly [oracle: c0.updater_id = '-999']", () => {
    expect(sql({ last_edited_by: "Joe" }).sql).toBe(
      "SELECT c0.* FROM cards c0 WHERE c0.updater_id = ? AND c0.trash is false",
    );
  });

  it("last_editor_of ties on updater_id [oracle: JOIN cards c1 ON c0.id = c1.updater_id]", () => {
    expect(sql({ last_editor_of: "Joe" }).sql).toBe(
      "SELECT DISTINCT c0.* FROM cards c0 JOIN cards c1 ON c0.id = c1.updater_id AND c1.trash is false WHERE c1.id = ? AND c0.trash is false",
    );
  });
});

describe("references", () => {
  it("refer_to [oracle: JOIN card_references cr1 ON c0.id = cr1.referer_id ...]", () => {
    expect(sql({ refer_to: "A" })).toEqual({
      sql:
        "SELECT DISTINCT c0.* FROM cards c0 " +
        "JOIN card_references cr1 ON c0.id = cr1.referer_id " +
        "WHERE (cr1.ref_type IN (?,?) AND cr1.referee_id = ?) AND c0.trash is false",
      params: ["L", "I", -999],
    });
  });

  it("link_to [oracle: cr1.ref_type = ('L') AND cr1.referee_id = -999]", () => {
    expect(sql({ link_to: "A" })).toEqual({
      sql:
        "SELECT DISTINCT c0.* FROM cards c0 " +
        "JOIN card_references cr1 ON c0.id = cr1.referer_id " +
        "WHERE (cr1.ref_type = ? AND cr1.referee_id = ?) AND c0.trash is false",
      params: ["L", -999],
    });
  });

  it("referred_to_by [oracle: cr1.ref_type IN ('L','I') AND c2.right_id = '-999']", () => {
    expect(sql({ referred_to_by: { right: "A" } })).toEqual({
      sql:
        "SELECT DISTINCT c0.* FROM cards c0 " +
        "JOIN card_references cr1 ON c0.id = cr1.referee_id " +
        "JOIN cards c2 ON cr1.referer_id = c2.id AND c2.trash is false " +
        "WHERE (cr1.ref_type IN (?,?) AND c2.right_id = ?) AND c0.trash is false",
      params: ["L", "I", -999],
    });
  });

  it("OR id-list optimization [oracle: refer_to: ['or',5,6] -> cr1.referee_id in (5, 6)]", () => {
    expect(sql({ refer_to: ["or", 5, 6] })).toEqual({
      sql:
        "SELECT DISTINCT c0.* FROM cards c0 " +
        "JOIN card_references cr1 ON c0.id = cr1.referer_id " +
        "WHERE (cr1.ref_type IN (?,?) AND cr1.referee_id in (?,?)) AND c0.trash is false",
      params: ["L", "I", 5, 6],
    });
  });

  it("AND lists make one join per id [oracle: cr1 + cr2]", () => {
    expect(sql({ refer_to: [5, 6] }).sql).toBe(
      "SELECT DISTINCT c0.* FROM cards c0 " +
        "JOIN card_references cr1 ON c0.id = cr1.referer_id " +
        "JOIN card_references cr2 ON c0.id = cr2.referer_id " +
        "WHERE ((cr1.ref_type IN (?,?) AND cr1.referee_id = ?) AND (cr2.ref_type IN (?,?) AND cr2.referee_id = ?)) AND c0.trash is false",
    );
  });

  it("member_of [oracle: full three-join shape]", () => {
    expect(sql({ member_of: "A" }).sql).toBe(
      "SELECT DISTINCT c0.* FROM cards c0 " +
        "JOIN card_references cr1 ON c0.id = cr1.referee_id " +
        "JOIN cards c2 ON cr1.referer_id = c2.id AND c2.trash is false " +
        "JOIN cards c3 ON c2.right_id = c3.id AND c3.trash is false " +
        "WHERE (cr1.ref_type IN (?,?) AND (c2.left_id = ? AND c3.codename = ?)) AND c0.trash is false",
    );
  });

  it("_none outfield renders is_present = 0 [ReferenceQuery#non_outfield]", () => {
    const none = sql({ refer_to: "_none" });
    expect(none.sql).toContain("cr1.is_present = ?");
    expect(none.params).toEqual(["L", "I", 0]);
  });
});

describe("permission conditions (Where#permission_conditions)", () => {
  it("always_ok (default) omits them [oracle: Auth stub always_ok]", () => {
    expect(sql({ id: 5 }).sql).not.toContain("read_rule_id");
  });

  it("read rules render as IN with params [oracle: c0.read_rule_id IN (7,11)]", () => {
    expect(sql({ id: 5 }, { alwaysOk: false, readRuleIds: [7, 11] })).toEqual({
      sql:
        "SELECT c0.* FROM cards c0 WHERE c0.id = ? AND c0.trash is false AND c0.read_rule_id IN (?,?)",
      params: [5, 7, 11],
    });
  });

  it("empty rule list uses the sentinel [oracle: c0.read_rule_id IN (1)]", () => {
    expect(sql({ id: 5 }, { alwaysOk: false }).sql).toContain("c0.read_rule_id IN (1)");
  });
});

describe("statement shorthand", () => {
  it("integer statement [Normalization#clause_to_hash]", () => {
    expect(sql(5 as unknown as Record<string, unknown>).sql).toContain("c0.id = ?");
  });

  it("context flows through junction ties into name conditions", () => {
    // right_plus: {name: "_left"} in context "A+B": the part resolves to "A",
    // ties c2 via c1.right_id, and c2's name condition matches the key form
    const result = generateSql(parseCql({ right_plus: { name: "_left" } }, { context: "A+B" }));
    expect(result.sql).toContain("c2.key = ?");
    expect(result.params).toContain("a");
  });
});

describe("found_by (deferred)", () => {
  it("generateSql refuses found_by with a pointer to the notes", () => {
    expect(() => sql({ found_by: { id: 5 } })).toThrow(/found_by requires runtime query execution/);
  });
});

describe("oracle-pinned edge cases", () => {
  it("id: [nil] renders NULL inside the list [oracle: c0.id in (NULL)]", () => {
    expect(sql({ id: [null as unknown as number] }).sql).toContain("c0.id in (NULL)");
  });

  it("nil name renders IS NULL (divergence: Ruby 1.110 emits broken 'c0.key is ()')", () => {
    // oracle: {name: nil} -> WHERE c0.key is () AND c0.trash is false
    // (Array.wrap(nil) collapses to [] and sqlize emits "()" — invalid SQL).
    // The port renders the sane NULL comparison; flagged in the notes.
    expect(sql({ name: null as unknown as string }).sql).toContain("c0.key is NULL");
  });

  it("conj interpreted BEFORE a tie key flips the join to LEFT [oracle]", () => {
    // oracle: {conj: "or", type: {codename: "type"}} -> LEFT JOIN cards c1 ...
    expect(sql({ conj: "or", type: { codename: "type" } }).sql).toContain("LEFT JOIN cards c1");
  });

  it("conj interpreted AFTER a tie key keeps the inner join [oracle]", () => {
    // oracle: {type: {codename: "type"}, conj: "or"} -> JOIN cards c1 ...
    expect(sql({ type: { codename: "type" }, conj: "or" }).sql).toMatch(/JOIN cards c1(?!.*LEFT)/);
    expect(sql({ type: { codename: "type" }, conj: "or" }).sql).not.toContain("LEFT JOIN");
  });
});
