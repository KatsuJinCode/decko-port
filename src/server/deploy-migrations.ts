import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface DeployMigration {
  readonly filename: string;
  readonly number: string;
}

export const DEPLOY_MIGRATION_ORDER: readonly DeployMigration[] = [
  { filename: "0001-schema.sql", number: "0001" },
  { filename: "0002-card-text-binary-lookup-indexes.sql", number: "0002" },
  { filename: "0003-deck-data-version-stamp.sql", number: "0003" },
  { filename: "0003-demo-seed.sql", number: "0003" },
  { filename: "0004-demo-account-substrate.sql", number: "0004" },
  { filename: "0005-auth-sessions.sql", number: "0005" },
  { filename: "0006-demo-role-substrate.sql", number: "0006" },
  { filename: "0008-cards-serving-path-indexes.sql", number: "0008" },
  { filename: "0009-demo-account-read-rules.sql", number: "0009" },
  { filename: "0010-deck-data-version-all-card-tables.sql", number: "0010" },
  { filename: "0011-auth-signin-throttle.sql", number: "0011" },
  { filename: "0012-first-run-setup-token.sql", number: "0012" },
  { filename: "0013-nest-index-meta.sql", number: "0013" },
  { filename: "0014-undo-journal-lock-state.sql", number: "0014" },
];

export const DECK_DATA_VERSION_STAMP_FILENAME = "0003-deck-data-version-stamp.sql";

export const DECK_DATA_VERSION_STAMP_APPLIED_ALIASES: readonly string[] = [
  "0007-deck-data-version-stamp.sql",
];

const CANONICAL_FILENAMES: ReadonlySet<string> = new Set(
  DEPLOY_MIGRATION_ORDER.map((m) => m.filename),
);

const ALIAS_TO_CANONICAL: ReadonlyMap<string, string> = new Map(
  DECK_DATA_VERSION_STAMP_APPLIED_ALIASES.map((alias) => [alias, DECK_DATA_VERSION_STAMP_FILENAME]),
);

export function canonicalAppliedFilenames(recorded: readonly string[]): {
  applied: Set<string>;
  unknownRecorded: string[];
} {
  const applied = new Set<string>();
  const unknownRecorded: string[] = [];
  for (const name of recorded) {
    const canonical = ALIAS_TO_CANONICAL.get(name);
    if (canonical !== undefined) {
      applied.add(canonical);
    } else if (CANONICAL_FILENAMES.has(name)) {
      applied.add(name);
    } else {
      unknownRecorded.push(name);
    }
  }
  return { applied, unknownRecorded };
}

export function unappliedDeployMigrations(recorded: readonly string[]): string[] {
  const { applied } = canonicalAppliedFilenames(recorded);
  return DEPLOY_MIGRATION_ORDER.map((m) => m.filename).filter((f) => !applied.has(f));
}

let migrationsDirCache: string | undefined;
function DEFAULT_MIGRATIONS_DIR(): string {
  migrationsDirCache ??= fileURLToPath(new URL("../../deploy/migrations", import.meta.url));
  return migrationsDirCache;
}

export function assertDeployMigrationsMatchManifest(dir: string = DEFAULT_MIGRATIONS_DIR()): void {
  const onDisk = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const declared = DEPLOY_MIGRATION_ORDER.map((m) => m.filename).sort();
  const extra = onDisk.filter((f) => !declared.includes(f));
  const missing = declared.filter((f) => !onDisk.includes(f));
  if (extra.length > 0 || missing.length > 0) {
    throw new Error(
      `deploy/migrations does not match the manifest (src/server/deploy-migrations.ts):` +
        (extra.length > 0 ? ` on disk but not manifested: ${extra.join(", ")}` : "") +
        (missing.length > 0 ? ` manifested but not on disk: ${missing.join(", ")}` : "") +
        `. A new migration file must be added to DEPLOY_MIGRATION_ORDER in the same commit.`,
    );
  }
  const keys = DEPLOY_MIGRATION_ORDER.map((m) => `${m.number}~${m.filename}`);
  const sorted = [...keys].sort();
  if (keys.some((k, i) => k !== sorted[i])) {
    throw new Error(
      "DEPLOY_MIGRATION_ORDER is not in canonical order (numeric prefix ascending, " +
        "filename ascending tiebreak) — fix the manifest order.",
    );
  }
}
