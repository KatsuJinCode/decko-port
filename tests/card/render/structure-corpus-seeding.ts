

import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  createCorpusSeededStorage,
  readShardLines,
  CORPUS_DB,
  type ShardLine,
} from "./permission-corpus-seeding.js";
import { seedCard, type RenderTestStorage } from "./render-test-storage.js";
import { DeckoName } from "../../../src/card/name.js";
import {
  structureRuleUniverseStatement,
  structureUniverseFromResults,
  structureRuleTypesFromResults,
} from "../../../src/card/rules/structure.js";
import { createVirtualCardLookup } from "../../../src/card/fetch/virtual-cards.js";

export { CORPUS_DB, readShardLines };
export type { ShardLine };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
export const SHARD_PATH = path.join(REPO_ROOT, "fixtures", "corpus", "shard-000000.jsonl");

const RULE_PREDICATE_CODENAMES = ["setting", "set", "user"];

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

export function structureTemplateContents(): Set<string> {
  const corpus = new Database(CORPUS_DB, { readonly: true });
  const rows = corpus
    .prepare(
      "SELECT content FROM cards WHERE trash = 0 AND content IS NOT NULL " +
        "AND name LIKE '%+*structure'"
    )
    .all() as Array<{ content: string }>;
  corpus.close();
  return new Set(rows.map((r) => r.content));
}

export async function createStructureSeededStorage(): Promise<RenderTestStorage> {
  return createStructureSeededStorageFor(new Set(readShardLines().map((l) => l.id)));
}

export async function createStructureSeededStorageFor(
  ids: Set<number>,
): Promise<RenderTestStorage> {
  const storage = await createCorpusSeededStorage(ids);
  const corpus = new Database(CORPUS_DB, { readonly: true });

  const structureCardId = (
    corpus.prepare(`SELECT id FROM cards WHERE name = '*structure' AND trash = 0`).get() as
      { id: number } | undefined
  )?.id;
  if (structureCardId === undefined) throw new Error("seeded deck has no *structure card");

  const ruleRows = corpus
    .prepare(`SELECT ${CORPUS_ROW_COLUMNS} FROM cards WHERE right_id = ? AND trash = 0`)
    .all(structureCardId) as CorpusRow[];
  const enrichIds = new Set<number>();
  for (const rule of ruleRows) {
    enrichIds.add(rule.id);
    if (rule.left_id !== null) enrichIds.add(rule.left_id);
  }

  for (const codename of RULE_PREDICATE_CODENAMES) {
    const row = corpus
      .prepare(`SELECT id FROM cards WHERE codename = ? AND trash = 0`)
      .get(codename) as { id: number } | undefined;
    if (row !== undefined) enrichIds.add(row.id);
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
          enrichIds.add(row.id);
        }
      }
    }
  };
  fetchRows([...enrichIds]);

  const closeClosure = (): void => {
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
  };
  closeClosure();

  const refNames = new Set<string>();
  for (const rule of ruleRows) {
    if (rule.content === null || rule.content === "") continue;
    const spans = rule.content.match(/\{\{([^{}]*)\}\}/g) ?? [];
    for (const span of spans) {
      const beforeOptions = span.slice(2, -2).split("|")[0] ?? "";
      const name = beforeOptions.trim();
      if (name === "" || name.startsWith("_")) continue;
      refNames.add(name);
    }
  }
  for (const name of refNames) {
    const row = (
      corpus
        .prepare(`SELECT ${CORPUS_ROW_COLUMNS} FROM cards WHERE name = ? AND trash = 0`)
        .get(name) as CorpusRow | undefined
    ) ??
      (corpus
        .prepare(`SELECT ${CORPUS_ROW_COLUMNS} FROM cards WHERE "key" = ? AND trash = 0`)
        .get(DeckoName.parse(name).key) as CorpusRow | undefined);
    if (row !== undefined && !rows.has(row.id)) {
      rows.set(row.id, row);
      ids.add(row.id);
    }
  }
  closeClosure();
  corpus.close();

  const existing = new Set<number>();
  {
    const idList = [...rows.keys()];
    for (let i = 0; i < idList.length; i += 500) {
      const chunk = idList.slice(i, i + 500);
      const found = storage.fetcher.driver.query<{ id: number }>(
        `SELECT id FROM cards WHERE id IN (${chunk.map(() => "?").join(",")})`,
        chunk,
      );
      for (const row of (await found).rows) existing.add(row.id);
    }
  }
  for (const row of rows.values()) {
    if (existing.has(row.id)) continue;
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

  {
    const result = await storage.fetcher.driver.batch([structureRuleUniverseStatement()]);
    const universe = structureUniverseFromResults(result[0]);
    const ruleTypes = structureRuleTypesFromResults(result[0]);
    storage.fetcher.virtualCardLookup = createVirtualCardLookup(storage.fetcher, {
      contents: universe,
      ruleTypeIds: ruleTypes,
    });
  }
  return storage;
}
