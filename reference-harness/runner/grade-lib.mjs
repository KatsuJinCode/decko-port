import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { EXPECTED_MANIFEST_FORMAT, WITHHELD_DIR, laneExpectedDir, resultFiles, storedFileHashes, verifyFixture, withheldLine, withheldOpsOf, withheldScenariosOf, withheldStatus } from "./manifest.mjs";
import { RULE_ORDER, normalizeErrorRecord, normalizeRender, sameFailure, sameJson, stable } from "./normalize.mjs";
import { maskPasswordDigests, passwordDigestContext, validateDeclaredDivergences } from "./divergences.mjs";
import { byteCheckerIdentity } from "./byte-checker-identity.mjs";
import { sourceBindingProblems } from "./adapter-source-identity.mjs";

export const RESULTS_FORMAT = 2;
export const PROTOCOL = 1;
export const KINDS = ["rendering", "semantics", "persistence", "side_effects"];
const RUN_KINDS = ["render", "semantics", "scenarios"];

export const EXIT = { pass: 0, fail: 1, invalid: 2, partial: 2, "diagnostic-pass": 2, "diagnostic-fail": 2 };

export function gradeRun({ fixture, actual, expected, candidateCommit, diagnostic = false, allowPartial = false, classTokenOrder = true, declaredOtherTables = {}, declaredDivergences = {}, lane = null }) {
  const declared = validateDeclaredOtherTables(declaredOtherTables);
  const divergences = validateDeclaredDivergences(declaredDivergences);
  const applied = new Set();
  const normalizeOptions = { classTokenOrder, applied };
  const fixtureDir = path.resolve(fixture);
  const actualDir = path.resolve(actual);
  const expectedDir = path.resolve(expected ?? path.join(fixtureDir, "expected"));
  const problems = [];
  const partial = [];
  const warnings = [];
  const validCommit = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value) && !/^0{40}$/.test(value);
  if (!diagnostic && !validCommit(candidateCommit)) problems.push("candidate: supply the exact nonzero full source commit");
  if (diagnostic && candidateCommit !== undefined) problems.push("candidate: diagnostic mode cannot qualify a candidate");
  if (diagnostic) warnings.push("diagnostic comparison only: no candidate acceptance or release grade");

  const fixtureCheck = verifyFixture(fixtureDir);
  for (const p of fixtureCheck.problems) problems.push(`fixture: ${p}`);
  const digest = fixtureCheck.digest;
  const ops = loadOps(fixtureDir);
  const divergenceRecords = Object.entries(divergences).map(([name, why]) => ({ name, why, masked: [] }));
  const digestContext = "password-digest" in divergences ? passwordDigestContext(fixtureDir) : null;
  const maskDelta = (where, side, delta) => {
    if (digestContext === null || delta === undefined || delta === null) return delta;
    const { delta: out, masked } = maskPasswordDigests(delta, digestContext);
    const record = divergenceRecords.find((d) => d.name === "password-digest");
    for (const at of masked) record.masked.push({ at: where, side, path: at });
    return out;
  };

  const expManifest = readJson(path.join(expectedDir, "MANIFEST.json"));
  let oracle = null;
  if (!expManifest.ok) {
    problems.push(`expected: ${expManifest.error}`);
  } else {
    const m = expManifest.value;
    if (m.format !== EXPECTED_MANIFEST_FORMAT) problems.push(`expected: manifest format is ${m.format}, expected ${EXPECTED_MANIFEST_FORMAT}`);
    if (m.fixture !== path.basename(fixtureDir)) problems.push(`expected: captured for fixture "${m.fixture}", not "${path.basename(fixtureDir)}"`);
    if (digest && m.fixture_digest !== digest) problems.push(`expected: captured on fixture digest ${m.fixture_digest}, fixture is ${digest}`);
    oracle = { variant: m.oracle?.variant ?? null, patches: m.oracle?.patches ?? null, engine: m.engine ?? null };
    if (!oracle.variant) problems.push("expected: manifest names no oracle variant");
    else if (oracle.variant === "stock" && (oracle.patches ?? []).length > 0) problems.push("expected: a stock oracle manifest lists patches");
    else if (oracle.variant !== "stock" && (oracle.patches ?? []).length === 0) problems.push(`expected: patched variant "${oracle.variant}" lists no patches`);
    if (oracle.variant && oracle.variant !== "stock" && path.basename(expectedDir) === "expected") {
      problems.push(`expected: patched variant "${oracle.variant}" is stored in expected/, which holds the stock oracle only`);
    }
    if (oracle.variant === "stock" && path.basename(expectedDir) !== "expected") {
      warnings.push(`expected: stock oracle outputs read from ${path.basename(expectedDir)}/ rather than expected/`);
    }
    const listed = m.files ?? {};
    for (const [file, h] of Object.entries(listed)) {
      const abs = path.join(expectedDir, file);
      if (!existsSync(abs)) problems.push(`expected: file missing: ${file}`);
      else if (storedFileHashes(abs).sha256 !== h.sha256) problems.push(`expected: file changed since its manifest: ${file}`);
    }
    if (existsSync(expectedDir)) for (const f of resultFiles(expectedDir)) if (!(f in listed)) problems.push(`expected: file not in its manifest: ${f}`);
  }
  const expRuns = expManifest.ok ? expManifest.value.runs ?? {} : {};
  const withheld = withheldStatus(fixtureDir);
  const withheldExpectedDir = withheld?.present ? path.join(withheld.dir, path.basename(expectedDir)) : null;
  const exp = loadResults(expectedDir, "expected", ops, problems, problems, withheldExpectedDir);
  const laneOverlay = lane === null ? null : loadLaneOverlay(fixtureDir, lane, digest, ops, problems, warnings);
  const laneCounts = { render: 0, semantics: 0, scenarios: 0 };
  if (laneOverlay) {
    for (const kind of ["render", "semantics", "scenarios"]) {
      for (const [id, line] of laneOverlay[kind]) {
        exp[kind].set(id, line);
        laneCounts[kind]++;
      }
    }
  }

  const metaRead = readJson(path.join(actualDir, "run-meta.json"));
  const meta = metaRead.ok ? metaRead.value : null;
  const actRuns = meta?.runs ?? {};
  if (!metaRead.ok) problems.push(`results: ${metaRead.error}`);
  else {
    if (meta.results_format !== RESULTS_FORMAT) problems.push(`results: run-meta.json results_format is ${meta.results_format}, the grader reads ${RESULTS_FORMAT}`);
    if (meta.fixture !== path.basename(fixtureDir)) problems.push(`results: run-meta.json names fixture "${meta.fixture}", not "${path.basename(fixtureDir)}"`);
    for (const kind of RUN_KINDS) checkRunRecord(kind, actRuns[kind], { digest, ops, problems, partial, warnings, candidateCommit, diagnostic, validCommit });
    checkOneEngine(actRuns, problems, warnings);
  }
  const act = loadResults(actualDir, "results", ops, problems, partial);

  const tally = Object.fromEntries(KINDS.map((k) => [k, { graded: 0, pass: 0, fail: 0, reproduced_upstream_failures: 0, oracle_errors: 0, missing: 0, groups: {} }]));
  const failures = Object.fromEntries(KINDS.map((k) => [k, []]));
  const reproduced = Object.fromEntries(KINDS.map((k) => [k, []]));
  const readWrites = { graded: 0, pass: 0, fail: 0, failures: [] };
  const otherTableWrites = [];
  const otherTables = { graded: 0, pass: 0, declared: 0, fail: 0, failures: [] };
  const laneTables = laneOverlay?.oracleTables ?? null;
  const oracleTables = laneTables ? new Set(laneTables) : oracleSchemaTables(fixtureDir);
  if (oracleTables === undefined) warnings.push("fixture: no built deck to read the oracle's schema from; every table is compared");
  const engineOnlyWrites = [];
  const isOracleTable = (t) => oracleTables === undefined || oracleTables.has(t);
  const selected = (kind, id) => !allowPartial || act.present[kind].has(id);

  const grade = (kind, group, id, e, a, mode) => {
    const t = tally[kind];
    t.groups[group] ??= { graded: 0, pass: 0 };
    if (e.error) {
      if (isCaptureFault(e.error)) {
        t.oracle_errors++;
        return;
      }
      t.graded++;
      t.groups[group].graded++;
      if (a === undefined) {
        t.missing++;
        t.fail++;
        failures[kind].push({ id, group, reason: "no result recorded" });
        return;
      }
      if (a.error === undefined || a.error === null) {
        t.fail++;
        failures[kind].push({
          id,
          group,
        reason: `upstream failure not reproduced: the oracle raised ${e.error.class}: ${e.error.message} and the engine rendered a result`,
        diff: firstDifference(stable(e.error), stable(a.value ?? null)),
        });
        return;
      }
      if (sameFailure(e.error, a.error, applied)) {
        t.reproduced_upstream_failures++;
        reproduced[kind].push({ id, group, oracle: e.error, engine: a.error });
        return;
      }
      t.fail++;
      failures[kind].push({
        id,
        group,
        reason: `reproduced a different failure: the oracle raised ${e.error.class}: ${e.error.message}, the engine ${a.error.class}: ${a.error.message}`,
        diff: firstDifference(normalizeErrorRecord(e.error), normalizeErrorRecord(a.error)),
      });
      return;
    }
    t.graded++;
    t.groups[group].graded++;
    if (a === undefined) {
      t.missing++;
      t.fail++;
      failures[kind].push({ id, group, reason: "no result recorded" });
      return;
    }
    if (a.error) {
      t.fail++;
      failures[kind].push({ id, group, reason: `adapter error ${a.error.class}: ${a.error.message}` });
      return;
    }
    if (sameJson(e.value, a.value)) {
      t.pass++;
      t.groups[group].pass++;
    } else {
      t.fail++;
      failures[kind].push({ id, group, reason: "differs", diff: firstDifference(e.value, a.value), ...(mode === "rows" ? { differences: leafDifferences(e.value, a.value) } : {}) });
    }
  };
  const gradeReadWrites = (id, expWrites, actWrites) => {
    readWrites.graded++;
    if (actWrites === undefined) {
      readWrites.fail++;
      readWrites.failures.push({ id, reason: "not recorded" });
    } else if (sameJson(expWrites ?? {}, actWrites)) {
      readWrites.pass++;
    } else {
      readWrites.fail++;
      readWrites.failures.push({ id, reason: "wrote rows the oracle did not", differences: leafDifferences(expWrites ?? {}, actWrites) });
    }
  };
  const otherTableStepsGraded = new Set();
  const declaredOccurred = new Set();
  const gradeOtherTables = (id, expOtherAll, actOtherAll) => {
    const pick = (o, keep) => Object.fromEntries(Object.entries(o).filter(([t]) => keep(t)));
    const expOther = pick(expOtherAll, isOracleTable);
    const actOther = pick(actOtherAll, isOracleTable);
    for (const [table, delta] of Object.entries(pick(actOtherAll, (t) => !isOracleTable(t)))) engineOnlyWrites.push({ id, table, delta });
    const record = { id, expected: expOther, actual: actOther };
    otherTableWrites.push(record);
    otherTables.graded++;
    otherTableStepsGraded.add(id);
    if (sameJson(expOther, actOther)) {
      record.verdict = "pass";
      otherTables.pass++;
      return;
    }
    const tables = [...new Set([...Object.keys(expOther), ...Object.keys(actOther)])].sort();
    const differing = tables.filter((t) => !sameJson(expOther[t] ?? {}, actOther[t] ?? {}));
    const why = (t) => declared[id]?.[t];
    for (const t of differing) if (why(t) !== undefined) declaredOccurred.add(`${id}\u0000${t}`);
    const undeclared = differing.filter((t) => why(t) === undefined);
    if (undeclared.length === 0) {
      record.verdict = "declared";
      record.declared = differing.map((t) => ({ table: t, why: why(t) }));
      otherTables.declared++;
      return;
    }
    record.verdict = "fail";
    otherTables.fail++;
    otherTables.failures.push({
      id,
      reason: "wrote rows in tables outside the card tables that the oracle's write did not, and not declared",
      tables: undeclared,
      differences: differing.map((t) => ({ table: t, declared: why(t) !== undefined, differences: leafDifferences(expOther[t] ?? {}, actOther[t] ?? {}) })),
    });
  };
  const wrap = (line, norm) => (line === undefined ? undefined : line.error ? { error: line.error } : { value: norm(line.result) });
  const ident = (r) => r;

  for (const [id, e] of exp.render) {
    if (!selected("render", id)) continue;
    const [view, actor] = id.split(":");
    grade("rendering", `${view === "page" ? "page" : "view"} / ${actor}`, id, wrap(e, (r) => normalizeRender(r, normalizeOptions)), wrap(act.render.get(id), (r) => normalizeRender(r, normalizeOptions)));
  }
  for (const [id, e] of exp.semantics) {
    if (!selected("semantics", id)) continue;
    grade("semantics", id.split(":")[0], id, wrap(e, ident), wrap(act.semantics.get(id), ident));
  }
  for (const kind of ["render", "semantics"]) {
    if (allowPartial && !actRuns[kind]) continue;
    const id = `${kind} session`;
    gradeReadWrites(id, maskDelta(id, "expected", expRuns[kind]?.session_writes), maskDelta(id, "actual", actRuns[kind]?.session_writes));
  }
  for (const [sid, e] of exp.scenarios) {
    if (!selected("scenarios", sid)) continue;
    const steps = ops.scenarios.get(sid)?.steps ?? [];
    const a = act.scenarios.get(sid);
    e.steps.forEach((step, i) => {
      const op = steps[i];
      const id = `${sid}#${i + 1}`;
      const actStep = a?.steps?.[i];
      if (op.op === "render") grade("rendering", "after write", id, wrap(step, (r) => normalizeRender(r, normalizeOptions)), wrap(actStep, (r) => normalizeRender(r, normalizeOptions)));
      else if (op.op === "ask") grade("semantics", "after write", id, wrap(step, ident), wrap(actStep, ident));
      else {
        grade("side_effects", op.op === "signin" ? "sign-in" : `write ${op.action}`, id, wrap(step, ident), wrap(actStep, ident));
      }
      if (op.op === "write") {
        if (step.rows === undefined && !step.error) problems.push(`expected: scenario step ${id} has no row delta`);
        const rows = (s, side) =>
          s === undefined ? undefined : s.rows === undefined ? { error: { class: "HarnessMissingRows", message: "no row delta recorded" } } : { value: maskDelta(id, side, s.rows) };
        grade("persistence", `write ${op.action}`, id, rows(step, "expected"), rows(actStep, "actual"), "rows");
        if (step.other_tables || actStep?.other_tables) gradeOtherTables(id, step.other_tables ?? {}, actStep?.other_tables ?? {});
      } else {
        const all = (s, side) => (s === undefined ? undefined : maskDelta(id, side, { ...(s.rows ?? {}), ...(s.other_tables ?? {}) }));
        gradeReadWrites(id, all(step, "expected"), actStep && actStep.rows !== undefined ? all(actStep, "actual") : undefined);
      }
    });
  }

  const staleOtherTables = [];
  for (const [id, tables] of Object.entries(declared)) {
    for (const table of Object.keys(tables)) {
      if (declaredOccurred.has(`${id}\u0000${table}`)) continue;
      if (allowPartial && !otherTableStepsGraded.has(id)) continue;
      staleOtherTables.push({
        id,
        table,
        why: tables[table],
        reason: otherTableStepsGraded.has(id)
          ? "the step's table matches the oracle's: the declared difference no longer occurs"
          : "no write step of this grade has this id: the declaration names nothing",
      });
    }
  }
  const staleDivergences = allowPartial ? [] : divergenceRecords.filter((d) => d.masked.length === 0).map((d) => d.name);
  for (const d of divergenceRecords) d.stale = d.masked.length === 0 && !allowPartial;

  const summary = Object.fromEntries(
    KINDS.map((k) => [k, { ...tally[k], rate: tally[k].graded ? +((tally[k].pass / tally[k].graded) * 100).toFixed(2) : null }]),
  );
  if (KINDS.some((k) => tally[k].graded > 0) || readWrites.graded > 0 || otherTables.graded > 0) applied.add("N2");
  const allPass = KINDS.every((k) => summary[k].fail === 0) && readWrites.fail === 0 && otherTables.fail === 0 && staleOtherTables.length === 0 && staleDivergences.length === 0;
  const verdict = problems.length > 0 ? "invalid" : partial.length > 0 ? (allowPartial ? "partial" : "invalid") : diagnostic ? (allPass ? "diagnostic-pass" : "diagnostic-fail") : allPass ? "pass" : "fail";
  if (!allowPartial) problems.push(...partial.map((p) => `incomplete: ${p}`));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workspaceRelative = (dir) => {
    const rel = path.relative(repoRoot, dir);
    return (rel === "" ? "." : rel).split(path.sep).join("/");
  };
  return {
    fixture: path.basename(fixtureDir),
    fixture_digest: digest,
    ...(lane !== null ? { lane: { name: lane, overlay_ops: laneCounts, overlay: laneOverlay ? workspaceRelative(laneExpectedDir(fixtureDir, lane)) : null } } : {}),
    ...(withheld ? { withheld: { label: withheld.label, ops: withheld.total, run: withheld.present, line: withheldLine(withheld, workspaceRelative(path.join(fixtureDir, WITHHELD_DIR))) } } : {}),
    actual: workspaceRelative(actualDir),
    expected: workspaceRelative(expectedDir),
    oracle,
    engine: meta ? firstEngine(actRuns) : null,
    adapter_checkout: actRuns.render?.adapter_checkout ?? actRuns.scenarios?.adapter_checkout ?? null,
    source_qualification: {
      mode: diagnostic ? "diagnostic" : "candidate",
      evidence_scope: RUN_KINDS.some(kind => Array.isArray(actRuns[kind]?.source_binding?.invocations) && actRuns[kind].source_binding.invocations.some(invocation => invocation?.canonical))
        ? "Canonical admission requires committed Git inputs and recorded runtime artifacts with lock-matched package versions; publisher integrity is not established"
        : "Direct-file admission requires committed Git inputs and the recorded Node executable identity; external non-Git source is not admitted",
      requested_candidate: candidateCommit ?? null,
      qualified: !diagnostic && validCommit(candidateCommit) && RUN_KINDS.every(kind =>
        actRuns[kind]?.adapter_checkout?.commit === candidateCommit && actRuns[kind]?.adapter_checkout?.dirty === false &&
        sourceBindingProblems(actRuns[kind]?.source_binding, candidateCommit).length === 0),
    },
    checker: byteCheckerIdentity(),
    verdict,
    problems,
    partial: allowPartial ? partial : [],
    warnings,
    normalization: RULE_ORDER.filter((rule) => applied.has(rule)),
    declared_divergences: divergenceRecords,
    summary,
    read_writes: readWrites,
    other_tables: otherTables,
    stale_declarations: staleOtherTables,
    stale_divergences: staleDivergences,
    other_table_writes: otherTableWrites,
    engine_only_tables: {
      tables: [...new Set(engineOnlyWrites.map((w) => w.table))].sort(),
      writes: engineOnlyWrites,
    },
    failures,
    reproduced,
  };
}

