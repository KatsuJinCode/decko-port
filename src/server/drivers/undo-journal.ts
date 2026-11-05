import type { SQLQueryResult, SQLStatement } from "../driver.js";
import { DatabaseOutcomeUnknownError, DEFAULT_TRANSACTION_LOCK_TIMEOUT_MS, TransactionLockTimeoutError } from "../driver.js";

export const DEFAULT_JOURNALED_TABLES: readonly string[] = [
  "cards",
  "card_acts",
  "card_actions",
  "card_changes",
  "card_references",
  "card_virtuals",
];

const JOURNAL_VERSION = "decko-undo-journal-1";

export const DEFAULT_LEASE_MS = 120_000;

export interface JournalExecutor {
  query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>>;
  batch(statements: SQLStatement[]): Promise<SQLQueryResult[]>;
}

export interface UndoJournalOptions {
  tables?: readonly string[];
  leaseMs?: number;
  lockTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  newTxId?: () => string;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteText(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function shadowTable(table: string): string {
  return `decko_undo_${table}`;
}

const STATE = "decko_tx_state";
const UNDO = "decko_tx_undo";
const ASSERT = "decko_tx_assert";

const BOOTSTRAP: SQLStatement[] = [
  {
    sql: `CREATE TABLE IF NOT EXISTS ${STATE} (id INTEGER PRIMARY KEY CHECK (id = 1), tx TEXT, expires_at INTEGER, signature TEXT)`,
    params: [],
  },
  { sql: `INSERT OR IGNORE INTO ${STATE} (id) VALUES (1)`, params: [] },
  {
    sql: `CREATE TABLE IF NOT EXISTS ${UNDO} (seq INTEGER PRIMARY KEY, tx TEXT NOT NULL, tbl TEXT NOT NULL, op TEXT NOT NULL, row_id INTEGER NOT NULL)`,
    params: [],
  },
  { sql: `CREATE TABLE IF NOT EXISTS ${ASSERT} (ok INTEGER NOT NULL CONSTRAINT decko_tx_lock_held CHECK (ok = 1))`, params: [] },
];

export class TransactionLeaseLostError extends Error {
  constructor() {
    super("the transaction's lock lease expired and the lock was taken over; its writes were undone");
    this.name = "TransactionLeaseLostError";
  }
}

export function lockStateStatement(): SQLStatement {
  return { sql: `SELECT tx, expires_at FROM ${STATE} WHERE id = 1`, params: [] };
}

export function clearLeaseAssertStatement(): SQLStatement {
  return { sql: `DELETE FROM ${ASSERT}`, params: [] };
}

export class UndoJournal {
  private readonly db: JournalExecutor;
  private readonly tables: readonly string[];
  private readonly leaseMs: number;
  private readonly lockTimeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly newTxId: () => string;
  private bootstrapped: Promise<void> | undefined;
  private active: string | null = null;
  private installed: { table: string; columns: string[] }[] = [];

  constructor(db: JournalExecutor, options: UndoJournalOptions = {}) {
    this.db = db;
    this.tables = options.tables ?? DEFAULT_JOURNALED_TABLES;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_TRANSACTION_LOCK_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.newTxId = options.newTxId ?? defaultTxId;
  }

  async run<R>(work: () => Promise<R>): Promise<R> {
    const tx = await this.begin();
    this.active = tx;
    try {
      let result: R;
      try {
        result = await work();
      } catch (error) {
        try { await this.rollback(tx); }
        catch (rollbackError) { throw new DatabaseOutcomeUnknownError("rollback", new AggregateError([error, rollbackError], error instanceof Error ? error.message : String(error))); }
        throw error;
      }
      try {
        await this.commit(tx);
      } catch (error) {
        if (!(error instanceof TransactionLeaseLostError)) {
          let restored: boolean;
          try { restored = await this.rollback(tx); }
          catch (rollbackError) { throw new DatabaseOutcomeUnknownError("commit", new AggregateError([error, rollbackError], error instanceof Error ? error.message : String(error))); }
          if (!restored) throw new DatabaseOutcomeUnknownError("commit", error);
        }
        throw error;
      }
      return result;
    } finally {
      this.active = null;
    }
  }

  get activeTx(): string | null {
    return this.active;
  }

  leaseFenceStatement(tx: string): SQLStatement {
    return ownerAssert(tx);
  }

  leaseIsExpired(state: { tx: unknown; expires_at: unknown }): boolean {
    return (
      state.tx != null && state.expires_at != null && Number.isFinite(Number(state.expires_at)) && Number(state.expires_at) < this.now()
    );
  }

  async repairExpiredLease(staleTx: string): Promise<boolean> {
    await this.bootstrap();
    if (this.installed.length === 0) await this.loadInstalledTables();
    try {
      await this.db.batch([
        {
          sql: `INSERT INTO ${ASSERT} (ok) SELECT COUNT(*) FROM ${STATE} WHERE id = 1 AND tx = ? AND expires_at < ?`,
          params: [staleTx, this.now()],
        },
        { sql: `UPDATE ${STATE} SET tx = NULL, expires_at = NULL WHERE id = 1`, params: [] },
        ...this.restoreStatements(staleTx),
        { sql: `DELETE FROM ${ASSERT}`, params: [] },
      ]);
      return true;
    } catch (error) {
      if (isLeaseAssertFailure(error)) return false;
      throw error;
    }
  }

  private async bootstrap(): Promise<void> {
    this.bootstrapped ??= this.db.batch(BOOTSTRAP).then(
      () => undefined,
      (error: unknown) => {
        this.bootstrapped = undefined;
        throw error;
      },
    );
    return this.bootstrapped;
  }

  private signatureSql(): string {
    const names = this.tables.map(quoteText).join(", ");
    return (
      `SELECT group_concat(name || char(31) || sql, char(30)) AS sig FROM ` +
      `(SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN (${names}) ORDER BY name)`
    );
  }

  private async begin(): Promise<string> {
    await this.bootstrap();
    const tx = this.newTxId();
    const started = this.now();
    let delay = 10;
    for (;;) {
      const now = this.now();
      const [taken, state, schema] = await this.db.batch([
        {
          sql: `UPDATE ${STATE} SET tx = ?, expires_at = ? WHERE id = 1 AND tx IS NULL`,
          params: [tx, now + this.leaseMs],
        },
        { sql: `SELECT tx, expires_at, signature FROM ${STATE} WHERE id = 1`, params: [] },
        { sql: this.signatureSql(), params: [] },
      ]);
      const row = state.rows[0] as { tx: string | null; expires_at: number | null; signature: string | null };
      const signature = `${JOURNAL_VERSION}\u001d${(schema.rows[0] as { sig: string | null } | undefined)?.sig ?? ""}`;
      if (taken.rowsAffected === 1) {
        await this.ensureInstalled(tx, signature, row.signature);
        return tx;
      }
      if (row.tx !== null && row.expires_at !== null && Number(row.expires_at) < now) {
        if (await this.takeOverExpired(row.tx, tx, now)) {
          await this.ensureInstalled(tx, signature, row.signature);
          return tx;
        }
        continue;
      }
      if (now - started >= this.lockTimeoutMs) throw new TransactionLockTimeoutError(this.lockTimeoutMs);
      await this.sleep(delay);
      delay = Math.min(delay * 2, 250);
    }
  }

  private async ensureInstalled(tx: string, signature: string, stored: string | null): Promise<void> {
    if (stored === signature && this.installed.length > 0) return;
    const present: { table: string; columns: string[] }[] = [];
    for (const table of this.tables) {
      const info = await this.db.query<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`, []);
      if (info.rows.length > 0) present.push({ table, columns: info.rows.map((r) => String(r.name)) });
    }
    this.installed = present;
    if (stored === signature) return;
    const ddl: SQLStatement[] = [ownerAssert(tx)];
    for (const { table, columns } of present) ddl.push(...installStatements(table, columns));
    ddl.push({ sql: `UPDATE ${STATE} SET signature = ? WHERE id = 1`, params: [signature] });
    ddl.push({ sql: `DELETE FROM ${ASSERT}`, params: [] });
    await this.db.batch(ddl);
  }

  private async takeOverExpired(staleTx: string, tx: string, now: number): Promise<boolean> {
    if (this.installed.length === 0) await this.loadInstalledTables();
    try {
      await this.db.batch([
        {
          sql: `INSERT INTO ${ASSERT} (ok) SELECT COUNT(*) FROM ${STATE} WHERE id = 1 AND tx = ? AND expires_at < ?`,
          params: [staleTx, now],
        },
        { sql: `UPDATE ${STATE} SET tx = NULL, expires_at = NULL WHERE id = 1`, params: [] },
        ...this.restoreStatements(staleTx),
        { sql: `UPDATE ${STATE} SET tx = ?, expires_at = ? WHERE id = 1 AND tx IS NULL`, params: [tx, now + this.leaseMs] },
        { sql: `DELETE FROM ${ASSERT}`, params: [] },
      ]);
      return true;
    } catch (error) {
      if (isLeaseAssertFailure(error)) return false;
      throw error;
    }
  }

  private async loadInstalledTables(): Promise<void> {
    const present: { table: string; columns: string[] }[] = [];
    for (const table of this.tables) {
      const info = await this.db.query<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`, []);
      if (info.rows.length > 0) present.push({ table, columns: info.rows.map((r) => String(r.name)) });
    }
    this.installed = present;
  }

  private restoreStatements(tx: string): SQLStatement[] {
    const out: SQLStatement[] = [];
    for (const { table, columns } of this.installed) {
      const t = quoteIdent(table);
      const shadow = quoteIdent(shadowTable(table));
      const cols = columns.map(quoteIdent).join(", ");
      out.push({
        sql: `DELETE FROM ${t} WHERE rowid IN (SELECT row_id FROM ${UNDO} WHERE tx = ? AND tbl = ?)`,
        params: [tx, table],
      });
      out.push({
        sql:
          `INSERT INTO ${t} (rowid, ${cols}) SELECT undo_rowid, ${cols} FROM ${shadow} ` +
          `WHERE undo_seq IN (SELECT MIN(seq) FROM ${UNDO} WHERE tx = ? AND tbl = ? GROUP BY row_id)`,
        params: [tx, table],
      });
      out.push({ sql: `DELETE FROM ${shadow} WHERE undo_tx = ?`, params: [tx] });
    }
    out.push({ sql: `DELETE FROM ${UNDO} WHERE tx = ?`, params: [tx] });
    return out;
  }

  private async commit(tx: string): Promise<void> {
    const statements: SQLStatement[] = [ownerAssert(tx)];
    for (const { table } of this.installed) {
      statements.push({ sql: `DELETE FROM ${quoteIdent(shadowTable(table))} WHERE undo_tx = ?`, params: [tx] });
    }
    statements.push({ sql: `DELETE FROM ${UNDO} WHERE tx = ?`, params: [tx] });
    statements.push({ sql: `UPDATE ${STATE} SET tx = NULL, expires_at = NULL WHERE id = 1`, params: [] });
    statements.push({ sql: `DELETE FROM ${ASSERT}`, params: [] });
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (isLeaseAssertFailure(error)) throw new TransactionLeaseLostError();
      throw error;
    }
  }

