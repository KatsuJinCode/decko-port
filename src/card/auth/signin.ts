import type { SQLDatabaseDriver } from "../../server/driver.js";
import type { Actor } from "./actor.js";
import { SessionStore, type SessionCreation } from "./session-store.js";
import { checkPassword, hashPassword, passwordHashPolicy } from "./password-hash.js";
import {
  SigninThrottle,
  signinScopes,
  signinSecurityPolicy,
  type SigninSecurityPolicy,
} from "./signin-security.js";

const RUBY_STRIP_RE = /^[ \t\r\n\f\v\0]+|[ \t\r\n\f\v\0]+$/g;

export function rubyStrip(value: string): string {
  return value.replace(RUBY_STRIP_RE, "");
}

export async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", data);
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function encryptAccountPassword(password: string, salt: string): Promise<string> {
  return sha1Hex(`${salt}--${password}--`);
}

export async function verifyAccountPassword(
  storedDigest: string,
  password: string,
  salt: string,
): Promise<boolean> {
  return (await checkPassword(storedDigest, password, salt)).ok;
}

const ACCOUNT_CODENAMES = ["account", "email", "password", "salt", "status"] as const;

export interface AccountCodenameIds {
  account: number;
  email: number;
  password: number;
  salt: number;
  status: number;
}

