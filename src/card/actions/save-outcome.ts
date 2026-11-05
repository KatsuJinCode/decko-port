import { DatabaseOutcomeUnknownError } from "../../server/driver.js";
import type { AttachmentStore, AttachmentStoreInput } from "../attachments/attachment-store.js";

export type SaveFileIdentity = Pick<AttachmentStoreInput, "cardId" | "actionId" | "ext" | "area">;
export class FileCleanupCustodyRequiredError extends Error {
  readonly code = "file-cleanup-custody-required";
  readonly retrySafe = false;
  readonly file: SaveFileIdentity;
  constructor(file: SaveFileIdentity) {
    super("Automatic removal of rolled-back files requires exact-write storage custody; file retained for reconciliation");
    this.name = "FileCleanupCustodyRequiredError";
    this.file = { cardId: file.cardId, actionId: file.actionId, ext: file.ext, ...(file.area === undefined ? {} : { area: file.area }) };
  }
}
export interface AssetRecoveryReference {
  target: SaveFileIdentity;
  backup: SaveFileIdentity;
  originalSha256: string;
  replacementSha256: string;
}

export class AssetRecoveryCustodyRequiredError extends Error {
  readonly code = "asset-recovery-custody-required";
  readonly retrySafe = false;

  constructor(readonly recovery: AssetRecoveryReference) {
    super("Automatic asset restoration requires conditional-write custody; target and recovery copy are retained");
    this.name = "AssetRecoveryCustodyRequiredError";
  }
}

export async function assetBytesSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function discardAssetRecovery(store: AttachmentStore, backup: SaveFileIdentity): Promise<void> {
  if (store.discard !== undefined) await store.discard({ ...backup, bytes: new Uint8Array() });
  else if (store.remove !== undefined) await store.remove(backup.cardId, backup.actionId, backup.ext, backup.area);
  else throw new Error(`Recovery cleanup unavailable for ${backup.cardId}/${backup.actionId}${backup.ext}`);
}

export async function reconcileAssetRecoveries(store: AttachmentStore, recoveries: readonly AssetRecoveryReference[],
  outcome: "committed" | "rolled-back"): Promise<void> {
  if (outcome !== "committed" && outcome !== "rolled-back") throw new Error("Asset recovery requires a confirmed database outcome");
  if (outcome === "rolled-back") {
    for (const recovery of [...recoveries].reverse()) {
      const { target, backup, originalSha256, replacementSha256 } = recovery;
      const borrowedBackup = await store.read(backup.cardId, backup.actionId, backup.ext, undefined, backup.area);
      if (borrowedBackup === undefined) throw new Error(`Missing recovery bytes for ${backup.cardId}/${backup.actionId}${backup.ext}`);
      const bytes = new Uint8Array(borrowedBackup);
      if (await assetBytesSha256(bytes) !== originalSha256) throw new Error("Recovery copy no longer matches its recorded bytes");
      const borrowedCurrent = await store.read(target.cardId, target.actionId, target.ext, undefined, target.area);
      if (borrowedCurrent === undefined) throw new Error("Asset missing while recovery was pending; recovery copy retained");
      const current = new Uint8Array(borrowedCurrent);
      const currentHash = await assetBytesSha256(current);
      if (currentHash !== originalSha256 && currentHash !== replacementSha256) throw new Error("Asset changed while recovery was pending; refusing to overwrite it");
      const restore = store.restoreIfUnchanged;
      if (typeof restore !== "function") throw new AssetRecoveryCustodyRequiredError(recovery);
      if (!(await restore.call(store, { ...target, bytes }, current))) {
        throw new Error("Asset changed at conditional restoration; recovery copy retained");
      }
    }
  }
  for (const { backup } of recoveries) await discardAssetRecovery(store, backup);
}

export interface SaveReconciliation {
  cardId?: number;
  actionId?: number;
  actId?: number;
  files: readonly { cardId: number; actionId: number; ext: string; area?: "files" | "tmp" }[];
  recoveries: readonly AssetRecoveryReference[];
  afterCommitPending: boolean;
  nextAction: "read-card-and-action-history-before-retry" | "remove-confirmed-save-recovery-copies";
}

