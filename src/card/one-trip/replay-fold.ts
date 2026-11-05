import type { SQLStatement } from "../../server/driver.js";
import type { RenderPlanEntry } from "./render-plan.js";
import { envValue } from "../debug-flags.js";

export const FOLD_TAG_COLUMN = "__fold_g";
export const FOLD_NAMESPACE = "__fold_";
export const FOLD_LEFT_KEY_COLUMN = "__fold_lk";
export const FOLD_RIGHT_KEY_COLUMN = "__fold_rk";
export const FOLD_POS_COLUMN = "__fold_p";

export const FOLD_CHUNK_GROUPS = 512;

export function replayFoldWantsMerge(): boolean {
  return envValue("DECKO_REPLAY_FOLD") !== "0";
}

interface FoldGroup {
  entryIndexes: number[];
  binds: unknown[][];
}

export interface FoldShape {
  family: string;
  nested: boolean;
  match(sql: string, params: unknown[]): boolean;
  build(binds: unknown[], ordinal: boolean): string;
}

function allStringsLowercase(values: unknown[]): boolean {
  for (const v of values) {
    if (typeof v !== "string") return false;
    if (v !== v.toLowerCase()) return false;
  }
  return true;
}

function allNumbers(values: unknown[]): boolean {
  for (const v of values) if (typeof v !== "number" || !Number.isFinite(v)) return false;
  return true;
}

const CARD_COLUMNS =
  'c.id, c.name, c."key", c.codename, c.left_id, c.right_id, c.current_revision_id, c.created_at, c.updated_at, c.creator_id, c.updater_id, c.read_rule_class, c.read_rule_id, c.references_expired, c.trash, c.type_id, c.db_content';

function cardProjection(alias: string): string {
  return CARD_COLUMNS.split(", ")
    .map((c) => c.replace(/^c\./, `${alias}.`))
    .join(", ");
}

function minIdGuard(alias: string, groupExpr: string, where: string): string {
  return `${alias}.id = (SELECT MIN(m.id) FROM cards m WHERE ${where})`;
}

const KEY_MULTI_RE =
  /^SELECT \* FROM cards WHERE (?:"key" COLLATE NOCASE|key) IN \([^)]*\) AND trash = 0$/;
const ID_MULTI_RE = /^SELECT \* FROM cards WHERE id IN \([^)]*\) AND trash = 0$/;
const KEY_POINT_RE = /^SELECT \* FROM cards WHERE key = \? AND trash = 0 LIMIT 1$/;
const ID_POINT_RE = /^SELECT \* FROM cards WHERE id = \?( AND trash = 0)?( LIMIT 1)?$/;
const PAIR_EXISTS_RE =
  /^SELECT id FROM cards WHERE left_id = \? AND right_id = \? AND trash = 0 LIMIT 1$/;
const TEMPLATE_LINK_RE = /^SELECT id, db_content FROM cards WHERE id IN \([^)]*\)$/;
const LEXICON_ID_RE = /^SELECT name, left_id, right_id FROM cards WHERE id = \? LIMIT 1$/;
const LEXICON_KEY_RE = /^SELECT id FROM cards WHERE key = \? AND trash = 0 LIMIT 1$/;
const OR_PAIR_HEAD = "SELECT j.* FROM cards j WHERE j.trash = 0 AND ((j.left_id = ? AND j.right_id = ?)";
const OR_PAIR_TERM = "(j.left_id = ? AND j.right_id = ?)";
function isOrPairShape(sql: string, params: unknown[]): boolean {
  if (params.length % 2 !== 0 || params.length === 0 || !allNumbers(params)) return false;
  const terms = params.length / 2;
  if (terms === 2) return false;
  let expected = OR_PAIR_HEAD;
  for (let i = 0; i < terms - 1; i++) expected += ` OR ${OR_PAIR_TERM}`;
  return `${expected})` === sql;
}
const SIDE_KEY_RE =
  /^SELECT\s+DISTINCT\s+j\.\*\s+FROM\s+cards\s+j\s+JOIN\s+cards\s+l\s+ON\s+l\.id\s*=\s*j\.left_id\s+AND\s+l\."key"\s+COLLATE\s+NOCASE\s+IN\s*\([^)]*\)\s+JOIN\s+cards\s+r\s+ON\s+r\.id\s*=\s*j\.right_id\s+AND\s+r\."key"\s+COLLATE\s+NOCASE\s+IN\s*\([^)]*\)\s+WHERE\s+j\.trash\s*=\s*0$/;
