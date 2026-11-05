import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { gradeRun } from "../grade-lib.mjs";
import { writeExpectedManifest } from "../manifest.mjs";
import { SYNTHETIC_CANDIDATE, copyDir, gradeCli, makeCapturedFixture, readJson, scratch, writeJson } from "./helpers.mjs";
import { readFileSync, writeFileSync } from "node:fs";

function fixture(t) {
  const tmp = scratch();
  t.after(() => tmp.cleanup());
  return { ...makeCapturedFixture(tmp.dir), root: tmp.dir };
}
const options = f => ({ fixture: f.fixture, actual: f.actual, candidateCommit: SYNTHETIC_CANDIDATE });

test("only an externally pinned clean source can receive a candidate pass", t => {
  const f = fixture(t), original = readJson(path.join(f.actual, "run-meta.json"));
  const positive = gradeRun(options(f));
  assert.equal(positive.verdict, "pass");
  assert.equal(positive.source_qualification.qualified, true);
  assert.equal(Object.keys(positive.checker.files).length, 16);
  assert.equal(gradeCli(["--fixture", f.fixture, "--actual", f.actual]).status, 0);
  const cases = [
    undefined, null, [], {}, {commit:SYNTHETIC_CANDIDATE},
    {commit:SYNTHETIC_CANDIDATE,dirty:null}, {commit:SYNTHETIC_CANDIDATE,dirty:"false"},
    {commit:SYNTHETIC_CANDIDATE,dirty:true},
    {commit:"2".repeat(40),dirty:false}, {commit:"0".repeat(40),dirty:false},
    {commit:"short",dirty:false},
  ];
  for (const [index, checkout] of cases.entries()) {
    const actual = copyDir(f.actual, path.join(f.root, "case-" + index));
    const meta = structuredClone(original);
    for (const run of Object.values(meta.runs)) {
      if (checkout === undefined) delete run.adapter_checkout;
      else run.adapter_checkout = checkout;
    }
    writeJson(path.join(actual,"run-meta.json"),meta);
    const report = gradeRun({...options(f),actual});
    assert.equal(report.verdict,"invalid",JSON.stringify(checkout));
    assert.equal(report.source_qualification.qualified,false);
    const cli = gradeCli(["--fixture",f.fixture,"--actual",actual]);
    assert.equal(cli.status,2,cli.stdout);
    assert.match(cli.stdout,/NOT A GRADE/);
    assert.doesNotMatch(cli.stdout,/verdict: pass|100%/);
  }
  const meta=structuredClone(original);meta.runs.semantics.adapter_checkout.commit="2".repeat(40);
  writeJson(path.join(f.actual,"run-meta.json"),meta);
  assert.equal(gradeRun(options(f)).verdict,"invalid","mixed source identities refuse");
});

test("absent candidate refuses and explicit diagnostic mode never exits with a candidate pass", t => {
  const f=fixture(t);
  assert.equal(gradeRun({fixture:f.fixture,actual:f.actual}).verdict,"invalid");
  const absent=gradeCli(["--fixture",f.fixture,"--actual",f.actual],{candidate:false});
  assert.equal(absent.status,2);assert.match(absent.stdout,/NOT A GRADE/);
  const diagnostic=gradeRun({fixture:f.fixture,actual:f.actual,diagnostic:true});
  assert.equal(diagnostic.verdict,"diagnostic-pass");
  assert.equal(diagnostic.source_qualification.qualified,false);
  assert.equal(gradeCli(["--fixture",f.fixture,"--actual",f.actual,"--diagnostic"]).status,2);
});

test("a missing observation value produces a structured invalid record", t => {
  const f=fixture(t),file=path.join(f.actual,"semantics.jsonl");
  const lines=readFileSync(file,"utf8").trim().split("\n").map(JSON.parse);
  delete lines[0].result;
  writeFileSync(file,lines.map(JSON.stringify).join("\n")+"\n");
  const report=gradeRun(options(f));
  assert.equal(report.verdict,"invalid");
  assert.ok(report.problems.some(p=>p.includes("lacks a result or valid error")));
  const cli=gradeCli(["--fixture",f.fixture,"--actual",f.actual]);
  assert.equal(cli.status,2);assert.doesNotMatch(cli.stdout,/TypeError/);
});

test("the actual grader rejects changed literal durations, tooltips, links and localhost ports", t => {
  const pairs=[
    ["<p>The trial lasts 3 days.</p>","<p>The trial lasts 4 days.</p>"],
    ["<p>Allocate 3 hours.</p>","<p>Allocate 4 hours.</p>"],
    ["<p>Wait less than 3 seconds.</p>","<p>Wait less than 4 seconds.</p>"],
    ['<a title="Trial: 3 days">plan</a>','<a title="Trial: 4 days">plan</a>'],
    ['<a href="/plans/3 days">plan</a>','<a href="/plans/4 days">plan</a>'],
    ["<p>Use 127.0.0.1:1001</p>","<p>Use 127.0.0.1:1002</p>"],
  ];
  for(const [index,[expected,actual]] of pairs.entries()){
    const f=fixture(t),expectFile=path.join(f.expected,"render.jsonl"),actualFile=path.join(f.actual,"render.jsonl");
    const e=readFileSync(expectFile,"utf8").trim().split("\n").map(JSON.parse);
    const a=readFileSync(actualFile,"utf8").trim().split("\n").map(JSON.parse);
    e[0].result.html=expected;a[0].result.html=actual;
    writeFileSync(expectFile,e.map(JSON.stringify).join("\n")+"\n");
    writeFileSync(actualFile,a.map(JSON.stringify).join("\n")+"\n");
    writeExpectedManifest(f.fixture,f.expected);
    assert.equal(gradeRun(options(f)).verdict,"fail","literal counterexample "+index);
    assert.equal(gradeCli(["--fixture",f.fixture,"--actual",f.actual]).status,1);
  }
  const f=fixture(t),eFile=path.join(f.expected,"semantics.jsonl"),aFile=path.join(f.actual,"semantics.jsonl");
  const e=readFileSync(eFile,"utf8").trim().split("\n").map(JSON.parse),a=readFileSync(aFile,"utf8").trim().split("\n").map(JSON.parse);
  e[0].result="Use 127.0.0.1:1001";a[0].result="Use 127.0.0.1:1002";
  writeFileSync(eFile,e.map(JSON.stringify).join("\n")+"\n");writeFileSync(aFile,a.map(JSON.stringify).join("\n")+"\n");
  writeExpectedManifest(f.fixture,f.expected);
  assert.equal(gradeRun(options(f)).verdict,"fail","semantic string port remains meaningful");
});
