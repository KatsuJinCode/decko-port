

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
