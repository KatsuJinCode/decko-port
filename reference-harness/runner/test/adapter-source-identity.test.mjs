import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { observeAdapterSource, prepareAdapterInvocation, sourceBindingProblems } from "../adapter-source-identity.mjs";
import { gradeRun } from "../grade-lib.mjs";
import { writeExpectedManifest } from "../manifest.mjs";
import { makeFixture, syntheticSourceBinding, SYNTHETIC_CANDIDATE } from "./helpers.mjs";
import { scratchDir, removeScratchDir } from "../../../tests/support/scratch-dir.mjs";

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
function ownedAdapter(t, extra = "", dependencies = {}) {
  const root = scratchDir("source-binding-");
  t.after(() => removeScratchDir(root));
  const adapter = path.join(root, "adapter");
  mkdirSync(adapter);
  writeFileSync(path.join(adapter, "adapter.mjs"), readFileSync(new URL("./fake-adapter/adapter.mjs", import.meta.url), "utf8") + extra);
  writeFileSync(path.join(adapter, "adapter.json"), JSON.stringify({ name: "owned-source-positive", command: [process.execPath, "adapter.mjs"] }));
  for (const [file, source] of Object.entries(dependencies)) writeFileSync(path.join(adapter, file), source);
  const git = args => execFileSync("git", ["-C", adapter, ...args], { env, encoding: "utf8", windowsHide: true }).trim();
  git(["init"]);
  const files = ["adapter.mjs", "adapter.json", ...Object.keys(dependencies)];
  git(["add", "--", ...files]);
  git(["commit", "-m", "Create owned source binding control", "--", ...files]);
  return { root, adapter, git, commit: git(["rev-parse", "HEAD"]) };
}
function captureAndGrade(f) {
  const fixture = makeFixture(f.root), expected = path.join(fixture, "expected"), actual = path.join(f.root, "actual");
  for (const out of [expected, actual]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../run.mjs", import.meta.url)), "--adapter", path.join(f.adapter, "adapter.json"), "--fixture", fixture, "--out", out], { env, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    if (out === expected) writeExpectedManifest(fixture, expected);
  }
  const report = gradeRun({ fixture, actual, candidateCommit: f.commit });
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL("../grade.mjs", import.meta.url)), "--fixture", fixture, "--actual", actual, "--candidate-commit", f.commit], { env, encoding: "utf8", windowsHide: true });
  return { report, cli, meta: JSON.parse(readFileSync(path.join(actual, "run-meta.json"), "utf8")) };
}

test("genuinely clean committed entry and internal dependency qualify through the real runner and CLI", t => {
  const f = ownedAdapter(t, '\nimport "./dependency.mjs";\n', { "dependency.mjs": "export const control = 1;\n" });
  const { report, cli, meta } = captureAndGrade(f);
  assert.equal(report.source_qualification.qualified, true, JSON.stringify(report.problems));
  assert.equal(report.verdict, "pass", JSON.stringify(report.problems));
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  for (const run of Object.values(meta.runs)) {
    assert.deepEqual(sourceBindingProblems(run.source_binding, f.commit), []);
    assert.equal(run.source_binding.before.dirty, false);
    assert.equal(run.source_binding.after.dirty, false);
    assert.ok(run.source_binding.invocations.every(invocation => invocation.audit.modules.some(module => module.url.endsWith("/dependency.mjs"))));
  }
});

test("clean entry importing external source remains a completed unqualified diagnostic capture", t => {
  const f = ownedAdapter(t, '\nimport "../external.mjs";\n');
  writeFileSync(path.join(f.root, "external.mjs"), "export const external = true;\n");
  const { report, cli, meta } = captureAndGrade(f);
  assert.equal(report.source_qualification.qualified, false);
  assert.equal(report.verdict, "invalid");
  assert.equal(cli.status, 2);
  assert.ok(report.problems.some(problem => problem.includes("dependency is outside")));
  assert.ok(Object.values(meta.runs).every(run => run.complete));
});

test("CommonJS compiler inputs qualify without changing eval or Function properties", t => {
  const original = readFileSync(new URL("./fake-adapter/adapter.mjs", import.meta.url), "utf8");
  const body = original.replace(/^import .*$/gm, "");
  const source = [
    'const {randomBytes}=require("node:crypto");', 'const {readFileSync}=require("node:fs");',
    'const {DatabaseSync}=require("node:sqlite");', 'const {createInterface}=require("node:readline");',
    'if(Object.getOwnPropertyDescriptor(globalThis,"eval").value!==globalThis.eval)throw Error("eval property changed");',
    'if(Object.getOwnPropertyDescriptor(globalThis,"Function").value!==globalThis.Function)throw Error("Function property changed");',
    '(async()=>{', body, '})().catch(error=>{console.error(error);process.exitCode=1;});',
  ].join("\n");
  const f = ownedAdapter(t, "", { "adapter.cjs": source });
  writeFileSync(path.join(f.adapter, "adapter.json"), JSON.stringify({ name: "owned-commonjs-positive", command: [process.execPath, "adapter.cjs"] }));
  f.git(["add", "--", "adapter.json"]);
  f.git(["commit", "-m", "Select owned CommonJS source fixture", "--", "adapter.json"]);
  f.commit = f.git(["rev-parse", "HEAD"]);
  const { report, cli, meta } = captureAndGrade(f);
  assert.equal(report.verdict, "pass", JSON.stringify(report.problems));
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.ok(meta.adapter_diagnostics.every(record => record.code === 0));
  assert.ok(Object.values(meta.runs).every(run => run.source_binding.invocations.every(invocation => invocation.audit.generated_observer.events_observed === 0)));
});

