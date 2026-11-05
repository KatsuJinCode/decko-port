export function isSettingsTable(
  name: string,
  columnTypes: Record<string, string>,
): boolean;
export function inventorySettings(
  db: unknown,
  inventory: Record<string, unknown>,
): {
  tables: Array<{ source: string; count: number; sampleKeys?: string[]; [k: string]: unknown }>;
  [k: string]: unknown;
};
