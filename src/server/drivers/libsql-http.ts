import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement, SQLTransactionGuarantee } from "../driver.js";
import { DatabaseOutcomeUnknownError, retryWhileBusy, TransactionGate } from "../driver.js";
import { inTransactionStatementScope, runInTransactionStatementScope } from "../transaction-statement-scope.js";

export interface LibSqlHttpOptions {
  url: string;
  authToken?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class LibSqlHttpError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly statementIndex?: number;

  constructor(message: string, opts: { status?: number; code?: string; statementIndex?: number } = {}) {
    super(message);
    this.name = "LibSqlHttpError";
    this.status = opts.status;
    this.code = opts.code;
    this.statementIndex = opts.statementIndex;
  }
}

export interface HranaExecResult {
  cols: { name: string; decltype?: string | null }[];
  rows: HranaValue[][];
  affectedRowCount: number;
  lastInsertRowId?: number | bigint;
}

export type HranaValue = null | number | bigint | string | Uint8Array;

export class LibSqlHttpAdapter implements SQLDatabaseDriver {
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly timeoutMs?: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LibSqlHttpOptions) {
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  readonly transactionGuarantee: SQLTransactionGuarantee = {
    mechanism: "native",
    atomicOnFailure: true,
    crashRecovery: "database",
    readersIsolated: true,
    serializedWriters: "database",
    atomicBatch: false,
    idsReusedAfterRollback: true,
  };

  private readonly gate = new TransactionGate();
  private stream: { baton: string; url: string } | undefined;

  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    const results = await this.send([{ type: "execute" as const, stmt: toHranaStmt(sql, params) }]);
    const first = results[0] as HranaExecResult;
    return execResultToQueryResult<T>(first);
  }

  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    if (statements.length === 0) return [];
    const requests: HranaPipelineRequest[] = statements.map((s) => ({
      type: "execute" as const,
      stmt: toHranaStmt(s.sql, s.params),
    }));
    const results = await this.send(requests);
    return results
      .slice(0, statements.length)
      .map((r) => execResultToQueryResult(r as HranaExecResult));
  }

  async transaction<R>(work: () => Promise<R>): Promise<R> {
    return this.gate.run(async () =>
      runInTransactionStatementScope(async () => {
        await retryWhileBusy(async () => {
          const begin: HranaPipelineRequest[] = [{ type: "execute", stmt: toHranaStmt("BEGIN IMMEDIATE", []) }];
          const opened = await this.pipeline(begin, { url: this.pipelineUrl(this.baseUrl) });
          if (opened.baton === undefined) {
            throw new LibSqlHttpError("libsql server returned no baton for an open stream (protocol violation)");
          }
          try {
            opened.results.forEach((entry, i) => decodeStreamResult(entry, i, begin[i]));
          } catch (error) {
            await this.pipeline([{ type: "close" }], { baton: opened.baton, url: opened.url }).catch(() => undefined);
            throw error;
          }
          this.stream = { baton: opened.baton, url: opened.url };
        });
        let result: R;
        try {
          result = await work();
        } catch (error) {
          try { await this.endStream("ROLLBACK"); }
          catch (rollbackError) { throw new DatabaseOutcomeUnknownError("rollback", new AggregateError([error, rollbackError], error instanceof Error ? error.message : String(error))); }
          throw error;
        }
        try {
          await this.endStream("COMMIT");
        } catch (error) {
          throw new DatabaseOutcomeUnknownError("commit", error);
        }
        return result;
      }),
    );
  }

  private async endStream(verb: "COMMIT" | "ROLLBACK" | undefined): Promise<void> {
    await this.streamTail;
    const stream = this.stream;
    if (stream === undefined) return;
    const requests: HranaPipelineRequest[] =
      verb === undefined ? [{ type: "close" }] : [{ type: "execute", stmt: toHranaStmt(verb, []) }, { type: "close" }];
    let cleanupStream = stream;
    try {
      const ended = await this.pipeline(requests, stream);
      if (ended.baton !== undefined) cleanupStream = { baton: ended.baton, url: ended.url };
      ended.results.forEach((entry, i) => decodeStreamResult(entry, i, requests[i]));
    } catch (error) {
      if (verb !== undefined) {
        try { await this.pipeline([{ type: "close" }], cleanupStream); }
        catch (closeError) { throw new AggregateError([error, closeError], error instanceof Error ? error.message : String(error)); }
      }
      throw error;
    } finally {
      this.stream = undefined;
    }
  }

  private async send(requests: HranaPipelineRequest[]): Promise<unknown[]> {
    if (this.stream !== undefined && inTransactionStatementScope() === false) {
      const allReads = requests.every((r) => r.type === "close" || /^\s*SELECT\b/i.test(r.stmt.sql));
      if (allReads) return this.sendNow(requests, true);
      return this.transaction(() => this.send(requests));
    }
    if (this.stream === undefined) return this.sendNow(requests);
    const run = this.streamTail.then(() => this.sendNow(requests));
    this.streamTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private streamTail: Promise<void> = Promise.resolve();

  private async sendNow(requests: HranaPipelineRequest[], forceStandalone = false): Promise<unknown[]> {
    const stream = forceStandalone ? undefined : this.stream;
    const all: HranaPipelineRequest[] = stream === undefined ? [...requests, { type: "close" }] : requests;
    const response = await this.pipeline(all, stream === undefined ? { url: this.pipelineUrl(this.baseUrl) } : stream);
    if (stream !== undefined) {
      if (response.baton === undefined) {
        this.stream = undefined;
        throw new LibSqlHttpError("libsql server closed the transaction's stream (no baton returned)");
      }
      this.stream = { baton: response.baton, url: response.url };
    }
    return response.results.map((entry, i) => decodeStreamResult(entry, i, all[i]));
  }

  private pipelineUrl(base: string): string {
    return `${base.replace(/\/+$/, "")}/v2/pipeline`;
  }

  private async pipeline(
    requests: HranaPipelineRequest[],
    target: { url: string; baton?: string },
  ): Promise<{ results: unknown[]; baton?: string; url: string }> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.authToken !== undefined) {
      headers.authorization = `Bearer ${this.authToken}`;
    }
    const response = await this.fetchImpl(target.url, {
      method: "POST",
      headers,
      body: JSON.stringify(target.baton === undefined ? { requests } : { baton: target.baton, requests }),
      signal: this.timeoutMs !== undefined ? AbortSignal.timeout(this.timeoutMs) : undefined,
    });
    if (!response.ok) {
      const bodySnippet = (await response.text().catch(() => "")).slice(0, 500);
      throw new LibSqlHttpError(
        `libsql pipeline request failed: HTTP ${response.status} ${response.statusText}${bodySnippet ? `: ${bodySnippet}` : ""}`,
        { status: response.status },
      );
    }
    const body = (await response.json()) as PipelineResponseBody;
    if (body === null || typeof body !== "object" || !Array.isArray(body.results)) {
      throw new LibSqlHttpError("libsql pipeline response has no results array (protocol violation)");
    }
    if (body.results.length !== requests.length) {
      throw new LibSqlHttpError(
        `libsql pipeline response count mismatch: sent ${requests.length} requests, got ${body.results.length} results`,
      );
    }
    const baton = typeof body.baton === "string" ? body.baton : undefined;
    const url = typeof body.base_url === "string" && body.base_url !== "" ? this.pipelineUrl(body.base_url) : target.url;
    return { results: body.results, baton, url };
  }
}

