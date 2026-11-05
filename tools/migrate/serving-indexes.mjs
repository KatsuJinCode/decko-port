import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CANONICAL_DDL = join(REPO, "db", "schema.sqlite.sql");

export const RETIRED_INDEXES = Object.freeze(["cards_trash_index"]);

export function isRetiredIndex(name) {
  return RETIRED_INDEXES.includes(name);
}

export function canonicalIndexStatements(opts = {}) {
  const ddl = readFileSync(opts.ddlPath ?? CANONICAL_DDL, "utf8");
  const out = [];
  const re = /^CREATE (UNIQUE )?INDEX "([A-Za-z0-9_]+)"\s+ON "([a-z_]+)"\s*(\(.*?);\s*$/gm;
  for (const m of ddl.matchAll(re)) {
    const [, unique, name, table, rest] = m;
    if (opts.tables && !opts.tables.includes(table)) continue;
    out.push({ name, table, sql: `CREATE ${unique ?? ""}INDEX IF NOT EXISTS "${name}" ON "${table}" ${rest}` });
  }
  return out;
}
