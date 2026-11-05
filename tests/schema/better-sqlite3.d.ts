// Ambient declarations for better-sqlite3 v13, which ships no TypeScript
// types and @types/better-sqlite3 is not installed (deps are frozen for
// wave agents — no npm install). Only the API surface the schema tests use
// is declared. If a fuller surface is needed later, prefer adding the
// @types package over growing this file.

declare module "better-sqlite3" {
  interface RunResult {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    iterate(...params: unknown[]): IterableIterator<unknown>;
  }

  interface Options {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (message?: unknown, ...additionalInput: unknown[]) => void;
  }

  class Database {
    constructor(path: string, options?: Options);
    exec(sql: string): this;
    prepare(sql: string): Statement;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    close(): void;
    readonly open: boolean;
    readonly inTransaction: boolean;
  }

  export = Database;
}
