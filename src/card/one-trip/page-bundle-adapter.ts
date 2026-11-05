import type { FetchEngine } from "../fetch.js";
import type { PageBundle } from "./types.js";
import { composeAndCacheSqlRows } from "../render/prefetch.js";

export interface RenderEngineLike {
}

export async function seatPageBundle(
  fetcher: FetchEngine,
  _render: RenderEngineLike,
  bundle: PageBundle,
): Promise<{ seated: number }> {
  const composed = await composeAndCacheSqlRows(bundle.rows, {
    driver: fetcher.driver,
    lexicon: fetcher.lexicon,
    cacheRecord: async (record) => {
      fetcher.writeToCache(record);
    },
  });
  return { seated: composed.length };
}
