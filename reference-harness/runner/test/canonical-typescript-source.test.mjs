import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { gradeRun } from "../grade-lib.mjs";
import { writeExpectedManifest } from "../manifest.mjs";
import { makeFixture } from "./helpers.mjs";
import { scratchDir, removeScratchDir } from "../../../tests/support/scratch-dir.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
function canonicalFixture(t, { extra = "", dependencies = {}, lock } = {}) {
  const root = scratchDir("canonical-ts-source-");
  t.after(() => removeScratchDir(root));
  const source = path.join(root, "source");
  const files = ["reference-harness/adapters/ts/adapter.json", "reference-harness/adapters/ts/adapter.mjs", "tools/oracle/typescript-source-loader.mjs"];
  for (const optional of ["tools/oracle/typescript-transform-witness.mjs"]) {
    try { readFileSync(path.join(repo, optional)); files.push(optional); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  for (const file of files) { mkdirSync(path.dirname(path.join(source, file)), { recursive: true }); cpSync(path.join(repo, file), path.join(source, file)); }
  const adapter = path.join(source, "reference-harness/adapters/ts");
  const fake = readFileSync(new URL("./fake-adapter/adapter.mjs", import.meta.url), "utf8");
  writeFileSync(path.join(adapter, "adapter.ts"), 'const canonicalTypedControl: number = 1;\n' + fake + extra);
  for (const [file, bytes] of Object.entries(dependencies)) writeFileSync(path.join(adapter, file), bytes);
  writeFileSync(path.join(source, "package.json"), '{"type":"module"}\n');
  if (lock === undefined) cpSync(path.join(repo, "package-lock.json"), path.join(source, "package-lock.json"));
  else writeFileSync(path.join(source, "package-lock.json"), lock);
  writeFileSync(path.join(source, ".gitignore"), 'node_modules/\n');
  const git = args => execFileSync("git", ["-C", source, ...args], { env: cleanEnv, windowsHide: true, encoding: "utf8" }).trim();
  git(["init"]);
  const owned = [...files, "reference-harness/adapters/ts/adapter.ts", ...Object.keys(dependencies).map(file => "reference-harness/adapters/ts/" + file), "package.json", "package-lock.json", ".gitignore"];
  git(["add", "--", ...owned]);
  git(["commit", "-m", "Create owned canonical TypeScript recipe fixture", "--", ...owned]);
  return { root, source, adapter, git, commit: git(["rev-parse", "HEAD"]) };
}

function capture(f, fixture, out, extraEnv = {}) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../run.mjs", import.meta.url)), "--adapter", path.join(f.adapter, "adapter.json"), "--fixture", fixture, "--out", out], { env: { ...cleanEnv, ...extraEnv }, windowsHide: true, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(readFileSync(path.join(out, "run-meta.json"), "utf8"));
}

test("clean committed canonical entry and real TypeScript loader qualify their consumed source", t => {
  const f = canonicalFixture(t);
  const fixture = makeFixture(f.root), expected = path.join(fixture, "expected"), actual = path.join(f.root, "actual");
  for (const out of [expected, actual]) {
    capture(f, fixture, out);
    if (out === expected) writeExpectedManifest(fixture, expected);
  }
  const grade = gradeRun({ fixture, actual, candidateCommit: f.commit });
  const meta = JSON.parse(readFileSync(path.join(actual, "run-meta.json"), "utf8"));
  const invocation = meta.runs.render.source_binding.invocations[0];
  assert.equal(grade.source_qualification.qualified, true, JSON.stringify({ problems: grade.problems,
    worker: invocation.canonical?.worker?.map(row => ({ event: row.event, url: row.url, format: row.format, raw: row.raw_sha256, loaded: row.loaded_sha256 })),
    modules: invocation.audit?.modules, registrations: invocation.audit?.registrations }));
  assert.equal(grade.verdict, "pass", JSON.stringify(grade.problems));
});

test("canonical runtime: a lock-declared dependency installed inside the candidate's own node_modules qualifies as a runtime package", t => {
  const lock = JSON.parse(readFileSync(path.join(repo, "package-lock.json"), "utf8"));
  lock.packages["node_modules/owned-dep"] = { version: "1.0.0" };
  const f = canonicalFixture(t, { extra: '\nimport "owned-dep";\n', lock: JSON.stringify(lock, null, 2) + "\n" });
  const dependency = path.join(f.source, "node_modules", "owned-dep");
  mkdirSync(dependency, { recursive: true });
  writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "owned-dep", version: "1.0.0", type: "module", main: "index.mjs" }));
  writeFileSync(path.join(dependency, "index.mjs"), "export const dependency = 1;\n");
  const fixture = makeFixture(f.root), expected = path.join(fixture, "expected"), actual = path.join(f.root, "actual");
  for (const out of [expected, actual]) {
    capture(f, fixture, out);
    if (out === expected) writeExpectedManifest(fixture, expected);
  }
  const grade = gradeRun({ fixture, actual, candidateCommit: f.commit });
  assert.equal(grade.source_qualification.qualified, true, JSON.stringify(grade.problems));
  assert.equal(grade.verdict, "pass", JSON.stringify(grade.problems));
});

