export function importFromSqlite(opts: {
  sourcePath: string;
  driver: unknown;
  ddlPath: string;
  tables?: string[];
  batchSize?: number;
  maxErrors?: number;
  append?: boolean;
  deriveKey?: (name: string) => string | undefined;
  onProgress?: (rows: number, total: number) => void;
}): Promise<{
  counts: Record<string, number>;
  checksums: Record<
    string,
    { sum: number; count: number; minId: number | undefined; maxId: number | undefined }
  >;
  warnings: string[];
  skippedTables: Record<string, number>;
  keyRepair: {
    derived: number;
    nullSimpleKeys: number;
    lexResolved: number;
    lexUnresolved: number;
  };
  errors: Array<{ table: string; rowId: number | null; message: string }>;
  bytesRead: number;
  rowsEmitted: number;
  elapsedMs: number;
  tableElapsedMs: Record<string, number>;
  sourceInventory: Record<
    string,
    { columns: string[]; columnTypes: Record<string, string>; rowCount: number }
  >;
  settingsInventory: {
    tables: Array<{
      source: string;
      count: number;
      columns: string[];
      keyColumn: string;
      valueColumn: string;
      sampleKeys: string[];
    }>;
    totalCount: number;
    warning: string | undefined;
  };
  schemaMappings: Record<string, string>;
}>;
