#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { COLLAPSE_ID, RELATIVE_TIME, SLOT_ID, normalizeErrorRecord, normalizeRender, sameJson } from "./normalize.mjs";

const [a, b, ...rest] = process.argv.slice(2);
const jsonOut = rest[0] === "--json" ? rest[1] : null;
if (!a || !b) {
  console.error("usage: compare-runs.mjs <runA> <runB> [--json <out.json>]");
  process.exit(2);
}

const read = (dir, kind) => {
  const f = path.join(dir, `${kind}.jsonl`);
  const text = existsSync(f) ? readFileSync(f, "utf8") : gunzipSync(readFileSync(f + ".gz")).toString("utf8");
  return new Map(text.split("\n").filter((l) => l.trim()).map((l) => { const j = JSON.parse(l); return [j.id, j]; }));
};
const slotValues = (value) => {
  if (typeof value === "string") return [...value.matchAll(SLOT_ID)].map((m) => m[0]);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(slotValues);
  return [];
};
const collapseValues = (value) => {
  if (typeof value === "string") return [...value.matchAll(COLLAPSE_ID)].map((m) => m[0]);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(collapseValues);
  return [];
};
const relativeTimeValues = (value) => {
  if (typeof value === "string") return [...value.matchAll(RELATIVE_TIME)].map((m) => m[0]);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(relativeTimeValues);
  return [];
};
const debugTitle = (s) => {
  const out = [];
  for (const m of s.matchAll(/title="(\s*&lt;h3&gt;Error message \(visible to admin only\)&lt;\/h3&gt;[\s\S]*?)"/g)) out.push(m[1]);
  return out;
};
const captureHostValues = (value) => {
  if (typeof value === "string")
    return debugTitle(value).flatMap((t) => [
      ...[...t.matchAll(/\b[A-Za-z]:[/\\][^\s<>&":]+/g)].map((m) => m[0]),
      ...[...t.matchAll(/0x[0-9a-fA-F]{6,16}/g)].map((m) => m[0]),
    ]);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(captureHostValues);
  return [];
};
const frameListValues = (value) => {
  if (typeof value === "string")
    return debugTitle(value).flatMap((t) => {
      const m = t.match(/&lt;\/p&gt;\s*&lt;div&gt;([\s\S]*?)&lt;\/div&gt;/);
      return m ? [m[1]] : [];
    });
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(frameListValues);
  return [];
};

const maskAccounting = (result, nameA, nameB) => {
  const counts = (line) => ({
    N1: slotValues(line),
    N4: collapseValues(line),
    N5: relativeTimeValues(line),
    N6: frameListValues(line),
    N7: captureHostValues(line),
  });
  const a = counts(nameA);
  const b = counts(nameB);
  for (const rule of ["N1", "N4", "N5", "N6", "N7"]) {
    result.masks[rule].matched_pairs += Math.min(a[rule].length, b[rule].length);
    a[rule].forEach((v, i) => {
      if (b[rule][i] !== undefined && b[rule][i] !== v) result.masks[rule].differing_pairs++;
    });
  }
};

const result = {
  runs: [path.resolve(a), path.resolve(b)],
  kinds: {},
  masks: {
    N1: { matched_pairs: 0, differing_pairs: 0 },
    N4: { matched_pairs: 0, differing_pairs: 0 },
    N5: { matched_pairs: 0, differing_pairs: 0 },
    N6: { matched_pairs: 0, differing_pairs: 0 },
    N7: { matched_pairs: 0, differing_pairs: 0 },
  },
  unexplained: [],
};
for (const kind of ["render", "semantics", "scenarios"]) {
  const A = read(a, kind);
  const B = read(b, kind);
  const k = { items: A.size, raw_equal: 0, equal_after_masks: 0, unexplained: 0 };
  if (A.size !== B.size || [...A.keys()].some((id) => !B.has(id))) result.unexplained.push(`${kind}: the runs hold different operations`);
  for (const [id, x] of A) {
    const y = B.get(id);
    if (!y) continue;
    if (JSON.stringify(x) === JSON.stringify(y)) {
      k.raw_equal++;
      continue;
    }
    maskAccounting(result, x, y);
    const withError = (line) => (line.error !== undefined ? { ...line, error: normalizeErrorRecord(line.error) } : line);
    const norm = (line) =>
      withError(
        kind === "render"
          ? { ...line, result: normalizeRender(line.result) }
          : kind === "scenarios"
            ? { ...line, steps: line.steps.map((s) => ({ ...s, result: normalizeRender(s.result) })) }
            : line,
      );
    if (sameJson(norm(x), norm(y))) k.equal_after_masks++;
    else {
      k.unexplained++;
      result.unexplained.push(`${kind} ${id}`);
    }
  }
  result.kinds[kind] = k;
}

for (const [kind, k] of Object.entries(result.kinds)) {
  console.log(`${kind.padEnd(10)} ${k.items} items: ${k.raw_equal} identical, ${k.equal_after_masks} equal after masks, ${k.unexplained} unexplained`);
}
const pairLine = (rule, label) => {
  const m = result.masks[rule];
  return `${rule} ${label}: ${m.differing_pairs} of ${m.matched_pairs} paired values differ between the runs`;
};
console.log(pairLine("N1", "slot ids"));
console.log(pairLine("N4", "collapse ids"));
console.log(pairLine("N5", "relative-time spans"));
console.log(pairLine("N6", "backtrace frame lists"));
console.log(pairLine("N7", "capture-host tokens in debug titles"));
for (const u of result.unexplained) console.log(`unexplained: ${u}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 2) + "\n");
process.exit(result.unexplained.length ? 1 : 0);
