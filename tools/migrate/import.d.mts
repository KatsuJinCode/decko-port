import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../src/server/driver.js";

export function splitSqlStatements(ddl: string): string[];

export interface TargetSchema {
  createTables: string[];
  createIndexes: string[];
  createTriggers: string[];
  postLoadStatements: string[];
  pragmas: string[];
  tableColumns: Record<string, string[]>;
}

export function parseTargetSchema(ddlPath: string): TargetSchema;

export function installFreshnessStamp(
  driver: Pick<SQLDatabaseDriver, "query">,
  schema: Pick<TargetSchema, "createTables" | "createTriggers" | "postLoadStatements">,
): Promise<void>;

export class LocalSqliteToolDriver implements SQLDatabaseDriver {
  constructor(path: string, opts?: { readonly?: boolean });
  query<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>>;
  batch(statements: SQLStatement[]): Promise<SQLQueryResult[]>;
  executeOne(sql: string, params: unknown[]): SQLQueryResult;
  iterate(sql: string, params?: unknown[]): Generator<Record<string, unknown>, void, void>;
  close(): void;
}

export const ENGINE_OWNED_TABLES: string[];

export const IMPORT_PROGRESS_TABLE: string;

export interface DumpIdentity {
  bytes: number;
  sha256: string;
}

export function dumpIdentity(dumpPath: string): Promise<DumpIdentity>;

export interface ImportProgress {
  rowsDone: number;
  phase: string;
  dumpBytes: number;
  dumpSha256: string;
  errors: ImportRowError[];
  startedAt: string;
}

export function readImportProgress(driver: SQLDatabaseDriver): Promise<ImportProgress | undefined>;

export interface TableChecksum {
  sum: number;
  count: number;
  minId?: number;
  maxId?: number;
}

export interface ImportRowError {
  table: string;
  rowId: unknown;
  message: string;
}

export interface ImportStats {
  counts: Record<string, number>;
  checksums: Record<string, TableChecksum>;
  warnings: string[];
  skippedTables: Record<string, number>;
  keyRepair: { derived: number; nullSimpleKeys: number };
  errors: ImportRowError[];
  bytesRead: number;
  rowsEmitted: number;
  elapsedMs: number;
  dump: DumpIdentity;
  resumedFromRow: number;
  engineMigrations: string[];
}

export interface ImportOptions {
  dumpPath: string;
  driver: LocalSqliteToolDriver;
  ddlPath: string;
  tables?: readonly string[];
  batchSize?: number;
  deriveKey?: (name: string) => string | undefined;
  onProgress?: (bytesRead: number, rowsImported: number) => void;
  signal?: AbortSignal;
  maxErrors?: number;
  append?: boolean;
  resume?: boolean;
  onCheckpoint?: (rowsDone: number) => void;
  engineMigrationsDir?: string;
}

export function importDump(opts: ImportOptions): Promise<ImportStats>;

export function checksumTargetTable(
  driver: SQLDatabaseDriver,
  table: string,
  columns: string[],
  chunkRows?: number,
): Promise<TableChecksum>;

export function countAllTables(
  driver: SQLDatabaseDriver,
  tableColumns: Record<string, string[]>,
): Promise<Record<string, number>>;
