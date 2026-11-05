// A tiny mock libSQL/Hrana-v2-over-HTTP server for testing LibSqlHttpAdapter.
//
// It is protocol-faithful but not a SQL engine: request encoding is decoded
// with the same rules the adapter uses, SQL actually executes against a
// better-sqlite3 in-memory database, and responses are encoded following
// the reference shapes in @libsql/hrana-client (shared/json_encode.js /
// json_decode.js). Every captured request body is available to tests, so a
// test can assert the EXACT wire shape the adapter produced (tagged
// {type, value} args, one close request, one POST per batch), which is the
// whole point of testing against a mock instead of a real client.

import http from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import type { BetterSqlite3Statement } from "../../../src/server/drivers/local-sqlite.js";

export interface CapturedRequest {
  url: string;
  method: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

export interface MockHranaServer {
  /** Base URL, e.g. "http://127.0.0.1:54321" (ephemeral port). */
  url: string;
  port: number;
  /** Every captured request, in arrival order. */
  requests: CapturedRequest[];
  /** Wire-shape violations the server noticed (never expected when the
   *  adapter is correct). */
  violations: string[];
  /** Queue a raw response body to be sent verbatim on the NEXT request —
   *  used to prove the adapter surfaces protocol violations instead of
   *  swallowing them. */
  enqueueRawResponse(body: string): void;
  close(): Promise<void>;
}

export async function startMockHranaServer(): Promise<MockHranaServer> {
  const db = new Database(":memory:");
  const requests: CapturedRequest[] = [];
  const violations: string[] = [];
  const rawResponses: string[] = [];

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      let body: unknown = undefined;
      try {
        body = JSON.parse(raw);
      } catch {
        body = undefined;
      }
      requests.push({ url: req.url ?? "", method: req.method ?? "", headers: req.headers, body });

      const queuedRaw = rawResponses.shift();
      if (queuedRaw !== undefined) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(queuedRaw);
        return;
      }

