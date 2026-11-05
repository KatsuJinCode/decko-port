import { DeckoName } from "../name.js";
import type { SQLDateTime, CardsRow } from "../../server/schema.js";
import type { DbLexicon } from "./lexicon.js";

export interface CardRecord {
  id: number | undefined;
  codename: string | undefined;
  leftId: number | undefined;
  rightId: number | undefined;
  typeId: number | undefined;
  dbContent: string | undefined;
  trash: boolean;
  creatorId: number | undefined;
  updaterId: number | undefined;
  createdAt: SQLDateTime | undefined;
  updatedAt: SQLDateTime | undefined;
  currentRevisionId: number | undefined;
  readRuleClass: string | undefined;
  readRuleId: number | undefined;
  referencesExpired: number | undefined;

  name: DeckoName | undefined;
  key: string | undefined;

  isNew: boolean;
  fromTrash: boolean;
  uncacheable: boolean;

  nameBeforeAct?: DeckoName;
}

export function isNewCard(card: CardRecord): boolean {
  return (card.isNew || card.fromTrash) && !card.trash;
}

export function isRealCard(card: CardRecord): boolean {
  return !isNewCard(card);
}

export function isKnownCard(card: CardRecord): boolean {
  return isRealCard(card);
}

export function cardContent(card: CardRecord): string {
  return card.dbContent ?? "";
}

const RUBY_SPACE_RE = /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;

const rubyStrip = (s: string): string =>
  s.replace(/^[ \t\n\v\f\r\0]+/, "").replace(/[ \t\n\v\f\r\0]+$/, "");

export function isBlankContent(card: CardRecord): boolean {
  const content = cardContent(card);
  return RUBY_SPACE_RE.test(content) || RUBY_SPACE_RE.test(rubyStrip(content));
}

export async function refreshContent(
  card: CardRecord,
  find: (id: number) => Promise<CardRecord | undefined>,
): Promise<void> {
  const found = card.id === undefined ? undefined : await find(card.id);
  card.dbContent = found?.dbContent;
}

export function idString(card: CardRecord): string | undefined {
  return card.id === undefined ? undefined : `~${card.id}`;
}

export async function composeCardRecord(row: CardsRow, lexicon: DbLexicon): Promise<CardRecord> {
  const trash = row.trash === 1;
  let name: DeckoName | undefined;
  let key: string | undefined;
  if (row.left_id !== null && row.left_id !== undefined) {
    const composed = await lexicon.composeName(row.left_id, row.right_id);
    if (composed !== undefined) {
      name = composed;
      key = composed.key;
    } else {
      name = row.name !== null && row.name !== undefined ? DeckoName.parse(row.name) : undefined;
      key = row.key ?? undefined;
    }
  } else {
    name = row.name !== null && row.name !== undefined ? DeckoName.parse(row.name) : undefined;
    key = row.key ?? undefined;
  }
  return {
    id: row.id,
    codename: row.codename ?? undefined,
    leftId: row.left_id ?? undefined,
    rightId: row.right_id ?? undefined,
    typeId: row.type_id,
    dbContent: row.db_content ?? undefined,
    trash,
    creatorId: row.creator_id,
    updaterId: row.updater_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentRevisionId: row.current_revision_id ?? undefined,
    readRuleClass: row.read_rule_class ?? undefined,
    readRuleId: row.read_rule_id ?? undefined,
    referencesExpired: row.references_expired ?? undefined,
    name,
    key,
    isNew: false,
    fromTrash: false,
    uncacheable: false,
  };
}

export function newCardRecord(
  mark: DeckoName,
  opts: { typeId?: number; typeCode?: string; content?: string } = {},
): CardRecord {
  return {
    id: undefined,
    codename: undefined,
    leftId: undefined,
    rightId: undefined,
    typeId: opts.typeId,
    dbContent: opts.content,
    trash: false,
    creatorId: undefined,
    updaterId: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    currentRevisionId: undefined,
    readRuleClass: undefined,
    readRuleId: undefined,
    referencesExpired: undefined,
    name: mark,
    key: mark.key,
    isNew: true,
    fromTrash: false,
    uncacheable: false,
  };
}
