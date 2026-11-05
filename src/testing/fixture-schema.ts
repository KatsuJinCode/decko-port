import { readFileSync } from "node:fs";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const CAPTURE_ERROR_PREFIX = "CAPTURE_ERROR:";

export interface CapturedCardRecord {
  codename: string | null;
  content: string;
  id: number;
  key: string;
  left: string | null;
  name: string;
  right: string | null;
  type: string;
  type_code: string;
}

export type CardRecordWithoutId = Omit<CapturedCardRecord, "id">;

export interface ReadRuleFixture {
  target: string;
  set_card: string;
  rule_card: string;
  rule_type: string;
  rule_content: string;
  effective_readers: string[];
  anonymous_can_read: boolean;
  admin_can_read: boolean;
}

export interface SmokeFixture {
  card_count_after_seed: number;
  cards: Record<string, CapturedCardRecord>;
  rendered: Record<string, string>;
  cql_search: Record<string, string[] | CaptureErrorSentinel>;
  read_rule: ReadRuleFixture;
}

export type CaptureErrorSentinel = string;

export interface CqlQueryCase {
  query: { [key: string]: JsonValue };
  result: string[] | CaptureErrorSentinel;
}

export interface CqlBasicFixture {
  queries: Record<string, CqlQueryCase>;
}

export function isCaptureErrorSentinel(value: unknown): value is CaptureErrorSentinel {
  return typeof value === "string" && value.startsWith(CAPTURE_ERROR_PREFIX);
}

export function parseCapturedError(sentinel: string): { errorClass: string; message: string } {
  const preview = JSON.stringify(sentinel.slice(0, 80));
  if (!isCaptureErrorSentinel(sentinel)) {
    throw new Error(`not a capture-error sentinel: ${preview}`);
  }
  const rest = sentinel.slice(CAPTURE_ERROR_PREFIX.length).trim();
  const separator = rest.indexOf(": ");
  if (separator === -1) {
    throw new Error(`capture-error sentinel missing "class: message" form: ${JSON.stringify(rest)}`);
  }
  return { errorClass: rest.slice(0, separator), message: rest.slice(separator + 2) };
}

export function formatCaptureError(errorClass: string, message: string): CaptureErrorSentinel {
  return `${CAPTURE_ERROR_PREFIX} ${errorClass}: ${message}`;
}

export interface RenderedEntryKey {
  cardName: string;
  view: string;
}

export function parseRenderedKey(key: string): RenderedEntryKey {
  const hash = key.indexOf("#");
  if (hash === -1 || hash === 0 || hash === key.length - 1) {
    throw new Error(`rendered key must be "Card Name#view", got: ${JSON.stringify(key)}`);
  }
  return { cardName: key.slice(0, hash), view: key.slice(hash + 1) };
}

export const UNKNOWN_VIEW_LABEL = "unknown_view_sentinel";
export const UNKNOWN_VIEW_INPUT = "definitely_not_a_view";

export function renderedViewInput(viewLabel: string): string {
  return viewLabel === UNKNOWN_VIEW_LABEL ? UNKNOWN_VIEW_INPUT : viewLabel;
}

function assertJson(value: unknown, at: string): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => assertJson(item, `${at}[${i}]`));
  }
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) {
        throw new Error(`canonicalJson: undefined value at ${at}.${key} (handlers must return JSON-serializable data)`);
      }
      out[key] = assertJson(item, `${at}.${key}`);
    }
    return out;
  }
  throw new Error(`canonicalJson: non-JSON value (${typeof value}) at ${at}`);
}

export function canonicalJson(value: unknown): string {
  const sorted = (input: JsonValue): JsonValue => {
    if (Array.isArray(input)) return input.map(sorted);
    if (input !== null && typeof input === "object") {
      const out: { [key: string]: JsonValue } = {};
      for (const key of Object.keys(input).sort()) {
        out[key] = sorted(input[key]);
      }
      return out;
    }
    return input;
  };
  return JSON.stringify(sorted(assertJson(value, "$")));
}

