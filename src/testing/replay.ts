import {
  canonicalJson,
  cardRecordWithoutId,
  formatCaptureError,
  isCaptureErrorSentinel,
  loadFixtureFile,
  parseRenderedKey,
  renderedViewInput,
  nameAlgebraExpectation,
  type CapturedCardRecord,
  type CardRecordWithoutId,
  type CqlBasicFixture,
  type CqlQueryCase,
  type CaptureErrorSentinel,
  type LoadedFixture,
  type NameAlgebraExpectation,
  type ReadRuleFixture,
  type SmokeFixture,
} from "./fixture-schema.js";
import { compareNormalized, type ByteDiffResult } from "./diff.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "captured"
);

export type HandlerOutcome =
  | { kind: "bytes"; bytes: string }
  | { kind: "json"; value: unknown }
  | { kind: "error"; errorClass: string; message: string };

export const renderBytes = (bytes: string): HandlerOutcome => ({ kind: "bytes", bytes });
export const jsonValue = (value: unknown): HandlerOutcome => ({ kind: "json", value });
export const raisedError = (errorClass: string, message: string): HandlerOutcome => ({
  kind: "error",
  errorClass,
  message,
});

export interface NameAlgebraCheck {
  id: string;
  area: "name-engine";
  input: { name: string };
  expected: NameAlgebraExpectation;
}

export interface CardRecordCheck {
  id: string;
  area: "card-engine";
  input: { name: string };
  expected: CardRecordWithoutId;
}

export interface CqlResultCheck {
  id: string;
  area: "cql-engine";
  input: { query: { [key: string]: unknown } };
  expected: string[] | CaptureErrorSentinel;
}

export interface RenderCheck {
  id: string;
  area: "render-engine";
  input: { cardName: string; view: string };
  expected: string;
}

export interface ReadRuleCheck {
  id: string;
  area: "rules-engine";
  input: { target: string };
  expected: ReadRuleFixture;
}

export type ReplayCheck =
  | NameAlgebraCheck
  | CardRecordCheck
  | CqlResultCheck
  | RenderCheck
  | ReadRuleCheck;

export type ReplayEntry = ReplayCheck;

export interface AreaHandlerMap {
  "name-engine": NameAlgebraCheck;
  "card-engine": CardRecordCheck;
  "cql-engine": CqlResultCheck;
  "render-engine": RenderCheck;
  "rules-engine": ReadRuleCheck;
}

export type AreaKey = keyof AreaHandlerMap;

export type ReplayHandler<K extends AreaKey> = (
  input: AreaHandlerMap[K]["input"]
) => HandlerOutcome | Promise<HandlerOutcome>;

type AnyHandler = (input: never) => HandlerOutcome | Promise<HandlerOutcome>;

export class HandlerRegistry {
  private handlers = new Map<AreaKey, AnyHandler>();

  register<K extends AreaKey>(area: K, handler: ReplayHandler<K>): void {
    if (this.handlers.has(area)) {
      throw new Error(`a handler is already registered for area "${area}"`);
    }
    this.handlers.set(area, handler as AnyHandler);
  }

  has(area: AreaKey): boolean {
    return this.handlers.has(area);
  }

  get<K extends AreaKey>(area: K): ReplayHandler<K> | undefined {
    const handler = this.handlers.get(area);
    return handler ? (handler as ReplayHandler<K>) : undefined;
  }

  registeredAreas(): AreaKey[] {
    return [...this.handlers.keys()].sort();
  }
}

function cardEntries(kind: string, name: string, record: CapturedCardRecord): ReplayEntry[] {
  return [
    {
      id: `${kind}:cards:${name}:name-algebra`,
      area: "name-engine",
      input: { name },
      expected: nameAlgebraExpectation(record),
    },
    {
      id: `${kind}:cards:${name}:record`,
      area: "card-engine",
      input: { name },
      expected: cardRecordWithoutId(record),
    },
  ];
}

function smokeEntries(fixture: SmokeFixture, kind: string): ReplayEntry[] {
  const entries: ReplayEntry[] = [];
  for (const [name, record] of Object.entries(fixture.cards)) {
    entries.push(...cardEntries(kind, name, record));
  }
  for (const [key, html] of Object.entries(fixture.rendered)) {
    const { cardName, view: viewLabel } = parseRenderedKey(key);
    entries.push({
      id: `${kind}:rendered:${key}`,
      area: "render-engine",
      input: { cardName, view: renderedViewInput(viewLabel) },
      expected: html,
    });
  }
  entries.push({
    id: `${kind}:read_rule:${fixture.read_rule.target}`,
    area: "rules-engine",
    input: { target: fixture.read_rule.target },
    expected: fixture.read_rule,
  });
  return entries;
}

function cqlBasicEntries(fixture: CqlBasicFixture, kind: string): ReplayEntry[] {
  return Object.entries(fixture.queries).map(([caseName, queryCase]: [string, CqlQueryCase]) => ({
    id: `${kind}:queries:${caseName}`,
    area: "cql-engine" as const,
    input: { query: queryCase.query },
    expected: queryCase.result,
  }));
}

export function collectReplayEntries(fixtures: LoadedFixture[]): ReplayEntry[] {
  const entries: ReplayEntry[] = [];
  for (const loaded of fixtures) {
    if (loaded.kind === "smoke") {
      entries.push(...smokeEntries(loaded.data as SmokeFixture, loaded.kind));
    } else {
      entries.push(...cqlBasicEntries(loaded.data as CqlBasicFixture, loaded.kind));
    }
  }
  return entries;
}

export const DEFAULT_FIXTURE_PATHS = [
  path.join(FIXTURES_DIR, "smoke.json"),
  path.join(FIXTURES_DIR, "cql-basic.json"),
];

