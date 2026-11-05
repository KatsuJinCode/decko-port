import type { SQLDatabaseDriver } from "../../server/driver.js";
import { buildOneTripClosure } from "./closure-builder.js";

export interface ReadableCorpus {
  query<T = unknown>(sql: string, params: unknown[]): Promise<{ rows: T[] }>;
}

export interface WritableDerivedStore {
  execute(sql: string, params: unknown[]): Promise<{ changes: number }>;
  readMeta(key: string): Promise<string | undefined>;
}

export function asWritableDerivedStore(driver: SQLDatabaseDriver): WritableDerivedStore {
  return {
    async execute(sql, params) {
      const result = await driver.query(sql, params);
      return { changes: result.rowsAffected ?? 0 };
    },
    async readMeta(key) {
      const result = await driver.query<{ value: string }>(
        "SELECT value FROM one_trip_meta WHERE key = ?",
        [key],
      );
      return result.rows[0]?.value;
    },
  };
}

export interface AffectedPage {
  pageId: number;
}

export async function affectedPagesForCardWrite(inputs: {
  corpus: ReadableCorpus;
  side: SQLDatabaseDriver;
  cardId: number;
}): Promise<AffectedPage[]> {
  void inputs.corpus;
  const result = await inputs.side.query<{ page_id: number }>(
    "SELECT DISTINCT page_id FROM one_trip_page_closure WHERE card_id = ?",
    [inputs.cardId],
  );
  return result.rows.map((r) => ({ pageId: r.page_id }));
}

export async function invalidateRenderPlansForPages(inputs: {
  side: SQLDatabaseDriver;
  pageIds: readonly number[];
}): Promise<number> {
  let dropped = 0;
  for (const pageId of inputs.pageIds) {
    const result = await inputs.side.query(
      "DELETE FROM one_trip_render_plans WHERE page_id = ?",
      [pageId],
    );
    dropped += result.rowsAffected ?? 0;
  }
  return dropped;
}

export async function recomputeClosuresForPages(inputs: {
  corpus: ReadableCorpus;
  side: WritableDerivedStore;
  pageIds: readonly number[];
  pageNames: Map<number, string>;
  pageOnly?: boolean;
}): Promise<void> {
  void inputs.pageOnly;
  const sideAsBuilderStore = {
    query: async <T = unknown>(sql: string, params: unknown[]): Promise<{ rows: T[] }> => {
      if (/^\s*(select|with)/i.test(sql)) {
        throw new Error(
          "INVARIANT VIOLATION: the invalidation recompute attempted to READ the derived store, which its write-only contract forbids",
        );
      }
      await inputs.side.execute(sql, params);
      return { rows: [] };
    },
  } as unknown as SQLDatabaseDriver;

  const pageNamesList = [...inputs.pageNames.values()];
  await buildOneTripClosure({
    corpus: inputs.corpus as SQLDatabaseDriver,
    side: sideAsBuilderStore,
    pageNames: pageNamesList,
  });
  void inputs.pageIds;
}
