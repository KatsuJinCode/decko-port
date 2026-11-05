import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement, SQLTransactionGuarantee } from "../driver.js";
import { rowIdOrOmit, TransactionGate } from "../driver.js";
import {
  clearLeaseAssertStatement,
  isLeaseAssertFailure,
  lockStateStatement,
  TransactionLeaseLostError,
  UndoJournal,
  type UndoJournalOptions,
} from "./undo-journal.js";

export type D1BindValue = null | number | string | ArrayBuffer | Uint8Array;

export interface D1ExecMeta {
  changes: number;
  last_row_id?: number | bigint;
  duration?: number;
  rows_read?: number;
  rows_written?: number;
  [key: string]: unknown;
}

export interface D1ResultLike {
  results?: Record<string, unknown>[];
  success?: boolean;
  meta?: D1ExecMeta;
}

export interface D1PreparedStatementLike {
  bind(...values: D1BindValue[]): D1PreparedStatementLike;
  run(): Promise<D1ResultLike>;
  all(): Promise<D1ResultLike>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]>;
}

export const D1_MAX_BOUND_PARAMETERS = 100;

function exactLiteral(v: unknown): string | undefined {
  if (v === null) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return undefined;
    if (Number.isInteger(v)) return String(v);
    const s = String(v);
    return /[.eE]/.test(s) ? s : `${s}.0`;
  }
  if (typeof v === "string") return v.includes("\u0000") ? undefined : `'${v.replace(/'/g, "''")}'`;
  if (v instanceof Uint8Array) return `X'${Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("")}'`;
  return undefined;
}

export function inlineBoundParameters(sql: string, params: readonly unknown[]): string | undefined {
  let out = "";
  let next = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) return undefined;
        if (sql[j] === close) {
          if (close !== "]" && sql[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      const end = j === -1 ? sql.length : j;
      out += sql.slice(i, end);
      i = end;
    } else if (ch === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i + 2);
      if (j === -1) return undefined;
      out += sql.slice(i, j + 2);
      i = j + 2;
    } else if (ch === "?") {
      if (/[0-9]/.test(sql[i + 1] ?? "")) return undefined;
      if (next >= params.length) return undefined;
      const lit = exactLiteral(params[next]);
      if (lit === undefined) return undefined;
      out += lit;
      next += 1;
      i += 1;
    } else if ((ch === ":" || ch === "@" || ch === "$") && /[A-Za-z_]/.test(sql[i + 1] ?? "")) {
      return undefined;
    } else {
      out += ch;
      i += 1;
    }
  }
  return next === params.length ? out : undefined;
}

export const D1_MAX_EXPR_DEPTH = 100;

const OR_CHAIN_MIN_TERMS = 16;

const PAREN_TERM = String.raw`\((?:[^()']|'[^']*'|\((?:[^()']|'[^']*'|\([^()']*\))*\))*\)`;
const OR_CHAIN = new RegExp(`${PAREN_TERM}(?:\\s+OR\\s+${PAREN_TERM}){${OR_CHAIN_MIN_TERMS - 1},}`, "g");
const PAREN_TERM_ONE = new RegExp(PAREN_TERM, "g");

export function balanceOrChains(sql: string): string {
  if (sql.split(" OR ").length <= OR_CHAIN_MIN_TERMS) return sql;
  return sql.replace(OR_CHAIN, (chain) => {
    const terms = chain.match(PAREN_TERM_ONE) ?? [];
    const rebuilt = terms.join(" OR ");
    if (rebuilt.replace(/\s+/g, " ") !== chain.replace(/\s+/g, " ")) return chain;
    const tree = (list: string[]): string => (list.length === 1 ? list[0] : `(${tree(list.slice(0, list.length >> 1))} OR ${tree(list.slice(list.length >> 1))})`);
    return tree(terms);
  });
}

export interface CloudflareD1AdapterOptions {
  journal?: UndoJournalOptions;
}

