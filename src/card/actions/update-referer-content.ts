import { DeckoName } from "../name.js";
import { LIVE_CARD_ROW_BY_ID_SQL } from "../fetch/card-read-shapes.js";
import { NameNotFoundError, CodenameNotFoundError } from "../name/errors.js";
import { stripTags } from "../render/nest-syntax.js";
import type { SQLDatabaseDriver } from "../../server/driver.js";
import type { CardsRow } from "../../server/schema.js";
import type { CardRecord } from "../fetch/card-record.js";
import {
  dividerIndex,
  EXPLICIT_LINK,
  isSearchCard,
  refreshReferencesOut,
  scanQueryReferenceChunks,
  scanReferenceChunks,
  type ReferenceLexicon,
} from "./refresh-references-out.js";
import { isListCard, swapListItems } from "./list-content.js";

export interface RenameSwapLexicon extends ReferenceLexicon {
  composeName(
    leftId: number,
    rightId: number | undefined | null,
  ): Promise<DeckoName | undefined>;
  write(id: number, name: DeckoName, lex: [number, number]): void;
}

export interface RenameSwapDeps {
  driver: SQLDatabaseDriver;
  lexicon: RenameSwapLexicon;
  fetchRefererCard?: (id: number) => Promise<CardRecord | undefined>;
  pinStaleReferer?: (card: CardRecord) => void;
}

interface RefererRef {
  id: number;
  left_id: number | null;
  right_id: number | null;
  name: string | null;
  db_content: string | null;
  trash: number;
  card?: CardRecord;
}

export async function updateRefererContent(
  deps: RenameSwapDeps,
  renamedCardId: number,
  nameBeforeAct: DeckoName,
  name: DeckoName,
): Promise<void> {
  const working = new Map<number, string>();
  await rewriteReferersOf(deps, renamedCardId, nameBeforeAct, name, working);
  await rewriteDescendantReferers(deps, renamedCardId, nameBeforeAct, name, working);
}

export async function updateRefererReferencesOut(
  deps: RenameSwapDeps,
  renamedCardId: number,
): Promise<void> {
  for (const referer of await referersOf(deps, renamedCardId)) {
    const name = await composedNameOf(deps, referer);
    if (name === undefined) continue;
    await refreshReferencesOut(
      deps.driver,
      deps.lexicon,
      referer.id,
      name,
      referer.db_content ?? "",
    );
  }
}

async function rewriteReferersOf(
  deps: RenameSwapDeps,
  cardId: number,
  nameBeforeAct: DeckoName,
  name: DeckoName,
  working: Map<number, string>,
): Promise<void> {
  for (const referer of await referersOf(deps, cardId)) {
    await replaceReferences(deps, referer, nameBeforeAct, name, working);
  }
}

async function referersOf(
  deps: RenameSwapDeps,
  cardId: number,
): Promise<RefererRef[]> {
  const grouped = await deps.driver.query<{ referer_id: number; first_row_id: number }>(
    `SELECT referer_id, MIN(id) AS first_row_id FROM card_references
     WHERE referee_id = ? GROUP BY referer_id ORDER BY first_row_id`,
    [cardId],
  );
  const referers: RefererRef[] = [];
  for (const { referer_id } of grouped.rows) {
    if (deps.fetchRefererCard !== undefined) {
      const card = await deps.fetchRefererCard(referer_id);
      if (card === undefined || card.trash || card.id === undefined) continue;
      referers.push({
        id: card.id,
        left_id: card.leftId ?? null,
        right_id: card.rightId ?? null,
        name: card.name?.s ?? null,
        db_content: card.dbContent ?? null,
        trash: card.trash ? 1 : 0,
        card,
      });
    } else {
      const result = await deps.driver.query<CardsRow>(
        LIVE_CARD_ROW_BY_ID_SQL,
        [referer_id],
      );
      if (result.rows[0] !== undefined) referers.push(result.rows[0]);
    }
  }
  return referers;
}

async function replaceReferences(
  deps: RenameSwapDeps,
  referer: RefererRef,
  nameBeforeAct: DeckoName,
  name: DeckoName,
  working: Map<number, string>,
): Promise<void> {
  const refererName = await composedNameOf(deps, referer);
  if (refererName === undefined) return;
  const current = working.get(referer.id) ?? referer.db_content ?? "";
  const newContent = (await isListCard(deps.driver, referer.id))
    ? swapListItems(current, nameBeforeAct, name)
    : (await isSearchCard(deps.driver, referer.id))
      ? swapQueryReferenceNames(current, nameBeforeAct, name)
      : swapNames(current, nameBeforeAct, name, refererName);
  await contentQuietlySet(deps, referer, refererName, newContent, working);
}

async function contentQuietlySet(
  deps: RenameSwapDeps,
  referer: RefererRef,
  refererName: DeckoName,
  newContent: string,
  working: Map<number, string>,
): Promise<void> {
  if (newContent === (working.get(referer.id) ?? referer.db_content ?? null)) return;
  working.set(referer.id, newContent);
  if (referer.card !== undefined) deps.pinStaleReferer?.(referer.card);
  await deps.driver.query("UPDATE cards SET db_content = ? WHERE id = ?", [
    newContent,
    referer.id,
  ]);
  await refreshReferencesOut(deps.driver, deps.lexicon, referer.id, refererName, newContent);
}

