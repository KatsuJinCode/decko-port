import type {
  PrefetchOutcome,
  SQLDatabaseDriver,
  SQLQueryResult,
  SQLStatement,
  SQLTransactionGuarantee,
} from "../../server/driver.js";
import { isFreshnessStampRead, type RenderPlanEntry } from "./render-plan.js";
import {
  buildDriftArmIndex,
  mergeDriftArmIndex,
  serveFromDriftArmIndex,
} from "./replay-fold.js";
import type { DriftArmIndex } from "./replay-fold.js";

export function renderPlanResultKey(sql: string, params: unknown[]): string {
  return `${sql}::${JSON.stringify(params)}`;
}

export function isReadOnlyStatement(sql: string): boolean {
  return /^(SELECT|WITH)\b/i.test(sql.trimStart());
}

function isGateStateStatement(sql: string): boolean {
  return isFreshnessStampRead(sql);
}

export class ReplayPlanRouter implements SQLDatabaseDriver {
  get cqlRegexpSemantics(): SQLDatabaseDriver["cqlRegexpSemantics"] {
    return this.base.cqlRegexpSemantics;
  }

  readonly base: SQLDatabaseDriver;
  private planResults: Map<string, SQLQueryResult> | undefined;
  private driftIndex: DriftArmIndex | undefined;

  constructor(base: SQLDatabaseDriver) {
    this.base = base;
  }

  armRenderPlan(
    entries: readonly RenderPlanEntry[],
    results: readonly unknown[],
    driftIndex?: DriftArmIndex,
  ): void {
    if (entries.length !== results.length) return;
    const map = this.planResults ?? new Map<string, SQLQueryResult>();
    entries.forEach((entry, i) => {
      map.set(renderPlanResultKey(entry.sql, entry.params), results[i] as SQLQueryResult);
    });
    this.planResults = map;
    const incoming = driftIndex ?? buildDriftArmIndex(entries, results);
    this.driftIndex =
      this.driftIndex === undefined ? incoming : mergeDriftArmIndex(this.driftIndex, incoming);
  }

  disarmRenderPlan(): void {
    this.planResults = undefined;
    this.driftIndex = undefined;
  }

  get armed(): boolean {
    return this.planResults !== undefined;
  }

  get transactionGuarantee(): SQLTransactionGuarantee | undefined {
    return this.base.transactionGuarantee;
  }

  get transaction(): (<R>(work: () => Promise<R>) => Promise<R>) | undefined {
    const base = this.base;
    if (base.transaction === undefined) return undefined;
    return <R>(work: () => Promise<R>) => {
      this.disarmRenderPlan();
      return base.transaction!(work);
    };
  }

  get readPhase(): (<R>(work: () => Promise<R>) => Promise<R>) | undefined {
    const base = this.base;
    if (base.readPhase === undefined) return undefined;
    return <R>(work: () => Promise<R>) => base.readPhase!(work);
  }

  async prefetchReads(statements: SQLStatement[]): Promise<PrefetchOutcome[]> {
    const none = statements.map(() => ({ result: undefined, unverified: true }));
    if (this.planResults !== undefined || this.driftIndex !== undefined) return none;
    const base = this.base;
    if (base.prefetchReads === undefined) return none;
    return base.prefetchReads(statements);
  }

  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    const served =
      isGateStateStatement(sql) ? undefined : this.planResults?.get(renderPlanResultKey(sql, params));
    if (served !== undefined) return served as SQLQueryResult<T>;
    if (this.driftIndex !== undefined && isReadOnlyStatement(sql)) {
      const composed = serveFromDriftArmIndex(this.driftIndex, sql, params);
      if (composed !== undefined) return composed as SQLQueryResult<T>;
    }
    if (!isReadOnlyStatement(sql)) this.planResults = undefined;
    return this.base.query<T>(sql, params);
  }

  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    const map = this.planResults;
    if (map === undefined && this.driftIndex === undefined) return this.base.batch(statements);
    const served: (SQLQueryResult | undefined)[] = new Array(statements.length);
    const misses: number[] = [];
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i] as { sql: string; params?: unknown[] } | undefined;
      let hit =
        stmt === undefined || isGateStateStatement(stmt.sql)
          ? undefined
          : map?.get(renderPlanResultKey(stmt.sql, stmt.params ?? []));
      if (hit === undefined && stmt !== undefined && this.driftIndex !== undefined && isReadOnlyStatement(stmt.sql)) {
        const composed = serveFromDriftArmIndex(this.driftIndex, stmt.sql, stmt.params ?? []);
        if (composed !== undefined) hit = composed as SQLQueryResult;
      }
      if (hit !== undefined) served[i] = hit;
      else misses.push(i);
    }
    if (misses.length === statements.length) {
      this.guardWrites(statements);
      return this.base.batch(statements);
    }
    if (misses.length > 0) {
      const missStatements = misses.map((i) => statements[i] as SQLStatement);
      this.guardWrites(missStatements);
      const results = await this.base.batch(missStatements);
      misses.forEach((stmtIndex, k) => {
        served[stmtIndex] = results[k];
      });
    }
    return served as SQLQueryResult[];
  }

  private guardWrites(statements: readonly SQLStatement[]): void {
    if (statements.some((s) => !isReadOnlyStatement(s.sql))) {
      this.planResults = undefined;
      this.driftIndex = undefined;
    }
  }
}