      if (req.method !== "POST" || !(req.url ?? "").endsWith("/v2/pipeline")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "mock hrana server only handles POST /v2/pipeline" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(handlePipeline(db, body, violations)));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    requests,
    violations,
    enqueueRawResponse(body: string): void {
      rawResponses.push(body);
    },
    async close(): Promise<void> {
      db.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Pipeline handling
// ---------------------------------------------------------------------------

function handlePipeline(db: Database, body: unknown, violations: string[]): unknown {
  const requests = (body as { requests?: unknown })?.requests;
  if (!Array.isArray(requests)) {
    violations.push("request body has no requests array");
    return { results: [{ type: "error", error: { message: "no requests array", code: "MOCK_PROTO" } }] };
  }
  const results = requests.map((entry, i) => handleRequestEntry(db, entry, i, violations));
  return { results };
}

interface WireValue {
  type: string;
  value?: unknown;
  base64?: unknown;
}

function handleRequestEntry(db: Database, entry: unknown, index: number, violations: string[]): unknown {
  if (entry === null || typeof entry !== "object") {
    violations.push(`request ${index} is not an object`);
    return { type: "error", error: { message: `request ${index} is not an object`, code: "MOCK_PROTO" } };
  }
  const r = entry as { type?: unknown; stmt?: unknown };
  if (r.type === "close") {
    return { type: "ok", response: { type: "close" } };
  }
  if (r.type !== "execute" || r.stmt === null || typeof r.stmt !== "object") {
    violations.push(`request ${index} is neither execute nor close`);
    return {
      type: "error",
      error: { message: `request ${index}: expected execute or close`, code: "MOCK_PROTO" },
    };
  }
  const stmt = r.stmt as { sql?: unknown; args?: unknown; want_rows?: unknown };
  if (typeof stmt.sql !== "string") {
    violations.push(`request ${index} stmt has no sql string`);
    return { type: "error", error: { message: `request ${index}: no sql`, code: "MOCK_PROTO" } };
  }
  if (stmt.want_rows !== undefined && stmt.want_rows !== true) {
    violations.push(`request ${index} want_rows is present but not true`);
  }
  const args = stmt.args === undefined ? [] : stmt.args;
  if (!Array.isArray(args)) {
    violations.push(`request ${index} stmt.args is not an array`);
    return { type: "error", error: { message: `request ${index}: args not an array`, code: "MOCK_PROTO" } };
  }
  let jsArgs: unknown[];
  try {
    jsArgs = args.map((a, ai) => wireToJs(a, index, ai, violations));
  } catch (e) {
    violations.push(`request ${index} arg decode failed: ${(e as Error).message}`);
    return {
      type: "error",
      error: { message: `request ${index}: ${(e as Error).message}`, code: "MOCK_PROTO" },
    };
  }

  try {
    return { type: "ok", response: { type: "execute", result: execute(db, stmt.sql, jsArgs) } };
  } catch (e) {
    // Statement-level failures travel in-band as error results (HTTP stays
    // 200), matching how real libSQL servers report SQL errors.
    return {
      type: "error",
      error: { message: (e as Error).message, code: "SQLITE_ERROR" },
    };
  }
}

function execute(db: Database, sql: string, args: unknown[]): unknown {
  const stmt = db.prepare(sql) as unknown as BetterSqlite3Statement;
  if (stmt.reader) {
    const cols = stmt.columns().map((c) => ({ name: c.name, decltype: c.type }));
    const rows: unknown[][] = stmt.raw().all(...args);
    return {
      cols,
      rows: rows.map((row) => row.map(jsToWire)),
      affected_row_count: 0,
    };
  }
  const info = stmt.run(...args);
  const rowId = BigInt(info.lastInsertRowid);
  return {
    cols: [],
    rows: [],
    affected_row_count: Number(info.changes),
    ...(rowId > 0n ? { last_insert_rowid: rowId.toString() } : {}),
  };
}

// ---------------------------------------------------------------------------
// Hrana value encoding/decoding (mock side)
// ---------------------------------------------------------------------------

function wireToJs(value: unknown, reqIndex: number, argIndex: number, violations: string[]): unknown {
  if (value === null || typeof value !== "object" || typeof (value as WireValue).type !== "string") {
    violations.push(`request ${reqIndex} arg ${argIndex} is not a tagged Hrana value`);
    throw new Error(`arg ${argIndex} is not a tagged Hrana value`);
  }
  const v = value as WireValue;
  switch (v.type) {
    case "null":
      return null;
    case "integer": {
      if (typeof v.value !== "string") {
        violations.push(`request ${reqIndex} arg ${argIndex} integer value is not a string`);
        throw new Error(`arg ${argIndex} integer value is not a string`);
      }
      const big = BigInt(v.value);
      return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(big)
        : big;
    }
    case "float":
      if (typeof v.value !== "number") {
        violations.push(`request ${reqIndex} arg ${argIndex} float value is not a number`);
        throw new Error(`arg ${argIndex} float value is not a number`);
      }
      return v.value;
    case "text":
      if (typeof v.value !== "string") {
        violations.push(`request ${reqIndex} arg ${argIndex} text value is not a string`);
        throw new Error(`arg ${argIndex} text value is not a string`);
      }
      return v.value;
    case "blob":
      if (typeof v.base64 !== "string") {
        violations.push(`request ${reqIndex} arg ${argIndex} blob base64 is not a string`);
        throw new Error(`arg ${argIndex} blob base64 is not a string`);
      }
      return Buffer.from(v.base64, "base64");
    default:
      violations.push(`request ${reqIndex} arg ${argIndex} has unknown type ${v.type}`);
      throw new Error(`arg ${argIndex} has unknown value type ${v.type}`);
  }
}

function jsToWire(value: unknown): unknown {
  if (value === null) return { type: "null" };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { type: "integer", value: value.toString() }
      : { type: "float", value };
  }
  if (typeof value === "bigint") return { type: "integer", value: value.toString() };
  if (typeof value === "string") return { type: "text", value };
  if (value instanceof Uint8Array) {
    return {
      type: "blob",
      base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64"),
    };
  }
  throw new Error(`mock hrana server cannot encode value of type ${typeof value}`);
}
