import type { SQLDatabaseDriver, SQLStatement } from "../../../server/driver.js";
import type { CardVirtualsRow, SQLDateTime } from "../../../server/schema.js";
import { sqlDateTime } from "../../history/act.js";
import type { SavedAction, ActWriter, CardFieldState } from "../../history/write-path.js";
import type { CardRecord } from "../../fetch/card-record.js";
import { isNewCard, isRealCard } from "../../fetch/card-record.js";
import { DeckoName } from "../../name.js";
import type { DeckoModManifest, ModEventFn } from "../mod-manifest.js";

export class VirtualRecordCache {
  private store = new Map<string, CardVirtualsRow>();

  read(key: string): CardVirtualsRow | undefined {
    return this.store.get(key);
  }

  write(key: string, value: CardVirtualsRow): CardVirtualsRow {
    this.store.set(key, value);
    return value;
  }

  async fetch(
    key: string,
    compute: () => Promise<CardVirtualsRow>,
  ): Promise<CardVirtualsRow> {
    const hit = this.store.get(key);
    if (hit !== undefined) return hit;
    const value = await compute();
    this.store.set(key, value);
    return value;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  reset(): void {
    this.store.clear();
  }
}

export interface VirtualCardSideIds {
  readonly leftCardId?: number | undefined;
  readonly rightCardId?: number | undefined;
}

export function virtualLeftId(
  card: CardRecord,
  sides?: VirtualCardSideIds,
): number | undefined {
  if (!card.name?.isCompound) return card.id;
  if (typeof card.leftId === "number" && card.leftId > 0) return card.leftId;
  return sides?.leftCardId;
}

export function virtualRightId(
  card: CardRecord,
  sides?: VirtualCardSideIds,
): number | undefined {
  if (!card.name?.isCompound) return -2;
  if (typeof card.rightId === "number" && card.rightId > 0) return card.rightId;
  return sides?.rightCardId;
}

export class VirtualCardError extends Error {
  readonly cardName: string;

  readonly backtraceText: string;