function loadLaneOverlay(fixtureDir, lane, digest, ops, problems, warnings) {
  const dir = laneExpectedDir(fixtureDir, lane);
  if (!existsSync(dir)) {
    warnings.push(`lane ${lane}: no overlay directory; the base expectations grade every op`);
    return null;
  }
  const read = readJson(path.join(dir, "MANIFEST.json"));
  if (!read.ok) {
    problems.push(`lane ${lane}: ${read.error}`);
    return null;
  }
  const m = read.value;
  if (m.format !== EXPECTED_MANIFEST_FORMAT) problems.push(`lane ${lane}: manifest format is ${m.format}, expected ${EXPECTED_MANIFEST_FORMAT}`);
  if (m.fixture !== path.basename(fixtureDir)) problems.push(`lane ${lane}: overlay captured for fixture "${m.fixture}", not "${path.basename(fixtureDir)}"`);
  if (digest && m.fixture_digest !== digest) problems.push(`lane ${lane}: overlay captured on fixture digest ${m.fixture_digest}, fixture is ${digest}`);
  if (m.lane?.name !== lane) problems.push(`lane ${lane}: overlay manifest names lane ${JSON.stringify(m.lane?.name)}`);
  if (m.oracle?.variant !== "stock") problems.push(`lane ${lane}: overlay must be recorded on the stock oracle, manifest says ${JSON.stringify(m.oracle?.variant)}`);
  for (const [file, h] of Object.entries(m.files ?? {})) {
    const abs = path.join(dir, file);
    if (!existsSync(abs)) problems.push(`lane ${lane}: overlay file missing: ${file}`);
    else if (storedFileHashes(abs).sha256 !== h.sha256) problems.push(`lane ${lane}: overlay file changed since its manifest: ${file}`);
  }
  if (existsSync(dir)) for (const f of resultFiles(dir)) if (!(f in (m.files ?? {}))) problems.push(`lane ${lane}: overlay file not in its manifest: ${f}`);
  const overlayProblems = [];
  const loaded = loadResults(dir, `lane ${lane}`, ops, overlayProblems, [], null);
  problems.push(...overlayProblems);
  if (!Array.isArray(m.lane?.oracle_tables)) warnings.push(`lane ${lane}: overlay names no oracle tables; the fixture deck's schema is used`);
  return { ...loaded, oracleTables: Array.isArray(m.lane?.oracle_tables) ? m.lane.oracle_tables : null };
}

