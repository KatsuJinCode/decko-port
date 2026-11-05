export const SETTINGS_TABLE_VARIANTS: string[];
export function classifySourceTable(sourceTable: string, targetTableNames: string[]): string | null;
export function mapRowToTarget(
  sourceTable: string,
  sourceColumns: string[],
  sourceValues: unknown[],
  targetColumns: string[],
): { columns: string[]; values: unknown[]; warnings: string[] };
export function getColumnMap(targetTable: string): Record<string, string> | undefined;
export function targetToSourceTableName(targetTable: string): string | undefined;
