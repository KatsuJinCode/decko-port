import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../server/driver.js";
import type { CardsRow } from "../../server/schema.js";
import { DbLexicon } from "../fetch/lexicon.js";
import { CardCache } from "../fetch/cache.js";
import { DeckoName } from "../name.js";

type IdentityNode = Pick<CardsRow, "id" | "name" | "key" | "left_id" | "right_id" | "trash"> & {
  point_pair_id: number | null;
};
const rowIdentityEvidence = new WeakMap<CardsRow, Map<number, IdentityNode>>();

export async function readCompositionBatch(
  driver: SQLDatabaseDriver,
  statements: SQLStatement[],
): Promise<SQLQueryResult[]> {
  const results = await driver.batch(statements.map(statement => ({
    params: statement.params,
    sql: `WITH RECURSIVE composition_rows AS (${statement.sql}),
      identity_reach(root_id, id) AS (
        SELECT id, id FROM composition_rows
        UNION
        SELECT reach.root_id, child.id FROM identity_reach reach
          JOIN cards parent ON parent.id = reach.id
          JOIN cards child ON child.id = parent.left_id OR child.id = parent.right_id
      )
      SELECT source.*, evidence.id AS identity_node_id,
        evidence.name AS identity_node_name, evidence."key" AS identity_node_key,
        evidence.left_id AS identity_node_left, evidence.right_id AS identity_node_right,
        evidence.trash AS identity_node_trash,
        (SELECT id FROM cards WHERE left_id = evidence.left_id
          AND right_id = evidence.right_id AND trash = 0 ORDER BY id LIMIT 1) AS identity_pair_id
      FROM composition_rows source
      JOIN identity_reach reach ON reach.root_id = source.id
      JOIN cards evidence ON evidence.id = reach.id`,
  })));
  if (results.length !== statements.length) throw new Error("composition identity batch returned incomplete results");
  return results.map(result => {
    const rows = new Map<number, CardsRow>();
    for (const raw of result.rows as Array<CardsRow & Record<string, unknown>>) {
      const {identity_node_id, identity_node_name, identity_node_key,
        identity_node_left, identity_node_right, identity_node_trash, identity_pair_id, ...source} = raw;
      let row = rows.get(raw.id);
      if (row === undefined) {
        row = source as unknown as CardsRow;
        rows.set(row.id, row);
        rowIdentityEvidence.set(row, new Map());
      }
      rowIdentityEvidence.get(row)!.set(identity_node_id as number, {
        id: identity_node_id as number, name: identity_node_name as string | null,
        key: identity_node_key as string | null, left_id: identity_node_left as number | null,
        right_id: identity_node_right as number | null, trash: identity_node_trash as CardsRow["trash"],
        point_pair_id: identity_pair_id as number | null,
      });
    }
    return {...result, rows: [...rows.values()]};
  });
}

function canonicalSimpleName(row: Pick<CardsRow, "trash" | "left_id" | "right_id" | "name" | "key">): DeckoName | undefined {
  if (row.trash !== 0 || row.left_id !== null || row.right_id !== null || row.name === null) return undefined;
  const name = DeckoName.parse(row.name);
  return name.isSimple && name.s !== "" && !name.isRelativeFragment && row.key === name.key ? name : undefined;
}

function provedCompositionName(row: CardsRow): DeckoName | null | undefined {
  const evidence = rowIdentityEvidence.get(row);
  if (evidence === undefined) return undefined;
  const visiting = new Set<number>();
  const names = new Map<number, DeckoName | null | undefined>();
  const visit = (id: number): DeckoName | null | undefined => {
    if (names.has(id)) return names.get(id);
    if (visiting.has(id)) return null;
    const node = evidence.get(id);
    if (node === undefined || node.trash !== 0) return null;
    const simple = canonicalSimpleName(node);
    if (simple !== undefined) { names.set(id, simple); return simple; }
    if (node.left_id === null || node.right_id === null) return undefined;
    if (node.point_pair_id !== id) return null;
    visiting.add(id);
    const left = visit(node.left_id);
    const right = visit(node.right_id);
    visiting.delete(id);
    if (left === null || right === null) { names.set(id, null); return null; }
    let name: DeckoName | undefined;
    if (left !== undefined && right !== undefined) {
      const composed = DeckoName.parse(`${left.s}+${right.s}`);
      if (!composed.isRelativeFragment && composed.leftName?.key === left.key && composed.rightName?.key === right.key) name = composed;
    }
    names.set(id, name);
    return name;
  };
  return visit(row.id);
}

export async function rowsMatchingPointIdentity(
  driver: SQLDatabaseDriver,
  rows: readonly CardsRow[],
  options: { storedKeyFallback?: boolean } = {},
): Promise<CardsRow[]> {
  if (rows.length === 0) return [];
  const simple = rows.filter(row => canonicalSimpleName(row) !== undefined);
  const admittedIds = new Set(simple.map(row => row.id));
  const pending: CardsRow[] = [];
  for (const row of rows) {
    if (admittedIds.has(row.id)) continue;
    const proof = provedCompositionName(row);
    if (proof === undefined) pending.push(row);
    else if (proof !== null) admittedIds.add(row.id);
  }
  if (pending.length === 0) return rows.filter(row => admittedIds.has(row.id));
  const composer = new DbLexicon(driver, new CardCache());
  for (const row of rows) composer.noteIdToLexRow(row);
  const names = await composer.names(pending.map(row => row.id));
  const reader = new DbLexicon(driver, new CardCache());
  reader.storedKeyFallback = options.storedKeyFallback ?? false;
  reader.primeIdsByKey(simple.map(row => ({key: row.key!, id: row.id})));
  const requested = [...names.values()].filter(name => name !== undefined);
  await reader.prefetchIds(requested);
  for (const row of pending) {
    const name = names.get(row.id);
    if (name !== undefined && await reader.id(name) === row.id) admittedIds.add(row.id);
  }
  return rows.filter(row => admittedIds.has(row.id));
}

export function waveKeysStatement(keys: readonly string[]): SQLStatement {
  const placeholders = keys.map(() => "?").join(", ");
  return {
    sql: `SELECT * FROM cards WHERE "key" IN (${placeholders}) AND trash = 0`,
    params: [...keys],
  };
}

export function waveJunctionStatement(
  leftKeys: readonly string[],
  rightKeys: readonly string[],
): SQLStatement {
  const placeholdersL = leftKeys.map(() => "?").join(", ");
  const placeholdersR = rightKeys.map(() => "?").join(", ");
  return {
    sql:
      `SELECT DISTINCT j.* FROM cards j\n` +
      `  JOIN cards l ON l.id = j.left_id AND l."key" IN (${placeholdersL}) AND l.trash = 0\n` +
      `  JOIN cards r ON r.id = j.right_id AND r."key" IN (${placeholdersR}) AND r.trash = 0\n` +
      ` WHERE j.trash = 0`,
    params: [...leftKeys, ...rightKeys],
  };
}

export function isCompoundRow(row: CardsRow): boolean {
  return (
    row.left_id !== null &&
    row.left_id !== undefined &&
    row.right_id !== null &&
    row.right_id !== undefined
  );
}
