import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { gradeSyntheticRun as gradeRun } from "./helpers.mjs";
import { writeExpectedManifest } from "../manifest.mjs";
import { HARNESS, SYNTHETIC_CANDIDATE, syntheticSourceBinding, copyDir, gradeCli, makeCapturedFixture, makeFixture, readJson, runFake, scratch, writeJson } from "./helpers.mjs";

let tmp;
let fixture;
let expected;
let good;

before(() => {
  tmp = scratch();
  ({ fixture, expected, actual: good } = makeCapturedFixture(tmp.dir));
});
after(() => tmp.cleanup());

let n = 0;
const copyGood = () => copyDir(good, path.join(tmp.dir, `case-${++n}`));
const grade = (actual, opts = {}) => gradeRun({ fixture, actual, ...opts });
const metaOf = (dir) => path.join(dir, "run-meta.json");

describe("positive control", () => {
  it("a complete run of an engine that matches passes, exit 0", () => {
    const report = grade(good);
    assert.deepEqual(report.problems, []);
    assert.equal(report.verdict, "pass");
    for (const k of ["rendering", "semantics", "persistence", "side_effects"]) assert.equal(report.summary[k].fail, 0, k);
    assert.equal(report.summary.rendering.graded, 4);
    assert.equal(report.read_writes.graded, 4);
    assert.equal(report.read_writes.pass, 4);
    assert.equal(gradeCli(["--fixture", fixture, "--actual", good]).status, 0);
  });

  it("a real rendering difference fails, exit 1", () => {
    const dir = path.join(tmp.dir, "wrong-html");
    assert.equal(runFake(fixture, dir, { mode: "wrong-html:Beta" }).status, 0);
    const report = grade(dir);
    assert.equal(report.verdict, "fail");
    assert.equal(report.summary.rendering.fail, 1);
    assert.equal(gradeCli(["--fixture", fixture, "--actual", dir]).status, 1);
  });
});

describe("reads that wrote (the read_writes grade)", () => {
  it("rows written by a read session fail the grade even when every answer matches", () => {
    const dir = path.join(tmp.dir, "read-writes");
    assert.equal(runFake(fixture, dir, { mode: "read-writes" }).status, 0);
    const report = grade(dir);
    assert.equal(report.summary.rendering.fail, 0, "the answers themselves still match");
    assert.equal(report.verdict, "fail");
    assert.deepEqual(report.read_writes.failures.map((f) => f.id), ["render session", "create-then-render#2"]);
    assert.ok(report.read_writes.failures[0].differences.some((d) => d.path === "/cards" && d.actual.inserted.length > 0));
    const cli = gradeCli(["--fixture", fixture, "--actual", dir]);
    assert.equal(cli.status, 1);
    assert.match(cli.stdout, /render session: wrote rows the oracle did not/);
  });

  it("rows written by a read step inside a write scenario fail the grade", () => {
    const dir = path.join(tmp.dir, "step-read-writes");
    assert.equal(runFake(fixture, dir, { mode: "step-read-writes" }).status, 0);
    const report = grade(dir);
    assert.equal(report.verdict, "fail");
    assert.deepEqual(report.read_writes.failures.map((f) => f.id), ["create-then-render#2"]);
  });

  it("an injected read-session write in the recorded metadata fails the grade", () => {
    const dir = copyGood();
    const meta = readJson(metaOf(dir));
    meta.runs.semantics.session_writes = { cards: { inserted: [{ id: 999999, name: "Unexpected read write" }], updated: [], deleted: [] } };
    writeJson(metaOf(dir), meta);
    const report = grade(dir);
    assert.equal(report.verdict, "fail");
    assert.deepEqual(report.read_writes.failures.map((f) => f.id), ["semantics session"]);
  });

  it("the reviewer's control (expected outputs copied, a read write added, nothing else) is not a pass", () => {
    const dir = copyDir(expected, path.join(tmp.dir, "reviewer"));
    rmSync(path.join(dir, "MANIFEST.json"));
    writeJson(metaOf(dir), {
      render_session_row_changes: { cards: { inserted: [{ id: 999999, name: "Unexpected read write" }] } },
      semantics_session_row_changes: {},
    });
    const report = grade(dir);
    assert.equal(report.verdict, "invalid");
    assert.notEqual(gradeCli(["--fixture", fixture, "--actual", dir]).status, 0);
  });
});

