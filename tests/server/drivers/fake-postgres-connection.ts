

import type { PostgresConnection, PostgresResult } from "../../../src/server/drivers/postgres.js";

export interface CapturedQuery {
  sql: string;
  params: unknown[];
}

export interface FakePostgresConnectionOptions {

  responses?: PostgresResult[];
}

export class FakePostgresConnection implements PostgresConnection {

  readonly queries: CapturedQuery[] = [];

  private readonly responses: PostgresResult[];

  private readonly scriptedErrors: Error[];

  private released = false;

  readonly unexpectedQueries: CapturedQuery[] = [];

  constructor(options: FakePostgresConnectionOptions = {}) {
    this.responses = options.responses ? [...options.responses] : [];
    this.scriptedErrors = [];
  }

  enqueueResult(result: PostgresResult): void {
    this.responses.push(result);
  }

  enqueueError(error: Error): void {
    this.scriptedErrors.push(error);
  }

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
