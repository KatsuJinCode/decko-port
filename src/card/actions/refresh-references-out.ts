import { DeckoName } from "../name.js";
import {clearCachedNestEdges, hasNestEdgeCache, NEST_EDGE_CACHE_TABLE} from "../nest-index-cache.js";
import { NameNotFoundError, CodenameNotFoundError } from "../name/errors.js";
import { stripTags } from "../render/nest-syntax.js";
import type { SQLDatabaseDriver, SQLStatement } from "../../server/driver.js";
import { CARD_TYPE_CODENAME_BY_ID_SQL } from "../fetch/card-read-shapes.js";
import { idMarkOf, isListCard, declareListCardShapes, listItemStrings } from "./list-content.js";
export { listItemStrings };

const PARTIAL_REF_CODE = "P";

export interface ReferenceLexicon {
  id(nameish: string | DeckoName): Promise<number | undefined>;
  prefetchIds?(names: readonly DeckoName[]): Promise<unknown>;
}

export interface ReferenceRow {
  refererId: number;
  refereeKey: string | null;
  refereeId: number | null;
  refType: string;
}

export async function deleteReferencesAndNestEdges(
  driver: SQLDatabaseDriver,
  refererId: number,
): Promise<void> {
  const statements: SQLStatement[] = [
    { sql: "DELETE FROM card_references WHERE referer_id = ?", params: [refererId] },
  ];
  if (await hasNestEdgeCache(driver)) {
    statements.push({
      sql: `DELETE FROM ${NEST_EDGE_CACHE_TABLE} WHERE referer_id=?`,
      params: [refererId],
    });
  }
  await driver.batch(statements);
}

export async function refreshReferencesOut(
  driver: SQLDatabaseDriver,
  lexicon: ReferenceLexicon,
  refererId: number,
  refererName: DeckoName,
  content: string | null | undefined,
  opts: { asList?: boolean } = {},
): Promise<void> {
  await deleteReferencesAndNestEdges(driver, refererId);
  const rows = await referenceRowsOut(driver, lexicon, refererId, refererName, content);
  for (let slice = 0; slice < rows.length; slice += 5000) {
    const chunk = rows.slice(slice, slice + 5000);
    const values: string[] = [];
    const params: unknown[] = [];
    for (const row of chunk) {
      values.push("(?, ?, ?, ?)");
      params.push(row.refererId, row.refereeKey, row.refereeId, row.refType);
    }
    await driver.query(
      `INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type)
       VALUES ${values.join(", ")}`,
      params,
    );
  }
}

export async function referenceRowsOut(
  driver: SQLDatabaseDriver,
  lexicon: ReferenceLexicon,
  refererId: number,
  refererName: DeckoName,
  content: string | null | undefined,
): Promise<ReferenceRow[]> {
  await declareListCardShapes(driver, refererId);
  return (await isListCard(driver, refererId))
    ? await createListReferencesOut(driver, lexicon, refererId, refererName, content)
    : (await isSearchCard(driver, refererId))
      ? await createQueryReferencesOut(lexicon, refererId, refererName, content)
      : await createReferencesOut(lexicon, refererId, refererName, content);
}

