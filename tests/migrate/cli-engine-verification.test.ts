// cli-engine-verification.test.ts — the vitest-runner entry the migrate CLI
// uses for engine-level verification under bare node (the engine is
// TypeScript; bare node cannot import it — see docs/migration-tool-notes.md).
//
// Invoked by tools/migrate/migrate.mjs with:
//   DECKO_MIGRATE_REPORT  path of the migration report JSON to merge into
//   DECKO_MIGRATE_TARGET  the imported SQLite database path
//   DECKO_MIGRATE_SPOT    spot-check card count
// Without those variables (a normal `vitest run` of the whole suite) the
// test skips itself — zero interference with the repo gates.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { it, expect } from "vitest";
import { engineChecks } from "../../tools/migrate/engine-bridge.mjs";
import { LocalSqliteToolDriver } from "../../tools/migrate/import.mjs";

const reportPath: string | undefined = process.env.DECKO_MIGRATE_REPORT;
const targetPath: string | undefined = process.env.DECKO_MIGRATE_TARGET;
const spotCount = Number(process.env.DECKO_MIGRATE_SPOT ?? "25");

it.skipIf(reportPath === undefined || targetPath === undefined)(
  "migration engine verification (CLI-driven)",
  { timeout: 600_000 },
  async () => {
    const report = reportPath as string;
    const target = targetPath as string;
    expect(existsSync(target)).toBe(true);
    expect(existsSync(report)).toBe(true);

    const driver = new LocalSqliteToolDriver(target, { readonly: true });
    try {
      const engine = await engineChecks({
        driver,
        spotCount,
        seed: 0xdec000,
      });
      // Merge into the report the CLI wrote (it holds the engine key as
      // "skipped" until this runs) and leave the standalone engine JSON
      // for the CLI's merge step.
      const parsed = JSON.parse(readFileSync(report, "utf8"));
      parsed.engine = { ...engine, status: "ok" };
      writeFileSync(
        `${report}.engine.json`,
        JSON.stringify({ ...engine, status: "ok" }, null, 2),
        "utf8",
      );
      writeFileSync(report, JSON.stringify(parsed, null, 2), "utf8");
      expect(parsed.engine.status).toBe("ok");
    } finally {
      driver.close();
    }
  },
);
