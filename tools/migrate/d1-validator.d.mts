import type { SQLDatabaseDriver } from "../../src/server/driver.js";

export const OUT_OF_SCOPE: readonly string[];

export function countTable(
  driver: SQLDatabaseDriver,
  table: string,
): Promise<number>;

export function countAll(
  driver: SQLDatabaseDriver,
  tableNames: readonly string[],
): Promise<Record<string, number>>;

export function countJunctions(driver: SQLDatabaseDriver): Promise<number>;

export interface OrphanJunctions {
  leftCount: number;
  rightCount: number;
  leftIds: number[];
  rightIds: number[];
  samples: Array<{ id: number; leftId: number | null; rightId: number | null }>;
}

export function findOrphanJunctions(
  driver: SQLDatabaseDriver,
  limit?: number,
): Promise<OrphanJunctions>;

export interface JunctionWalkSample {
  sampled: number;
  resolved: number;
}

export function sampleJunctionWalk(
  driver: SQLDatabaseDriver,
  sampleSize?: number,
  maxDepth?: number,
): Promise<JunctionWalkSample>;

export interface ChunkManifestEntry {
  file: string;
  rows: number;
  bytes: number;
  tables: string[];
}

export interface BuildReportInput {
  targetDriver: SQLDatabaseDriver;
  targetKind: string;
  targetPath: string;
  sourcePath: string;
  sourceKind: string;
  sourceBytes: number;
  sourceCardsCount: number;
  sourceJunctionsCount: number;
  tableColumns: Record<string, string[]>;
  chunks: readonly ChunkManifestEntry[];
  totalRows: number;
}

export interface ImportDeckReport {
  tool: string;
  timestamp: string;
  source: { path: string; kind: string; bytes: number; cardsCount: number; junctionsCount: number };
  target: { path: string; kind: string; tables: Record<string, number>; cardsCount: number; junctionsCount: number };
  chunks: {
    count: number;
    totalRows: number;
    totalBytes: number;
    rowsPerChunk: number[];
    bytesPerChunk: number[];
    tablesPerChunk: string[][];
  };
  integrity: {
    orphanLeftCount: number;
    orphanRightCount: number;
    orphanLeftSample: number[];
    orphanRightSample: number[];
    junctionWalk: JunctionWalkSample;
  };
  allChecksPass: boolean;
  warnings: string[];
  outOfScope: readonly string[];
  [postAppliedField: string]: unknown;
}

export function buildReport(input: BuildReportInput): Promise<ImportDeckReport>;

export function writeReport(report: ImportDeckReport, reportPath: string): void;
