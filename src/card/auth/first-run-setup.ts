import type { SQLDatabaseDriver } from "../../server/driver.js";
import { storedPasswordValue } from "../actions/account-fields.js";
import type { FetchEngine } from "../fetch.js";
import { CardActionEngine } from "../actions/card-action-engine.js";
import { CardActionError } from "../actions/types.js";
import { DeckoName } from "../name.js";
import { actorAnonymous, actorBot } from "./actor.js";
import {
  resolveAccountCodenameIds,
  rubyStrip,
  sha1Hex,
  type AccountCodenameIds,
} from "./signin.js";
import type { Actor } from "./actor.js";

export function firstRunEnabled(): boolean {
  return process.env.DECKO_FIRST_RUN === "1";
}

export const SHIPPED_ACCOUNT_CODENAMES = ["decko_bot", "anonymous"] as const;

export async function countUserAccounts(
  driver: SQLDatabaseDriver,
  ids: AccountCodenameIds,
  shippedAccountHolderIds: readonly number[],
): Promise<number> {
  const excluded = shippedAccountHolderIds.join(", ");
  const result = await driver.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM cards
     WHERE right_id = ? AND trash = 0 AND NOT (left_id IN (${excluded}))`,
    [ids.account],
  );
  return Number(result.rows[0]?.n ?? 0);
}

export type SetupWindowReason =
  | "disabled"
  | "write_path_disabled"
  | "account_system_absent"
  | "bot_card_absent"
  | "needs_setup"
  | "setup_complete";

export interface SetupWindowState {
  readonly reason: SetupWindowReason;
  readonly open: boolean;
  readonly accountCount: number | undefined;
  readonly writePathEnabled: boolean;
}

export interface SetupWindowDeps {
  readonly driver: SQLDatabaseDriver;
  readonly corpusShippedAccountHolderIds?: readonly number[];
}

export type SetupCensusReason =
  | "needs_setup"
  | "setup_complete"
  | "account_system_absent"
  | "bot_card_absent";

export interface SetupCensusResult {
  readonly reason: SetupCensusReason;
  readonly open: boolean;
  readonly accountCount: number | undefined;
}

export async function setupCensus(
  deps: SetupWindowDeps,
): Promise<SetupCensusResult> {
  const ids = await resolveAccountCodenameIds(deps.driver);
  if (ids === null) {
    return { reason: "account_system_absent", open: false, accountCount: undefined };
  }
  const bot = await actorBot(deps.driver).catch(() => undefined);
  if (bot === undefined) {
    return { reason: "bot_card_absent", open: false, accountCount: undefined };
  }
  const shippedHolderIds: number[] = [bot.id];
  const anon = await actorAnonymous(deps.driver).catch(() => undefined);
  if (anon !== undefined) shippedHolderIds.push(anon.id);
  shippedHolderIds.push(...(deps.corpusShippedAccountHolderIds ?? []));
  const count = await countUserAccounts(deps.driver, ids, shippedHolderIds);
  return {
    reason: count === 0 ? "needs_setup" : "setup_complete",
    open: count === 0,
    accountCount: count,
  };
}

export async function setupWindowState(
  deps: SetupWindowDeps,
): Promise<SetupWindowState> {
  const writePath = process.env.DECKO_WRITE_PATH === "1";
  if (!firstRunEnabled()) return { reason: "disabled", open: false, accountCount: undefined, writePathEnabled: writePath };
  if (!writePath) {
    return { reason: "write_path_disabled", open: false, accountCount: undefined, writePathEnabled: false };
  }
  const census = await setupCensus(deps);
  return {
    reason: census.reason,
    open: census.open,
    accountCount: census.accountCount,
    writePathEnabled: true,
  };
}

const EMAIL_RE = /^([^@\s]+)@((?:[-a-z0-9]+\.)+[a-z]{2,})$/i;

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_REQUIREMENTS = ["lower", "upper", "special_char", "number"] as const;
const PASSWORD_REGEX: Record<(typeof PASSWORD_REQUIREMENTS)[number], RegExp> = {
  lower: /[a-z]/,
  upper: /[A-Z]/,
  special_char: /[!"#$%&'()*+,-./:;<=>?@[\]\\^_`{|}~]/,
  number: /\d+/,
};

const ACCOUNT_EN = {
  error_blank: "can't be blank",
  error_invalid_address: "must be valid address",
  error_not_unique: "must be unique",
  password_length: "must be %{num_char} characters or longer",
  password_requirements: "must contain %{char_type}",
  pw_upper: "an upper case letter",
  pw_lower: "a lower case letter",
  pw_special_char: "a special character (like !@$%&#)",
  pw_number: "a number",
} as const;

