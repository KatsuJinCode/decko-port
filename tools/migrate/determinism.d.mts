export function hashTable(db: unknown, table: string): {
  perRowHashes: number[];
  ids: unknown[];
  totalHash: string;
};
export function proveDeterminism(opts: {
  importFn: (opts: { driver: unknown; ddlPath: string; [k: string]: unknown }) => Promise<{
    allParity?: boolean;
    tables?: Record<string, unknown>;
    [k: string]: unknown;
  }>;
  ddlPath: string;
  freshPathA: string;
  freshPathB: string;
  tableList?: string[];
}): Promise<{
  tables: Record<string, { countA: number; countB: number; deterministic: boolean; [k: string]: unknown }>;
  allTablesDeterministic: boolean;
}>;