interface HranaStmtBody {
  sql: string;
  args: HranaWireValue[];
  want_rows: true;
}

type HranaPipelineRequest =
  | { type: "execute"; stmt: HranaStmtBody }
  | { type: "close" };

type HranaWireValue =
  | { type: "null" }
  | { type: "integer"; value: string }
  | { type: "float"; value: number }
  | { type: "text"; value: string }
  | { type: "blob"; base64: string };

const MIN_I64 = -(2n ** 63n);
const MAX_I64 = 2n ** 63n - 1n;

function toHranaStmt(sql: string, params: unknown[]): HranaStmtBody {
  return { sql, args: params.map(toHranaWireValue), want_rows: true };
}

function toHranaWireValue(value: unknown): HranaWireValue {
  if (value === null) return { type: "null" };
  if (typeof value === "bigint") {
    if (value < MIN_I64 || value > MAX_I64) {
      throw new RangeError(`libsql-http: bigint ${value} does not fit in a signed 64-bit integer`);
    }
    return { type: "integer", value: value.toString() };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`libsql-http: ${value} is not a finite number`);
    }
    if (Number.isSafeInteger(value)) {
      return { type: "integer", value: value.toString() };
    }
    return { type: "float", value };
  }
  if (typeof value === "string") return { type: "text", value };
  if (value instanceof Uint8Array) {
    return { type: "blob", base64: bytesToBase64(value) };
  }
  throw new TypeError(
    `libsql-http: unsupported parameter type ${describeType(value)}; supported: null, number, bigint, string, Uint8Array`,
  );
}

