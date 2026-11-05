export const CANONICAL_DDL: string;

export const RETIRED_INDEXES: readonly string[];
export function isRetiredIndex(name: string): boolean;

export interface CanonicalIndexStatement {
  name: string;
  table: string;
  sql: string;
}

export function canonicalIndexStatements(opts?: {
  tables?: readonly string[] | null;
  ddlPath?: string;
}): CanonicalIndexStatement[];
