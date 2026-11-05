import type { SQLDatabaseDriver } from "../../server/driver.js";
import { DeckoName } from "../name.js";
import {
  CARD_CODENAME_TRIPLE_BY_ID_SQL,
  CARD_TYPE_CODENAME_BY_ID_SQL,
} from "../fetch/card-read-shapes.js";

export const LIST_TYPE_CODENAMES: ReadonlySet<string> = new Set(["pointer", "list", "mod", "skin"]);
export const LIST_SELF_CODENAMES: ReadonlySet<string> = new Set(["recent_settings", "mod"]);
export const LIST_RIGHT_CODENAMES: ReadonlySet<string> = new Set(["status", "followers"]);

const ID_MARK = /^~(\d+)$/;
const CODENAME_MARK = /^:(\w+)$/;

export interface ListItemResolver {
  nameForId(id: number): Promise<string | undefined>;
  nameForCodename(codename: string): Promise<string | undefined>;
}

async function standardizePart(part: string, resolve: ListItemResolver): Promise<string> {
  const id = ID_MARK.exec(part);
  if (id !== null) return (await resolve.nameForId(Number(id[1]))) ?? part;
  const code = CODENAME_MARK.exec(part);
  if (code !== null) return (await resolve.nameForCodename(code[1])) ?? part;
  return part;
}

async function standardizeItem(item: string, resolve: ListItemResolver): Promise<string> {
  if (!item.includes("+")) return standardizePart(item, resolve);
  const parts = item.split("+").map((p) => p.trim());
  const out: string[] = [];
  for (const part of parts) {
    const std = await standardizePart(part, resolve);
    if ((ID_MARK.test(part) || CODENAME_MARK.test(part)) && std === part) return item;
    out.push(std);
  }
  return out.join("+");
}

export async function isListCard(driver: SQLDatabaseDriver, cardId: number): Promise<boolean> {
  const row = (
    await driver.query<{
      own_code: string | null;
      type_code: string | null;
      right_code: string | null;
      left_type_code: string | null;
    }>(CARD_CODENAME_TRIPLE_BY_ID_SQL, [cardId])
  ).rows[0];
  if (row === undefined) return false;
  if (row.own_code !== null && LIST_SELF_CODENAMES.has(row.own_code)) return true;
  if (row.type_code !== null && LIST_TYPE_CODENAMES.has(row.type_code)) return true;
  if (row.right_code !== null && LIST_RIGHT_CODENAMES.has(row.right_code)) return true;
  if (row.right_code === "members" && row.left_type_code === "role") return true;
  return row.right_code === "follow" && row.left_type_code === "user";
}

export async function declareListCardShapes(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<void> {
  await driver.batch([
    { sql: CARD_CODENAME_TRIPLE_BY_ID_SQL, params: [cardId] },
    { sql: CARD_TYPE_CODENAME_BY_ID_SQL, params: [cardId] },
  ]);
}

export function listItemStrings(content: string | null | undefined): string[] {
  if (content === null || content === undefined || content === "") return [];
  return content
    .split(/\n+/)
    .map((i) => i.replace(/\[\[|\]\]/g, "").trim())
    .filter((i) => i !== "");
}

export function swapListItems(
  content: string | null | undefined,
  oldName: DeckoName,
  newName: DeckoName,
): string {
  const raw = (content ?? "").split(/\n+/).map((i) => i.replace(/\[\[|\]\]/g, "").trim());
  return raw
    .map((item) => (/^[:~]/.test(item) || item === "" ? item : DeckoName.parse(item).swap(oldName, newName).s))
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .join("\n");
}

export async function standardizeIdListContent(
  content: string,
  idFor: (item: string) => Promise<number | undefined>,
): Promise<string> {
  const out: string[] = [];
  for (const item of listItemStrings(content)) {
    const mark = ID_MARK.exec(item);
    const id = mark !== null ? Number(mark[1]) : await idFor(item);
    if (id !== undefined) out.push(`~${id}`);
  }
  return out.join("\n");
}

export function idMarkOf(item: string): number | undefined {
  const mark = ID_MARK.exec(item);
  return mark === null ? undefined : Number(mark[1]);
}

export async function standardizeListContent(
  content: string,
  resolve: ListItemResolver,
): Promise<string> {
  const items = content.split(/\n+/).map((i) => i.replace(/\[\[|\]\]/g, "").trim());
  const out: string[] = [];
  for (const item of items) {
    const std = (await standardizeItem(item, resolve)).trim();
    if (std !== "") out.push(std);
  }
  return out.join("\n");
}
