// migrate-cli.test.ts — the one-click entry point end to end:
//   node tools/migrate/migrate.mjs --dump <synthetic> --out <db> --verify
// asserting exit code 0, a populated database, and the JSON report on
// disk. (The --engine-verify spawn path is exercised manually; in-suite it
// would nest a vitest run inside a vitest run.)

import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { dumpFile, cardsInsert } from "./synthetic-dump.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of %TEMP%
    }
  }
});

describe("migrate CLI", () => {
  it("runs dump -> out -> verify end to end and writes the report", () => {
    const dir = mkdtempSync(join(tmpdir(), "decko-cli-"));
    dirs.push(dir);
    const dumpPath = join(dir, "deck.sql");
    const outPath = join(dir, "deck.sqlite");
    const reportPath = join(dir, "report.json");
    writeFileSync(
      dumpPath,
      dumpFile([
        cardsInsert([
          { id: 1, name: "Cli Card One", dbContent: "first cli card" },
          { id: 2, name: "Cli Card Two", dbContent: "second cli card" },
          {
            id: 3,
            name: "Cli Card Two+extra",
            key: null,
            leftId: 2,
            rightId: 4,
            dbContent: "extra",
          },
          { id: 4, name: "extra" },
        ]),
      ]),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        join(REPO_ROOT, "tools", "migrate", "migrate.mjs"),
        "--dump",
        dumpPath,
        "--out",
        outPath,
        "--verify",
        "--report",
        reportPath,
        "--quiet",
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    expect(existsSync(reportPath)).toBe(true);

    const db = new Database(outPath, { readonly: true });
    const n = db.prepare("SELECT COUNT(*) AS n FROM cards").get() as {
      n: number;
    };
    expect(n.n).toBe(4);
    db.close();

    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.tool).toContain("decko-ts migrate");
    expect(report.allParity).toBe(true);
    expect(report.cards?.parity).toBe(true);
    expect(report.engine.status).toBe("skipped");
    // the CLI report is content-free too
    const json = JSON.stringify(report);
    expect(json).not.toContain("Cli Card One");
    expect(json).not.toContain("first cli card");
  }, 180_000);

  it("refuses an existing target without --append", () => {
    const dir = mkdtempSync(join(tmpdir(), "decko-cli-"));
    dirs.push(dir);
    const dumpPath = join(dir, "deck.sql");
    const outPath = join(dir, "occupied.sqlite");
    writeFileSync(dumpPath, dumpFile([cardsInsert([{ id: 1, name: "X" }])]), "utf8");
    writeFileSync(outPath, "not a database but present", "utf8");
    const result = spawnSync(
      process.execPath,
      [
        join(REPO_ROOT, "tools", "migrate", "migrate.mjs"),
        "--dump",
        dumpPath,
        "--out",
        outPath,
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/already exists/);
  }, 90_000);
});
