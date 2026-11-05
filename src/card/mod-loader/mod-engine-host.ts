import type { CardRecord } from "../fetch/card-record.js";
import type { FetchEngine } from "../fetch.js";
import type { RenderCard } from "../render/format.js";
import { composeAndCacheSqlRows } from "../render/prefetch.js";
import type { ModEngineHost } from "./mod-manifest.js";

interface ModEngineLike {
  fetchRenderCard(name: string): RenderCard | undefined;
  isDenied(card: RenderCard): boolean;
}

export function modEngineHost(
  engine: ModEngineLike,
  fetcher: FetchEngine,
): ModEngineHost {
  const ensureEngineCodenamesLoaded = async (): Promise<void> => {
    const engineFetcher = (engine as unknown as {
      fetcher?: { codenames?: { ensureLoaded(): Promise<void> } };
    }).fetcher;
    await engineFetcher?.codenames?.ensureLoaded();
  };
  return {
    fetchRenderCard: (name: string) => engine.fetchRenderCard(name),
    isDenied: (card: unknown) => engine.isDenied(card as RenderCard),
    batch: (statements) => fetcher.driver.batch([...statements]),
    codenames: fetcher.codenames,
    fetchById: (id: number) => fetcher.fetchById(id),
    fetchByName: (name: string) => fetcher.fetchByName(name),
    cacheFetchedRecord: async (record: unknown) => {
      await ensureEngineCodenamesLoaded();
      await (engine as unknown as {
        cacheFetchedRecord(record: CardRecord): Promise<void>;
      }).cacheFetchedRecord(record as CardRecord);
    },
    composeAndCacheRows: async (rows) => {
      await ensureEngineCodenamesLoaded();
      const composed = await composeAndCacheSqlRows(
        rows as unknown as Parameters<typeof composeAndCacheSqlRows>[0],
        {
          driver: fetcher.driver,
          lexicon: fetcher.lexicon,
          cacheRecord: async (record: CardRecord) => {
            await (engine as unknown as {
              cacheFetchedRecord(record: CardRecord): Promise<void>;
            }).cacheFetchedRecord(record);
          },
        },
      );
      return composed as unknown as Array<{
        id?: number;
        name?: { s: string };
        key?: string;
        leftId?: number | null;
        rightId?: number | null;
      }>;
    },
  };
}
