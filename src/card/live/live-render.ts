import type { SQLDatabaseDriver, SQLQueryResult } from "../../server/driver.js";
import type { RenderEngine } from "../render.js";
import type { HistoryRenderParams } from "../history/render-seam.js";
import { renderPageBytes } from "../render/page.js";
import { BOOT_VERSION_STATEMENT, resetBootCache } from "../render/boot-cache.js";
import { DeckoName } from "../name.js";
import { LiveRenderAborted, LiveStoreDriver, type LiveStoreStats } from "./live-store-driver.js";
import { RetainedPages, retainedPagesDiagnostics } from "./retained-pages.js";

export { LiveRenderAborted };

export type LiveEngineBoot = (driver: SQLDatabaseDriver) => Promise<{ render: RenderEngine }>;

export class LiveRenderScope {
  private live: LiveStoreDriver | undefined;
  private owner: SQLDatabaseDriver | undefined;
  private viewer: string | undefined;
  private signal: AbortSignal | undefined;
  private stamp: number | undefined;
  private active = false;
  private closed = false;

  async acquire(base: SQLDatabaseDriver, viewer: string | undefined, signal: AbortSignal | undefined, create: () => LiveStoreDriver): Promise<LiveStoreDriver> {
    if (this.closed || this.active) throw new Error("live render scope is closed or already in use");
    if (this.owner !== undefined && (this.owner !== base || this.viewer !== viewer || this.signal !== signal)) {
      throw new Error("live render scope cannot cross database, viewer or request boundaries");
    }
    this.active = true;
    try {
      if (Boolean(signal?.aborted)) throw new LiveRenderAborted();
      let stamp: number | undefined;
      try { stamp = stampOf(await base.query(BOOT_VERSION_STATEMENT, [])); }
      catch (error) {
        if (!/no such table[^\n]*deck_data_version/i.test(String(error))) throw error;
      }
      if (signal?.aborted === true) throw new LiveRenderAborted();
      if (this.live !== undefined && (stamp === undefined || stamp !== this.stamp)) {
        this.live.close();
        this.live = undefined;
      }
      const live = this.live ?? create();
      this.owner = base;
      this.viewer = viewer;
      this.signal = signal;
      this.stamp = stamp;
      this.live = live;
      live.beginRequest(signal);
      live.stats.round_trips += 1;
      live.stats.statements_sent += 1;
      return live;
    } catch (error) { this.active = false; throw error; }
  }

  release(completed: boolean): void {
    this.active = false;
    if (!completed) { this.live?.close(); this.live = undefined; }
  }

  close(): void {
    if (this.active) throw new Error("cannot close a live render scope while a view is active");
    this.live?.close();
    this.live = undefined;
    this.closed = true;
  }
}

export async function withLiveRenderScope<T>(work: (scope: LiveRenderScope) => Promise<T>): Promise<T> {
  const scope = new LiveRenderScope();
  try { return await work(scope); } finally { scope.close(); }
}

export interface LiveRenderOptions {
  requestedView?: string;
  historyParams?: HistoryRenderParams;
  bareView?: boolean;
  bareMainOpts?: Record<string, unknown>;
  requestScope?: LiveRenderScope;
  autoThreshold?: number;
  autoTail?: number;
  autoTailTrips?: number;
  incremental?: boolean;
  refreshDiscoveryEngine?: (driver: SQLDatabaseDriver, render: RenderEngine) => Promise<void>;
  ringAll?: boolean;
  signal?: AbortSignal;
  keep?: boolean;
  keepScope?: string;
}

interface KeptPage {
  live: LiveStoreDriver;
  stamp: number;
  seeds: Set<string>;
  eagerRefs: Set<string>;
  deniedRootKey: string | undefined;
}

let keptPages = new WeakMap<SQLDatabaseDriver, RetainedPages<KeptPage>>();

export function keptLivePageDiagnostics(base: SQLDatabaseDriver): { entries: number; estimatedBytes: number } {
  const pages = keptPages.get(base);
  return pages ? retainedPagesDiagnostics(pages) : { entries: 0, estimatedBytes: 0 };
}

function keptKey(page: string, opts: LiveRenderOptions): string {
  return `${opts.keepScope ?? ""}\u0000${page}\u0000${opts.requestedView ?? ""}\u0000${JSON.stringify(opts.historyParams ?? {})}\u0000${opts.bareView === true}\u0000${JSON.stringify(opts.bareMainOpts ?? {})}`;
}

