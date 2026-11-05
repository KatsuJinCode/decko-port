

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
