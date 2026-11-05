import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIXTURE_PATHS,
  HandlerRegistry,
  collectReplayEntries,
  formatReplayFailure,
  formatReplayReport,
  raisedError,
  renderBytes,
  replayEntries,
  replayFixtureFiles,
  jsonValue,
  type HandlerOutcome,
  type ReplayEntryResult,
} from "../../src/testing/replay.js";
import {
  UNKNOWN_VIEW_INPUT,
  canonicalJson,
  isCaptureErrorSentinel,
  parseCapturedError,
  validateCqlBasicFixture,
  validateSmokeFixture,
  type SmokeFixture,
} from "../../src/testing/fixture-schema.js";
import { RANDOMIZED_SLOT_ATTRIBUTE } from "../../src/testing/diff.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SMOKE_PATH = join(repoRoot, "fixtures", "captured", "smoke.json");
const CQL_PATH = join(repoRoot, "fixtures", "captured", "cql-basic.json");

const smoke: SmokeFixture = validateSmokeFixture(JSON.parse(readFileSync(SMOKE_PATH, "utf8")));
const cql = validateCqlBasicFixture(JSON.parse(readFileSync(CQL_PATH, "utf8")));

const allEntries = collectReplayEntries([
  { path: SMOKE_PATH, kind: "smoke", data: smoke },
  { path: CQL_PATH, kind: "cql-basic", data: cql },
]);

/** Simulates an engine: stamps a fresh random slot id into every placeholder. */
function stampRandomSlotIds(html: string): string {
  return html.replace(RANDOMIZED_SLOT_ATTRIBUTE, () => {
    const id = Array.from({ length: 20 }, () => "0123456789abcdef"[(Math.random() * 16) | 0]).join("");
    return `data-slot-id="${id}"`;
  });
}

interface FakeEngines {
  /** Fresh registry when omitted. */
  registry?: HandlerRegistry;
  /** Mutate the render output before it is returned (for failure cases). */
  mutateRender?: (cardName: string, view: string, html: string) => string;
  /** Replace the cql result for mutation cases. */
  cqlOverride?: (query: { [key: string]: unknown }) => HandlerOutcome;
  /** Replace the name outcome for strictness cases. */
  nameOverride?: (name: string) => HandlerOutcome;
}

const cqlResultByQuery = new Map<string, string[] | string>();
for (const queryCase of Object.values(cql.queries)) {
  cqlResultByQuery.set(canonicalJson(queryCase.query), queryCase.result);
}

function fakeEngines(options: FakeEngines = {}): HandlerRegistry {
  const registry = options.registry ?? new HandlerRegistry();
  registry.register("name-engine", ({ name }) => {
    if (options.nameOverride) return options.nameOverride(name);
    const record = smoke.cards[name];
    if (!record) throw new Error(`fake name-engine: unexpected card ${name}`);
    return jsonValue({ key: record.key, left: record.left, right: record.right });
  });
  registry.register("card-engine", ({ name }) => {
    const record = smoke.cards[name];
    if (!record) throw new Error(`fake card-engine: unexpected card ${name}`);
    return jsonValue(record); // includes the informational id; the harness strips it
  });
  registry.register("cql-engine", ({ query }) => {
    if (options.cqlOverride) return options.cqlOverride(query);
    const result = cqlResultByQuery.get(canonicalJson(query));
    if (result === undefined) throw new Error(`fake cql-engine: unexpected query ${canonicalJson(query)}`);
    // Mirror a real engine: the query either returns names or raises. A
    // recorded sentinel replays as raisedError - wrapping the sentinel
    // string as json output is NOT the same outcome (strict harness rule).
    if (isCaptureErrorSentinel(result)) {
      const { errorClass, message } = parseCapturedError(result);
      return raisedError(errorClass, message);
    }
    return jsonValue(result);
  });
  registry.register("render-engine", ({ cardName, view }) => {
    if (view === UNKNOWN_VIEW_INPUT) {
      // The recorded sentinel: CAPTURE_ERROR: Card::Error::UserError: view (...) not supported ...
      return raisedError(
        "Card::Error::UserError",
        `view (${view}) not supported for ${cardName}`
      );
    }
    const html = smoke.rendered[`${cardName}#${view}`];
    if (html === undefined) throw new Error(`fake render-engine: unexpected ${cardName}#${view}`);
    const output = options.mutateRender ? options.mutateRender(cardName, view, html) : stampRandomSlotIds(html);
    return renderBytes(output);
  });
  return registry;
}

const SAMPLE_IDS = [
  "smoke:cards:Oracle Basics:name-algebra",
  "smoke:cards:Oracle Basics:record",
  "smoke:rendered:Oracle Basics#title",
  "smoke:rendered:Oracle Basics#open",
  "smoke:rendered:Oracle Basics#unknown_view_sentinel",
  "cql-basic:queries:left_children",
];

const sampleEntries = () => allEntries.filter((entry) => SAMPLE_IDS.includes(entry.id));

