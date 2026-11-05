#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EXIT, KINDS, gradeRun } from "./grade-lib.mjs";

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) throw new Error(`unexpected argument ${argv[i]}`);
  const key = argv[i].slice(2);
    if (key === "allow-partial" || key === "no-class-token-order" || key === "diagnostic") args[key] = true;
  else args[key] = argv[++i];
}
for (const required of ["fixture", "actual"]) if (!args[required]) throw new Error(`--${required} is required`);

let declaredOtherTables = {};
if (args["declared-other-tables"]) {
  declaredOtherTables = JSON.parse(readFileSync(args["declared-other-tables"], "utf8"));
}
let declaredDivergences = {};
if (args["declared-divergences"]) {
  declaredDivergences = JSON.parse(readFileSync(args["declared-divergences"], "utf8"));
}

const recordedLane = (() => {
  let meta;
  try {
    meta = JSON.parse(readFileSync(path.join(args.actual, "run-meta.json"), "utf8"));
  } catch {
    return null;
  }
  const lanes = [...new Set(Object.values(meta.runs ?? {}).map((r) => r.lane ?? null))];
  if (lanes.length > 1) throw new Error(`results mix lanes: ${JSON.stringify(lanes)}`);
  return lanes[0] ?? null;
})();
const lane = args.lane ?? recordedLane;
if (args.lane !== undefined && args.lane !== recordedLane) {
  console.log(`NOT A GRADE: --lane ${args.lane} but the results were recorded on lane ${JSON.stringify(recordedLane)}`);
  process.exit(EXIT.invalid);
}

const report = gradeRun({
  fixture: args.fixture,
  actual: args.actual,
  expected: args.expected,
  candidateCommit: args["candidate-commit"],
  diagnostic: Boolean(args.diagnostic),
  allowPartial: Boolean(args["allow-partial"]),
  classTokenOrder: !args["no-class-token-order"],
  declaredOtherTables,
  declaredDivergences,
  lane,
});
report.graded_at = new Date().toISOString();
const unqualifiedSource = report.source_qualification?.qualified !== true;
const notGrade = report.verdict === "invalid" || unqualifiedSource;
if (notGrade) {
  report.comparison_verdict = report.verdict;
  if (report.source_qualification?.mode === "candidate") report.verdict = "invalid";
  for (const summary of Object.values(report.summary)) summary.rate = null;
}
if (args.report) writeFileSync(args.report, JSON.stringify(report, null, 2) + "\n");

if (report.oracle?.variant && report.oracle.variant !== "stock") {
  console.log(`PATCHED ORACLE "${report.oracle.variant}": graded against expectations that differ from stock Decko (${report.oracle.patches.map((p) => p.id ?? p).join(", ")})`);
}
if (report.withheld) console.log(report.withheld.line);
for (const p of report.problems) console.log(`problem: ${p}`);
for (const w of report.warnings) console.log(`warning: ${w}`);
if (notGrade) {
  const reason = unqualifiedSource ? "source qualification was not established" : `${report.problems.length} problem(s) above`;
  console.log(`NOT A GRADE: ${reason}. No pass rate is reported for this run.`);
  process.exit(EXIT.invalid);
}
if (report.verdict === "partial") console.log(`PARTIAL RUN, not a grade: ${report.partial.join("; ")}`);
console.log(`normalization: ${report.normalization.join(", ")}`);
for (const d of report.declared_divergences) console.log(`declared divergence ${d.name}: ${d.masked.length} value(s) masked - ${d.why}`);
if (report.stale_divergences.length > 0) {
  for (const name of report.stale_divergences) console.log(`STALE declared divergence ${name}: it masked no value in this run; the declaration no longer occurs, so the grade fails`);
}
for (const k of KINDS) {
  const s = report.summary[k];
  console.log(`${k.padEnd(13)} ${String(s.pass).padStart(5)} / ${String(s.graded).padEnd(5)} ${s.rate === null ? "-" : s.rate + "%"}` +
    (s.reproduced_upstream_failures ? `  (${s.reproduced_upstream_failures} reproduced upstream failures)` : "") +
    (s.oracle_errors ? `  (${s.oracle_errors} oracle capture faults not graded)` : ""));
  for (const [g, v] of Object.entries(s.groups)) console.log(`    ${g.padEnd(24)} ${v.pass} / ${v.graded}`);
}
const rw = report.read_writes;
console.log(`${"read writes".padEnd(13)} ${String(rw.pass).padStart(5)} / ${String(rw.graded).padEnd(5)} reads that wrote only what the oracle's reads wrote`);
for (const f of rw.failures) console.log(`    ${f.id}: ${f.reason}`);
const ot = report.other_tables;
if (ot.graded > 0 || ot.fail > 0) {
  console.log(`${"other tables".padEnd(13)} ${String(ot.pass).padStart(5)} / ${String(ot.graded).padEnd(5)} write steps whose non-card tables match the oracle's; ${ot.declared} declared difference(s), not counted as passes`);
  for (const f of ot.failures) console.log(`    ${f.id}: ${f.reason} (${f.tables.join(", ")})`);
}
for (const s of report.stale_declarations) console.log(`STALE declared difference ${s.id} / ${s.table}: ${s.reason} (declared: ${s.why})`);
const eo = report.engine_only_tables;
if (eo && eo.tables.length > 0) {
  console.log(`${"engine-only".padEnd(13)} ${eo.tables.join(", ")}: tables the oracle's schema does not have, written by ${new Set(eo.writes.map((w) => w.id)).size} write step(s); not compared`);
}
console.log(`verdict: ${report.verdict}`);
process.exit(EXIT[report.verdict]);
