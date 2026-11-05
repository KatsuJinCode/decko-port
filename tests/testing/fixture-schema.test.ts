import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CAPTURE_ERROR_PREFIX,
  FixtureValidationError,
  canonicalJson,
  detectFixtureKind,
  formatCaptureError,
  isCaptureErrorSentinel,
  loadFixtureFile,
  nameAlgebraExpectation,
  cardRecordWithoutId,
  parseCapturedError,
  parseRenderedKey,
  renderedViewInput,
  validateCqlBasicFixture,
  validateSmokeFixture,
  UNKNOWN_VIEW_INPUT,
  UNKNOWN_VIEW_LABEL,
} from "../../src/testing/fixture-schema.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SMOKE_PATH = join(repoRoot, "fixtures", "captured", "smoke.json");
const CQL_PATH = join(repoRoot, "fixtures", "captured", "cql-basic.json");

const loadRealSmoke = (): ReturnType<typeof validateSmokeFixture> =>
  validateSmokeFixture(JSON.parse(readFileSync(SMOKE_PATH, "utf8")));
const loadRealCql = (): ReturnType<typeof validateCqlBasicFixture> =>
  validateCqlBasicFixture(JSON.parse(readFileSync(CQL_PATH, "utf8")));

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "decko-ts-fixture-schema-"));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("loader against the real committed fixtures", () => {
  it("loads and validates smoke.json", () => {
    const loaded = loadFixtureFile(SMOKE_PATH);
    expect(loaded.kind).toBe("smoke");
    const smoke = loaded.data as ReturnType<typeof validateSmokeFixture>;
    expect(smoke.card_count_after_seed).toBe(618);
    expect(Object.keys(smoke.cards)).toHaveLength(10);
    expect(Object.keys(smoke.rendered)).toHaveLength(20);
    expect(smoke.read_rule.target).toBe("Oracle Restricted");
    expect(smoke.read_rule.effective_readers).toEqual(["Administrator"]);
    expect(smoke.read_rule.anonymous_can_read).toBe(false);
    expect(smoke.read_rule.admin_can_read).toBe(true);
  });

  it("loads and validates cql-basic.json", () => {
    const loaded = loadFixtureFile(CQL_PATH);
    expect(loaded.kind).toBe("cql-basic");
    const cql = loaded.data as ReturnType<typeof validateCqlBasicFixture>;
    expect(Object.keys(cql.queries)).toHaveLength(11);
    expect(cql.queries["left_children"]).toEqual({
      query: { left: "Oracle Junction", sort: "name" },
      result: ["Oracle Junction+child_one", "Oracle Junction+child_two"],
    });
  });

  it("fails loudly on a nonexistent path", () => {
    expect(() => loadFixtureFile(join(tempDir, "missing.json"))).toThrow(FixtureValidationError);
  });

  it("fails loudly on a malformed JSON file", () => {
    const path = join(tempDir, "malformed.json");
    writeFileSync(path, '{ "cards": { "Oracle Basics": ');
    expect(() => loadFixtureFile(path)).toThrow(/not valid JSON/);
  });

  it("fails loudly on a valid-JSON file with the wrong shape", () => {
    const path = join(tempDir, "wrong-shape.json");
    writeFileSync(path, JSON.stringify({ neither: true }));
    expect(() => loadFixtureFile(path)).toThrow(/cannot identify fixture/);
  });
});

describe("smoke schema validation (fail loudly on shape mismatch)", () => {
  // Deliberately `any`: each test mutates one field into an invalid shape.
  const cloneSmoke = (): any => JSON.parse(JSON.stringify(loadRealSmoke()));

  it("accepts the real fixture", () => {
    expect(() => validateSmokeFixture(loadRealSmoke())).not.toThrow();
  });

  it("rejects a missing top-level key", () => {
    const bad: any = cloneSmoke();
    delete bad.read_rule;
    expect(() => validateSmokeFixture(bad)).toThrow(FixtureValidationError);
    expect(() => validateSmokeFixture(bad)).toThrow(/missing key\(s\): read_rule/);
  });

  it("rejects unexpected top-level keys (exact schema)", () => {
    const bad: any = cloneSmoke();
    bad.something_new = true;
    expect(() => validateSmokeFixture(bad)).toThrow(/unexpected key\(s\): something_new/);
  });

  it("rejects a wrong-typed card field", () => {
    const bad: any = cloneSmoke();
    bad.cards["Oracle Basics"].id = "605";
    expect(() => validateSmokeFixture(bad)).toThrow(
      /cards\["Oracle Basics"\]\.id: expected number, got string/
    );
  });

  it("rejects a card record with a missing field", () => {
    const bad: any = cloneSmoke();
    delete bad.cards["Oracle Search"].type_code;
    expect(() => validateSmokeFixture(bad)).toThrow(/missing key\(s\): type_code/);
  });

  it("rejects a non-string rendered value", () => {
    const bad: any = cloneSmoke();
    bad.rendered["Oracle Basics#title"] = 42;
    expect(() => validateSmokeFixture(bad)).toThrow(/rendered\["Oracle Basics#title"\]: expected string/);
  });

  it("rejects a cql_search string that is not a CAPTURE_ERROR sentinel", () => {
    const bad: any = cloneSmoke();
    bad.cql_search["left_Oracle_Junction_sort_name"] = "just a string";
    expect(() => validateSmokeFixture(bad)).toThrow(/CAPTURE_ERROR/);
  });
});

