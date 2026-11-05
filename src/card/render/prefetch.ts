import { DeckoName } from "../name.js";
import { nestEdgeCacheAvailable } from "../nest-index-cache.js";
import {
  CodenameNotFoundError,
  NameNotFoundError,
} from "../name/errors.js";
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../server/driver.js";
import type { CardsRow } from "../../server/schema.js";
import { composeCardRecord, newCardRecord, type CardRecord } from "../fetch/card-record.js";
import type { DbLexicon } from "../fetch/lexicon.js";
import { concretePatternsForCard } from "../set-patterns/card-patterns.js";
import type { VirtualCardResolution } from "../fetch/virtual-cards.js";
import { referencedNames } from "./nest-syntax.js";

const MAX_CLOSURE_ROUNDS = 25;

const MAX_WARMUP_ROUNDS = 60;

const WARMUP_CHUNK = 90;

function chunkParams<T>(items: T[], perStatement: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perStatement) out.push(items.slice(i, i + perStatement));
  return out;
}

export interface PrefetchStats {
  batches: number;
  statements: number;
  fallbackRounds: number;
  indexedRounds: number;
  cards: number;
  additionalResults?: SQLQueryResult[];
  typePrimeMemo: Set<number>;
}

interface RawRow {
  id: number;
  name: string | null;
  key: string | null;
  codename: string | null;
  leftId: number | null;
  rightId: number | null;
  typeId: number | null;
  dbContent: string | null;
  trash: number;
  readRuleId: number | null;
  readRuleClass: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  creatorId: number | null;
  currentRevisionId: number | null;
}

function toRawRow(row: CardsRow): RawRow {
  return {
    id: row.id,
    name: row.name ?? null,
    key: row.key ?? null,
    codename: row.codename ?? null,
    leftId: row.left_id ?? null,
    rightId: row.right_id ?? null,
    typeId: row.type_id ?? null,
    dbContent: row.db_content ?? null,
    trash: row.trash ?? 0,
    readRuleId: row.read_rule_id ?? null,
    readRuleClass: row.read_rule_class ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    creatorId: row.creator_id ?? null,
    currentRevisionId: row.current_revision_id ?? null,
  };
}

export interface PrefetchContext {
  driver: SQLDatabaseDriver;
  lexicon: DbLexicon;
  cacheRecord: (record: CardRecord) => Promise<void>;
  writeToCache?: (record: CardRecord) => void;
  additionalStatements?: SQLStatement[];
  skipClosureWalk?: boolean;
}

