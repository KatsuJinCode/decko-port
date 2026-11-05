

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LocalSqliteDriver } from "../../../src/server/drivers/local-sqlite.js";
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../../src/server/driver.js";
import type { CardsRow } from "../../../src/server/schema.js";
import { FetchEngine } from "../../../src/card/fetch.js";
import { RenderEngine } from "../../../src/card/render.js";
import { DeckoName } from "../../../src/card/name.js";

export function splitSqlStatements(ddl: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < ddl.length; i++) {
    const ch = ddl[i];
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "-" && ddl[i + 1] === "-") {
      while (i < ddl.length && ddl[i] !== "\n") i++;
      current += " ";
      continue;
    }
    if (ch === ";") {
      statements.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") statements.push(current.trim());
  return statements.filter((statement) => statement !== "");
}

export interface CountSnapshot {

  statements: number;

  roundTrips: number;
}

export class CountingRenderDriver implements SQLDatabaseDriver {
  private counts: CountSnapshot = { statements: 0, roundTrips: 0 };
  readonly statements: string[] = [];

  constructor(private readonly inner: SQLDatabaseDriver) {}

  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    this.counts = { statements: this.counts.statements + 1, roundTrips: this.counts.roundTrips + 1 };
    this.statements.push(sql);
    return this.inner.query<T>(sql, params);
  }

  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {

    this.counts = {
      statements: this.counts.statements + statements.length,
      roundTrips: this.counts.roundTrips + 1,
    };
    for (const statement of statements) this.statements.push(statement.sql);
    return this.inner.batch(statements);
  }

  snapshot(): CountSnapshot {
    return { ...this.counts };
  }

  reset(): void {
    this.counts = { statements: 0, roundTrips: 0 };
    this.statements.length = 0;
  }
}

export interface RenderTestStorage {
  engine: RenderEngine;
  fetcher: FetchEngine;
  counting: CountingRenderDriver;
  close(): void;
}

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

export async function createRenderTestStorage(): Promise<RenderTestStorage> {
  const driver = new LocalSqliteDriver({ path: ":memory:" });
  const ddl = readFileSync(`${REPO_ROOT}db/schema.sqlite.sql`, "utf8");
  for (const statement of splitSqlStatements(ddl)) {
    await driver.query(statement, []);
  }
  const counting = new CountingRenderDriver(driver);
  const fetcher = new FetchEngine(counting);
  return { engine: new RenderEngine(fetcher), fetcher, counting, close: () => driver.close() };
}

const DEFAULT_TYPE_ID = 2;

export interface SeedOptions {
  id?: number;

  name?: string;
  key?: string;
  codename?: string | null;
  leftId?: number;
  rightId?: number;
  typeId?: number;

  typeName?: string;
  dbContent?: string | null;
  trash?: boolean;

  readRuleId?: number | null;

  readRuleClass?: string | null;

  createdAt?: string;

  creatorId?: number;

  currentRevisionId?: number;
}

export async function seedCard(
  storage: RenderTestStorage,
  opts: SeedOptions,
): Promise<void> {
  const hasName = typeof opts.name === "string" && opts.name.length > 0;
  const isCompound = hasName && opts.name!.includes("+");
  const nameColumn = isCompound ? null : (opts.name ?? null);
  const keyColumn = hasName
    ? (opts.key ?? DeckoName.parse(opts.name as string).key)
    : null;
  await storage.counting.query(
    `INSERT INTO cards
       (id, name, key, codename, left_id, right_id, current_revision_id,
        created_at, updated_at, creator_id, updater_id, read_rule_class,
        read_rule_id, references_expired, trash, type_id, db_content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id ?? null,
      nameColumn,
      keyColumn,
      opts.codename ?? null,
      opts.leftId ?? null,
      opts.rightId ?? null,
      opts.currentRevisionId ?? null,

      opts.createdAt ?? "2026-09-19 00:00:00.000",
      "2026-09-19 00:00:00.000",

      opts.creatorId ?? 1,
      1,
      opts.readRuleClass ?? null,
      opts.readRuleId ?? null,
      null,
      opts.trash === true ? 1 : 0,
      opts.typeId ?? DEFAULT_TYPE_ID,
      opts.dbContent ?? null,
    ],
  );
}

export async function seedReference(
  storage: RenderTestStorage,
  refererId: number,
  refereeId: number | null,
  refereeKey: string | null,
  refType = "L",
): Promise<void> {
  await storage.counting.query(
    `INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present)
     VALUES (?, ?, ?, ?, NULL)`,
    [refererId, refereeKey, refereeId, refType],
  );
}

export type { CardsRow };
