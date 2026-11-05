import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const { AdapterSession } = await import(process.env.ADAPTER_DIAGNOSTIC_SUBJECT ?? new URL("../adapter-process.mjs", import.meta.url).href);
import { stdoutDiagnostic, stderrDiagnostic, shutdownDiagnostic } from "./fake-adapter/diagnostic-payload.mjs";
import { gradeSyntheticRun, makeCapturedFixture, makeFixture } from "./helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
function fixture(mode) {
  const root = mkdtempSync(path.join(tmpdir(), "decko-diagnostic-test-"));
  const logs = [];
  const session = new AdapterSession({ name: "owned-fixture", dir: here,
    command: [process.execPath, path.join(here, "fake-adapter/diagnostic-adapter.mjs")] },
  { DIAGNOSTIC_MODE: mode }, { diagnosticsRoot: path.join(root, "evidence"), source: { commit: "synthetic-source", dirty: false }, log: text => logs.push(text) });
  return { root, logs, session };
}
function retained(session, expectedStderr, expectedStdout) {
  const meta = JSON.parse(readFileSync(session.diagnostics.manifest, "utf8"));
  assert.equal(meta.streams_complete, true);
  for (const [name, expected] of [["stderr", expectedStderr], ["stdout", expectedStdout]]) {
    const stream = meta.streams[name];
    assert.deepEqual(readFileSync(stream.path), expected);
    assert.equal(stream.observed_bytes, expected.length);
    assert.equal(stream.retained_bytes, expected.length);
    assert.equal(stream.sha256, createHash("sha256").update(expected).digest("hex"));
  }
  assert.deepEqual(meta.source, { commit: "synthetic-source", dirty: false });
  return meta;
}
function dead(session) {
  assert.throws(() => process.kill(session.child.pid, 0), error => error.code === "ESRCH");
}

test("failure before ready retains the useful middle, binary bytes and stream boundaries", async () => {
  const f = fixture("before-ready");
  try {
    await assert.rejects(f.session.start(), error => {
      assert.match(error.message, /ONLY_USEFUL_NATIVE_CAUSE/);
      assert.match(error.message, /before ready/);
      assert.equal(error.diagnostics.streams_complete, true);
      return true;
    });
    await f.session.close();
    const meta = retained(f.session, stderrDiagnostic, Buffer.from(stdoutDiagnostic));
    assert.equal(meta.code, 17);
    assert.equal(meta.status, "exited");
    assert.ok(f.logs.some(line => line.includes("VISIBLE_STDOUT_END  ")));
    assert.ok(f.logs.some(line => line.includes("BAD_JSON_END")));
    assert.ok(f.logs.every(line => line.includes("full decoded UTF-8 line")));
    dead(f.session);
  } finally { await f.session.close(); rmSync(f.root, { recursive: true }); }
});

test("pending request failure waits for complete native diagnostics", async () => {
  const f = fixture("request-exit");
  try {
    const hello = await f.session.start();
    await assert.rejects(f.session.request({ op: "diagnose" }), /ONLY_USEFUL_NATIVE_CAUSE/);
    await f.session.close();
    const expected = Buffer.from(JSON.stringify(hello) + "\n" + stdoutDiagnostic);
    const meta = retained(f.session, stderrDiagnostic, expected);
    assert.equal(meta.code, 23);
    dead(f.session);
  } finally { await f.session.close(); rmSync(f.root, { recursive: true }); }
});

