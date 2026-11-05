// Test storage for the render-engine tests: an in-memory better-sqlite3
// database (the REAL LocalSqliteDriver) loaded with db/schema.sqlite.sql,
// plus a counting driver that measures BOTH count axes the #1282 claim is
// judged on:
//   - statements: individual SQL statements (a batch's statements count one
//     each)
//   - roundTrips: driver calls (driver.batch = ONE round trip - on the edge
//     drivers, e.g. D1, that is literally one HTTP request; this is the
//     axis the constant-queries promise is about)
// Lives INSIDE tests/card/render per the stream boundaries; seeded cards are
// written DIRECTLY as rows because the write path is another stream.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LocalSqliteDriver } from "../../../src/server/drivers/local-sqlite.js";
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../../src/server/driver.js";
import type { CardsRow } from "../../../src/server/schema.js";
import { FetchEngine } from "../../../src/card/fetch.js";
import { RenderEngine } from "../../../src/card/render.js";
import { DeckoName } from "../../../src/card/name.js";

/** Quote-aware `--` comment stripping + ";" split (the DDL carries no
 *  ";" inside literals - same splitter contract as the fetch stream's
 *  storage; see tests/card/fetch/fetch-test-storage.ts for the rationale). */
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
  /** SQL statements issued (batch statements count one each). */
  statements: number;
  /** Driver calls: query() + batch() each count ONE round trip. */
  roundTrips: number;
}

/** The render-stream counting wrapper: tracks statements AND round trips. */
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
    // ONE round trip, N statements.
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

/** Fresh in-memory database + FetchEngine + RenderEngine over the counting
 *  driver. */
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
  /** Junction rows carry their corpus name/key too (see seedCard) — the
   *  corpus v2 dump stores them; only callers seeding a bare junction by
   *  sides alone omit the name. */
  name?: string;
  key?: string;
  codename?: string | null;
  leftId?: number;
  rightId?: number;
  typeId?: number;
  /** The type name (string), separate from typeId. Used by the *type
   *  pattern's `pattern_applies?` check. */
  typeName?: string;
  dbContent?: string | null;
  trash?: boolean;
  /** cards.read_rule_id — the DATA side of the read rule (Ruby derives it
   *  on save via the set_read_rule store event, card-mod-permissions
   *  set/all/permissions.rb:1-5; the read-permission stream reads it at
   *  render time). Null/unset = the engine falls back to the live rule
   *  walk. */
  readRuleId?: number | null;
  /** cards.read_rule_class (the set pattern tag, e.g. "*type"). */
  readRuleClass?: string | null;
  /** cards.created_at — the corpus row's literal SQL datetime. R17: the
   *  Sign up core view renders "signed up on #{format_date card.created_at}"
   *  from this column (card-mod-account set/type/signup/views.rb:35-37), so
   *  the raw-corpus seeding passes the corpus value through; unset keeps
   *  the historical seed default (2026-09-19 00:00:00.000). */
  createdAt?: string;
  /** cards.creator_id — the self_signup?/invited? input
   *  (views.rb:39-45 compares against AnonymousID). Unset keeps the
   *  historical seed default (1). */
  creatorId?: number;
  /** cards.current_revision_id — the card's last action id. The edit-form
   *  surface renders it in the conflict tracker hidden field
   *  (card.last_action_id, card-mod-edit set/all/form.rb:27-31); unset
   *  keeps the NULL default (the edit-form oracle capture normalizes the
   *  value anyway - it is seed state, not form semantics). */
  currentRevisionId?: number;
}

/** Direct INSERT (write path is another stream). Every row with a known
 *  name stores its CANONICAL key; junction rows store the key and keep
 *  name NULL (lead option (b), 2026-09-23, refined by the R4 lane proof):
 *  the *structure rule universe statement (src/card/rules/structure.ts:82-86)
 *  composes 2-junction set anchors from the STORED key columns — with
 *  junction keys forced NULL the seeded universe measured 115 vs the corpus
 *  truth 139 (24 *structure rule sets unresolved, 17 of them
 *  type_plus_right). The KEY is stored and the NAME deliberately is not:
 *  DbLexicon.idToLex (src/card/fetch/lexicon.ts:127-144) branches on
 *  name presence — a named junction row yields a STRING lex whose cache
 *  entry the synchronous peekLex id-pair path ("L-<left>-<right>") never
 *  sees, breaking junction-chain resolution (the R3 records lane restored
 *  name+key together and regressed exactly the junction-heavy surfaces).
 *  The canonical key equals the corpus's junction key for every anonymized
 *  name (key === name verbatim there, probe-verified on all 49,809 named
 *  rows); it intentionally deviates where the corpus is uncanonical
 *  ("*type plus right" -> "*type_plu_right") because the canonical spelling
 *  is what the candidate walk (resolveStructuredContent) looks up. Fetch
 *  resolution itself is unaffected: compound marks resolve through
 *  left_id/right_id (src/card/fetch/retrieve.ts:272 + the Lexicon), never
 *  through the junction row's own key column. */
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
      // created_at: the corpus row's literal SQL datetime when provided
      // (the Sign up core renders "signed up on #{format_date
      // card.created_at}" from this column); the historical seed default
      // otherwise.
      opts.createdAt ?? "2026-09-19 00:00:00.000",
      "2026-09-19 00:00:00.000",
      // creator_id: the invited?/self_signup? input (views.rb:39-45
      // compares against AnonymousID); historical default otherwise.
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

/** Seed one card_references row (the reference graph the read-rule cache
 *  reads; the write path builds these in another stream). Mirrors the
 *  columns the ReadRuleCache SQL selects (src/card/permissions/read-rules.ts,
 *  lib/card/rule/read_rule_cache.rb). */
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