export function swapNames(
  content: string | null | undefined,
  oldName: DeckoName,
  newName: DeckoName,
  refererName: DeckoName,
): string {
  const source = content ?? "";
  let result = "";
  let cursor = 0;
  for (const chunk of scanReferenceChunks(source)) {
    result += source.slice(cursor, chunk.start);
    result += swapChunkText(source.slice(chunk.start, chunk.end), chunk, oldName, newName, refererName);
    cursor = chunk.end;
  }
  return result + source.slice(cursor);
}

export function swapQueryReferenceNames(
  content: string | null | undefined,
  oldName: DeckoName,
  newName: DeckoName,
): string {
  const source = content ?? "";
  let result = "";
  let cursor = 0;
  for (const chunk of scanQueryReferenceChunks(source)) {
    result += source.slice(cursor, chunk.start);
    const swapped = DeckoName.parse(chunk.name).swap(oldName, newName);
    result += `"${swapped.s}"`;
    cursor = chunk.end;
  }
  return result + source.slice(cursor);
}

function swapChunkText(
  original: string,
  chunk: ReturnType<typeof scanReferenceChunks>[number],
  oldName: DeckoName,
  newName: DeckoName,
  refererName: DeckoName,
): string {
  try {
    if (chunk.refType === "L") {
      const divider = dividerIndex(chunk.inner);
      const target =
        divider === undefined || divider === 0 ? chunk.inner : chunk.inner.slice(0, divider);
      if (EXPLICIT_LINK.test(target)) return original;
      const linkText = divider === undefined ? undefined : chunk.inner.slice(divider + 1);
      const swapped = DeckoName.parse(target).swap(oldName, newName);
      const referee = swapped.absoluteName(refererName);
      let textSyntax = "";
      if (linkText !== undefined) {
        const stripped = rubyStrip(linkText);
        if (stripped !== "") {
          textSyntax = `|${oldName.subIn(stripped, newName)}`;
        }
      }
      return `[[${referee.s}${textSyntax}]]`;
    }
    if (chunk.refereeName === undefined) return original;
    const swapped = DeckoName.parse(chunk.refereeName).swap(oldName, newName);
    const strippedInner = stripTags(chunk.inner);
    const pipe = strippedInner.indexOf("|");
    const optLists = pipe === -1 ? undefined : strippedInner.slice(pipe + 1);
    const nestBody = optLists === undefined ? swapped.s : `${swapped.s}|${optLists}`;
    return `{{${nestBody}}}`;
  } catch (error) {
    if (error instanceof NameNotFoundError || error instanceof CodenameNotFoundError) {
      return original;
    }
    throw error;
  }
}

function rubyStrip(str: string): string {
  return str.replace(/^[ \t\n\v\f\r\0]+/, "").replace(/[ \t\n\v\f\r\0]+$/, "");
}

interface DescendantRename {
  id: number;
  before: DeckoName;
  after: DeckoName;
}

async function rewriteDescendantReferers(
  deps: RenameSwapDeps,
  renamedCardId: number,
  nameBeforeAct: DeckoName,
  name: DeckoName,
  working: Map<number, string>,
): Promise<void> {
  const renames = new Map<number, DescendantRename>();
  renames.set(renamedCardId, { id: renamedCardId, before: nameBeforeAct, after: name });
  const rows: CardsRow[] = [];
  const visited = new Set<number>([renamedCardId]);
  let frontier = [renamedCardId];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const parentId of frontier) {
      const result = await deps.driver.query<CardsRow>(
        "SELECT * FROM cards WHERE (left_id = ? OR right_id = ?) AND trash = 0",
        [parentId, parentId],
      );
      for (const child of result.rows) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        rows.push(child);
        next.push(child.id);
      }
    }
    frontier = next;
  }

  const withNames: DescendantRename[] = [];
  for (const row of rows) {
    if (row.left_id === null || row.right_id === null) continue;
    const after = await deps.lexicon.composeName(row.left_id, row.right_id);
    if (after === undefined || !after.isCompound) continue;
    const leftBefore = renames.get(row.left_id)?.before ?? after.leftName;
    const rightBefore = renames.get(row.right_id)?.before ?? after.rightName;
    if (leftBefore === undefined || rightBefore === undefined) continue;
    const before = DeckoName.compose([leftBefore, rightBefore]);
    const rename = { id: row.id, before, after };
    renames.set(row.id, rename);
    deps.lexicon.write(row.id, after, [row.left_id, row.right_id]);
    withNames.push(rename);
  }

  for (const rename of withNames) {
    await rewriteReferersOf(deps, rename.id, rename.before, rename.after, working);
  }
}

async function composedNameOf(
  deps: RenameSwapDeps,
  row: RefererRef,
): Promise<DeckoName | undefined> {
  if (row.left_id !== null && row.left_id !== undefined) {
    const composed = await deps.lexicon.composeName(row.left_id, row.right_id);
    if (composed !== undefined) return composed;
  }
  return row.name !== null && row.name !== undefined ? DeckoName.parse(row.name) : undefined;
}
