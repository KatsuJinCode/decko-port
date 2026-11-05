import { inventorySource } from "./source-sqlite.mjs";
import { classifySourceTable } from "./schema-map.mjs";

export function buildRoundtripReport({ sourceDb, sourcePath, targetCounts, targetTableNames }) {
  const inventory = inventorySource(sourceDb);
  const rows = [];
  let totalSource = 0;
  let totalTarget = 0;
  let dropCount = 0;
  const unknownTables = [];
  for (const [sourceName, info] of Object.entries(inventory).sort()) {
    const map = classifySourceTable(sourceName, targetTableNames);
    let targetTable = null;
    if (map === "core" || map === "core-positional") targetTable = sourceName;
    const target = targetTable !== null ? (targetCounts[targetTable] ?? 0) : 0;
    const delta = info.rowCount - target;
    totalSource += info.rowCount;
    if (targetTable !== null) totalTarget += target;
    if (map === "unknown") {
      unknownTables.push(sourceName);
      dropCount += info.rowCount;
    }
    rows.push({
      sourceTable: sourceName,
      targetTable,
      source: info.rowCount,
      target,
      delta,
      map,
    });
  }
  for (const t of targetTableNames) {
    if (inventory[t] !== undefined) continue;
    const target = targetCounts[t] ?? 0;
    rows.push({
      sourceTable: null,
      targetTable: t,
      source: 0,
      target,
      delta: -target,
      map: "not-imported",
    });
    totalTarget += target;
  }
  return {
    generatedAt: new Date().toISOString(),
    sourcePath,
    rows,
    totals: { source: totalSource, target: totalTarget },
    dropCount,
    unknownTables,
  };
}

export function renderRoundtripMd(report) {
  const lines = [];
  lines.push(`# Round-trip report — ${report.sourcePath}`);
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push(`Totals: source ${report.totals.source} rows, target ${report.totals.target} rows.`);
  lines.push(`Dropped (source tables with no target map): ${report.dropCount}.`);
  if (report.unknownTables.length > 0) {
    lines.push(`Unknown source tables: ${report.unknownTables.join(", ")}.`);
  }
  lines.push("");
  lines.push("| source | target | map | source rows | target rows | delta |");
  lines.push("|--------|--------|-----|------------:|------------:|------:|");
  for (const row of report.rows) {
    lines.push(
      `| \`${row.sourceTable ?? "(none)"}\` | \`${row.targetTable ?? "(none)"}\` | ${row.map} | ${row.source} | ${row.target} | ${row.delta} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}