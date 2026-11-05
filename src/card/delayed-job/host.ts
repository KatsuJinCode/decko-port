import type { SQLDatabaseDriver } from "../../server/driver.js";
import type { FetchEngine } from "../fetch.js";
import { CardActionEngine, type CardActionEngineOptions } from "../actions/card-action-engine.js";
import {
  DelayedJobWorker,
  SqlDelayedJobQueue,
  SqlDelayedJobStore,
  type AfterResponse,
  type DelayedEventJob,
  type DelayedJobsConfig,
} from "./delayed-job.js";

export function delayingFromEnv(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export interface HostDelayedJobsOptions {
  readonly driver: SQLDatabaseDriver;
  readonly fetcher: FetchEngine;
  readonly delaying: boolean;
  readonly afterResponse: AfterResponse;
  readonly engineOptions?: Omit<CardActionEngineOptions, "actor" | "delayedJobs">;
  readonly globalIdApp?: string;
  readonly workerName?: string;
  readonly log?: (line: string) => void;
}

export interface HostDelayedJobs {
  readonly config: DelayedJobsConfig | undefined;
  readonly worker: DelayedJobWorker;
}

export function hostDelayedJobs(opts: HostDelayedJobsOptions): HostDelayedJobs {
  const store = new SqlDelayedJobStore(opts.driver, {
    ...(opts.workerName === undefined ? {} : { workerName: opts.workerName }),
    ...(opts.globalIdApp === undefined ? {} : { globalIdApp: opts.globalIdApp }),
  });
  const perform = async (job: DelayedEventJob): Promise<void> => {
    const actorId = job.auth.current_id;
    const actorCard = actorId === null ? undefined : await opts.fetcher.fetchById(actorId);
    const actor = actorId !== null && actorCard?.name !== undefined ? { id: actorId, name: actorCard.name.s } : null;
    const engine = new CardActionEngine(opts.fetcher, { ...(opts.engineOptions ?? {}), actor });
    await engine.performDelayedJob(job);
  };
  const worker = new DelayedJobWorker(store, perform, opts.log);
  return {
    config: opts.delaying ? { delaying: true, queue: new SqlDelayedJobQueue(worker, opts.afterResponse) } : undefined,
    worker,
  };
}
