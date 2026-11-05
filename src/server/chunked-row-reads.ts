import type { CardsRow } from "./schema.js";
import type { SQLDatabaseDriver, SQLStatement } from "./driver.js";

export const CHUNKED_READ_IDS_PER_STATEMENT = 50;

export const CHUNKED_READ_STATEMENTS_PER_BATCH = 20;

export function chunkIds<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function readCardRowsByIdChunked(
  driver: SQLDatabaseDriver,
  ids: readonly number[],
): Promise<CardsRow[]> {
  const unique: number[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (id === null || id === undefined || !Number.isSafeInteger(id) || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (unique.length === 0) return [];

  const byId = new Map<number, CardsRow>();
  const statements: SQLStatement[] = chunkIds(unique, CHUNKED_READ_IDS_PER_STATEMENT).map(
    (group): SQLStatement => ({
      sql: `SELECT * FROM cards WHERE id IN (${group.map(() => "?").join(", ")}) AND trash = 0`,
      params: group,
    }),
  );
  for (const batchChunk of chunkIds(statements, CHUNKED_READ_STATEMENTS_PER_BATCH)) {
    const results = await driver.batch(batchChunk);
    for (const result of results) {
      for (const row of result.rows as CardsRow[]) byId.set(row.id, row);
    }
  }

  const out: CardsRow[] = [];
  for (const id of unique) {
    const row = byId.get(id);
    if (row !== undefined) out.push(row);
  }
  return out;
}