function takeKept(base: SQLDatabaseDriver, key: string): KeptPage | undefined {
  return keptPages.get(base)?.take(key);
}

function putKept(base: SQLDatabaseDriver, key: string, kept: KeptPage): void {
  let pages = keptPages.get(base);
  if (pages === undefined) {
    pages = new RetainedPages<KeptPage>(
      (entry) => entry.live.close(),
      (entry) => {
        entry.live.compactForRetention();
        return [entry.live.retainedPayload(), entry.seeds, entry.eagerRefs, entry.deniedRootKey];
      },
    );
    keptPages.set(base, pages);
  }
  pages.put(key, kept);
}

export function clearKeptLivePages(base?: SQLDatabaseDriver): void {
  if (base === undefined) {
    keptPages = new WeakMap();
    return;
  }
  const pages = keptPages.get(base);
  pages?.clear();
}

function stampOf(result: SQLQueryResult | undefined): number | undefined {
  const v = (result?.rows[0] as { version?: unknown } | undefined)?.version;
  return typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : undefined;
}

export interface LivePassReport {
  pass: number;
  kind: "spec" | "final" | "disc";
  cpu_ms: number;
  recorded: number;
}

export interface LiveRenderResult {
  html: string;
  status: number;
  stats: LiveStoreStats;
  passes: LivePassReport[];
  choice: "collect" | "speculate";
}

const MAX_PASSES = 40;

async function renderPass(
  live: LiveStoreDriver,
  boot: LiveEngineBoot,
  page: string,
  opts: LiveRenderOptions,
  collect: { seeds: Set<string>; asked: Set<string> } | undefined,
  skipSync: (() => boolean) | undefined,
  lazy: { asked: Set<string>; eager: ReadonlySet<string> } | undefined,
  deniedRootKey: string | undefined,
  out: { engine?: RenderEngine },
  discovery?: { engine: RenderEngine | undefined; level: number; sweepAll: boolean; onBoot: (e: RenderEngine) => void },
): Promise<string> {
  let render: RenderEngine;
  if (discovery?.engine !== undefined) {
    render = discovery.engine;
    resetBootCache();
    render.clearProvisionalState(discovery.level);
    await opts.refreshDiscoveryEngine?.(live, render);
  } else {
    resetBootCache();
    render = (await boot(live)).render;
    discovery?.onBoot(render);
  }
  if (discovery !== undefined) render.sweepAllHeldCards = discovery.sweepAll;
  out.engine = render;
  render.liveRequest = true;
  if (collect !== undefined) {
    render.warmupChaseOff = true;
    render.demandSeeds = [...collect.seeds];
    render.demandRecorder = collect.asked;
    render.skipDeniedRootWalks = true;
    if (deniedRootKey !== undefined) {
      render.skipRootClosureWalk = true;
      render.skipRootClosureKey = deniedRootKey;
    }
    render.warmupSidesUnscanned = !(typeof process !== "undefined" && process.env?.DECKO_LIVE_SIDES_SCAN === "1");
  }
  if (skipSync !== undefined) render.skipSyncRender = skipSync;
  if (lazy !== undefined) {
    render.skipStructureRefWalks = true;
    render.skippedStructureRefAsked = lazy.asked;
    render.eagerStructureRefs = lazy.eager;
  }
  return opts.bareView === true
    ? await render.render(page, opts.requestedView ?? "titled", opts.historyParams)
    : await renderPageBytes(render, page, opts.requestedView, opts.historyParams, opts.bareMainOpts);
}

export async function liveRenderView(
  base: SQLDatabaseDriver,
  cardName: string,
  boot: LiveEngineBoot,
  opts: LiveRenderOptions,
): Promise<LiveRenderResult> {
  return await liveRenderPage(base, cardName, boot, { ...opts, bareView: true, keep: false });
}