const CLOSURE_JSON_RE =
  /^SELECT\s+json_object\(\s*'id',\s*c\.id,[\s\S]*?\)\s+AS\s+card_json\s+FROM\s+\(SELECT\s+DISTINCT\s+co\.\*\s+FROM\s+cards\s+co\s+JOIN\s+\(SELECT\s+value\s+AS\s+id\s+FROM\s+json_each\(\?\)\)\s+m\s+ON\s+m\.id\s*=\s*co\.id\)\s+c\s+ORDER\s+BY\s+c\.id$/;

const CLOSURE_JSON_PROJECTION =
  "json_object('id', c.id, 'name', c.name, 'key', c.\"key\", 'codename', c.codename, 'left_id', c.left_id, 'right_id', c.right_id, 'current_revision_id', c.current_revision_id, 'created_at', c.created_at, 'updated_at', c.updated_at, 'creator_id', c.creator_id, 'updater_id', c.updater_id, 'read_rule_class', c.read_rule_class, 'read_rule_id', c.read_rule_id, 'references_expired', c.references_expired, 'trash', c.trash, 'type_id', c.type_id, 'db_content', c.db_content)";

export const FOLD_SHAPES: readonly FoldShape[] = [
  {
    family: "closure-json-id-list",
    nested: true,
    match: (sql, params) =>
      CLOSURE_JSON_RE.test(sql.trim()) &&
      params.length === 1 &&
      typeof params[0] === "string" &&
      Array.isArray(safeJsonArray(params[0])),
    build: () =>
      `SELECT c.${FOLD_TAG_COLUMN} AS ${FOLD_TAG_COLUMN}, ${CLOSURE_JSON_PROJECTION} AS card_json ` +
      `FROM (SELECT DISTINCT g.key AS ${FOLD_TAG_COLUMN}, co.* FROM json_each(?) AS g ` +
      `JOIN json_each(g.value) AS m JOIN cards co ON co.id = m.value) AS c ` +
      `ORDER BY ${FOLD_TAG_COLUMN}, c.id`,
  },
  {
    family: "cards-key-multi",
    nested: true,
    match: (sql, params) =>
      KEY_MULTI_RE.test(sql.trim()) &&
      params.length > 0 &&
      params.length !== 2 &&
      allStringsLowercase(params),
    build: () =>
      `SELECT src.${FOLD_TAG_COLUMN} AS ${FOLD_TAG_COLUMN}, ${cardProjection("c")} ` +
      `FROM (SELECT DISTINCT g.key AS ${FOLD_TAG_COLUMN}, k.value AS kv ` +
      `FROM json_each(?) AS g CROSS JOIN json_each(g.value) AS k) AS src ` +
      `CROSS JOIN cards c ON c."key" = src.kv WHERE c.trash = 0 ` +
      `ORDER BY ${FOLD_TAG_COLUMN}, c.id`,
  },
  {
    family: "cards-id-multi",
    nested: true,
    match: (sql, params) =>
      ID_MULTI_RE.test(sql.trim()) &&
      params.length > 0 &&
      params.length !== 2 &&
      allNumbers(params),
    build: () =>
      `SELECT src.${FOLD_TAG_COLUMN} AS ${FOLD_TAG_COLUMN}, ${cardProjection("c")} ` +
      `FROM (SELECT DISTINCT g.key AS ${FOLD_TAG_COLUMN}, k.value AS kv ` +
      `FROM json_each(?) AS g CROSS JOIN json_each(g.value) AS k) AS src ` +
      `CROSS JOIN cards c ON c.id = src.kv WHERE c.trash = 0 ` +
      `ORDER BY ${FOLD_TAG_COLUMN}, c.id`,
  },
  {
    family: "cards-key-point",
    nested: true,
    match: (sql, params) =>
      KEY_POINT_RE.test(sql.trim()) && params.length === 1 && allStringsLowercase(params),
    build: () =>
      `SELECT g.key AS ${FOLD_TAG_COLUMN}, ${cardProjection("c")} ` +
      `FROM json_each(?) AS g CROSS JOIN json_each(g.value) AS k CROSS JOIN cards c ` +
      `ON c."key" = k.value AND c.trash = 0 ORDER BY ${FOLD_TAG_COLUMN}`,
  },
  {
    family: "cards-id-point",
    nested: true,
    match: (sql, params) =>
      ID_POINT_RE.test(sql.trim()) && params.length === 1 && allNumbers(params),
    build: () =>
      `SELECT g.key AS ${FOLD_TAG_COLUMN}, ${cardProjection("c")} ` +
      `FROM json_each(?) AS g CROSS JOIN json_each(g.value) AS k CROSS JOIN cards c ` +
      `ON c.id = k.value ORDER BY ${FOLD_TAG_COLUMN}`,
  },
  {
    family: "pair-exists",
    nested: true,
    match: (sql, params) =>
      PAIR_EXISTS_RE.test(sql.trim()) && params.length === 2 && allNumbers(params),
    build: () =>
      `SELECT g.key AS ${FOLD_TAG_COLUMN}, c.id AS id ` +
      `FROM json_each(?) AS g ` +
      `CROSS JOIN json_each(g.value) AS l ` +
      `CROSS JOIN json_each(g.value) AS r ON r.key = l.key + 1 ` +
      `CROSS JOIN cards c ON c.left_id = l.value AND c.right_id = r.value ` +
      `WHERE l.key % 2 = 0 AND c.trash = 0 ORDER BY ${FOLD_TAG_COLUMN}`,
  },
  {
    family: "or-chain-pairs",
    nested: true,
    match: (sql, params) => isOrPairShape(sql.trim(), params),
    build: () =>
      `SELECT g.key AS ${FOLD_TAG_COLUMN}, ${cardProjection("j")} ` +
      `FROM json_each(?) AS g ` +
      `CROSS JOIN json_each(g.value) AS l ` +
      `CROSS JOIN json_each(g.value) AS r ON r.key = l.key + 1 ` +
      `CROSS JOIN cards j ON j.left_id = l.value AND j.right_id = r.value ` +
      `WHERE l.key % 2 = 0 AND j.trash = 0 ORDER BY ${FOLD_TAG_COLUMN}, j.id`,
  },
  {
    family: "template-link-ids",
    nested: true,
    match: (sql, params) =>
      TEMPLATE_LINK_RE.test(sql.trim()) &&
      params.length > 0 &&
      params.length !== 2 &&
      allNumbers(params),
    build: () =>
      `SELECT src.${FOLD_TAG_COLUMN} AS ${FOLD_TAG_COLUMN}, c.id AS id, c.db_content AS db_content ` +
      `FROM (SELECT DISTINCT g.key AS ${FOLD_TAG_COLUMN}, k.value AS kv ` +
      `FROM json_each(?) AS g CROSS JOIN json_each(g.value) AS k) AS src ` +
      `CROSS JOIN cards c ON c.id = src.kv ORDER BY ${FOLD_TAG_COLUMN}, c.id`,
  },
  {
    family: "lexicon-id-to-name",
    nested: true,
    match: (sql, params) =>
      LEXICON_ID_RE.test(sql.trim()) && params.length === 1 && allNumbers(params),
    build: () =>
      `SELECT g.key AS ${FOLD_TAG_COLUMN}, c.name AS name, c.left_id AS left_id, c.right_id AS right_id ` +
      `FROM json_each(?) AS g CROSS JOIN json_each(g.value) AS k CROSS JOIN cards c ` +
      `ON c.id = k.value ORDER BY ${FOLD_TAG_COLUMN}`,
  },
  {
    family: "lexicon-key-to-id",
    nested: true,
    match: (sql, params) =>
      LEXICON_KEY_RE.test(sql.trim()) && params.length === 1 && allStringsLowercase(params),
    build: () =>
      `SELECT g.key AS ${FOLD_TAG_COLUMN}, c.id AS id ` +
      `FROM json_each(?) AS g CROSS JOIN json_each(g.value) AS k CROSS JOIN cards c ` +
      `ON c."key" = k.value AND c.trash = 0 ORDER BY ${FOLD_TAG_COLUMN}`,
  },
  {
    family: "side-key-join",
    nested: true,
    match: (sql, params) =>
      SIDE_KEY_RE.test(sql.trim()) &&
      params.length >= 6 &&
      params.length % 2 === 0 &&
      allStringsLowercase(params),
    build: () =>
      `SELECT DISTINCT g.key AS ${FOLD_TAG_COLUMN}, l.value AS ${FOLD_LEFT_KEY_COLUMN}, r.value AS ${FOLD_RIGHT_KEY_COLUMN}, ${cardProjection("j")} ` +
      `FROM json_each(?) AS g ` +
      `CROSS JOIN json_each(g.value) AS l ` +
      `CROSS JOIN json_each(g.value) AS r ` +
      `CROSS JOIN cards cl ON cl."key" = l.value ` +
      `CROSS JOIN cards cr ON cr."key" = r.value ` +
      `CROSS JOIN cards j ON j.left_id = cl.id AND j.right_id = cr.id ` +
      `WHERE l.key < json_array_length(g.value) / 2 AND r.key >= json_array_length(g.value) / 2 AND j.trash = 0 ` +
      `ORDER BY ${FOLD_TAG_COLUMN}, j.id`,
  },
];