function oracleSchemaTables(fixtureDir) {
  const file = path.join(fixtureDir, "deck", "deck.sqlite3");
  if (!existsSync(file)) return undefined;
  const url = pathToFileURL(file);
  url.searchParams.set("mode", "ro");
  url.searchParams.set("immutable", "1");
  const db = new DatabaseSync(url, { readOnly: true });
  try {
    return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => String(r.name)));
  } finally {
    db.close();
  }
}

function validateDeclaredOtherTables(declared) {
  const bad = "declaredOtherTables must be { \"<step id>\": { \"<table>\": \"why\" } }";
  if (declared === null || typeof declared !== "object" || Array.isArray(declared)) throw new TypeError(bad);
  for (const [id, tables] of Object.entries(declared)) {
    if (tables === null || typeof tables !== "object" || Array.isArray(tables)) throw new TypeError(`${bad}; "${id}" does not map to a table object`);
    for (const [table, why] of Object.entries(tables)) if (typeof why !== "string") throw new TypeError(`${bad}; the why of "${id}" table "${table}" is not a string`);
  }
  return declared;
}

function isCaptureFault(error) {
  if (error === null || typeof error !== "object") return false;
  if (typeof error.class === "string" && error.class.includes("CAPTURE_ERROR")) return true;
  if (typeof error.message === "string" && error.message.startsWith("CAPTURE_ERROR:")) return true;
  return false;
}

