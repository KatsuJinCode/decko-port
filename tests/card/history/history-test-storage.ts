// Test storage for the history write-path tests: a thin better-sqlite3
// SQLDatabaseDriver + the CORE schema from db/schema.sqlite.sql, all
// in-memory. Lives INSIDE tests/card/history per the stream boundaries (the
// src/server/drivers/ stream owns the reference adapters); this file only
// needs the same runtime-verified better-sqlite3 members local-sqlite.ts
// uses (reader/run/all/transaction), plus exec() for the DDL.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../../src/server/driver.js";

/** The better-sqlite3 v13 members this test driver relies on (same runtime
 *  verification note as src/server/drivers/local-sqlite.ts — better-sqlite3
 *  ships no types and @types/better-sqlite3 is not installed; the shared
 *  ambient shim in tests/schema/better-sqlite3.d.ts cannot be extended from
 *  a second declare-module block, so the surface is narrowed locally). */
interface TestStatement {
  readonly reader: boolean;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: unknown[]): Record<string, unknown>[];
}
interface TestDatabase {
  prepare(sql: string): TestStatement;
  exec(sql: string): void;
  transaction<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R;
  close(): void;
}

export class HistoryTestDriver implements SQLDatabaseDriver {
  readonly db: TestDatabase;

  constructor(db: TestDatabase) {
    this.db = db;
  }

  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    const stmt = this.db.prepare(sql);
    if (stmt.reader) {
      return { rows: stmt.all(...params) as T[], rowsAffected: 0 };
    }
    const info = stmt.run(...params);
    return {
      rows: [],
      rowsAffected: Number(info.changes),
      lastInsertRowId: Number(info.lastInsertRowid) > 0 ? Number(info.lastInsertRowid) : undefined,
    };
  }

  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    if (statements.length === 0) return [];
    const runBatch = this.db.transaction(() =>
      statements.map((s) => {
        const stmt = this.db.prepare(s.sql);
        if (stmt.reader) {
          return { rows: stmt.all(...s.params), rowsAffected: 0 } as SQLQueryResult;
        }
        const info = stmt.run(...s.params);
        return {
          rows: [] as unknown[],
          rowsAffected: Number(info.changes),
          lastInsertRowId:
            Number(info.lastInsertRowid) > 0 ? Number(info.lastInsertRowid) : undefined,
        } as SQLQueryResult;
      }),
    );
    return runBatch();
  }

  close(): void {
    this.db.close();
  }
}

export interface HistoryTestStorage {
  driver: HistoryTestDriver;
  /** Raw helpers for SELECTing rows back outside the driver contract. */
  selectAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  selectOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  exec(sql: string, params?: unknown[]): void;
  close(): void;
}

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Fresh in-memory database with the CORE schema loaded. */
export function createHistoryTestStorage(): HistoryTestStorage {
  const db = new Database(":memory:") as unknown as TestDatabase;
  const ddl = readFileSync(`${REPO_ROOT}db/schema.sqlite.sql`, "utf8");
  db.exec(ddl);
  return {
    driver: new HistoryTestDriver(db),
    selectAll: <T>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...params) as T[],
    selectOne: <T>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...params)[0] as T | undefined,
    exec: (sql: string, params: unknown[] = []) => {
      db.prepare(sql).run(...params);
    },
    close: () => db.close(),
  };
}
