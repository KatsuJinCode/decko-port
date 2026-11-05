import type { SQLDatabaseDriver } from "../../src/server/driver.js";
export interface RecoveryCard { id: number; [field: string]: unknown }
export interface MembersKeyRecoveryPlan {
  schema: "decko-members-key-recovery/1";
  status: "ready" | "blocked" | "noop";
  sha256: string;
  beforeVersion: number;
  schemaStamp: string;
  tableListStamp: string;
  triggerStamp: string;
  members: RecoveryCard[];
  blockers: Array<{ code: string; [field: string]: unknown }>;
  keyUpdate: { id: number; before: string; after: string } | null;
  memberships: Array<{ card: RecoveryCard; ids?: number[]; references: Record<string, unknown>[] }>;
  missingReferences: Array<{ refererId: number; refereeId: number }>;
  reconciliation?: {
    sideIds?: number[];
    compounds?: RecoveryCard[];
    compoundCollisions?: Array<{ originalCompoundId: number; canonicalCompoundId: number; leftId: number }>;
    historyCounts?: Array<{ card_id: number; actions: number }>;
    references?: Record<string, unknown>[];
    blockers?: Array<{ code: string; [field: string]: unknown }>;
    steps: string[];
  };
}
export class MembersKeyRecoveryError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export function planMembersKeyRecovery(driver: SQLDatabaseDriver): Promise<MembersKeyRecoveryPlan>;
export function applyMembersKeyRecovery(driver: SQLDatabaseDriver, expectedPlanSha256: string): Promise<{
  schema: "decko-members-key-recovery/1";
  status: "applied" | "noop";
  planSha256: string;
  version?: number;
  membersId?: number;
  keyChanged?: boolean;
  referencesAdded?: number;
  beforeVersion?: number;
  afterVersion?: number;
}>;
