import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement, SQLTransactionGuarantee, PrefetchOutcome } from "../../server/driver.js";
import { DatabaseOutcomeUnknownError, isDatabaseBusyError, retryWhileBusy, TransactionGate } from "../../server/driver.js";
import { inTransactionStatementScope, runInTransactionStatementScope } from "../../server/transaction-statement-scope.js";

export interface BunnyDbOptions {
  url?: string;
  authToken?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  queryCounter?: BunnyDbQueryCounter;
}

export const DEFAULT_PIPELINE_TIMEOUT_MS = 15_000;

export const DEFAULT_PIPELINE_RETRIES = 1;

export const PIPELINE_RETRY_BACKOFF_MS = 120;

export class BunnyDbError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly statementIndex?: number;
  readonly transport: boolean;

  constructor(
    message: string,
    opts: {
      status?: number;
      code?: string;
      statementIndex?: number;
      transport?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "BunnyDbError";
    this.status = opts.status;
    this.code = opts.code;
    this.statementIndex = opts.statementIndex;
    this.transport = opts.transport === true;
  }
}

export interface BunnyDbQueryCounterLike {
  recordQuery(sql: string): void;
  count(): number;
  reset(): void;
}

export class NoopBunnyDbQueryCounter implements BunnyDbQueryCounterLike {
  recordQuery(_sql: string): void {
  }
  count(): number {
    return 0;
  }
  reset(): void {
  }
}

export class BunnyDbQueryCounter implements BunnyDbQueryCounterLike {
  private n = 0;
  private readonly recent: string[] = [];
  private readonly recentLimit: number;

  constructor(opts: { captureSql?: boolean; recentLimit?: number } = {}) {
    this.recentLimit = opts.captureSql ? Math.max(0, opts.recentLimit ?? 32) : 0;
  }

  recordQuery(sql: string): void {
    this.n += 1;
    if (this.recentLimit > 0) {
      if (this.recent.length >= this.recentLimit) this.recent.shift();
      this.recent.push(sql);
    }
  }

  count(): number {
    return this.n;
  }

  reset(): void {
    this.n = 0;
    this.recent.length = 0;
  }

  recentSql(): string[] {
    return this.recent.slice();
  }
}

interface BunnyDbExecResult {
  cols: { name: string; decltype?: string | null }[];
  rows: BunnyDbCell[][];
  affectedRowCount: number;
  lastInsertRowId?: number | bigint;
}

type BunnyDbCell = null | number | bigint | string | Uint8Array;

const DEFAULT_NOOP_COUNTER: BunnyDbQueryCounterLike = new NoopBunnyDbQueryCounter();

export class BunnyDbDriver implements SQLDatabaseDriver {
  readonly cqlRegexpSemantics = "incompatible" as const;
  private readonly pipelineUrl: string;
  private readonly authToken?: string;
  private readonly timeoutMs?: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly counter: BunnyDbQueryCounterLike;

