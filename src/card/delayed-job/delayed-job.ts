import type { SQLDatabaseDriver } from "../../server/driver.js";
import type { DelayedJobsRow, SQLDateTime } from "../../server/schema.js";
import { sqlDateTime } from "../history/act.js";

export const INTEGRATE_WITH_DELAY_JOB_CLASS = "Card::Set::Event::DelayedEvent::IntegrateWithDelayJob";
export const JOB_WRAPPER_TAG = "!ruby/object:ActiveJob::QueueAdapters::DelayedJobAdapter::JobWrapper";
export const DEFAULT_DELAYED_EVENT_PRIORITY = 10;
export const DELAYED_JOB_MAX_ATTEMPTS = 1;
export const DELAYED_JOB_MAX_RUN_TIME_MS = 4 * 60 * 60 * 1000;
const READ_AHEAD = 5;

export interface DelayedJobEnv {
  origin: string;
  html: boolean;
  "ajax?": boolean | null;
  "html?": boolean;
  ip: string | null;
  protocol: string | null;
  params: Record<string, unknown>;
  main_name: string | null;
  ajax: boolean | null;
  host: string | null;
}

export interface DelayedJobAuth {
  as_id: number | null;
  current_id: number | null;
}

export interface DelayedJobCardAttribs {
  action: "create" | "update" | "delete";
  currentActionId: number | null;
}

export interface DelayedEventJob {
  readonly queue: string;
  readonly priority: number;
  readonly actId: number | null;
  readonly cardId: number;
  readonly cardAttribs: DelayedJobCardAttribs;
  readonly env: DelayedJobEnv;
  readonly auth: DelayedJobAuth;
  readonly methodName: string;
}

export interface DelayedJobQueue {
  enqueue(job: DelayedEventJob): Promise<void>;
}

type Yaml = null | boolean | number | string | Yaml[] | { [key: string]: Yaml };

function yamlScalar(value: null | boolean | number | string): string {
  if (value === null) return "";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const otherType =
    value === "" ||
    /^[-+]?(\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+|0x[\da-fA-F]+)$/.test(value) ||
    /^\d{4}-\d\d?-\d\d?([Tt ]|$)/.test(value) ||
    /^(true|false|null|yes|no|on|off|y|n|~)$/i.test(value);
  if (!otherType && /^[\w./:?-]+$/.test(value) && !/^[-?:]/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

function isScalar(v: Yaml): v is null | boolean | number | string {
  return v === null || typeof v !== "object";
}

function yamlMapping(obj: { [key: string]: Yaml }, indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (isScalar(v)) {
      const s = yamlScalar(v);
      lines.push(s === "" ? `${pad}${k}:` : `${pad}${k}: ${s}`);
    } else if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${pad}${k}: []`);
      else lines.push(`${pad}${k}:`, ...yamlSequence(v, indent));
    } else if (Object.keys(v).length === 0) {
      lines.push(`${pad}${k}: {}`);
    } else {
      lines.push(`${pad}${k}:`, ...yamlMapping(v, indent + 2));
    }
  }
  return lines;
}

function yamlSequence(items: Yaml[], indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const item of items) {
    if (isScalar(item)) {
      const s = yamlScalar(item);
      lines.push(s === "" ? `${pad}-` : `${pad}- ${s}`);
    } else if (Array.isArray(item)) {
      const inner = yamlSequence(item, indent + 2);
      lines.push(`${pad}- ${(inner[0] ?? "").trimStart()}`, ...inner.slice(1));
    } else {
      const inner = yamlMapping(item, indent + 2);
      lines.push(`${pad}- ${(inner[0] ?? "").trimStart()}`, ...inner.slice(1));
    }
  }
  return lines;
}

function ajSymbolHash(hash: { [key: string]: Yaml }): { [key: string]: Yaml } {
  return { ...hash, _aj_symbol_keys: Object.keys(hash), _aj_integer_keys: [] };
}

function cardAttribsYaml(attribs: DelayedJobCardAttribs, app: string): { [key: string]: Yaml } {
  return ajSymbolHash({
    action: { _aj_value_key: attribs.action, _aj_class_name_key: "Symbol" },
    current_action:
      attribs.currentActionId === null ? null : { _aj_globalid: `gid://${app}/Card::Action/${attribs.currentActionId}` },
    last_action_id_before_edit: null,
    comment: null,
    silent_change: null,
    skip: null,
    skip_in_action: null,
    trigger: null,
    trigger_in_action: null,
    skip_hash: ajSymbolHash({}),
    full_skip_hash: ajSymbolHash({}),
    trigger_hash: null,
    full_trigger_hash: null,
    duplicate_file: null,
  });
}