export interface MergedSlice {
  statementIndex: number;
  family: string;
  entryIndexes: number[];
  tagToEntry: number[];
  hasPos: boolean;
  distinctById?: boolean;
}

export interface UnfoldedSlice {
  statementIndex: number;
  entryIndex: number;
}

export interface FoldedPlan {
  statements: SQLStatement[];
  merged: MergedSlice[];
  unfolded: UnfoldedSlice[];
  families: Record<string, number>;
  unfoldedFamilies: Record<string, number>;
  entryCount: number;
}

function safeJsonArray(text: unknown): unknown[] | undefined {
  if (typeof text !== "string") return undefined;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as unknown[]) : undefined;
  } catch {
    return undefined;
  }
}

function groupBindsFor(shape: FoldShape, entry: RenderPlanEntry): unknown[] | undefined {
  const params = entry.params;
  if (shape.family === "closure-json-id-list") return safeJsonArray(params[0]);
  if (shape.family === "side-key-join") {
    return [...params];
  }
  if (shape.family === "or-chain-pairs" || shape.family === "pair-exists") return [...params];
  return [...params];
}

export function foldRenderPlanEntries(entries: readonly RenderPlanEntry[]): FoldedPlan {
  const shapes = new Map<FoldShape, FoldGroup>();
  const entryShape = new Map<number, FoldShape>();
  const unfoldedFamilies: Record<string, number> = {};

  entries.forEach((entry, entryIndex) => {
    const sql = entry.sql.trim();
    let matched: FoldShape | undefined;
    for (const shape of FOLD_SHAPES) {
      if (shape.match(sql, entry.params)) {
        matched = shape;
        break;
      }
    }
    const binds = matched === undefined ? undefined : groupBindsFor(matched, entry);
    if (matched === undefined || binds === undefined) {
      const bucket = sql.slice(0, 60).replace(/\s+/g, " ");
      unfoldedFamilies[bucket] = (unfoldedFamilies[bucket] ?? 0) + 1;
      return;
    }
    entryShape.set(entryIndex, matched);
    let group = shapes.get(matched);
    if (group === undefined) {
      group = { entryIndexes: [], binds: [] };
      shapes.set(matched, group);
    }
    group.entryIndexes.push(entryIndex);
    group.binds.push(binds);
  });

  const statements: SQLStatement[] = [];
  const merged: MergedSlice[] = [];
  const unfolded: UnfoldedSlice[] = [];
  const families: Record<string, number> = {};

  for (const [shape, group] of shapes) {
    families[shape.family] = group.entryIndexes.length;
    const hasPos = false;
    for (let start = 0; start < group.entryIndexes.length; start += FOLD_CHUNK_GROUPS) {
      const chunkIndexes = group.entryIndexes.slice(start, start + FOLD_CHUNK_GROUPS);
      const chunkBinds = group.binds.slice(start, start + FOLD_CHUNK_GROUPS);
      const tagToEntry: number[] = [];
      const bound = shape.nested ? chunkBinds : chunkBinds.flat();
      if (!shape.nested) {
        chunkBinds.forEach((binds, k) => {
          for (let i = 0; i < binds.length; i++) tagToEntry.push(chunkIndexes[k] as number);
        });
      }
      statements.push({
        sql: shape.build(bound, hasPos),
        params: [JSON.stringify(bound)],
      });
      merged.push({
        statementIndex: statements.length - 1,
        family: shape.family,
        entryIndexes: chunkIndexes,
        tagToEntry: shape.nested ? chunkIndexes : tagToEntry,
        hasPos,
        distinctById: shape.family === "side-key-join",
      });
    }
  }
  entries.forEach((entry, entryIndex) => {
    if (entryShape.has(entryIndex)) return;
    unfolded.push({ statementIndex: statements.length, entryIndex });
    statements.push({ sql: entry.sql, params: entry.params });
  });

  return { statements, merged, unfolded, families, unfoldedFamilies, entryCount: entries.length };
}