  constructor(options: BunnyDbOptions = {}) {
    const { url, authToken, timeoutMs, retries, fetchImpl, queryCounter } = options;

    const resolvedUrl = url ?? readEnv("BUNNY_DB_URL");
    if (resolvedUrl === undefined || resolvedUrl.trim() === "") {
      throw new BunnyDbError(
        "BunnyDbDriver: no URL configured (set BUNNY_DB_URL or pass options.url)",
      );
    }
    const base = resolvedUrl.trim().replace(/\/+$/, "");
    this.pipelineUrl = base.endsWith("/v2/pipeline") ? base : `${base}/v2/pipeline`;

    const resolvedToken = authToken ?? readEnv("BUNNY_DB_TOKEN");
    if (resolvedToken !== undefined && resolvedToken !== "") {
      this.authToken = resolvedToken;
    }
    this.timeoutMs =
      timeoutMs === undefined
        ? DEFAULT_PIPELINE_TIMEOUT_MS
        : timeoutMs > 0
          ? timeoutMs
          : undefined;
    this.retries =
      retries === undefined ? DEFAULT_PIPELINE_RETRIES : Math.max(0, Math.trunc(retries));
    this.fetchImpl = fetchImpl ?? fetch.bind(globalThis);
    this.counter = queryCounter ?? DEFAULT_NOOP_COUNTER;
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
  private streamTail: Promise<void> = Promise.resolve();
  private streamOpenedAt = 0;
  private transactionFailure: BunnyDbError | undefined;

  private assertTransactionUsable(): void {
    if (this.transactionFailure !== undefined && inTransactionStatementScope() !== false) throw this.transactionFailure;
  }

  private readMemo: Map<string, ReadMemoEntry> | undefined;
  private phaseReadMemo: Map<string, ReadMemoEntry> | undefined;
  private producedValues: Set<string> = new Set();
  private triggerGraph: Promise<Map<string, Set<string> | null>> | undefined;
  private triggerGraphMap: Map<string, Set<string> | null> | undefined;
  private triggerGraphUsable = true;

  private resetTriggerGraph(): void {
    this.triggerGraph = undefined;
    this.triggerGraphMap = undefined;
    this.triggerGraphUsable = true;
  }

  private clearReadMemo(): void {
    this.readMemo = undefined;
  }

  private memoInForce(): Map<string, ReadMemoEntry> | undefined {
    if (this.stream !== undefined) return this.readMemo;
    return this.phaseReadMemo;
  }

  async readPhase<R>(work: () => Promise<R>): Promise<R> {
    if (this.phaseReadMemo !== undefined) return work();
    this.phaseReadMemo = new Map();
    try {
      return await work();
    } finally {
      this.phaseReadMemo = undefined;
      if (this.stream === undefined) this.resetTriggerGraph();
    }
  }

  private decodeOnStream(results: unknown[], requests: HranaPipelineRequest[]): unknown[] {
    const decode = (entry: unknown, i: number): unknown => {
      try {
        return decodeStreamResult(entry, i, requests[i]);
      } catch (error) {
        if (!(error instanceof BunnyDbError) || error.code !== "TRANSACTION_TIMEOUT") throw error;
        const request = requests[i];
        const sql = request.type === "execute" ? request.stmt.sql.replace(/\s+/g, " ").slice(0, 80) : request.type;
        const failure = new BunnyDbError(
          `${error.message} after the transaction had been open ${Date.now() - this.streamOpenedAt} ms; refused statement: ${sql}`,
          { code: error.code, statementIndex: error.statementIndex },
        );
        this.transactionFailure = failure;
        this.clearReadMemo();
        throw failure;
      }
    };
    const expired = results.findIndex((entry) => {
      const result = entry as { type?: string; error?: { code?: string } } | null;
      return result?.type === "error" && result.error?.code === "TRANSACTION_TIMEOUT";
    });
    if (expired >= 0) decode(results[expired], expired);
    return results.map(decode);
  }

  async transaction<R>(work: () => Promise<R>): Promise<R> {
    return this.gate.run(async () =>
      runInTransactionStatementScope(async () => {
        await retryWhileBusy(
          async () => {
            const begin: HranaPipelineRequest[] = [{ type: "execute", stmt: toHranaStmt("BEGIN IMMEDIATE", []) }];
            const opened = await this.streamPipeline(begin, { url: this.pipelineUrl });
            try {
              opened.results.forEach((entry, i) => decodeStreamResult(entry, i, begin[i]));
            } catch (error) {
              if (opened.baton !== undefined) {
                await this.streamPipeline([{ type: "close" }], { baton: opened.baton, url: opened.url }).catch(() => undefined);
              }
              throw error;
            }
            if (opened.baton === undefined) {
              throw new BunnyDbError(
                "BunnyDb did not keep the stream open (no baton returned): interactive sessions are not available on this database, and an atomic save needs one (docs/decisions/0007-atomic-saves-and-transaction-contract.md)",
              );
            }
            this.stream = { baton: opened.baton, url: opened.url };
          },
          undefined,
          undefined,
          isBunnyBeginBusy,
        );
        this.streamOpenedAt = Date.now();
        this.transactionFailure = undefined;
        this.readMemo = new Map();
        this.resetTriggerGraph();
        this.phaseReadMemo?.clear();
        let result: R;
        try {
          result = await work();
          this.assertTransactionUsable();
        } catch (error) {
          try { await this.endStream("ROLLBACK"); }
          catch (rollbackError) { throw new DatabaseOutcomeUnknownError("rollback", new AggregateError([error, rollbackError], error instanceof Error ? error.message : String(error))); }
          throw error;
        }
        try {
          await this.endStream("COMMIT");      } catch (error) {
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
      const ended = await this.streamPipeline(requests, stream);
      if (ended.baton !== undefined) cleanupStream = { baton: ended.baton, url: ended.url };
      this.decodeOnStream(ended.results, requests);
    } catch (error) {
      if (verb !== undefined) {
        try { await this.streamPipeline([{ type: "close" }], cleanupStream); }
        catch (closeError) { throw new AggregateError([error, closeError], error instanceof Error ? error.message : String(error)); }
      }
      throw error;
    } finally {
      this.stream = undefined;
      this.transactionFailure = undefined;
      this.clearReadMemo();
    }
  }

  private sendOnStream(requests: HranaPipelineRequest[]): Promise<unknown[]> {
    const run = this.streamTail.then(async () => {
      this.assertTransactionUsable();
      const stream = this.stream;
      if (stream === undefined) throw new BunnyDbError("BunnyDb transaction stream is closed");
      const response = await this.streamPipeline(requests, stream);
      if (response.baton === undefined) {
        this.stream = undefined;
        this.clearReadMemo();
        throw new BunnyDbError("BunnyDb closed the transaction's stream (no baton returned)");
      }
      this.stream = { baton: response.baton, url: response.url };
      return this.decodeOnStream(response.results, requests);
    });
    this.streamTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async sendRead(requests: HranaPipelineRequest[]): Promise<unknown[]> {
    if (this.stream !== undefined) return this.sendOnStream(requests);
    const results = await this.pipeline([...requests, { type: "close" }]);
    return results.slice(0, requests.length);
  }

  private async streamPipeline(
    requests: HranaPipelineRequest[],
    target: { url: string; baton?: string },
  ): Promise<{ results: unknown[]; baton?: string; url: string }> {
    const headers: Record<string, string> = { "content-type": "application/json", "accept-encoding": "gzip, identity" };
    if (this.authToken !== undefined) headers.authorization = `Bearer ${this.authToken}`;
    let response: Response;
    try {
      response = await this.fetchImpl(target.url, {
        method: "POST",
        headers,
        body: JSON.stringify(target.baton === undefined ? { requests } : { baton: target.baton, requests }),
        signal: this.timeoutMs !== undefined ? AbortSignal.timeout(this.timeoutMs) : undefined,
      });
    } catch (cause) {
      throw new BunnyDbError(`BunnyDb pipeline transport failed: ${describeTransportError(cause)}`, { transport: true });
    }
    if (!response.ok) {
      const bodySnippet = (await response.text().catch(() => "")).slice(0, 500);
      throw new BunnyDbError(
        `BunnyDb pipeline request failed: HTTP ${response.status} ${response.statusText}${bodySnippet ? `: ${bodySnippet}` : ""}`,
        { status: response.status },
      );
    }
    const decoded = (await readPipelineJson(response)) as PipelineResponseBody;
    if (decoded === null || typeof decoded !== "object" || !Array.isArray(decoded.results)) {
      throw new BunnyDbError("BunnyDb pipeline response has no results array (protocol violation)");
    }
    if (decoded.results.length !== requests.length) {
      throw new BunnyDbError(
        `BunnyDb pipeline response count mismatch: sent ${requests.length} requests, got ${decoded.results.length} results`,
      );
    }
    const baton = typeof decoded.baton === "string" ? decoded.baton : undefined;
    const url =
      typeof decoded.base_url === "string" && decoded.base_url !== ""
        ? `${decoded.base_url.replace(/\/+$/, "")}/v2/pipeline`
        : target.url;
    return { results: decoded.results, baton, url };
  }

  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    this.assertTransactionUsable();
    const stmt = toHranaStmt(sql, params);
    if (this.stream !== undefined && inTransactionStatementScope() === false) {
      if (cachedSqlFacts(sql).isRead) {
        this.counter.recordQuery(sql);
        const results = await this.pipeline([{ type: "execute", stmt }, { type: "close" }]);
        return execResultToQueryResult<T>(results[0] as BunnyDbExecResult);
      }
      return this.transaction(() => this.query<T>(sql, params));
    }
    const memo = this.memoInForce();
    const facts = memo !== undefined ? cachedSqlFacts(sql) : undefined;
    if (memo !== undefined && facts !== undefined && facts.isRead) {
      const key = readMemoKey(sql, stmt.args);
      const hit = memo.get(key);
      if (hit !== undefined) return execResultToQueryResult<T>(hit.result);
      this.counter.recordQuery(sql);
      const fresh = (await this.sendRead([{ type: "execute", stmt }]))[0] as BunnyDbExecResult;
      this.recordProduced(fresh);
      memo.set(key, { dependsOn: facts.dependsOn, pinned: pinRead(facts, stmt.args), result: fresh });
      return execResultToQueryResult<T>(fresh);
    }
    this.counter.recordQuery(sql);
    if (this.stream !== undefined) {
      const onStream = await this.sendOnStream([{ type: "execute", stmt }]);
      this.recordProduced(onStream[0] as BunnyDbExecResult);
      const written = onStream[0] as BunnyDbExecResult;
      if (memo !== undefined) await this.invalidateReadMemo(sql, stmt.args, written.lastInsertRowId);
      return execResultToQueryResult<T>(onStream[0] as BunnyDbExecResult);
    }
    const results = await this.pipeline([
      { type: "execute", stmt },
      { type: "close" },
    ]);
    const first = results[0] as BunnyDbExecResult;
    this.recordProduced(first);
    if (memo !== undefined) await this.invalidateReadMemo(sql, stmt.args, first.lastInsertRowId);
    return execResultToQueryResult<T>(first);
  }

  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    this.assertTransactionUsable();
    if (statements.length === 0) return [];
    if (this.stream !== undefined && inTransactionStatementScope() === false) {
      const allReads = statements.every((s) => cachedSqlFacts(s.sql).isRead);
      if (allReads) {
        const requests: HranaPipelineRequest[] = statements.map((s) => ({ type: "execute", stmt: toHranaStmt(s.sql, s.params) }));
        for (const s of statements) this.counter.recordQuery(s.sql);
        const raw = (await this.pipeline([...requests, { type: "close" }])).slice(0, requests.length) as BunnyDbExecResult[];
        return raw.map((result) => execResultToQueryResult<unknown>(result));
      }
      return this.transaction(() => this.batch(statements));
    }
    const memo = this.memoInForce();

    const requests: HranaPipelineRequest[] = [];
    const plan: Array<{
      hit: ReadMemoEntry | null;
      store: { key: string; dependsOn: Set<string> | null; pinned: PinnedRead | null } | null;
    }> = [];
    for (const s of statements) {
      const stmt = toHranaStmt(s.sql, s.params);
      const batchFacts = memo !== undefined ? cachedSqlFacts(s.sql) : undefined;
      if (memo !== undefined && batchFacts !== undefined && batchFacts.isRead) {
        const key = readMemoKey(s.sql, stmt.args);
        const hit = memo.get(key);
        if (hit !== undefined) {
          plan.push({ hit, store: null });
          continue;
        }
        this.counter.recordQuery(s.sql);
        requests.push({ type: "execute", stmt });
        plan.push({
          hit: null,
          store: { key, dependsOn: batchFacts.dependsOn, pinned: pinRead(batchFacts, stmt.args) },
        });
        continue;
      }
      if (memo !== undefined) await this.invalidateReadMemo(s.sql, stmt.args);
      this.counter.recordQuery(s.sql);
      requests.push({ type: "execute", stmt });
      plan.push({ hit: null, store: null });
    }

    let raw: BunnyDbExecResult[];
    if (requests.length === 0) {
      raw = [];
    } else if (this.stream !== undefined) {
      raw = (await this.sendOnStream(requests)) as BunnyDbExecResult[];
    } else {
      raw = (await this.pipeline([...requests, { type: "close" }])).slice(0, requests.length) as BunnyDbExecResult[];
    }

    for (const result of raw) this.recordProduced(result);
    const answers: SQLQueryResult[] = [];
    let taken = 0;
    for (const p of plan) {
      if (p.hit !== null) {
        answers.push(execResultToQueryResult<unknown>(p.hit.result));
        continue;
      }
      const result = raw[taken];
      taken += 1;
      answers.push(execResultToQueryResult<unknown>(result));
      if (memo !== undefined && p.store !== null) {
        memo.set(p.store.key, { dependsOn: p.store.dependsOn, pinned: p.store.pinned, result });
      }
    }
    return answers;
  }

  async prefetchReads(statements: SQLStatement[]): Promise<PrefetchOutcome[]> {
    this.assertTransactionUsable();
    const outcomes: PrefetchOutcome[] = statements.map(() => ({ result: undefined, unverified: true }));
    if (statements.length === 0) return outcomes;
    const memo = this.memoInForce();
    if (memo === undefined) return outcomes;

    const wanted: Array<{ statement: SQLStatement; index: number }> = [];
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index] as SQLStatement;
      const facts = cachedSqlFacts(statement.sql);
      if (!facts.isRead) continue;
      const key = readMemoKey(statement.sql, toHranaStmt(statement.sql, statement.params).args);
      const hit = memo.get(key);
      if (hit !== undefined) {
        outcomes[index] = { result: execResultToQueryResult<unknown>(hit.result), unverified: false };
        continue;
      }
      wanted.push({ statement, index });
    }
    if (wanted.length === 0) return outcomes;

    for (const run of admittedRuns(wanted)) {
      await this.speculateRun(run, memo, outcomes);
    }
    return outcomes;
  }

  private recordProduced(result: BunnyDbExecResult | undefined): void {
    if (result === undefined) return;
    for (const value of producedValueKeys(result)) this.producedValues.add(value);
    if (this.producedValues.size > PRODUCED_VALUE_SET_CAP) this.producedValues = new Set();
  }

  private async speculateRun(
    run: Array<{ statement: SQLStatement; index: number }>,
    memo: Map<string, ReadMemoEntry>,
    outcomes: PrefetchOutcome[],
  ): Promise<void> {
    const requests: HranaPipelineRequest[] = run.map(({ statement }) => ({
      type: "execute",
      stmt: toHranaStmt(statement.sql, statement.params),
    }));
    for (const { statement } of run) this.counter.recordQuery(statement.sql);
    let raw: BunnyDbExecResult[];
    try {
      raw = (await this.sendRead(requests)) as BunnyDbExecResult[];
    } catch {
      this.assertTransactionUsable();
      return;
    }
    const producedBefore = new Set(this.producedValues);
    const produced: Array<Set<string>> = [];
    const bound: Array<Set<string>> = [];
    for (let i = 0; i < raw.length; i += 1) {
      const fresh = producedValueKeys(raw[i] as BunnyDbExecResult);
      for (const value of [...fresh]) if (producedBefore.has(value)) fresh.delete(value);
      produced.push(fresh);
      const request = requests[i] as HranaPipelineRequest;
      bound.push(request.type === "execute" ? boundValueKeys(request.stmt.args) : new Set<string>());
    }
    let trusted = raw.length;
    for (let i = 0; i < raw.length; i += 1) {
      const binds = bound[i] as Set<string>;
      if (binds.size === 0) continue;
      for (let j = 0; j < i; j += 1) {
        const earlier = produced[j] as Set<string>;
        if (earlier.size === 0) continue;
        let shared = false;
        for (const value of binds) {
          if (earlier.has(value)) { shared = true; break; }
        }
        if (!shared) continue;
        trusted = i;
        break;
      }
    }
    for (const result of raw) this.recordProduced(result);
    for (let i = 0; i < run.length; i += 1) {
      const entry = run[i] as { statement: SQLStatement; index: number };
      const result = raw[i] as BunnyDbExecResult;
      if (i >= trusted) {
        outcomes[entry.index] = { result: undefined, unverified: true };
        continue;
      }
      const facts = cachedSqlFacts(entry.statement.sql);
      memo.set(
        readMemoKey(entry.statement.sql, toHranaStmt(entry.statement.sql, entry.statement.params).args),
        { dependsOn: facts.dependsOn, pinned: pinRead(facts, toHranaStmt(entry.statement.sql, entry.statement.params).args), result },
      );
      outcomes[entry.index] = { result: execResultToQueryResult<unknown>(result), unverified: false };
    }
  }

  queryCount(): number {
    return this.counter.count();
  }

  private async loadTriggerGraph(): Promise<void> {
    if (this.triggerGraph !== undefined) { await this.triggerGraph; return; }
    this.triggerGraph = (async () => {
      const graph = new Map<string, Set<string> | null>();
      let rows: BunnyDbExecResult;
      try {
        const triggerSql = "SELECT tbl_name, sql FROM sqlite_master WHERE type = 'trigger'";
        const hit = this.memoInForce()?.get(readMemoKey(triggerSql, []));
        if (hit !== undefined) {
          rows = hit.result;
        } else {
          rows = (await this.sendRead([
            {
              type: "execute",
              stmt: toHranaStmt(triggerSql, []),
            },
          ]))[0] as BunnyDbExecResult;
        }
      } catch {
        this.triggerGraphUsable = false;
        return graph;
      }
      for (const row of rows.rows) {
        const tbl = row[0];
        if (typeof tbl !== "string") continue;
        const name = tbl.toLowerCase();
        if (graph.get(name) === null) continue;
        const targets = triggerWriteTargets(typeof row[1] === "string" ? row[1] : "");
        if (targets === null) {
          graph.set(name, null);
          continue;
        }
        graph.set(name, new Set([...(graph.get(name) ?? []), ...targets]));
      }
      this.triggerGraphMap = graph;
      return graph;
    })();
    await this.triggerGraph;
  }

  private writeEffect(target: string): Set<string> | null {
    if (!this.triggerGraphUsable || this.triggerGraphMap === undefined) return null;
    const viaTriggers = this.triggerGraphMap.get(target);
    if (viaTriggers === null) return null;
    return new Set([target, ...(viaTriggers ?? [])]);
  }

  private async invalidateReadMemo(
    sql: string,
    args: HranaWireValue[],
    insertedRowId?: number | bigint,
  ): Promise<void> {
    const memo = this.memoInForce();
    if (memo === undefined) return;
    const facts = cachedSqlFacts(sql);
    const target = facts.writeTarget;
    if (target === null) {
      memo.clear();
      return;
    }
    await this.loadTriggerGraph();
    const effect = this.writeEffect(target);
    if (effect === null) {
      memo.clear();
      return;
    }
    const writePin = facts.isRead ? null : pinWrite(facts, args, insertedRowId);
    const viaTriggers = this.triggerGraphMap?.get(target);
    const triggerTouchesTarget = viaTriggers !== null && viaTriggers !== undefined && viaTriggers.has(target);
    for (const [key, entry] of memo) {
      if (entry.dependsOn === null) { memo.delete(key); continue; }
      let affects = false;
      for (const t of effect) {
        if (entry.dependsOn.has(t)) { affects = true; break; }
      }
      if (!affects) continue;
      if (writePin !== null && entry.pinned !== null) {
        const effect = writeEffectOnRead(entry.pinned, writePin, entry.result, triggerTouchesTarget);
        if (effect === "disjoint") continue;
      }
      memo.delete(key);
    }
  }

  private async pipeline(requests: HranaPipelineRequest[]): Promise<unknown[]> {
    const headers: Record<string, string> = { "content-type": "application/json", "accept-encoding": "gzip, identity" };
    if (this.authToken !== undefined) {
      headers.authorization = `Bearer ${this.authToken}`;
    }
    const body = JSON.stringify({ requests });
    const replaySafe = requests.every((request) => request.type === "close" ||
      (cachedSqlFacts(request.stmt.sql).isRead &&
        !/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i.test(stripSqlNoise(request.stmt.sql))));
    const retries = replaySafe ? this.retries : 0;

    let lastError: BunnyDbError | undefined;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) await delay(PIPELINE_RETRY_BACKOFF_MS);
      try {
        return await this.attemptPipeline(headers, body, requests);
      } catch (err) {
        if (!replaySafe && (!(err instanceof BunnyDbError) || err.statementIndex === undefined)) {
          this.clearReadMemo();
          this.phaseReadMemo?.clear();
          throw new DatabaseOutcomeUnknownError("statement", err);
        }
        if (err instanceof BunnyDbError && !isRetryablePipelineError(err)) throw err;
        lastError = err instanceof BunnyDbError ? err : new BunnyDbError(String(err));
        if (attempt === retries) break;
      }
    }
    throw (
      lastError ??
      new BunnyDbError("BunnyDb pipeline failed with no recorded error (unreachable)")
    );
  }

  private async attemptPipeline(
    headers: Record<string, string>,
    body: string,
    requests: HranaPipelineRequest[],
  ): Promise<unknown[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.pipelineUrl, {
        method: "POST",
        headers,
        body,
        signal:
          this.timeoutMs !== undefined ? AbortSignal.timeout(this.timeoutMs) : undefined,
      });
    } catch (cause) {
      throw new BunnyDbError(
        `BunnyDb pipeline transport failed: ${describeTransportError(cause)}`,
        { transport: true },
      );
    }
    if (!response.ok) {
      const bodySnippet = (await response.text().catch(() => "")).slice(0, 500);
      throw new BunnyDbError(
        `BunnyDb pipeline request failed: HTTP ${response.status} ${response.statusText}${
          bodySnippet ? `: ${bodySnippet}` : ""
        }`,
        { status: response.status },
      );
    }
    const decoded = (await readPipelineJson(response)) as PipelineResponseBody;
    if (decoded === null || typeof decoded !== "object" || !Array.isArray(decoded.results)) {
      throw new BunnyDbError(
        "BunnyDb pipeline response has no results array (protocol violation)",
      );
    }
    if (decoded.results.length !== requests.length) {
      throw new BunnyDbError(
        `BunnyDb pipeline response count mismatch: sent ${requests.length} requests, got ${decoded.results.length} results`,
      );
    }
    return decoded.results.map((entry, i) => decodeStreamResult(entry, i, requests[i]));
  }
}