function expectedBytes(entry: ReplayCheck): string {
  switch (entry.area) {
    case "name-engine":
      return canonicalJson(entry.expected);
    case "card-engine":
      return canonicalJson(entry.expected);
    case "cql-engine":
      return typeof entry.expected === "string" ? entry.expected : canonicalJson(entry.expected);
    case "render-engine":
      return entry.expected;
    case "rules-engine":
      return canonicalJson(entry.expected);
  }
}

function actualBytes(entry: ReplayCheck, outcome: HandlerOutcome): string {
  if (outcome.kind === "error") {
    return formatCaptureError(outcome.errorClass, outcome.message);
  }
  if (outcome.kind === "bytes") {
    return outcome.bytes;
  }
  if (entry.area === "card-engine" && outcome.value !== null && typeof outcome.value === "object") {
    return canonicalJson(cardRecordWithoutId(outcome.value as CapturedCardRecord));
  }
  return canonicalJson(outcome.value);
}

function shapeMismatchNote(entry: ReplayCheck, outcome: HandlerOutcome): string | undefined {
  const expectsSentinel =
    (entry.area === "cql-engine" && typeof entry.expected === "string") ||
    (entry.area === "render-engine" && isCaptureErrorSentinel(entry.expected));
  if (expectsSentinel && outcome.kind !== "error") {
    return "fixture expects a raised error (CAPTURE_ERROR sentinel) but the handler returned output";
  }
  if (!expectsSentinel && outcome.kind === "error") {
    return `handler raised ${outcome.errorClass}: ${outcome.message} but the fixture expects a successful result`;
  }
  return undefined;
}

export type ReplayEntryStatus = "pass" | "fail" | "pending";

export interface ReplayEntryResult {
  id: string;
  area: AreaKey;
  status: ReplayEntryStatus;
  diff?: ByteDiffResult;
  detail?: string;
  pendingReason?: string;
}

export interface ReplayReport {
  entries: ReplayEntryResult[];
  summary: { total: number; pass: number; fail: number; pending: number };
}

function judge(entry: ReplayCheck, outcome: HandlerOutcome): ReplayEntryResult {
  const diff = compareNormalized(expectedBytes(entry), actualBytes(entry, outcome));
  return {
    id: entry.id,
    area: entry.area,
    status: diff.equal ? "pass" : "fail",
    ...(diff.equal ? {} : { diff, detail: shapeMismatchNote(entry, outcome) }),
  };
}

function pendingResult(entry: ReplayCheck): ReplayEntryResult {
  return {
    id: entry.id,
    area: entry.area,
    status: "pending",
    pendingReason: `no handler registered for area "${entry.area}"`,
  };
}

async function runEntry(entry: ReplayCheck, registry: HandlerRegistry): Promise<ReplayEntryResult> {
  if (!registry.has(entry.area)) {
    return pendingResult(entry);
  }
  switch (entry.area) {
    case "name-engine":
      return judge(entry, await registry.get(entry.area)!(entry.input));
    case "card-engine":
      return judge(entry, await registry.get(entry.area)!(entry.input));
    case "cql-engine":
      return judge(entry, await registry.get(entry.area)!(entry.input));
    case "render-engine":
      return judge(entry, await registry.get(entry.area)!(entry.input));
    case "rules-engine":
      return judge(entry, await registry.get(entry.area)!(entry.input));
  }
}

export async function replayEntries(
  entries: ReplayEntry[],
  registry: HandlerRegistry
): Promise<ReplayReport> {
  const results: ReplayEntryResult[] = [];
  for (const entry of entries) {
    results.push(await runEntry(entry, registry));
  }
  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    pending: results.filter((r) => r.status === "pending").length,
  };
  return { entries: results, summary };
}

export async function replayFixtureFiles(
  paths: string[],
  registry: HandlerRegistry
): Promise<ReplayReport> {
  const fixtures = paths.map((path) => loadFixtureFile(path));
  return replayEntries(collectReplayEntries(fixtures), registry);
}

export function formatReplayFailure(result: ReplayEntryResult): string {
  if (result.status !== "fail") {
    throw new Error(`formatReplayFailure: entry ${result.id} is ${result.status}, not failed`);
  }
  const lines: string[] = [];
  lines.push(`FAIL ${result.id} (${result.area})`);
  if (result.detail) {
    lines.push(`  ${result.detail}`);
  }
  if (result.diff?.firstDifference) {
    const first = result.diff.firstDifference;
    lines.push(
      `  first difference at code-unit offset ${first.codeUnitOffset} (byte offset ${first.byteOffset}): expected ${first.expectedChar} but got ${first.actualChar}`
    );
    lines.push(`  expected excerpt: ${first.expectedExcerpt}`);
    lines.push(`  actual excerpt:   ${first.actualExcerpt}`);
    lines.push(
      `  sizes: expected ${result.diff.expectedBytes} bytes, actual ${result.diff.actualBytes} bytes`
    );
  }
  return lines.join("\n");
}

export function formatReplayReport(report: ReplayReport): string {
  const lines: string[] = [];
  for (const entry of report.entries) {
    if (entry.status === "pass") {
      lines.push(`PASS ${entry.id}`);
    } else if (entry.status === "pending") {
      lines.push(`PENDING ${entry.id} (${entry.pendingReason})`);
    } else {
      lines.push(formatReplayFailure(entry));
    }
  }
  const { total, pass, fail, pending } = report.summary;
  lines.push(`replay summary: ${pass} passed, ${fail} failed, ${pending} pending, ${total} total`);
  return lines.join("\n");
}
