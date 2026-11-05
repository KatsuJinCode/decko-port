// Conformance + behavior tests for LocalSqliteDriver (better-sqlite3
// reference driver). File-backed so real on-disk persistence is exercised;
// ":memory:" is covered implicitly by the mock Hrana server's own store.

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalSqliteDriver } from "../../../src/server/drivers/local-sqlite.js";
import { runDriverConformance } from "./conformance.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "decko-local-sqlite-test-"));
const dbPath = path.join(tempDir, "decko-test.db");

afterAll(() => {
  // The driver is closed by the conformance suite's dispose; remove the
  // temp tree. Swallow cleanup failures (Windows AV scanners sometimes hold
  // the file briefly) rather than failing tests over temp litter.
  try {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* temp litter is acceptable */
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

  // LocalSqliteDriver.close() is not part of SQLDatabaseDriver; the
  // persistence round trip exercises it.
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
