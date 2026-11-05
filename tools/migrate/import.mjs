import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { dumpRows } from "./parse-dump.mjs";

export function splitSqlStatements(ddl) {
  const statements = [];
  let current = "";
  let quote = null;
  let inTriggerBody = false;
  for (let i = 0; i < ddl.length; i++) {
    const ch = ddl[i];
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "-" && ddl[i + 1] === "-") {
      while (i < ddl.length && ddl[i] !== "\n") i++;
      current += " \n";
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < ddl.length && /[A-Za-z0-9_]/.test(ddl[j])) j++;
      const word = ddl.slice(i, j).toUpperCase();
      if (!inTriggerBody && word === "BEGIN" && /CREATE\s+TRIGGER/i.test(current)) {
        inTriggerBody = true;
      } else if (inTriggerBody && word === "END") {
        inTriggerBody = false;
      }
      current += ddl.slice(i, j);
      i = j - 1;
      continue;
    }
    if (ch === ";") {
      if (inTriggerBody) {
        current += ch;
        continue;
      }
      statements.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") statements.push(current.trim());
  return statements.filter((s) => s !== "");
}

export function parseTargetSchema(ddlPath) {
  const ddl = readFileSync(ddlPath, "utf8");
  const statements = splitSqlStatements(ddl);
  const createTables = [];
  const createIndexes = [];
  const createTriggers = [];
  const postLoadStatements = [];
  const pragmas = [];
  const tableColumns = {};
  for (const statement of statements) {
    const tableMatch = statement.match(/^CREATE TABLE "([a-z_]+)"\s*\(/);
    if (tableMatch) {
      const table = tableMatch[1];
      createTables.push(statement);
      const columns = [];
      for (const line of statement.split("\n")) {
        const colMatch = line.match(/^\s*"([a-z_]+)"\s+(TEXT|INTEGER)/);
        if (colMatch) columns.push(colMatch[1]);
      }
      tableColumns[table] = columns;
      continue;
    }
    if (/^CREATE (UNIQUE )?INDEX /.test(statement)) {
      createIndexes.push(statement);
      continue;
    }
    if (/^CREATE TRIGGER /i.test(statement)) {
      createTriggers.push(statement);
      continue;
    }
    if (/^INSERT INTO "deck_data_version" /.test(statement)) {
      postLoadStatements.push(statement);
      continue;
    }
    if (/^PRAGMA /i.test(statement)) {
      pragmas.push(statement);
      continue;
    }
  }
  return { createTables, createIndexes, createTriggers, postLoadStatements, pragmas, tableColumns };
}

export class LocalSqliteToolDriver {
  constructor(path, opts = {}) {
    this.db = new Database(path, { readonly: opts.readonly ?? false });
  }

  async query(sql, params = []) {
    return this.executeOne(sql, params);
  }

  async batch(statements) {
    const run = this.db.transaction(() =>
      statements.map((s) => this.executeOne(s.sql, s.params ?? [])),
    );
    return run();
  }

  executeOne(sql, params) {
    const stmt = this.db.prepare(sql);
    if (stmt.reader) {
      return { rows: stmt.all(...params), rowsAffected: 0 };
    }
    const info = stmt.run(...params);
    const lastRowId = info.lastInsertRowid;
    return {
      rows: [],
      rowsAffected: Number(info.changes),
      ...(lastRowId !== undefined && BigInt(lastRowId) > 0n ? { lastInsertRowId: lastRowId } : {}),
    };
  }

  *iterate(sql, params = []) {
    for (const row of this.db.prepare(sql).iterate(...params)) yield row;
  }

  close() {
    this.db.close();
  }
}

export const IMPORT_PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = OFF",
  "PRAGMA temp_store = MEMORY",
  "PRAGMA cache_size = -65536",
];

const DEFAULT_BATCH_SIZE = 1000;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Checksum {
  constructor() {
    this.sum = 0;
    this.count = 0;
    this.minId = undefined;
    this.maxId = undefined;
  }

  addRow(values, idColumnIndex) {
    let part = "";
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null || v === undefined) part += "\x01";
      else if (typeof v === "number") part += "n" + v;
      else if (typeof v === "string") part += "s" + v;
      else if (v instanceof Uint8Array) part += "b" + Buffer.from(v).toString("hex");
      else part += "o" + String(v);
      part += "\x1f";
    }
    this.sum = (this.sum + fnv1a(part)) % 2 ** 32;
    this.count += 1;
    if (idColumnIndex >= 0 && idColumnIndex < values.length) {
      const id = values[idColumnIndex];
      if (typeof id === "number") {
        if (this.minId === undefined || id < this.minId) this.minId = id;
        if (this.maxId === undefined || id > this.maxId) this.maxId = id;
      }
    }
  }
}

