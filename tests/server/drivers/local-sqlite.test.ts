

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalSqliteDriver } from "../../../src/server/drivers/local-sqlite.js";
import { runDriverConformance } from "./conformance.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "decko-local-sqlite-test-"));
const dbPath = path.join(tempDir, "decko-test.db");

afterAll(() => {

  try {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {

  }
});

describe("LocalSqliteDriver (file-backed)", () => {
  let confDriver: LocalSqliteDriver;
  runDriverConformance("conformance: LocalSqliteDriver", () => {
    confDriver = new LocalSqliteDriver({ path: dbPath });
    return {
      driver: confDriver,
      dispose: () => confDriver.close(),
    };
  });

  it("persists data across close and reopen", async () => {
    const first = new LocalSqliteDriver({ path: dbPath });
    await first.query(
      "CREATE TABLE IF NOT EXISTS persist_check (id INTEGER PRIMARY KEY AUTOINCREMENT, s TEXT)",
      [],
    );
    await first.query("INSERT INTO persist_check (s) VALUES (?)", ["survives"]);
    first.close();

    const second = new LocalSqliteDriver({ path: dbPath });
    const rows = await second.query<Record<string, unknown>>(
      "SELECT id, s FROM persist_check WHERE s = 'survives'",
      [],
    );
    expect(rows.rows).toEqual([{ id: 1, s: "survives" }]);
    second.close();
  });
});