test("canonical runtime: an installed dependency whose version differs from the committed lock is refused", t => {
  const lock = JSON.parse(readFileSync(path.join(repo, "package-lock.json"), "utf8"));
  lock.packages["node_modules/owned-dep"] = { version: "1.0.0" };
  const f = canonicalFixture(t, { extra: '\nimport "owned-dep";\n', lock: JSON.stringify(lock, null, 2) + "\n" });
  const dependency = path.join(f.source, "node_modules", "owned-dep");
  mkdirSync(dependency, { recursive: true });
  writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "owned-dep", version: "2.0.0", type: "module", main: "index.mjs" }));
  writeFileSync(path.join(dependency, "index.mjs"), "export const dependency = 1;\n");
  const fixture = makeFixture(f.root), expected = path.join(fixture, "expected"), actual = path.join(f.root, "actual");
  for (const out of [expected, actual]) {
    capture(f, fixture, out);
    if (out === expected) writeExpectedManifest(fixture, expected);
  }
  const grade = gradeRun({ fixture, actual, candidateCommit: f.commit });
  assert.equal(grade.source_qualification.qualified, false, JSON.stringify(grade.problems));
  assert.notEqual(grade.verdict, "pass", JSON.stringify(grade.problems));
  assert.ok(grade.problems.some(problem => problem.includes("not declared by the candidate lock")), JSON.stringify(grade.problems));
});

test("canonical warm cache output is checked against the actual fresh transformation", t => {
  const f = canonicalFixture(t), fixture = makeFixture(f.root), expected = path.join(fixture, "expected"), actual = path.join(f.root, "actual");
  const cache = path.join(f.root, "transform-cache");
  capture(f, fixture, expected, { DUAL_LANE_TSC_CACHE_DIR: cache });
  writeExpectedManifest(fixture, expected);
  const meta = capture(f, fixture, actual, { DUAL_LANE_TSC_CACHE_DIR: cache });
  const grade = gradeRun({ fixture, actual, candidateCommit: f.commit });
  assert.equal(grade.verdict, "pass", JSON.stringify(grade.problems));
  assert.ok(Object.values(meta.runs).every(run => run.source_binding.invocations.every(invocation => invocation.canonical.transforms.every(row => row.cache.startsWith("hit") && row.output_sha256 === row.verified_output_sha256))));
});

test("canonical runtime proves the exact SQLite row projection and long static Wasm inputs", t => {
  const extra = '\nimport Database from "better-sqlite3";\nimport {createRequire as runtimeRequire} from "node:module";\nconst Long = runtimeRequire(import.meta.url)("long");\nconst nativeDatabase = new Database(":memory:");\nconst nativeRow = nativeDatabase.prepare("SELECT 1 AS source_binding_value").get();\nif(nativeRow.source_binding_value!==1 || Long.fromInt(2).multiply(3).toInt()!==6)throw Error("Native runtime control failed");\nnativeDatabase.close();\n';
  const f = canonicalFixture(t, { extra }), fixture = makeFixture(f.root), expected = path.join(fixture, "expected"), actual = path.join(f.root, "actual");
  capture(f, fixture, expected);
  writeExpectedManifest(fixture, expected);
  const meta = capture(f, fixture, actual);
  const grade = gradeRun({ fixture, actual, candidateCommit: f.commit });
  assert.equal(grade.verdict, "pass", JSON.stringify(grade.problems));
  for (const run of Object.values(meta.runs)) for (const invocation of run.source_binding.invocations) {
    assert.ok(invocation.audit.generated_sources.some(record => record.binding?.kind === "better-sqlite3-row-projection/1"));
    assert.ok(invocation.audit.generated_sources.some(record => record.binding?.kind === "long-static-i64-wasm/1"));
    assert.equal(invocation.audit.generated_observer.unbound_events, 0);
  }
});

