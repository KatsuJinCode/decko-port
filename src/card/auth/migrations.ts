import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SQLDatabaseDriver } from "../../server/driver.js";
import { sqlDateTime } from "./session-store.js";

export interface AuthMigrationRunResult {
  applied: string[];
  skipped: string[];
}

export interface AuthMigrationRunOptions {
  migrationsDir?: string;
  now?: () => Date;
}

let defaultMigrationsDir: string | undefined;
function DEFAULT_MIGRATIONS_DIR(): string {
  defaultMigrationsDir ??= fileURLToPath(
    new URL("../../../db/migrations", import.meta.url),
  );
  return defaultMigrationsDir;
}

const ENSURE_BOOKKEEPING_SQL = `
  CREATE TABLE IF NOT EXISTS "auth_migrations" (
    "version"    TEXT NOT NULL PRIMARY KEY,
    "applied_at" TEXT NOT NULL
  )`;

export async function runAuthMigrations(
  driver: SQLDatabaseDriver,
  options: AuthMigrationRunOptions = {},
): Promise<AuthMigrationRunResult> {
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR();
  const now = options.now ?? (() => new Date());
  await driver.query(ENSURE_BOOKKEEPING_SQL, []);

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const alreadyApplied = await driver.query<{ version: string }>(
      "SELECT version FROM auth_migrations WHERE version = ?",
      [file],
    );
    if (alreadyApplied.rows.length > 0) {
      skipped.push(file);
      continue;
    }
    const ddl = readFileSync(`${migrationsDir}/${file}`, "utf8");
    const statements = splitSqlStatements(ddl);
    await driver.batch([
      ...statements.map((sql) => ({ sql, params: [] as unknown[] })),
      {
        sql: "INSERT INTO auth_migrations (version, applied_at) VALUES (?, ?)",
        params: [file, sqlDateTime(now())],
      },
    ]);
    applied.push(file);
  }
  return { applied, skipped };
}

export function splitSqlStatements(sql: string): string[] {
  const withoutLineComments = sql.replace(/--[^\n]*/g, "");
  return withoutLineComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
