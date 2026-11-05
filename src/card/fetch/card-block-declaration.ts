import type { SQLDatabaseDriver, SQLStatement } from "../../server/driver.js";
import { DeckoName } from "../name.js";
import type { DbLexicon } from "./lexicon.js";
import {
  CARD_CODENAME_BY_ID_SQL,
  CARD_CODENAME_BY_KEY_SQL,
  CARD_DB_CONTENT_BY_JUNCTION_SQL,
  CARD_ID_BY_JUNCTION_PLUS_SQL,
  CARD_ID_BY_JUNCTION_SQL,
  CARD_NAME_TRIPLE_BY_ID_SQL,
  CARD_ROW_BY_ID_SQL,
  CARD_ROW_BY_KEY_SQL,
  LIVE_CARD_ID_BY_KEY_FOLDED_SQL,
  LIVE_CARD_ROW_BY_ID_SQL,
  TRASHED_CARD_BY_JUNCTION_SQL,
  TRASHED_CARD_BY_KEY_SQL,
} from "./card-read-shapes.js";

export interface CardBlockDeclarationScope {
  readonly byId?: boolean;
  readonly byKey?: boolean;
  readonly byPair?: boolean;
  readonly byTypeChain?: boolean;
}

export const EVERY_CARD_BLOCK_SHAPE: CardBlockDeclarationScope = {
  byId: true,
  byKey: true,
  byPair: true,
  byTypeChain: true,
};

export async function declareCardBlockReads(
  driver: SQLDatabaseDriver,
  lexicon: DbLexicon,
  names: readonly DeckoName[],
  scope: CardBlockDeclarationScope = EVERY_CARD_BLOCK_SHAPE,
): Promise<number[]> {
  if (driver.prefetchReads === undefined || names.length === 0) return [];
  const block = await lexicon.prefetchIds(names);
  const byIdAndPair: SQLStatement[] = [];
  if (scope.byId !== false) {
    for (const id of block.ids) {
      byIdAndPair.push({ sql: CARD_ROW_BY_ID_SQL, params: [id] });
      byIdAndPair.push({ sql: CARD_CODENAME_BY_ID_SQL, params: [id] });
      byIdAndPair.push({ sql: LIVE_CARD_ROW_BY_ID_SQL, params: [id] });
      byIdAndPair.push({ sql: CARD_NAME_TRIPLE_BY_ID_SQL, params: [id] });
    }
  }
  if (scope.byPair !== false) {
    for (const pair of block.pairs) {
      byIdAndPair.push({ sql: CARD_ID_BY_JUNCTION_SQL, params: [pair[0], pair[1]] });
      byIdAndPair.push({ sql: CARD_ID_BY_JUNCTION_PLUS_SQL, params: [pair[0], pair[1]] });
      byIdAndPair.push({ sql: CARD_DB_CONTENT_BY_JUNCTION_SQL, params: [pair[0], pair[1]] });
      byIdAndPair.push({ sql: TRASHED_CARD_BY_JUNCTION_SQL, params: [pair[0], pair[1]] });
    }
  }
  if (byIdAndPair.length > 0) await driver.prefetchReads(byIdAndPair);
  if (scope.byKey !== false) {
    const byKey: SQLStatement[] = [];
    for (const name of names) {
      if (!name.isSimple) continue;
      byKey.push({ sql: LIVE_CARD_ID_BY_KEY_FOLDED_SQL, params: [name.key] });
      byKey.push({ sql: CARD_CODENAME_BY_KEY_SQL, params: [name.key] });
    }
    for (const name of names) {
      if (!name.isSimple) continue;
      byKey.push({ sql: CARD_ROW_BY_KEY_SQL, params: [name.key] });
    }
    for (const name of names) {
      if (!name.isSimple) continue;
      byKey.push({ sql: TRASHED_CARD_BY_KEY_SQL, params: [name.key] });
    }
    if (byKey.length > 0) await driver.prefetchReads(byKey);
  }
  if (scope.byId === false || scope.byTypeChain !== true) return block.ids;
  const chain = await declareTypeChain(driver, block.ids);
  return [...block.ids, ...chain];
}

async function declareTypeChain(driver: SQLDatabaseDriver, ids: readonly number[]): Promise<number[]> {
  if (driver.prefetchReads === undefined) return [];
  const seen = new Set<number>(ids);
  const declared: number[] = [];
  let frontier = [...ids];
  for (let link = 0; link < TYPE_CHAIN_LINKS && frontier.length > 0; link += 1) {
    const statements: SQLStatement[] = [];
    for (const id of frontier) {
      statements.push({ sql: CARD_ROW_BY_ID_SQL, params: [id] });
      statements.push({ sql: CARD_CODENAME_BY_ID_SQL, params: [id] });
    }
    const outcomes = await driver.prefetchReads(statements);
    const next: number[] = [];
    for (const outcome of outcomes) {
      if (outcome.unverified || outcome.result === undefined) continue;
      for (const row of outcome.result.rows as Array<{ type_id?: unknown }>) {
        const typeId = row.type_id;
        if (typeof typeId !== "number" || !Number.isInteger(typeId)) continue;
        if (seen.has(typeId)) continue;
        seen.add(typeId);
        next.push(typeId);
      }
    }
    declared.push(...next);
    frontier = next;
  }
  return declared;
}

const TYPE_CHAIN_LINKS = 3;

export function cardBlockNames(
  keys: Iterable<string>,
  mainName: DeckoName | undefined,
): DeckoName[] {
  const names: DeckoName[] = [];
  const seen = new Set<string>();
  const collect = (name: DeckoName): void => {
    if (seen.has(name.s)) return;
    seen.add(name.s);
    names.push(name);
    if (name.leftName !== undefined) collect(name.leftName);
    if (name.rightName !== undefined) collect(name.rightName);
  };
  for (const key of keys) {
    const fullName = key.startsWith("+") ? `${mainName?.s ?? ""}${key}` : key;
    try {
      collect(DeckoName.parse(fullName));
    } catch {
    }
  }
  return names;
}