export function decomposeMergedRows(
  slice: MergedSlice,
  result: { rows?: unknown[] } | undefined,
): Map<number, unknown[]> {
  const perEntry = new Map<number, unknown[]>();
  for (const entryIndex of slice.entryIndexes) perEntry.set(entryIndex, []);
  const seenIds = slice.distinctById ? new Map<number, Set<unknown>>() : undefined;
  for (const raw of result?.rows ?? []) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const tag = row[FOLD_TAG_COLUMN];
    if (typeof tag !== "number") continue;
    const entryIndex = slice.tagToEntry[tag];
    if (entryIndex === undefined) continue;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k.startsWith(FOLD_NAMESPACE)) continue;
      out[k] = v;
    }
    if (seenIds !== undefined) {
      let ids = seenIds.get(entryIndex);
      if (ids === undefined) {
        ids = new Set<unknown>();
        seenIds.set(entryIndex, ids);
      }
      if (ids.has(out.id)) continue;
      ids.add(out.id);
    }
    perEntry.get(entryIndex)?.push(out);
  }
  return perEntry;
}

export type DriftServeClass =
  | "key-point"
  | "key-multi"
  | "side-key"
  | "or-chain"
  | "pair-exists"
  | "id-point"
  | "template-link";

export function classifyDriftServeClass(sql: string, params: unknown[]): DriftServeClass | undefined {
  const t = sql.trim();
  if (KEY_POINT_RE.test(t) && params.length === 1 && allStringsLowercase(params)) return "key-point";
  if (KEY_MULTI_RE.test(t) && params.length > 0 && params.length !== 2 && allStringsLowercase(params)) {
    return "key-multi";
  }
  if (
    SIDE_KEY_RE.test(t) &&
    params.length >= 2 &&
    params.length % 2 === 0 &&
    allStringsLowercase(params)
  ) {
    return "side-key";
  }
  if (isOrPairShape(t, params)) return "or-chain";
  if (PAIR_EXISTS_RE.test(t) && params.length === 2 && allNumbers(params)) return "pair-exists";
  if (ID_POINT_RE.test(t) && params.length === 1 && allNumbers(params)) return "id-point";
  if (TEMPLATE_LINK_RE.test(t) && params.length > 0 && allNumbers(params)) return "template-link";
  return undefined;
}