test("canonical poisoned transform cache still runs but cannot qualify as committed source", t => {
  const f = canonicalFixture(t), fixture = makeFixture(f.root), expected = path.join(fixture, "expected"), actual = path.join(f.root, "actual");
  capture(f, fixture, expected);
  writeExpectedManifest(fixture, expected);
  const cache = path.join(f.root, "transform-cache");
  mkdirSync(cache);
  const input = readFileSync(path.join(f.adapter, "adapter.ts"), "utf8");
  const key = createHash("sha256").update(input).digest("hex").slice(0, 32);
  writeFileSync(path.join(cache, `${key}.mjs`), readFileSync(new URL("./fake-adapter/adapter.mjs", import.meta.url), "utf8") + '\nprocess.stderr.write("EXECUTED_POISONED_TRANSFORM_CACHE\\n");\n');
  const meta = capture(f, fixture, actual, { DUAL_LANE_TSC_CACHE_DIR: cache });
  for (const record of meta.adapter_diagnostics) assert.match(readFileSync(record.streams.stderr.path, "utf8"), /EXECUTED_POISONED_TRANSFORM_CACHE/);
  const grade = gradeRun({ fixture, actual, candidateCommit: f.commit });
  assert.equal(grade.source_qualification.qualified, false);
  assert.ok(grade.problems.some(problem => problem.includes("Unverified transformation or cached output")));
});

test("canonical transformer records a temporary changed input even after it is restored", t => {
  const changed = 'export const typed: number = 2;\nprocess.stderr.write("EXECUTED_TRANSIENT_TS_INPUT\\n");\n';
  const extra = ["", 'import {writeFileSync as replaceInput} from "node:fs";',
    'const dependency = new URL("./dependency.ts", import.meta.url);',
    `if(process.env.CANONICAL_MUTATE_INPUT) replaceInput(dependency,${JSON.stringify(changed)});`,
    'await import(dependency.href);',
    `replaceInput(dependency,${JSON.stringify("export const typed: number = 1;\n")});`, ""].join("\n");
  const f = canonicalFixture(t, { extra, dependencies: { "dependency.ts": "export const typed: number = 1;\n" } });
  const fixture = makeFixture(f.root), expected = path.join(fixture, "expected"), actual = path.join(f.root, "actual");
  capture(f, fixture, expected);
  writeExpectedManifest(fixture, expected);
  const meta = capture(f, fixture, actual, { CANONICAL_MUTATE_INPUT: "1" });
  for (const record of meta.adapter_diagnostics) assert.match(readFileSync(record.streams.stderr.path, "utf8"), /EXECUTED_TRANSIENT_TS_INPUT/);
  for (const run of Object.values(meta.runs)) assert.deepEqual(run.source_binding.before.files, run.source_binding.after.files);
  const grade = gradeRun({ fixture, actual, candidateCommit: f.commit });
  assert.equal(grade.source_qualification.qualified, false);
  assert.ok(grade.problems.some(problem => problem.includes("Transform consumed uncommitted input bytes")));
});

test("canonical recipe does not qualify a second arbitrary registered loader", t => {
  const code = "export async function load(url, context, nextLoad) { return nextLoad(url, context); }";
  const extra = `\nimport {register as registerOther} from "node:module";\nregisterOther(${JSON.stringify("data:text/javascript," + encodeURIComponent(code))}, import.meta.url);\n`;
  const f = canonicalFixture(t, { extra }), fixture = makeFixture(f.root), expected = path.join(fixture, "expected"), actual = path.join(f.root, "actual");
  capture(f, fixture, expected);
  writeExpectedManifest(fixture, expected);
  const meta = capture(f, fixture, actual);
  assert.ok(Object.values(meta.runs).every(run => run.source_binding.invocations.every(invocation => invocation.audit.problems.includes("Unknown asynchronous loader registration"))));
  assert.equal(gradeRun({ fixture, actual, candidateCommit: f.commit }).source_qualification.qualified, false);
});

