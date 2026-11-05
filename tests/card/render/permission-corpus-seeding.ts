// Shared seeding for the read-permission corpus replay: the shard's rows
// WITH their stored read_rule_id / read_rule_class columns plus the FULL
// read-rule universe (every *read rule card, its set card, the rules'
// card_references party grants, and the codename cards the party math
// resolves) and the transitive side/type closure junction composition
// needs. This is the seed enrichment the corpus replay flip
// (permissionPending -> JUDGED) requires; see docs/permissions-port-notes.md.

import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "./render-test-storage.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
export const CORPUS_DB = path.join(REPO_ROOT, "benchmarks", "corpus-v2", "bench-corpus-v2.sqlite3");
export const SHARD_PATH = path.join(REPO_ROOT, "fixtures", "corpus", "shard-000000.jsonl");

/** The codename cards the permission state resolution reads. */
const PERMISSION_CODENAMES = ["anyone", "anyone_signed_in", "anonymous", "read", "set"];

export interface ShardLine {
  id: number;
  name: string;
  views?: Record<string, string>;
  /** The captured card record (the corpus JSONL's `record` payload); the
   *  structure-template replay (structure-corpus-replay.test.ts) reads
   *  `.content` for its classification predicate. */
  record?: { content: string };
}

interface CorpusRow {
  id: number;
  name: string | null;
  codename: string | null;
  left_id: number | null;
  right_id: number | null;
  trash: number;
  type_id: number;
  content: string | null;
  read_rule_id: number | null;
  read_rule_class: string | null;
}

const CORPUS_ROW_COLUMNS =
  `id, name, codename, left_id, right_id, trash, type_id, content, ` +
  `read_rule_id, read_rule_class`;

export async function createPermissionSeededStorage(): Promise<RenderTestStorage> {
  return createCorpusSeededStorage(new Set(readShardLines().map((l) => l.id)));
}

/**
 * The permission seeding for an ARBITRARY id set — the corpus replay
 * driver's entry point (it seeds the union of every shard's ids so
 * cross-shard nest targets resolve). Same enrichment as the single-shard
 * path: the rows' stored read_rule_id / read_rule_class columns, the full
 * read-rule universe, the rules' card_references party grants, the
 * permission codename cards, and the transitive side/type closure.
 */