export class SaveOutcomeUnknownError extends DatabaseOutcomeUnknownError {
  readonly reconciliation: SaveReconciliation;

  constructor(error: DatabaseOutcomeUnknownError, prepared: unknown,
    files: readonly AttachmentStoreInput[], afterCommitPending: boolean,
    recoveries: readonly AssetRecoveryReference[] = []) {
    super(error.operation, error);
    this.name = "SaveOutcomeUnknownError";
    const ids: { cardId?: number; actionId?: number; actId?: number } = {};
    if (prepared !== null && typeof prepared === "object") {
      for (const key of ["cardId", "actionId", "actId"] as const) {
        const id = (prepared as Record<string, unknown>)[key];
        if (typeof id === "number" && Number.isSafeInteger(id)) ids[key] = id;
      }
    }
    this.reconciliation = {
      ...ids,
      files: files.map(({ cardId, actionId, ext, area }) => ({ cardId, actionId, ext, ...(area ? { area } : {}) })),
      recoveries,
      afterCommitPending,
      nextAction: "read-card-and-action-history-before-retry",
    };
  }
}

export class CommittedSaveCleanupError extends AggregateError {
  readonly code = "save-committed-cleanup-pending";
  readonly outcome = "committed";
  readonly retrySafe = false;
  readonly reconciliation: SaveReconciliation;

  constructor(errors: unknown[], recoveries: readonly AssetRecoveryReference[], afterCommitPending = false) {
    super(errors, "The save committed but recovery copy cleanup failed; do not repeat the save");
    this.name = "CommittedSaveCleanupError";
    this.reconciliation = { files: [], recoveries, afterCommitPending, nextAction: "remove-confirmed-save-recovery-copies" };
  }
}

export function saveOutcomeDiagnostic(error: unknown): {
  format: string;
  errors: Array<Record<string, string | number | boolean>>;
} {
  const names = new Set(["Error", "TypeError", "AggregateError", "AbortError", "TimeoutError",
    "BunnyDbError", "DatabaseOutcomeUnknownError", "SaveOutcomeUnknownError",
    "CommittedSaveCleanupError", "FileCleanupCustodyRequiredError", "AssetRecoveryCustodyRequiredError"]);
  const codes = new Set(["TRANSACTION_TIMEOUT", "STREAM_EXPIRED", "STREAM_NOT_FOUND", "STREAM_CLOSED",
    "BATCH_STEP_FAILED", "SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT", "SQLITE_LOCKED", "SQLITE_ERROR",
    "SQLITE_CONSTRAINT", "SQLITE_IOERR", "SQLITE_ABORT", "ABORT_ERR", "database-outcome-unknown",
    "save-committed-cleanup-pending", "file-cleanup-custody-required", "asset-recovery-custody-required"]);
  const pending: unknown[] = [error], seen = new Set<object>();
  const errors: Array<Record<string, string | number | boolean>> = [];
  for (let i = 0; i < pending.length; i++) {
    const value = pending[i];
    if (value === null || typeof value !== "object") { errors.push({ name: "NonObjectError" }); continue; }
    if (seen.has(value)) continue;
    seen.add(value);
    const own = (key: string): unknown => {
      try { return Object.getOwnPropertyDescriptor(value, key)?.value; }
      catch { return undefined; }
    };
    const name = own("name"), code = own("code"), operation = own("operation"), status = own("status");
    const entry: Record<string, string | number | boolean> = {
      name: typeof name === "string" && names.has(name) ? name : "OtherError",
    };
    if (code !== undefined) entry.code = typeof code === "string" && codes.has(code) ? code : "unclassified";
    if (operation === "statement" || operation === "commit" || operation === "rollback") entry.operation = operation;
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) entry.status = status;
    if (typeof own("transport") === "boolean") entry.transport = own("transport") as boolean;
    errors.push(entry);
    const cause = own("cause");
    if (cause !== undefined) pending.push(cause);
    const nested = own("errors");
    if (Array.isArray(nested)) for (const child of nested) pending.push(child);
  }
  return { format: "decko-save-outcome-diagnostic/1", errors };
}
