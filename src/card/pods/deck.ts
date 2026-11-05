import { LocalSqliteDriver } from "../../server/drivers/local-sqlite.js";
import { FetchEngine } from "../fetch.js";
import { CardActionEngine } from "../actions/card-action-engine.js";
import { LocalAttachmentStore } from "../attachments/attachment-store.js";
import { applyDeckInflections } from "../name/inflect.js";
import { CARD_GEM_INITIALIZER_INFLECTIONS } from "../name/oracle-deck-inflections.js";
import { DeckoName } from "../name.js";
import { join } from "node:path";
import {
  structureRuleUniverseStatement,
  structureUniverseFromResults,
  structureRuleTypesFromResults,
} from "../rules/structure.js";
import { createVirtualCardLookup } from "../fetch/virtual-cards.js";
import { registerSqliteRegexpFunction } from "../../cql/sqlite-regexp.js";
import { ensureFreshnessStamp } from "../../server/freshness-stamp.js";
import { ensureNestIndex } from "../nest-index.js";

type Row = Record<string, unknown>;

export interface BootedDeck {
  driver: LocalSqliteDriver;
  fetcher: FetchEngine;
  engineFor(actor: { id: number; name: string }, now?: () => Date): CardActionEngine;
  close(): void;
}

export async function bootDeck(
  dbPath: string,
  opts: { readonly?: boolean; filesDir?: string; codedDir?: string } = {},
): Promise<BootedDeck> {
  applyDeckInflections(CARD_GEM_INITIALIZER_INFLECTIONS);
  const driver = new LocalSqliteDriver({ path: dbPath, readonly: opts.readonly ?? false });
  registerSqliteRegexpFunction(driver);
  if (!(opts.readonly ?? false)) await ensureFreshnessStamp(driver);
  const fetcher = new FetchEngine(driver);
  const { rows } = await driver.query("SELECT id, name, left_id, right_id FROM cards", []);
  const byId = new Map<number, Row>();
  for (const row of rows as Row[]) byId.set(Number(row.id), row);
  const memo = new Map<number, string | undefined>();
  const composed = (id: number, depth = 0): string | undefined => {
    if (memo.has(id)) return memo.get(id);
    const row = byId.get(id);
    if (row === undefined || depth > 50) return undefined;
    let name: string | undefined;
    if (row.left_id === null && typeof row.name === "string" && row.name !== "") name = row.name;
    else if (row.left_id !== null) {
      const left = composed(Number(row.left_id), depth + 1);
      const right = composed(Number(row.right_id), depth + 1);
      name = left === undefined || right === undefined ? undefined : `${left}+${right}`;
    }
    memo.set(id, name);
    return name;
  };
  fetcher.installNameEnvironment();
  for (const id of byId.keys()) {
    const name = composed(id);
    if (name === undefined) continue;
    const row = byId.get(id)!;
    fetcher.lexicon.write(
      id,
      DeckoName.parse(name),
      row.left_id === null ? String(row.name) : [Number(row.left_id), Number(row.right_id)],
    );
  }
  {
    const indexDriver = opts.readonly === true ? new LocalSqliteDriver({ path: dbPath }) : driver;
    let indexOwned = opts.readonly === true;
    try {
      await ensureNestIndex(indexDriver, fetcher.lexicon);
      if (indexOwned) indexDriver.close();
    } catch (err) {
      if (indexOwned) {
        try {
          indexDriver.close();
        } catch {
        }
        indexOwned = false;
      }
      if (opts.readonly === true) {
        process.stderr.write(
          `[nest-index] could not build the stored nest index on a read-only open of ${dbPath}: ` +
            `${err instanceof Error ? err.message : String(err)}
` +
            "[nest-index] this deck will be served by walking its nest closure (same bytes, one round trip per level) " +
            "until it can be built; run tools/deploy/build-nest-index.mjs on it.\\n",
        );
      } else {
        throw err;
      }
    }
  }
  const [universe] = await driver.batch([structureRuleUniverseStatement()]);
  fetcher.virtualCardLookup = createVirtualCardLookup(fetcher, {
    contents: structureUniverseFromResults(universe),
    ruleTypeIds: structureRuleTypesFromResults(universe),
  });
  const { servingModEventRuntime } = await import("../../server/write-routes.js");
  const modEvents = await servingModEventRuntime();
  return {
    driver,
    fetcher,
    engineFor: (actor, now) =>
      new CardActionEngine(fetcher, {
        actor,
        ipAddress: null,
        now: now ?? (() => new Date()),
        modEvents,
        ...(opts.filesDir !== undefined ? { attachmentStore: new LocalAttachmentStore(opts.filesDir) } : {}),
        ...(opts.codedDir !== undefined
          ? { codedAttachmentStore: new LocalAttachmentStore(join(opts.codedDir, "data", "files")) }
          : {}),
      }),
    close: () => driver.close(),
  };
}