function checkRunRecord(kind, run, { digest, ops, problems, partial, warnings, candidateCommit, diagnostic, validCommit }) {
  if (!run) {
    partial.push(`${kind}: not run`);
    return;
  }
  const need = ["started", "finished", "complete", "ops_total", "ops_run", "adapter", "engine", "fixture_digest"];
  if (kind !== "scenarios") need.push("session_writes");
  for (const f of need) if (!(f in run) || run[f] === null) problems.push(`results: ${kind} run record lacks ${f}`);
  if (run.complete !== true) problems.push(`results: ${kind} run did not complete (${run.ops_run ?? "?"} of ${run.ops_total ?? "?"} operations ran)`);
  if (run.selection) partial.push(`${kind}: run with a selection ${JSON.stringify(run.selection)}`);
  const total = kind === "scenarios" ? ops.scenarios.size : ops[kind].size;
  if (run.ops_total !== undefined && run.ops_total !== total) problems.push(`results: ${kind} ran a fixture with ${run.ops_total} operations; this fixture has ${total}`);
  if (!run.selection && run.complete === true && run.ops_run !== total) problems.push(`results: ${kind} ran ${run.ops_run} of ${total} operations`);
  if (digest && run.fixture_digest && run.fixture_digest !== digest) problems.push(`results: ${kind} was run on fixture digest ${run.fixture_digest}, fixture is ${digest}`);
  if ((run.fixture_problems ?? []).length > 0) problems.push(`results: ${kind} was run on a fixture that did not match its manifest`);
  if (run.engine && run.engine.protocol !== PROTOCOL) problems.push(`results: ${kind} engine speaks protocol ${run.engine.protocol}, grader reads ${PROTOCOL}`);
  if (run.engine_changed) problems.push(`results: ${kind} sessions were answered by different engine versions`);
  if (kind !== "scenarios" && run.session_writes !== undefined && (run.session_writes === null || typeof run.session_writes !== "object")) {
    problems.push(`results: ${kind} session_writes is not a row delta`);
  }
  const checkout = run.adapter_checkout;
  const sourceProblem = detail => (diagnostic ? warnings : problems).push(`results: ${kind} ${detail}`);
  if (!checkout || typeof checkout !== "object" || Array.isArray(checkout)
      || !validCommit(checkout.commit) || typeof checkout.dirty !== "boolean") {
    sourceProblem("lacks a valid source checkout identity");
  } else {
    if (checkout.dirty !== false) sourceProblem("source checkout was dirty; not a candidate grade");
    if (!diagnostic && checkout.commit !== candidateCommit) sourceProblem(`source commit ${checkout.commit} does not match candidate ${candidateCommit ?? "(missing)"}`);
  }
  for (const problem of sourceBindingProblems(run.source_binding, checkout?.commit)) {
    if (!Object.hasOwn(run, "source_binding")) warnings.push(`results: ${kind} ${problem}`);
    else sourceProblem(problem);
  }
}