export async function clearReferencesOnDelete(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<void> {
  await driver.query("DELETE FROM card_references WHERE referer_id = ?", [cardId]);
  await clearCachedNestEdges(driver,cardId);
  await driver.query(
    "UPDATE card_references SET referee_id = NULL WHERE referee_id = ?",
    [cardId],
  );
}

async function createReferencesOut(
  lexicon: ReferenceLexicon,
  refererId: number,
  refererName: DeckoName,
  content: string | null | undefined,
  asList = false,
): Promise<ReferenceRow[]> {
  if (content === null || content === undefined || content === "") {
    return [];
  }
  const refHash = new Map<string, { refereeId: number | undefined; refTypes: string[] }>();
  if (asList) {
    const items = listItemStrings(content);
    await declareReferenceNames(lexicon, items, refererName);
    for (const item of items) {
      await interpretReference(lexicon, refHash, item, "L", refererName);
    }
    return referenceValuesArray(refHash, refererId);
  }
  const chunks = scanReferenceChunks(content).filter((chunk) => chunk.refereeName !== undefined);
  await declareReferenceNames(
    lexicon,
    chunks.map((chunk) => chunk.refereeName as string),
    refererName,
  );
  for (const chunk of chunks) {
    await interpretReference(lexicon, refHash, chunk.refereeName as string, chunk.refType, refererName);
  }
  return referenceValuesArray(refHash, refererId);
}

async function declareReferenceNames(
  lexicon: ReferenceLexicon,
  raw: readonly string[],
  refererName: DeckoName,
): Promise<void> {
  if (lexicon.prefetchIds === undefined) return;
  const names: DeckoName[] = [];
  const seen = new Set<string>();
  const collect = (name: DeckoName): void => {
    if (seen.has(name.s)) return;
    seen.add(name.s);
    names.push(name);
    if (name.leftName !== undefined) collect(name.leftName);
    if (name.rightName !== undefined) collect(name.rightName);
  };
  for (const item of raw) {
    try {
      collect(DeckoName.parse(item).absoluteName(refererName));
    } catch {
    }
  }
  if (names.length === 0) return;
  await lexicon.prefetchIds(names);
}

async function createListReferencesOut(
  driver: SQLDatabaseDriver,
  lexicon: ReferenceLexicon,
  refererId: number,
  refererName: DeckoName,
  content: string | null | undefined,
): Promise<ReferenceRow[]> {
  const refHash = new Map<string, { refereeId: number | undefined; refTypes: string[] }>();
  const idRows: ReferenceRow[] = [];
  const items = await listCardItemNames(driver, refererId) ?? listItemStrings(content);
  await declareReferenceNames(lexicon, items, refererName);
  for (const item of items) {
    const markedId = idMarkOf(item);
    if (markedId !== undefined) {
      idRows.push({ refererId, refereeKey: null, refereeId: markedId, refType: "L" });
      continue;
    }
    let name: string;
    try {
      name = DeckoName.parse(item).absoluteName(refererName).s;
    } catch {
      continue;
    }
    await interpretReference(lexicon, refHash, name, "L", refererName);
  }
  return [...idRows, ...referenceValuesArray(refHash, refererId)];
}

async function listCardItemNames(
  driver: SQLDatabaseDriver,
  refererId: number,
): Promise<string[] | undefined> {
  const row = (
    await driver.query<{ codename: string | null }>(CARD_TYPE_CODENAME_BY_ID_SQL, [refererId])
  ).rows[0];
  if (row?.codename !== "cardtype") return undefined;
  const items = await driver.query<{ name: string }>(
    "SELECT name FROM cards WHERE type_id = ? AND trash = 0",
    [refererId],
  );
  return items.rows.map((r) => String(r.name));
}

export async function isSearchCard(
  driver: SQLDatabaseDriver,
  refererId: number,
): Promise<boolean> {
  const row = (
    await driver.query<{ codename: string | null }>(CARD_TYPE_CODENAME_BY_ID_SQL, [refererId])
  ).rows[0];
  return row?.codename === "search_type";
}

const QUERY_KEYWORDS: ReadonlySet<string> = new Set(
  [
    "conj", "return", "index", "sort_by", "sort_as", "sort_dir", "sort", "dir",
    "group", "limit", "offset",
    "!=", "=", "=~", "<", ">", "in", "~", "is", "eq", "gt", "lt", "match",
    "ne", "not in", "is not", "!",
    "id", "name", "key", "type_id", "content", "left_id", "right_id",
    "codename", "read_rule_id", "created_at", "updated_at", "creator_id",
    "updater_id", "type", "part", "left", "right", "editor_of", "edited_by",
    "last_editor_of", "last_edited_by", "creator_of", "created_by",
    "updater_of", "updated_by", "link_to", "linked_to_by", "include",
    "included_by", "nest", "nested_by", "refer_to", "referred_to_by",
    "member_of", "member", "found_by", "not", "sort", "match", "name_match",
    "complete", "plus", "left_plus", "right_plus", "and", "or", "all", "any",
    "compound", "prepend", "append", "vars", "view", "params", "size",
    "desc", "asc", "count",
  ].map((k) => k.replace(/ /g, "_").toLowerCase()),
);

const QUERY_REFERENCE_STICKY = /(?<=[:,\[])\s*"([^"]+)"/g;

export interface QueryReferenceChunk {
  name: string;
  start: number;
  end: number;
}

export function isQueryKeyword(name: string): boolean {
  return QUERY_KEYWORDS.has(name.replace(/ /g, "_").toLowerCase());
}

