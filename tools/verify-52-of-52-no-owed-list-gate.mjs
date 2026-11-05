import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

export function verifyFull52Gate(syntheticPath, ledgerEntries) {
  const defs = JSON.parse(fs.readFileSync(syntheticPath, "utf8")).journeys;
  assert.equal(defs.length, 52, "Expected exactly 52 canonical browser journeys");
  const byId = new Map(ledgerEntries.map(e => [e.id, e]));
  const missing = [];
  const nonPassed = [];
  const owedOrDeferred = [];
  for (const d of defs) {
    const entry = byId.get(d.id);
    if (!entry) {
      missing.push(d.id);
      continue;
    }
    if (entry.owed || entry.deferred || entry.status === "owed" || entry.status === "pending" || entry.verdict === "owed" || entry.verdict === "pending") {
      owedOrDeferred.push(d.id);
    }
    if (entry.verdict !== "passed" && entry.status !== "passed") {
      nonPassed.push({ id: d.id, status: entry.verdict ?? entry.status ?? "unknown" });
    }
  }
  if (owedOrDeferred.length > 0) {
    throw new Error(`FORBIDDEN_OWED_LIST_STAGING: ${owedOrDeferred.length} journey(s) marked owed/pending (${owedOrDeferred.join(", ")})`);
  }
  if (missing.length > 0 || nonPassed.length > 0) {
    throw new Error(`INCOMPLETE_PHASE1_GATE: passed=${52 - missing.length - nonPassed.length}/52, missing=${missing.length}, failedOrUnrun=${nonPassed.length}`);
  }
  return { passed: 52, total: 52, verified: true };
}

const defaultSynthetic = path.join(rootDir, "verification", "synthetic-v1.json");
const defaultLedger = path.join(rootDir, "verification", "browser-ledger.jsonl");

if (process.argv.includes("--self-test")) {
  let threwOwed = false;
  const defs = JSON.parse(fs.readFileSync(defaultSynthetic, "utf8")).journeys;
  try {
    verifyFull52Gate(defaultSynthetic, defs.map((d, i) => ({ id: d.id, verdict: i === 0 ? "pending" : "passed", owed: i === 0 })));
  } catch (e) {
    threwOwed = String(e.message).includes("FORBIDDEN_OWED_LIST_STAGING");
  }
  assert.equal(threwOwed, true, "Guard must reject owed/pending entries");

  let threwIncomplete = false;
  try {
    verifyFull52Gate(defaultSynthetic, defs.slice(0, 51).map(d => ({ id: d.id, verdict: "passed" })));
  } catch (e) {
    threwIncomplete = String(e.message).includes("INCOMPLETE_PHASE1_GATE");
  }
  assert.equal(threwIncomplete, true, "Guard must reject < 52 passes");

  const ok = verifyFull52Gate(defaultSynthetic, defs.map(d => ({ id: d.id, verdict: "passed" })));
  assert.deepEqual(ok, { passed: 52, total: 52, verified: true });
  console.log("SELF_TEST_PASSED: verify-52-of-52-no-owed-list-gate.mjs verified");
} else if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("verify-52-of-52-no-owed-list-gate.mjs")) {
  if (fs.existsSync(defaultSynthetic) && fs.existsSync(defaultLedger)) {
    const rawLines = fs.readFileSync(defaultLedger, "utf8").trim().split("\n").filter(Boolean);
    const ledger = rawLines.map(l => JSON.parse(l));
    const result = verifyFull52Gate(defaultSynthetic, ledger);
    console.log(JSON.stringify(result));
  }
}
