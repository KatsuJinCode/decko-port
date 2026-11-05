import type { SQLStatement } from "../../server/driver.js";
import { CARDS_COLUMNS } from "./store-row-evaluator.js";
import { COMPACT_COLUMN, decodeCompact, projectionNames } from "./compact-rows.js";

const KIND_COLUMN = "__decko_kind";

export function searchWithRelatedStatement(s: SQLStatement): SQLStatement | undefined {
  if (!/^\s*SELECT\s+(DISTINCT\s+)?c0\.\*/i.test(s.sql) || /REGEXP/i.test(s.sql)) return undefined;
  const projection = projectionNames(s.sql);
  if (!projection || projection.names.length !== CARDS_COLUMNS.length ||
      projection.names.some((name, i) => name !== CARDS_COLUMNS[i])) return undefined;
  const columns = CARDS_COLUMNS.map((_, i) => `c${i}`);
  const cells = (names: readonly string[]) => names.map(c => `CASE typeof(${c}) WHEN 'blob' THEN 0.5 ELSE ${c} END`).join(", ");
  const at = (name: typeof CARDS_COLUMNS[number]) => `c${CARDS_COLUMNS.indexOf(name)}`;
  return {
    sql: `WITH __s(${columns.join(", ")}) AS (${projection.sql}) ` +
      `, __q AS MATERIALIZED (SELECT row_number() OVER () AS __position, * FROM __s) ` +
      `SELECT ${KIND_COLUMN}, ${COMPACT_COLUMN} FROM (` +
      `SELECT 0 AS ${KIND_COLUMN}, __position, json_array(${cells(columns)}) AS ${COMPACT_COLUMN} FROM __q ` +
      `UNION ALL SELECT 1 AS ${KIND_COLUMN}, 0 AS __position, ` +
      `json_array(${cells(CARDS_COLUMNS.map(c => `related.${c}`))}) AS ${COMPACT_COLUMN} FROM cards related ` +
      `WHERE related.id IN (SELECT ${at("type_id")} FROM __q UNION SELECT ${at("left_id")} FROM __q UNION SELECT ${at("right_id")} FROM __q) ` +
      `AND related.id NOT IN (SELECT ${at("id")} FROM __q)) ORDER BY ${KIND_COLUMN}, __position`,
    params: s.params ?? [],
  };
}

export function decodeSearchWithRelated(rows: readonly unknown[]): {
  search: Record<string, unknown>[]; related: Record<string, unknown>[];
} | undefined {
  const search: unknown[] = [], related: unknown[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") return undefined;
    const kind = (row as Record<string, unknown>)[KIND_COLUMN];
    if (kind === 0) search.push(row);
    else if (kind === 1) related.push(row);
    else return undefined;
  }
  const searchRows = decodeCompact(search, CARDS_COLUMNS, "per-row");
  const relatedRows = decodeCompact(related, CARDS_COLUMNS, "per-row");
  return searchRows === undefined || relatedRows === undefined ? undefined : {search:searchRows, related:relatedRows};
}
