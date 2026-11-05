import Database from "better-sqlite3";

export function openSourceSqlite(path) {
  return new Database(path, { readonly: true, fileMustExist: true });
}

export function inventorySource(db) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
  const out = {};
  for (const name of tables) {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
    const cnt = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get();
    out[name] = {
      columns: cols.map((c) => c.name),
      columnTypes: Object.fromEntries(cols.map((c) => [c.name, c.type])),
      rowCount: Number(cnt?.n ?? 0),
    };
  }
  return out;
}

export async function* sourceTableRows(db, table, { chunkRows = 10000 } = {}) {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
  const colList = cols.map((c) => `"${c}"`).join(", ");
  let lastRowid = 0;
  for (;;) {
    const batch = db
      .prepare(
        `SELECT rowid AS __rowid, ${colList} FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      )
      .all(lastRowid, chunkRows);
    if (batch.length === 0) return;
    for (const rec of batch) {
      lastRowid = Number(rec.__rowid);
      const values = cols.map((c) => rec[c]);
      yield { table, values, columns: cols };
    }
    if (batch.length < chunkRows) return;
  }
}

export async function* sourceAllRows(db, opts = {}) {
  const inv = inventorySource(db);
  for (const name of Object.keys(inv).sort()) {
    yield* sourceTableRows(db, name, opts);
  }
}