export interface HandlerOptions {
  jobId: string;
  enqueuedAt: Date;
  globalIdApp?: string;
}

export function buildDelayedJobHandler(job: DelayedEventJob, opts: HandlerOptions): string {
  const app = opts.globalIdApp ?? "decko";
  const env = job.env;
  const args: Yaml[] = [
    job.actId,
    { _aj_globalid: `gid://${app}/Card/${job.cardId}` },
    cardAttribsYaml(job.cardAttribs, app),
    ajSymbolHash({
      origin: env.origin,
      html: env.html,
      "ajax?": env["ajax?"],
      "html?": env["html?"],
      ip: env.ip,
      protocol: env.protocol,
      params: ajSymbolHash(env.params as { [key: string]: Yaml }),
      main_name: env.main_name,
      ajax: env.ajax,
      host: env.host,
    }),
    ajSymbolHash({ as_id: job.auth.as_id, current_id: job.auth.current_id }),
    job.methodName,
  ];
  const ms = String(opts.enqueuedAt.getUTCMilliseconds()).padStart(3, "0");
  const enqueued = `${opts.enqueuedAt.toISOString().slice(0, 19)}.${ms}000000Z`;
  const doc: { [key: string]: Yaml } = {
    job_data: {
      job_class: INTEGRATE_WITH_DELAY_JOB_CLASS,
      job_id: opts.jobId,
      provider_job_id: null,
      queue_name: job.queue,
      priority: job.priority,
      arguments: args,
      executions: 0,
      exception_executions: {},
      locale: "en",
      timezone: "UTC",
      enqueued_at: enqueued,
      scheduled_at: null,
    },
  };
  return [`--- ${JOB_WRAPPER_TAG}`, ...yamlMapping(doc, 0), ""].join("\n");
}

export function parseDelayedJobHandler(handler: string): DelayedEventJob {
  const one = (re: RegExp, text: string = handler): string | undefined => {
    const m = re.exec(text);
    if (m === null) return undefined;
    const raw = (m[1] ?? "").trim();
    return raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw;
  };
  const fail = (why: string): never => {
    throw new DelayedJobDeserializationError(`Job failed to load: ${why}`);
  };
  if (!handler.startsWith(`--- ${JOB_WRAPPER_TAG}`) || one(/^  job_class: (.*)$/m) !== INTEGRATE_WITH_DELAY_JOB_CLASS) {
    fail("not an IntegrateWithDelayJob handler");
  }
  const argsAt = handler.indexOf("\n  arguments:\n");
  if (argsAt < 0) fail("no arguments");
  const args = handler.slice(argsAt);
  const nullable = (v: string | undefined): string | null => (v === undefined || v === "" ? null : v);
  const num = (v: string | undefined): number | null => (nullable(v) === null ? null : Number(v));
  const bool = (v: string | undefined): boolean | null => (nullable(v) === null ? null : v === "true");
  const cardGid = one(/^  - _aj_globalid: gid:\/\/[^/]+\/Card\/(\d+)$/m, args) ?? fail("no card GlobalID");
  const actionId = one(/^      _aj_globalid: gid:\/\/[^/]+\/Card::Action\/(\d+)$/m, args);
  return {
    queue: one(/^  queue_name: (.*)$/m) ?? "",
    priority: Number(one(/^  priority: (.*)$/m)),
    actId: num(one(/^  arguments:\n  -(.*)$/m)),
    cardId: Number(cardGid),
    cardAttribs: {
      action: (one(/^      _aj_value_key: (\w+)$/m, args) ?? "update") as DelayedJobCardAttribs["action"],
      currentActionId: num(actionId),
    },
    env: {
      origin: one(/^  - origin:(.*)$/m, args) ?? "",
      html: bool(one(/^    html:(.*)$/m, args)) ?? true,
      "ajax?": bool(one(/^    ajax\?:(.*)$/m, args)),
      "html?": bool(one(/^    html\?:(.*)$/m, args)) ?? true,
      ip: nullable(one(/^    ip:(.*)$/m, args)),
      protocol: nullable(one(/^    protocol:(.*)$/m, args)),
      params: {},
      main_name: nullable(one(/^    main_name:(.*)$/m, args)),
      ajax: bool(one(/^    ajax:(.*)$/m, args)),
      host: nullable(one(/^    host:(.*)$/m, args)),
    },
    auth: {
      as_id: num(one(/^  - as_id:(.*)$/m, args)),
      current_id: num(one(/^    current_id:(.*)$/m, args)),
    },
    methodName: one(/^  - (\w+_without_callbacks)$/m, args) ?? fail("no method name"),
  };
}

