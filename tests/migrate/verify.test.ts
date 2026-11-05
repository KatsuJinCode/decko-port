// verify.test.ts — the verification report: shape, parity truthfulness,
// junction resolution, and the DATA RULE audit (the report must be
// content-free: no card names, no card content).

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LocalSqliteToolDriver,
  importDump,
} from "../../tools/migrate/import.mjs";
import { verifyMigration, OUT_OF_SCOPE } from "../../tools/migrate/verify.mjs";
import { deriveKeyWithEngine } from "../../tools/migrate/engine-bridge.mjs";
import { engineChecks } from "../../tools/migrate/engine-bridge.mjs";
import {
  dumpFile,
  cardsInsert,
  actsInsert,
} from "./synthetic-dump.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DDL_PATH = join(REPO_ROOT, "db", "schema.sqlite.sql");

const dirs: string[] = [];
afterAll(() => {
  // best-effort cleanup; Windows may still hold a handle briefly
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // leftover %TEMP% dirs are acceptable
    }
  }
});

async function buildVerifiedFixture(dir: string) {
  const dumpPath = join(dir, "deck.sql");
  const content = dumpFile([
    cardsInsert([
      { id: 1, name: "Verify Alpha", dbContent: "alpha body text" },
      { id: 2, name: "Verify Beta", dbContent: "beta body text" },
      {
        id: 3,
        name: "Verify Alpha+child",
        key: null,
        leftId: 1,
        rightId: 4,
        dbContent: "child content",
      },
      { id: 4, name: "child" },
      { id: 5, name: "Verify Ghost", trash: 1, dbContent: null },
    ]),
    actsInsert([{ id: 10, cardId: 1, actorId: 1 }]),
  ]);
  writeFileSync(dumpPath, content, "utf8");
  const driver = new LocalSqliteToolDriver(join(dir, "deck.sqlite"));
  const stats = await importDump({
    dumpPath,
    driver,
    ddlPath: DDL_PATH,
    deriveKey: deriveKeyWithEngine,
  });
  return { dumpPath, driver, stats };
}

describe("verifyMigration", () => {
  it("reports full parity for a faithful import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "decko-verify-"));
    dirs.push(dir);
    const { dumpPath, driver, stats } = await buildVerifiedFixture(dir);
    const reportPath = join(dir, "report.json");
    const report = await verifyMigration({
      dumpPath,
      driver,
      ddlPath: DDL_PATH,
      importStats: stats,
      spotCount: 4,
      reportPath,
    });

    expect(report.allParity).toBe(true);
    expect(report.cards).toEqual({
      sourceCount: 5,
      targetCount: 5,
      parity: true,
    });
    expect(report.tables["cards"]?.countParity).toBe(true);
    expect(report.tables["cards"]?.checksumParity).toBe(true);
    // tables absent from the dump: sourceCount 0, parity trivially true
    expect(report.tables["sessions"]?.sourceCount).toBe(0);
    expect(report.tables["sessions"]?.countParity).toBe(true);
    // junction walk resolved the one compound card
    expect(report.junction.sampled).toBe(1);
    expect(report.junction.resolved).toBe(1);
    // engine checks without a bridge: honestly skipped
    expect(report.engine.status).toBe("skipped");
    expect(report.outOfScope).toEqual(OUT_OF_SCOPE);
    expect(existsSync(reportPath)).toBe(true);
    driver.close();
  }, 60000);

  it("detects tampering (parity failures surface, not hide)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "decko-verify-"));
    dirs.push(dir);
    const { dumpPath, driver, stats } = await buildVerifiedFixture(dir);
    // tamper: delete a card behind the verifier's back
    await driver.query("DELETE FROM cards WHERE id = 2", []);
    const report = await verifyMigration({
      dumpPath,
      driver,
      ddlPath: DDL_PATH,
      importStats: stats,
      spotCount: 2,
    });
    expect(report.allParity).toBe(false);
    expect(report.cards?.parity).toBe(false);
    expect(report.tables["cards"]?.countParity).toBe(false);
    expect(report.tables["cards"]?.checksumParity).toBe(false);
    driver.close();
  }, 60000);

  it("writes a CONTENT-FREE report (DATA RULE audit)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "decko-verify-"));
    dirs.push(dir);
    const { dumpPath, driver, stats } = await buildVerifiedFixture(dir);
    const reportPath = join(dir, "report.json");
    const report = await verifyMigration({
      dumpPath,
      driver,
      ddlPath: DDL_PATH,
      importStats: stats,
      engineChecks: (ctx) => engineChecks({ ...ctx, spotCount: 3 }),
      spotCount: 3,
      reportPath,
    });
    const json = JSON.stringify(report);
    // synthetic content markers that would prove a leak
    expect(json).not.toContain("Verify Alpha");
    expect(json).not.toContain("Verify Beta");
    expect(json).not.toContain("alpha body text");
    expect(json).not.toContain("child content");
    // engine checks ran and rendered
    expect(report.engine.status).toBe("ok");
    driver.close();
  }, 60000);
});