export async function prefetchInclusionClosure(
  root: CardRecord,
  ctx: PrefetchContext,
): Promise<PrefetchStats> {
  const stats: PrefetchStats = {
    batches: 0,
    statements: 0,
    fallbackRounds: 0,
    indexedRounds: 0,
    cards: 0,
    typePrimeMemo: new Set<number>(),
  };
  if (root.name === undefined || root.key === undefined) return stats;

  const rootRow = recordToRawRow(root);

  const preludeStatements: SQLStatement[] = [];
  const seenIds = new Set<number>([rootRow.id]);
  const rootSideIds = nextSideIds([rootRow], seenIds);

  let sidePrimeSlot = -1;
  if (rootSideIds.length > 0) {
    const placeholders = rootSideIds.map(() => "?").join(", ");
    preludeStatements.push({
      sql: `SELECT * FROM cards WHERE id IN (${placeholders}) AND trash = 0`,
      params: rootSideIds,
    });
    sidePrimeSlot = preludeStatements.length - 1;
  }

  let typeRowSlot = -1;
  const rootTypeId = root.typeId;
  if (typeof rootTypeId === "number" && Number.isSafeInteger(rootTypeId) && rootTypeId > 0) {
    preludeStatements.push({
      sql: `SELECT * FROM cards WHERE id IN (?, (SELECT type_id FROM cards WHERE id = ? AND trash = 0)) AND trash = 0`,
      params: [rootTypeId, rootTypeId],
    });
    typeRowSlot = preludeStatements.length - 1;
  }

  let testContextSlot = -1;
  const rootTagKey = root.name?.isCompound === true ? DeckoName.parse(root.name.tag).key : undefined;
  if (
    root.leftId !== undefined &&
    root.leftId > 0 &&
    (rootTagKey === "*html_message" || rootTagKey === "*text_message")
  ) {
    preludeStatements.push({
      sql: `SELECT j.* FROM cards j JOIN cards s ON s.id = j.right_id WHERE j.left_id = ? AND s.codename = 'test_context' AND j.trash = 0`,
      params: [root.leftId],
    });
    testContextSlot = preludeStatements.length - 1;
  }
  let templateTestContextSlot = -1;
  if (root.id !== undefined && root.id > 0) {
    preludeStatements.push({
      sql: `SELECT j.* FROM cards j JOIN cards s ON s.id = j.right_id WHERE j.left_id = ? AND s.codename = 'test_context' AND j.trash = 0 AND EXISTS (SELECT 1 FROM cards t WHERE t.id = ? AND t.codename = 'email_template')`,
      params: [root.id, root.typeId ?? -1],
    });
    templateTestContextSlot = preludeStatements.length - 1;
  }

  let emailFieldAnchorSlot = -1;
  if (root.typeId !== undefined && root.typeId > 0) {
    preludeStatements.push({
      sql: `SELECT c.id, c.key FROM cards c WHERE c.key COLLATE NOCASE IN ('*to','*from','*cc','*bcc','*attach','*subject','*text message','*html message','*test context') AND c.trash = 0 AND EXISTS (SELECT 1 FROM cards t WHERE t.id = ? AND t.codename = 'email_template')`,
      params: [root.typeId],
    });
    emailFieldAnchorSlot = preludeStatements.length - 1;
  }

  let anchorNames: string[] = [];
  let anchorSlot = -1;
  let anchorEntries: { key: string; id: number | undefined }[] = [];
  try {
    anchorNames = [
      ...new Set(concretePatternsForCard(root).map((pattern) => pattern.patternCardName)),
    ];
  } catch {
    anchorNames = [];
  }
  if (anchorNames.length > 0) {
    const placeholders = anchorNames.map(() => "?").join(", ");
    preludeStatements.push({
      sql: `SELECT id, key FROM cards WHERE key COLLATE NOCASE IN (${placeholders}) AND trash = 0`,
      params: anchorNames.map((name) => DeckoName.parse(name).key),
    });
    anchorSlot = preludeStatements.length - 1;
  }

  let nestIndexSlot = -1;
  if (ctx.skipClosureWalk !== true && rootRow.id > 0) {
    const useDerived = nestEdgeCacheAvailable(ctx.driver);
    preludeStatements.push(nestIndexStatement(rootRow.id, useDerived));
    nestIndexSlot = preludeStatements.length - 1;
  }

  const nestIndexRows: RawRow[] = [];
  const preludeSideRows: RawRow[] = [];
  const preludeTypeRows: RawRow[] = [];
  const preludeTestContextRows: RawRow[] = [];
  const additional = ctx.additionalStatements ?? [];
  let additionalResults: SQLQueryResult[] | undefined;
  if (preludeStatements.length > 0 || additional.length > 0) {
    const batch = await ctx.driver.batch([...preludeStatements, ...additional]);
    stats.batches += 1;
    stats.statements += preludeStatements.length + additional.length;
    if (additional.length > 0) {
      additionalResults = batch.slice(preludeStatements.length);
    }
    batch.slice(0, preludeStatements.length).forEach((result, i) => {
      const rows = (result.rows as CardsRow[]) ?? [];
      if (i === sidePrimeSlot) preludeSideRows.push(...rows.map(toRawRow));
      else if (i === typeRowSlot) preludeTypeRows.push(...rows.map(toRawRow));
      else if (i === nestIndexSlot) nestIndexRows.push(...rows.map(toRawRow));
      else if (i === testContextSlot) preludeTestContextRows.push(...rows.map(toRawRow));
      else if (i === templateTestContextSlot) preludeTestContextRows.push(...rows.map(toRawRow));
      else if (i === emailFieldAnchorSlot) {
        const entries = rows
          .filter((row) => typeof row.key === "string" && typeof row.id === "number")
          .map((row) => ({ key: row.key as string, id: row.id as number }));
        if (entries.length > 0) ctx.lexicon.primeIdsByKey(entries);
      } else if (i === anchorSlot) {
        const byKey = new Map<string, number>();
        for (const row of rows) {
          if (typeof row.key === "string" && typeof row.id === "number") {
            byKey.set(row.key, row.id);
          }
        }
        anchorEntries = anchorNames.map((name) => ({
          key: name,
          id: byKey.get(DeckoName.parse(name).key),
        }));
      }
    });
    if (anchorEntries.length > 0) ctx.lexicon.primeIdsByKey(anchorEntries);
  }

  const testContextItemKeys = new Set<string>();
  for (const row of preludeTestContextRows) {
    const firstItem = (row.dbContent ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "");
    if (firstItem === undefined || firstItem === "") continue;
    try {
      testContextItemKeys.add(DeckoName.parse(firstItem).key);
    } catch (err) {
      if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
        continue;
      }
      throw err;
    }
  }
  const preludeItemRows: RawRow[] = [];
  if (testContextItemKeys.size > 0) {
    const placeholders = [...testContextItemKeys].map(() => "?").join(", ");
    const itemBatch = await ctx.driver.batch([
      {
        sql: `SELECT * FROM cards WHERE key COLLATE NOCASE IN (${placeholders}) AND trash = 0`,
        params: [...testContextItemKeys],
      },
    ]);
    stats.batches += 1;
    stats.statements += 1;
    preludeItemRows.push(...(((itemBatch[0]?.rows as CardsRow[]) ?? []).map(toRawRow)));
  }

  const preludeSideComposed =
    preludeSideRows.length > 0 ? await composeAndCache(preludeSideRows, ctx, stats) : [];
  if (preludeTypeRows.length > 0) await composeAndCache(preludeTypeRows, ctx, stats);
  const preludeTestContextComposed =
    preludeTestContextRows.length > 0
      ? await composeAndCache(preludeTestContextRows, ctx, stats)
      : [];
  const preludeItemComposed =
    preludeItemRows.length > 0 ? await composeAndCache(preludeItemRows, ctx, stats) : [];

  const composed = await composeAndCache([rootRow], ctx, stats);
  stats.additionalResults = additionalResults;
  if (ctx.skipClosureWalk === true) return stats;
  await driveClosure(
    [rootRow, ...preludeTestContextRows],
    [...composed, ...preludeSideComposed, ...preludeTestContextComposed, ...preludeItemComposed],
    ctx,
    stats,
    new NestIndexPool(nestIndexRows),
  );
  return stats;
}

export function nestIndexStatement(rootId: number, includeDerivedCache = false): SQLStatement {
  return {
    sql:
      `WITH RECURSIVE reach(id, via) AS (\n` +
      `  SELECT ?, 'n'\n` +
      `  UNION\n` +
      `  SELECT refs.referee_id, 'n' FROM card_references refs JOIN reach ON refs.referer_id = reach.id\n` +
      `   WHERE reach.via = 'n' AND refs.ref_type = 'I' AND refs.referee_id IS NOT NULL\n` +
      (includeDerivedCache
        ? `  UNION\n  SELECT cached.referee_id, 'n' FROM decko_nest_edges cached JOIN reach ON cached.referer_id = reach.id\n   WHERE reach.via = 'n' AND cached.referee_id IS NOT NULL\n`
        : "") +
      `  UNION\n` +
      `  SELECT c.left_id, 's' FROM cards c JOIN reach ON c.id = reach.id WHERE c.left_id IS NOT NULL\n` +
      `  UNION\n` +
      `  SELECT c.right_id, 's' FROM cards c JOIN reach ON c.id = reach.id WHERE c.right_id IS NOT NULL\n` +
      `)\n` +
      `SELECT * FROM cards WHERE id IN (SELECT id FROM reach) AND trash = 0`,
    params: [rootId],
  };
}
interface ClosureRoundAsks {
  simpleKeys: string[];
  leftKeys: string[];
  rightKeys: string[];
  sideIdPairs: { leftId: number; rightId: number }[];
  sideIdsToPrime: number[];
}

