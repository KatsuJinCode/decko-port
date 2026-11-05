#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeForRecord } from "./normalize.mjs";
import { AdapterSession, loadAdapterManifest } from "./adapter-process.mjs";
import { rawDelta, snapshot, splitDelta } from "./deck-state.mjs";
import { WITHHELD_DIR, verifyFixture, withheldLine, withheldOpsOf, withheldScenariosOf, withheldStatus } from "./manifest.mjs";
import { randomUUID } from "node:crypto";
import { SOURCE_FORMAT, finishAdapterInvocation, observeAdapterSource, prepareAdapterInvocation } from "./adapter-source-identity.mjs";
import { runtimeProfileContext } from "./adapter-runtime-profile.mjs";

export const RESULTS_FORMAT = 2;
const runId = randomUUID();

const args = parseArgs(process.argv.slice(2));
const manifest = loadAdapterManifest(args.adapter);
const fixture = path.resolve(args.fixture);
const outDir = path.resolve(args.out);
const kinds = (args.kinds ?? "render,semantics,scenarios").split(",");
const scenarioWorkers = Number(args["scenario-workers"] ?? 1);
if (!Number.isSafeInteger(scenarioWorkers) || scenarioWorkers < 1) throw new Error("--scenario-workers must be a positive integer");
for (const k of kinds) if (!["render", "semantics", "scenarios"].includes(k)) throw new Error(`unknown kind ${k}`);
const filter = args.filter ? new RegExp(args.filter) : null;
const limit = args.limit ? Number(args.limit) : Infinity;
const selection = filter || Number.isFinite(limit) ? { filter: args.filter ?? null, limit: Number.isFinite(limit) ? limit : null } : null;
const deckJson = path.join(fixture, "deck.json");
const deckDb = path.join(fixture, "deck", "deck.sqlite3");
const deckFiles = path.join(fixture, "deck", "files");
if (!existsSync(deckDb)) throw new Error(`no built deck at ${deckDb}; run oracle/build-deck.sh first`);
mkdirSync(outDir, { recursive: true });

const log = (line) => process.stderr.write(`[run] ${line}\n`);
const readLines = (file) =>
  readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));

const fixtureCheck = verifyFixture(fixture);
for (const p of fixtureCheck.problems) log(`fixture: ${p}`);
const withheld = withheldStatus(fixture);
if (withheld) process.stderr.write(`${withheldLine(withheld, path.join(args.fixture, WITHHELD_DIR))}\n`);
const sourceBefore = observeAdapterSource(manifest.dir);
const checkout = { commit: sourceBefore.commit, dirty: sourceBefore.dirty };
const sourceBindings = [];
let currentSourceBinding;

function stageDeck(root) {
  const work = mkdtempSync(path.join(root, "session-"));
  cpSync(deckDb, path.join(work, "deck.sqlite3"));
  convertToRollbackJournal(path.join(work, "deck.sqlite3"));
  if (existsSync(deckFiles)) cpSync(deckFiles, path.join(work, "files"), { recursive: true });
  else mkdirSync(path.join(work, "files"));
  mkdirSync(path.join(work, "adapter"));
  const slash = (p) => p.replaceAll("\\", "/");
  return {
    work,
    db: path.join(work, "deck.sqlite3"),
    env: {
      HARNESS_DECK: slash(path.join(work, "deck.sqlite3")),
      HARNESS_FILES: slash(path.join(work, "files")),
      HARNESS_DECK_JSON: slash(deckJson),
      HARNESS_WORK: slash(path.join(work, "adapter")),
    },
  };
}

function convertToRollbackJournal(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode = DELETE");
  } finally {
    db.close();
  }
}

const activeSessions = new Set();
let interrupted;
const onInterrupt = signal => {
  interrupted ??= signal;
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  for (const session of activeSessions) session.interrupt(`runner received ${signal}`).catch(error => log(`adapter interruption failed: ${error.message}`));
};
const onSigint = () => onInterrupt("SIGINT");
const onSigterm = () => onInterrupt("SIGTERM");
process.on("SIGINT", onSigint);
process.on("SIGTERM", onSigterm);