function checkOneEngine(runs, problems) {
  const present = RUN_KINDS.filter((k) => runs[k]);
  const sig = (r) => JSON.stringify({ adapter: r.adapter, engine: stable(r.engine ?? null), commit: r.adapter_checkout?.commit ?? null });
  const sigs = new Set(present.map((k) => sig(runs[k])));
  if (sigs.size > 1) problems.push(`results: kinds were run by different adapters, engines or commits (${present.map((k) => `${k}: ${runs[k].adapter} ${runs[k].adapter_checkout?.commit ?? "no commit"}`).join("; ")})`);
}

function firstEngine(runs) {
  for (const k of RUN_KINDS) if (runs[k]?.engine) return runs[k].engine;
  return null;
}

function loadOps(fixtureDir) {
  const ids = (kind) =>
    new Set([...readLinesFrom(path.join(fixtureDir, "ops", `${kind}.jsonl`)).lines, ...(withheldOpsOf(fixtureDir, kind) ?? [])].map((o) => o.id));
  const scen = [...JSON.parse(readFileSync(path.join(fixtureDir, "ops", "scenarios.json"), "utf8")).scenarios, ...(withheldScenariosOf(fixtureDir) ?? [])];
  return { render: ids("render"), semantics: ids("semantics"), scenarios: new Map(scen.map((s) => [s.id, s])) };
}