test("generated code cannot qualify by claiming its wrapper file as sourceURL", t => {
  const extra = '\neval(\'process.stderr.write("GENERATED_SOURCE_URL_MASQUERADE\\\\n");\\n//# sourceURL=\' + import.meta.url);\n';
  const f = ownedAdapter(t, extra);
  const { report, cli, meta } = captureAndGrade(f);
  assert.equal(report.source_qualification.qualified, false);
  assert.equal(cli.status, 2);
  assert.ok(meta.adapter_diagnostics.every(record => record.code === 0));
  for (const run of Object.values(meta.runs)) for (const invocation of run.source_binding.invocations) {
    assert.ok(invocation.audit.generated_sources.some(record => record.metadata.hasSourceURL === true && record.metadata.url.endsWith("/adapter.mjs") && record.source.includes("GENERATED_SOURCE_URL_MASQUERADE")));
  }
});

test("temporarily changed dependency cannot qualify even when restored before the final observation", t => {
  const script = '\nimport {writeFileSync as changeSource} from "node:fs";\nconst dep = new URL("./dependency.mjs", import.meta.url);\nchangeSource(dep,"export const observed = 2;\\n");\nawait import(dep.href);\nchangeSource(dep,"export const observed = 1;\\n");\n';
  const f = ownedAdapter(t, script, { "dependency.mjs": "export const observed = 1;\n" });
  const { report, cli, meta } = captureAndGrade(f);
  assert.equal(report.source_qualification.qualified, false);
  assert.equal(cli.status, 2);
  assert.ok(report.problems.some(problem => problem.includes("Loaded module bytes differ")));
  for (const run of Object.values(meta.runs)) assert.deepEqual(run.source_binding.before.files, run.source_binding.after.files);
});

test("raw inventory detects both index visibility flags without changing them", t => {
  const f = ownedAdapter(t, "", { "unused.mjs": "export const unused = 1;\n" });
  for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
    f.git(["update-index", flag, "unused.mjs"]);
    appendFileSync(path.join(f.adapter, "unused.mjs"), "// raw change\n");
    assert.equal(f.git(["status", "--porcelain"]), "");
    const observation = observeAdapterSource(f.adapter);
    assert.equal(observation.dirty, true);
    assert.ok(observation.problems.some(problem => problem.includes("unused.mjs")));
  }
});

test("nested adapter cwd inventories paths from the actual repository root", t => {
  const f = ownedAdapter(t);
  const nested = path.join(f.adapter, "nested");
  mkdirSync(nested);
  assert.equal(observeAdapterSource(nested).dirty, false);
  assert.deepEqual(observeAdapterSource(nested).files.map(file => file.path), ["adapter.json", "adapter.mjs"]);
});

test("shell, eval, preload options and a different executable are not silently source-bound", () => {
  for (const command of [[process.execPath, "--eval", "0"], ["sh", "adapter.sh"], [process.execPath, "--import", "extra.mjs", "adapter.mjs"]]) {
    const manifest = { command, dir: import.meta.dirname };
    const result = prepareAdapterInvocation(manifest, "unused-audit.json", {});
    assert.equal(result.manifest, manifest);
    assert.ok(result.record.problems.length);
  }
});

test("grader validates complete pinned tree evidence and module bytes rather than qualification flags", () => {
  const positive = syntheticSourceBinding();
  assert.deepEqual(sourceBindingProblems(positive, SYNTHETIC_CANDIDATE), []);
  const mutations = [
    binding => { delete binding.before.commit_object; },
    binding => { binding.after.files = []; },
    binding => { binding.after.files[0].sha256 = "f".repeat(64); },
    binding => { binding.invocations[0].entry.actual_oid = "f".repeat(40); },
    binding => { binding.invocations[0].audit.complete = false; },
    binding => { binding.invocations[0].command = ["sh", "-c", "anything"]; },
    binding => { binding.invocations[0].audit.pid = 2; },
    binding => { binding.invocations[0].audit.modules[0].loaded_oid = "f".repeat(40); },
    binding => { binding.invocations = []; },
    binding => { binding.before.problems = ["unreadable source"]; },
  ];
  for (const mutate of mutations) {
    const binding = structuredClone(positive);
    mutate(binding);
    assert.ok(sourceBindingProblems(binding, SYNTHETIC_CANDIDATE).length);
  }
});

test("inherited witness configuration cannot select or redirect an unsupported recipe", t => {
  const f = ownedAdapter(t);
  const prepared = prepareAdapterInvocation({ command: [process.execPath, "adapter.mjs"], dir: f.adapter }, path.join(f.root, "owned-audit.json"), {
    DECKO_ADAPTER_CANONICAL_SOURCE: '{"loader_url":"unowned"}', DECKO_ADAPTER_TRANSFORM_AUDIT: "unowned",
  });
  assert.equal(prepared.env.DECKO_ADAPTER_CANONICAL_SOURCE, "");
  assert.equal(prepared.env.DECKO_ADAPTER_TRANSFORM_AUDIT, "");
  assert.equal(prepared.record.canonical, undefined);
});