export async function createCorpusSeededStorage(ids: Set<number>): Promise<RenderTestStorage> {
  const storage = await createRenderTestStorage();
  const corpus = new Database(CORPUS_DB, { readonly: true });

  const readId = (
    corpus.prepare(`SELECT id FROM cards WHERE codename = 'read' AND trash = 0`).get() as
      { id: number } | undefined
  )?.id;
  if (readId === undefined) throw new Error("corpus deck has no *read card");

  // Rule universe: every live *read rule card + the set card it hangs on.
  const ruleRows = corpus
    .prepare(`SELECT ${CORPUS_ROW_COLUMNS} FROM cards WHERE right_id = ? AND trash = 0`)
    .all(readId) as CorpusRow[];
  const setCardIds = [...new Set(ruleRows.map((r) => r.left_id).filter((x): x is number => x !== null))];
  const refs = corpus
    .prepare(
      `SELECT referer_id, referee_id, referee_key FROM card_references WHERE referer_id IN ` +
        `(${ruleRows.map(() => "?").join(",")})`
    )
    .all(...ruleRows.map((r) => r.id)) as Array<{
    referer_id: number;
    referee_id: number | null;
    referee_key: string | null;
  }>;

  // Seed ids: caller's ids + codename cards + rule cards + their set cards,
  // then the transitive side/type closure to fixpoint.
  for (const codename of PERMISSION_CODENAMES) {
    const row = corpus
      .prepare(`SELECT id FROM cards WHERE codename = ? AND trash = 0`)
      .get(codename) as { id: number } | undefined;
    if (row !== undefined) ids.add(row.id);
  }
  for (const rule of ruleRows) ids.add(rule.id);
  for (const id of setCardIds) ids.add(id);
  // SET-card child-card grant walk (deep-read-rule / read-rule-grant-vs-deny
  // closure gap fix, 2026-09-25). For every *read rule, resolve its SET card
  // (left_id), then walk the SET card's CHILD cards (left_id = set_card.id).
  // Each child's card_references name the GRANT PARTIES that setting rule
  // grants (e.g. `*all+*create` -> AnyoneSignedIn, `*all+*delete` ->
  // Administrator, `*all+*read` -> Anyone). Ruby's permissions.rb#read_rule?
  // walks the SET card's rule children via Card.where(matches_rule) and
  // unions the grants; the previous closure walked only refs FROM the *read
  // rule cards (ruleRows), missing the grants named by the SET's other
  // setting children. Chunked at 500 to stay under
  // SQLITE_MAX_VARIABLE_NUMBER (default 999).
  const childCardIds: number[] = [];
  const childRefs: Array<{
    referer_id: number;
    referee_id: number | null;
    referee_key: string | null;
  }> = [];
  if (setCardIds.length > 0) {
    for (let i = 0; i < setCardIds.length; i += 500) {
      const chunk = setCardIds.slice(i, i + 500);
      const children = corpus
        .prepare(
          `SELECT id FROM cards WHERE left_id IN (${chunk
            .map(() => "?")
            .join(",")}) AND trash = 0`,
        )
        .all(...chunk) as Array<{ id: number }>;
      for (const c of children) childCardIds.push(c.id);
    }
    if (childCardIds.length > 0) {
      for (let i = 0; i < childCardIds.length; i += 500) {
        const chunk = childCardIds.slice(i, i + 500);
        const batch = corpus
          .prepare(
            `SELECT DISTINCT referer_id, referee_id, referee_key FROM card_references ` +
              `WHERE referer_id IN (${chunk.map(() => "?").join(",")}) ` +
              `AND referee_id IS NOT NULL`,
          )
          .all(...chunk) as Array<{
          referer_id: number;
          referee_id: number | null;
          referee_key: string | null;
        }>;
        for (const r of batch) childRefs.push(r);
      }
      for (const c of childCardIds) ids.add(c);
      for (const r of childRefs) {
        if (r.referee_id !== null) ids.add(r.referee_id);
      }
    }
  }

  const rows = new Map<number, CorpusRow>();
  const fetchRows = (idList: number[]): void => {
    for (let i = 0; i < idList.length; i += 500) {
      const chunk = idList.slice(i, i + 500);
      const fetched = corpus
        .prepare(
          `SELECT ${CORPUS_ROW_COLUMNS} FROM cards WHERE id IN (${chunk.map(() => "?").join(",")})`
        )
        .all(...chunk) as CorpusRow[];
      for (const row of fetched) {
        if (!rows.has(row.id)) {
          rows.set(row.id, row);
          ids.add(row.id);
        }
      }
    }
  };
  fetchRows([...ids]);
  for (let round = 0; round < 40; round++) {
    const need: number[] = [];
    for (const row of rows.values()) {
      for (const side of [row.left_id, row.right_id]) {
        if (side !== null && !rows.has(side)) need.push(side);
      }
      if (row.type_id !== null && !rows.has(row.type_id)) need.push(row.type_id);
    }
    if (need.length === 0) break;
    fetchRows(need);
  }
  corpus.close();

  for (const row of rows.values()) {
    await seedCard(storage, {
      id: row.id,
      name: row.name ?? undefined,
      codename: row.codename,
      leftId: row.left_id ?? undefined,
      rightId: row.right_id ?? undefined,
      trash: row.trash === 1,
      typeId: row.type_id,
      dbContent: row.content,
      readRuleId: row.read_rule_id,
      readRuleClass: row.read_rule_class,
    });
  }
  for (const ref of refs) {
    await seedReference(storage, ref.referer_id, ref.referee_id, ref.referee_key);
  }
  // SET-card child-card grant walk follow-up: seed the child-card references
  // captured above (childRefs + childCardIds were collected at the same point
  // as setCardIds were expanded). Same persist path as the rules-as-referers
  // loop above.
  for (const ref of childRefs) {
    await seedReference(storage, ref.referer_id, ref.referee_id, ref.referee_key);
  }
  return storage;
}

export function readShardLines(): ShardLine[] {
  return readFileSync2(SHARD_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as ShardLine);
}

import { readFileSync as readFileSync2 } from "node:fs";