export interface SideKeyArmEntry {
  entryIndex: number;
  lKeys: Set<string>;
  rKeys: Set<string>;
  rows: { row: Record<string, unknown>; lk: string; rk: string }[];
}

export interface DriftArmIndex {
  keyPoint: Map<string, Record<string, unknown>[]>;
  keyMulti: Map<string, Record<string, unknown>[]>;
  keyMultiAskedEmpty: Set<string>;
  pairExists: Map<string, Record<string, unknown>[]>;
  orChain: Map<string, Record<string, unknown>[]>;
  orChainAskedEmpty: Set<string>;
  idPoint: Map<string, Record<string, unknown>[]>;
  idPointAskedEmpty: Set<string>;
  templateLink: Map<string, Record<string, unknown>[]>;
  templateLinkAskedEmpty: Set<string>;
  sideKeyEntries: SideKeyArmEntry[];
}

function emptyDriftArmIndex(): DriftArmIndex {
  return {
    keyPoint: new Map(),
    keyMulti: new Map(),
    keyMultiAskedEmpty: new Set(),
    pairExists: new Map(),
    orChain: new Map(),
    orChainAskedEmpty: new Set(),
    idPoint: new Map(),
    idPointAskedEmpty: new Set(),
    templateLink: new Map(),
    templateLinkAskedEmpty: new Set(),
    sideKeyEntries: [],
  };
}

type Row = Record<string, unknown>;

function pushDistinct(map: Map<string, Row[]>, key: string, rows: Row[]): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, [...rows]);
    return;
  }
  const ids = new Set(existing.map((r) => r.id));
  for (const row of rows) if (!ids.has(row.id)) existing.push(row);
}