describe("write steps' other tables (the other_tables grade)", () => {
  const injectOtherTables = (dir, tables) => {
    const file = path.join(dir, "scenarios.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const scenario = lines.find((l) => l.id === "create-then-render");
    scenario.steps[0].other_tables = { ...scenario.steps[0].other_tables, ...tables };
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  };
  const syntheticSessions = { sessions: { inserted: [{ id: 999999, token: "synthetic" }], updated: [], deleted: [] } };

  it("the reviewer's control: a synthetic sessions insert on a write step fails the grade", () => {
    const dir = copyGood();
    injectOtherTables(dir, syntheticSessions);
    const report = grade(dir);
    assert.equal(report.verdict, "fail");
    assert.equal(report.other_tables.fail, 1);
    assert.deepEqual(report.other_tables.failures.map((f) => f.id), ["create-then-render#1"]);
    assert.deepEqual(report.other_tables.failures[0].tables, ["sessions"]);
    assert.equal(report.other_table_writes[0].verdict, "fail");
    const cli = gradeCli(["--fixture", fixture, "--actual", dir]);
    assert.equal(cli.status, 1);
    assert.match(cli.stdout, /create-then-render#1: wrote rows in tables outside the card tables/);
  });

  it("a declared difference is graded as declared and passes", () => {
    const dir = copyGood();
    injectOtherTables(dir, syntheticSessions);
    const declared = { "create-then-render#1": { sessions: "the engine keeps its own session rows" } };
    const report = grade(dir, { declaredOtherTables: declared });
    assert.equal(report.verdict, "pass");
    assert.equal(report.other_tables.declared, 1);
    assert.equal(report.other_table_writes[0].verdict, "declared");
    assert.deepEqual(report.other_table_writes[0].declared.map((d) => d.table), ["sessions"]);
    const file = path.join(tmp.dir, "declared-other-tables.json");
    writeJson(file, declared);
    assert.equal(gradeCli(["--fixture", fixture, "--actual", dir, "--declared-other-tables", file]).status, 0);
  });

  it("a table the oracle's schema does not have is reported as engine-only, not compared, matched or declared", () => {
    const dir = copyGood();
    const stamp = { deck_data_version: { inserted: [], updated: [{ id: 1, version: 2 }], deleted: [] } };
    injectOtherTables(dir, stamp);
    const report = grade(dir);
    assert.equal(report.verdict, "pass");
    assert.equal(report.other_tables.graded, 1);
    assert.equal(report.other_tables.pass, 1);
    assert.equal(report.other_tables.declared, 0);
    assert.equal(report.other_table_writes[0].actual.deck_data_version, undefined, "not part of the comparison");
    assert.deepEqual(report.engine_only_tables.tables, ["deck_data_version"]);
    assert.deepEqual(report.engine_only_tables.writes, [{ id: "create-then-render#1", table: "deck_data_version", delta: stamp.deck_data_version }]);
    const cli = gradeCli(["--fixture", fixture, "--actual", dir]);
    assert.equal(cli.status, 0);
    assert.match(cli.stdout, /engine-only\s+deck_data_version: tables the oracle's schema does not have/);
  });

  it("an engine-only table does not hide a difference in a table the oracle's schema has", () => {
    const dir = copyGood();
    injectOtherTables(dir, { ...syntheticSessions, deck_data_version: { inserted: [], updated: [{ id: 1, version: 2 }], deleted: [] } });
    const report = grade(dir);
    assert.equal(report.verdict, "fail");
    assert.deepEqual(report.other_tables.failures[0].tables, ["sessions"]);
    assert.deepEqual(report.engine_only_tables.tables, ["deck_data_version"]);
  });

  it("a declaration is keyed on the step id and the table: another step or table does not cover it", () => {
    for (const declared of [{ "create-then-render#2": { sessions: "another step" } }, { "create-then-render#1": { other: "another table" } }]) {
      const dir = copyGood();
      injectOtherTables(dir, syntheticSessions);
      assert.equal(grade(dir, { declaredOtherTables: declared }).verdict, "fail", JSON.stringify(declared));
    }
  });

  it("a declared difference that no longer occurs is stale and fails the grade (item 25)", () => {
    const dir = copyGood();
    const declared = { "create-then-render#1": { sessions: "the engine keeps its own session rows" } };
    const report = grade(dir, { declaredOtherTables: declared });
    assert.equal(report.verdict, "fail");
    assert.deepEqual(report.stale_declarations.map((s) => [s.id, s.table]), [["create-then-render#1", "sessions"]]);
    const file = path.join(tmp.dir, "stale-declared.json");
    writeJson(file, declared);
    const cli = gradeCli(["--fixture", fixture, "--actual", dir, "--declared-other-tables", file]);
    assert.equal(cli.status, 1);
    assert.match(cli.stdout, /STALE declared difference create-then-render#1 \/ sessions/);
  });

  it("a declaration naming a step this fixture does not have is stale too", () => {
    const dir = copyGood();
    const report = grade(dir, { declaredOtherTables: { "no-such-step#1": { sessions: "names nothing" } } });
    assert.equal(report.verdict, "fail");
    assert.equal(report.stale_declarations[0].id, "no-such-step#1");
  });

  it("a declared divergence that masks nothing is stale and fails the grade (item 25)", () => {
    const dir = copyGood();
    const report = grade(dir, { declaredDivergences: { "password-digest": "one column of a password card" } });
    assert.equal(report.verdict, "fail");
    assert.deepEqual(report.stale_divergences, ["password-digest"]);
  });

  it("a write that really touches a non-card table is graded: equal deltas pass, a changed delta fails or is declared", () => {
    const t = scratch();
    try {
      const cap = makeCapturedFixture(t.dir, { captureOpts: { mode: "write-other-table" }, runOpts: { mode: "write-other-table" } });
      const report = gradeRun({ fixture: cap.fixture, actual: cap.actual });
      assert.equal(report.verdict, "pass");
      assert.equal(report.other_tables.graded, 1);
      assert.equal(report.other_tables.pass, 1);
      assert.ok(report.other_table_writes[0].expected.sessions, "the write really recorded a non-card delta");
      const dir = copyDir(cap.actual, path.join(t.dir, "tampered"));
      injectOtherTables(dir, { sessions: { inserted: [{ id: 999999, token: "another engine's row" }], updated: [], deleted: [] } });
      assert.equal(gradeRun({ fixture: cap.fixture, actual: dir }).verdict, "fail");
      const declared = gradeRun({ fixture: cap.fixture, actual: dir, declaredOtherTables: { "create-then-render#1": { sessions: "engine bookkeeping" } } });
      assert.equal(declared.verdict, "pass");
      assert.equal(declared.other_tables.declared, 1);
    } finally {
      t.cleanup();
    }
  });
});

describe("lane overlays: a lane's own recorded expectations replace the base for the ops it holds", () => {
  const laneSetup = () => {
    const t = scratch();
    const cap = makeCapturedFixture(t.dir);
    const overlay = path.join(cap.fixture, "expected-lanes", "lanex");
    mkdirSync(overlay, { recursive: true });
    for (const f of ["run-meta.json"]) {
      if (existsSync(path.join(cap.expected, f))) cpSync(path.join(cap.expected, f), path.join(overlay, f));
    }
    const renderPath = path.join(overlay, "render.jsonl");
    const lines = readFileSync(path.join(cap.expected, "render.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const changed = lines[0];
    lines[0] = { ...changed, result: { ...changed.result, html: `${changed.result.html} LANE` } };
    writeFileSync(renderPath, JSON.stringify(lines[0]) + "\n");
    writeExpectedManifest(cap.fixture, overlay, { lane: "lanex", laneDb: "test 1" });
    return { t, cap, overlay, changedId: changed.id };
  };

  it("a run recorded on the lane grades against the overlay for the ops it holds, and the base for the rest", () => {
    const { t, cap, changedId } = laneSetup();
    try {
      const laneRun = copyDir(cap.actual, path.join(t.dir, "lane-run"));
      const meta = JSON.parse(readFileSync(path.join(laneRun, "run-meta.json"), "utf8"));
      for (const r of Object.values(meta.runs)) r.lane = "lanex";
      writeJson(path.join(laneRun, "run-meta.json"), meta);
      const replaced = JSON.parse(readFileSync(path.join(laneRun, "render.jsonl"), "utf8").trim().split("\n")[0]);
      assert.equal(replaced.id, changedId);
      const lines = readFileSync(path.join(laneRun, "render.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      lines[0] = { ...lines[0], result: { ...lines[0].result, html: `${lines[0].result.html} LANE` } };
      writeFileSync(path.join(laneRun, "render.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      const report = gradeRun({ fixture: cap.fixture, actual: laneRun, lane: "lanex" });
      assert.equal(report.verdict, "pass", JSON.stringify(report.problems));
      assert.equal(report.lane.name, "lanex");
      assert.equal(report.lane.overlay_ops.render >= 1, true, "the overlay supplied at least the changed op");
      const base = gradeRun({ fixture: cap.fixture, actual: laneRun, lane: null });
      assert.equal(base.verdict, "fail");
      assert.ok(base.failures.rendering.some((f) => f.id === changedId));
    } finally {
      t.cleanup();
    }
  });

  it("a run on a lane is refused when the overlay is missing its own identity or the fixture digest changed", () => {
    const { t, cap, overlay } = laneSetup();
    try {
      const m = JSON.parse(readFileSync(path.join(overlay, "MANIFEST.json"), "utf8"));
      writeJson(path.join(overlay, "MANIFEST.json"), { ...m, lane: { name: "other" } });
      const report = gradeRun({ fixture: cap.fixture, actual: cap.actual, lane: "lanex" });
      assert.ok(report.problems.some((p) => /overlay manifest names lane/.test(p)), JSON.stringify(report.problems));
      assert.equal(report.verdict, "invalid");
    } finally {
      t.cleanup();
    }
  });

  it("a lane with no overlay grades every op on the base and says so", () => {
    const { t, cap } = laneSetup();
    try {
      const report = gradeRun({ fixture: cap.fixture, actual: cap.actual, lane: "absent" });
      assert.equal(report.verdict, "pass");
      assert.ok(report.warnings.some((w) => /lane absent: no overlay directory/.test(w)));
      assert.deepEqual(report.lane.overlay_ops, { render: 0, semantics: 0, scenarios: 0 });
    } finally {
      t.cleanup();
    }
  });

  it("a changed overlay file is invalid rather than a new expectation", () => {
    const { t, cap, overlay } = laneSetup();
    try {
      appendFileSync(path.join(overlay, "render.jsonl"), "\n");
      const report = gradeRun({ fixture: cap.fixture, actual: cap.actual, lane: "lanex" });
      assert.equal(report.verdict, "invalid");
      assert.ok(report.problems.some((p) => /overlay file changed since its manifest/.test(p)));
    } finally {
      t.cleanup();
    }
  });

  it("the lane does not excuse a port answer that differs from its oracle", () => {
    const { t, cap, changedId } = laneSetup();
    try {
      const report = gradeRun({ fixture: cap.fixture, actual: cap.actual, lane: "lanex" });
      assert.equal(report.verdict, "fail");
      assert.ok(report.failures.rendering.some((f) => f.id === changedId));
    } finally {
      t.cleanup();
    }
  });

  it("the CLI refuses a lane different from the run's recorded database", () => {
    const { t, cap } = laneSetup();
    try {
      const response = gradeCli(["--fixture", cap.fixture, "--actual", cap.actual, "--lane", "lanex"]);
      assert.equal(response.status, 2);
      assert.match(response.stdout, /NOT A GRADE: --lane lanex/);
    } finally {
      t.cleanup();
    }
  });
});

describe("missing or incomplete metadata is not a grade", () => {
  it("no run-meta.json is not a grade, exit 2", () => {
    const dir = copyGood();
    rmSync(metaOf(dir));
    assert.equal(grade(dir).verdict, "invalid");
    const cli = gradeCli(["--fixture", fixture, "--actual", dir]);
    assert.equal(cli.status, 2);
    assert.match(cli.stdout, /NOT A GRADE/);
    assert.doesNotMatch(cli.stdout, /rendering\s+\d/, "no pass rate is printed for an invalid run");
  });

  for (const [kind, field] of [["render", "session_writes"], ["semantics", "session_writes"], ["render", "engine"], ["scenarios", "fixture_digest"], ["semantics", "finished"]]) {
    it(`a ${kind} run record without ${field} is not a grade`, () => {
      const dir = copyGood();
      const meta = readJson(metaOf(dir));
      delete meta.runs[kind][field];
      writeJson(metaOf(dir), meta);
      const report = grade(dir);
      assert.equal(report.verdict, "invalid");
      assert.ok(report.problems.some((p) => p.includes(`${kind} run record lacks ${field}`)), report.problems.join("\n"));
    });
  }

  it("results in an older format are not a grade", () => {
    const dir = copyGood();
    const meta = readJson(metaOf(dir));
    meta.results_format = 1;
    writeJson(metaOf(dir), meta);
    assert.equal(grade(dir).verdict, "invalid");
  });

  it("kinds answered by different engine versions are not a grade", () => {
    const dir = copyGood();
    const other = path.join(tmp.dir, "v2");
    assert.equal(runFake(fixture, other, { version: 2, extraArgs: ["--kinds", "semantics"] }).status, 0);
    for (const f of ["semantics.jsonl"]) writeFileSync(path.join(dir, f), readFileSync(path.join(other, f)));
    const meta = readJson(metaOf(dir));
    meta.runs.semantics = readJson(metaOf(other)).runs.semantics;
    writeJson(metaOf(dir), meta);
    const report = grade(dir);
    assert.equal(report.verdict, "invalid");
    assert.ok(report.problems.some((p) => p.includes("different adapters, engines or commits")));
  });
});

describe("fixture identity binds the results to the graded fixture", () => {
  it("results recorded on another fixture digest are not a grade", () => {
    const dir = copyGood();
    const meta = readJson(metaOf(dir));
    meta.runs.render.fixture_digest = "0".repeat(64);
    writeJson(metaOf(dir), meta);
    const report = grade(dir);
    assert.equal(report.verdict, "invalid");
    assert.ok(report.problems.some((p) => p.includes("render was run on fixture digest")));
  });

  it("results naming another fixture are not a grade", () => {
    const dir = copyGood();
    const meta = readJson(metaOf(dir));
    meta.fixture = "synthetic-v1";
    writeJson(metaOf(dir), meta);
    assert.equal(grade(dir).verdict, "invalid");
  });

  it("a fixture changed after its manifest is not a grade", () => {
    const t = scratch();
    try {
      const c = makeCapturedFixture(t.dir);
      const actual = path.join(t.dir, "actual");
      assert.equal(runFake(c.fixture, actual).status, 0);
      assert.equal(gradeRun({ fixture: c.fixture, actual }).verdict, "pass");
      appendFileSync(path.join(c.fixture, "ops", "render.jsonl"), "");
      writeFileSync(path.join(c.fixture, "deck.json"), readFileSync(path.join(c.fixture, "deck.json"), "utf8").replace("deck.example", "deck.example.org"));
      const report = gradeRun({ fixture: c.fixture, actual });
      assert.equal(report.verdict, "invalid");
      assert.ok(report.problems.some((p) => p.includes("fixture file changed since its manifest: deck.json")));
    } finally {
      t.cleanup();
    }
  });

  it("a run on a fixture that did not match its manifest is not a grade", () => {
    const dir = copyGood();
    const meta = readJson(metaOf(dir));
    meta.runs.scenarios.fixture_problems = ["fixture file changed since its manifest: deck.json"];
    writeJson(metaOf(dir), meta);
    assert.equal(grade(dir).verdict, "invalid");
  });

  it("journal sidecars a reader left beside the deck do not stop a grade", () => {
    const t = scratch();
    try {
      const c = makeCapturedFixture(t.dir);
      const actual = path.join(t.dir, "actual");
      assert.equal(runFake(c.fixture, actual).status, 0);
      const deck = path.join(c.fixture, "deck", "deck.sqlite3");
      writeFileSync(`${deck}-wal`, Buffer.alloc(0));
      writeFileSync(`${deck}-shm`, Buffer.alloc(32768));
      const report = gradeRun({ fixture: c.fixture, actual });
      assert.equal(report.verdict, "pass");
    } finally {
      t.cleanup();
    }
  });

  it("an uncheckpointed journal beside the deck is not a grade", () => {
    const t = scratch();
    try {
      const c = makeCapturedFixture(t.dir);
      const actual = path.join(t.dir, "actual");
      assert.equal(runFake(c.fixture, actual).status, 0);
      const deck = path.join(c.fixture, "deck", "deck.sqlite3");
      writeFileSync(`${deck}-wal`, Buffer.alloc(512, 1));
      const report = gradeRun({ fixture: c.fixture, actual });
      assert.equal(report.verdict, "invalid");
      assert.ok(report.problems.some((p) => p.includes("uncheckpointed journal")));
    } finally {
      t.cleanup();
    }
  });

  it("expected outputs captured on another fixture digest are not a grade", () => {
    const t = scratch();
    try {
      const c = makeCapturedFixture(t.dir);
      const actual = path.join(t.dir, "actual");
      assert.equal(runFake(c.fixture, actual).status, 0);
      const m = readJson(path.join(c.expected, "MANIFEST.json"));
      m.fixture_digest = "f".repeat(64);
      writeJson(path.join(c.expected, "MANIFEST.json"), m);
      const report = gradeRun({ fixture: c.fixture, actual });
      assert.equal(report.verdict, "invalid");
      assert.ok(report.problems.some((p) => p.includes("expected: captured on fixture digest")));
    } finally {
      t.cleanup();
    }
  });

  it("expected outputs changed after their manifest are not a grade", () => {
    const t = scratch();
    try {
      const c = makeCapturedFixture(t.dir);
      const actual = path.join(t.dir, "actual");
      assert.equal(runFake(c.fixture, actual).status, 0);
      appendFileSync(path.join(c.expected, "semantics.jsonl"), "");
      writeFileSync(path.join(c.expected, "semantics.jsonl"), readFileSync(path.join(c.expected, "semantics.jsonl"), "utf8").replace("card:Alpha", "card:Alpha2"));
      const report = gradeRun({ fixture: c.fixture, actual });
      assert.equal(report.verdict, "invalid");
      assert.ok(report.problems.some((p) => p.includes("expected: file changed since its manifest: semantics.jsonl")));
    } finally {
      t.cleanup();
    }
  });
});

describe("incomplete runs are refused, not graded", () => {
  it("an adapter that dies mid-run leaves a run the grader refuses", () => {
    const dir = path.join(tmp.dir, "crash");
    const r = runFake(fixture, dir, { mode: "crash-after:2" });
    assert.notEqual(r.status, 0, "the runner reports the crash");
    const meta = readJson(metaOf(dir));
    assert.equal(meta.runs.render.complete, false);
    const report = grade(dir);
    assert.equal(report.verdict, "invalid");
    assert.ok(report.problems.some((p) => p.includes("render run did not complete")));
  });

  it("a missing result line is not a grade", () => {
    const dir = copyGood();
    const file = path.join(dir, "render.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    writeFileSync(file, lines.slice(1).join("\n") + "\n");
    const report = grade(dir);
    assert.equal(report.verdict, "invalid");
    assert.ok(report.problems.some((p) => p.includes("1 of 3 render operations have no result")));
  });

  it("a scenario with fewer steps than the fixture is not a grade", () => {
    const dir = copyGood();
    const file = path.join(dir, "scenarios.jsonl");
    const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    rows[0].steps.pop();
    writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    assert.equal(grade(dir).verdict, "invalid");
  });

  it("a duplicated or unknown result id is not a grade", () => {
    const dup = copyGood();
    const file = path.join(dup, "semantics.jsonl");
    const first = readFileSync(file, "utf8").split("\n")[0];
    appendFileSync(file, first + "\n");
    assert.equal(grade(dup).verdict, "invalid");
    const unknown = copyGood();
    appendFileSync(path.join(unknown, "semantics.jsonl"), JSON.stringify({ id: "card:anonymous:Zeta", result: {} }) + "\n");
    assert.equal(grade(unknown).verdict, "invalid");
  });

  it("a filtered run is not a grade; --allow-partial grades it as partial, never pass", () => {
    const dir = path.join(tmp.dir, "limited");
    assert.equal(runFake(fixture, dir, { extraArgs: ["--limit", "1"] }).status, 0);
    assert.equal(grade(dir).verdict, "invalid");
    const report = grade(dir, { allowPartial: true });
    assert.equal(report.verdict, "partial");
    assert.equal(report.summary.rendering.graded, 2);
    assert.equal(gradeCli(["--fixture", fixture, "--actual", dir, "--allow-partial"]).status, 2);
  });

  it("a filtered run is not a grade even when its filter selects every operation", () => {
    const dir = path.join(tmp.dir, "filter-all");
    assert.equal(runFake(fixture, dir, { extraArgs: ["--filter", "."] }).status, 0);
    const report = grade(dir);
    assert.equal(report.verdict, "invalid");
    assert.ok(report.problems.some((p) => p.includes("run with a selection")));
  });

  it("a run of only some kinds is not a grade", () => {
    const dir = path.join(tmp.dir, "render-only");
    assert.equal(runFake(fixture, dir, { extraArgs: ["--kinds", "render"] }).status, 0);
    const report = grade(dir);
    assert.equal(report.verdict, "invalid");
    assert.ok(report.problems.some((p) => p.includes("semantics: not run")));
  });
});

describe("stock and patched oracle expectations are validated against their manifests", () => {
  it("the stock oracle's outputs name their variant and list no patches", () => {
    const m = readJson(path.join(expected, "MANIFEST.json"));
    assert.equal(m.oracle.variant, "stock");
    assert.deepEqual(m.oracle.patches, []);
    assert.equal(grade(good).oracle.variant, "stock");
  });

  it("a patched variant is graded only from its own directory and is labelled", () => {
    const variantDir = copyDir(expected, path.join(fixture, "expected-patched", "demo-fix"));
    writeExpectedManifest(fixture, variantDir, { variant: "demo-fix", patches: [{ id: "demo-fix", what: "a test patch" }] });
    const report = grade(good, { expected: variantDir });
    assert.equal(report.verdict, "pass");
    assert.equal(report.oracle.variant, "demo-fix");
    const cli = gradeCli(["--fixture", fixture, "--actual", good, "--expected", variantDir]);
    assert.match(cli.stdout, /PATCHED ORACLE "demo-fix"/);
    rmSync(path.join(fixture, "expected-patched"), { recursive: true, force: true });
  });

  it("a stock manifest that lists patches, or a patched one stored as expected/, is refused", () => {
    assert.throws(() => writeExpectedManifest(fixture, expected, { variant: "stock", patches: [{ id: "x" }] }));
    assert.throws(() => writeExpectedManifest(fixture, expected, { variant: "demo-fix", patches: [] }));
    const t = scratch();
    try {
      const c = makeCapturedFixture(t.dir);
      const m = readJson(path.join(c.expected, "MANIFEST.json"));
      m.oracle = { ...m.oracle, variant: "demo-fix", patches: [{ id: "demo-fix" }] };
      writeJson(path.join(c.expected, "MANIFEST.json"), m);
      const actual = path.join(t.dir, "actual");
      assert.equal(runFake(c.fixture, actual).status, 0);
      const report = gradeRun({ fixture: c.fixture, actual });
      assert.equal(report.verdict, "invalid");
      assert.ok(report.problems.some((p) => p.includes("holds the stock oracle only")));
    } finally {
      t.cleanup();
    }
  });

  it("expected outputs without a manifest are not a reference", () => {
    const t = scratch();
    try {
      const c = makeCapturedFixture(t.dir);
      rmSync(path.join(c.expected, "MANIFEST.json"));
      const actual = path.join(t.dir, "actual");
      assert.equal(runFake(c.fixture, actual).status, 0);
      assert.equal(gradeRun({ fixture: c.fixture, actual }).verdict, "invalid");
    } finally {
      t.cleanup();
    }
  });
});

describe("synthetic-v1: the reviewer's controls on the published fixture", () => {
  const real = path.join(HARNESS, "fixtures", "synthetic-v1");

  it("its expected outputs with the reviewer's run-meta.json are not a grade", () => {
    const t = scratch();
    try {
      const dir = copyDir(path.join(real, "expected"), path.join(t.dir, "reviewer"));
      rmSync(path.join(dir, "MANIFEST.json"));
      writeJson(metaOf(dir), {
        render_session_row_changes: { cards: { inserted: [{ id: 999999, name: "Unexpected read write" }] } },
        semantics_session_row_changes: {},
      });
      const cli = gradeCli(["--fixture", real, "--actual", dir, "--candidate-commit", "28f0278139c373237fafb1cd04a35bd7a41d12e3"]);
      assert.equal(cli.status, 2);
      assert.match(cli.stdout, /NOT A GRADE/);
    } finally {
      t.cleanup();
    }
  });

  it("its expected outputs with a complete record plus one read write fail, exit 1", () => {
    const t = scratch();
    try {
      const dir = copyDir(path.join(real, "expected"), path.join(t.dir, "read-write"));
      const meta = readJson(metaOf(dir));
      for (const run of Object.values(meta.runs)) {
        run.adapter_checkout = { commit: SYNTHETIC_CANDIDATE, dirty: false };
        run.source_binding = syntheticSourceBinding();
      }
      meta.runs.render.session_writes = { cards: { inserted: [{ id: 999999, name: "Unexpected read write" }], updated: [], deleted: [] } };
      writeJson(metaOf(dir), meta);
      const cli = gradeCli(["--fixture", real, "--actual", dir, "--candidate-commit", SYNTHETIC_CANDIDATE]);
      assert.equal(cli.status, 1);
      assert.match(cli.stdout, /rendering\s+1754 \/ 1754/);
      assert.match(cli.stdout, /render session: wrote rows the oracle did not/);
      assert.match(cli.stdout, /verdict: fail/);
    } finally {
      t.cleanup();
    }
  });
});

describe("recorded upstream failures: the oracle raised while serving", () => {
  let t;
  let fixture;
  before(() => {
    t = scratch();
    fixture = makeFixture(t.dir);
    const expected = path.join(fixture, "expected");
    const cap = runFake(fixture, expected, { mode: "upstream-error:Alpha" });
    assert.equal(cap.status, 0, cap.stderr);
    writeExpectedManifest(fixture, expected);
  });
  after(() => t.cleanup());

  it("the same failure reproduced failure-for-failure is a reproduced upstream failure, a success", () => {
    const dir = path.join(t.dir, "reproduced");
    assert.equal(runFake(fixture, dir, { mode: "upstream-error:Alpha" }).status, 0);
    const report = gradeRun({ fixture, actual: dir });
    assert.deepEqual(report.problems, []);
    assert.equal(report.verdict, "pass");
    assert.equal(report.summary.rendering.fail, 0);
    assert.equal(report.summary.rendering.reproduced_upstream_failures, 2, "both Alpha renders");
    assert.equal(report.summary.rendering.pass, 2, "Beta and the render step still match");
    const row = report.reproduced.rendering[0];
    assert.equal(row.oracle.class, "Card::Error::CodenameNotFound");
    assert.equal(row.engine.class, "Card::Error::CodenameNotFound");
    assert.equal(gradeCli(["--fixture", fixture, "--actual", dir]).status, 0);
  });

  it("the failure named by each host language's convention is still one failure (N7)", () => {
    const dir = path.join(t.dir, "host-named");
    assert.equal(runFake(fixture, dir, { mode: "engine-error:Alpha" }).status, 0);
    const report = gradeRun({ fixture, actual: dir });
    assert.equal(report.verdict, "pass");
    assert.equal(report.summary.rendering.reproduced_upstream_failures, 2);
    const row = report.reproduced.rendering[0];
    assert.equal(row.oracle.class, "Card::Error::CodenameNotFound");
    assert.equal(row.engine.class, "CodenameNotFoundError");
  });

  it("a different failure on a row the oracle fails is a divergence, not a reproduction", () => {
    const dir = path.join(t.dir, "different-failure");
    assert.equal(runFake(fixture, dir, { mode: "wrong-message:Alpha" }).status, 0);
    const report = gradeRun({ fixture, actual: dir });
    assert.equal(report.verdict, "fail");
    assert.equal(report.summary.rendering.fail, 2);
    assert.equal(report.summary.rendering.reproduced_upstream_failures, 0);
    assert.ok(report.failures.rendering.every((f) => /reproduced a different failure/.test(f.reason)), report.failures.rendering.map((f) => f.reason).join("; "));
  });

  it("rendering a result where the oracle failed does not reproduce it", () => {
    const dir = path.join(t.dir, "not-reproduced");
    assert.equal(runFake(fixture, dir).status, 0);
    const report = gradeRun({ fixture, actual: dir });
    assert.equal(report.verdict, "fail");
    assert.equal(report.summary.rendering.fail, 2);
    assert.ok(report.failures.rendering.every((f) => /upstream failure not reproduced/.test(f.reason)));
  });

  it("a capture-side fault sentinel is not a recorded failure: it stays ungraded", () => {
    const s = scratch();
    try {
      const sentinelFixture = makeFixture(s.dir);
      const expected = path.join(sentinelFixture, "expected");
      const cap = runFake(sentinelFixture, expected, { mode: "capture-fault:Alpha" });
      assert.equal(cap.status, 0, cap.stderr);
      writeExpectedManifest(sentinelFixture, expected);
      const dir = path.join(s.dir, "actual");
      assert.equal(runFake(sentinelFixture, dir).status, 0);
      const report = gradeRun({ fixture: sentinelFixture, actual: dir });
      assert.equal(report.verdict, "pass", "the sentinel rows are skipped, not failed");
      assert.equal(report.summary.rendering.oracle_errors, 2);
      assert.equal(report.summary.rendering.graded, 2, "only the non-sentinel renders grade");
      assert.equal(report.summary.rendering.reproduced_upstream_failures, 0);
    } finally {
      s.cleanup();
    }
  });
});