export function scanQueryReferenceChunks(content: string): QueryReferenceChunk[] {
  const chunks: QueryReferenceChunk[] = [];
  QUERY_REFERENCE_STICKY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = QUERY_REFERENCE_STICKY.exec(content)) !== null) {
    const name = match[1] ?? "";
    if (isQueryKeyword(name)) continue;
    chunks.push({
      name,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return chunks;
}

async function createQueryReferencesOut(
  lexicon: ReferenceLexicon,
  refererId: number,
  refererName: DeckoName,
  content: string | null | undefined,
): Promise<ReferenceRow[]> {
  if (content === null || content === undefined || content === "") return [];
  const refHash = new Map<string, { refereeId: number | undefined; refTypes: string[] }>();
  const names = scanQueryReferenceChunks(content).map((chunk) => chunk.name);
  await declareReferenceNames(lexicon, names, refererName);
  for (const name of names) {
    if (QUERY_KEYWORDS.has(name.replace(/ /g, "_").toLowerCase())) continue;
    await interpretReference(lexicon, refHash, name, "Q", refererName);
  }
  return referenceValuesArray(refHash, refererId);
}

async function interpretReference(
  lexicon: ReferenceLexicon,
  refHash: Map<string, { refereeId: number | undefined; refTypes: string[] }>,
  rawRefereeName: string,
  refType: string,
  refererName: DeckoName,
): Promise<void> {
  let name: DeckoName;
  let absolute: DeckoName;
  let key: string;
  let refereeId: number | undefined;
  try {
    name = DeckoName.parse(rawRefereeName);
    absolute = name.absoluteName(refererName);
    key = absolute.key;
    if (key === refererName.key) return;
    refereeId = await lexicon.id(absolute);
  } catch (error) {
    if (
      error instanceof NameNotFoundError ||
      error instanceof CodenameNotFoundError
    ) {
      return;
    }
    throw error;
  }
  let entry = refHash.get(key);
  if (entry === undefined) {
    entry = { refereeId, refTypes: [] };
    refHash.set(key, entry);
  }
  entry.refTypes.push(refType);
  if (refereeId === undefined) {
    await interpretPartialReferences(lexicon, refHash, absolute, refererName);
  }
}

async function interpretPartialReferences(
  lexicon: ReferenceLexicon,
  refHash: Map<string, { refereeId: number | undefined; refTypes: string[] }>,
  refereeName: DeckoName,
  refererName: DeckoName,
): Promise<void> {
  if (refereeName.isSimple) return;
  for (const sidename of [refereeName.leftName, refereeName.rightName]) {
    if (sidename === undefined) continue;
    await interpretReference(lexicon, refHash, sidename.s, PARTIAL_REF_CODE, refererName);
  }
}

function referenceValuesArray(
  refHash: Map<string, { refereeId: number | undefined; refTypes: string[] }>,
  refererId: number,
): ReferenceRow[] {
  const rows: ReferenceRow[] = [];
  for (const [refereeKey, entry] of refHash) {
    const refereeId = entry.refereeId ?? null;
    const refTypes = [...new Set(entry.refTypes)];
    const effective =
      refTypes.length > 1 ? refTypes.filter((t) => t !== PARTIAL_REF_CODE) : refTypes;
    for (const refType of effective) {
      rows.push({ refererId, refereeKey, refereeId, refType });
    }
  }
  return rows;
}

export interface ReferenceChunk {
  refereeName: string | undefined;
  refType: "L" | "I";
  start: number;
  end: number;
  inner: string;
}

const LINK_FULL_STICKY = /\[\[([^\]]+)\]\]/y;
const NEST_FULL_STICKY = /\{\{([^{}]*)\}\}/y;
const NEST_SPAN = /\{\{[^{}]*\}\}/g;
export const EXPLICIT_LINK = /^(\/|https?:|mailto:)/;
export function scanReferenceChunks(content: string): ReferenceChunk[] {
  const chunks: ReferenceChunk[] = [];
  let position = 0;
  while (position < content.length) {
    const linkIdx = content.indexOf("[[", position);
    const nestIdx = content.indexOf("{{", position);
    if (linkIdx === -1 && nestIdx === -1) break;
    const idx = Math.min(
      ...[linkIdx, nestIdx].filter((i) => i !== -1),
    );
    let matched: ReferenceChunk | undefined;
    if (idx === linkIdx) {
      LINK_FULL_STICKY.lastIndex = idx;
      const m = LINK_FULL_STICKY.exec(content);
      if (m !== null) {
        matched = {
          refereeName: linkRefereeName(m[1] ?? ""),
          refType: "L",
          start: idx,
          end: idx + m[0].length,
          inner: m[1] ?? "",
        };
        position = idx + m[0].length;
      }
    } else if (idx === nestIdx) {
      NEST_FULL_STICKY.lastIndex = idx;
      const m = NEST_FULL_STICKY.exec(content);
      if (m !== null) {
        matched = {
          refereeName: nestRefereeName(m[1] ?? ""),
          refType: "I",
          start: idx,
          end: idx + m[0].length,
          inner: m[1] ?? "",
        };
        position = idx + m[0].length;
      }
    }
    if (matched !== undefined) {
      chunks.push(matched);
    } else {
      position = idx + 1;
    }
  }
  return chunks;
}

function linkRefereeName(rawSyntax: string): string | undefined {
  const divider = dividerIndex(rawSyntax);
  const target =
    divider === undefined || divider === 0 ? rawSyntax : rawSyntax.slice(0, divider);
  if (EXPLICIT_LINK.test(target)) return undefined;
  return target;
}

export function dividerIndex(raw: string): number | undefined {
  if (!raw.includes("|")) return undefined;
  const masked = raw.replace(NEST_SPAN, (span) => "x".repeat(span.length));
  const idx = masked.indexOf("|");
  return idx === -1 ? undefined : idx;
}

function nestRefereeName(inBrackets: string): string | undefined {
  const stripped = stripTags(inBrackets);
  const pipe = stripped.indexOf("|");
  const name = (pipe === -1 ? stripped : stripped.slice(0, pipe)).trim();
  if (name.startsWith("#")) return undefined;
  return name;
}
