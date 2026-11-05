import type { SQLDatabaseDriver } from "./driver.js";
import type { BlobDriver } from "../blob/driver.js";
import { sqlDateTime } from "../card/auth/session-store.js";

export interface QueueProducerLike {
  send(body: unknown): Promise<void>;
}

export interface SweepMessage {
  readonly kind: "sweep";
  readonly at: string;
}

export type DelayedWorkMessage = SweepMessage;

export const UPLOAD_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function sweepMessage(now: Date): SweepMessage {
  return { kind: "sweep", at: now.toISOString() };
}

export interface DelayedWorkDeps {
  readonly driver: SQLDatabaseDriver;
  readonly files?: BlobDriver;
}

export interface SweepOutcome {
  readonly sessionsDeleted: number;
  readonly draftsDeleted: number;
}

export async function runDelayedWork(message: DelayedWorkMessage, deps: DelayedWorkDeps): Promise<SweepOutcome> {
  if (message === null || typeof message !== "object" || message.kind !== "sweep") {
    throw new Error(`unknown delayed work message: ${JSON.stringify(message)}`);
  }
  const at = new Date(message.at);
  if (Number.isNaN(at.getTime())) throw new Error(`sweep message has no valid time: ${JSON.stringify(message)}`);

  const sessions = await deps.driver.query(`DELETE FROM "auth_sessions" WHERE "expires_at" < ?`, [sqlDateTime(at)]);

  let draftsDeleted = 0;
  if (deps.files !== undefined) {
    const cutoff = at.getTime() - UPLOAD_DRAFT_MAX_AGE_MS;
    for (const entry of await deps.files.list("tmp/")) {
      if (entry.lastModified !== undefined && entry.lastModified.getTime() < cutoff) {
        await deps.files.delete(entry.key);
        draftsDeleted += 1;
      }
    }
  }
  return { sessionsDeleted: sessions.rowsAffected, draftsDeleted };
}
