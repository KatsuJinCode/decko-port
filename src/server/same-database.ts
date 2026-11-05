import type { SQLDatabaseDriver } from "./driver.js";
import { runAuthMigrations } from "../card/auth/migrations.js";
import { ensureFreshnessStamp } from "./freshness-stamp.js";

export interface PortSchemaObject {
  readonly type: "table" | "index" | "trigger";
  readonly name: string;
  readonly sql: string;
}

export const LOOKUP_INDEX_OBJECTS: readonly PortSchemaObject[] = [
  { type: "index", name: "cards_name_trash_index", sql: `CREATE INDEX IF NOT EXISTS "cards_name_trash_index" ON "cards" ("name", "trash")` },
  { type: "index", name: "cards_key_nocase_trash_index", sql: `CREATE INDEX IF NOT EXISTS "cards_key_nocase_trash_index" ON "cards" ("key" COLLATE NOCASE, "trash")` },
  { type: "index", name: "cards_right_id_trash_index", sql: `CREATE INDEX IF NOT EXISTS "cards_right_id_trash_index" ON "cards" ("right_id", "trash")` },
  {
    type: "index",
    name: "cards_codename_present_index",
    sql: `CREATE INDEX IF NOT EXISTS "cards_codename_present_index" ON "cards" ("codename", "id", "name", "left_id", "right_id") WHERE "codename" IS NOT NULL`,
  },
  { type: "index", name: "cards_key_last_char_index", sql: `CREATE INDEX IF NOT EXISTS "cards_key_last_char_index" ON "cards" (substr("key", -1))` },
];

const RUBY_DECKO_TABLES = ["cards", "card_acts", "card_actions", "card_changes", "card_references", "schema_migrations"];

export interface SameDatabaseReport {
  readonly rubyDatabase: boolean;
  readonly created: string[];
  readonly authMigrationsApplied: string[];
}

export interface SameDatabaseOptions {
  readonly authMigrationsDir?: string;
  readonly skipAuthSessions?: boolean;
}

export function driverDialect(driver: SQLDatabaseDriver): "sqlite" | "mysql" {
  return (driver as { dialect?: string }).dialect === "mysql" ? "mysql" : "sqlite";
}

