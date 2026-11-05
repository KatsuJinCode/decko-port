import { createHash } from "node:crypto";
import Database from "better-sqlite3";

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hashRowValues(values) {
  let part = "";
  for (const v of values) {
    if (v === null || v === undefined) part += "\x01";
    else if (typeof v === "number") part += "n" + v;
    else if (typeof v === "string") part += "s" + v;
    else if (v instanceof Uint8Array) part += "b" + Buffer.from(v).toString("hex");
    else part += "o" + String(v);
    part += "\x1f";
  }
  return fnv1a(part);
}

export function hashTable(db, table) {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
  const idCol = cols.includes("id") ? "id" : cols[0];
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const rows = db.prepare(`SELECT ${colList} FROM "${table}" ORDER BY "${idCol}"`).all();
  const perRow = [];
  const ids = [];
  let concat = "";
  for (const r of rows) {
    const values = cols.map((c) => r[c]);
    const h = hashRowValues(values);
    perRow.push(h);
    ids.push(r[idCol]);
    concat += h.toString(16) + "|";
  }
  const totalHash = createHash("sha256").update(concat, "utf8").digest("hex");
  return { perRowHashes: perRow, ids, totalHash };
}

export async function proveDeterminism({
  importFn,
  ddlPath,
  freshPathA,
  freshPathB,
  tableList,
}) {
  const result = { tables: {}, allTablesDeterministic: true };

  const runOne = async (path) => {
    const driver = new Database(path);
    const wrapped = {
      query: async (sql, params) => {
        const stmt = driver.prepare(sql);
        if (stmt.reader) return { rows: stmt.all(...params), rowsAffected: 0 };
        const info = stmt.run(...params);
        return { rows: [], rowsAffected: Number(info.changes) };
      },
      batch: async (statements) => {
        const tx = driver.transaction(() =>
          statements.map((s) => driver.prepare(s.sql).run(...s.params)),
        );
        tx();
        return statements.map(() => ({ rows: [], rowsAffected: 1 }));
      },
      close: () => driver.close(),
    };
    try {
      await importFn({ driver: wrapped, ddlPath });
    } finally {
      driver.close();
    }
  };

  await runOne(freshPathA);
  await runOne(freshPathB);

  const a = new Database(freshPathA, { readonly: true });
  const b = new Database(freshPathB, { readonly: true });
  try {
    for (const table of tableList) {
      const aHas = a
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get(table);
      const bHas = b
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get(table);
      const aExists = Number(aHas?.n ?? 0) > 0;
      const bExists = Number(bHas?.n ?? 0) > 0;
      if (!aExists || !bExists) {
        result.tables[table] = {
          countA: 0,
          countB: 0,
          idsMatch: true,
          hashesMatch: true,
          totalHashA: "",
          totalHashB: "",
          mismatchIds: [],
        };
        continue;
      }
      const ha = hashTable(a, table);
      const hb = hashTable(b, table);
      const idsMatch =
        ha.ids.length === hb.ids.length &&
        ha.ids.every((id, i) => id === hb.ids[i]);
      const hashesMatch = ha.totalHash === hb.totalHash;
      const mismatches = [];
      const max = Math.min(ha.perRowHashes.length, hb.perRowHashes.length);
      for (let i = 0; i < max; i++) {
        if (ha.perRowHashes[i] !== hb.perRowHashes[i]) {
          if (mismatches.length < 20) mismatches.push(ha.ids[i]);
        }
      }
      result.tables[table] = {
        countA: ha.ids.length,
        countB: hb.ids.length,
        idsMatch,
        hashesMatch,
        totalHashA: ha.totalHash,
        totalHashB: hb.totalHash,
        mismatchIds: mismatches,
      };
      if (!idsMatch || !hashesMatch) result.allTablesDeterministic = false;
    }
  } finally {
    a.close();
    b.close();
  }
  return result;
}