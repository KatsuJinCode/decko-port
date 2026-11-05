import type { SQLDatabaseDriver } from "./driver.js";

export const DECK_DATA_VERSION_TABLE = "deck_data_version";

export const FRESHNESS_STAMPED_TABLES = [
  "cards",
  "card_acts",
  "card_actions",
  "card_changes",
  "card_references",
  "card_virtuals",
] as const;

const OPERATIONS = [
  ["ins", "INSERT"],
  ["upd", "UPDATE"],
  ["del", "DELETE"],
] as const;

export function freshnessTriggerName(table: string, op: "ins" | "upd" | "del"): string {
  return `${table}_bump_deck_data_version_${op}`;
}

export const DECK_DATA_VERSION_TABLE_STATEMENT =
  `CREATE TABLE IF NOT EXISTS "${DECK_DATA_VERSION_TABLE}" (` +
  `"id" INTEGER PRIMARY KEY CHECK ("id" = 1), "version" INTEGER NOT NULL DEFAULT 0)`;

export const DECK_DATA_VERSION_ROW_STATEMENT = `INSERT OR IGNORE INTO "${DECK_DATA_VERSION_TABLE}" ("id", "version") VALUES (1, 0)`;

export function freshnessTriggerStatements(table: string): string[] {
  return OPERATIONS.map(
    ([op, event]) =>
      `CREATE TRIGGER IF NOT EXISTS "${freshnessTriggerName(table, op)}" AFTER ${event} ON "${table}" BEGIN\n` +
      `  UPDATE "${DECK_DATA_VERSION_TABLE}" SET "version" = "version" + 1 WHERE "id" = 1;\n` +
      `END`,
  );
}

export function freshnessTriggerNames(tables: readonly string[] = FRESHNESS_STAMPED_TABLES): string[] {
  return tables.flatMap((table) => OPERATIONS.map(([op]) => freshnessTriggerName(table, op)));
}

export interface FreshnessStampInstall {
  installed: string[];
}

export async function ensureFreshnessStamp(driver: Pick<SQLDatabaseDriver, "query" | "batch">): Promise<FreshnessStampInstall> {
  const objects = await driver.query<{ type: string; name: string }>(
    "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'trigger')",
    [],
  );
  const tables = new Set(objects.rows.filter((r) => r.type === "table").map((r) => r.name));
  const triggers = new Set(objects.rows.filter((r) => r.type === "trigger").map((r) => r.name));
  const statements: string[] = [];
  const installed: string[] = [];
  if (!tables.has(DECK_DATA_VERSION_TABLE)) {
    statements.push(DECK_DATA_VERSION_TABLE_STATEMENT);
    installed.push(`table ${DECK_DATA_VERSION_TABLE}`);
  }
  const row = tables.has(DECK_DATA_VERSION_TABLE)
    ? (await driver.query<{ n: number }>(`SELECT COUNT(*) AS n FROM "${DECK_DATA_VERSION_TABLE}" WHERE "id" = 1`, [])).rows[0]
    : undefined;
  if (Number(row?.n ?? 0) === 0) {
    statements.push(DECK_DATA_VERSION_ROW_STATEMENT);
    installed.push(`row ${DECK_DATA_VERSION_TABLE}#1`);
  }
  for (const table of FRESHNESS_STAMPED_TABLES) {
    if (!tables.has(table)) continue;
    const triggerStatements = freshnessTriggerStatements(table);
    OPERATIONS.forEach(([op], i) => {
      const name = freshnessTriggerName(table, op);
      if (triggers.has(name)) return;
      statements.push(triggerStatements[i]!);
      installed.push(`trigger ${name}`);
    });
  }
  if (statements.length > 0) await driver.batch(statements.map((sql) => ({ sql, params: [] })));
  return { installed };
}
