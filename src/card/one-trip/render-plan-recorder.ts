import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../server/driver.js";
import { FetchEngine } from "../fetch.js";
import { RenderEngine } from "../render.js";
import {
  classifyResidueStatement,
  isPipelineAbleRenderStatement,
  recordRenderPlan,
  type RenderPlanEntry,
} from "./render-plan.js";

const PLAN_INSERT_CHUNK = 100;

class StatementCaptureDriver implements SQLDatabaseDriver {
  get cqlRegexpSemantics(): SQLDatabaseDriver["cqlRegexpSemantics"] {
    return this.inner.cqlRegexpSemantics;
  }

  readonly statements: { sql: string; params: unknown[] }[] = [];
  constructor(private readonly inner: SQLDatabaseDriver) {}
  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    this.statements.push({ sql, params });
    return this.inner.query<T>(sql, params);
  }
  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    for (const statement of statements) {
      this.statements.push({ sql: statement.sql, params: statement.params });
    }
    return this.inner.batch(statements);
  }
}

export interface RenderPlanRecorderOptions {
  deck: SQLDatabaseDriver;
  pageNames: readonly string[];
  pageIds: ReadonlyMap<string, number>;
}

export interface RenderPlanPageReport {
  pageId: number;
  recorded: boolean;
  captureStatements: number;
  entries: number;
  families: Record<string, number>;
  error?: string;
}

export interface RenderPlanRecorderReport {
  pages: Record<string, RenderPlanPageReport>;
}

async function storeRenderPlan(
  side: SQLDatabaseDriver,
  pageId: number,
  entries: readonly RenderPlanEntry[],
): Promise<void> {
  await side.query("DELETE FROM one_trip_render_plans WHERE page_id = ?", [pageId]);
  for (let i = 0; i < entries.length; i += PLAN_INSERT_CHUNK) {
    const chunk = entries.slice(i, i + PLAN_INSERT_CHUNK);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
    await side.query(
      `INSERT INTO one_trip_render_plans (page_id, seq, family, sql, params_json) VALUES ${placeholders}`,
      chunk.flatMap((entry, k) => [
        pageId,
        i + k,
        classifyResidueStatement(entry.sql) ?? "point-row-by-name",
        entry.sql,
        JSON.stringify(entry.params),
      ]),
    );
  }
}

export async function recordRenderPlansForPages(
  options: RenderPlanRecorderOptions,
): Promise<RenderPlanRecorderReport> {
  const { deck, pageNames, pageIds } = options;
  const report: RenderPlanRecorderReport = { pages: {} };

  const savedGate = process.env.DECKO_ONE_TRIP;
  const savedStore = process.env.DECKO_ONE_TRIP_STORE;
  process.env.DECKO_ONE_TRIP = "1";
  process.env.DECKO_ONE_TRIP_STORE = "inline";
  try {
    for (const pageName of pageNames) {
      const pageId = pageIds.get(pageName);
      const page: RenderPlanPageReport = {
        pageId: pageId ?? -1,
        recorded: false,
        captureStatements: 0,
        entries: 0,
        families: {},
      };
      report.pages[pageName] = page;
      if (pageId === undefined || pageId <= 0) continue;
      await deck.query("DELETE FROM one_trip_render_plans WHERE page_id = ?", [pageId]);
      const capture = new StatementCaptureDriver(deck);
      try {
        const fetcher = new FetchEngine(capture);
        await fetcher.codenames.ensureLoaded();
        fetcher.installNameEnvironment();
        const render = new RenderEngine(fetcher);
        await render.render(pageName, "open", {});
        page.captureStatements = capture.statements.length;
        const plan = recordRenderPlan(
          pageName,
          capture.statements
            .filter((s) => isPipelineAbleRenderStatement(s.sql))
            .map((s) => ({ sql: s.sql, params: s.params })),
        );
        const safeEntries: RenderPlanEntry[] = [];
        for (const entry of plan.entries) {
          try {
            JSON.stringify(entry.params);
          } catch {
            continue;
          }
          safeEntries.push(entry);
        }
        await storeRenderPlan(deck, pageId, safeEntries);
        page.recorded = true;
        page.entries = safeEntries.length;
        for (const entry of safeEntries) {
          const family = classifyResidueStatement(entry.sql) ?? "point-row-by-name";
          page.families[family] = (page.families[family] ?? 0) + 1;
        }
      } catch (error) {
        page.error = error instanceof Error ? error.message : String(error);
      }
    }
  } finally {
    if (savedGate === undefined) delete process.env.DECKO_ONE_TRIP;
    else process.env.DECKO_ONE_TRIP = savedGate;
    if (savedStore === undefined) delete process.env.DECKO_ONE_TRIP_STORE;
    else process.env.DECKO_ONE_TRIP_STORE = savedStore;
  }
  return report;
}