export type OwnerInputFailureReason =
  | "email_blank"
  | "email_invalid"
  | "email_taken"
  | "password_blank"
  | "password_too_short"
  | "password_missing_char_types";

export interface OwnerInputFailure {
  readonly ok: false;
  readonly reason: OwnerInputFailureReason;
  readonly message: string;
  readonly field: "email" | "password";
}

export function checkNewAccountPassword(
  password: string,
): { ok: true } | OwnerInputFailure {
  if (password === "") {
    return { ok: false, reason: "password_blank", message: ACCOUNT_EN.error_blank, field: "password" };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      reason: "password_too_short",
      message: ACCOUNT_EN.password_length.replace("%{num_char}", String(PASSWORD_MIN_LENGTH)),
      field: "password",
    };
  }
  const missing = PASSWORD_REQUIREMENTS.filter((t) => !PASSWORD_REGEX[t].test(password)).map(
    (t) => {
      switch (t) {
        case "lower": return ACCOUNT_EN.pw_lower;
        case "upper": return ACCOUNT_EN.pw_upper;
        case "special_char": return ACCOUNT_EN.pw_special_char;
        case "number": return ACCOUNT_EN.pw_number;
      }
    },
  );
  if (missing.length > 0) {
    const consolidated =
      missing.length > 2
        ? `${missing.slice(0, -1).join(", ")}, and ${missing[missing.length - 1]}`
        : missing.join(" and ");
    return {
      ok: false,
      reason: "password_missing_char_types",
      message: ACCOUNT_EN.password_requirements.replace("%{char_type}", consolidated),
      field: "password",
    };
  }
  return { ok: true };
}

export function normalizeNewAccountEmail(
  rawEmail: string,
): { ok: true; email: string } | OwnerInputFailure {
  const email = rubyStrip(rawEmail).toLowerCase();
  if (email === "") {
    return { ok: false, reason: "email_blank", message: ACCOUNT_EN.error_blank, field: "email" };
  }
  if (!EMAIL_RE.test(email)) {
    return {
      ok: false,
      reason: "email_invalid",
      message: ACCOUNT_EN.error_invalid_address,
      field: "email",
    };
  }
  return { ok: true, email };
}

const NAME_ILLEGAL = /[^A-Za-z0-9 ]/g;

const MAX_TRUNK = 60;