async function readPipelineJson(response: Response): Promise<unknown> {
  if (typeof response.arrayBuffer !== "function") return await response.json();
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream !== "function") {
      throw new BunnyDbError("BunnyDb pipeline response is gzip-compressed and this runtime cannot inflate it");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BunnyDbError("BunnyDb pipeline response is not JSON (protocol violation)");
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
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "bigint") {
    if (value < MIN_I64 || value > MAX_I64) {
      throw new RangeError(
        `bunny-db: bigint ${value} does not fit in a signed 64-bit integer`,
      );
    }
    return { type: "integer", value: value.toString() };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`bunny-db: ${value} is not a finite number`);
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
    `bunny-db: unsupported parameter type ${describeType(value)}; supported: null, number, bigint, string, Uint8Array`,
  );
}

function describeType(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64",
  );
}

interface PipelineResponseBody {
  baton?: string | null;
  base_url?: string | null;
  results?: unknown[];
}

function decodeStreamResult(
  entry: unknown,
  index: number,
  request: HranaPipelineRequest,
): unknown {
  if (entry === null || typeof entry !== "object") {
    throw new BunnyDbError(`BunnyDb pipeline result ${index} is not an object`, {
      statementIndex: index,
    });
  }
  const result = entry as {
    type?: string;
    response?: unknown;
    error?: { message?: string; code?: string };
  };
  if (result.type === "ok" || result.type === "response") {
    return decodeStreamResponse(result.response, index, request);
  }
  if (result.type === "error") {
    const message = result.error?.message ?? "unknown server error";
    const code = result.error?.code;
    throw new BunnyDbError(
      `BunnyDb pipeline statement ${index} failed: ${message}${
        code ? ` (code ${code})` : ""
      }`,
      { code, statementIndex: index },
    );
  }
  throw new BunnyDbError(
    `BunnyDb pipeline result ${index} has unknown type ${String(result.type)}`,
    { statementIndex: index },
  );
}

