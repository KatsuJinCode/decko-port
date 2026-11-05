/**
 * Operator/value-level tests for the CQL port.
 *
 * Each expectation was verified against the REAL card-1.110.0 code by loading
 * lib/card/query/{value,value/match_value}.rb with a stubbed query object and
 * an ActiveRecord sqlite3 connection ("live oracle"); the oracle SQL shape is
 * noted per case. The TS port parameterizes values (? placeholders) where the
 * Ruby oracle inlines quoted literals — the structural shape (field, operator
 * token, grouping) is the parity surface.
 */

import { describe, expect, it } from "vitest";
import { parseCql } from "../../src/cql/parser.js";
import { generateSql } from "../../src/cql/sql.js";

interface OpCase {
  name: string;
  cql: Record<string, unknown>;
  field: string;
  op: string;
  values: Array<string | number | null>;
  /** SQL fragment the Ruby oracle produced for the same Value */
  oracle: string;
  sql: string;
  params: unknown[];
}

const CASES: OpCase[] = [
  {
    name: "integer equality",
    cql: { id: 5 },
    field: "id",
    op: "=",
    values: [5],
    oracle: "c0.id = '5'",
    sql: "c0.id = ?",
    params: [5],
  },
  {
    name: "bare array defaults to in",
    cql: { id: [1, 2, 3] },
    field: "id",
    op: "in",
    values: [1, 2, 3],
    oracle: "c0.id in ('1','2','3')",
    sql: "c0.id in (?,?,?)",
    params: [1, 2, 3],
  },
  {
    name: "eq alias canonicalizes",
    cql: { id: ["eq", 7] },
    field: "id",
    op: "=",
    values: [7],
    oracle: "c0.id = '7'",
    sql: "c0.id = ?",
    params: [7],
  },
  {
    name: "ne alias canonicalizes to !=",
    cql: { id: ["ne", "x"] },
    field: "id",
    op: "!=",
    values: ["x"],
    oracle: "c0.id != 'x'",
    sql: "c0.id != ?",
    params: ["x"],
  },
  {
    name: "gt alias canonicalizes to >",
    cql: { id: ["gt", 3] },
    field: "id",
    op: ">",
    values: [3],
    oracle: "c0.id > '3'",
    sql: "c0.id > ?",
    params: [3],
  },
  {
    name: "symbols in in-lists become strings",
    cql: { id: ["in", "a", "b"] },
    field: "id",
    op: "in",
    values: ["a", "b"],
    oracle: "c0.id in ('a','b')",
    sql: "c0.id in (?,?)",
    params: ["a", "b"],
  },
  {
    name: "nil value becomes is NULL",
    cql: { id: null },
    field: "id",
    op: "is",
    values: [null],
    oracle: "c0.id is NULL",
    sql: "c0.id is NULL",
    params: [],
  },
  {
    name: "is not operator with nil",
    cql: { id: ["is not", null] },
    field: "id",
    op: "is not",
    values: [null],
    oracle: "c0.id is not NULL",
    sql: "c0.id is not NULL",
    params: [],
  },
  {
    name: "=~ operator passes through as a token",
    cql: { id: ["=~", "ab"] },
    field: "id",
    op: "=~",
    values: ["ab"],
    oracle: "c0.id =~ 'ab'",
    sql: "c0.id =~ ?",
    params: ["ab"],
  },
  {
    name: "! operator canonicalizes to is not",
    cql: { id: ["!", 5] },
    field: "id",
    op: "is not",
    values: [5],
    oracle: "c0.id is not '5'",
    sql: "c0.id is not ?",
    params: [5],
  },
  {
    name: "in with a single value keeps the group parens",
    cql: { id: ["in", 5] },
    field: "id",
    op: "in",
    values: [5],
    oracle: "c0.id in ('5')",
    sql: "c0.id in (?)",
    params: [5],
  },
  {
    name: "name field maps to key column and key form",
    cql: { name: "Joe Admin" },
    field: "key",
    op: "=",
    values: ["joe_admin"],
    oracle: "c0.key = 'joe_admin'",
    sql: "c0.key = ?",
    params: ["joe_admin"],
  },
  {
    name: "name in-list maps every value to key form",
    cql: { name: ["in", "Foo Bar", "Baz Qux"] },
    field: "key",
    op: "in",
    values: ["foo_bar", "baz_qux"],
    oracle: "c0.key in ('foo_bar','baz_qux')",
    sql: "c0.key in (?,?)",
    params: ["foo_bar", "baz_qux"],
  },
  {
    name: "content field maps to db_content column",
    cql: { content: "hello" },
    field: "db_content",
    op: "=",
    values: ["hello"],
    oracle: "c0.db_content = 'hello' (shape; oracle ran with field :content)",
    sql: "c0.db_content = ?",
    params: ["hello"],
  },
];

describe("CQL operators (Value#to_sql parity)", () => {
  for (const c of CASES) {
    it(`${c.name} [oracle: ${c.oracle}]`, () => {
      const ast = parseCql(c.cql);
      const condition = ast.conditions[0];
      expect(condition).toMatchObject({ kind: "value", field: c.field, op: c.op });
      if (condition.kind === "value") expect(condition.values).toEqual(c.values);
      const { sql, params } = generateSql(ast);
      expect(sql).toContain(c.sql);
      expect(params).toEqual(c.params);
    });
  }
});

describe("match operator (Value::MatchValue)", () => {
  it("escapes every non-word character for REGEXP [oracle: c0.name REGEXP 'a\\ b\\?c']", () => {
    const ast = parseCql({ content: ["~", "a b?c"] });
    const { sql, params } = generateSql(ast);
    expect(sql).toContain("c0.db_content REGEXP ?");
    expect(params).toEqual(["a\\ b\\?c"]);
  });

  it("match on name hits the name column, not key [oracle: c0.name REGEXP 'term']", () => {
    const ast = parseCql({ name: ["match", "term"] });
    const { sql, params } = generateSql(ast);
    expect(sql).toContain("c0.name REGEXP ?");
    expect(params).toEqual(["term"]);
  });

  it("= prefix on name becomes an exact key comparison [oracle: c0.key = 'foo']", () => {
    const ast = parseCql({ name: ["~", "=Foo"] });
    const { sql, params } = generateSql(ast);
    expect(sql).toContain("c0.key = ?");
    expect(params).toEqual(["foo"]);
  });

  it("= prefix on content still REGEXPs [oracle: c0.db_content REGEXP 'Foo']", () => {
    const ast = parseCql({ content: ["~", "=Foo"] });
    const { sql, params } = generateSql(ast);
    expect(sql).toContain("c0.db_content REGEXP ?");
    expect(params).toEqual(["Foo"]);
  });

  it("~~ prefix passes the term through unescaped [oracle: c0.db_content REGEXP 'a.*']", () => {
    const ast = parseCql({ content: ["~", "~~a.*"] });
    const { sql, params } = generateSql(ast);
    expect(sql).toContain("c0.db_content REGEXP ?");
    expect(params).toEqual(["a.*"]);
  });
});
