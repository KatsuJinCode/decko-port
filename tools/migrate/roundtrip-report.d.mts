export function buildRoundtripReport(opts: {
  sourceDb: unknown;
  sourcePath: string;
  targetCounts: Record<string, number>;
  targetTableNames: string[];
}): {
  rows: Array<{
    sourceTable?: string;
    target?: number;
    delta?: number;
    map?: string;
    [k: string]: unknown;
  }>;
  totals: { source: number; target: number; [k: string]: unknown };
  dropCount: number;
  unknownTables: string[];
  [k: string]: unknown;
};
export function renderRoundtripMd(report: Record<string, unknown>): string;