function decodeStreamResponse(
  response: unknown,
  index: number,
  request: HranaPipelineRequest,
): unknown {
  if (request.type === "close") {
    return null;
  }
  if (response === null || typeof response !== "object") {
    throw new BunnyDbError(`BunnyDb pipeline response ${index} is not an object`, {
      statementIndex: index,
    });
  }
  const resp = response as { type?: string; result?: unknown };
  if (resp.type !== "execute" && resp.type !== undefined) {
    throw new BunnyDbError(
      `BunnyDb pipeline response ${index} has unexpected response type ${String(
        resp.type,
      )}`,
      { statementIndex: index },
    );
  }
  const payload = resp.type === undefined ? resp : resp.result;
  return decodeExecResult(payload, index);
}

function decodeExecResult(payload: unknown, index: number): BunnyDbExecResult {
  if (payload === null || typeof payload !== "object") {
    throw new BunnyDbError(
      `BunnyDb execute result ${index} is not an object`,
      { statementIndex: index },
    );
  }
  const p = payload as {
    cols?: unknown;
    rows?: unknown;
    affected_row_count?: unknown;
    last_insert_rowid?: unknown;
  };
  if (!Array.isArray(p.cols) || !Array.isArray(p.rows)) {
    throw new BunnyDbError(
      `BunnyDb execute result ${index} is missing cols/rows`,
      { statementIndex: index },
    );
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
    throw new BunnyDbError(
      `BunnyDb execute result ${index} column ${i} is malformed`,
      { statementIndex: index },
    );
  });
  const rows = p.rows.map((row, r) => {
    if (!Array.isArray(row)) {
      throw new BunnyDbError(
        `BunnyDb execute result ${index} row ${r} is not an array`,
        { statementIndex: index },
      );
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

function decodeHranaCell(
  cell: unknown,
  index: number,
  row: number,
  col: number,
): BunnyDbCell {
  if (cell === null || typeof cell !== "object" || typeof (cell as { type?: unknown }).type !== "string") {
    throw new BunnyDbError(
      `BunnyDb execute result ${index} cell [${row}][${col}] is not a tagged Hrana value`,
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
        throw new BunnyDbError(
          `BunnyDb cell [${row}][${col}] float value is not a number`,
          { statementIndex: index },
        );
      }
      return v.value;
    case "text":
      if (typeof v.value !== "string") {
        throw new BunnyDbError(
          `BunnyDb cell [${row}][${col}] text value is not a string`,
          { statementIndex: index },
        );
      }
      return v.value;
    case "blob":
      if (typeof v.base64 !== "string") {
        throw new BunnyDbError(
          `BunnyDb cell [${row}][${col}] blob base64 is not a string`,
          { statementIndex: index },
        );
      }
      return base64ToBytes(v.base64);
    default:
      throw new BunnyDbError(
        `BunnyDb cell [${row}][${col}] has unknown value type ${v.type}`,
        { statementIndex: index },
      );
  }
}

function decodeHranaInteger(value: unknown, what: string): number | bigint {
  if (typeof value === "number") return value;
  if (typeof value !== "string") {
    throw new BunnyDbError(`BunnyDb ${what}: integer value is neither string nor number`);
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

interface ReadMemoEntry {
  dependsOn: Set<string> | null;
  pinned: PinnedRead | null;
  result: BunnyDbExecResult;
}

interface PinnedRead {
  table: string;
  columns: Set<string>;
  values: Map<string, string>;
  conjuncts: Array<{ column: string; value: string }>;
  projected: Set<string> | null;
}

interface PinnedWrite {
  table: string;
  assigned: Set<string>;
  values: Map<string, string>;
  addsRow: boolean;
  rowValues: Map<string, string>;
}

function stripSqlNoise(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue; }
          i += 1;
          break;
        }
        i += 1;
      }
      out += " ";
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

interface SqlFacts {
  isRead: boolean;
  isInsert: boolean;
  singleRowInsert: boolean;
  writeTarget: string | null;
  dependsOn: Set<string> | null;
  predicate: WherePin | null;
  assigned: Set<string> | null;
  insertShape: InsertShape | null;
  projected: Set<string> | null;
}

interface InsertShape {
  columns: string[];
  values: Array<{ argIndex: number } | { literal: string } | null>;
}

interface WherePin {
  table: string;
  columns: Set<string>;
  equalities: Array<{ column: string; argIndex: number }>;
  literals: Array<{ column: string; literal: string }>;
}

function normalizeIdentifierQuotes(sql: string): string {
  return sql
    .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, "$1")
    .replace(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g, "$1")
    .replace(/`([A-Za-z_][A-Za-z0-9_]*)`/g, "$1");
}

const CONJUNCT = /^\s*\+?([A-Za-z_][A-Za-z0-9_]*)\s*(=|<>|!=|<=|>=|<|>)\s*(\?|[0-9]+(?:\.[0-9]+)?|NULL)\s*$/i;

function predicateOf(stripped: string, table: string | null, argOffset: number): WherePin | null {
  if (table === null) return null;
  const where = /\bWHERE\b([\s\S]*?)(?=\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT)\b|$)/i.exec(stripped)?.[1];
  if (where === undefined) return null;
  if (/[()]/.test(where)) return null;
  const columns = new Set<string>();
  const equalities: Array<{ column: string; argIndex: number }> = [];
  const literals: Array<{ column: string; literal: string }> = [];
  let argIndex = argOffset;
  for (const conjunct of where.split(/\s+AND\s+/i)) {
    const m = CONJUNCT.exec(conjunct);
    if (m === null || m[2] !== "=") return null;
    columns.add(m[1].toLowerCase());
    if (m[3] === "?") {
      equalities.push({ column: m[1].toLowerCase(), argIndex });
      argIndex += 1;
    } else {
      literals.push({ column: m[1].toLowerCase(), literal: m[3] });
    }
  }
  return equalities.length === 0 ? null : { table, columns, equalities, literals };
}

function assignedColumnsOf(setList: string | undefined): Set<string> | null {
  if (setList === undefined) return new Set();
  const out = new Set<string>();
  for (const part of setList.split(",")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\?\s*$/.exec(part);
    if (m === null) return null;
    out.add(m[1].toLowerCase());
  }
  return out;
}

function insertHasOneTuple(stripped: string): boolean {
  const values = /\bVALUES\b/i.exec(stripped);
  if (values === null) return false;
  const tail = stripped.slice(values.index + values[0].length);
  let depth = 0;
  let tuples = 0;
  let started = false;
  for (let i = 0; i < tail.length; i += 1) {
    const ch = tail[i];
    if (ch === "'" || ch === String.fromCharCode(34)) {
      i += 1;
      while (i < tail.length && tail[i] !== ch) {
        if (tail[i] === ch && tail[i + 1] === ch) i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === "(") { if (depth === 0) { tuples += 1; if (tuples > 1) return false; } depth += 1; started = true; continue; }
    if (ch === ")") { depth -= 1; continue; }
    if (ch === "," && depth === 0) return false;
  }
  return started && tuples === 1;
}

function projectedColumnsOf(stripped: string): Set<string> | null {
  if (!/^SELECT\b/i.test(stripped)) return null;
  if (/^WITH\b/i.test(stripped)) return null;
  if (tableOccurrences(stripped) !== 1) return null;
  const list = /^SELECT\s+([\s\S]*?)\s+FROM\s/i.exec(stripped)?.[1];
  if (list === undefined) return null;
  if (/\*/.test(list)) return null;
  if (/[()[\]]/.test(list)) return null;
  if (/\bAS\b/i.test(list)) return null;
  if (/\bDISTINCT\b/i.test(list)) return null;
  const columns = new Set<string>();
  for (const part of list.split(",")) {
    const item = part.trim();
    const m = /^(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)$/.exec(item);
    if (m === null) return null;
    columns.add((m[1] as string).toLowerCase());
  }
  return columns.size === 0 ? null : columns;
}

function tableOccurrences(stripped: string): number {
  const re = /\b(?:FROM|JOIN)\s+(\(|[A-Za-z_][A-Za-z0-9_]*)/gi;
  let count = 0;
  while (re.exec(stripped) !== null) count += 1;
  return count;
}

function sqlFactsOf(sql: string): SqlFacts {
  const stripped = stripSqlNoise(normalizeIdentifierQuotes(sql)).trimStart();
  const isRead = /^SELECT\b/i.test(stripped)
    ? true
    : /^WITH\b/i.test(stripped)
      ? !/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(stripped)
      : false;
  if (isRead) {
    const tables = new Set<string>();
    const re = /\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) tables.add(m[1].toLowerCase());
    return {
      isRead: true,
      isInsert: false,
      singleRowInsert: false,
      writeTarget: null,
      dependsOn: tables.size === 0 ? null : tables,
      predicate: predicateOf(stripped, tables.size === 1 ? [...tables][0] : null, 0),
      assigned: null,
      insertShape: null,
      projected: projectedColumnsOf(stripped),
    };
  }
  const m = /^(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(stripped);
  const target = m === null ? null : m[1].toLowerCase();
  const setList = /^UPDATE\s/i.test(stripped)
    ? /^UPDATE\s+\S+\s+SET\s+([\s\S]*?)(?=\bWHERE\b|$)/i.exec(stripped)?.[1]
    : undefined;
  const argOffset = setList === undefined ? 0 : (setList.match(/\?/g) ?? []).length;
  const isInsert = /^INSERT\b/i.test(stripped);
  const singleRowInsert = isInsert && insertHasOneTuple(stripped);
  return {
    isRead: false,
    isInsert,
    singleRowInsert,
    writeTarget: target,
    dependsOn: null,
    predicate: predicateOf(stripped, target, argOffset),
    assigned: assignedColumnsOf(setList),
    insertShape: singleRowInsert ? insertShapeOf(stripped) : null,
    projected: null,
  };
}

function insertShapeOf(stripped: string): InsertShape | null {
  const head = /^\s*INSERT(?:\s+OR\s+\w+)?\s+INTO\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/i.exec(stripped);
  if (head === null) return null;
  const columnList = readBalanced(stripped, head.index + head[0].length - 1);
  if (columnList === null) return null;
  const columns = splitTopLevel(columnList.text, columnList.start)
    .map((piece) => piece.text.trim().toLowerCase())
    .filter((name) => name !== "");
  if (columns.length === 0) return null;
  const values = /\bVALUES\b/i.exec(stripped);
  if (values === null) return null;
  const open = stripped.indexOf("(", values.index);
  if (open < 0) return null;
  const tuple = readBalanced(stripped, open);
  if (tuple === null) return null;
  const elements = splitTopLevel(tuple.text, tuple.start);
  if (elements.length !== columns.length) return null;
  const out: Array<{ argIndex: number } | { literal: string } | null> = [];
  for (const element of elements) {
    const text = element.text.trim();
    if (text === "?") {
      out.push({ argIndex: countPlaceholders(stripped.slice(0, element.start)) });
      continue;
    }
    if (canonicalLiteral(text) !== null) {
      out.push({ literal: text });
      continue;
    }
    out.push(null);
  }
  return { columns, values: out };
}

function readBalanced(stripped: string, open: number): { text: string; start: number } | null {
  let depth = 0;
  for (let i = open; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return { text: stripped.slice(open + 1, i), start: open + 1 };
    }
  }
  return null;
}

function splitTopLevel(text: string, offset: number): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push({ text: text.slice(start, i), start: offset + start });
      start = i + 1;
    }
  }
  out.push({ text: text.slice(start), start: offset + start });
  return out;
}

