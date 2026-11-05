import type { SQLDatabaseDriver } from "../../src/server/driver.js";
import type { LocalSqliteToolDriver, ImportStats, TargetSchema } from "./import.mjs";
import type { DeckFilesCopy, DeckFilesReport } from "./files.mjs";

export interface TargetReadiness {
  stampRow: boolean;
  freshnessTriggers: { present: number; expected: number };
  sessionTable: boolean;
  importComplete: boolean;
  ok: boolean;
}

export function checkTargetReadiness(driver: SQLDatabaseDriver, schema: TargetSchema): Promise<TargetReadiness>;

export const OUT_OF_SCOPE: string[];

export function walkJunctionName(
  driver: SQLDatabaseDriver,
  id: number,
  depth?: number,
  maxDepth?: number,
): Promise<{ name: string | null; resolved: boolean; depth: number }>;

export interface MigrationReport {
  tool: string;
  timestamp: string;
  dump: { file: string; bytes: number };
  import: {
    elapsedMs: number;
    rowsEmitted: number;
    keyRepair: { derived: number; nullSimpleKeys: number };
    errors: { table: string; rowId: unknown; message: string }[];
    skippedTables: Record<string, number>;
    dumpSha256: string | null;
    resumedFromRow: number;
    engineMigrations: string[];
  };
  cards: { sourceCount: number; targetCount: number; parity: boolean } | null;
  tables: Record<
    string,
    {
      sourceCount: number;
      targetCount: number;
      countParity: boolean;
      checksumSource: number | null;
      checksumTarget: number;
      checksumParity: boolean | null;
      minIdSource: number | null;
      minIdTarget?: number;
      maxIdSource: number | null;
      maxIdTarget?: number;
    }
  >;
  junction: { sampled: number; resolved: number; unresolvedIds: number[] };
  engine: {
    status: string;
    spotRender?: { sampled: number; rendered: number; renderErrors: number; contentContainedHits: number };
    [key: string]: unknown;
  };
  readiness: TargetReadiness;
  files: DeckFilesReport;
  outOfScope: string[];
  allParity: boolean;
  ok: boolean;
  warnings: string[];
  verifyElapsedMs: number;
}

export interface VerifyOptions {
  dumpPath: string;
  driver: LocalSqliteToolDriver;
  ddlPath: string;
  importStats: ImportStats;
  engineChecks?: (ctx: {
    driver: LocalSqliteToolDriver;
    spotCount: number;
    seed: number;
  }) => Promise<unknown>;
  spotCount?: number;
  seed?: number;
  filesSourceDir?: string;
  filesTargetDir?: string;
  filesCopy?: DeckFilesCopy;
  reportPath?: string;
}

export function verifyMigration(opts: VerifyOptions): Promise<MigrationReport>;