test("canonical builtin lookup still refuses an actual unwitnessed child execution", t => {
  const extra = '\nconst childAPI = process.getBuiltinModule("child_process");\nconst childResult = childAPI.spawnSync(process.execPath,["-e",\'process.stderr.write("CANONICAL_EXTERNAL_CHILD_EXECUTED\\\\n")\'],{windowsHide:true,encoding:"utf8"});\nif(childResult.status!==0)throw Error(childResult.stderr);\nprocess.stderr.write(childResult.stderr);\n';
  const f = canonicalFixture(t, { extra }), fixture = makeFixture(f.root), expected = path.join(fixture, "expected"), actual = path.join(f.root, "actual");
  capture(f, fixture, expected);
  writeExpectedManifest(fixture, expected);
  const meta = capture(f, fixture, actual);
  for (const record of meta.adapter_diagnostics) assert.match(readFileSync(record.streams.stderr.path, "utf8"), /CANONICAL_EXTERNAL_CHILD_EXECUTED/);
  assert.ok(Object.values(meta.runs).every(run => run.source_binding.invocations.every(invocation => invocation.audit.problems.some(problem => problem.includes("Unwitnessed secondary execution: node:child_process.spawnSync")))));
  assert.equal(gradeRun({ fixture, actual, candidateCommit: f.commit }).source_qualification.qualified, false);
});

test("a lost transform receipt remains unqualified after the journal becomes writable again", t => {
  const extra = ["", 'import {renameSync, mkdirSync, rmdirSync} from "node:fs";',
    'const journal = process.env.DECKO_ADAPTER_TRANSFORM_AUDIT;',
    'renameSync(journal, journal + ".held"); mkdirSync(journal);',
    'try { await import(new URL("./dependency.ts", import.meta.url).href); }',
    'finally { rmdirSync(journal); renameSync(journal + ".held", journal); }',
    'await import(new URL("./after.ts", import.meta.url).href);', ""].join("\n");
  const f = canonicalFixture(t, { extra, dependencies: { "dependency.ts": "export const first: number = 1;\n", "after.ts": "export const second: number = 2;\n" } });
  const fixture = makeFixture(f.root), expected = path.join(fixture, "expected"), actual = path.join(f.root, "actual");
  capture(f, fixture, expected);
  writeExpectedManifest(fixture, expected);
  const meta = capture(f, fixture, actual);
  for (const record of meta.adapter_diagnostics) assert.match(readFileSync(record.streams.stderr.path, "utf8"), /TypeScript transform witness could not save:/);
  for (const run of Object.values(meta.runs)) for (const invocation of run.source_binding.invocations) {
    assert.ok(invocation.audit.worker_capture.errors > 0);
    assert.ok(invocation.audit.worker_capture.transforms_observed > invocation.audit.worker_capture.transforms_retained);
  }
  const grade = gradeRun({ fixture, actual, candidateCommit: f.commit });
  assert.equal(grade.source_qualification.qualified, false);
  assert.ok(grade.problems.some(problem => problem.includes("Loader/transform source evidence capture incomplete")));
});

test("failed final source publication retains the real error and never qualifies its checkpoint", t => {
  const extra = '\nimport {writeFileSync as collide} from "node:fs";\ncollide(process.env.DECKO_ADAPTER_SOURCE_AUDIT + ".next", "owned final publication collision", {flag:"wx"});\n';
  const f = canonicalFixture(t, { extra }), fixture = makeFixture(f.root), expected = path.join(fixture, "expected"), actual = path.join(f.root, "actual");
  capture(f, fixture, expected);
  writeExpectedManifest(fixture, expected);
  const meta = capture(f, fixture, actual);
  for (const run of Object.values(meta.runs)) for (const invocation of run.source_binding.invocations) {
    assert.equal(invocation.audit.complete, false);
    assert.ok(invocation.audit_publication_errors.some(error => error.code === "EEXIST"));
  }
  assert.equal(gradeRun({ fixture, actual, candidateCommit: f.commit }).source_qualification.qualified, false);
});