describe("cql-basic schema validation", () => {
  it("accepts the real fixture", () => {
    expect(() => validateCqlBasicFixture(loadRealCql())).not.toThrow();
  });

  it("rejects a query case with an extra field", () => {
    const bad = { queries: { x: { query: { name: "A" }, result: [], extra: 1 } } };
    expect(() => validateCqlBasicFixture(bad)).toThrow(/unexpected key\(s\): extra/);
  });

  it("rejects a non-array non-sentinel result", () => {
    const bad = { queries: { x: { query: { name: "A" }, result: 7 } } };
    expect(() => validateCqlBasicFixture(bad)).toThrow(/expected string\[\] or a/);
  });

  it("rejects arrays with non-string elements", () => {
    const bad = { queries: { x: { query: { name: "A" }, result: ["ok", 3] } } };
    expect(() => validateCqlBasicFixture(bad)).toThrow(/result\[1\]: expected string/);
  });
});

describe("fixture kind detection", () => {
  it("detects smoke by the cards key", () => {
    expect(detectFixtureKind({ cards: {}, rendered: {} })).toBe("smoke");
  });
  it("detects cql-basic by the queries key", () => {
    expect(detectFixtureKind({ queries: {} })).toBe("cql-basic");
  });
  it("rejects ambiguity and emptiness", () => {
    expect(() => detectFixtureKind({ cards: {}, queries: {} })).toThrow(/cannot identify fixture/);
    expect(() => detectFixtureKind({})).toThrow(/cannot identify fixture/);
    expect(() => detectFixtureKind(null)).toThrow(/expected object/);
  });
});

describe("rendered key + view-input conventions", () => {
  it("parses Card Name#view keys", () => {
    expect(parseRenderedKey("Oracle Basics#open")).toEqual({
      cardName: "Oracle Basics",
      view: "open",
    });
    expect(parseRenderedKey("Oracle Junction+child_one#closed")).toEqual({
      cardName: "Oracle Junction+child_one",
      view: "closed",
    });
  });

  it("rejects keys without exactly one # separator", () => {
    expect(() => parseRenderedKey("no-hash")).toThrow(/Card Name#view/);
    expect(() => parseRenderedKey("#open")).toThrow(/Card Name#view/);
    expect(() => parseRenderedKey("Card#")).toThrow(/Card Name#view/);
  });

  it("maps the unknown-view capture label to the executable input view", () => {
    expect(renderedViewInput(UNKNOWN_VIEW_LABEL)).toBe(UNKNOWN_VIEW_INPUT);
    expect(renderedViewInput("open")).toBe("open");
  });
});

describe("capture-error sentinels", () => {
  it("detects and parses the real unknown-view sentinel", () => {
    const smoke = loadRealSmoke();
    const sentinel = smoke.rendered["Oracle Basics#unknown_view_sentinel"];
    expect(isCaptureErrorSentinel(sentinel)).toBe(true);
    expect(parseCapturedError(sentinel)).toEqual({
      errorClass: "Card::Error::UserError",
      message: "view (definitely_not_a_view) not supported for Oracle Basics",
    });
  });

  it("parses the real CQL match sentinel (RuntimeError)", () => {
    const cql = loadRealCql();
    const sentinel = cql.queries["match_sentinel"].result as string;
    expect(parseCapturedError(sentinel)).toEqual({
      errorClass: "RuntimeError",
      message: "%{func} not implemented",
    });
  });

  it("round-trips: formatCaptureError rebuilds the exact recorded bytes", () => {
    const smoke = loadRealSmoke();
    for (const key of Object.keys(smoke.rendered)) {
      const value = smoke.rendered[key];
      if (isCaptureErrorSentinel(value)) {
        const { errorClass, message } = parseCapturedError(value);
        expect(formatCaptureError(errorClass, message)).toBe(value);
      }
    }
  });

  it("rejects non-sentinel input to parseCapturedError", () => {
    expect(() => parseCapturedError("plain text")).toThrow(/not a capture-error sentinel/);
    expect(() => parseCapturedError(`${CAPTURE_ERROR_PREFIX} no separator`)).toThrow(
      /missing "class: message" form/
    );
  });
});

describe("canonicalJson + expectation shapers", () => {
  it("sorts object keys deeply, compactly", () => {
    expect(canonicalJson({ b: { d: 1, c: [ { z: 1, a: 2 } ] }, a: 1 })).toBe(
      '{"a":1,"b":{"c":[{"a":2,"z":1}],"d":1}}'
    );
  });

  it("rejects non-JSON values loudly", () => {
    expect(() => canonicalJson({ bad: undefined })).toThrow(/undefined value at \$\.bad/);
  });

  it("shapes the name-algebra expectation from a card record", () => {
    const smoke = loadRealSmoke();
    const record = smoke.cards["Oracle Junction+child_one"];
    expect(nameAlgebraExpectation(record)).toEqual({
      key: "oracle_junction+child_one",
      left: "Oracle Junction",
      right: "child_one",
    });
  });

  it("strips only the id for the card-record expectation", () => {
    const smoke = loadRealSmoke();
    const record = smoke.cards["Oracle Basics"];
    expect(cardRecordWithoutId(record)).toEqual({
      codename: null,
      content: "A plain basic card for oracle capture.",
      key: "oracle_basic",
      left: null,
      name: "Oracle Basics",
      right: null,
      type: "RichText",
      type_code: "basic",
    });
  });
});