async function withSession(root, fn) {
  if (interrupted) throw new Error(`runner interrupted by ${interrupted}; no adapter started`);
  const started = Date.now();
  const stage = stageDeck(root);
  stage.timings = { stage_ms: Date.now() - started };
  const sourceRoot = path.join(outDir, "adapter-source");
  mkdirSync(sourceRoot, { recursive: true });
  const invocationId = randomUUID();
  const invocation = prepareAdapterInvocation(manifest, path.join(sourceRoot, `${invocationId}.json`), stage.env, sourceBefore);
  invocation.record.run_id = runId;
  invocation.record.invocation_id = invocationId;
  const profileContext = runtimeProfileContext(runId, invocationId, checkout);
  currentSourceBinding.invocations.push(invocation.record);
  const session = new AdapterSession(invocation.manifest, invocation.env, {
    log, diagnosticsRoot: path.join(outDir, "adapter-diagnostics"), source: checkout, runtimeProfileContext: profileContext,
  });
  const diagnosticRecord = session.diagnostics;
  meta.adapter_diagnostics.push(diagnosticRecord);
  saveMeta();
  activeSessions.add(session);
  try {
    const bootStarted = Date.now();
    const hello = await session.start();
    stage.timings.boot_ms = Date.now() - bootStarted;
    const operationsStarted = Date.now();
    const result = await fn(session, stage, hello);
    stage.timings.operations_ms = Date.now() - operationsStarted;
    return result;
  } finally {
    const closeStarted = Date.now();
    try { await session.close(); }
    finally {
      Object.assign(diagnosticRecord, session.diagnostics);
      invocation.record.pid = session.child?.pid ?? null;
      invocation.record.runtime_profile = session.runtimeProfile;
      finishAdapterInvocation(invocation.record);
      saveMeta();
      activeSessions.delete(session);
      stage.timings.close_ms = Date.now() - closeStarted;
      removeQuietly(stage.work);
    }
  }
}

const metaPath = path.join(outDir, "run-meta.json");
const earlier = existsSync(metaPath) ? safeJson(readFileSync(metaPath, "utf8")) : null;
const keep = earlier && earlier.results_format === RESULTS_FORMAT && earlier.fixture === path.basename(fixture) ? earlier.runs ?? {} : {};
const meta = { results_format: RESULTS_FORMAT, runner_execution_id: runId, fixture: path.basename(fixture), runs: { ...keep },
  adapter_diagnostics: earlier?.results_format === RESULTS_FORMAT && earlier.fixture === path.basename(fixture)
    ? earlier.adapter_diagnostics ?? [] : [] };
const saveMeta = () => writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");

function beginKind(kind, opsTotal, extra = {}) {
  currentSourceBinding = { format: SOURCE_FORMAT, before: sourceBefore, after: null, invocations: [] };
  sourceBindings.push(currentSourceBinding);
  const run = {
    started: new Date().toISOString(),
    finished: null,
    complete: false,
    selection,
    ops_total: opsTotal,
    ops_run: 0,
    adapter: manifest.name,
    lane: manifest.lane ?? null,
    adapter_checkout: checkout,
    source_binding: currentSourceBinding,
    engine: null,
    fixture_digest: fixtureCheck.digest,
    fixture_problems: fixtureCheck.problems,
    ...extra,
  };
  meta.runs[kind] = run;
  saveMeta();
  return run;
}

