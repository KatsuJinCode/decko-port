import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { gradeSyntheticRun as gradeRun } from "./helpers.mjs";
import { verifyFixture, writeExpectedManifest, writeFixtureManifest } from "../manifest.mjs";
import { gradeCli, makeCapturedFixture, readJson, runFake, scratch, writeJson } from "./helpers.mjs";

const WITHHELD_ID = "page:member:Beta";
const LINE = "[withheld: test label] NOT RUN: 1 ops";

let tmp;
let fixture;
let withheldDir;
let asideDir;
let withRun;
let withoutRun;

function withhold(fixtureDir) {
  const split = (file) => {
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l !== "");
    const keep = lines.filter((l) => JSON.parse(l).id !== WITHHELD_ID);
    const move = lines.filter((l) => JSON.parse(l).id === WITHHELD_ID);
    assert.equal(move.length, 1);
    writeFileSync(file, keep.map((l) => l + "\n").join(""));
    return move.map((l) => l + "\n").join("");
  };
  const dir = path.join(fixtureDir, "withheld");
  mkdirSync(path.join(dir, "ops"), { recursive: true });
  mkdirSync(path.join(dir, "expected"), { recursive: true });
  writeFileSync(path.join(dir, "ops", "render.jsonl"), split(path.join(fixtureDir, "ops", "render.jsonl")));
  writeFileSync(path.join(dir, "expected", "render.jsonl"), split(path.join(fixtureDir, "expected", "render.jsonl")));
  writeJson(path.join(dir, "withheld.json"), { label: "test label", why: "exercises the withheld set" });
  const { digest } = writeFixtureManifest(fixtureDir);
  const metaFile = path.join(fixtureDir, "expected", "run-meta.json");
  const meta = readJson(metaFile);
  for (const run of Object.values(meta.runs)) run.fixture_digest = digest;
  writeJson(metaFile, meta);
  writeExpectedManifest(fixtureDir, path.join(fixtureDir, "expected"));
  return dir;
}

const setAside = () => renameSync(withheldDir, asideDir);
const putBack = () => renameSync(asideDir, withheldDir);

before(() => {
  tmp = scratch();
  ({ fixture } = makeCapturedFixture(tmp.dir));
  withheldDir = withhold(fixture);
  asideDir = path.join(tmp.dir, "withheld-aside");
  withRun = path.join(tmp.dir, "with");
  assert.equal(runFake(fixture, withRun).status, 0);
  setAside();
  withoutRun = path.join(tmp.dir, "without");
  const r = runFake(fixture, withoutRun);
  putBack();
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes(LINE), r.stderr);
});
after(() => tmp.cleanup());

describe("withheld set present", () => {
  it("is part of the fixture: identity intact, its operation run and graded", () => {
    assert.deepEqual(verifyFixture(fixture).problems, []);
    const report = gradeRun({ fixture, actual: withRun });
    assert.deepEqual(report.problems, []);
    assert.equal(report.verdict, "pass");
    assert.equal(report.summary.rendering.graded, 4);
    assert.equal(report.withheld.run, true);
    const cli = gradeCli(["--fixture", fixture, "--actual", withRun]);
    assert.equal(cli.status, 0);
    assert.ok(cli.stdout.includes("[withheld: test label] RUN: 1 ops"), cli.stdout);
  });

  it("a run made without the set is refused, not graded short", () => {
    const report = gradeRun({ fixture, actual: withoutRun });
    assert.equal(report.verdict, "invalid");
    assert.ok(report.problems.some((p) => p.includes("render ran a fixture with 2 operations; this fixture has 3")), report.problems.join("\n"));
  });

  it("a changed withheld file breaks the fixture identity", () => {
    const file = path.join(withheldDir, "withheld.json");
    const before = readFileSync(file);
    writeFileSync(file, JSON.stringify({ label: "test label", why: "changed" }) + "\n");
    try {
      assert.ok(verifyFixture(fixture).problems.some((p) => p === "withheld file changed since its manifest: withheld.json"));
    } finally {
      writeFileSync(file, before);
    }
  });
});

describe("withheld set absent", () => {
  before(setAside);
  after(putBack);

  it("keeps the same fixture identity and grades the public operations, saying NOT RUN", () => {
    assert.deepEqual(verifyFixture(fixture).problems, []);
    const report = gradeRun({ fixture, actual: withoutRun });
    assert.deepEqual(report.problems, []);
    assert.equal(report.verdict, "pass");
    assert.equal(report.summary.rendering.graded, 3);
    assert.equal(report.withheld.run, false);
    assert.ok(report.withheld.line.startsWith(LINE));
    const cli = gradeCli(["--fixture", fixture, "--actual", withoutRun]);
    assert.equal(cli.status, 0);
    assert.ok(cli.stdout.includes(LINE), cli.stdout);
  });

  it("a run made with the set is refused", () => {
    const report = gradeRun({ fixture, actual: withRun });
    assert.equal(report.verdict, "invalid");
    assert.ok(report.problems.some((p) => p.includes(`render id ${WITHHELD_ID} is not an operation of this fixture`)), report.problems.join("\n"));
  });
});

describe("an undeclared withheld directory", () => {
  it("is a fixture problem, never silently run", () => {
    const manifestFile = path.join(fixture, "MANIFEST.json");
    const original = readFileSync(manifestFile);
    const m = readJson(manifestFile);
    delete m.withheld;
    writeJson(manifestFile, m);
    try {
      assert.ok(verifyFixture(fixture).problems.includes("fixture has a withheld/ set its manifest does not declare"));
    } finally {
      writeFileSync(manifestFile, original);
    }
  });
});
