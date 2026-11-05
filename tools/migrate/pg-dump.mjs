import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { splitSqlStatements } from "./import.mjs";

const ROWS_PER_INSERT = 200;

export function decodeCopyField(raw) {
  if (raw === "\\N") return null;
  if (!raw.includes("\\")) return raw;
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = raw[++i];
    if (n === undefined) break;
    const simple = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" }[n];
    if (simple !== undefined) out += simple;
    else if (n >= "0" && n <= "7") {
      let digits = n;
      while (digits.length < 3 && raw[i + 1] >= "0" && raw[i + 1] <= "7") digits += raw[++i];
      out += String.fromCharCode(parseInt(digits, 8));
    } else if (n === "x" && /[0-9a-fA-F]/.test(raw[i + 1] ?? "")) {
      let hex = raw[++i];
      if (/[0-9a-fA-F]/.test(raw[i + 1] ?? "")) hex += raw[++i];
      out += String.fromCharCode(parseInt(hex, 16));
    } else out += n;
  }
  return out;
}

export function portTimestamp(value) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/.exec(value);
  if (m === null) return value;
  const micros = (m[3] ?? "").padEnd(6, "0").slice(0, 6);
  return /^0*$/.test(micros) ? `${m[1]} ${m[2]}` : `${m[1]} ${m[2]}.${micros}`;
}

export function convertValue(type, value) {
  if (value === null) return null;
  const t = type.toLowerCase();
  if (t === "boolean") return value === "t" ? 1 : 0;
  if (t.startsWith("timestamp")) return portTimestamp(value);
  if (/^(integer|bigint|smallint|int|int4|int8|int2)$/.test(t)) return Number(value);
  if (/^(double precision|real|numeric|float)/.test(t)) return Number(value);
  return value;
}

const unqualify = (name) => name.replace(/^public\./, "").replace(/"/g, "");

export async function* pgDumpBatches(dumpPath, batchRows = ROWS_PER_INSERT) {
  const types = new Map();
  let creating;
  let copying;
  const lines = createInterface({ input: createReadStream(dumpPath, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (copying !== undefined) {
      if (line === "\\.") {
        if (copying.rows.length > 0) yield copying;
        copying = undefined;
        continue;
      }
      const tableTypes = types.get(copying.table) ?? new Map();
      copying.rows.push(line.split("\t").map((f, i) => convertValue(tableTypes.get(copying.columns[i]) ?? "text", decodeCopyField(f))));
      if (copying.rows.length >= batchRows) {
        yield copying;
        copying = { ...copying, rows: [] };
      }
      continue;
    }
    if (creating !== undefined) {
      if (/^\);/.test(line)) {
        creating = undefined;
        continue;
      }
      const col = /^\s+("?[A-Za-z_][A-Za-z0-9_]*"?)\s+(.+?),?$/.exec(line);
      if (col !== null && !/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)$/i.test(col[1])) {
        const type = col[2].replace(/\s+(NOT NULL|NULL|DEFAULT .*)$/i, "").replace(/\(.*\)$/, "").trim();
        types.get(creating).set(col[1].replace(/"/g, ""), type);
      }
      continue;
    }
    const create = /^CREATE TABLE ([^\s(]+) \($/.exec(line);
    if (create !== null) {
      creating = unqualify(create[1]);
      types.set(creating, new Map());
      continue;
    }
    const copy = /^COPY ([^\s(]+) \(([^)]*)\) FROM stdin;$/.exec(line);
    if (copy !== null) {
      copying = { table: unqualify(copy[1]), columns: copy[2].split(",").map((c) => c.trim().replace(/"/g, "")), rows: [] };
    }
  }
}

function portTables(schemaSql) {
  const tables = new Map();
  for (const statement of splitSqlStatements(schemaSql)) {
    const m = /^\s*CREATE TABLE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(([\s\S]*)\)\s*;?\s*$/i.exec(statement);
    if (m === null) continue;
    const columns = new Set();
    for (const line of m[2].split("\n")) {
      const col = /^\s*"([A-Za-z_][A-Za-z0-9_]*)"/.exec(line);
      if (col !== null) columns.add(col[1]);
    }
    tables.set(m[1], columns);
  }
  return tables;
}

export async function importPgDump({ dumpPath, driver, schemaPath }) {
  const schemaSql = readFileSync(schemaPath, "utf8");
  for (const statement of splitSqlStatements(schemaSql)) await driver.query(statement, []);
  const known = portTables(schemaSql);
  const imported = {};
  const skippedTables = new Set();
  const skippedColumns = {};
  for await (const batch of pgDumpBatches(dumpPath)) {
    const target = known.get(batch.table);
    if (target === undefined) {
      skippedTables.add(batch.table);
      continue;
    }
    const keep = batch.columns.map((c, i) => [c, i]).filter(([c]) => target.has(c));
    for (const c of batch.columns) if (!target.has(c)) (skippedColumns[batch.table] ??= new Set()).add(c);
    const cols = keep.map(([c]) => `"${c}"`).join(", ");
    const values = batch.rows.map(() => `(${keep.map(() => "?").join(", ")})`).join(", ");
    await driver.query(`INSERT INTO "${batch.table}" (${cols}) VALUES ${values}`, batch.rows.flatMap((r) => keep.map(([, i]) => r[i])));
    imported[batch.table] = (imported[batch.table] ?? 0) + batch.rows.length;
  }
  return {
    imported,
    skippedTables: [...skippedTables].sort(),
    skippedColumns: Object.fromEntries(Object.entries(skippedColumns).map(([t, s]) => [t, [...s].sort()])),
  };
}