class NestIndexPool {
  private readonly byKey = new Map<string, RawRow>();
  private readonly byId = new Map<number, RawRow>();
  private readonly byPair = new Map<string, RawRow>();

  constructor(rows: RawRow[]) {
    for (const row of rows) {
      this.byId.set(row.id, row);
      if (row.key !== null && row.key !== "") this.byKey.set(row.key, row);
      if (row.leftId !== null && row.rightId !== null) this.byPair.set(`${row.leftId}/${row.rightId}`, row);
    }
  }

  get size(): number {
    return this.byId.size;
  }

  answer(asks: ClosureRoundAsks): { closureRows: RawRow[]; sideRows: RawRow[] } | undefined {
    if (this.byId.size === 0) return undefined;
    const closureRows: RawRow[] = [];
    const simple = new Map<string, RawRow>();
    for (const key of asks.simpleKeys) {
      const row = this.byKey.get(key);
      if (row === undefined) return undefined;
      simple.set(key, row);
    }
    closureRows.push(...simple.values());
    if (asks.leftKeys.length > 0 && asks.rightKeys.length > 0) {
      const junctions = new Map<number, RawRow>();
      for (const leftKey of new Set(asks.leftKeys)) {
        const left = this.byKey.get(leftKey);
        if (left === undefined) return undefined;
        for (const rightKey of new Set(asks.rightKeys)) {
          const right = this.byKey.get(rightKey);
          if (right === undefined) return undefined;
          const junction = this.byPair.get(`${left.id}/${right.id}`);
          if (junction === undefined) return undefined;
          junctions.set(junction.id, junction);
        }
      }
      closureRows.push(...junctions.values());
    }
    const pairRows = new Map<number, RawRow>();
    for (const pair of asks.sideIdPairs) {
      const junction = this.byPair.get(`${pair.leftId}/${pair.rightId}`);
      if (junction === undefined) return undefined;
      pairRows.set(junction.id, junction);
    }
    closureRows.push(...pairRows.values());
    const sideRows: RawRow[] = [];
    for (const id of new Set(asks.sideIdsToPrime)) {
      const row = this.byId.get(id);
      if (row === undefined) return undefined;
      sideRows.push(row);
    }
    return { closureRows, sideRows };
  }
}

function recordToRawRow(record: CardRecord): RawRow {
  return {
    id: record.id ?? -1,
    name: record.name?.s ?? null,
    key: record.key ?? null,
    codename: record.codename ?? null,
    leftId: record.leftId ?? null,
    rightId: record.rightId ?? null,
    typeId: record.typeId ?? null,
    dbContent: record.dbContent ?? null,
    trash: record.trash ? 1 : 0,
    readRuleId: record.readRuleId ?? null,
    readRuleClass: record.readRuleClass ?? null,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
    creatorId: record.creatorId ?? null,
    currentRevisionId: record.currentRevisionId ?? null,
  };
}

async function primeComposeTypeInputs(
  ctx: PrefetchContext,
  typeIds: Iterable<number | null | undefined>,
  memo: Set<number>,
  heldIds?: ReadonlySet<number>,
): Promise<void> {
  const need = new Set<number>();
  for (const t of typeIds) {
    if (typeof t !== "number" || t <= 0) continue;
    if (memo.has(t)) continue;
    memo.add(t);
    if (heldIds?.has(t) === true) continue;
    need.add(t);
  }
  if (need.size === 0) return;
  const CHUNK = 500;
  const ids = [...need];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const results = await ctx.driver.batch(
      chunk.map((id) => ({
        sql: "SELECT * FROM cards WHERE id = ? AND trash = 0 LIMIT 1",
        params: [id],
      })),
    );
    const rows: CardsRow[] = [];
    results.forEach((result) => {
      const row = (result.rows as CardsRow[])[0];
      if (row !== undefined) rows.push(row);
    });
    for (const row of rows) ctx.lexicon.noteIdToLexRow(row);
    if (ctx.writeToCache !== undefined) {
      for (const row of rows) {
        const record = await composeCardRecord(row, ctx.lexicon);
        if (record.name === undefined || record.id === undefined) continue;
        ctx.writeToCache(record);
      }
    }
  }
}

async function composeAndCache(
  rows: RawRow[],
  ctx: PrefetchContext,
  stats: PrefetchStats,
): Promise<CardRecord[]> {
  const byId = new Map<number, RawRow>();
  for (const row of rows) byId.set(row.id, row);
  await primeComposeTypeInputs(
    ctx,
    rows.map((row) => row.typeId),
    stats.typePrimeMemo,
    new Set(byId.keys()),
  );

  const names = new Map<number, DeckoName>();
  let pending = [...byId.values()];
  for (let pass = 0; pass < 64 && pending.length > 0; pass++) {
    const still: RawRow[] = [];
    for (const row of pending) {
      const composed = await tryComposeName(row, names, ctx);
      if (composed !== undefined) names.set(row.id, composed);
      else still.push(row);
    }
    if (still.length === pending.length) break;
    pending = still;
  }

  const composedRecords: CardRecord[] = [];
  for (const row of byId.values()) {
    const name = names.get(row.id);
    if (name === undefined) continue;
    ctx.lexicon.noteDurableName(row.id, typeof name === "string" ? name : name.s);
    if (row.name !== null) {
      ctx.lexicon.write(row.id, name, row.name);
    } else if (row.leftId !== null && row.rightId !== null) {
      ctx.lexicon.write(row.id, name, [row.leftId, row.rightId]);
    }
  }

  for (const row of byId.values()) {
    const name = names.get(row.id);
    if (name === undefined) continue;
    const record = await composeCardRecord(rowToCardsRow(row), ctx.lexicon);
    await ctx.cacheRecord(record);
    composedRecords.push(record);
    stats.cards += 1;
    stats.typePrimeMemo.add(row.id);
  }
  return composedRecords;
}