function describeType(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

interface PipelineResponseBody {
  baton?: string | null;
  base_url?: string | null;
  results?: unknown[];
}

function decodeStreamResult(entry: unknown, index: number, request: HranaPipelineRequest): unknown {
  if (entry === null || typeof entry !== "object") {
    throw new LibSqlHttpError(`libsql pipeline result ${index} is not an object`, { statementIndex: index });
  }
  const result = entry as { type?: string; response?: unknown; error?: { message?: string; code?: string } };
  if (result.type === "ok" || result.type === "response") {
    return decodeStreamResponse(result.response, index, request);
  }
  if (result.type === "error") {
    const message = result.error?.message ?? "unknown server error";
    const code = result.error?.code;
    throw new LibSqlHttpError(
      `libsql pipeline statement ${index} failed: ${message}${code ? ` (code ${code})` : ""}`,
      { code, statementIndex: index },
    );
  }
  throw new LibSqlHttpError(`libsql pipeline result ${index} has unknown type ${String(result.type)}`, {
    statementIndex: index,
  });
}

function decodeStreamResponse(response: unknown, index: number, request: HranaPipelineRequest): unknown {
  if (request.type === "close") {
    return null;
  }
  if (response === null || typeof response !== "object") {
    throw new LibSqlHttpError(`libsql pipeline response ${index} is not an object`, { statementIndex: index });
  }
  const resp = response as { type?: string; result?: unknown };
  if (resp.type !== "execute" && resp.type !== undefined) {
    throw new LibSqlHttpError(
      `libsql pipeline response ${index} has unexpected response type ${String(resp.type)}`,
      { statementIndex: index },
    );
  }
  const payload = resp.type === undefined ? resp : resp.result;
  return decodeExecResult(payload, index);
}

function decodeExecResult(payload: unknown, index: number): HranaExecResult {
  if (payload === null || typeof payload !== "object") {
    throw new LibSqlHttpError(`libsql execute result ${index} is not an object`, { statementIndex: index });
  }
  const p = payload as {
    cols?: unknown;
    rows?: unknown;
    affected_row_count?: unknown;
    last_insert_rowid?: unknown;
  };
  if (!Array.isArray(p.cols) || !Array.isArray(p.rows)) {
    throw new LibSqlHttpError(`libsql execute result ${index} is missing cols/rows`, { statementIndex: index });
  }
  const cols = p.cols.map((c, i) => {
    if (typeof c === "string") return { name: c };
    if (c !== null && typeof c === "object" && typeof (c as { name?: unknown }).name === "string") {
      const col = c as { name: string; decltype?: unknown };
      return {
        name: col.name,
        decltype: typeof col.decltype === "string" ? col.decltype : undefined,
      };
    }
    throw new LibSqlHttpError(`libsql execute result ${index} column ${i} is malformed`, { statementIndex: index });
  });
  const rows = p.rows.map((row, r) => {
    if (!Array.isArray(row)) {
      throw new LibSqlHttpError(`libsql execute result ${index} row ${r} is not an array`, { statementIndex: index });
    }
    return row.map((cell, c) => decodeHranaCell(cell, index, r, c));
  });
  const affectedRowCount = typeof p.affected_row_count === "number" ? p.affected_row_count : 0;
  const lastInsertRowId =
    p.last_insert_rowid === undefined || p.last_insert_rowid === null
      ? undefined
      : decodeHranaInteger(p.last_insert_rowid, `result ${index} last_insert_rowid`);
  return { cols, rows, affectedRowCount, lastInsertRowId };
}

function decodeHranaCell(cell: unknown, index: number, row: number, col: number): HranaValue {
  if (cell === null || typeof cell !== "object" || typeof (cell as { type?: unknown }).type !== "string") {
    throw new LibSqlHttpError(
      `libsql execute result ${index} cell [${row}][${col}] is not a tagged Hrana value`,
      { statementIndex: index },
    );
  }
  const v = cell as { type: string; value?: unknown; base64?: unknown };
  switch (v.type) {
    case "null":
      return null;
    case "integer":
      return decodeHranaInteger(v.value, `cell [${row}][${col}]`);
    case "float":
      if (typeof v.value !== "number") {
        throw new LibSqlHttpError(`libsql cell [${row}][${col}] float value is not a number`, {
          statementIndex: index,
        });
      }
      return v.value;
    case "text":
      if (typeof v.value !== "string") {
        throw new LibSqlHttpError(`libsql cell [${row}][${col}] text value is not a string`, {
          statementIndex: index,
        });
      }
      return v.value;
    case "blob":
      if (typeof v.base64 !== "string") {
        throw new LibSqlHttpError(`libsql cell [${row}][${col}] blob base64 is not a string`, {
          statementIndex: index,
        });
      }
      return base64ToBytes(v.base64);
    default:
      throw new LibSqlHttpError(`libsql cell [${row}][${col}] has unknown value type ${v.type}`, {
        statementIndex: index,
      });
  }
}

function decodeHranaInteger(value: unknown, what: string): number | bigint {
  if (typeof value === "number") return value;
  if (typeof value !== "string") {
    throw new LibSqlHttpError(`libsql ${what}: integer value is neither string nor number`);
  }
  const big = BigInt(value);
  return isSafeIntegerValue(big) ? Number(big) : big;
}

function isSafeIntegerValue(big: bigint): boolean {
  return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER);
}

function base64ToBytes(base64: string): Uint8Array {
  const buf = Buffer.from(base64, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function execResultToQueryResult<T>(result: HranaExecResult): SQLQueryResult<T> {
  const names = result.cols.map((c) => c.name);
  const rows = result.rows.map((cells) => {
    const row: Record<string, unknown> = {};
    names.forEach((name, i) => {
      row[name] = cells[i];
    });
    return row as T;
  });
  return {
    rows,
    rowsAffected: result.affectedRowCount,
    lastInsertRowId: result.lastInsertRowId,
  };
}
