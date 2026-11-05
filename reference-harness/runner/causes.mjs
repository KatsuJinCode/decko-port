#!/usr/bin/env node

import { readFileSync } from "node:fs";

const [reportPath, onlyKind, topArg] = process.argv.slice(2);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const top = Number(topArg ?? 15);

function signature(f) {
  if (f.reason !== "differs") return f.reason.replace(/\d+/g, "N").slice(0, 120);
  const at = f.diff.expected.length >= 60 ? 60 : 0;
  const exp = f.diff.expected.slice(at, at + 40);
  const act = f.diff.actual.slice(at, at + 40);
  const blur = (s) => s.replace(/\d+/g, "N").replace(/"[^"]{0,40}"/g, '"…"').replace(/\s+/g, " ");
  return `expected «${blur(exp)}» got «${blur(act)}»`;
}

for (const [kind, failures] of Object.entries(report.failures)) {
  if (onlyKind && kind !== onlyKind) continue;
  if (failures.length === 0) continue;
  const groups = new Map();
  for (const f of failures) {
    const key = signature(f);
    const g = groups.get(key) ?? { n: 0, ids: [] };
    g.n++;
    if (g.ids.length < 3) g.ids.push(f.id);
    groups.set(key, g);
  }
  console.log(`\n== ${kind}: ${failures.length} failures, ${groups.size} shapes`);
  for (const [key, g] of [...groups].sort((a, b) => b[1].n - a[1].n).slice(0, top)) {
    console.log(`${String(g.n).padStart(5)}  ${key}\n         e.g. ${g.ids.join(" | ")}`);
  }
}
