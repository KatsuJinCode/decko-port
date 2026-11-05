import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { planEvents } from "../../../tools/compat-report/behaviour-probes.mjs";
import { summariseProbes } from "../../../tools/compat-report/behaviour.mjs";
import { normalizeForRecord, normalizeHtml } from "../normalize.mjs";
import { makeFixture, runFake } from "./helpers.mjs";
import { writeFixtureManifest } from "../manifest.mjs";
import { importCapture } from "../../../tools/compat-report/import-probe-capture.mjs";

test("each event gets a separate scenario with action-specific baselines", () => {
  const declarations = ["create", "update", "delete"].map((on) => ({ event: `on_${on}`, on, set: { pattern: "all" }, file: "set/all/example.rb" }));
  const { plan, scenarios } = planEvents({ cards: [] }, declarations);
  assert.equal(new Set(scenarios.map((s) => s.id)).size, 3);
  for (const p of plan) {
    const scenario = scenarios.find((s) => s.id === p.scenario);
    assert.deepEqual(scenario.steps.slice(...[p.baseline.steps[0], p.baseline.steps[1] + 1]).map((s) => s.action), ["create", "update", "delete"]);
    assert.ok(scenario.steps.some((s) => s.action === p.on && s.card === p.card));
  }
});

test("concurrent fresh sessions preserve sequential scenario bytes and output order", () => {
  const root = mkdtempSync(join(tmpdir(), "decko-mod-workers-test-"));
  try {
    const fixture = makeFixture(root);
    const sequential = join(root, "sequential");
    const concurrent = join(root, "concurrent");
    for (const [out, workers] of [[sequential, "1"], [concurrent, "2"]]) {
      const run = runFake(fixture, out, { extraArgs: ["--kinds", "scenarios", "--scenario-workers", workers] });
      assert.equal(run.status, 0, run.stderr);
    }
    const answers = (out) => readFileSync(join(out, "scenarios.jsonl"), "utf8").trim().split("\n").map((line) => {
      const scenario = JSON.parse(line);
      for (const step of scenario.steps) if (step.result?.html) step.result.html = normalizeHtml(step.result.html);
      return scenario;
    });
    assert.deepEqual(answers(concurrent), answers(sequential));
    const meta = JSON.parse(readFileSync(join(concurrent, "run-meta.json"), "utf8"));
    assert.equal(meta.runs.scenarios.complete, true);
    assert.equal(meta.runs.scenarios.scenario_workers, 2);
    assert.equal(meta.runs.scenarios.session_timings.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fixture-name imports prove input identity and preserve original capture provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "decko-probe-import-test-"));
  try {
    const sourceFixture = makeFixture(root);
    const targetFixture = join(root, "tiny-v2");
    cpSync(sourceFixture, targetFixture, { recursive: true });
    writeFixtureManifest(targetFixture);
    const capture = join(root, "capture");
    const run = runFake(sourceFixture, capture);
    assert.equal(run.status, 0, run.stderr);
    const original = readFileSync(join(capture, "run-meta.json"));
    const out = join(root, "imported");
    const provenance = importCapture({ sourceFixture, targetFixture, capture, out, role: "actual" });
    assert.equal(provenance.source_fixture, "tiny-v1");
    assert.equal(provenance.target_fixture, "tiny-v2");
    assert.equal(provenance.source_fixture_digest, provenance.target_fixture_digest);
    assert.deepEqual(readFileSync(join(out, "capture-provenance/run-meta.original.json")), original);
    assert.deepEqual(readFileSync(join(out, "scenarios.jsonl")), readFileSync(join(capture, "scenarios.jsonl")));
    assert.throws(() => importCapture({ sourceFixture, targetFixture, capture, out: join(root, "not-oracle") }), /not the canonical Ruby/);
    const meta = JSON.parse(original);
    meta.runs.scenarios.selection = { filter: "x" };
    writeFileSync(join(capture, "run-meta.json"), JSON.stringify(meta));
    assert.throws(() => importCapture({ sourceFixture, targetFixture, capture, out: join(root, "partial"), role: "actual" }), /incomplete or filtered/);
    writeFileSync(join(capture, "run-meta.json"), original);
    writeFileSync(join(targetFixture, "ops/render.jsonl"), "");
    writeFixtureManifest(targetFixture);
    assert.throws(() => importCapture({ sourceFixture, targetFixture, capture, out: join(root, "changed"), role: "actual" }), /input hashes differ/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("User creation carries actual nested account/email/password writes", () => {
  const index = { cards: [{ name: "User", facts: { codename: "user", compound: false, type: "cardtype" } }] };
  const { scenarios } = planEvents(index, [{ event: "account", on: "create", set: { pattern: "type", anchor: "user" } }]);
  const writes = scenarios[0].steps.filter((s) => s.action === "create");
  for (const write of writes) {
    assert.match(write.fields.fields["+*account"].fields["+*email"], /@example.test$/);
    assert.equal(typeof write.fields.fields["+*account"].fields["+*password"], "string");
  }
});

const step = (count) => ({ result: { saved: true }, rows: { cards: { inserted: Array.from({ length: count }, () => ({})), updated: [], deleted: [] } } });
function eventEvidence(on, baseline, setup, action, { fixtureName = "synthetic-v2-mod-probes", legacy = false, file = "set/all/example.rb" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "decko-mod-probe-test-"));
  try {
    const expected = join(root, "reference-harness/fixtures", fixtureName, "expected");
    mkdirSync(expected, { recursive: true });
    writeFileSync(join(expected, "scenarios.jsonl"), JSON.stringify({ id: legacy ? "mod-event-probes" : "probe-e1", steps: [...baseline, setup, action] }) + "\n");
    const baseLabels = baseline.length === 3 ? [{ action: "create" }, { action: "update" }, { action: on }] : [{ action: "create" }, { action: on }];
    const probes = { render: { plan: [] }, events: { plan: [{ status: "planned", event: "example", file, scenario: "probe-e1", probe: "e1", on, steps: [baseline.length, baseline.length + 1], baseline: { steps: [0, baseline.length - 1] }, labels: [...baseLabels, { action: "create" }, { action: on }] }] } };
    if (legacy) {
      probes.step_labels = probes.events.plan[0].labels;
      delete probes.events.plan[0].labels;
      delete probes.events.plan[0].scenario;
    }
    return summariseProbes(root, { fixture: fixtureName, verdict: "pass", failures: {}, summary: {} }, probes).events.example.evidence;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("setup creation cannot prove a delete event fired", () => {
  assert.equal(eventEvidence("delete", [step(1), step(0)], step(2), step(0)), "not-observed");
});

test("an extra baseline update cannot prove a delete event fired", () => {
  assert.equal(eventEvidence("delete", [step(1), step(1), step(0)], step(1), step(1)), "not-observed");
});

test("a plain-card row difference cannot establish an abstract callback", () => {
  assert.equal(eventEvidence("update", [step(1), step(0)], step(1), step(1), { file: "set/abstract/attachment/local.rb" }), "not-observed");
});

test("an update is compared with its update baseline", () => {
  assert.equal(eventEvidence("update", [step(1), step(0)], step(1), step(1)), "graded-identical");
});

test("versioned fixtures and published monolithic plans remain readable", () => {
  assert.equal(eventEvidence("update", [step(1), step(0)], step(1), step(1), { fixtureName: "synthetic-v3-mod-probes-ruby33" }), "graded-identical");
  assert.equal(eventEvidence("update", [step(1), step(0)], step(1), step(1), { legacy: true }), "graded-identical");
});

test("a baseline exception cannot prove an event fired", () => {
  assert.equal(eventEvidence("update", [step(1), { error: { class: "Error", message: "invalid baseline" } }], step(1), step(0)), "not-observed");
});

test("partial and invalid grades cannot produce completion claims", () => {
  for (const verdict of ["partial", "invalid", undefined]) {
    assert.throws(() => summariseProbes("unused", { verdict }, {}), /complete valid grade/);
  }
});

test("record-time rules remove frame paths and preserve all other canonical forms", () => {
  const html = '<p class="z a" data-slot-id="0123456789abcdef0123">before 2 days ago after</p><span title="&lt;h3&gt;Error message (visible to admin only)&lt;/h3&gt;&lt;p&gt;broken&lt;/p&gt;&lt;div&gt;C:/capture-host/secret.rb:7&lt;/div&gt;">x</span>';
  const recorded = normalizeForRecord({ html }).html;
  assert.ok(recorded.includes('class="z a"'));
  assert.ok(recorded.includes('data-slot-id="0123456789abcdef0123"'));
  assert.ok(recorded.includes("before 2 days ago after"));
  assert.ok(recorded.includes("N6#frames"));
  assert.ok(!recorded.includes("secret.rb"));
  assert.equal(normalizeHtml(recorded), normalizeHtml(html));
  const objectAddress = '<p title="#&lt;Card:0x000012345678abcd&gt;">#&lt;Card:0x000012345678abcd&gt;</p>';
  assert.equal(normalizeForRecord({ html: objectAddress }).html, objectAddress);
  const applied = new Set();
  normalizeHtml(objectAddress, { applied });
  assert.ok(applied.has("N9"));
});
