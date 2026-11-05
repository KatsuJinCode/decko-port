import type { SQLDatabaseDriver } from "../../src/server/driver.js";

export function decodeCopyField(raw: string): string | null;
export function portTimestamp(value: string): string;
export function convertValue(type: string, value: string | null): string | number | null;
export function pgDumpBatches(
  dumpPath: string,
  batchRows?: number,
): AsyncGenerator<{ table: string; columns: string[]; rows: Array<Array<string | number | null>> }>;
export function importPgDump(opts: { dumpPath: string; driver: SQLDatabaseDriver; schemaPath: string }): Promise<{
  imported: Record<string, number>;
  skippedTables: string[];
  skippedColumns: Record<string, string[]>;
}>;
