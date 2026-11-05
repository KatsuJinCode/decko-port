import type { SQLDatabaseDriver, SQLStatement } from "../../server/driver.js";
import {
  CARD_CODENAME_BY_ID_SQL,
  CARD_ID_BY_CODENAME_SQL,
  CARD_ID_BY_JUNCTION_SQL,
  CARD_NAME_TRIPLE_BY_ID_SQL,
  CARD_ROW_BY_ID_SQL,
  CARD_ROW_BY_KEY_SQL,
  LIVE_CARD_ROW_BY_ID_SQL,
} from "./card-read-shapes.js";

export const DECK_STANDARD_CARD_CODENAMES = [
  "read",
  "set",
  "setting",
  "basic",
  "user",
  "cardtype",
  "list",
  "search_type",
  "all",
  "all_plus",
  "default",
  "structure",
  "type",
  "right",
  "type_plus_right",
  "self",
  "rstar",
  "rule",
  "phrase",
  "captcha",
  "input_type",
  "account",
  "email",
  "status",
  "follow",
  "follow_fields",
  "always",
  "never",
  "created",
  "edited",
  "create",
  "update",
  "delete",
  "rich_text",
  "pointer",
  "plain_text",
  "html",
  "toggle",
  "recent_settings",
  "follower_notification_email",
  "from",
  "subject",
  "text_message",
  "html_message",
] as const;

export type DeckStandardCardIds = ReadonlyMap<string, number>;

const STANDARD_KEY_ROWS = ["*structure", "*all", "*input_type"] as const;

export async function declareDeckStandardCards(
  driver: SQLDatabaseDriver,
): Promise<DeckStandardCardIds> {
  const byCodename = new Map<string, number>();
  if (driver.prefetchReads === undefined) return byCodename;

  const find: SQLStatement[] = DECK_STANDARD_CARD_CODENAMES.map((codename) => ({
    sql: CARD_ID_BY_CODENAME_SQL,
    params: [codename],
  }));
  for (const key of STANDARD_KEY_ROWS) {
    find.push({ sql: CARD_ROW_BY_KEY_SQL, params: [key] });
  }
  find.push({ sql: "SELECT tbl_name, sql FROM sqlite_master WHERE type = 'trigger'", params: [] });
  const found = await driver.prefetchReads(find);
  const ids: number[] = [];
  for (let index = 0; index < DECK_STANDARD_CARD_CODENAMES.length; index += 1) {
    const outcome = found[index];
    if (outcome === undefined || outcome.unverified || outcome.result === undefined) continue;
    const row = (outcome.result.rows as Array<{ id?: unknown }>)[0];
    const id = row?.id;
    if (typeof id !== "number" || !Number.isInteger(id)) continue;
    byCodename.set(DECK_STANDARD_CARD_CODENAMES[index] as string, id);
    ids.push(id);
  }
  if (ids.length === 0) return byCodename;

  const shapes: SQLStatement[] = [];
  for (const id of ids) {
    shapes.push({ sql: CARD_ROW_BY_ID_SQL, params: [id] });
    shapes.push({ sql: LIVE_CARD_ROW_BY_ID_SQL, params: [id] });
    shapes.push({ sql: CARD_CODENAME_BY_ID_SQL, params: [id] });
    shapes.push({ sql: CARD_NAME_TRIPLE_BY_ID_SQL, params: [id] });
  }
  const allId = byCodename.get("all");
  const defaultId = byCodename.get("default");
  const structureId = byCodename.get("structure");
  const basicId = byCodename.get("basic");
  const typeId = byCodename.get("type");
  if (allId !== undefined && defaultId !== undefined) {
    shapes.push({ sql: CARD_ID_BY_JUNCTION_SQL, params: [allId, defaultId] });
  }
  if (allId !== undefined && structureId !== undefined) {
    shapes.push({ sql: CARD_ID_BY_JUNCTION_SQL, params: [allId, structureId] });
  }
  if (basicId !== undefined && typeId !== undefined) {
    shapes.push({ sql: CARD_ID_BY_JUNCTION_SQL, params: [basicId, typeId] });
  }
  await driver.prefetchReads(shapes);
  return byCodename;
}
