import type { SQLStatement } from "../../server/driver.js";
import { CARDS_COLUMNS } from "./store-row-evaluator.js";

export const COMPACT_COLUMN = "__decko_compact";

type Row = Record<string, unknown>;

export function projectionNames(sql: string): { names: string[]; sql: string } | undefined {
  if (/json/i.test(sql)) return undefined;
  const items = topLevelProjection(sql);
  if (items === undefined || items.length === 0) return undefined;
  const names: string[] = [];
  const rewrites: { at: number; len: number; text: string }[] = [];
  for (const it of items) {
    const item = it.text.trim();
    const alias = /\s+AS\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))$/i.exec(item);
    if (alias !== null) {
      names.push((alias[1] ?? alias[2])!);
      continue;
    }
    const col = /^(?:[a-z_][a-z0-9_]*\.)?(?:"([a-z_][a-z0-9_]*)"|([a-z_][a-z0-9_]*))$/.exec(item);
    if (col !== null) {
      names.push((col[1] ?? col[2])!);
      continue;
    }
    const star = /^([a-z_][a-z0-9_]*)\.\*$/.exec(item);
    if (star !== null && new RegExp(`\\bcards\\s+(?:AS\\s+)?${star[1]}\\b`, "i").test(sql)) {
      names.push(...CARDS_COLUMNS);
      rewrites.push({ at: it.at, len: it.text.length, text: ` ${CARDS_COLUMNS.map((c) => `${star[1]}.${c}`).join(", ")} ` });
      continue;
    }
    return undefined;
  }
  let out = sql;
  for (const r of rewrites.reverse()) out = out.slice(0, r.at) + r.text + out.slice(r.at + r.len);
  return { names, sql: out };
}

interface Item {
  text: string;
  at: number;
}
function topLevelProjection(sql: string): Item[] | undefined {
  let depth = 0;
  let start = -1;
  const items: Item[] = [];
  let itemStart = -1;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = sql.indexOf(ch, i + 1);
      if (end < 0) return undefined;
      i = end;
      continue;
    }
    if (ch === "[") {
      const end = sql.indexOf("]", i + 1);
      if (end < 0) return undefined;
      i = end;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") return undefined;
    if (ch === "/" && sql[i + 1] === "*") return undefined;
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      continue;
    }
    if (depth !== 0 || !/[A-Za-z]/.test(ch) || (i > 0 && /[A-Za-z0-9_$.]/.test(sql[i - 1]!))) {
      if (depth === 0 && start >= 0 && ch === ",") {
        items.push({ text: sql.slice(itemStart, i), at: itemStart });
        itemStart = i + 1;
      }
      continue;
    }
    const word = /^[A-Za-z_]+/.exec(sql.slice(i))![0].toUpperCase();
    if (start < 0) {
      if (word === "SELECT") {
        start = i + word.length;
        const rest = sql.slice(start);
        const mod = /^\s+(DISTINCT|ALL)\b/i.exec(rest);
        itemStart = start + (mod === null ? 0 : mod[0].length);
        i = itemStart - 1;
        continue;
      }
    } else if (word === "FROM" || word === "WHERE" || word === "GROUP" || word === "ORDER" || word === "LIMIT" || word === "UNION" || word === "WINDOW") {
      items.push({ text: sql.slice(itemStart, i), at: itemStart });
      return items;
    }
    i += word.length - 1;
  }
  if (start < 0) return undefined;
  items.push({ text: sql.slice(itemStart), at: itemStart });
  return items;
}

function hasTopLevelOrderBy(sql: string): boolean {
  let depth = 0;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    if (ch === "'" || ch === '"') {
      i = sql.indexOf(ch, i + 1);
      if (i < 0) return true;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0 && /^ORDER\s+BY\b/i.test(sql.slice(i, i + 12)) && (i === 0 || /\s/.test(sql[i - 1]!))) return true;
  }
  return false;
}

export type CompactForm = "aggregate" | "per-row";

export function compactWrap(s: SQLStatement, names: readonly string[], form: CompactForm): SQLStatement {
  const cols = names.map((_, i) => `c${i}`).join(", ");
  const cells = names.map((_, i) => `CASE typeof(c${i}) WHEN 'blob' THEN 0.5 ELSE c${i} END`).join(", ");
  const body = form === "aggregate" ? `json_group_array(json_array(${cells}))` : `json_array(${cells})`;
  return { sql: `WITH __s(${cols}) AS (${s.sql}) SELECT ${body} AS ${COMPACT_COLUMN} FROM __s`, params: s.params ?? [] };
}

export function compactStatement(s: SQLStatement): { stmt: SQLStatement; names: string[]; form: CompactForm } | undefined {
  const p = projectionNames(s.sql);
  if (p === undefined) return undefined;
  const form: CompactForm = hasTopLevelOrderBy(s.sql) ? "per-row" : "aggregate";
  return { names: p.names, form, stmt: compactWrap({ sql: p.sql, params: s.params ?? [] }, p.names, form) };
}

export function decodeCompact(rows: readonly unknown[], names: readonly string[], form: CompactForm): Row[] | undefined {
  return form === "aggregate" ? decodeAggregate(rows, names) : decodePerRow(rows, names);
}

function decodeRow(cells: unknown, names: readonly string[]): Row | undefined {
  if (!Array.isArray(cells) || cells.length !== names.length) return undefined;
  const row: Row = {};
  for (let i = 0; i < names.length; i += 1) {
    const v = cells[i];
    if (v !== null && typeof v !== "string" && !(typeof v === "number" && Number.isSafeInteger(v))) return undefined;
    row[names[i]!] = v;
  }
  return row;
}

export function decodePerRow(rows: readonly unknown[], names: readonly string[]): Row[] | undefined {
  const out: Row[] = [];
  for (const r of rows) {
    const text = (r as Row)[COMPACT_COLUMN];
    if (typeof text !== "string") return undefined;
    let cells: unknown;
    try {
      cells = JSON.parse(text);
    } catch {
      return undefined;
    }
    const row = decodeRow(cells, names);
    if (row === undefined) return undefined;
    out.push(row);
  }
  return out;
}

export function decodeAggregate(rows: readonly unknown[], names: readonly string[]): Row[] | undefined {
  if (rows.length !== 1) return undefined;
  const text = (rows[0] as Row)[COMPACT_COLUMN];
  if (text === null) return [];
  if (typeof text !== "string") return undefined;
  let all: unknown;
  try {
    all = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(all)) return undefined;
  const out: Row[] = [];
  for (const cells of all) {
    const row = decodeRow(cells, names);
    if (row === undefined) return undefined;
    out.push(row);
  }
  return out;
}
