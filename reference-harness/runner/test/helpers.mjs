import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { writeExpectedManifest, writeFixtureManifest } from "../manifest.mjs";
import { gradeRun } from "../grade-lib.mjs";
import { gitObject, inventoryTree, sha256, SOURCE_FORMAT } from "../adapter-source-identity.mjs";
import { pathToFileURL } from "node:url";
import { scratchDir } from "../../../tests/support/scratch-dir.mjs";
import { sourceGitEnvironment } from "../source-git-environment.mjs";

const syntheticBytes = Buffer.from("// Explicit synthetic source for checker fixtures only.\n");
const syntheticFile = { path: "adapter.mjs", mode: "100644", expected_oid: gitObject("blob", syntheticBytes), actual_oid: gitObject("blob", syntheticBytes), bytes: syntheticBytes.length, sha256: sha256(syntheticBytes) };
const syntheticCommit = Buffer.from(`tree ${inventoryTree([syntheticFile])}\nauthor Synthetic Fixture <fixture@example.invalid> 0 +0000\ncommitter Synthetic Fixture <fixture@example.invalid> 0 +0000\n\nSynthetic checker fixture, not a real engine.\n`);
export const SYNTHETIC_CANDIDATE = gitObject("commit", syntheticCommit);
export function syntheticSourceBinding() {
  const root = path.resolve(os.tmpdir(), "explicit-synthetic-checker-source");
  const entry = path.join(root, "adapter.mjs");
  const observation = { purpose: "synthetic instrument fixture, not engine provenance", root, commit: SYNTHETIC_CANDIDATE, commit_object: syntheticCommit.toString("base64"), dirty: false, problems: [], files: [syntheticFile] };
  return structuredClone({ format: SOURCE_FORMAT, before: observation, after: observation, invocations: [{
    cwd: root, requested_command: [process.execPath, "adapter.mjs"],
    command: [process.execPath, "--import", "file:///explicit-synthetic-witness.mjs", "adapter.mjs"],
    observer: { url: "file:///explicit-synthetic-witness.mjs", sha256: "0".repeat(64) }, pid: 1,
    entry: { path: entry, realpath: entry, sha256: syntheticFile.sha256, actual_oid: syntheticFile.actual_oid },
    runtime: { path: process.execPath, sha256: "0".repeat(64) }, problems: [],
    audit: { format: "decko-module-witness/1", pid: 1, complete: true, problems: [],
      generated_observer: { format: "decko-v8-source-observer/1", active: true, closed: true, pending: 0, events_observed: 0, bound_events: 0, unbound_events: 0, errors: [] }, generated_sources: [],
      modules: [{ url: pathToFileURL(entry).href, raw_sha256: syntheticFile.sha256, loaded_sha256: syntheticFile.sha256, loaded_oid: syntheticFile.expected_oid }] },
  }] });
}
export const gradeSyntheticRun = options => gradeRun({ candidateCommit: SYNTHETIC_CANDIDATE, ...options });

const here = path.dirname(fileURLToPath(import.meta.url));
export const RUNNER = path.join(here, "..");
export const FAKE_ADAPTER = path.join(here, "fake-adapter", "adapter.json");
export const HARNESS = path.join(RUNNER, "..");
let ownedFakeAdapter;
function fakeAdapterFixture() {
  const script = readFileSync(path.join(here, "fake-adapter", "adapter.mjs"));
  const manifest = readFileSync(FAKE_ADAPTER);
  if (!ownedFakeAdapter) {
    const root = scratchDir("runner-owned-fake-source-");
    const dir = path.join(root, "adapter");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "adapter.mjs"), script);
    writeFileSync(path.join(dir, "adapter.json"), manifest);
    const git = args => execFileSync("git", ["-C", dir, ...args], { windowsHide: true, env: sourceGitEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    git(["init"]);
    git(["add", "--", "adapter.mjs", "adapter.json"]);
    git(["commit", "-m", "Create owned fake adapter source fixture", "--", "adapter.mjs", "adapter.json"]);
    ownedFakeAdapter = { path: path.join(dir, "adapter.json"), script, manifest };
  }
  if (!script.equals(ownedFakeAdapter.script) || !manifest.equals(ownedFakeAdapter.manifest)) throw Error("Fake adapter source changed during this test process");
  return ownedFakeAdapter.path;
}

export function scratch() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) };
}

