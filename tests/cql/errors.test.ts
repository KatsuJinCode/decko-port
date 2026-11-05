/**
 * BadQuery parity tests: the invalid-input surfaces of card-1.110.0 CQL.
 * Each case cites the Ruby raise site; oracle-verified cases note it.
 */

import { describe, expect, it } from "vitest";
import { CqlBadQuery } from "../../src/cql/ast.js";
import { parseCql } from "../../src/cql/parser.js";
import { generateSql } from "../../src/cql/sql.js";

describe("invalid attributes [Interpretation#bad_attribute!]", () => {
  it("unknown keys raise [oracle: bogus_key -> Invalid attribute: bogus_key]", () => {
    expect(() => parseCql({ bogus_key: 1 })).toThrow(CqlBadQuery);
    expect(() => parseCql({ bogus_key: 1 })).toThrow(/Invalid attribute: bogus_key/);
  });

  it("operator aliases that are not attributes raise [oracle: neq / not_in do not exist in 1.110]", () => {
    // The 1.110 operator spellings are ne / "not in"; neq and not_in are
    // attribute KEYS and unknown -> BadQuery (verified against the oracle)
    expect(() => parseCql({ neq: 5 })).toThrow(/Invalid attribute: neq/);
    expect(() => parseCql({ not_in: [1, 2] })).toThrow(/Invalid attribute: not_in/);
  });

  it("sort_by with a Hash value is not a modifier and not an attribute", () => {
    // interpret_as_modifier? requires a non-Hash; sort_by is absent from
    // Query.attributes, so a Hash value falls through to bad_attribute!
    expect(() => parseCql({ sort_by: { right: {} } })).toThrow(/Invalid attribute: sort_by/);
  });

  it("non-card subquery clauses only accept their own keys [ReferenceQuery]", () => {
    expect(() => parseCql({ link_to: { bogus: 1 } })).toThrow(/Invalid attribute: bogus/);
  });
});

describe("invalid operators [Value#canonicalize_operator]", () => {
  it("unknown first elements are treated as values, not operators [oracle]", () => {
    // oracle: id: ["between", 1, 2] -> c0.id in ('between','1','2').
    // parse_array_value only shifts KNOWN operator keys, so the Ruby
    // "Invalid operator" raise is unreachable from CQL input in 1.110; the
    // canonicalize guard exists in the port for parity but is defensive.
    const ast = parseCql({ id: ["between", 1, 2] });
    expect(ast.conditions[0]).toMatchObject({
      kind: "value",
      op: "in",
      values: ["between", 1, 2],
    });
  });
});

describe("invalid property values [Value#parse_simple_value]", () => {
  it("hashes as operator values raise [oracle: updated_at: {'gt' => d}]", () => {
    expect(() => parseCql({ updated_at: { gt: "2020-01-01" } })).toThrow(/Invalid property value/);
  });

  it("floats raise [oracle: Float is not accepted by parse_simple_value]", () => {
    expect(() => parseCql({ id: 1.5 })).toThrow(/Invalid property value/);
  });

  it("booleans as basic values raise (compound is the custom-handled key)", () => {
    expect(() => parseCql({ id: true })).toThrow(/Invalid property value/);
  });
});

describe("safe_sql [Query.safe_sql]", () => {
  it("rejects disallowed characters in raw fragments at SQL generation", () => {
    // Ruby applies safe_sql in SqlStatement#group / #standard_full_field /
    // Order#order_field — i.e. during SQL generation, not interpretation
    expect(() => generateSql(parseCql({ group: "x; DROP" }))).toThrow(/disallowed characters/);
    expect(() => generateSql(parseCql({ return: "a'b" }))).toThrow(/disallowed characters/);
  });
});

describe("sort limits [Sorting#sort_method_not_implemented]", () => {
  it("count sorts raise with the Ruby message shape", () => {
    expect(() =>
      parseCql({ sort: { return: "count", item: "referred_to", referred_to_by: {} } }),
    ).toThrow(/sorting by #count\/referred_to not yet implemented/);
  });
});

describe("member without codename resolution [ReferenceAttributes#member]", () => {
  it("raises until a resolver is provided (Card::RoleID)", () => {
    expect(() => parseCql({ member: "A" })).toThrow(/Card::RoleID/);
  });
});

describe("found_by [FoundBy]", () => {
  it("parses into the AST but generateSql defers with an explicit error", () => {
    const ast = parseCql({ found_by: { id: 5 } });
    expect(() => generateSql(ast)).toThrow(/found_by requires runtime query execution/);
  });
});