  constructor(cardName: string, backtraceText: string) {
    super(cardName);
    this.name = "Card::Error";
    this.cardName = cardName;
    this.backtraceText = backtraceText;
  }
}

export function validateVirtualCard(
  card: CardRecord,
  sides?: VirtualCardSideIds,
): void {
  const reason = card.name?.isCompound
    ? virtualLeftId(card, sides)
      ? virtualRightId(card, sides)
        ? undefined
        : "needs right_id"
      : "needs left_id"
    : card.id
      ? undefined
      : "needs id";
  if (reason === undefined) return;
  const name = card.name?.s ?? "";
  throw new VirtualCardError(
    name,
    `count not cacheable: card ${name} ${reason}`,
  );
}

function whereCardStatement(
  card: CardRecord,
  sides?: VirtualCardSideIds,
): { sql: string; params: unknown[] } {
  const rightId = virtualRightId(card, sides);
  const leftId = virtualLeftId(card, sides);
  if (leftId !== undefined && leftId !== null) {
    return {
      sql: "SELECT * FROM card_virtuals WHERE right_id = ? AND left_id = ? LIMIT 1",
      params: [rightId, leftId],
    };
  }
  return {
    sql: "SELECT * FROM card_virtuals WHERE right_id = ? AND left_key = ? LIMIT 1",
    params: [rightId, card.name?.leftKey ?? null],
  };
}

export async function findVirtualByCard(
  driver: SQLDatabaseDriver,
  card: CardRecord,
  sides?: VirtualCardSideIds,
): Promise<CardVirtualsRow | undefined> {
  const { sql, params } = whereCardStatement(card, sides);
  const result = await driver.query<CardVirtualsRow>(sql, params);
  return result.rows[0];
}

async function createVirtual(
  driver: SQLDatabaseDriver,
  card: CardRecord,
  now: Date,
  sides?: VirtualCardSideIds,
): Promise<CardVirtualsRow> {
  validateVirtualCard(card, sides);
  const leftId = virtualLeftId(card, sides) ?? null;
  const rightId = virtualRightId(card, sides) ?? null;
  const leftKey = card.name?.leftKey ?? null;
  const content = card.dbContent ?? null;
  const stamp = sqlDateTime(now);
  const insert: SQLStatement = {
    sql:
      "INSERT INTO card_virtuals (left_id, right_id, left_key, content, updated_at) " +
      "VALUES (?, ?, ?, ?, ?)",
    params: [leftId, rightId, leftKey, content, stamp],
  };
  const result = await driver.batch([insert]);
  const id = result[0]?.lastInsertRowId;
  return {
    id: typeof id === "number" ? id : Number(id),
    left_id: leftId,
    right_id: rightId,
    content,
    left_key: leftKey,
    updated_at: stamp,
  };
}

async function createOrUpdateVirtual(
  driver: SQLDatabaseDriver,
  card: CardRecord,
  now: Date,
  sides?: VirtualCardSideIds,
): Promise<CardVirtualsRow> {
  const existing = await findVirtualByCard(driver, card, sides);
  if (existing !== undefined) {
    await virtualRecordUpdate(driver, existing, card.dbContent ?? null, now);
    return existing;
  }
  return createVirtual(driver, card, now, sides);
}

export async function virtualFetch(
  driver: SQLDatabaseDriver,
  card: CardRecord,
  cache: VirtualRecordCache,
  now: Date,
  sides?: VirtualCardSideIds,
): Promise<CardVirtualsRow> {
  return cache.fetch(card.key ?? "", () =>
    (async () =>
      (await findVirtualByCard(driver, card, sides)) ??
      createVirtual(driver, card, now, sides))(),
  );
}

export async function virtualSave(
  driver: SQLDatabaseDriver,
  card: CardRecord,
  cache: VirtualRecordCache,
  now: Date,
  sides?: VirtualCardSideIds,
): Promise<CardVirtualsRow> {
  const row = await createOrUpdateVirtual(driver, card, now, sides);
  cache.write(card.key ?? "", row);
  return row;
}

export async function virtualDelete(
  driver: SQLDatabaseDriver,
  card: CardRecord,
  cache: VirtualRecordCache,
  sides?: VirtualCardSideIds,
): Promise<void> {
  cache.delete(card.key ?? "");
  const row = await findVirtualByCard(driver, card, sides);
  if (row === undefined) return;
  await driver.batch([
    { sql: "DELETE FROM card_virtuals WHERE id = ?", params: [row.id] },
  ]);
}

export async function virtualRecordUpdate(
  driver: SQLDatabaseDriver,
  row: CardVirtualsRow,
  newContent: string | null,
  now: Date,
): Promise<string | null> {
  const stamp = sqlDateTime(now);
  const sql =
    row.content === newContent
      ? "UPDATE card_virtuals SET updated_at = ? WHERE id = ?"
      : "UPDATE card_virtuals SET content = ?, updated_at = ? WHERE id = ?";
  const params =
    row.content === newContent ? [stamp, row.id] : [newContent, stamp, row.id];
  await driver.batch([{ sql, params }]);
  if (row.content !== newContent) row.content = newContent;
  row.updated_at = stamp;
  return newContent;
}

export function virtualRowCardname(
  row: CardVirtualsRow,
  nameOfId: (id: number) => string | undefined,
): DeckoName | undefined {
  const { left_id: leftId, right_id: rightId } = row;
  if (leftId === null || rightId === null) return undefined;
  const left = nameOfId(leftId);
  const right = nameOfId(rightId);
  if (left === undefined || right === undefined) return undefined;
  return DeckoName.compose([left, right]);
}

export function virtualRowCardId<T>(
  row: CardVirtualsRow,
  fetchCardByName: (name: DeckoName) => T | undefined,
  nameOfId: (id: number) => string | undefined,
): T | undefined {
  const name = virtualRowCardname(row, nameOfId);
  if (name === undefined) return undefined;
  return fetchCardByName(name);
}

export function isVirtualCard(card: CardRecord): boolean {
  return isNewCard(card);
}

export function virtualContent(card: CardRecord): string | undefined {
  return card.dbContent;
}

export async function virtualDbContent(
  driver: SQLDatabaseDriver,
  card: CardRecord,
  cache: VirtualRecordCache,
  now: Date,
  sides?: VirtualCardSideIds,
): Promise<string | null | undefined> {
  return (await virtualFetch(driver, card, cache, now, sides)).content;
}

export async function virtualUpdatedAt(
  driver: SQLDatabaseDriver,
  card: CardRecord,
  cache: VirtualRecordCache,
  now: Date,
  sides?: VirtualCardSideIds,
): Promise<SQLDateTime | null | undefined> {
  return (await virtualFetch(driver, card, cache, now, sides)).updated_at;
}

export async function saveVirtualContent(
  driver: SQLDatabaseDriver,
  card: CardRecord,
  cache: VirtualRecordCache,
  now: Date,
  sides?: VirtualCardSideIds,
): Promise<"success"> {
  await virtualSave(driver, card, cache, now, sides);
  return "success";
}

export async function deleteVirtualContent(
  driver: SQLDatabaseDriver,
  card: CardRecord,
  cache: VirtualRecordCache,
  sides?: VirtualCardSideIds,
): Promise<"success" | undefined> {
  await virtualDelete(driver, card, cache, sides);
  return isRealCard(card) ? undefined : "success";
}

export const VIRTUAL_EVENT_DECLARATIONS = [
  { event: "save_virtual_content", stage: "prepare_to_store", on: "save" },
  { event: "delete_virtual_content", stage: "prepare_to_store", on: "delete" },
] as const;

export const saveVirtualContentEventFn: ModEventFn = (_card, _host) => {
  void _card;
  void _host;
};

export const deleteVirtualContentEventFn: ModEventFn = (_card, _host) => {
  void _card;
  void _host;
};

export const VIRTUAL_HISTORY_ENABLED = false;

export const VIRTUAL_FOLLOWABLE_ENABLED = false;

export function virtualDeleteCard(
  writer: ActWriter,
  input: { cardId: number; before: CardFieldState },
): Promise<SavedAction | null> {
  return writer.trashCard(input);
}

export async function virtualDeleteCardBang(
  writer: ActWriter,
  input: { cardId: number; before: CardFieldState },
): Promise<SavedAction> {
  const saved = await writer.trashCard(input);
  if (saved === null) {
    throw new Error("Failed to save the record");
  }
  return saved;
}

const cardModVirtual: DeckoModManifest = {
  name: "virtual",
  gemName: "card-mod-virtual",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "abstract/virtual_cache",
      events: [
        {
          event: "save_virtual_content",
          at: "prepare_to_store",
          on: ["save"],
          fn: saveVirtualContentEventFn,
        },
        {
          event: "delete_virtual_content",
          at: "prepare_to_store",
          on: ["delete"],
          fn: deleteVirtualContentEventFn,
        },
      ],
    },
  ],
};

export default cardModVirtual;