async function schemaNames(driver: SQLDatabaseDriver): Promise<Set<string>> {
  if (driverDialect(driver) === "mysql") {
    const rows = await driver.query<{ name: string }>(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
       UNION SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
       UNION SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()`,
      [],
    );
    return new Set(rows.rows.map((r) => String(r.name)));
  }
  const rows = await driver.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sqlite_%'`,
    [],
  );
  return new Set(rows.rows.map((r) => String(r.name)));
}

async function hasBinaryLeadingIndex(driver: SQLDatabaseDriver, column: string): Promise<boolean> {
  const list = await driver.query<{ name: string }>(`SELECT name FROM pragma_index_list('cards')`, []);
  for (const { name } of list.rows) {
    const cols = await driver.query<{ seqno: number; name: string | null; coll: string | null; key: number }>(
      `SELECT seqno, name, coll, key FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno`,
      [name],
    );
    const lead = cols.rows[0];
    if (lead !== undefined && lead.name === column && String(lead.coll ?? "BINARY").toUpperCase() === "BINARY") return true;
  }
  return false;
}

export async function isRubyDeckoDatabase(driver: SQLDatabaseDriver): Promise<boolean> {
  const names = await schemaNames(driver);
  if (!RUBY_DECKO_TABLES.every((t) => names.has(t))) return false;
  const ledger = await driver.query<{ n: number }>(`SELECT COUNT(*) AS n FROM schema_migrations`, []);
  return Number(ledger.rows[0]?.n ?? 0) > 0;
}

export async function openSameDatabase(
  driver: SQLDatabaseDriver,
  options: SameDatabaseOptions = {},
): Promise<SameDatabaseReport> {
  if (driverDialect(driver) === "mysql") return openSameMysqlDatabase(driver, options);
  const before = await schemaNames(driver);
  const rubyDatabase = await isRubyDeckoDatabase(driver);
  const hasCardTables = before.has("cards") && before.has("card_references");
  const objects: PortSchemaObject[] = hasCardTables ? [...LOOKUP_INDEX_OBJECTS] : [];
  if (hasCardTables && !(await hasBinaryLeadingIndex(driver, "key"))) {
    objects.push({ type: "index", name: "cards_key_binary_index", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "cards_key_binary_index" ON "cards" ("key")` });
  }
  if (hasCardTables && !(await hasBinaryLeadingIndex(driver, "codename"))) {
    objects.push({
      type: "index",
      name: "cards_codename_binary_index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS "cards_codename_binary_index" ON "cards" ("codename")`,
    });
  }
  if (hasCardTables) await ensureFreshnessStamp(driver);
  const missing = objects.filter((o) => !before.has(o.name));
  if (missing.length > 0) await driver.batch(missing.map((o) => ({ sql: o.sql, params: [] as unknown[] })));
  const auth = options.skipAuthSessions
    ? { applied: [] as string[] }
    : await runAuthMigrations(driver, options.authMigrationsDir === undefined ? {} : { migrationsDir: options.authMigrationsDir });
  const after = await schemaNames(driver);
  const created = [...after].filter((n) => !before.has(n)).sort();
  return { rubyDatabase, created, authMigrationsApplied: auth.applied };
}

export const MYSQL_PORT_OBJECTS: readonly PortSchemaObject[] = [
  {
    type: "table",
    name: "deck_data_version",
    sql: `CREATE TABLE IF NOT EXISTS deck_data_version (id INT NOT NULL PRIMARY KEY, version BIGINT NOT NULL DEFAULT 0) ENGINE=InnoDB`,
  },
  ...(["cards", "card_references"] as const).flatMap((table) =>
    (["ins", "upd", "del"] as const).map((op): PortSchemaObject => {
      const event = op === "ins" ? "INSERT" : op === "upd" ? "UPDATE" : "DELETE";
      const name = `${table}_bump_deck_data_version_${op}`;
      return {
        type: "trigger",
        name,
        sql: `CREATE TRIGGER ${name} AFTER ${event} ON ${table} FOR EACH ROW UPDATE deck_data_version SET version = version + 1 WHERE id = 1`,
      };
    }),
  ),
  {
    type: "table",
    name: "auth_sessions",
    sql: `CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  account_card_id INT NOT NULL,
  created_at VARCHAR(23) NOT NULL,
  expires_at VARCHAR(23) NOT NULL,
  INDEX index_auth_sessions_on_account_card_id (account_card_id),
  INDEX index_auth_sessions_on_expires_at (expires_at)
) ENGINE=InnoDB`,
  },
  { type: "index", name: "cards_name_trash_index", sql: `CREATE INDEX cards_name_trash_index ON cards (name, trash)` },
  { type: "index", name: "cards_right_id_trash_index", sql: `CREATE INDEX cards_right_id_trash_index ON cards (right_id, trash)` },
];

export const MYSQL_FUNCTIONAL_INDEX: PortSchemaObject = {
  type: "index",
  name: "cards_key_last_char_index",
  sql: "CREATE INDEX cards_key_last_char_index ON cards ((substr(`key`, -1)))",
};

export function supportsFunctionalIndexes(versionString: string): boolean {
  if (/mariadb/i.test(versionString)) return false;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(versionString.trim());
  if (m === null) return false;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return major > 8 || (major === 8 && (minor > 0 || patch >= 13));
}

async function openSameMysqlDatabase(driver: SQLDatabaseDriver, options: SameDatabaseOptions): Promise<SameDatabaseReport> {
  const before = await schemaNames(driver);
  const rubyDatabase = await isRubyDeckoDatabase(driver);
  const hasCardTables = before.has("cards") && before.has("card_references");
  const version = String((await driver.query<{ v: string }>("SELECT VERSION() AS v", [])).rows[0]?.v ?? "");
  const functional = supportsFunctionalIndexes(version) ? [MYSQL_FUNCTIONAL_INDEX] : [];
  const objects = [...MYSQL_PORT_OBJECTS, ...functional].filter((o) => (o.name === "auth_sessions" ? !options.skipAuthSessions : hasCardTables));
  for (const o of objects) if (!before.has(o.name)) await driver.query(o.sql, []);
  if (hasCardTables) await driver.query(`INSERT IGNORE INTO deck_data_version (id, version) VALUES (1, 0)`, []);
  const after = await schemaNames(driver);
  const created = [...after].filter((n) => !before.has(n)).sort();
  return { rubyDatabase, created, authMigrationsApplied: [] };
}

export function passwordHashModeFor(rubyDatabase: boolean, explicit: string | undefined): "pbkdf2" | "legacy-sha1" | undefined {
  const set = explicit?.trim();
  if (set !== undefined && set !== "") return set as "pbkdf2" | "legacy-sha1";
  return rubyDatabase ? "legacy-sha1" : undefined;
}
