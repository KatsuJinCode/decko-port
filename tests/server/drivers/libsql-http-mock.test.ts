// LibSqlHttpAdapter tests against a protocol-faithful mock Hrana v2 server.
// The mock (tests/server/drivers/mock-hrana-server.ts) captures every
// request body, so these tests assert the EXACT wire shape the adapter
// produces — tagged {type, value} args, the trailing close request, one
// POST per batch — plus full conformance and protocol-violation surfacing.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LibSqlHttpAdapter, LibSqlHttpError } from "../../../src/server/drivers/libsql-http.js";
import { startMockHranaServer, type MockHranaServer } from "./mock-hrana-server.js";
import { runDriverConformance } from "./conformance.js";

describe("LibSqlHttpAdapter over mock Hrana server", () => {
  let server: MockHranaServer;
  let adapter: LibSqlHttpAdapter;

  beforeAll(async () => {
    server = await startMockHranaServer();
    adapter = new LibSqlHttpAdapter({ url: server.url, authToken: "test-token-123", timeoutMs: 10_000 });
  });

  afterAll(async () => {
    await server.close();
  });

  runDriverConformance("conformance: LibSqlHttpAdapter (mock Hrana)", () => ({ driver: adapter }));

  it("sends the exact Hrana v2 request shape for query()", async () => {
    await driverSetup();
    server.requests.length = 0;

    await adapter.query("INSERT INTO wire (n, f, s, z) VALUES (?, ?, ?, ?)", [42, 1.5, "hi", null]);

    expect(server.requests).toHaveLength(1);
    const req = server.requests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/v2/pipeline");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["authorization"]).toBe("Bearer test-token-123");

    const body = req.body as { requests: unknown[] };
    expect(body.requests).toHaveLength(2);
    const [execute, close] = body.requests;
    expect(execute).toEqual({
      type: "execute",
      stmt: {
        sql: "INSERT INTO wire (n, f, s, z) VALUES (?, ?, ?, ?)",
        args: [
          { type: "integer", value: "42" },
          { type: "float", value: 1.5 },
          { type: "text", value: "hi" },
          { type: "null" },
        ],
        want_rows: true,
      },
    });
    expect(close).toEqual({ type: "close" });
    expect(server.violations).toEqual([]);
  });

  it("sends a whole batch as ONE pipeline POST (one round trip)", async () => {
    await driverSetup();
    server.requests.length = 0;

    const results = await adapter.batch([
      { sql: "INSERT INTO wire (n, s) VALUES (?, ?)", params: [7, "seven"] },
      { sql: "SELECT COUNT(*) AS c FROM wire", params: [] },
    ]);

    expect(server.requests).toHaveLength(1); // the round-trip contract
    const body = server.requests[0].body as { requests: Array<{ type?: string; stmt?: unknown }> };
    expect(body.requests).toHaveLength(3); // 2 executes + close
    expect(body.requests.map((r) => r.type)).toEqual(["execute", "execute", "close"]);
    expect(results).toHaveLength(2);
    expect(results[0].rowsAffected).toBe(1);
    expect(results[1].rows).toEqual([{ c: 2 }]);
    expect(server.violations).toEqual([]);
  });

  it("surfaces in-band statement errors as thrown LibSqlHttpError", async () => {
    const err = await adapter.query("SELEC 1", []).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LibSqlHttpError);
    expect((err as LibSqlHttpError).code).toBe("SQLITE_ERROR");
    expect((err as LibSqlHttpError).statementIndex).toBe(0);
  });

  it("surfaces protocol violations instead of swallowing them", async () => {
    server.enqueueRawResponse(JSON.stringify({ results: [] }));
    await expect(adapter.query("SELECT 1", [])).rejects.toThrow(/count mismatch/);
  });

  it("rejects unsupported parameter types up front", async () => {
    await expect(adapter.query("SELECT ?", [{ nested: "object" }])).rejects.toThrow(/unsupported parameter type/);
  });

  /** The wire-shape tests need their own table; the conformance suite
   *  creates and drops nothing, so this just ensures a table exists. */
  async function driverSetup(): Promise<void> {
    await adapter.query("CREATE TABLE IF NOT EXISTS wire (id INTEGER PRIMARY KEY AUTOINCREMENT, n INTEGER, f REAL, s TEXT, z)", []);
  }
});