export function buildDriftArmIndex(
  entries: readonly RenderPlanEntry[],
  results: readonly unknown[],
): DriftArmIndex {
  const index = emptyDriftArmIndex();
  entries.forEach((entry, i) => {
    const cls = classifyDriftServeClass(entry.sql, entry.params);
    if (cls === undefined || cls === "side-key") return;
    const result = results[i] as { rows?: unknown[] } | undefined;
    const rows = (result?.rows ?? []).filter(
      (r): r is Row => typeof r === "object" && r !== null,
    );
    if (cls === "key-point") {
      index.keyPoint.set(String(entry.params[0]), rows);
    } else if (cls === "key-multi") {
      for (const row of rows) {
        const key = row["key"];
        if (typeof key === "string") pushDistinct(index.keyMulti, key, [row]);
      }
      for (const bind of entry.params) {
        const key = String(bind);
        if (!index.keyMulti.has(key)) index.keyMultiAskedEmpty.add(key);
      }
    } else if (cls === "pair-exists") {
      index.pairExists.set(`${String(entry.params[0])},${String(entry.params[1])}`, rows);
    } else if (cls === "or-chain") {
      const pairs: string[] = [];
      for (let p = 0; p < entry.params.length; p += 2) {
        pairs.push(`${String(entry.params[p])},${String(entry.params[p + 1])}`);
      }
      for (const row of rows) {
        const pk = `${String(row["left_id"])},${String(row["right_id"])}`;
        if (pairs.includes(pk)) pushDistinct(index.orChain, pk, [row]);
      }
      for (const pk of pairs) if (!index.orChain.has(pk)) index.orChainAskedEmpty.add(pk);
    } else if (cls === "id-point") {
      index.idPoint.set(String(entry.params[0]), rows);
    } else if (cls === "template-link") {
      for (const row of rows) pushDistinct(index.templateLink, String(row["id"]), [row]);
      for (const bind of entry.params) {
        const id = String(bind);
        if (!index.templateLink.has(id)) index.templateLinkAskedEmpty.add(id);
      }
    }
  });
  return index;
}

export function absorbSideKeyArmRows(
  index: DriftArmIndex,
  entries: readonly RenderPlanEntry[],
  folded: FoldedPlan,
  mergedResults: readonly unknown[],
): void {
  for (const slice of folded.merged) {
    if (slice.family !== "side-key-join") continue;
    const result = mergedResults[slice.statementIndex] as { rows?: unknown[] } | undefined;
    const byEntry = new Map<number, SideKeyArmEntry>();
    for (const raw of result?.rows ?? []) {
      if (typeof raw !== "object" || raw === null) continue;
      const row = raw as Row;
      const tag = row[FOLD_TAG_COLUMN];
      if (typeof tag !== "number") continue;
      const entryIndex = slice.tagToEntry[tag];
      if (entryIndex === undefined) continue;
      const lk = row[FOLD_LEFT_KEY_COLUMN];
      const rk = row[FOLD_RIGHT_KEY_COLUMN];
      if (typeof lk !== "string" || typeof rk !== "string") continue;
      const out: Row = {};
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith(FOLD_NAMESPACE)) continue;
        out[k] = v;
      }
      let armEntry = byEntry.get(entryIndex);
      if (armEntry === undefined) {
        const binds = entries[entryIndex]?.params ?? [];
        const half = binds.length / 2;
        armEntry = {
          entryIndex,
          lKeys: new Set(binds.slice(0, half).map(String)),
          rKeys: new Set(binds.slice(half).map(String)),
          rows: [],
        };
        byEntry.set(entryIndex, armEntry);
      }
      if (armEntry.rows.some((c) => c.row.id === out.id)) continue;
      armEntry.rows.push({ row: out, lk, rk });
    }
    index.sideKeyEntries.push(...byEntry.values());
  }
}