export const ENGINE_OWNED_TABLES = ["deck_data_version"];

export const IMPORT_PROGRESS_TABLE = "decko_import_progress";

export async function dumpIdentity(dumpPath) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(dumpPath)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

export async function readImportProgress(driver) {
  const table = await driver.query(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
    [IMPORT_PROGRESS_TABLE],
  );
  if (Number(table.rows[0]?.n ?? 0) === 0) return undefined;
  const row = (await driver.query(`SELECT * FROM "${IMPORT_PROGRESS_TABLE}" WHERE id = 1`, [])).rows[0];
  if (row === undefined) return undefined;
  return {
    rowsDone: Number(row.rows_done),
    phase: row.phase,
    dumpBytes: Number(row.dump_bytes),
    dumpSha256: row.dump_sha256,
    errors: JSON.parse(row.errors ?? "[]"),
    startedAt: row.started_at,
  };
}

async function schemaObjectExists(driver, type, name) {
  const result = await driver.query(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = ? AND name = ?",
    [type, name],
  );
  return Number(result.rows[0]?.n ?? 0) > 0;
}

async function createUnlessExists(driver, statement) {
  const match = /^CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/i.exec(statement);
  if (match !== null && (await schemaObjectExists(driver, match[1].toLowerCase(), match[2]))) return false;
  await driver.query(statement, []);
  return true;
}

export async function installFreshnessStamp(driver, schema) {
  for (const statement of schema.createTables) {
    if (/^CREATE TABLE "deck_data_version"/.test(statement)) await createUnlessExists(driver, statement);
  }
  for (const statement of schema.createTriggers) await createUnlessExists(driver, statement);
  for (const statement of schema.postLoadStatements) {
    await driver.query(statement.replace(/^INSERT INTO/i, "INSERT OR IGNORE INTO"), []);
  }
}

async function applyEngineMigrations(driver, migrationsDir) {
  if (migrationsDir === undefined || !existsSync(migrationsDir)) return [];
  await driver.query(
    `CREATE TABLE IF NOT EXISTS "auth_migrations" ("version" TEXT NOT NULL PRIMARY KEY, "applied_at" TEXT NOT NULL)`,
    [],
  );
  const applied = [];
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const done = await driver.query("SELECT version FROM auth_migrations WHERE version = ?", [file]);
    if (done.rows.length > 0) continue;
    const statements = splitSqlStatements(readFileSync(join(migrationsDir, file), "utf8"));
    const appliedAt = new Date().toISOString().replace("T", " ").replace("Z", "").slice(0, 23);
    await driver.batch([
      ...statements.map((sql) => ({ sql, params: [] })),
      { sql: "INSERT INTO auth_migrations (version, applied_at) VALUES (?, ?)", params: [file, appliedAt] },
    ]);
    applied.push(file);
  }
  return applied;
}

