/// <reference path="../../../tests/schema/better-sqlite3.d.ts" />
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement, SQLTransactionGuarantee } from "../driver.js";
import { retryWhileBusy, rowIdOrOmit, TransactionGate } from "../driver.js";
import { inTransactionStatementScope, runInTransactionStatementScope } from "../transaction-statement-scope.js";
import Database from "better-sqlite3";

export interface BetterSqlite3Statement {
  readonly reader: boolean;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: unknown[]): Record<string, unknown>[];
  raw(): { all(...params: unknown[]): unknown[][] };
  columns(): { name: string; type: string | null }[];
}

export interface BetterSqlite3Database {
  prepare(sql: string): BetterSqlite3Statement;
  transaction<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R;
  function(
    name: string,
    options: { deterministic?: boolean; varargs?: boolean },
    fn: (...args: unknown[]) => unknown,
  ): unknown;
  function(name: string, fn: (...args: unknown[]) => unknown): unknown;
  readonly inTransaction: boolean;
  close(): void;
}
export interface LocalSqliteDriverOptions {
  path?: string;
  readonly?: boolean;
}

export type SqliteRow = Record<string, unknown>;

export class LocalSqliteDriver implements SQLDatabaseDriver {
  private readonly db: BetterSqlite3Database;
  private readonly stmtCache = new Map<string, BetterSqlite3Statement>();

  constructor(options: LocalSqliteDriverOptions = {}) {
    this.db = new Database(options.path ?? ":memory:", {
      readonly: options.readonly ?? false,
    }) as unknown as BetterSqlite3Database;
  }

  private prepareCached(sql: string): BetterSqlite3Statement {
    let stmt = this.stmtCache.get(sql);
    if (stmt === undefined) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    if (this.db.inTransaction && inTransactionStatementScope() === false) {
      return this.gate.run(() => this.query<T>(sql, params));
    }
    const stmt = this.prepareCached(sql);
    if (stmt.reader) {
      const rows = stmt.all(...params) as T[];
      return { rows, rowsAffected: 0 };
    }
    const info = stmt.run(...params);
    return {
      rows: [],
      rowsAffected: Number(info.changes),
      lastInsertRowId: rowIdOrOmit(info.lastInsertRowid),
    };
  }

  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    if (statements.length === 0) return [];
    if (statements.some(s => s.requireStandaloneTransaction) && this.db.inTransaction) {
      throw new Error("database-standalone-batch-required");
    }
    if (this.db.inTransaction && inTransactionStatementScope() === false) {
      return this.gate.run(() => this.batch(statements));
    }
    const runBatch = this.db.transaction(() => statements.map((s) => this.executeOne(s)));
    return runBatch();
  }

  readonly transactionGuarantee: SQLTransactionGuarantee = {
    mechanism: "native",
    atomicOnFailure: true,
    crashRecovery: "database",
    readersIsolated: true,
    serializedWriters: "database",
    atomicBatch: true,
    standaloneBatchAdmission: true,
    idsReusedAfterRollback: true,
  };

  private readonly gate = new TransactionGate();

  async transaction<R>(work: () => Promise<R>): Promise<R> {
    return this.gate.run(async () =>
      runInTransactionStatementScope(async () => {
        const timeout = Number(this.prepareCached("PRAGMA busy_timeout").all()[0]?.timeout ?? 0);
        await retryWhileBusy(async () => {
          this.prepareCached("PRAGMA busy_timeout = 0").all();
          try {
            this.prepareCached("BEGIN IMMEDIATE").run();
          } finally {
            this.prepareCached(`PRAGMA busy_timeout = ${timeout}`).all();
          }
        });
        let result: R;
        try {
          result = await work();
        } catch (error) {
          this.rollbackQuietly();
          throw error;
        }
        try {
          this.prepareCached("COMMIT").run();
        } catch (error) {
          this.rollbackQuietly();
          throw error;
        }
        return result;
      }),
    );
  }

  private rollbackQuietly(): void {
    if (this.db.inTransaction) this.prepareCached("ROLLBACK").run();
  }

  registerFunction(
    name: string,
    fn: (...args: unknown[]) => unknown,
    options?: { deterministic?: boolean; varargs?: boolean },
  ): void {
    if (options) this.db.function(name, options, fn);
    else this.db.function(name, fn);
  }

  close(): void {
    this.db.close();
  }

  private executeOne(statement: SQLStatement): SQLQueryResult<SqliteRow> {
    const stmt = this.prepareCached(statement.sql);
    if (stmt.reader) {
      return { rows: stmt.all(...statement.params), rowsAffected: 0 };
    }
    const info = stmt.run(...statement.params);
    return {
      rows: [],
      rowsAffected: Number(info.changes),
      lastInsertRowId: rowIdOrOmit(info.lastInsertRowid),
    };
  }
}

