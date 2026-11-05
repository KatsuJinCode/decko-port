import type Database from "better-sqlite3";

export function openSourceSqlite(path: string): Database.Database;
export interface SourceInventoryEntry {
  columns: string[];
  columnTypes: Record<string, string>;
  rowCount: number;
}
export function inventorySource(db: Database.Database): Record<string, SourceInventoryEntry>;
export interface SourceRow {
  table: string;
  values: unknown[];
  columns: string[];
}
export function sourceTableRows(
  db: Database.Database,
  table: string,
  opts?: { chunkRows?: number },
): AsyncGenerator<SourceRow>;
export function sourceAllRows(
  db: Database.Database,
  opts?: { chunkRows?: number },
): AsyncGenerator<SourceRow>;