async function tryComposeName(
  row: RawRow,
  names: Map<number, DeckoName>,
  ctx: PrefetchContext,
): Promise<DeckoName | undefined> {
  if (row.name !== null) return DeckoName.parse(row.name);
  if (row.leftId === null || row.rightId === null) return undefined;
  const left = await sideName(row.leftId, names, ctx);
  const right = await sideName(row.rightId, names, ctx);
  if (left === undefined || right === undefined) return undefined;
  return DeckoName.parse(`${left.s}+${right.s}`);
}

async function sideName(
  id: number,
  names: Map<number, DeckoName>,
  ctx: PrefetchContext,
): Promise<DeckoName | undefined> {
  const local = names.get(id);
  if (local !== undefined) return local;
  try {
    const viaLexicon = await ctx.lexicon.name(id);
    return viaLexicon !== undefined && viaLexicon.s !== "" ? viaLexicon : undefined;
  } catch {
    return undefined;
  }
}

function rowToCardsRow(row: RawRow): CardsRow {
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    codename: row.codename,
    left_id: row.leftId,
    right_id: row.rightId,
    current_revision_id: row.currentRevisionId,
    created_at: row.createdAt ?? "",
    updated_at: row.updatedAt ?? "",
    creator_id: row.creatorId ?? 0,
    updater_id: 0,
    read_rule_class: row.readRuleClass,
    read_rule_id: row.readRuleId,
    references_expired: null,
    trash: row.trash === 1 ? 1 : 0,
    type_id: row.typeId ?? 0,
    db_content: row.dbContent,
  };
}

export async function composeAndCacheSqlRows(
  rows: CardsRow[],
  ctx: PrefetchContext,
): Promise<CardRecord[]> {
  const byId = new Map<number, CardsRow>();
  for (const row of rows) byId.set(row.id, row);
  await primeComposeTypeInputs(
    ctx,
    rows.map((row) => row.type_id),
    new Set<number>(),
    new Set(byId.keys()),
  );

  const names = new Map<number, DeckoName>();
  let pending = [...byId.values()];
  for (let pass = 0; pass < 64 && pending.length > 0; pass++) {
    const still: CardsRow[] = [];
    for (const row of pending) {
      const composed = await tryComposeSqlRowName(row, names, byId, ctx);
      if (composed !== undefined) names.set(row.id, composed);
      else still.push(row);
    }
    if (still.length === pending.length) break;
    pending = still;
  }

  const composedRecords: CardRecord[] = [];
  for (const row of byId.values()) {
    const name = names.get(row.id);
    if (name === undefined) continue;
    if (row.name !== null && row.name !== undefined) {
      ctx.lexicon.write(row.id, name, row.name);
    } else if (row.left_id !== null && row.left_id !== undefined && row.right_id !== null && row.right_id !== undefined) {
      ctx.lexicon.write(row.id, name, [row.left_id, row.right_id]);
    }
  }

  for (const row of byId.values()) {
    const name = names.get(row.id);
    if (name === undefined) continue;
    ctx.lexicon.noteDurableName(row.id, typeof name === "string" ? name : name.s);
    const record = await composeCardRecord(row, ctx.lexicon);
    await ctx.cacheRecord(record);
    composedRecords.push(record);
  }
  return composedRecords;
}

async function tryComposeSqlRowName(
  row: CardsRow,
  names: Map<number, DeckoName>,
  byId: Map<number, CardsRow>,
  ctx: PrefetchContext,
): Promise<DeckoName | undefined> {
  if (row.name !== null && row.name !== undefined) return DeckoName.parse(row.name);
  if (row.left_id === null || row.left_id === undefined) return undefined;
  if (row.right_id === null || row.right_id === undefined) return undefined;
  const left = await sqlRowSideName(row.left_id, names, byId, ctx);
  if (left === undefined) return undefined;
  const right = await sqlRowSideName(row.right_id, names, byId, ctx);
  if (right === undefined) return undefined;
  return DeckoName.parse(`${left.s}+${right.s}`);
}

async function sqlRowSideName(
  id: number,
  names: Map<number, DeckoName>,
  byId: Map<number, CardsRow>,
  ctx: PrefetchContext,
): Promise<DeckoName | undefined> {
  const local = names.get(id);
  if (local !== undefined) return local;
  if (byId.has(id)) return undefined;
  try {
    const viaLexicon = await ctx.lexicon.name(id);
    return viaLexicon ?? DeckoName.parse("");
  } catch {
    return undefined;
  }
}

