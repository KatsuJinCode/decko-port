// Unit coverage for the driver-layer transport-chunking primitive
// (src/server/chunked-row-reads.ts): whole-set reads ride chunked IN-list
// statements grouped into batch round trips so a many-row page render stays
// inside the edge per-invocation subrequest cap WITHOUT changing result
// bytes. These tests pin the three contract axes:
//   1. TRANSPORT: statement count = ceil(unique/IDS_PER_STATEMENT), driver
//      calls = ceil(statements/STATEMENTS_PER_BATCH) — the subrequest math.
//   2. IDENTITY: returned rows equal the rows the per-id point-read ladder
//      (SELECT * ... WHERE id = ? AND trash = 0) returns, in first-
//      occurrence input-id order.
//   3. LADDER PARITY: trashed and absent ids yield no row (the point read's
//      `trash = 0` + `LIMIT 1` answering undefined).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CHUNKED_READ_IDS_PER_STATEMENT,
  CHUNKED_READ_STATEMENTS_PER_BATCH,
  chunkIds,
  readCardRowsByIdChunked,
} from "../../src/server/chunked-row-reads.js";
import { LocalSqliteDriver } from "../../src/server/drivers/local-sqlite.js";
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../src/server/driver.js";
import type { CardsRow } from "../../src/server/schema.js";
import { splitSqlStatements } from "../card/render/render-test-storage.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Counting wrapper over LocalSqliteDriver: records every statement and
 *  every driver call (a batch = ONE call — the subrequest axis). */
class CountingDriver implements SQLDatabaseDriver {
  queries = 0;
  batches = 0;
  readonly batchSizes: number[] = [];
  constructor(private readonly inner: LocalSqliteDriver) {}
  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    this.queries += 1;
    return this.inner.query<T>(sql, params);
  }
  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    this.batches += 1;
    this.batchSizes.push(statements.length);
    return this.inner.batch(statements);
  }
}

async function createStorage(): Promise<{ raw: LocalSqliteDriver; counting: CountingDriver }> {
  const raw = new LocalSqliteDriver({ path: ":memory:" });
  const ddl = readFileSync(`${REPO_ROOT}db/schema.sqlite.sql`, "utf8");
  for (const statement of splitSqlStatements(ddl)) {
    await raw.query(statement, []);
  }
  return { raw, counting: new CountingDriver(raw) };
}