export async function importDump(opts) {
  const {
    dumpPath,
    driver,
    ddlPath,
    batchSize = DEFAULT_BATCH_SIZE,
  } = opts;
  const started = Date.now();
  const schema = parseTargetSchema(ddlPath);
  const tableSet = opts.tables ? new Set(opts.tables) : undefined;
  const identity = await dumpIdentity(dumpPath);

  const stats = {
    counts: {},
    checksums: {},
    warnings: [],
    skippedTables: {},
    keyRepair: { derived: 0, nullSimpleKeys: 0 },
    errors: [],
    bytesRead: 0,
    rowsEmitted: 0,
    elapsedMs: 0,
    dump: identity,
    resumedFromRow: 0,
    engineMigrations: [],
  };

  for (const pragma of IMPORT_PRAGMAS) await driver.query(pragma, []);
  for (const pragma of schema.pragmas) await driver.query(pragma, []);

  const progress = await readImportProgress(driver);
  if (progress !== undefined && !opts.resume) {
    throw new Error(
      `this database holds an interrupted import (${progress.rowsDone} dump rows committed); ` +
        "resume it (resume:true, or --resume on the command line) or start again with a new target",
    );
  }
  if (opts.resume) {
    if (progress === undefined) {
      throw new Error("nothing to resume: this database holds no interrupted import");
    }
    if (progress.dumpBytes !== identity.bytes || progress.dumpSha256 !== identity.sha256) {
      throw new Error("cannot resume: the dump is not the one this import started from (size or SHA-256 differ)");
    }
    stats.resumedFromRow = progress.rowsDone;
    stats.errors = progress.errors;
  } else if (!opts.append) {
    if (await schemaObjectExists(driver, "table", "cards")) {
      const count = await driver.query("SELECT COUNT(*) AS n FROM cards", []);
      if ((count.rows[0]?.n ?? 0) > 0) {
        throw new Error(
          "target database already contains cards rows; refusing to import over them (pass append:true to override)",
        );
      }
    }
  }

  for (const statement of schema.createTables) await createUnlessExists(driver, statement);
  if (progress === undefined) {
    await driver.query(
      `CREATE TABLE "${IMPORT_PROGRESS_TABLE}" (
        "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
        "rows_done" INTEGER NOT NULL,
        "phase" TEXT NOT NULL,
        "dump_bytes" INTEGER NOT NULL,
        "dump_sha256" TEXT NOT NULL,
        "errors" TEXT NOT NULL,
        "started_at" TEXT NOT NULL
      )`,
      [],
    );
    await driver.query(
      `INSERT INTO "${IMPORT_PROGRESS_TABLE}" (id, rows_done, phase, dump_bytes, dump_sha256, errors, started_at) VALUES (1, 0, 'load', ?, ?, '[]', ?)`,
      [identity.bytes, identity.sha256, new Date().toISOString()],
    );
  }
  const skipRows = progress?.rowsDone ?? 0;
  const loadDone = progress !== undefined && progress.phase !== "load";

  let batch = [];
  let rowsSeen = 0;
  const checkpointStatement = () => ({
    sql: `UPDATE "${IMPORT_PROGRESS_TABLE}" SET rows_done = ?, errors = ? WHERE id = 1`,
    params: [rowsSeen, JSON.stringify(stats.errors)],
  });

  const flush = async () => {
    if (batch.length === 0 && rowsSeen <= skipRows) return;
    try {
      await driver.batch([...batch, checkpointStatement()]);
    } catch (err) {
      await driver.query("SAVEPOINT import_batch", []);
      try {
        for (const s of batch) {
          try {
            await driver.query(s.sql, s.params);
          } catch (rowErr) {
            if (stats.errors.length >= (opts.maxErrors ?? 0)) {
              rowErr.__failingTable = s.__table;
              rowErr.__failingParamCount = s.params.length;
              rowErr.__failingSql = s.sql;
              throw rowErr;
            }
            stats.errors.push({
              table: s.__table,
              rowId: s.params[s.__idIdx] ?? null,
              message: String(rowErr?.message ?? rowErr).slice(0, 300),
            });
          }
        }
        const cp = checkpointStatement();
        await driver.query(cp.sql, cp.params);
        await driver.query("RELEASE import_batch", []);
      } catch (fatal) {
        await driver.query("ROLLBACK TO import_batch", []);
        await driver.query("RELEASE import_batch", []);
        throw fatal;
      }
    }
    batch = [];
    opts.onCheckpoint?.(rowsSeen);
  };

  const makeInsert = (table, columns) => {
    const quoted = columns.map((c) => `"${c}"`).join(", ");
    const slots = columns.map(() => "?").join(", ");
    return `INSERT INTO "${table}" (${quoted}) VALUES (${slots})`;
  };

  for await (const row of dumpRows(dumpPath, {
    tables: opts.tables,
    signal: opts.signal,
    onProgress: (bytes, rows) => {
      stats.bytesRead = bytes;
      stats.rowsEmitted = rows;
      opts.onProgress?.(bytes, rows);
    },
  })) {
    if (opts.signal?.aborted) throw new Error("import interrupted");
    rowsSeen += 1;
    const alreadyCommitted = rowsSeen <= skipRows;
    const table = row.table;
    if (tableSet !== undefined && !tableSet.has(table)) continue;
    const targetColumns = ENGINE_OWNED_TABLES.includes(table) ? undefined : schema.tableColumns[table];
    if (targetColumns === undefined) {
      stats.skippedTables[table] = (stats.skippedTables[table] ?? 0) + 1;
      if (!stats.warnings.some((w) => w.startsWith(`skipped table \`${table}\``))) {
        stats.warnings.push(
          `skipped table \`${table}\`: not part of the decko-ts core schema (row count in skippedTables)`,
        );
      }
      continue;
    }

    let columns;
    let values;
    if (row.columns !== undefined) {
      const keep = [];
      const vals = [];
      for (let i = 0; i < row.columns.length && i < row.values.length; i++) {
        const name = row.columns[i];
        if (targetColumns.includes(name)) {
          keep.push(name);
          vals.push(row.values[i]);
        }
      }
      columns = keep;
      values = vals;
    } else {
      columns = targetColumns;
      values = row.values;
      if (values.length > columns.length) {
        if (!stats.warnings.some((w) => w.includes(`\`${table}\`: ${values.length} values`))) {
          stats.warnings.push(
            `table \`${table}\`: dump rows carry ${values.length} values but the target schema has ${columns.length} columns; extra values dropped (version drift; warning shown once per shape)`,
          );
        }
        values = values.slice(0, columns.length);
      } else if (values.length < columns.length) {
        if (!stats.warnings.some((w) => w.includes(`\`${table}\`: ${values.length} values`))) {
          stats.warnings.push(
            `table \`${table}\`: dump rows carry ${values.length} values but the target schema has ${columns.length} columns; missing tail columns inserted as NULL (version drift; warning shown once per shape)`,
          );
        }
        values = values.concat(new Array(columns.length - values.length).fill(null));
      }
    }

    if (table === "cards") {
      const idx = {
        name: columns.indexOf("name"),
        key: columns.indexOf("key"),
        leftId: columns.indexOf("left_id"),
      };
      if (idx.key >= 0 && idx.name >= 0) {
        const name = values[idx.name];
        const leftId = idx.leftId >= 0 ? values[idx.leftId] : null;
        if (values[idx.key] === null && typeof name === "string" && name !== "" && (leftId === null || leftId === undefined)) {
          if (opts.deriveKey !== undefined) {
            const derived = opts.deriveKey(name);
            if (derived !== undefined) {
              values[idx.key] = derived;
              stats.keyRepair.derived += 1;
            } else {
              stats.keyRepair.nullSimpleKeys += 1;
            }
          } else {
            stats.keyRepair.nullSimpleKeys += 1;
          }
        }
      }
    }

    if (stats.checksums[table] === undefined) {
      stats.counts[table] = 0;
      stats.checksums[table] = new Checksum();
    }
    stats.counts[table] += 1;
    stats.checksums[table].addRow(values, columns.indexOf("id"));
    if (alreadyCommitted) continue;

    const sql = makeInsert(table, columns);
    if (process.env.DECKO_MIGRATE_DEBUG) {
      console.error(`push ${table} cols=${columns.length} vals=${values.length} rowCols=${JSON.stringify(row.columns)} sql=${sql.slice(0, 60)}`);
    }
    batch.push({ sql, params: values, __table: table, __idIdx: columns.indexOf("id") });
    if (batch.length >= batchSize) await flush();
  }
  if (!loadDone) await flush();
  await driver.query(`UPDATE "${IMPORT_PROGRESS_TABLE}" SET phase = 'post-load' WHERE id = 1`, []);

  for (const statement of schema.createIndexes) await createUnlessExists(driver, statement);
  await driver.query("ANALYZE", []);
  await installFreshnessStamp(driver, schema);
  stats.engineMigrations = await applyEngineMigrations(
    driver,
    opts.engineMigrationsDir ?? join(dirname(ddlPath), "migrations"),
  );
  await driver.query(`DROP TABLE "${IMPORT_PROGRESS_TABLE}"`, []);
  await driver.query("PRAGMA synchronous = NORMAL", []);
  await driver.query("PRAGMA wal_checkpoint(TRUNCATE)", []);

  stats.elapsedMs = Date.now() - started;
  const checksums = {};
  for (const [table, cs] of Object.entries(stats.checksums)) {
    checksums[table] = { sum: cs.sum, count: cs.count, minId: cs.minId, maxId: cs.maxId };
  }
  stats.checksums = checksums;
  return stats;
}

export async function checksumTargetTable(driver, table, columns, chunkRows = 10000) {
  const cs = new Checksum();
  const idIdx = columns.indexOf("id");
  const colList = columns.map((c) => `"${c}"`).join(", ");
  let lastRowid = 0;
  for (;;) {
    const result = await driver.query(
      `SELECT rowid AS __rowid, ${colList} FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      [lastRowid, chunkRows],
    );
    if (result.rows.length === 0) break;
    for (const record of result.rows) {
      lastRowid = Number(record.__rowid);
      const values = columns.map((c) => record[c]);
      cs.addRow(values, idIdx);
    }
    if (result.rows.length < chunkRows) break;
  }
  return { sum: cs.sum, count: cs.count, minId: cs.minId, maxId: cs.maxId };
}

export async function countAllTables(driver, tableColumns) {
  const counts = {};
  for (const table of Object.keys(tableColumns)) {
    const result = await driver.query(`SELECT COUNT(*) AS n FROM "${table}"`, []);
    counts[table] = Number(result.rows[0]?.n ?? 0);
  }
  return counts;
}