export interface NameAlgebraExpectation {
  key: string;
  left: string | null;
  right: string | null;
}

export function nameAlgebraExpectation(record: CapturedCardRecord): NameAlgebraExpectation {
  return { key: record.key, left: record.left, right: record.right };
}

export function cardRecordWithoutId(record: CapturedCardRecord): CardRecordWithoutId {
  const { id, ...rest } = record;
  void id;
  return rest;
}

export type FixtureKind = "smoke" | "cql-basic";

export interface LoadedFixture {
  path: string;
  kind: FixtureKind;
  data: SmokeFixture | CqlBasicFixture;
}

export class FixtureValidationError extends Error {
  constructor(message: string) {
    super(`fixture validation failed: ${message}`);
    this.name = "FixtureValidationError";
  }
}

function fail(at: string, problem: string): never {
  throw new FixtureValidationError(`${at}: ${problem}`);
}

function assertObject(value: unknown, at: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(at, `expected object, got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  at: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  const missing = wanted.filter((key) => !(key in value));
  const extra = actual.filter((key) => !wanted.includes(key));
  if (missing.length > 0) fail(at, `missing key(s): ${missing.join(", ")}`);
  if (extra.length > 0) fail(at, `unexpected key(s): ${extra.join(", ")} (schema is exact; update fixture-schema deliberately if the capture format changed)`);
}

function assertString(value: unknown, at: string): string {
  if (typeof value !== "string") fail(at, `expected string, got ${typeof value}`);
  return value;
}

function assertNullableString(value: unknown, at: string): string | null {
  if (value === null) return null;
  return assertString(value, at);
}

function assertNumber(value: unknown, at: string): number {
  if (typeof value !== "number") fail(at, `expected number, got ${typeof value}`);
  return value;
}

function assertBoolean(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") fail(at, `expected boolean, got ${typeof value}`);
  return value;
}

function assertStringRecord(value: unknown, at: string): Record<string, string> {
  const record = assertObject(value, at);
  for (const [key, item] of Object.entries(record)) {
    assertString(item, `${at}[${JSON.stringify(key)}]`);
  }
  return record as Record<string, string>;
}

function assertResultValue(
  value: unknown,
  at: string,
  sentinelAllowed: boolean
): string[] | CaptureErrorSentinel {
  if (Array.isArray(value)) {
    return value.map((item, i) => assertString(item, `${at}[${i}]`));
  }
  if (sentinelAllowed && isCaptureErrorSentinel(value)) {
    return value;
  }
  fail(
    at,
    sentinelAllowed
      ? `expected string[] or a "${CAPTURE_ERROR_PREFIX}..." sentinel, got ${typeof value}`
      : `expected string[], got ${typeof value}`
  );
}

const CARD_RECORD_KEYS = [
  "codename",
  "content",
  "id",
  "key",
  "left",
  "name",
  "right",
  "type",
  "type_code",
] as const;

function assertCardRecord(value: unknown, at: string): CapturedCardRecord {
  const obj = assertObject(value, at);
  assertExactKeys(obj, CARD_RECORD_KEYS, at);
  return {
    codename: assertNullableString(obj.codename, `${at}.codename`),
    content: assertString(obj.content, `${at}.content`),
    id: assertNumber(obj.id, `${at}.id`),
    key: assertString(obj.key, `${at}.key`),
    left: assertNullableString(obj.left, `${at}.left`),
    name: assertString(obj.name, `${at}.name`),
    right: assertNullableString(obj.right, `${at}.right`),
    type: assertString(obj.type, `${at}.type`),
    type_code: assertString(obj.type_code, `${at}.type_code`),
  };
}

const READ_RULE_KEYS = [
  "admin_can_read",
  "anonymous_can_read",
  "effective_readers",
  "rule_card",
  "rule_content",
  "rule_type",
  "set_card",
  "target",
] as const;

function assertReadRule(value: unknown, at: string): ReadRuleFixture {
  const obj = assertObject(value, at);
  assertExactKeys(obj, READ_RULE_KEYS, at);
  const readers = obj.effective_readers;
  if (!Array.isArray(readers)) fail(`${at}.effective_readers`, `expected array, got ${typeof readers}`);
  return {
    target: assertString(obj.target, `${at}.target`),
    set_card: assertString(obj.set_card, `${at}.set_card`),
    rule_card: assertString(obj.rule_card, `${at}.rule_card`),
    rule_type: assertString(obj.rule_type, `${at}.rule_type`),
    rule_content: assertString(obj.rule_content, `${at}.rule_content`),
    effective_readers: readers.map((name, i) => assertString(name, `${at}.effective_readers[${i}]`)),
    anonymous_can_read: assertBoolean(obj.anonymous_can_read, `${at}.anonymous_can_read`),
    admin_can_read: assertBoolean(obj.admin_can_read, `${at}.admin_can_read`),
  };
}

const SMOKE_TOP_KEYS = ["card_count_after_seed", "cards", "cql_search", "read_rule", "rendered"] as const;

export function validateSmokeFixture(value: unknown): SmokeFixture {
  const obj = assertObject(value, "$");
  assertExactKeys(obj, SMOKE_TOP_KEYS, "$");
  const cardsRaw = assertObject(obj.cards, "$.cards");
  const cards: Record<string, CapturedCardRecord> = {};
  for (const [name, record] of Object.entries(cardsRaw)) {
    cards[name] = assertCardRecord(record, `$.cards[${JSON.stringify(name)}]`);
  }
  return {
    card_count_after_seed: assertNumber(obj.card_count_after_seed, "$.card_count_after_seed"),
    cards,
    rendered: assertStringRecord(obj.rendered, "$.rendered"),
    cql_search: (() => {
      const raw = assertObject(obj.cql_search, "$.cql_search");
      const out: Record<string, string[] | CaptureErrorSentinel> = {};
      for (const [key, item] of Object.entries(raw)) {
        out[key] = assertResultValue(item, `$.cql_search[${JSON.stringify(key)}]`, true);
      }
      return out;
    })(),
    read_rule: assertReadRule(obj.read_rule, "$.read_rule"),
  };
}

const CQL_TOP_KEYS = ["queries"] as const;

export function validateCqlBasicFixture(value: unknown): CqlBasicFixture {
  const obj = assertObject(value, "$");
  assertExactKeys(obj, CQL_TOP_KEYS, "$");
  const queriesRaw = assertObject(obj.queries, "$.queries");
  const queries: Record<string, CqlQueryCase> = {};
  for (const [name, caseRaw] of Object.entries(queriesRaw)) {
    const at = `$.queries[${JSON.stringify(name)}]`;
    const caseObj = assertObject(caseRaw, at);
    assertExactKeys(caseObj, ["query", "result"], at);
    queries[name] = {
      query: assertObject(caseObj.query, `${at}.query`) as { [key: string]: JsonValue },
      result: assertResultValue(caseObj.result, `${at}.result`, true),
    };
  }
  return { queries };
}

export function detectFixtureKind(value: unknown): FixtureKind {
  const obj = assertObject(value, "$");
  const hasCards = "cards" in obj;
  const hasQueries = "queries" in obj;
  if (hasCards && !hasQueries) return "smoke";
  if (hasQueries && !hasCards) return "cql-basic";
  fail("$", `cannot identify fixture (cards=${hasCards}, queries=${hasQueries}; expected exactly one of the two)`);
}

export function validateFixture(kind: FixtureKind, value: unknown): SmokeFixture | CqlBasicFixture {
  return kind === "smoke" ? validateSmokeFixture(value) : validateCqlBasicFixture(value);
}

export function loadFixtureFile(path: string): LoadedFixture {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new FixtureValidationError(`cannot read ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new FixtureValidationError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  const kind = detectFixtureKind(parsed);
  return { path, kind, data: validateFixture(kind, parsed) };
}
