export interface DumpRow {
  table: string;
  values: unknown[];
  columns: string[] | undefined;
}

export interface ParserStats {
  bytesRead: number;
  rowsEmitted: number;
  statements: number;
  maxBufferChars: number;
  skippedTables: number;
}

export interface DumpRowsOptions {
  tables?: readonly string[];
  chunkBytes?: number;
  onProgress?: (bytesRead: number, rowsEmitted: number) => void;
  signal?: AbortSignal;
  tolerantTruncated?: boolean;
}

export function decodeMysqlEscapes(raw: string): string;

export class MysqldumpInsertParser {
  constructor(opts?: DumpRowsOptions);
  feed(text: string, atEof?: boolean): void;
  nextRow(): DumpRow | undefined;
  finish(): void;
  readonly stats: ParserStats;
  readonly warnings: string[];
}

export declare function dumpRows(
  dumpPath: string,
  opts?: DumpRowsOptions,
): AsyncGenerator<DumpRow, void, undefined>;
