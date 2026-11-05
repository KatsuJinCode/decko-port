

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

const PERMISSION_CODENAMES = ["anyone", "anyone_signed_in", "anonymous", "read", "set"];

export interface ShardLine {
  id: number;
  name: string;
  views?: Record<string, string>;

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

export async function createCorpusSeededStorage(ids: Set<number>): Promise<RenderTestStorage> {
  const storage = await createRenderTestStorage();
  const corpus = new Database(CORPUS_DB, { readonly: true });

  const readId = (
    corpus.prepare(`SELECT id FROM cards WHERE codename = 'read' AND trash = 0`).get() as
      { id: number } | undefined
  )?.id;
  if (readId === undefined) throw new Error("seeded deck has no *read card");

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

  for (const codename of PERMISSION_CODENAMES) {
    const row = corpus
      .prepare(`SELECT id FROM cards WHERE codename = ? AND trash = 0`)
      .get(codename) as { id: number } | undefined;
    if (row !== undefined) ids.add(row.id);
  }
  for (const rule of ruleRows) ids.add(rule.id);
  for (const id of setCardIds) ids.add(id);

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