export async function ownerCardNameFor(
  fetcher: FetchEngine,
  email: string,
): Promise<string> {
  const local = email.slice(0, email.lastIndexOf("@"));
  const cleaned = local
    .toLowerCase()
    .replace(NAME_ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TRUNK)
    .trim();
  const base = cleaned === "" ? "owner" : cleaned;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base} ${attempt + 1}`;
    const taken = await fetcher.driver.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM cards WHERE key = ? AND trash = 0",
      [candidate.toLowerCase().replace(/ /g, "_")],
    );
    if (Number(taken.rows[0]?.n ?? 0) === 0) return candidate;
  }
  throw new CardActionError(
    "name-illegal",
    `could not derive an unused owner card name from ${base}`,
  );
}

export type OwnerCreateFailureReason =
  | SetupWindowReason
  | OwnerInputFailureReason
  | "write_failed";

export interface OwnerCreateSuccess {
  readonly ok: true;
  readonly owner: Actor;
  readonly accountId: number;
  readonly email: string;
  readonly salt: string;
  readonly fieldCardIds: {
    readonly email: number;
    readonly salt: number;
    readonly status: number;
    readonly password: number;
  };
  readonly signInAt: string;
}

export interface OwnerCreateFailure {
  readonly ok: false;
  readonly reason: OwnerCreateFailureReason;
  readonly message: string;
  readonly field?: "email" | "password";
}

export type OwnerCreateOutcome = OwnerCreateSuccess | OwnerCreateFailure;

export interface CreateOwnerDeps extends SetupWindowDeps {
  readonly fetcher: FetchEngine;
  readonly now?: () => Date;
}

export async function createOwnerAccount(
  deps: CreateOwnerDeps,
  input: {
    email: string;
    password: string;
    cardName?: string;
  },
): Promise<OwnerCreateOutcome> {
  const window = await setupWindowState(deps);
  if (!window.open) {
    return { ok: false, reason: window.reason, message: SETUP_CLOSED_MESSAGE[window.reason] };
  }

  const normalized = normalizeNewAccountEmail(input.email);
  if (!normalized.ok) return normalized;
  const email = normalized.email;

  const passwordCheck = checkNewAccountPassword(input.password);
  if (!passwordCheck.ok) return passwordCheck;

  const ids = await resolveAccountCodenameIds(deps.driver);
  if (ids === null) {
    return { ok: false, reason: "account_system_absent", message: SETUP_CLOSED_MESSAGE.account_system_absent };
  }
  const bot = await actorBot(deps.driver);

  const duplicate = await deps.driver.query<{ id: number }>(
    `SELECT id FROM cards
     WHERE right_id = ? AND db_content = ? AND trash = 0
     ORDER BY id LIMIT 1`,
    [ids.email, email],
  );
  if (duplicate.rows[0] !== undefined) {
    return {
      ok: false,
      reason: "email_taken",
      message: ACCOUNT_EN.error_not_unique,
      field: "email",
    };
  }

  const now = (deps.now ?? (() => new Date()))();
  const salt = await sha1Hex(`--${rubyTimestamp(now)}--`);

  const engine = new CardActionEngine(deps.fetcher, { actor: bot, now: () => now });
  const ownerName = input.cardName ?? (await ownerCardNameFor(deps.fetcher, email));
  const userTypeId = await resolveCodenameCardId(deps.driver, "user");
  if (userTypeId === undefined) {
    return {
      ok: false,
      reason: "account_system_absent",
      message: SETUP_CLOSED_MESSAGE.account_system_absent,
    };
  }
  try {
    const owner = await engine.createCard({ name: ownerName, typeId: userTypeId });
    const ownerId = owner.cardId;
    const junction = await engine.createCard({
      name: `${ownerName}+*account`,
      subcards: { "+*email": { content: email } },
    });
    const junctionId = junction.cardId;
    const fieldId = async (field: string): Promise<number> => {
      const id = await deps.fetcher.lexicon.id(DeckoName.parse(`${ownerName}+*account+${field}`));
      if (id === undefined) throw new CardActionError("not-found", `missing ${ownerName}+*account+${field}`);
      return id;
    };
    const emailCard = { cardId: await fieldId("*email") };
    const saltCard = { cardId: await fieldId("*salt") };
    const statusCard = { cardId: await fieldId("*status") };
    const digest = await storedPasswordValue(input.password, salt);
    const passwordCard = await engine.createCard({
      name: `${ownerName}+*account+*password`,
      content: digest,
      passwordEncrypted: true,
    });
    await ensureCard(engine, "signup alert email+to", ownerName);
    for (const role of ["Help Desk", "Shark", "Administrators"]) {
      await ensureCard(engine, `${role}+*members`, ownerName);
    }
    return {
      ok: true,
      owner: { id: ownerId, name: ownerName },
      accountId: junctionId,
      email,
      salt,
      fieldCardIds: {
        email: emailCard.cardId,
        salt: saltCard.cardId,
        status: statusCard.cardId,
        password: passwordCard.cardId,
      },
      signInAt: SIGN_IN_PATH,
    };
  } catch (error) {
    if (error instanceof CardActionError) {
      return { ok: false, reason: "write_failed", message: error.message };
    }
    return {
      ok: false,
      reason: "write_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function ensureCard(
  engine: CardActionEngine,
  name: string,
  content: string,
): Promise<void> {
  const existing = await engine.fetch.fetchByName(name);
  if (existing !== undefined && existing.id !== undefined) {
    await engine.updateCard({ cardId: existing.id, content });
  } else {
    await engine.createCard({ name, content });
  }
}

async function resolveCodenameCardId(
  driver: SQLDatabaseDriver,
  codename: string,
): Promise<number | undefined> {
  const result = await driver.query<{ id: number }>(
    "SELECT id FROM cards WHERE codename = ? AND trash = 0 ORDER BY id LIMIT 1",
    [codename],
  );
  return result.rows[0]?.id;
}

function rubyTimestamp(when: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return (
    `${when.getUTCFullYear()}-${p(when.getUTCMonth() + 1)}-${p(when.getUTCDate())} ` +
    `${p(when.getUTCHours())}:${p(when.getUTCMinutes())}:${p(when.getUTCSeconds())} UTC`
  );
}

export const SIGN_IN_PATH = "/_signin";

export const SETUP_CLOSED_REASONS = [
  "disabled",
  "write_path_disabled",
  "account_system_absent",
  "bot_card_absent",
  "setup_complete",
] as const satisfies ReadonlyArray<Exclude<SetupWindowReason, "needs_setup">>;

export type SetupClosedReason = (typeof SETUP_CLOSED_REASONS)[number];

const SETUP_CLOSED_MESSAGE: Record<SetupWindowReason, string> = {
  disabled: "This deck is not running first-run setup.",
  write_path_disabled: "This deck is running read-only; account creation is unavailable.",
  account_system_absent:
    "This deck has no account system, so it has no first account to create.",
  bot_card_absent:
    "This deck has no Decko Bot card, so the account census cannot run.",
  setup_complete: "This deck already has an account. Sign in instead.",
  needs_setup: "This deck is ready for its first account.",
};