async function driveClosure(
  scanRows: RawRow[],
  composed: CardRecord[],
  ctx: PrefetchContext,
  stats: PrefetchStats,
  pool?: NestIndexPool,
): Promise<void> {
  const known = new Set<string>();
  const dead = new Set<string>();
  const knownIds = new Map<string, number>();
  const seedKeys = (records: CardRecord[]): void => {
    for (const record of records) {
      if (record.key !== undefined && record.key !== "" && !record.isNew) {
        known.add(record.key);
        if (record.id !== undefined) knownIds.set(record.key, record.id);
      }
    }
  };
  for (const row of scanRows) {
    if (row.key !== null) known.add(row.key);
  }
  seedKeys(composed);

  let pending = new Set<string>();
  const collect = (rows: RawRow[]): void => {
    for (const row of rows) {
      const content = row.dbContent;
      if (content === null || content === "") continue;
      for (const ref of referencedNames(content)) {
        if (ref.relative) continue;
        let name: DeckoName;
        try {
          name = DeckoName.parse(ref.name);
        } catch (err) {
          if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
            continue;
          }
          throw err;
        }
        if (name.s === "" || known.has(name.key) || dead.has(name.key)) continue;
        pending.add(name.s);
      }
    }
  };
  collect(scanRows);
  const collectFromRecords = (records: CardRecord[]): void => {
    for (const record of records) {
      const content = record.dbContent;
      if (content === undefined || content === "" || content === null) continue;
      if (record.name === undefined || record.name.s === "") continue;
      for (const ref of referencedNames(content)) {
        if (ref.relative) continue;
        let name: DeckoName;
        try {
          name = DeckoName.parse(ref.name).absoluteName(record.name);
        } catch (err) {
          if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
            continue;
          }
          throw err;
        }
        if (name.s === "" || known.has(name.key) || dead.has(name.key)) continue;
        pending.add(name.s);
      }
    }
  };
  collectFromRecords(composed);

  const seenIds = new Set<number>();
  for (const row of scanRows) seenIds.add(row.id);
  let sideIdsToPrime: number[] = [];

  for (let round = 0; round < MAX_CLOSURE_ROUNDS; round++) {
    if (pending.size === 0 && sideIdsToPrime.length === 0) {
      return;
    }
    const simpleKeys: string[] = [];
    const sideKeyPairs: { left: string; right: string; entryKey: string }[] = [];
    const sideIdPairs: { leftId: number; rightId: number; entryKey: string }[] = [];
    for (const nameStr of pending) {
      const name = DeckoName.parse(nameStr);
      if (known.has(name.key)) continue;
      if (dead.has(name.key)) {
        pending.delete(nameStr);
        continue;
      }
      if (!name.isCompound) {
        simpleKeys.push(name.key);
        continue;
      }
      const left = name.leftName;
      const right = name.rightName;
      if (left === undefined || right === undefined) continue;
      if (left.key === "" || right.key === "") {
        dead.add(name.key);
        pending.delete(nameStr);
        continue;
      }
      if (dead.has(left.key) || dead.has(right.key)) {
        dead.add(name.key);
        pending.delete(nameStr);
        continue;
      }
      const leftKnown = known.has(left.key);
      const rightKnown = known.has(right.key);
      if (!left.isCompound && !right.isCompound) {
        sideKeyPairs.push({ left: left.key, right: right.key, entryKey: name.key });
        if (!leftKnown) simpleKeys.push(left.key);
        if (!rightKnown) simpleKeys.push(right.key);
      } else if (leftKnown && rightKnown) {
        const leftId = knownIds.get(left.key);
        const rightId = knownIds.get(right.key);
        if (leftId !== undefined && rightId !== undefined) {
          sideIdPairs.push({ leftId, rightId, entryKey: name.key });
        }
      } else {
        if (!leftKnown && !dead.has(left.key)) pending.add(left.s);
        if (!rightKnown && !dead.has(right.key)) pending.add(right.s);
        if (dead.has(left.key) || dead.has(right.key)) {
          dead.add(name.key);
          pending.delete(nameStr);
        }
      }
    }

    const statements: SQLStatement[] = [];
    const collectors: ((rows: CardsRow[]) => RawRow[])[] = [];
    const fetchableKeys = simpleKeys.filter((key) => key !== "");
    if (fetchableKeys.length > 0) {
      const placeholders = fetchableKeys.map(() => "?").join(", ");
      statements.push({
        sql: `SELECT * FROM cards WHERE "key" COLLATE NOCASE IN (${placeholders}) AND trash = 0`,
        params: fetchableKeys,
      });
      collectors.push((rows) => rows.map(toRawRow));
    }
    if (sideKeyPairs.length > 0) {
      const leftKeys = sideKeyPairs.map((pair) => pair.left).filter((key) => key !== "");
      const rightKeys = sideKeyPairs.map((pair) => pair.right).filter((key) => key !== "");
      if (leftKeys.length > 0 && rightKeys.length > 0) {
        const placeholdersL = leftKeys.map(() => "?").join(", ");
        const placeholdersR = rightKeys.map(() => "?").join(", ");
        statements.push({
          sql:
            `SELECT DISTINCT j.* FROM cards j\n` +
            `  JOIN cards l ON l.id = j.left_id AND l."key" COLLATE NOCASE IN (${placeholdersL})\n` +
            `  JOIN cards r ON r.id = j.right_id AND r."key" COLLATE NOCASE IN (${placeholdersR})\n` +
            ` WHERE j.trash = 0`,
          params: [...leftKeys, ...rightKeys],
        });
        collectors.push((rows) => rows.map(toRawRow));
      }
    }
    if (sideIdPairs.length > 0) {
      const SIDE_ID_PAIRS_PER_STATEMENT = 400;
      for (let start = 0; start < sideIdPairs.length; start += SIDE_ID_PAIRS_PER_STATEMENT) {
        const chunk = sideIdPairs.slice(start, start + SIDE_ID_PAIRS_PER_STATEMENT);
        const tuple = chunk.map(() => `(j.left_id = ? AND j.right_id = ?)`).join(" OR ");
        const params = chunk.flatMap((pair) => [pair.leftId, pair.rightId]);
        statements.push({
          sql: `SELECT j.* FROM cards j WHERE j.trash = 0 AND (${tuple})`,
          params,
        });
        collectors.push((rows) => rows.map(toRawRow));
      }
    }
    let sidePrimeSlot = -1;
    if (sideIdsToPrime.length > 0) {
      const placeholders = sideIdsToPrime.map(() => "?").join(", ");
      statements.push({
        sql: `SELECT * FROM cards WHERE id IN (${placeholders}) AND trash = 0`,
        params: sideIdsToPrime,
      });
      sidePrimeSlot = statements.length - 1;
      collectors.push((rows) => rows.map(toRawRow));
    }

    const closureRows: RawRow[] = [];
    const sideRows: RawRow[] = [];
    const splitResults = (results: SQLQueryResult[]): void => {
      results.forEach((result, i) => {
        const rows = collectors[i]!(result.rows as CardsRow[]);
        if (i === sidePrimeSlot) sideRows.push(...rows);
        else closureRows.push(...rows);
      });
    };
    if (statements.length === 0) {
      return;
    }
    const pooled = pool?.answer({
      simpleKeys: fetchableKeys,
      leftKeys: sideKeyPairs.map((pair) => pair.left).filter((key) => key !== ""),
      rightKeys: sideKeyPairs.map((pair) => pair.right).filter((key) => key !== ""),
      sideIdPairs,
      sideIdsToPrime,
    });
    if (pooled !== undefined) {
      closureRows.push(...pooled.closureRows);
      sideRows.push(...pooled.sideRows);
      stats.indexedRounds += 1;
    } else {
      const batch = await ctx.driver.batch(statements);
      stats.batches += 1;
      stats.statements += statements.length;
      splitResults(batch);
      stats.fallbackRounds += 1;
    }

    if (closureRows.length === 0 && sideRows.length === 0) {
      return;
    }
    const newComposed = await composeAndCache([...sideRows, ...closureRows], ctx, stats);
    seedKeys(newComposed);
    {
      const fetchedKeys = new Set<string>();
      for (const row of [...sideRows, ...closureRows]) {
        if (row.key !== null && row.key !== "") fetchedKeys.add(row.key);
      }
      for (const key of fetchableKeys) {
        if (!fetchedKeys.has(key)) dead.add(key);
      }
      const landedIds = new Set<string>();
      for (const row of [...sideRows, ...closureRows]) {
        if (row.leftId !== null && row.rightId !== null) landedIds.add(`${row.leftId}/${row.rightId}`);
      }
      const concludePair = (leftId: number | undefined, rightId: number | undefined, entryKey: string): void => {
        if (leftId === undefined || rightId === undefined) return;
        if (!landedIds.has(`${leftId}/${rightId}`)) dead.add(entryKey);
      };
      for (const pair of sideIdPairs) {
        concludePair(pair.leftId, pair.rightId, pair.entryKey);
      }
      for (const pair of sideKeyPairs) {
        concludePair(knownIds.get(pair.left), knownIds.get(pair.right), pair.entryKey);
      }
    }
    collect(closureRows);
    {
      const closureIds = new Set(closureRows.map((row) => row.id));
      collectFromRecords(
        newComposed.filter((record) => record.id !== undefined && closureIds.has(record.id)),
      );
    }
    for (const nameStr of [...pending]) {
      let resolvedKey: string;
      try {
        resolvedKey = DeckoName.parse(nameStr).key;
      } catch (err) {
        if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
          pending.delete(nameStr);
          continue;
        }
        throw err;
      }
      if (known.has(resolvedKey)) pending.delete(nameStr);
    }
    for (const row of [...sideRows, ...closureRows]) seenIds.add(row.id);
    sideIdsToPrime = nextSideIds([...sideRows, ...closureRows], seenIds);
  }
}