function countPlaceholders(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "?") count += 1;
  }
  return count;
}

const SQL_FACTS_CACHE_LIMIT = 1024;
const sqlFactsCache = new Map<string, SqlFacts>();

function cachedSqlFacts(sql: string): SqlFacts {
  const hit = sqlFactsCache.get(sql);
  if (hit !== undefined) return hit;
  const facts = sqlFactsOf(sql);
  if (sqlFactsCache.size >= SQL_FACTS_CACHE_LIMIT) sqlFactsCache.clear();
  sqlFactsCache.set(sql, facts);
  return facts;
}

function writeTargetTable(stripped: string): string | null {
  const m = /^(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i.exec(
    stripped.trimStart(),
  );
  return m === null ? null : m[1].toLowerCase();
}

function triggerWriteTargets(body: string): Set<string> | null {
  const stripped = stripSqlNoise(body);
  const header = /^\s*CREATE\s+TRIGGER\b[\s\S]*?\bBEGIN\b/i.exec(stripped);
  const inner = header === null ? stripped : stripped.slice(header[0].length);
  const targets = new Set<string>();
  for (const raw of inner.split(";")) {
    const statement = raw.trim();
    if (statement === "" || /^END$/i.test(statement)) continue;
    const target = writeTargetTable(statement);
    if (target === null) return null;
    targets.add(target);
  }
  return targets;
}

function readMemoKey(sql: string, args: HranaWireValue[]): string {
  return `${sql}\u0000${JSON.stringify(args)}`;
}

function encodedArg(args: HranaWireValue[], index: number): string | null {
  if (index < 0 || index >= args.length) return null;
  return JSON.stringify(args[index]);
}

type CanonicalValue = string;

function canonicalArg(args: HranaWireValue[], index: number): CanonicalValue | null {
  if (index < 0 || index >= args.length) return null;
  const arg = args[index] as HranaWireValue;
  switch (arg.type) {
    case "null":
      return "n:";
    case "integer":
      return `i:${arg.value}`;
    case "float":
      return `f:${arg.value}`;
    case "text":
      return `t:${arg.value}`;
    default:
      return null;
  }
}

function canonicalLiteral(literal: string): CanonicalValue | null {
  if (literal === "NULL") return "n:";
  if (/^-?\d+$/.test(literal)) return `i:${literal}`;
  if (/^-?\d+\.\d+$/.test(literal)) return `f:${literal}`;
  return null;
}

function compareCanonical(one: CanonicalValue, other: CanonicalValue): "same" | "different" | "unknown" {
  if (one === other) return "same";
  if (one === "n:" || other === "n:") return "different";
  const oneNumeric = one.startsWith("i:") || one.startsWith("f:");
  const otherNumeric = other.startsWith("i:") || other.startsWith("f:");
  if (oneNumeric && otherNumeric) {
    const a = one.slice(2);
    const b = other.slice(2);
    if (a === b) return "same";
    if (/^-?\d+$/.test(a) && /^-?\d+$/.test(b)) return BigInt(a) === BigInt(b) ? "same" : "different";
    return Number(a) === Number(b) ? "same" : "different";
  }
  if (!oneNumeric && !otherNumeric) return "different";
  return "unknown";
}

function pinRead(facts: SqlFacts, args: HranaWireValue[]): PinnedRead | null {
  const pin = facts.predicate;
  if (pin === null || facts.isRead === false) return null;
  const values = new Map<string, string>();
  for (const equality of pin.equalities) {
    const encoded = encodedArg(args, equality.argIndex);
    if (encoded === undefined || encoded === null) return null;
    values.set(equality.column, encoded);
  }
  const conjuncts: Array<{ column: string; value: string }> = [];
  for (const equality of pin.equalities) {
    const canonical = canonicalArg(args, equality.argIndex);
    if (canonical === null) return null;
    conjuncts.push({ column: equality.column, value: canonical });
  }
  for (const literal of pin.literals) {
    const canonical = canonicalLiteral(literal.literal);
    if (canonical === null) return null;
    conjuncts.push({ column: literal.column, value: canonical });
  }
  return { table: pin.table, columns: pin.columns, values, conjuncts, projected: facts.projected };
}

function pinWrite(
  facts: SqlFacts,
  args: HranaWireValue[],
  insertedRowId?: number | bigint,
): PinnedWrite | null {
  if (facts.isInsert && facts.singleRowInsert && facts.writeTarget !== null) {
    const rowValues = new Map<string, CanonicalValue>();
    const shape = facts.insertShape;
    if (shape !== null) {
      for (let i = 0; i < shape.columns.length; i += 1) {
        const column = shape.columns[i] as string;
        const value = shape.values[i];
        if (value === undefined || value === null) continue;
        const canonical = "argIndex" in value ? canonicalArg(args, value.argIndex) : canonicalLiteral(value.literal);
        if (canonical !== null) rowValues.set(column, canonical);
      }
    }
    const rowidPin =
      insertedRowId !== undefined
        ? new Map<string, string>([["id", JSON.stringify({ type: "integer", value: String(insertedRowId) })]])
        : new Map<string, string>();
    return {
      table: facts.writeTarget,
      assigned: new Set<string>(),
      values: rowidPin,
      addsRow: true,
      rowValues,
    };
  }
  const pin = facts.predicate;
  if (pin === null || facts.isRead || facts.assigned === null) return null;
  const values = new Map<string, string>();
  for (const equality of pin.equalities) {
    const encoded = encodedArg(args, equality.argIndex);
    if (encoded === undefined || encoded === null) return null;
    values.set(equality.column, encoded);
  }
  if (pin.equalities.length === 0) return null;
  return { table: pin.table, assigned: facts.assigned, values, addsRow: false, rowValues: new Map() };
}

function disjointFrom(read: PinnedRead, write: PinnedWrite): boolean {
  if (read.table !== write.table) return false;
  for (const column of read.columns) {
    if (write.assigned.has(column)) return false;
  }
  if (read.values.size === 0) return false;
  for (const [column, value] of read.values) {
    const other = write.values.get(column);
    if (other === undefined || other === value) return false;
  }
  return true;
}

function pinSeparated(read: PinnedRead, write: PinnedWrite): boolean {
  if (read.table !== write.table) return false;
  if (read.values.size === 0) return false;
  for (const [column, value] of read.values) {
    if (write.assigned.has(column)) continue;
    const other = write.values.get(column);
    if (other === undefined || other === value) continue;
    return true;
  }
  return false;
}

function assignsAnyOf(write: PinnedWrite, columns: Set<string>): boolean {
  for (const column of columns) {
    if (write.assigned.has(column)) return true;
  }
  return false;
}

type WriteEffect = "affects" | "disjoint" | "unknown";

function writeEffectOnRead(
  read: PinnedRead,
  write: PinnedWrite,
  readResult: BunnyDbExecResult | undefined,
  triggerTouchesTarget: boolean,
): WriteEffect {
  if (read.table !== write.table) return "unknown";

  if (write.addsRow) {
    const byRow = insertEffectOnRead(read, write);
    if (byRow === "disjoint") return "disjoint";
    if (disjointFrom(read, write)) return "disjoint";
    return byRow === "affects" ? "affects" : "unknown";
  }

  if (!write.addsRow && pinSeparated(read, write)) return "disjoint";

  if (disjointFrom(read, write)) return "disjoint";

  if (assignsAnyOf(write, read.columns)) return "unknown";
  if (!triggerTouchesTarget && read.projected !== null && write.assigned.size > 0) {
    let touchesAnswer = false;
    for (const column of read.projected) {
      if (write.assigned.has(column)) {
        touchesAnswer = true;
        break;
      }
    }
    if (!touchesAnswer) return "disjoint";
  }
  if (readResult === undefined) return "unknown";
  if (readResult.rows.length === 0) return "disjoint";
  const membership = rowsAgainstPin(readResult, write.values);
  if (membership === "no") return "disjoint";
  if (membership === "some") return "affects";
  return "unknown";
}

function insertEffectOnRead(read: PinnedRead, write: PinnedWrite): WriteEffect {
  for (const conjunct of read.conjuncts) {
    const newValue = write.rowValues.get(conjunct.column);
    if (newValue === undefined) return "unknown";
    const comparison = compareCanonical(newValue, conjunct.value);
    if (comparison === "unknown") return "unknown";
    if (comparison === "different") return "disjoint";
  }
  return "affects";
}

function rowsAgainstPin(
  result: BunnyDbExecResult,
  pin: Map<string, string>,
): "some" | "no" | "unknown" {
  if (pin.size === 0) return "unknown";
  const columns: Array<{ index: number; value: CanonicalValue }> = [];
  for (const [column, value] of pin) {
    const index = result.cols.findIndex((col) => col.name.toLowerCase() === column);
    if (index < 0) return "unknown";
    const canonical = canonicalFromJson(value);
    if (canonical === null) return "unknown";
    columns.push({ index, value: canonical });
  }
  for (const row of result.rows) {
    let matches = true;
    for (const column of columns) {
      const canonical = canonicalCell(row[column.index]);
      if (canonical === null) return "unknown";
      const comparison = compareCanonical(canonical, column.value);
      if (comparison === "unknown") return "unknown";
      if (comparison === "different") {
        matches = false;
        break;
      }
    }
    if (matches) return "some";
  }
  return "no";
}

function canonicalFromJson(encoded: string): CanonicalValue | null {
  try {
    const parsed = JSON.parse(encoded) as { type?: string; value?: unknown };
    if (parsed.type === "null") return "n:";
    if (parsed.type === "integer" && typeof parsed.value === "string") return `i:${parsed.value}`;
    if (parsed.type === "text" && typeof parsed.value === "string") return `t:${parsed.value}`;
    if (parsed.type === "float" && typeof parsed.value === "number") return `f:${parsed.value}`;
    return null;
  } catch {
    return null;
  }
}

function canonicalCell(cell: BunnyDbCell | undefined): CanonicalValue | null {
  if (cell === undefined || cell === null) return "n:";
  if (typeof cell === "number") return Number.isInteger(cell) ? `i:${cell}` : `f:${cell}`;
  if (typeof cell === "bigint") return `i:${cell.toString()}`;
  if (typeof cell === "string") return `t:${cell}`;
  return null;
}

function execResultToQueryResult<T>(result: BunnyDbExecResult): SQLQueryResult<T> {  const names = result.cols.map((c) => c.name);
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

export const PREFETCH_RUN_STATEMENT_CAP = 256;
const PRODUCED_VALUE_SET_CAP = 50_000;
export const PREFETCH_RUN_BYTE_CAP = 512 * 1024;

function valueKey(value: unknown): string | undefined {
  if (typeof value === "bigint") return `i:${value.toString()}`;
  if (typeof value === "number") return Number.isInteger(value) ? `i:${String(value)}` : `f:${String(value)}`;
  if (typeof value === "string") {
    return value.length <= 64 && !value.includes("\n") ? `t:${value}` : undefined;
  }
  return undefined;
}

function producedValueKeys(result: BunnyDbExecResult): Set<string> {
  const values = new Set<string>();
  const rowid = valueKey(result.lastInsertRowId);
  if (rowid !== undefined) values.add(rowid);
  for (const row of result.rows) {
    for (const cell of row) {
      const key = valueKey(cell);
      if (key !== undefined) values.add(key);
    }
  }
  return values;
}

function boundValueKeys(args: HranaWireValue[]): Set<string> {
  const values = new Set<string>();
  for (const arg of args) {
    if (arg.type === "integer") values.add(`i:${arg.value}`);
    else if (arg.type === "text") values.add(`t:${arg.value}`);
  }
  return values;
}

function sharesValue(one: Set<string>, other: Set<string>): boolean {
  for (const value of one) if (other.has(value)) return true;
  return false;
}

function admittedRuns(
  wanted: Array<{ statement: SQLStatement; index: number }>,
): Array<Array<{ statement: SQLStatement; index: number }>> {
  const runs: Array<Array<{ statement: SQLStatement; index: number }>> = [];
  let run: Array<{ statement: SQLStatement; index: number }> = [];
  let runBytes = 0;
  for (const entry of wanted) {
    const { statement } = entry;
    const args = toHranaStmt(statement.sql, statement.params).args;
    const bytes = Buffer.byteLength(statement.sql, "utf8") + JSON.stringify(args).length;
    const withinCap = run.length < PREFETCH_RUN_STATEMENT_CAP && runBytes + bytes <= PREFETCH_RUN_BYTE_CAP;
    if (run.length > 0 && !withinCap) {
      runs.push(run);
      run = [];
      runBytes = 0;
    }
    run.push(entry);
    runBytes += bytes;
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || typeof process.env !== "object") return undefined;
  const v = process.env[name];
  return typeof v === "string" && v !== "" ? v : undefined;
}

function describeTransportError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

function isRetryablePipelineError(error: BunnyDbError): boolean {
  if (error.transport) return true;
  if (error.code !== undefined) return false;
  if (error.status === undefined) return false;
  return error.status === 429 || (error.status >= 500 && error.status <= 599);
}

function isBunnyBeginBusy(error: unknown): boolean {
  if (error instanceof BunnyDbError && error.code === "TRANSACTION_TIMEOUT") return true;
  return isDatabaseBusyError(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
