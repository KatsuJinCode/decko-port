import type { SQLDatabaseDriver, SQLStatement } from "../../server/driver.js";
import type { RenameSwapLexicon } from "../actions/update-referer-content.js";
import type { FetchEngine } from "../fetch.js";
import {
  CARD_CODENAME_BY_ID_SQL,
  CARD_CODENAME_BY_KEY_SQL,
  CARD_ID_BY_KEY_SQL,
} from "../fetch/card-read-shapes.js";
import { DeckoName } from "../name.js";
import type { ModEventCard, ModEventStage } from "./mod-manifest.js";

export type ModEventCardState = Partial<ModEventCard>;

export interface ModEventSaveAttributes {
  readonly attachmentRides?: boolean;
  readonly attachmentName?: string;
  readonly storageType?: string;
  readonly bucket?: string;
  readonly mod?: string;
  readonly actionIdOfCachedUpload?: number | string;
}

export interface ModEventCardStateContext {
  readonly params?: Readonly<Record<string, unknown>>;
  readonly authCurrentId: number | null;
  readonly isActCard: boolean;
  readonly stage?: ModEventStage;
  readonly saveInput?: ModEventSaveAttributes;
  readonly fileStorage?: string;
  readonly driver: SQLDatabaseDriver;
  readonly lexicon: RenameSwapLexicon;
  readonly fetch?: FetchEngine;
}

export interface ModEventCardStateSource {
  readonly modName: string;
  readonly setPaths: readonly string[];
  load: (
    card: ModEventCard,
    ctx: ModEventCardStateContext,
  ) => ModEventCardState | Promise<ModEventCardState>;
}

const SOURCES: ModEventCardStateSource[] = [];

export function registerModEventCardStateSource(
  source: ModEventCardStateSource,
): void {
  SOURCES.push(source);
}

export function modEventCardStateSources(): readonly ModEventCardStateSource[] {
  return SOURCES;
}

export function clearModEventCardStateSources(): void {
  SOURCES.length = 0;
}

const BUILT_IN_INDEPENDENT_MODS = new Set<string>([
  "core",
  "account",
  "history",
  "carrierwave",
  "list",
  "assets",
  "card-mod-account",
  "card-mod-history",
  "card-mod-carrierwave",
  "card-mod-list",
  "card-mod-assets",
]);

export async function populateModEventCardState(
  card: ModEventCard,
  ctx: ModEventCardStateContext,
): Promise<ModEventCard> {
  if (
    SOURCES.some((s) => s.modName === "account" || s.modName === "card-mod-account") &&
    typeof ctx.driver?.batch === "function"
  ) {
    try {
      const statements: SQLStatement[] = [];
      if (card.id !== null) {
        statements.push(
          { sql: "SELECT right_id FROM cards WHERE id = ? AND trash = 0", params: [card.id] },
          { sql: CARD_CODENAME_BY_ID_SQL, params: [card.id] },
          { sql: "SELECT 1 AS one FROM cards WHERE id = ? AND trash = 0", params: [card.id] },
        );
      }
      if (card.typeId !== null && card.typeId !== card.id) {
        statements.push(
          { sql: CARD_CODENAME_BY_ID_SQL, params: [card.typeId] },
          { sql: "SELECT 1 AS one FROM cards WHERE id = ? AND trash = 0", params: [card.typeId] },
          { sql: "SELECT codename FROM cards WHERE id = ? LIMIT 1", params: [card.typeId] },
        );
      }
      if (card.name.trim() !== "") {
        const parsed = DeckoName.parse(card.name);
        if (parsed.isCompound) {
          if (parsed.leftName !== undefined) {
            for (const part of parsed.leftName.partNames) {
              if (part.isSimple) {
                statements.push({ sql: CARD_ID_BY_KEY_SQL, params: [part.key] });
              }
            }
          }
          if (parsed.rightName !== undefined) {
            const rightId = ctx.fetch?.lexicon.peekId(parsed.rightName);
            if (rightId !== undefined) {
              statements.push({
                sql: "SELECT codename FROM cards WHERE id = ? AND trash = 0",
                params: [rightId],
              });
            }
            statements.push(
              {
                sql: CARD_ID_BY_KEY_SQL,
                params: [parsed.rightName.key],
              },
              {
                sql: CARD_CODENAME_BY_KEY_SQL,
                params: [parsed.rightName.key],
              },
              {
                sql: "SELECT codename FROM cards WHERE key = ? AND trash = 0 LIMIT 1",
                params: [parsed.rightName.key],
              },
            );
          }
        } else {
          statements.push({
            sql: "SELECT codename FROM cards WHERE key = ? AND trash = 0 LIMIT 1",
            params: [parsed.key],
          });
        }
      }
      if (statements.length > 0) {
        await ctx.driver.batch(statements);
      }
    } catch {
    }
  }
  let merged: ModEventCard = card;
  let index = 0;
  while (index < SOURCES.length) {
    const source = SOURCES[index] as ModEventCardStateSource;
    if (BUILT_IN_INDEPENDENT_MODS.has(source.modName)) {
      const run: ModEventCardStateSource[] = [];
      while (
        index < SOURCES.length &&
        BUILT_IN_INDEPENDENT_MODS.has((SOURCES[index] as ModEventCardStateSource).modName)
      ) {
        run.push(SOURCES[index] as ModEventCardStateSource);
        index += 1;
      }
      const snapshot = merged;
      const states = await Promise.all(
        run.map(async (item) => {
          try {
            return await item.load(snapshot, ctx);
          } catch {
            return undefined;
          }
        }),
      );
      for (const state of states) {
        if (state !== undefined && Object.keys(state).length > 0) {
          merged = { ...merged, ...state };
        }
      }
      continue;
    }
    index += 1;
    try {
      const state = await source.load(merged, ctx);
      if (state !== undefined && Object.keys(state).length > 0) merged = { ...merged, ...state };
    } catch {
    }
  }
  return merged;
}