// FakePostgresConnection — a test fake for PostgresConnection.
//
// It does NOT execute SQL. Two roles, both exercised by the tests:
//
//   1. CAPTURE every (sql, params) the driver sends, in order. Tests
//      assert on the exact rewritten SQL and bound params — that is the
//      verifiable contract without a live PostgreSQL server.
//
//   2. QUEUE scripted PostgresResult responses. A test enqueues results
//      for the queries it expects; the fake hands them back in order
//      and throws after the queue drains (so an unexpected query fails
//      the test loudly rather than returning a plausible empty result).
//
// The fake is the ONLY way to exercise PostgresDriver's contract on a
// machine without a PostgreSQL server. Every assertion it enables is on
// the dialect rewrite + the driver shape, NOT on real PG behavior —
// byte-parity vs Ruby requires the live-PG rung (see
// docs/postgres-dialect-notes.md "Live-PG rung").

import type { PostgresConnection, PostgresResult } from "../../../src/server/drivers/postgres.js";

export interface CapturedQuery {
  sql: string;
  params: unknown[];
}

export interface FakePostgresConnectionOptions {
  /** Initial response queue. The fake pops from the head of this list
   *  for each `query()` call. If unset, the fake throws on the first
   *  query (so a test that forgot to script responses fails fast). */
  responses?: PostgresResult[];
}

export class FakePostgresConnection implements PostgresConnection {
  /** Every query the driver sent, in arrival order. */
  readonly queries: CapturedQuery[] = [];
  /** Scripted responses, consumed in order. The constructor copies the
   *  input so tests can keep mutating their local array. */
  private readonly responses: PostgresResult[];
  /** Optional explicit errors to throw from `query()` instead of
   *  returning a result. Drained in order; consumed before the
   *  `responses` queue at the same index. */
  private readonly scriptedErrors: Error[];
  /** Set to true after release(); subsequent query() calls throw. */
  private released = false;
  /** Any query() that fell off the end of the queues threw — recorded
   *  here so a test can assert what would have happened. */
  readonly unexpectedQueries: CapturedQuery[] = [];

  constructor(options: FakePostgresConnectionOptions = {}) {
    this.responses = options.responses ? [...options.responses] : [];
    this.scriptedErrors = [];
  }

  /** Queue one PostgresResult. Convenience for tests. */
  enqueueResult(result: PostgresResult): void {
    this.responses.push(result);
  }

  /** Queue one error to throw from the next query() call (FIFO with
   *  enqueueResult — the test sets the order explicitly). The error
   *  takes precedence over the next queued result if both are present. */
  enqueueError(error: Error): void {
    this.scriptedErrors.push(error);
  }

  /** Drop a queued result. Useful for tests that want to confirm the
   *  driver does NOT issue a query. */
  expectNoMoreQueries(): void {
    if (this.scriptedErrors.length > 0 || this.responses.length > 0) {
      throw new Error(
        `FakePostgresConnection: ${this.scriptedErrors.length + this.responses.length} ` +
          `scripted response(s) left over (driver sent ${this.queries.length} queries)`,
      );
    }
  }

  async query(sql: string, params: unknown[]): Promise<PostgresResult> {
    if (this.released) {
      throw new Error("FakePostgresConnection: query() called after release()");
    }
    this.queries.push({ sql, params });
    const error = this.scriptedErrors.shift();
    if (error !== undefined) throw error;
    const next = this.responses.shift();
    if (next === undefined) {
      this.unexpectedQueries.push({ sql, params });
      throw new Error(
        `FakePostgresConnection: no scripted response for query ${this.queries.length} ` +
          `(SQL: ${sql.slice(0, 200)})`,
      );
    }
    return next;
  }

  release(): void {
    this.released = true;
  }
}
