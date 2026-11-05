import type { CardRecord } from "../fetch/card-record.js";
import type { FetchEngine } from "../fetch.js";
import { DeckoName } from "../name.js";
import {
  followRuleContent,
  followRuleOption,
  indexPreferenceRows,
  preferenceRows,
  setPatternsOf,
  type PreferenceIndex,
  type CardSetPattern,
} from "../notify/follower-resolver.js";

export function followSetCardName(
  cardName: string,
  typeCode?: string,
): string {
  if (typeCode === "set") return cardName;
  if (typeCode === "cardtype") return `${cardName}+*type`;
  return `${cardName}+*self`;
}

export function followRuleNameFor(setName: string, userName?: string): string {
  return userName === undefined
    ? `${setName}+*follow`
    : `${setName}+${userName}+*follow`;
}

export function followRuleNameForCard(
  cardName: string,
  userName?: string,
  typeCode?: string,
): string {
  return followRuleNameFor(followSetCardName(cardName, typeCode), userName);
}

export async function preferenceNamesForUser(
  fetch: FetchEngine,
  userName: string,
  settingCodename = "follow",
): Promise<string[]> {
  const [setId, userId] = await Promise.all([
    fetch.codenames.id("set"),
    fetch.lexicon.id(DeckoName.parse(userName)),
  ]);
  const settingId = await fetch.codenames.id(settingCodename);
  if (setId === undefined || userId === undefined || settingId === undefined) {
    return [];
  }
  const r = await fetch.driver.query<{ id: number }>(
    `SELECT p.id AS id
       FROM cards p
       JOIN cards user_set ON p.left_id  = user_set.id
       JOIN cards set_card ON user_set.left_id = set_card.id
      WHERE p.right_id          = ?
        AND set_card.type_id    = ?
        AND user_set.right_id   = ?
        AND p.trash = 0 AND user_set.trash = 0 AND set_card.trash = 0
      ORDER BY p.id`,
    [settingId, setId, userId],
  );
  const names: string[] = [];
  for (const row of r.rows) {
    const name = (await fetch.fetchById(row.id))?.name?.s;
    if (name !== undefined) names.push(name);
  }
  return names;
}

export interface FollowWalkContext {
  readonly patterns: readonly CardSetPattern[];
  readonly index: PreferenceIndex;
  readonly allId: number | undefined;
}

export async function followWalkContext(
  fetch: FetchEngine,
  card: CardRecord,
): Promise<FollowWalkContext> {
  const [patterns, index, allId] = await Promise.all([
    setPatternsOf(fetch, card),
    preferenceRows(fetch).then(indexPreferenceRows),
    fetch.codenames.id("all"),
  ]);
  return { patterns, index, allId };
}

export async function followRuleOptionFor(
  fetch: FetchEngine,
  card: CardRecord,
  followerId: number,
  ctx?: FollowWalkContext,
): Promise<string | null> {
  const walk = ctx ?? (await followWalkContext(fetch, card));
  return followRuleOption(
    fetch,
    card,
    walk.index,
    walk.patterns,
    followerId,
    walk.allId,
  );
}

export async function followedByUser(
  fetch: FetchEngine,
  card: CardRecord,
  userId: number,
): Promise<boolean> {
  const ctx = await followWalkContext(fetch, card);
  if ((await followRuleOptionFor(fetch, card, userId, ctx)) !== null) return true;
  const leftKey = card.name?.leftName?.key;
  if (leftKey === undefined) return false;
  const left = await fetch.fetchByKey(leftKey);
  if (left === undefined) return false;
  if (!(await followedFieldCheck(fetch, card, left))) return false;
  return followedByUser(fetch, left, userId);
}

async function followedFieldCheck(
  fetch: FetchEngine,
  fieldCard: CardRecord,
  leftCard: CardRecord,
): Promise<boolean> {
  const fieldKey = fieldCard.name?.key;
  if (fieldKey === undefined) return false;
  const leftName = leftCard.name?.s;
  if (leftName === undefined) return false;
  for (const ruleName of await followFieldsRuleNames(fetch, leftCard)) {
    const rule = await fetch.fetchByName(ruleName);
    if (rule === undefined || rule.dbContent === undefined || rule.dbContent === "") {
      continue;
    }
    const nestsKey = await nestsCodenameKey(fetch);
    for (const line of rule.dbContent.split("\n")) {
      const item = line.replace(/^\[\[/, "").replace(/\]\]$/, "");
      if (item.length === 0) continue;
      const key = DeckoName.parse(
        item.startsWith("+") ? `${leftName}${item}` : item,
      ).key;
      if (key === fieldKey) return true;
      if (nestsKey !== undefined && key === nestsKey) {
        if (await nestedCardCheck(fetch, leftCard, fieldCard)) return true;
      }
    }
  }
  return false;
}

async function followFieldsRuleNames(
  fetch: FetchEngine,
  leftCard: CardRecord,
): Promise<string[]> {
  const leftName = leftCard.name?.s;
  if (leftName === undefined) return [];
  const names = [`${leftName}+*self+*follow fields`];
  if (leftCard.typeId !== undefined) {
    const typeName = (await fetch.fetchById(leftCard.typeId))?.name?.s;
    if (typeName !== undefined) names.push(`${typeName}+*type+*follow fields`);
  }
  names.push("*all+*follow fields");
  return names;
}

async function nestsCodenameKey(fetch: FetchEngine): Promise<string | undefined> {
  const nestsId = await fetch.codenames.id("nests");
  if (nestsId !== undefined) {
    const name = (await fetch.fetchById(nestsId))?.name?.key;
    if (name !== undefined) return name;
  }
  return DeckoName.parse("*nests").key;
}

async function nestedCardCheck(
  fetch: FetchEngine,
  leftCard: CardRecord,
  fieldCard: CardRecord,
): Promise<boolean> {
  if (leftCard.id === undefined || fieldCard.id === undefined) return false;
  const r = await fetch.driver.query<{ referee_id: number }>(
    `SELECT referee_id FROM card_references
      WHERE ref_type = 'I' AND referer_id = ? AND referee_id = ?
      LIMIT 1`,
    [leftCard.id, fieldCard.id],
  );
  return r.rows.length > 0;
}