export function mergeDriftArmIndex(target: DriftArmIndex, incoming: DriftArmIndex): DriftArmIndex {
  for (const [k, v] of incoming.keyPoint) target.keyPoint.set(k, v);
  for (const [k, v] of incoming.keyMulti) pushDistinct(target.keyMulti, k, v);
  for (const k of incoming.keyMultiAskedEmpty) target.keyMultiAskedEmpty.add(k);
  for (const [k, v] of incoming.pairExists) target.pairExists.set(k, v);
  for (const [k, v] of incoming.orChain) pushDistinct(target.orChain, k, v);
  for (const k of incoming.orChainAskedEmpty) target.orChainAskedEmpty.add(k);
  for (const [k, v] of incoming.idPoint) target.idPoint.set(k, v);
  for (const k of incoming.idPointAskedEmpty) target.idPointAskedEmpty.add(k);
  for (const [k, v] of incoming.templateLink) pushDistinct(target.templateLink, k, v);
  for (const k of incoming.templateLinkAskedEmpty) target.templateLinkAskedEmpty.add(k);
  const seen = new Set(target.sideKeyEntries.map((e) => e.entryIndex));
  for (const e of incoming.sideKeyEntries) if (!seen.has(e.entryIndex)) target.sideKeyEntries.push(e);
  return target;
}

function composeIdOrdered(map: Map<string, Row[]>, keys: iterableOfStrings): Row[] | undefined {
  void map;
  void keys;
  return undefined;
}
type iterableOfStrings = Iterable<string>;

export function serveFromDriftArmIndex(
  index: DriftArmIndex,
  sql: string,
  params: unknown[],
): { rows: Row[] } | undefined {
  const cls = classifyDriftServeClass(sql, params);
  if (cls === undefined) return undefined;
  if (cls === "key-point") {
    const key = String(params[0]);
    const rows = index.keyPoint.get(key);
    if (rows !== undefined) return { rows };
    const multi = index.keyMulti.get(key);
    if (multi !== undefined && multi.length > 0) return { rows: [multi[0]!] };
    return undefined;
  }
  if (cls === "key-multi") {
    const keys = [...new Set(params.map(String))];
    for (const key of keys) {
      if (!index.keyMulti.has(key) && !index.keyMultiAskedEmpty.has(key)) return undefined;
    }
    const byId = new Map<unknown, Row>();
    for (const key of keys) {
      for (const row of index.keyMulti.get(key) ?? []) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }
    return { rows: [...byId.values()].sort((a, b) => (a.id as number) - (b.id as number)) };
  }
  if (cls === "or-chain") {
    const pairs: string[] = [];
    for (let p = 0; p < params.length; p += 2) {
      const pk = `${String(params[p])},${String(params[p + 1])}`;
      if (!pairs.includes(pk)) pairs.push(pk);
    }
    for (const pk of pairs) {
      if (!index.orChain.has(pk) && !index.orChainAskedEmpty.has(pk)) return undefined;
    }
    const byId = new Map<unknown, Row>();
    for (const pk of pairs) {
      for (const row of index.orChain.get(pk) ?? []) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }
    return { rows: [...byId.values()].sort((a, b) => (a.id as number) - (b.id as number)) };
  }
  if (cls === "side-key") {
    const half = params.length / 2;
    const lKeys = new Set(params.slice(0, half).map(String));
    const rKeys = new Set(params.slice(half).map(String));
    const entry = index.sideKeyEntries.find(
      (e) =>
        [...lKeys].every((k) => e.lKeys.has(k)) && [...rKeys].every((k) => e.rKeys.has(k)),
    );
    if (entry === undefined) return undefined;
    const byId = new Map<unknown, Row>();
    for (const combo of entry.rows) {
      if (!lKeys.has(combo.lk) || !rKeys.has(combo.rk)) continue;
      if (!byId.has(combo.row.id)) byId.set(combo.row.id, combo.row);
    }
    return { rows: [...byId.values()].sort((a, b) => (a.id as number) - (b.id as number)) };
  }
  if (cls === "pair-exists") {
    const rows = index.pairExists.get(`${String(params[0])},${String(params[1])}`);
    return rows !== undefined ? { rows } : undefined;
  }
  if (cls === "id-point") {
    const id = String(params[0]);
    const rows = index.idPoint.get(id);
    if (rows !== undefined) return { rows };
    if (index.idPointAskedEmpty.has(id)) return { rows: [] };
    return undefined;
  }
  const ids = [...new Set(params.map(String))];
  for (const id of ids) {
    if (!index.templateLink.has(id) && !index.templateLinkAskedEmpty.has(id)) return undefined;
  }
  const byId = new Map<unknown, Row>();
  for (const id of ids) {
    for (const row of index.templateLink.get(id) ?? []) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
  }
  return { rows: [...byId.values()].sort((a, b) => (a.id as number) - (b.id as number)) };
}