function nextSideIds(rows: RawRow[], seenIds: Set<number>): number[] {
  const ids: number[] = [];
  for (const row of rows) {
    for (const sideId of [row.leftId, row.rightId]) {
      if (sideId === null || sideId === undefined || seenIds.has(sideId)) continue;
      seenIds.add(sideId);
      ids.push(sideId);
    }
  }
  return ids;
}

export interface WarmupRef {
  name: string;
  context: string;
  mode?: WarmupMode;
}

export type WarmupMode = "leaf" | "nav-item" | "navbar" | "full";
export const WARMUP_MODE_RANK: Record<WarmupMode, number> = { leaf: 0, "nav-item": 1, navbar: 2, full: 3 };

export interface WarmupScan {
  refs: WarmupRef[];
  leaves?: WarmupRef[];
}

export interface WarmupCard {
  key: string;
  id: number | undefined;
  name: DeckoName;
  dbContent: string;
  typeCode: string | undefined;
}

export interface WarmupClosureContext extends PrefetchContext {
  getCard: (key: string) => WarmupCard | undefined;
  scannedKeys?: Set<string>;
  virtualLookup?: (name: string) => Promise<VirtualCardResolution | undefined>;
  prepareFallback: (name: string) => Promise<WarmupCard | undefined>;
  onRound?: () => Promise<void>;
  sidesUnscanned?: boolean;
}

export interface WarmupStats {
  batches: number;
  statements: number;
  rounds: number;
  cards: number;
  fallbacks: number;
}