let nextId = 1000;
async function seedRow(
  raw: LocalSqliteDriver,
  overrides: Partial<Pick<CardsRow, "id" | "name" | "key" | "trash" | "type_id" | "db_content" | "updater_id">> = {},
): Promise<CardsRow> {
  const row: CardsRow = {
    id: overrides.id ?? nextId++,
    name: overrides.name ?? `chunk row ${overrides.id ?? nextId - 1}`,
    key: overrides.key ?? null,
    codename: null,
    left_id: null,
    right_id: null,
    current_revision_id: null,
    created_at: "2026-09-27 00:00:00.000",
    updated_at: "2026-09-27 00:00:00.000",
    creator_id: 1,
    updater_id: overrides.updater_id ?? 7,
    read_rule_class: null,
    read_rule_id: null,
    references_expired: null,
    trash: overrides.trash ?? 0,
    type_id: overrides.type_id ?? 2,
    db_content: overrides.db_content ?? null,
  };
  await raw.query(
    `INSERT INTO cards
       (id, name, key, codename, left_id, right_id, current_revision_id,
        created_at, updated_at, creator_id, updater_id, read_rule_class,
        read_rule_id, references_expired, trash, type_id, db_content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.name,
      row.key,
      row.codename,
      row.left_id,
      row.right_id,
      row.current_revision_id,
      row.created_at,
      row.updated_at,
      row.creator_id,
      row.updater_id,
      row.read_rule_class,
      row.read_rule_id,
      row.references_expired,
      row.trash,
      row.type_id,
      row.db_content,
    ],
  );
  return row;
}

/** The per-id point-read ladder the chunked read must be value-identical to
 *  (the fetch layer's retrieveFromDb shape: trash = 0, one row). */
async function pointReadLadder(
  raw: LocalSqliteDriver,
  id: number,
): Promise<CardsRow | undefined> {
  const result = await raw.query<CardsRow>(
    `SELECT * FROM cards WHERE id = ? AND trash = 0 LIMIT 1`,
    [id],
  );
  return result.rows[0];
}

describe("chunkIds (the grouping unit)", () => {
  it("splits into fixed-size chunks with a partial tail", () => {
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkIds([], 50)).toEqual([]);
    expect(chunkIds([1], 50)).toEqual([[1]]);
    expect(chunkIds([1, 2], 2)).toEqual([[1, 2]]);
  });
});

describe("readCardRowsByIdChunked", () => {
  it("issues zero queries for an empty id list", async () => {
    const { raw, counting } = await createStorage();
    try {
      const rows = await readCardRowsByIdChunked(counting, []);
      expect(rows).toEqual([]);
      expect(counting.queries).toBe(0);
      expect(counting.batches).toBe(0);
    } finally {
      raw.close();
    }
  });

  it("returns rows value-identical to the point-read ladder, in input order", async () => {
    const { raw, counting } = await createStorage();
    try {
      // Seeded OUT of order on purpose: input order, not id order, is the
      // contract (the caller walks its own result order).
      const seeded = [
        await seedRow(raw, { id: 305, name: "c", key: "c", db_content: "third" }),
        await seedRow(raw, { id: 301, name: "a", key: "a", db_content: "first" }),
        await seedRow(raw, { id: 303, name: "b", key: "b", db_content: "second" }),
      ];
      const rows = await readCardRowsByIdChunked(counting, [305, 301, 303]);
      expect(rows.map((r) => r.id)).toEqual([305, 301, 303]);
      for (let i = 0; i < seeded.length; i++) {
        const viaLadder = await pointReadLadder(raw, rows[i]!.id);
        expect(rows[i]).toEqual(viaLadder); // full SELECT * value identity
      }
    } finally {
      raw.close();
    }
  });

  it("dedups the input to one row per id (first occurrence wins)", async () => {
    const { raw, counting } = await createStorage();
    try {
      const row = await seedRow(raw, { id: 401, name: "once", key: "once" });
      const rows = await readCardRowsByIdChunked(counting, [401, 401, 401]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(await pointReadLadder(raw, row.id));
      expect(counting.batches).toBe(1);
      expect(counting.batchSizes[0]).toBe(1); // ONE statement, not three
    } finally {
      raw.close();
    }
  });

  it("drops trashed and absent ids (the point read answering undefined)", async () => {
    const { raw, counting } = await createStorage();
    try {
      const live = await seedRow(raw, { id: 501, name: "live", key: "live" });
      await seedRow(raw, { id: 502, name: "trashed", key: "trashed", trash: 1 });
      const rows = await readCardRowsByIdChunked(counting, [501, 502, 9999]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(await pointReadLadder(raw, live.id));
    } finally {
      raw.close();
    }
  });

  it("chunks 50 ids per statement and groups 20 statements per batch call", async () => {
    const { raw, counting } = await createStorage();
    try {
      // 205 ids: statements = ceil(205/50) = 5 (4 full + 1 partial of 5);
      // batch calls = ceil(5/20) = 1. The subrequest math the lane exists
      // for: 205 logical reads -> 1 round trip.
      const ids: number[] = [];
      for (let i = 0; i < 205; i++) {
        const row = await seedRow(raw, { name: `bulk ${i}`, key: `bulk_${i}` });
        ids.push(row.id);
      }
      const rows = await readCardRowsByIdChunked(counting, ids);
      expect(rows).toHaveLength(205);
      expect(counting.queries).toBe(0); // everything rode batches
      expect(counting.batches).toBe(1);
      expect(counting.batchSizes[0]).toBe(Math.ceil(205 / CHUNKED_READ_IDS_PER_STATEMENT));
      // returned in input order
      expect(rows.map((r) => r.id)).toEqual(ids);
    } finally {
      raw.close();
    }
  });

  it("splits oversized statement lists across multiple batch calls", async () => {
    const { raw, counting } = await createStorage();
    try {
      // 45 statements needed -> batches of 20 -> 3 batch calls (the
      // statements-per-subrequest grouping axis).
      const statementCount = 2 * CHUNKED_READ_STATEMENTS_PER_BATCH + 5;
      const ids: number[] = [];
      for (let i = 0; i < statementCount * CHUNKED_READ_IDS_PER_STATEMENT; i++) {
        // Only the ids of the FIRST chunk of each statement need rows; the
        // missing ones simply answer no row.
        if (i < CHUNKED_READ_IDS_PER_STATEMENT) {
          const row = await seedRow(raw, { name: `present ${i}`, key: `present_${i}` });
          ids.push(row.id);
        } else {
          ids.push(900000 + i);
        }
      }
      const rows = await readCardRowsByIdChunked(counting, ids);
      expect(rows).toHaveLength(CHUNKED_READ_IDS_PER_STATEMENT);
      expect(counting.batches).toBe(3);
      expect(counting.batchSizes).toEqual([
        CHUNKED_READ_STATEMENTS_PER_BATCH,
        CHUNKED_READ_STATEMENTS_PER_BATCH,
        5,
      ]);
    } finally {
      raw.close();
    }
  });
});