const root = mkdtempSync(path.join(os.tmpdir(), "decko-harness-"));
try {
  for (const kind of ["render", "semantics"]) {
    if (!kinds.includes(kind)) continue;
    const all = [...readLines(path.join(fixture, "ops", `${kind}.jsonl`)), ...(withheldOpsOf(fixture, kind) ?? [])];
    const ops = all.filter((o) => !filter || filter.test(o.id)).slice(0, limit);
    const run = beginKind(kind, all.length);
    const outFile = path.join(outDir, `${kind}.jsonl`);
    writeFileSync(outFile, "");
    await withSession(root, async (session, stage, hello) => {
      run.engine = hello;
      const startState = snapshot(stage.db);
      const t0 = Date.now();
      for (const op of ops) {
        const { id, ...body } = op;
        const answer = await session.request(body);
        appendFileSync(outFile, JSON.stringify({ id, ...(answer.ok ? { result: normalizeForRecord(answer.result) } : { error: answer.error }) }) + "\n");
        if (++run.ops_run % 100 === 0) log(`${kind} ${run.ops_run}/${ops.length} ${((Date.now() - t0) / run.ops_run).toFixed(0)} ms/op`);
      }
      run.ms_per_op = ops.length ? Math.round((Date.now() - t0) / ops.length) : 0;
      run.session_writes = rawDelta(startState, snapshot(stage.db));
    });
    run.finished = new Date().toISOString();
    run.complete = run.ops_run === ops.length;
    saveMeta();
    log(`${kind} done: ${run.ops_run} ops`);
  }

  if (kinds.includes("scenarios")) {
    const all = [...JSON.parse(readFileSync(path.join(fixture, "ops", "scenarios.json"), "utf8")).scenarios, ...(withheldScenariosOf(fixture) ?? [])];
    const scenarios = all.filter((s) => !filter || filter.test(s.id)).slice(0, limit);
    const run = beginKind("scenarios", all.length, { steps_total: all.reduce((n, s) => n + s.steps.length, 0), steps_run: 0, session_timings: [] });
    const outFile = path.join(outDir, "scenarios.jsonl");
    writeFileSync(outFile, "");
    if (scenarios.length === 0) {
      await withSession(root, async (_session, _stage, hello) => {
        run.engine = hello;
      });
    }
    let nextScenario = 0;
    let nextOutput = 0;
    let firstError;
    const completed = new Map();
    run.scenario_workers = Math.min(scenarioWorkers, scenarios.length);
    const worker = async () => {
    while (!firstError && nextScenario < scenarios.length) {
      const index = nextScenario++;
      const scenario = scenarios[index];
      const steps = await withSession(root, async (session, stage, hello) => {
        run.session_timings.push({ id: scenario.id, timings: stage.timings });
        run.engine ??= hello;
        if (JSON.stringify(run.engine) !== JSON.stringify(hello)) run.engine_changed = true;
        const results = [];
        for (const step of scenario.steps) {
          const before = snapshot(stage.db);
          const answer = await session.request(step);
          const { rows, other } = splitDelta(rawDelta(before, snapshot(stage.db)));
          results.push({
            ...(answer.ok ? { result: normalizeForRecord(answer.result) } : { error: answer.error }),
            rows,
            ...(Object.keys(other).length ? { other_tables: other } : {}),
          });
          run.steps_run++;
        }
        return results;
      });
      completed.set(index, { id: scenario.id, steps });
      while (completed.has(nextOutput)) {
        appendFileSync(outFile, JSON.stringify(completed.get(nextOutput)) + "\n");
        completed.delete(nextOutput++);
      }
      run.ops_run++;
      log(`scenario ${scenario.id}: ${steps.length} steps`);
      saveMeta();
    }
    };
    await Promise.all(Array.from({ length: run.scenario_workers }, () => worker().catch((error) => { firstError ??= error; })));
    if (firstError) throw firstError;
    run.finished = new Date().toISOString();
    run.complete = run.ops_run === scenarios.length;
    saveMeta();
  }
} finally {
  const sourceAfter = observeAdapterSource(manifest.dir);
  for (const binding of sourceBindings) binding.after = sourceAfter;
  saveMeta();
  removeQuietly(root);
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function removeQuietly(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    log(`could not remove ${dir}: ${error.message}`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) throw new Error(`unexpected argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  for (const required of ["adapter", "fixture", "out"]) {
    if (!out[required]) throw new Error(`--${required} is required`);
  }
  return out;
}