test("nonprotocol stdout logs preserve both complete decoded lines beyond the former clipping point", async () => {
  const f = fixture("before-ready");
  try {
    await assert.rejects(f.session.start(), /adapter exited \(code 17/);
    assert.ok(f.logs.some(line => line.includes("VISIBLE_STDOUT_END  ")));
    assert.ok(f.logs.some(line => line.includes("BAD_JSON_END")));
  } finally { await f.session.close(); rmSync(f.root, { recursive: true }); }
});

for (const mode of ["success", "answer-error"]) test(`${mode} preserves protocol answers and graceful shutdown bytes`, async () => {
  const f = fixture(mode);
  try {
    const hello = await f.session.start();
    const answer = await f.session.request({ op: "diagnose", value: "unchanged" });
    assert.deepEqual(answer, mode === "success" ? { id: 1, ok: true, result: { value: "unchanged" } }
      : { id: 1, ok: false, error: { class: "NativeFixtureError", message: "native answer preserved" } });
    await f.session.close();
    const meta = retained(f.session, Buffer.concat([stderrDiagnostic, shutdownDiagnostic]),
      Buffer.from(JSON.stringify(hello) + "\n" + stdoutDiagnostic + JSON.stringify(answer) + "\n"));
    assert.equal(meta.code, 0);
    assert.equal(meta.last_request.ok, answer.ok);
    dead(f.session);
  } finally { await f.session.close(); rmSync(f.root, { recursive: true }); }
});

test("interruption retains original bytes and terminates only the owned adapter", async () => {
  const f = fixture("success");
  try {
    const hello = await f.session.start();
    const answer = await f.session.request({ op: "diagnose", value: "owned" });
    await f.session.interrupt("controlled test interruption");
    const meta = retained(f.session, stderrDiagnostic,
      Buffer.from(JSON.stringify(hello) + "\n" + stdoutDiagnostic + JSON.stringify(answer) + "\n"));
    assert.equal(meta.status, "interrupted");
    assert.equal(meta.interruption, "controlled test interruption");
    dead(f.session);
  } finally { await f.session.close(); rmSync(f.root, { recursive: true }); }
});

test("spawn failure records the real process error and empty original streams", async () => {
  const f = fixture("success");
  f.session.manifest.command = [path.join(f.root, "missing-owned-adapter")];
  try {
    await assert.rejects(f.session.start(), /spawn failed/);
    await f.session.close();
    const meta = retained(f.session, Buffer.alloc(0), Buffer.alloc(0));
    assert.equal(meta.status, "spawn-failed");
    assert.equal(meta.spawn_error.code, "ENOENT");
    assert.deepEqual(meta.command, f.session.manifest.command);
  } finally { await f.session.close(); rmSync(f.root, { recursive: true }); }
});

test("runner timeout stays distinct from a native adapter error and still closes the child", async () => {
  const f = fixture("hold");
  f.session.timeoutMs = 1;
  try {
    const hello = await f.session.start();
    const answer = await f.session.request({ op: "diagnose" });
    assert.equal(answer.error.class, "HarnessTimeout");
    await f.session.close();
    const meta = retained(f.session, Buffer.concat([stderrDiagnostic, shutdownDiagnostic]),
      Buffer.from(JSON.stringify(hello) + "\n" + stdoutDiagnostic));
    assert.equal(meta.last_request.timed_out, true);
    dead(f.session);
  } finally { await f.session.close(); rmSync(f.root, { recursive: true }); }
});

test("capture I/O failure cannot report complete evidence or leave its child running", async () => {
  const f = fixture("success");
  try {
    await f.session.start();
    closeSync(f.session.journal.streams.stderr.fd);
    await f.session.request({ op: "diagnose" }).catch(error => assert.match(error.message, /capture failed/));
    await f.session.closed;
    await assert.rejects(f.session.close(), /EBADF/);
    const meta = JSON.parse(readFileSync(f.session.diagnostics.manifest, "utf8"));
    assert.equal(meta.streams_complete, false);
    assert.equal(meta.status, "capture-failed");
    assert.match(meta.capture_error, /EBADF/);
    dead(f.session);
  } finally { f.session.kill(); await f.session.closed; rmSync(f.root, { recursive: true }); }
});

test("runner links persistent final stream hashes without changing its result inventory or grade", () => {
  const root = mkdtempSync(path.join(tmpdir(), "decko-diagnostic-runner-"));
  try {
    const { fixture: input, actual } = makeCapturedFixture(root);
    const meta = JSON.parse(readFileSync(path.join(actual, "run-meta.json"), "utf8"));
    assert.equal(meta.adapter_diagnostics.length, 4);
    for (const record of meta.adapter_diagnostics) {
      assert.equal(record.streams_complete, true);
      assert.equal(record.status, "exited");
      assert.equal(record.code, 0);
      assert.equal(existsSync(record.work_directory), false, "staged adapter work was removed");
      assert.equal(record.hello.engine, "fake");
      assert.match(record.source.commit, /^[a-f0-9]{40}$/);
      assert.ok(existsSync(record.manifest));
      for (const stream of Object.values(record.streams)) {
        assert.equal(createHash("sha256").update(readFileSync(stream.path)).digest("hex"), stream.sha256);
      }
    }
    const grade = gradeSyntheticRun({ fixture: input, actual });
    assert.equal(grade.verdict, "pass");
    assert.deepEqual(grade.problems, []);
  } finally { rmSync(root, { recursive: true }); }
});

test("failed runner retains complete diagnostics after removing its staged deck", () => {
  const root = mkdtempSync(path.join(tmpdir(), "decko-diagnostic-failed-run-"));
  try {
    const input = makeFixture(root);
    const manifest = path.join(root, "adapter.json");
    const out = path.join(root, "results");
    writeFileSync(manifest, JSON.stringify({ name: "owned-failing-fixture",
      command: [process.execPath, path.join(here, "fake-adapter/diagnostic-adapter.mjs")], env: { DIAGNOSTIC_MODE: "before-ready" } }));
    const result = spawnSync(process.execPath, [path.join(here, "../run.mjs"), "--adapter", manifest,
      "--fixture", input, "--out", out, "--kinds", "render"], { windowsHide: true, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ONLY_USEFUL_NATIVE_CAUSE/);
    const meta = JSON.parse(readFileSync(path.join(out, "run-meta.json"), "utf8"));
    assert.equal(meta.runs.render.complete, false);
    const record = meta.adapter_diagnostics[0];
    assert.equal(record.code, 17);
    assert.equal(record.streams_complete, true);
    assert.equal(existsSync(record.work_directory), false);
    assert.deepEqual(readFileSync(record.streams.stderr.path), stderrDiagnostic);
    assert.deepEqual(readFileSync(record.streams.stdout.path), Buffer.from(stdoutDiagnostic));
    assert.throws(() => process.kill(record.pid, 0), error => error.code === "ESRCH");
  } finally { rmSync(root, { recursive: true }); }
});
