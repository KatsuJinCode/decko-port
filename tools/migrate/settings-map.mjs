import { SETTINGS_TABLE_VARIANTS } from "./schema-map.mjs";

export function isSettingsTable(name, columnTypes) {
  if (SETTINGS_TABLE_VARIANTS.includes(name)) return true;
  const cols = Object.keys(columnTypes).map((c) => c.toLowerCase());
  const hasKey = cols.includes("key") || cols.includes("name") || cols.includes("setting");
  const hasValue = cols.includes("value") || cols.includes("val");
  return hasKey && hasValue;
}

export function inventorySettings(db, inventory) {
  const tables = [];
  let totalCount = 0;
  for (const [name, info] of Object.entries(inventory)) {
    if (!isSettingsTable(name, info.columnTypes)) continue;
    const cols = Object.keys(info.columnTypes);
    const lower = cols.map((c) => c.toLowerCase());
    const keyIdx =
      lower.indexOf("key") >= 0 ? lower.indexOf("key") :
      lower.indexOf("name") >= 0 ? lower.indexOf("name") :
      lower.indexOf("setting") >= 0 ? lower.indexOf("setting") : 0;
    const valueIdx =
      lower.indexOf("value") >= 0 ? lower.indexOf("value") :
      lower.indexOf("val") >= 0 ? lower.indexOf("val") : 1;
    const keyColumn = cols[keyIdx];
    const valueColumn = cols[valueIdx];
    const sample = db.prepare(
      `SELECT "${keyColumn}" AS k FROM "${name}" ORDER BY rowid LIMIT 20`,
    ).all().map((r) => r.k);
    tables.push({
      source: name,
      count: info.rowCount,
      columns: cols,
      keyColumn,
      valueColumn,
      sampleKeys: sample,
    });
    totalCount += info.rowCount;
  }
  const warning =
    tables.length > 0
      ? `settings tables present in source (${tables.map((t) => t.source).join(", ")}); decko-ts stores settings as cards, no rows imported - see settingsInventory in the report`
      : undefined;
  return { tables, totalCount, warning };
}