export async function prefetchWarmupClosure(
  seeds: WarmupRef[],
  ctx: WarmupClosureContext,
  scan: (card: WarmupCard, mode: WarmupMode) => WarmupScan,
): Promise<WarmupStats> {
  const stats: WarmupStats = { batches: 0, statements: 0, rounds: 0, cards: 0, fallbacks: 0 };
  const foldStats: PrefetchStats = {
    batches: 0,
    statements: 0,
    fallbackRounds: 0,
    indexedRounds: 0,
    cards: 0,
    typePrimeMemo: new Set<number>(),
  };

  const checked = new Set<string>();
  const dead = new Set<string>();
  const scanned = new Set<string>();
  const virtualCheckQueue: string[] = [];

  interface Entry {
    abs: string;
  }
  const pending = new Map<string, Entry>();
  const modes = new Map<string, WarmupMode>();
  const scannedAs = new Map<string, WarmupMode>();
  const rank = (m: WarmupMode | undefined): number => WARMUP_MODE_RANK[m ?? "full"];
  const pushRef = (ref: WarmupRef, modeOverride?: WarmupMode): void => {
    const abs = resolveWarmName(ref.name, ref.context);
    if (abs === undefined) return;
    let key: string;
    try {
      key = DeckoName.parse(abs).key;
    } catch {
      return;
    }
    const mode: WarmupMode = modeOverride ?? ref.mode ?? "full";
    const had = modes.get(key);
    if (had === undefined || rank(mode) > rank(had)) {
      modes.set(key, mode);
      const done = scannedAs.get(key);
      if (done !== undefined && rank(mode) > rank(done)) {
        const prepared = ctx.getCard(key);
        if (prepared !== undefined) {
          scannedAs.set(key, mode);
          const found = scan(prepared, mode);
          for (const r of found.refs) pushRef(r);
          for (const r of found.leaves ?? []) pushRef(r, "leaf");
        }
      } else if (done === undefined && had === "leaf" && !pending.has(key) && !dead.has(key)) {
        const prepared = ctx.getCard(key);
        if (prepared !== undefined) {
          scanned.delete(key);
          scanCard(prepared);
          return;
        }
      }
    }
    if (dead.has(key) || pending.has(key)) return;
    pending.set(key, { abs });
  };
  for (const seed of seeds) pushRef(seed);

  const markDead = (key: string): void => {
    const entry = pending.get(key);
    if (entry === undefined) return;
    pending.delete(key);
    dead.add(key);
    virtualCheckQueue.push(entry.abs);
  };

  function scanCard(card: WarmupCard): void {
    if (scanned.has(card.key)) return;
    const mode = modes.get(card.key) ?? "full";
    if (mode === "leaf") return;
    scanned.add(card.key);
    scannedAs.set(card.key, mode);
    if (mode === "full") {
      if (ctx.scannedKeys?.has(card.key)) {
        return;
      }
      ctx.scannedKeys?.add(card.key);
    }
    const found = scan(card, mode);
    for (const ref of found.refs) pushRef(ref);
    for (const ref of found.leaves ?? []) pushRef(ref, "leaf");
  }

  const drainVirtualChecks = async (): Promise<number> => {
    const queue = virtualCheckQueue.splice(0, virtualCheckQueue.length);
    if (ctx.virtualLookup === undefined) return 0;
    let landed = 0;
    for (const abs of queue) {
      let resolution: VirtualCardResolution | undefined;
      try {
        resolution = await ctx.virtualLookup(abs);
      } catch {
        resolution = undefined;
      }
      if (resolution === undefined) continue;
      let name: DeckoName;
      try {
        name = DeckoName.parse(abs);
      } catch {
        continue;
      }
      const record = newCardRecord(name);
      if (resolution.typeId !== undefined && record.typeId === undefined) {
        record.typeId = resolution.typeId;
      }
      record.dbContent = resolution.templateContent;
      await ctx.cacheRecord(record);
      const card = ctx.getCard(name.key);
      if (card !== undefined) {
        scanCard(card);
        landed += 1;
      }
    }
    return landed;
  };

  const capFallbackSweep = async (): Promise<void> => {
    for (const [key, entry] of [...pending]) {
      if (ctx.getCard(key) !== undefined) continue;
      pending.delete(key);
      checked.add(key);
      stats.fallbacks += 1;
      const card = await ctx.prepareFallback(entry.abs);
      if (card !== undefined) scanCard(card);
    }
  };

  const seenSideIds = new Set<number>();
  let sideIdsToPrime: number[] = [];

  while (true) {
    for (const [key] of [...pending]) {
      const card = ctx.getCard(key);
      if (card === undefined) continue;
      pending.delete(key);
      scanCard(card);
    }
    if (pending.size === 0 && virtualCheckQueue.length === 0) break;

    const simpleKeys: string[] = [];
    const sideKeyPairs: { left: string; right: string; entryKey: string }[] = [];
    const sideIdPairs: { leftId: number; rightId: number; entryKey: string }[] = [];
    const deadJunctions: string[] = [];
    for (const [key, entry] of pending) {
      if (checked.has(key)) continue;
      if (ctx.getCard(key) !== undefined) continue;
      let name: DeckoName;
      try {
        name = DeckoName.parse(entry.abs);
      } catch {
        checked.add(key);
        markDead(key);
        continue;
      }
      if (!name.isCompound) {
        simpleKeys.push(name.key);
        checked.add(key);
        continue;
      }
      const left = name.leftName;
      const right = name.rightName;
      if (left === undefined || right === undefined) {
        checked.add(key);
        markDead(key);
        continue;
      }
      if (left.key === "" || right.key === "") {
        checked.add(key);
        markDead(key);
        continue;
      }
      const leftCard = ctx.getCard(left.key);
      const rightCard = ctx.getCard(right.key);
      if (
        leftCard !== undefined &&
        leftCard.id !== undefined &&
        rightCard !== undefined &&
        rightCard.id !== undefined
      ) {
        sideIdPairs.push({ leftId: leftCard.id, rightId: rightCard.id, entryKey: key });
      } else if (
        (leftCard === undefined && dead.has(left.key)) ||
        (rightCard === undefined && dead.has(right.key))
      ) {
        checked.add(key);
        deadJunctions.push(key);
      } else if (!left.isCompound && !right.isCompound) {
        sideKeyPairs.push({ left: left.key, right: right.key, entryKey: key });
        if (
          leftCard === undefined &&
          !checked.has(left.key) &&
          !dead.has(left.key) &&
          !pending.has(left.key)
        ) {
          simpleKeys.push(left.key);
        }
        if (
          rightCard === undefined &&
          !checked.has(right.key) &&
          !dead.has(right.key) &&
          !pending.has(right.key)
        ) {
          simpleKeys.push(right.key);
        }
      } else {
        if (
          leftCard === undefined &&
          !left.isCompound &&
          !checked.has(left.key) &&
          !dead.has(left.key) &&
          !pending.has(left.key)
        ) {
          simpleKeys.push(left.key);
        }
        if (
          rightCard === undefined &&
          !right.isCompound &&
          !checked.has(right.key) &&
          !dead.has(right.key) &&
          !pending.has(right.key)
        ) {
          simpleKeys.push(right.key);
        }
        if (
          leftCard === undefined &&
          left.isCompound &&
          !checked.has(left.key) &&
          !dead.has(left.key) &&
          !pending.has(left.key)
        ) {
          pending.set(left.key, { abs: left.s });
          if (ctx.sidesUnscanned === true && !modes.has(left.key)) modes.set(left.key, "leaf");
        }
        if (
          rightCard === undefined &&
          right.isCompound &&
          !checked.has(right.key) &&
          !dead.has(right.key) &&
          !pending.has(right.key)
        ) {
          pending.set(right.key, { abs: right.s });
          if (ctx.sidesUnscanned === true && !modes.has(right.key)) modes.set(right.key, "leaf");
        }
      }
    }
    for (const key of deadJunctions) markDead(key);

    const statements: SQLStatement[] = [];
    const collectors: ((rows: CardsRow[]) => void)[] = [];
    const closureRows: RawRow[] = [];
    const sideRows: RawRow[] = [];
    const sidePairKeys: string[][] = [];
    for (const group of chunkParams(simpleKeys.filter((key) => key !== ""), WARMUP_CHUNK)) {
      const placeholders = group.map(() => "?").join(", ");
      statements.push({
        sql: 'SELECT * FROM cards WHERE "key" COLLATE NOCASE IN (' + placeholders + ") AND trash = 0",
        params: group,
      });
      collectors.push((rows) => {
        closureRows.push(...rows.map(toRawRow));
      });
    }
    for (const group of chunkParams(sideKeyPairs, WARMUP_CHUNK / 2)) {
      const leftKeys = group.map((pair) => pair.left).filter((key) => key !== "");
      const rightKeys = group.map((pair) => pair.right).filter((key) => key !== "");
      if (leftKeys.length === 0 || rightKeys.length === 0) continue;
      const placeholdersL = leftKeys.map(() => "?").join(", ");
      const placeholdersR = rightKeys.map(() => "?").join(", ");
      statements.push({
        sql:
          "SELECT DISTINCT j.* FROM cards j\n" +
          '  JOIN cards l ON l.id = j.left_id AND l."key" COLLATE NOCASE IN (' + placeholdersL + ")\n" +
          '  JOIN cards r ON r.id = j.right_id AND r."key" COLLATE NOCASE IN (' + placeholdersR + ")\n" +
          " WHERE j.trash = 0",
        params: [...leftKeys, ...rightKeys],
      });
      sidePairKeys.push(group.map((pair) => pair.entryKey));
      collectors.push((rows) => {
        closureRows.push(...rows.map(toRawRow));
      });
    }
    for (const group of chunkParams(sideIdPairs, WARMUP_CHUNK / 2)) {
      const tuple = group.map(() => "(j.left_id = ? AND j.right_id = ?)").join(" OR ");
      const params = group.flatMap((pair) => [pair.leftId, pair.rightId]);
      statements.push({
        sql: "SELECT j.* FROM cards j WHERE j.trash = 0 AND (" + tuple + ")",
        params,
      });
      sidePairKeys.push(group.map((pair) => pair.entryKey));
      collectors.push((rows) => {
        closureRows.push(...rows.map(toRawRow));
      });
    }
    for (const group of chunkParams(sideIdsToPrime, WARMUP_CHUNK)) {
      const placeholders = group.map(() => "?").join(", ");
      statements.push({
        sql: "SELECT * FROM cards WHERE id IN (" + placeholders + ") AND trash = 0",
        params: group,
      });
      collectors.push((rows) => {
        sideRows.push(...rows.map(toRawRow));
      });
    }

    if (statements.length === 0) {
      const landed = await drainVirtualChecks();
      if (landed === 0) {
        let preparedPending = false;
        for (const key of pending.keys()) {
          if (ctx.getCard(key) !== undefined) {
            preparedPending = true;
            break;
          }
        }
        if (!preparedPending) break;
        continue;
      }
      continue;
    }

    if (stats.rounds >= MAX_WARMUP_ROUNDS) {
      await drainVirtualChecks();
      await capFallbackSweep();
      continue;
    }

    if (ctx.onRound !== undefined) await ctx.onRound();
    const batch = await ctx.driver.batch(statements);
    stats.batches += 1;
    stats.statements += statements.length;
    stats.rounds += 1;
    batch.forEach((result, i) => {
      collectors[i]?.(result.rows as CardsRow[]);
    });
    collectors.length = 0;

    await composeAndCache([...sideRows, ...closureRows], ctx, foldStats);
    for (const keys of sidePairKeys) {
      for (const key of keys) {
        if (ctx.getCard(key) === undefined) markDead(key);
      }
    }
    for (const key of simpleKeys) {
      if (ctx.getCard(key) === undefined) {
        dead.add(key);
        pending.delete(key);
      }
    }
    sideIdsToPrime = [];
    for (const row of [...sideRows, ...closureRows]) {
      seenSideIds.add(row.id);
      for (const sideId of [row.leftId, row.rightId]) {
        if (sideId === null || seenSideIds.has(sideId)) continue;
        seenSideIds.add(sideId);
        sideIdsToPrime.push(sideId);
      }
    }
    await drainVirtualChecks();
  }

  stats.cards = foldStats.cards;
  return stats;
}


function resolveWarmName(raw: string, context: string): string | undefined {
  try {
    const parsed = DeckoName.parse(raw);
    return parsed.isAbsolute ? parsed.s : parsed.absoluteName(DeckoName.parse(context)).s;
  } catch {
    return undefined;
  }
}