describe("replay machinery over real smoke.json / cql-basic.json entries", () => {
  it("collects 52 entries from the committed fixtures (41 smoke + 11 cql)", () => {
    expect(allEntries).toHaveLength(52);
    const byArea = new Map<string, number>();
    for (const entry of allEntries) {
      byArea.set(entry.area, (byArea.get(entry.area) ?? 0) + 1);
    }
    expect(byArea.get("name-engine")).toBe(10);
    expect(byArea.get("card-engine")).toBe(10);
    expect(byArea.get("render-engine")).toBe(20);
    expect(byArea.get("rules-engine")).toBe(1);
    expect(byArea.get("cql-engine")).toBe(11);
    // smoke.cql_search has no canonical query input and is deliberately not replayable
    expect(allEntries.some((entry) => entry.id.includes("cql_search"))).toBe(false);
  });

  it("passes the hand-picked sample when fake handlers return recorded bytes", async () => {
    const report = await replayEntries(sampleEntries(), fakeEngines());
    expect(report.summary).toEqual({ total: 6, pass: 6, fail: 0, pending: 0 });
    expect(report.entries.every((entry) => entry.status === "pass")).toBe(true);
  });

  it("matches engine output with fresh random slot ids against fixture placeholder bytes", async () => {
    // The #open entry carries data-slot-id="RANDOMIZED" in the fixture; the fake
    // handler emits a real 20-hex id. Only the mirrored normalization closes that gap.
    const entry = allEntries.find((e) => e.id === "smoke:rendered:Oracle Basics#open");
    expect(entry).toBeDefined();
    expect(smoke.rendered["Oracle Basics#open"]).toContain(RANDOMIZED_SLOT_ATTRIBUTE);
    const report = await replayEntries([entry!], fakeEngines());
    expect(report.summary.pass).toBe(1);
  });

  it("passes a recorded error sentinel when the handler reports the equivalent raise", async () => {
    const entry = allEntries.find((e) => e.id === "smoke:rendered:Oracle Basics#unknown_view_sentinel");
    const report = await replayEntries([entry!], fakeEngines());
    expect(report.summary.pass).toBe(1);
  });

  it("fails with first-diff context (offset + excerpt) when bytes are mutated", async () => {
    const registry = fakeEngines({
      mutateRender: (_cardName, view, html) =>
        view === "title" ? html.replace("card-title", "card-titlz") : html,
    });
    const report = await replayEntries(sampleEntries(), registry);
    expect(report.summary.fail).toBe(1);
    const failed = report.entries.find((entry) => entry.status === "fail")!;
    expect(failed.id).toBe("smoke:rendered:Oracle Basics#title");

    const first = failed.diff!.firstDifference!;
    expect(failed.diff!.equal).toBe(false);
    expect(first.expectedChar).toBe('"e"');
    expect(first.actualChar).toBe('"z"');
    expect(first.byteOffset).toBe(first.codeUnitOffset); // ASCII prefix

    const message = formatReplayFailure(failed);
    expect(message).toContain(`FAIL ${failed.id} (render-engine)`);
    expect(message).toMatch(/first difference at code-unit offset 22 \(byte offset 22\): expected "e" but got "z"/);
    expect(message).toContain("expected excerpt:");
    expect(message).toContain("actual excerpt:");
    expect(message).toMatch(/card-title/); // expected side shows the recorded bytes
    expect(message).toMatch(/card-titlz/); // actual side shows the mutation
    expect(message).toMatch(/sizes: expected \d+ bytes, actual \d+ bytes/);
  });

  it("reports PENDING for areas with no handler and never fails on them", async () => {
    const registry = new HandlerRegistry(); // nothing registered
    const report = await replayEntries(sampleEntries(), registry);
    expect(report.summary).toEqual({ total: 6, pass: 0, fail: 0, pending: 6 });
    expect(report.entries.every((entry) => entry.pendingReason === 'no handler registered for area "name-engine"'
      || entry.pendingReason === 'no handler registered for area "card-engine"'
      || entry.pendingReason === 'no handler registered for area "cql-engine"'
      || entry.pendingReason === 'no handler registered for area "render-engine"')).toBe(true);

    const partial = new HandlerRegistry();
    partial.register("name-engine", ({ name }) => {
      const record = smoke.cards[name];
      return jsonValue({ key: record.key, left: record.left, right: record.right });
    });
    const partialReport = await replayEntries(sampleEntries(), partial);
    expect(partialReport.summary).toEqual({ total: 6, pass: 1, fail: 0, pending: 5 });
    const formatted = formatReplayReport(partialReport);
    expect(formatted).toContain("PENDING smoke:rendered:Oracle Basics#title");
    expect(formatted).toContain("PASS smoke:cards:Oracle Basics:name-algebra");
  });

  it("notes the shape mismatch when a handler raises where the fixture expects a result", async () => {
    const registry = fakeEngines({
      cqlOverride: () => raisedError("RuntimeError", "%{func} not implemented"),
    });
    const entry = allEntries.find((e) => e.id === "cql-basic:queries:left_children")!;
    const report = await replayEntries([entry], registry);
    expect(report.summary.fail).toBe(1);
    const failed = report.entries[0]!;
    expect(failed.detail).toBe(
      "handler raised RuntimeError: %{func} not implemented but the fixture expects a successful result"
    );
    // The diff still compares the reconstructed sentinel bytes against the fixture's array
    expect(failed.diff!.equal).toBe(false);
    expect(failed.diff!.actualBytes).toBe(
      failed.diff!.actualBytes // self-consistent; real content asserted via message below
    );
    const message = formatReplayFailure(failed);
    expect(message).toContain("handler raised RuntimeError: %{func} not implemented");
    // the reconstructed sentinel bytes were diffed against the fixture's array
    expect(failed.diff!.actualBytes).toBe(
      "CAPTURE_ERROR: RuntimeError: %{func} not implemented".length
    );
    expect(message).toContain("Oracle Junction+child_one");
  });

  it("notes the shape mismatch when the fixture expects a sentinel and the handler returns bytes", async () => {
    const entry = allEntries.find(
      (e) => e.id === "smoke:rendered:Oracle Junction#unknown_view_sentinel"
    )!;
    const registry = new HandlerRegistry();
    registry.register("render-engine", () => renderBytes("<div>rendered anyway</div>"));
    const report = await replayEntries([entry], registry);
    const failed = report.entries[0]!;
    expect(report.summary.fail).toBe(1);
    expect(failed.detail).toBe(
      "fixture expects a raised error (CAPTURE_ERROR sentinel) but the handler returned output"
    );
    expect(failed.diff!.equal).toBe(false);
  });

  it("enforces the exact name-engine contract: extra keys in the outcome fail", async () => {
    const registry = fakeEngines({
      nameOverride: (name) => {
        const record = smoke.cards[name];
        return jsonValue({ key: record.key, left: record.left, right: record.right, name });
      },
    });
    const entry = allEntries.find((e) => e.id === "smoke:cards:Oracle Basics:name-algebra")!;
    const report = await replayEntries([entry], registry);
    expect(report.summary.fail).toBe(1);
    expect(report.entries[0]!.diff!.equal).toBe(false);
  });

  it("treats the card id as informational: differing ids pass, differing content fails", async () => {
    const record = smoke.cards["Oracle Basics"];
    const entry = allEntries.find((e) => e.id === "smoke:cards:Oracle Basics:record")!;

    // a fake returning a record whose only difference is the id passes
    // (the harness strips the informational id from BOTH sides)
    const idOnlyRegistry = new HandlerRegistry();
    idOnlyRegistry.register("card-engine", () => jsonValue({ ...record, id: 999999 }));
    const idOnlyReport = await replayEntries([entry], idOnlyRegistry);
    expect(idOnlyReport.summary.pass).toBe(1);

    // a fake returning mutated content fails with a visible diff
    const contentRegistry = new HandlerRegistry();
    contentRegistry.register("card-engine", () => jsonValue({ ...record, content: "mutated" }));
    const contentReport = await replayEntries([entry], contentRegistry);
    expect(contentReport.summary.fail).toBe(1);
    expect(contentReport.entries[0]!.diff!.firstDifference).not.toBeNull();
  });

  it("replays the whole committed fixture set with fakes: 51 pass, 1 pending (rules-engine)", async () => {
    // DEFAULT_FIXTURE_PATHS are already absolute (cwd-independence fix,
    // commit 1ec2761); joining repoRoot onto an absolute path CONCATENATES
    // on win32 (path.join does not reset) and produced the doubled
    // C:\…decko-ts\C:\…decko-ts\fixtures\… path this test used to choke on.
    const report = await replayFixtureFiles(DEFAULT_FIXTURE_PATHS, fakeEngines());
    expect(report.summary).toEqual({ total: 52, pass: 51, fail: 0, pending: 1 });
    const pending = report.entries.find((entry) => entry.status === "pending")!;
    expect(pending.id).toBe("smoke:read_rule:Oracle Restricted");
    expect(pending.area).toBe("rules-engine");

    const formatted = formatReplayReport(report);
    expect(formatted).toContain("replay summary: 51 passed, 0 failed, 1 pending, 52 total");
    expect(formatted.split("\n").filter((line) => line.startsWith("PASS "))).toHaveLength(51);
  });

  it("rejects duplicate registration loudly", () => {
    const registry = new HandlerRegistry();
    registry.register("render-engine", () => renderBytes("x"));
    expect(() => registry.register("render-engine", () => renderBytes("y"))).toThrow(
      /already registered for area "render-engine"/
    );
  });

  it("formatReplayFailure rejects non-failed entries", () => {
    const passing: ReplayEntryResult = { id: "x", area: "render-engine", status: "pass" };
    expect(() => formatReplayFailure(passing)).toThrow(/is pass, not failed/);
  });

  it("sentinel round-trip: every rendered sentinel in the fixture replays via raisedError", async () => {
    const sentinelEntries = allEntries.filter(
      (entry) => entry.area === "render-engine" && isCaptureErrorSentinel(entry.expected as string)
    );
    expect(sentinelEntries).toHaveLength(4); // one unknown-view sentinel per rendered card
    const report = await replayEntries(sentinelEntries, fakeEngines());
    expect(report.summary).toEqual({ total: 4, pass: 4, fail: 0, pending: 0 });
  });
});