export class CloudflareD1Adapter implements SQLDatabaseDriver {
  private readonly db: D1DatabaseLike;
  private readonly gate = new TransactionGate();
  private readonly journal: UndoJournal;
  private lockStateSeen = false;
  private readonly sleep: (ms: number) => Promise<void>;

  readonly transactionGuarantee: SQLTransactionGuarantee = {
    mechanism: "compensating",
    atomicOnFailure: true,
    crashRecovery: "next-transaction-or-read",
    readersIsolated: true,
    serializedWriters: "database",
    atomicBatch: true,
    standaloneBatchAdmission: true,
    idsReusedAfterRollback: false,
  };

  constructor(db: D1DatabaseLike, options: CloudflareD1AdapterOptions = {}) {
    this.db = db;
    this.sleep = options.journal?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.journal = new UndoJournal(
      { query: (sql, params) => this.plainQuery(sql, params), batch: (statements) => this.plainBatch(statements) },
      options.journal,
    );
  }

  async transaction<R>(work: () => Promise<R>): Promise<R> {
    return this.gate.run(() =>
      this.journal.run(() => {
        const tx = this.journal.activeTx;
        return tx === null ? work() : runInTransactionScope(tx, work);
      }),
    );
  }

  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    if (isWriteStatement(sql)) {
      const [result] = await this.batch([{ sql, params }]);
      return result as SQLQueryResult<T>;
    }
    const fence = this.transactionFence();
    if (fence !== undefined) {
      let results: SQLQueryResult[];
      try {
        results = await this.plainBatch([fence, { sql, params }, clearLeaseAssertStatement()]);
      } catch (error) {
        throw lostLeaseOrOriginal(error);
      }
      return results[1] as SQLQueryResult<T>;
    }
    const [result] = await this.servingReads([{ sql, params }]);
    return result as SQLQueryResult<T>;
  }

  private prepareBound(rawSql: string, params: unknown[]): D1PreparedStatementLike {
    const sql = balanceOrChains(rawSql);
    if (params.length > D1_MAX_BOUND_PARAMETERS) {
      const inlined = inlineBoundParameters(sql, params);
      if (inlined !== undefined) return this.db.prepare(inlined);
    }
    return this.db.prepare(sql).bind(...(params as D1BindValue[]));
  }

  private async plainBatch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    const prepared: D1PreparedStatementLike[] = [];
    const changesAt: (number | undefined)[] = [];
    for (const s of statements) {
      prepared.push(this.prepareBound(s.sql, (s.params ?? []) as unknown[]));
      if (isWriteStatement(s.sql)) {
        changesAt.push(prepared.length);
        prepared.push(this.db.prepare("SELECT changes() AS decko_changes"));
      } else {
        changesAt.push(undefined);
      }
    }
    const results = await this.db.batch(prepared);
    let at = 0;
    return statements.map((_, i) => {
      const result = results[at];
      assertSuccess("batch", `statement ${i}`, result);
      const mapped = this.toQueryResult<unknown>(result);
      const changesIndex = changesAt[i];
      at += changesIndex === undefined ? 1 : 2;
      if (changesIndex !== undefined) {
        const row = results[changesIndex]?.results?.[0] as { decko_changes?: unknown } | undefined;
        mapped.rowsAffected = Number(row?.decko_changes ?? mapped.rowsAffected);
      }
      return mapped;
    });
  }

  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    if (statements.some(s => s.requireStandaloneTransaction) && this.journal.activeTx !== null) {
      throw new Error("database-standalone-batch-required");
    }
    const fence = this.transactionFence();
    if (fence === undefined) return this.servingReads(statements);
    let results: SQLQueryResult[];
    try {
      results = await this.plainBatch([fence, ...statements, clearLeaseAssertStatement()]);
    } catch (error) {
      throw lostLeaseOrOriginal(error);
    }
    return results.slice(1, 1 + statements.length);
  }

  private async servingReads(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    if (statements.some((s) => isWriteStatement(s.sql))) return this.plainBatch(statements);
    let delay = READ_WAIT_INITIAL_MS;
    for (;;) {
      let results: SQLQueryResult[];
      try {
        results = await this.plainBatch([lockStateStatement(), ...statements]);
      } catch (error) {
        if (!this.lockStateSeen && isMissingLockStateTable(error)) return this.plainBatch(statements);
        throw error;
      }
      this.lockStateSeen = true;
      const state = results[0].rows[0] as { tx: unknown; expires_at: unknown } | undefined;
      if (state === undefined || state.tx == null) return results.slice(1);
      const holder = String(state.tx);
      if (transactionInScope(holder)) return results.slice(1);
      if (this.journal.leaseIsExpired(state)) {
        await this.journal.repairExpiredLease(holder);
        delay = READ_WAIT_INITIAL_MS;
        continue;
      }
      await this.sleep(delay);
      delay = Math.min(delay * 2, READ_WAIT_MAX_MS);
    }
  }

  private transactionFence(): SQLStatement | undefined {
    const tx = this.journal.activeTx;
    return tx === null ? undefined : this.journal.leaseFenceStatement(tx);
  }

  private async plainQuery<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    if (isWriteStatement(sql)) {
      const [result] = await this.plainBatch([{ sql, params }]);
      return result as SQLQueryResult<T>;
    }
    const result = await this.prepareBound(sql, params).all();
    assertSuccess("query", sql, result);
    return this.toQueryResult<T>(result);
  }

  private toQueryResult<T>(result: D1ResultLike): SQLQueryResult<T> {
    return {
      rows: (result.results ?? []) as T[],
      rowsAffected: result.meta?.changes ?? 0,
      lastInsertRowId: rowIdOrOmit(result.meta?.last_row_id),
      rowsRead: metaNumberOrOmit(result.meta?.rows_read),
      rowsWritten: metaNumberOrOmit(result.meta?.rows_written),
    };
  }
}

