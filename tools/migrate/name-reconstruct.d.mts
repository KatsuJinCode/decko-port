export function reconstructCardName(opts: {
  driver: unknown;
  leftId: number | null;
  rightId: number | null;
  maxDepth?: number;
  [k: string]: unknown;
}): Promise<{
  name: string | null;
  key?: string | null;
  via: string;
  resolved: boolean;
  depth?: number;
  [k: string]: unknown;
}>;
export function countNullNameJunctions(driver: unknown, table?: string): Promise<number>;
