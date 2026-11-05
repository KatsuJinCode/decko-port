import type { SQLDatabaseDriver } from "../../server/driver.js";
import { sqlDateTime } from "./session-store.js";
import { strictParityFlags } from "../parity/strict-parity-flags.js";

export interface SigninSecurityPolicy {
  throttle: boolean;
  maxAccountFailures: number;
  maxAddressFailures: number;
  lockoutSeconds: number;
  uniformFailure: boolean;
  sessionRevocation: boolean;
}

export const DEFAULT_MAX_ACCOUNT_FAILURES = 5;
export const DEFAULT_MAX_ADDRESS_FAILURES = 50;
export const DEFAULT_LOCKOUT_SECONDS = 15 * 60;

export interface SigninSecurityEnv {
  readonly DECKO_SIGNIN_THROTTLE?: unknown;
  readonly DECKO_SIGNIN_MAX_FAILURES?: unknown;
  readonly DECKO_SIGNIN_MAX_ADDRESS_FAILURES?: unknown;
  readonly DECKO_SIGNIN_LOCKOUT_SECONDS?: unknown;
  readonly DECKO_SIGNIN_UNIFORM_FAILURE?: unknown;
  readonly DECKO_SESSION_REVOCATION?: unknown;
}

function readSwitch(env: SigninSecurityEnv | undefined, name: keyof SigninSecurityEnv): boolean {
  const raw = env?.[name];
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "" || value === "on") return true;
  if (value === "off") return false;
  throw new Error(`${name} must be "on" or "off", got ${JSON.stringify(raw)}`);
}

function readCount(env: SigninSecurityEnv | undefined, name: keyof SigninSecurityEnv, fallback: number): number {
  const raw = env?.[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be a whole number of at least 1, got ${JSON.stringify(raw)}`);
  }
  return Number(value);
}

export function signinSecurityPolicyFromEnv(env: SigninSecurityEnv | undefined): SigninSecurityPolicy {
  return {
    throttle: readSwitch(env, "DECKO_SIGNIN_THROTTLE"),
    maxAccountFailures: readCount(env, "DECKO_SIGNIN_MAX_FAILURES", DEFAULT_MAX_ACCOUNT_FAILURES),
    maxAddressFailures: readCount(env, "DECKO_SIGNIN_MAX_ADDRESS_FAILURES", DEFAULT_MAX_ADDRESS_FAILURES),
    lockoutSeconds: readCount(env, "DECKO_SIGNIN_LOCKOUT_SECONDS", DEFAULT_LOCKOUT_SECONDS),
    uniformFailure: readSwitch(env, "DECKO_SIGNIN_UNIFORM_FAILURE"),
    sessionRevocation: readSwitch(env, "DECKO_SESSION_REVOCATION"),
  };
}

let configured: SigninSecurityPolicy | undefined;

export function configureSigninSecurity(policy: SigninSecurityPolicy | undefined): void {
  configured = policy;
}

function processEnv(): SigninSecurityEnv | undefined {
  const proc = (globalThis as { process?: { env?: SigninSecurityEnv } }).process;
  return proc?.env;
}

export function signinSecurityPolicy(): SigninSecurityPolicy {
  const policy = configured ?? signinSecurityPolicyFromEnv(processEnv());
  if (!strictParityFlags().signinDetailedErrors) return policy;
  return policy.uniformFailure ? { ...policy, uniformFailure: false } : policy;
}

export const SIGNIN_THROTTLE_DDL =
  "CREATE TABLE IF NOT EXISTS auth_signin_throttle (" +
  "scope TEXT PRIMARY KEY NOT NULL, " +
  "failures INTEGER NOT NULL, " +
  "window_started_at TEXT NOT NULL, " +
  "locked_until TEXT)";

interface ThrottleRow {
  scope: string;
  failures: number;
  window_started_at: string;
  locked_until: string | null;
}

export interface SigninScopes {
  account: string;
  address?: string;
}

export function signinScopes(identifier: string, address: string | undefined): SigninScopes {
  const account = `account:${identifier.replace(/^[ \t\r\n\f\v\0]+|[ \t\r\n\f\v\0]+$/g, "").toLowerCase()}`;
  const addr = address?.split(",")[0]?.trim();
  return addr === undefined || addr === "" ? { account } : { account, address: `address:${addr}` };
}

export class SigninThrottle {
  private ready = false;

  constructor(
    private readonly driver: SQLDatabaseDriver,
    private readonly policy: SigninSecurityPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async ensureTable(): Promise<void> {
    if (this.ready) return;
    await this.driver.query(SIGNIN_THROTTLE_DDL, []);
    this.ready = true;
  }

  private async row(scope: string): Promise<ThrottleRow | undefined> {
    const result = await this.driver.query<ThrottleRow>(
      "SELECT scope, failures, window_started_at, locked_until FROM auth_signin_throttle WHERE scope = ?",
      [scope],
    );
    return result.rows[0];
  }

  private scopeList(scopes: SigninScopes): Array<{ scope: string; limit: number }> {
    const list = [{ scope: scopes.account, limit: this.policy.maxAccountFailures }];
    if (scopes.address !== undefined) list.push({ scope: scopes.address, limit: this.policy.maxAddressFailures });
    return list;
  }

  async lockedUntil(scopes: SigninScopes): Promise<string | undefined> {
    await this.ensureTable();
    const now = sqlDateTime(this.now());
    for (const { scope } of this.scopeList(scopes)) {
      const row = await this.row(scope);
      if (row?.locked_until != null && row.locked_until > now) return row.locked_until;
    }
    return undefined;
  }

  async recordFailure(scopes: SigninScopes): Promise<void> {
    await this.ensureTable();
    const nowDate = this.now();
    const now = sqlDateTime(nowDate);
    const windowFloor = sqlDateTime(new Date(nowDate.getTime() - this.policy.lockoutSeconds * 1000));
    const lockEnd = sqlDateTime(new Date(nowDate.getTime() + this.policy.lockoutSeconds * 1000));
    for (const { scope, limit } of this.scopeList(scopes)) {
      await this.driver.query(
        `INSERT INTO auth_signin_throttle (scope, failures, window_started_at, locked_until)
         VALUES (?, 1, ?, ?)
         ON CONFLICT (scope) DO UPDATE SET
           locked_until = CASE
             WHEN locked_until > ? THEN locked_until
             WHEN window_started_at < ? THEN CASE WHEN ? <= 1 THEN ? ELSE NULL END
             WHEN failures + 1 >= ? THEN ?
             ELSE locked_until END,
           failures = CASE WHEN window_started_at < ? THEN 1 ELSE failures + 1 END,
           window_started_at = CASE WHEN window_started_at < ? THEN ? ELSE window_started_at END`,
        [scope, now, limit <= 1 ? lockEnd : null,
          now, windowFloor, limit, lockEnd, limit, lockEnd, windowFloor, windowFloor, now],
      );
    }
  }

  async recordSuccess(scopes: SigninScopes): Promise<void> {
    await this.ensureTable();
    await this.driver.query("DELETE FROM auth_signin_throttle WHERE scope = ?", [scopes.account]);
  }
}