export async function liveRenderPage(
  base: SQLDatabaseDriver,
  page: string,
  boot: LiveEngineBoot,
  opts: LiveRenderOptions = {},
): Promise<LiveRenderResult> {
  const env = typeof process !== "undefined" ? process.env : undefined;
  const ringAll = opts.ringAll ?? env?.DECKO_LIVE_RING_ALL === "1";
  const keepOn =
    opts.requestScope === undefined && opts.keep !== false && env?.DECKO_LIVE_KEEP !== "0" && !(opts.refreshDiscoveryEngine !== undefined && (opts.incremental ?? env?.DECKO_LIVE_INCREMENTAL === "1"));
  const key = keptKey(page, opts);
  let kept = keepOn ? takeKept(base, key) : undefined;
  let stamp: number | undefined;
  if (kept !== undefined) {
    if (opts.signal?.aborted === true) throw new LiveRenderAborted();
    stamp = stampOf(await base.query(BOOT_VERSION_STATEMENT, []));
    if (stamp === undefined || stamp !== kept.stamp) {
      kept.live.close();
      kept = undefined;
    }
  }
  const createStore = () => new LiveStoreDriver(base, {
      ringAll,
      signal: opts.signal,
      compact: env?.DECKO_LIVE_COMPACT !== "0",
      identityRing: env?.DECKO_LIVE_IDENTITY_RING === "1",
    });
  const live = opts.requestScope !== undefined
    ? await opts.requestScope.acquire(base, opts.keepScope, opts.signal, createStore)
    : kept?.live ?? createStore();
  if (kept !== undefined) live.beginRequest(opts.signal);
  if (keepOn && stamp !== undefined) live.stats.round_trips += 1;
  if (keepOn && stamp === undefined) live.leadStatement = { sql: BOOT_VERSION_STATEMENT, params: [] };
  let completed = false;
  const passes: LivePassReport[] = [];
  const threshold =
    opts.autoThreshold ??
    (env?.DECKO_LIVE_AUTO_THRESHOLD !== undefined ? Number(env.DECKO_LIVE_AUTO_THRESHOLD) : Number.POSITIVE_INFINITY);
  const tail = opts.autoTail ?? (env?.DECKO_LIVE_AUTO_TAIL !== undefined ? Number(env.DECKO_LIVE_AUTO_TAIL) : 0);
  const tailTrips = opts.autoTailTrips === undefined || opts.autoTailTrips < 0 ? undefined : opts.autoTailTrips;
  const seeds = kept?.seeds ?? new Set<string>();
  let choice: "collect" | "speculate" = "collect";
  let blockNext = false;
  const lazyRefs = env?.DECKO_LIVE_STRUCTURE_WALKS !== "1";
  const eagerRefs = kept?.eagerRefs ?? new Set<string>();
  const skipDeniedClosure = env?.DECKO_LIVE_DENIED_CLOSURE !== "1";
  let deniedRootKey: string | undefined = kept?.deniedRootKey;
  const incremental =
    opts.refreshDiscoveryEngine !== undefined && (opts.incremental ?? env?.DECKO_LIVE_INCREMENTAL === "1");
  const incLevel = env?.DECKO_LIVE_INCREMENTAL_LEVEL !== undefined ? Number(env.DECKO_LIVE_INCREMENTAL_LEVEL) : 2;
  const incSweepAll = env?.DECKO_LIVE_INCREMENTAL_SWEEP !== "0";
  let discovering = incremental;
  let discoveryEngine: RenderEngine | undefined;
  DeckoName.beginRequestScope();
  try {
    for (let p = 1; p <= MAX_PASSES; p += 1) {
      if (opts.signal?.aborted === true) throw new LiveRenderAborted();
      const asked = new Set<string>();
      const askStacks = new Map<string, string[]>();
      if (env?.DECKO_LIVE_TRACE_STACK !== undefined) {
        const add = asked.add.bind(asked);
        asked.add = (n: string) => {
          if (!asked.has(n) && !seeds.has(n)) {
            const k = (new Error().stack ?? "").split("\n").slice(2, 12).map((l) => l.trim().replace(/^at (async )?/, "").replace(/ \(.*$/, "")).join(" < ");
            const v = askStacks.get(k) ?? [];
            v.push(n);
            askStacks.set(k, v);
          }
          return add(n);
        };
      }
      const lazyAsked = new Set<string>();
      const out: { engine?: RenderEngine } = {};
      live.mode = blockNext ? "block" : "spec";
      live.blockTrips = blockNext ? tailTrips : undefined;
      if (env?.DECKO_LIVE_TRACE_STACK !== undefined) {
        live.stackTrace = new Map();
        live.stackDepth = Number(env.DECKO_LIVE_TRACE_STACK) || 6;
      }
      const t0 = performance.now();
      let html: string | undefined;
      let threw: unknown;
      try {
        const skipSync = choice === "speculate" ? () => live.mode === "spec" && live.pendingCount > 0 : undefined;
        html = await renderPass(
          live,
          boot,
          page,
          opts,
          choice === "collect" ? { seeds, asked } : undefined,
          skipSync,
          lazyRefs ? { asked: lazyAsked, eager: eagerRefs } : undefined,
          choice === "collect" ? deniedRootKey : undefined,
          out,
          discovering
            ? { engine: discoveryEngine, level: incLevel, sweepAll: incSweepAll, onBoot: (e) => (discoveryEngine = e) }
            : undefined,
        );
      } catch (err) {
        threw = err;
      }
      if (skipDeniedClosure && choice === "collect" && deniedRootKey === undefined && out.engine !== undefined) {
        try {
          const root = out.engine.fetchRenderCard(page);
          if (root !== undefined && out.engine.isDenied(root)) deniedRootKey = root.key;
        } catch {
        }
      }
      const pendingReads = live.pendingCount;
      const fresh = [...asked].filter((n) => !seeds.has(n));
      const lazyFresh = [...lazyAsked].map((n) => DeckoName.parse(n).key).filter((k) => !eagerRefs.has(k));
      const done = pendingReads === 0 && fresh.length === 0 && lazyFresh.length === 0;
      passes.push({
        pass: passes.length + 1,
        kind: discovering ? "disc" : done ? "final" : "spec",
        cpu_ms: Math.round(performance.now() - t0),
        recorded: fresh.length + lazyFresh.length + pendingReads,
      });
      if (env?.DECKO_LIVE_DEBUG === "1") {
        if (threw !== undefined) console.error(`THREW ${String((threw as Error)?.stack ?? threw).slice(0, 600)}`);
        console.error(`PASS ${passes.length} ${discovering ? "disc" : "fresh"} pending=${pendingReads} asked=${fresh.length} lazy=${lazyFresh.length} ${JSON.stringify(fresh.slice(0, 12))} ${JSON.stringify(lazyFresh.slice(0, 6))} ${JSON.stringify(live.debugPending?.().slice(0, 6) ?? [])}`);
      }
      if (discovering && done) {
        discovering = false;
        discoveryEngine = undefined;
        continue;
      }
      const tailSpent = blockNext && live.mode === "spec";
      live.blockTrips = undefined;
      if (tailSpent) blockNext = false;
      if (done) {
        if (env?.DECKO_LIVE_TRACE === "1" && html !== undefined) {
          const h = [...html.replace(/data-slot-id=(["'])[0-9a-f]+\1/g, "")].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 0);
          process.stderr.write(`LIVE-TRACE-FINAL pass ${passes.length} htmlLen ${html.length} htmlHash ${h}\n`);
        }
        if (threw !== undefined) throw threw;
        completed = true;
        return { html: html as string, status: out.engine?.pageErrorStatus ?? 200, stats: { ...live.stats }, passes, choice };
      }
      if (env?.DECKO_LIVE_TRACE === "1") {
        process.stderr.write(
          `LIVE-TRACE pass ${passes.length} ${JSON.stringify({ threw: threw === undefined ? undefined : String((threw as Error)?.stack ?? threw).slice(0, 600), htmlLen: html?.length, htmlHash: html === undefined ? undefined : [...html.replace(/data-slot-id=(["'])[0-9a-f]+\1/g, "")].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0), askStacks: [...askStacks].map(([k, v]) => [v.length, v.slice(0, 3), k]), fresh, lazyFresh, pending: live.describePending(), stacks: live.stackTrace === undefined ? undefined : [...live.stackTrace].sort((a, b) => b[1] - a[1]).slice(0, 12) })}\n`,
        );
      }
      if (choice === "speculate" && tail > 0 && !tailSpent && fresh.length + lazyFresh.length === 0 && pendingReads <= tail) blockNext = true;
      if (env?.DECKO_LIVE_SET_HINTS !== "0") live.hintSetNames(fresh);
      if (pendingReads > 0) await live.flushSpeculative();
      for (const n of fresh) seeds.add(n);
      for (const k of lazyFresh) eagerRefs.add(k);
      if (p === 2 && choice === "collect" && fresh.length + pendingReads > threshold) choice = "speculate";
    }
    throw new Error(`live render did not converge in ${MAX_PASSES} passes`);
  } finally {
    if (stamp === undefined) stamp = stampOf(live.leadResult);
    live.leadStatement = undefined;
    if (opts.requestScope !== undefined) {
      opts.requestScope.release(completed);
    } else if (completed && keepOn && choice === "collect" && stamp !== undefined) {
      putKept(base, key, { live, stamp, seeds, eagerRefs, deniedRootKey });
    } else {
      live.close();
    }
    resetBootCache();
    DeckoName.endRequestScope();
  }
}