const READ_WAIT_INITIAL_MS = 5;
const READ_WAIT_MAX_MS = 100;

interface TxScopeStorage {
  getStore(): string | undefined;
  run<R>(store: string, fn: () => R): R;
}

function findTxScopeStorage(): TxScopeStorage | undefined {
  const g = globalThis as {
    AsyncLocalStorage?: new () => TxScopeStorage;
    process?: { getBuiltinModule?: (id: string) => { AsyncLocalStorage?: new () => TxScopeStorage } | undefined };
  };
  try {
    const Als = typeof g.AsyncLocalStorage === "function" ? g.AsyncLocalStorage : g.process?.getBuiltinModule?.("node:async_hooks")?.AsyncLocalStorage;
    return typeof Als === "function" ? new Als() : undefined;
  } catch {
    return undefined;
  }
}

const txScope = findTxScopeStorage();
const liveTransactions = new Set<string>();

function runInTransactionScope<R>(tx: string, work: () => Promise<R>): Promise<R> {
  if (txScope !== undefined) return txScope.run(tx, work);
  liveTransactions.add(tx);
  return work().finally(() => liveTransactions.delete(tx));
}

function transactionInScope(tx: string): boolean {
  if (txScope !== undefined) return txScope.getStore() === tx;
  return liveTransactions.has(tx);
}

function isWriteStatement(sql: string): boolean {
  return /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);
}

function lostLeaseOrOriginal(error: unknown): unknown {
  return isLeaseAssertFailure(error) ? new TransactionLeaseLostError() : error;
}

function isMissingLockStateTable(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  return /no such table/i.test(message) && message.includes("decko_tx_state");
}

function assertSuccess(op: string, target: string, result: D1ResultLike): void {
  if (result.success === false) {
    throw new Error(`D1 ${op} failed for ${target}: reported success=false`);
  }
}

function metaNumberOrOmit(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}