export function makeFixture(root) {
  const dir = path.join(root, "tiny-v1");
  mkdirSync(path.join(dir, "deck", "files"), { recursive: true });
  mkdirSync(path.join(dir, "ops"), { recursive: true });
  writeFileSync(
    path.join(dir, "deck.json"),
    JSON.stringify({
      format: "decko-reference-deck/1",
      name: "tiny-v1",
      clock: "2026-09-19T12:00:00Z",
      environment: { origin: "http://deck.example" },
      actors: { anonymous: { card: "Anonymous" }, member: { card: "Mira Member" } },
      cards: [],
    }) + "\n",
  );
  const db = new DatabaseSync(path.join(dir, "deck", "deck.sqlite3"));
  db.exec("CREATE TABLE cards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, codename TEXT, right_id INTEGER, db_content TEXT, updated_at TEXT)");
  db.exec("INSERT INTO cards (name, updated_at) VALUES ('Alpha', '2026-09-19 12:00:00'), ('Beta', '2026-09-19 12:00:00')");
  db.exec("CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT)");
  db.close();
  const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(
    path.join(dir, "ops", "render.jsonl"),
    jsonl([
      { id: "page:anonymous:Alpha", op: "render", actor: "anonymous", card: "Alpha" },
      { id: "core:anonymous:Alpha", op: "render", actor: "anonymous", card: "Alpha", view: "core" },
      { id: "page:member:Beta", op: "render", actor: "member", card: "Beta" },
    ]),
  );
  writeFileSync(
    path.join(dir, "ops", "semantics.jsonl"),
    jsonl([
      { id: "card:anonymous:Alpha", op: "ask", actor: "anonymous", q: "card", card: "Alpha" },
      { id: "name:anonymous:Beta", op: "ask", actor: "anonymous", q: "name", name: "Beta" },
    ]),
  );
  writeFileSync(
    path.join(dir, "ops", "scenarios.json"),
    JSON.stringify({
      scenarios: [
        { id: "create-then-render", steps: [
          { op: "write", actor: "member", action: "create", card: "Gamma", fields: { content: "hi" } },
          { op: "render", actor: "member", card: "Gamma" },
        ] },
        { id: "sign-in", steps: [{ op: "signin", email: "m@example.test", password: "x" }] },
      ],
    }) + "\n",
  );
  writeFixtureManifest(dir);
  return dir;
}

export function runFake(fixture, out, { mode = "", version = 1, extraArgs = [] } = {}) {
  const result = spawnSync(
    process.execPath,
    [path.join(RUNNER, "run.mjs"), "--adapter", fakeAdapterFixture(), "--fixture", fixture, "--out", out, ...extraArgs],
    { encoding: "utf8", windowsHide: true, env: { ...process.env, FAKE_MODE: mode, FAKE_VERSION: String(version) } },
  );
  if (result.status === 0) {
    const file = path.join(out, "run-meta.json");
    const meta = readJson(file);
    for (const run of Object.values(meta.runs)) {
      run.adapter_checkout = { commit: SYNTHETIC_CANDIDATE, dirty: false };
      run.source_binding = syntheticSourceBinding();
    }
    writeJson(file, meta);
  }
  return result;
}

export function makeCapturedFixture(root, { captureOpts = {}, runOpts = {} } = {}) {
  const fixture = makeFixture(root);
  const expected = path.join(fixture, "expected");
  const cap = runFake(fixture, expected, captureOpts);
  if (cap.status !== 0) throw new Error(`capture failed: ${cap.stderr}`);
  writeExpectedManifest(fixture, expected);
  const actual = path.join(root, "good");
  const run = runFake(fixture, actual, runOpts);
  if (run.status !== 0) throw new Error(`run failed: ${run.stderr}`);
  return { fixture, expected, actual };
}

export function copyDir(from, to) {
  cpSync(from, to, { recursive: true });
  return to;
}

export const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
export const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");

export function gradeCli(args, { candidate = true } = {}) {
  const pin = candidate && !args.includes("--candidate-commit") && !args.includes("--diagnostic")
    ? ["--candidate-commit", SYNTHETIC_CANDIDATE] : [];
  const r = spawnSync(process.execPath, [path.join(RUNNER, "grade.mjs"), ...args, ...pin], { encoding: "utf8", windowsHide: true });
  return { status: r.status, stdout: r.stdout + r.stderr };
}