export async function resolveAccountCodenameIds(
  driver: SQLDatabaseDriver,
): Promise<AccountCodenameIds | null> {
  const ids: Partial<Record<(typeof ACCOUNT_CODENAMES)[number], number>> = {};
  for (const codename of ACCOUNT_CODENAMES) {
    const result = await driver.query<{ id: number }>(
      "SELECT id FROM cards WHERE codename = ? AND trash = 0 ORDER BY id LIMIT 1",
      [codename],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    ids[codename] = row.id;
  }
  return ids as AccountCodenameIds;
}

interface AccountJunctionRow {
  id: number;
  left_id: number;
  holder_name: string | null;
}

async function accountJunctionForHolder(
  driver: SQLDatabaseDriver,
  ids: AccountCodenameIds,
  holderId: number,
): Promise<AccountJunctionRow | undefined> {
  const result = await driver.query<AccountJunctionRow>(
    `SELECT a.id, a.left_id, h.name AS holder_name
     FROM cards a JOIN cards h ON h.id = a.left_id
     WHERE a.left_id = ? AND a.right_id = ? AND a.trash = 0
     ORDER BY a.id LIMIT 1`,
    [holderId, ids.account],
  );
  return result.rows[0];
}

async function accountFieldContent(
  driver: SQLDatabaseDriver,
  ids: AccountCodenameIds,
  junctionId: number,
  field: "email" | "password" | "salt" | "status",
): Promise<string | undefined> {
  const result = await driver.query<{ db_content: string | null }>(
    `SELECT db_content FROM cards
     WHERE left_id = ? AND right_id = ? AND trash = 0
     ORDER BY id LIMIT 1`,
    [junctionId, ids[field]],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return row.db_content ?? "";
}

async function upgradeStoredPassword(
  driver: SQLDatabaseDriver,
  ids: AccountCodenameIds,
  junctionId: number,
  value: string,
): Promise<void> {
  try {
    await driver.query("UPDATE cards SET db_content = ? WHERE left_id = ? AND right_id = ? AND trash = 0", [
      value,
      junctionId,
      ids.password,
    ]);
  } catch {
  }
}

export type SigninFailureReason =
  | "email_missing"
  | "password_missing"
  | "unknown_email"
  | "not_active"
  | "wrong_password"
  | "account_system_absent"
  | "account_card_unresolvable"
  | "password_hash_unsupported"
  | "invalid_credentials"
  | "throttled";

export interface SigninFailure {
  ok: false;
  reason: SigninFailureReason;
  message: string;
}

const SIGNIN_MESSAGES: Record<SigninFailureReason, string> = {
  email_missing: "email can't be blank",
  password_missing: "password can't be blank",
  unknown_email: "Unrecognized email.",
  not_active: "Sorry, that account is not active.",
  wrong_password: "Wrong password",
  account_system_absent: "This deck has no account system.",
  account_card_unresolvable: "The account card for this session could not be resolved.",
  password_hash_unsupported:
    "This server cannot check this account's password: its stored hash needs more PBKDF2 iterations than this runtime allows. Reset the password to sign in here.",
  invalid_credentials: "Wrong email or password.",
  throttled: "Too many failed sign-in attempts. Try again later.",
};

function failure(reason: SigninFailureReason): SigninFailure {
  return { ok: false, reason, message: SIGNIN_MESSAGES[reason] };
}

export interface AuthenticatedAccount {
  holder: Actor;
  accountId: number;
}

export async function authenticateAccount(
  driver: SQLDatabaseDriver,
  identifier: string,
  password: string,
  security: SigninSecurityPolicy = signinSecurityPolicy(),
): Promise<{ ok: true; account: AuthenticatedAccount } | SigninFailure> {
  const id = rubyStrip(identifier);
  if (id === "") return failure("email_missing");
  if (password === "") return failure("password_missing");

  const ids = await resolveAccountCodenameIds(driver);
  if (ids === null) return failure("account_system_absent");

  const junction =
    (await findJunctionByEmail(driver, ids, id)) ??
    (await findJunctionByName(driver, ids, id));
  const policy = passwordHashPolicy();
  if (junction === undefined) {
    if (!security.uniformFailure) return failure("unknown_email");
    await hashPassword(rubyStrip(password), "", policy);
    return failure("invalid_credentials");
  }

  const checkStoredPassword = async () => {
    const storedDigest = (await accountFieldContent(driver, ids, junction.id, "password")) ?? "";
    const salt = (await accountFieldContent(driver, ids, junction.id, "salt")) ?? "";
    return { salt, check: await checkPassword(storedDigest, rubyStrip(password), salt, policy) };
  };

  const status = await accountFieldContent(driver, ids, junction.id, "status");
  if (status !== "active") {
    if (!security.uniformFailure) return failure("not_active");
    const { check } = await checkStoredPassword();
    return failure(check.ok ? "not_active" : "invalid_credentials");
  }

  const { salt, check } = await checkStoredPassword();
  if (check.unsupported !== undefined) return failure("password_hash_unsupported");
  if (!check.ok) return failure(security.uniformFailure ? "invalid_credentials" : "wrong_password");
  if (check.needsUpgrade) {
    await upgradeStoredPassword(driver, ids, junction.id, await hashPassword(rubyStrip(password), salt, policy));
  }

  if (junction.holder_name === null) return failure("account_card_unresolvable");

  return {
    ok: true,
    account: {
      holder: { id: junction.left_id, name: junction.holder_name },
      accountId: junction.id,
    },
  };
}

async function findJunctionByEmail(
  driver: SQLDatabaseDriver,
  ids: AccountCodenameIds,
  identifier: string,
): Promise<AccountJunctionRow | undefined> {
  const email = rubyStrip(identifier).toLowerCase();
  const result = await driver.query<AccountJunctionRow>(
    `SELECT a.id, a.left_id, h.name AS holder_name
     FROM cards a
     JOIN cards e ON e.left_id = a.id AND e.right_id = ? AND e.trash = 0
     JOIN cards h ON h.id = a.left_id
     WHERE a.right_id = ? AND a.trash = 0 AND e.db_content = ?
     ORDER BY a.id LIMIT 1`,
    [ids.email, ids.account, email],
  );
  return result.rows[0];
}

async function findJunctionByName(
  driver: SQLDatabaseDriver,
  ids: AccountCodenameIds,
  identifier: string,
): Promise<AccountJunctionRow | undefined> {
  const rubyKey = identifier.toLowerCase().replace(/ /g, "_");
  const holderResult = await driver.query<{ id: number; name: string | null }>(
    `SELECT id, name FROM cards
     WHERE trash = 0 AND (name = ? OR key = ?)
     ORDER BY (name = ?) DESC, id LIMIT 1`,
    [identifier, rubyKey, identifier],
  );
  const holder = holderResult.rows[0];
  if (holder === undefined) return undefined;
  return accountJunctionForHolder(driver, ids, holder.id);
}

export interface SigninSuccess {
  ok: true;
  actor: Actor;
  session: SessionCreation;
}

export type SigninOutcome = SigninSuccess | SigninFailure;

export async function signinAccount(
  driver: SQLDatabaseDriver,
  sessions: SessionStore,
  identifier: string,
  password: string,
  options: { clientAddress?: string; now?: () => Date; security?: SigninSecurityPolicy } = {},
): Promise<SigninOutcome> {
  const security = options.security ?? signinSecurityPolicy();
  const throttle =
    security.throttle && rubyStrip(identifier) !== "" && password !== ""
      ? new SigninThrottle(sessions.storageDriver, security, options.now)
      : undefined;
  const scopes = signinScopes(identifier, options.clientAddress);
  if (throttle !== undefined && (await throttle.lockedUntil(scopes)) !== undefined) {
    return failure("throttled");
  }
  const result = await authenticateAccount(driver, identifier, password, security);
  if (!result.ok) {
    if (
      throttle !== undefined &&
      (result.reason === "unknown_email" ||
        result.reason === "not_active" ||
        result.reason === "wrong_password" ||
        result.reason === "invalid_credentials")
    ) {
      await throttle.recordFailure(scopes);
    }
    return result;
  }
  if (throttle !== undefined) await throttle.recordSuccess(scopes);
  const session = await sessions.createSession(result.account.holder.id);
  return { ok: true, actor: result.account.holder, session };
}

export async function signoutAccount(
  sessions: SessionStore,
  token: string | null | undefined,
): Promise<boolean> {
  if (token === null || token === undefined || token === "") return false;
  return sessions.revokeSession(token);
}