  private async rollback(tx: string): Promise<boolean> {
    try {
      await this.db.batch([
        ownerAssert(tx),
        { sql: `UPDATE ${STATE} SET tx = NULL, expires_at = NULL WHERE id = 1`, params: [] },
        ...this.restoreStatements(tx),
        { sql: `DELETE FROM ${ASSERT}`, params: [] },
      ]);
      return true;
    } catch (error) {
      if (isLeaseAssertFailure(error)) return false;
      throw error;
    }
  }
}

function ownerAssert(tx: string): SQLStatement {
  return {
    sql: `INSERT INTO ${ASSERT} (ok) SELECT COUNT(*) FROM ${STATE} WHERE id = 1 AND tx = ?`,
    params: [tx],
  };
}

export function isLeaseAssertFailure(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  return /CHECK constraint failed/i.test(message) && message.includes("decko_tx_lock_held");
}

export function installStatements(table: string, columns: readonly string[]): SQLStatement[] {
  const t = quoteIdent(table);
  const shadow = quoteIdent(shadowTable(table));
  const name = quoteText(table);
  const cols = columns.map(quoteIdent);
  const oldCols = columns.map((c) => `old.${quoteIdent(c)}`).join(", ");
  const when = `WHEN (SELECT tx FROM ${STATE} WHERE id = 1) IS NOT NULL`;
  const trigger = (suffix: string) => quoteIdent(`${shadowTable(table)}_${suffix}`);
  const entry = (op: string, rowRef: string) =>
    `INSERT INTO ${UNDO} (tx, tbl, op, row_id) SELECT tx, ${name}, '${op}', ${rowRef} FROM ${STATE} WHERE id = 1;`;
  const image =
    `INSERT INTO ${shadow} (undo_seq, undo_tx, undo_rowid, ${cols.join(", ")}) ` +
    `SELECT last_insert_rowid(), tx, old.rowid, ${oldCols} FROM ${STATE} WHERE id = 1;`;
  return [
    { sql: `DROP TRIGGER IF EXISTS ${trigger("ins")}`, params: [] },
    { sql: `DROP TRIGGER IF EXISTS ${trigger("upd")}`, params: [] },
    { sql: `DROP TRIGGER IF EXISTS ${trigger("del")}`, params: [] },
    { sql: `DROP TABLE IF EXISTS ${shadow}`, params: [] },
    {
      sql: `CREATE TABLE ${shadow} (undo_seq INTEGER PRIMARY KEY, undo_tx TEXT NOT NULL, undo_rowid INTEGER NOT NULL, ${cols.join(", ")})`,
      params: [],
    },
    { sql: `CREATE TRIGGER ${trigger("ins")} AFTER INSERT ON ${t} ${when} BEGIN ${entry("I", "new.rowid")} END`, params: [] },
    {
      sql: `CREATE TRIGGER ${trigger("upd")} AFTER UPDATE ON ${t} ${when} BEGIN ${entry("U", "new.rowid")} ${image} END`,
      params: [],
    },
    {
      sql: `CREATE TRIGGER ${trigger("del")} AFTER DELETE ON ${t} ${when} BEGIN ${entry("D", "old.rowid")} ${image} END`,
      params: [],
    },
  ];
}

function defaultTxId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