function loadResults(dir, label, ops, problems, missing, withheldDir = null) {
  const out = { render: new Map(), semantics: new Map(), scenarios: new Map(), present: {} };
  for (const kind of RUN_KINDS) {
    const file = path.join(dir, `${kind}.jsonl`);
    const read = readLinesFrom(file);
    if (read.exists && withheldDir) {
      const more = readLinesFrom(path.join(withheldDir, `${kind}.jsonl`));
      read.lines.push(...more.lines);
      read.bad.push(...more.bad.map((n) => `${n} (withheld)`));
    }
    if (!read.exists) {
      missing.push(`${label}: no ${kind}.jsonl`);
      out.present[kind] = new Set();
      continue;
    }
    for (const bad of read.bad) problems.push(`${label}: ${kind}.jsonl line ${bad} is not JSON`);
    const known = kind === "scenarios" ? ops.scenarios : ops[kind];
    for (const entry of read.lines) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.id !== "string") {
        problems.push(`${label}: ${kind} has an invalid result record`);
        continue;
      }
      const checked = (record, at) => {
        const valid = record && typeof record === "object" && !Array.isArray(record);
        const error = valid && record.error;
        if (valid && ((error && typeof error === "object" && typeof error.class === "string" && typeof error.message === "string")
            || (!error && Object.hasOwn(record, "result")))) return record;
        problems.push(`${label}: ${at} lacks a result or valid error`);
        return { ...(valid ? record : {}), error: { class: "HarnessInvalidResult", message: "No result or valid error recorded" } };
      };
      let line;
      if (kind === "scenarios") {
        if (!Array.isArray(entry.steps)) problems.push(`${label}: scenario ${entry.id} has no step array`);
        line = { ...entry, steps: (Array.isArray(entry.steps) ? entry.steps : []).map((step, index) => checked(step, `${entry.id}#${index + 1}`)) };
      } else line = checked(entry, `${kind}/${entry.id}`);
      if (out[kind].has(line.id)) problems.push(`${label}: ${kind} id ${line.id} recorded twice`);
      else if (!known.has(line.id)) problems.push(`${label}: ${kind} id ${line.id} is not an operation of this fixture`);
      else out[kind].set(line.id, line);
    }
    if (kind === "scenarios") {
      for (const [id, line] of out.scenarios) {
        const want = ops.scenarios.get(id).steps.length;
        const have = Array.isArray(line.steps) ? line.steps.length : 0;
        if (have !== want) problems.push(`${label}: scenario ${id} recorded ${have} of ${want} steps`);
      }
    }
    const absent = [...known.keys()].filter((id) => !out[kind].has(id));
    if (absent.length) missing.push(`${label}: ${absent.length} of ${known.size} ${kind} operations have no result`);
    out.present[kind] = new Set(out[kind].keys());
  }
  return out;
}