export class DelayedJobDeserializationError extends Error {
  override readonly name = "Delayed::DeserializationError";
}

export interface DelayedJobStoreOptions {
  now?: () => Date;
  workerName?: string;
  newJobId?: () => string;
  globalIdApp?: string;
}

function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}

export class SqlDelayedJobStore {
  readonly workerName: string;
  private readonly now: () => Date;
  private readonly newJobId: () => string;
  private readonly globalIdApp: string | undefined;

  constructor(
    private readonly driver: SQLDatabaseDriver,
    opts: DelayedJobStoreOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.workerName = opts.workerName ?? "pid:0";
    this.newJobId = opts.newJobId ?? randomUuid;
    this.globalIdApp = opts.globalIdApp;
  }

  async insert(job: DelayedEventJob): Promise<number> {
    const now = this.now();
    const ts = sqlDateTime(now);
    const handler = buildDelayedJobHandler(job, {
      jobId: this.newJobId(),
      enqueuedAt: now,
      ...(this.globalIdApp === undefined ? {} : { globalIdApp: this.globalIdApp }),
    });
    const r = await this.driver.query(
      `INSERT INTO delayed_jobs (priority, attempts, handler, last_error, run_at, locked_at, failed_at, locked_by, queue, created_at, updated_at)
       VALUES (?, 0, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?)`,
      [job.priority, handler, ts, job.queue, ts, ts],
    );
    return Number(r.lastInsertRowId);
  }

  async reserve(): Promise<DelayedJobsRow | null> {
    const now = this.now();
    const nowTs = sqlDateTime(now);
    const expired = sqlDateTime(new Date(now.getTime() - DELAYED_JOB_MAX_RUN_TIME_MS));
    const { rows } = await this.driver.query<DelayedJobsRow>(
      `SELECT * FROM delayed_jobs
        WHERE ((run_at <= ? AND (locked_at IS NULL OR locked_at < ?)) OR locked_by = ?)
          AND failed_at IS NULL
        ORDER BY priority ASC, run_at ASC
        LIMIT ${READ_AHEAD}`,
      [nowTs, expired, this.workerName],
    );
    for (const row of rows) {
      const r = await this.driver.query(
        `UPDATE delayed_jobs SET locked_at = ?, locked_by = ?
          WHERE id = ? AND (locked_at IS NULL OR locked_at < ? OR locked_by = ?) AND run_at <= ?`,
        [nowTs, this.workerName, row.id, expired, this.workerName, nowTs],
      );
      if (r.rowsAffected === 1) return { ...row, locked_at: nowTs, locked_by: this.workerName };
    }
    return null;
  }

  async destroy(id: number): Promise<void> {
    await this.driver.query(`DELETE FROM delayed_jobs WHERE id = ?`, [id]);
  }

  async fail(row: DelayedJobsRow, error: unknown): Promise<void> {
    const ts = sqlDateTime(this.now());
    const attempts = row.attempts + 1;
    const lastError = errorText(error);
    if (attempts < DELAYED_JOB_MAX_ATTEMPTS) {
      await this.driver.query(
        `UPDATE delayed_jobs SET attempts = ?, last_error = ?, locked_at = NULL, locked_by = NULL, updated_at = ? WHERE id = ?`,
        [attempts, lastError, ts, row.id],
      );
      return;
    }
    await this.driver.query(
      `UPDATE delayed_jobs SET attempts = ?, last_error = ?, failed_at = ?, updated_at = ? WHERE id = ?`,
      [attempts, lastError, ts, ts, row.id],
    );
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const frames = (error.stack ?? "").split("\n").slice(1).map((l) => l.trim());
    return `${error.message}\n${frames.join("\n")}`;
  }
  return `${String(error)}\n`;
}