function readLinesFrom(file) {
  const text = existsSync(file) ? readFileSync(file, "utf8") : existsSync(file + ".gz") ? gunzipSync(readFileSync(file + ".gz")).toString("utf8") : null;
  if (text === null) return { exists: false, lines: [], bad: [] };
  const lines = [];
  const bad = [];
  text.split("\n").forEach((l, i) => {
    if (l.trim() === "") return;
    try {
      lines.push(JSON.parse(l));
    } catch {
      bad.push(i + 1);
    }
  });
  return { exists: true, lines, bad };
}

function readJson(file) {
  if (!existsSync(file)) return { ok: false, error: `${path.basename(path.dirname(file))}/${path.basename(file)} is missing` };
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return { ok: false, error: `${path.basename(file)} is not JSON: ${error.message}` };
  }
}

export function firstDifference(a, b) {
  const sa = (typeof a === "string" ? a : JSON.stringify(stable(a))) ?? "(missing)";
  const sb = (typeof b === "string" ? b : JSON.stringify(stable(b))) ?? "(missing)";
  let i = 0;
  while (i < sa.length && i < sb.length && sa[i] === sb[i]) i++;
  return { at: i, expected: sa.slice(Math.max(0, i - 60), i + 120), actual: sb.slice(Math.max(0, i - 60), i + 120) };
}

export function leafDifferences(a, b, at = "") {
  if (sameJson(a, b)) return [];
  const isObj = (v) => v !== null && typeof v === "object";
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return [{ path: at || "/", expected: a, actual: b }];
  const keys = Array.isArray(a) ? [...Array(Math.max(a.length, b.length)).keys()] : [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.flatMap((k) => leafDifferences(a[k], b[k], `${at}/${k}`));
}