export type DelayedJobPerformer = (job: DelayedEventJob) => Promise<void>;

export interface WorkOffResult {
  success: number;
  failure: number;
}

export class DelayedJobWorker {
  private running: Promise<WorkOffResult> | null = null;
  private again = false;

  constructor(
    readonly store: SqlDelayedJobStore,
    private readonly perform: DelayedJobPerformer,
    private readonly log: (line: string) => void = () => {},
  ) {}

  workOff(max = 100): Promise<WorkOffResult> {
    if (this.running !== null) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      const total: WorkOffResult = { success: 0, failure: 0 };
      try {
        do {
          this.again = false;
          for (let i = 0; i < max; i++) {
            const row = await this.store.reserve();
            if (row === null) break;
            if (await this.runRow(row)) total.success++;
            else total.failure++;
          }
        } while (this.again);
      } finally {
        this.running = null;
      }
      return total;
    })();
    return this.running;
  }

  private async runRow(row: DelayedJobsRow): Promise<boolean> {
    let job: DelayedEventJob;
    try {
      job = parseDelayedJobHandler(row.handler);
    } catch (error) {
      this.log(`Job (id=${row.id}) FAILED permanently with ${(error as Error).name}: ${(error as Error).message}`);
      await this.store.fail(row, error);
      return false;
    }
    const name = `${INTEGRATE_WITH_DELAY_JOB_CLASS} from DelayedJob(${row.queue ?? ""})`;
    try {
      this.log(`Job ${name} (id=${row.id}) RUNNING`);
      await this.perform(job);
      await this.store.destroy(row.id);
      this.log(`Job ${name} (id=${row.id}) COMPLETED`);
      return true;
    } catch (error) {
      this.log(`Job ${name} (id=${row.id}) FAILED (${row.attempts} prior attempts) with ${(error as Error)?.name}: ${(error as Error)?.message}`);
      await this.store.fail(row, error);
      return false;
    }
  }

  start(pollIntervalMs = 5000): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = (): void => {
      if (stopped) return;
      void this.workOff().finally(() => {
        if (stopped) return;
        timer = setTimeout(tick, pollIntervalMs);
        (timer as { unref?: () => void }).unref?.();
      });
    };
    tick();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }
}

export type AfterResponse = (run: () => Promise<unknown>) => void;

export class SqlDelayedJobQueue implements DelayedJobQueue {
  constructor(
    private readonly worker: DelayedJobWorker,
    private readonly afterResponse: AfterResponse,
  ) {}

  async enqueue(job: DelayedEventJob): Promise<void> {
    await this.worker.store.insert(job);
    this.afterResponse(() => this.worker.workOff());
  }
}

export function nodeAfterResponse(log: (line: string) => void = () => {}): AfterResponse {
  return (run) => {
    setImmediate(() => {
      run().catch((e: unknown) => log(`delayed_job worker pass failed: ${String(e)}`));
    });
  };
}

export interface QueueProducer {
  send(body: unknown): Promise<void>;
}

export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

export function cloudflareAfterResponse(ctx: WaitUntilContext, queue?: QueueProducer): AfterResponse {
  return (run) => {
    if (queue !== undefined) {
      ctx.waitUntil(queue.send({ kind: "delayed_job" }));
      return;
    }
    ctx.waitUntil(run());
  };
}

export async function handleDelayedJobQueueBatch(
  batch: { messages: readonly { ack(): void }[] },
  worker: DelayedJobWorker,
): Promise<WorkOffResult> {
  const result = await worker.workOff();
  for (const m of batch.messages) m.ack();
  return result;
}

export function deferredAfterResponse(defer: (promise: Promise<unknown>) => void): AfterResponse {
  return (run) => defer(run());
}

export interface DelayedJobsConfig {
  readonly delaying: boolean;
  readonly queue: DelayedJobQueue;
}

export type { SQLDateTime };
