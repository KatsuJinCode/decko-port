import type { SQLDatabaseDriver } from "../../server/driver.js";
import type { Actor } from "./actor.js";
import { actorBot } from "./actor.js";
import { encryptAccountPassword } from "./signin.js";
import { storedPasswordValue } from "../actions/account-fields.js";
import { SessionStore, type SessionCreation } from "./session-store.js";
import {
  decodeAuthToken,
  encodeAuthToken,
  claimUserId,
  type TokenClaims,
  type TokenRuntimeConfig,
} from "./token.js";
import {
  resolveAccountCodenameIds,
  rubyStrip,
  type AccountCodenameIds,
} from "./signin.js";
import { CardActionEngine } from "../actions/card-action-engine.js";
import { cardWallClockNow } from "../wall-clock.js";
import type { FetchEngine } from "../fetch.js";
import type { MailMessage, NotifyTransport } from "../notify/types.js";
import { addressOf, resolveFromAddress } from "../notify/mail.js";
import { DeckoName } from "../name.js";

export interface AccountFlowContext {
  readonly now?: () => Date;
  readonly ipAddress?: string | null;
  readonly driver: SQLDatabaseDriver;
  readonly fetcher: FetchEngine;
  readonly sessions: SessionStore;
  readonly transport: NotifyTransport;
  readonly token: TokenRuntimeConfig;
  readonly origin: string;
  readonly relativeUrlRoot?: string;
  readonly siteTitle: string;
  readonly deckoBotEmail?: string;
}

const ACCOUNT_EN = {
  error_blank: "can't be blank",
  error_not_active: "Sorry, that account is not active.",
  error_not_recognized: "not recognized",
  sorry_email_reset:
    "Sorry, %{error_msg}. Please check your email for a new password reset link.",
  password_length: "must be %{num_char} characters or longer",
  password_requirements: "must contain %{char_type}",
  pw_upper: "an upper case letter",
  pw_lower: "a lower case letter",
  pw_special_char: "a special character (like !@$%&#)",
  pw_number: "a number",
} as const;

const VERIFY_FAILURE_MESSAGE =
  "Sorry, %{error_msg}. Please check your email for a new activation link.";

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_REQUIREMENTS = ["lower", "upper", "special_char", "number"] as const;

const PASSWORD_REGEX: Record<(typeof PASSWORD_REQUIREMENTS)[number], RegExp> = {
  lower: /[a-z]/,
  upper: /[A-Z]/,
  special_char: /[!"#$%&'()*+,-./:;<=>?@[\]\\^_`{|}~]/,
  number: /\d+/,
};

const RESET_EMAIL_TEMPLATE = {
  codename: "password_reset_email",
  from: "Decko Bot",
  subject: "reset password for {{:title|core}}",
  text:
    "** Password reset for {{:title|core}} **\n\n" +
    "Someone – you, we hope – asked to reset your password.  Please follow this link...\n\n" +
    "  {{_|reset_password_url}}\n" +
    "  \n" +
    "...to update your account details.\n\n\n" +
    "(Link will remain valid for {{_|reset_password_days}} days.)\n\n",
  html:
    '<div style="text-align:center">\n' +
    " <h1>Password reset for {{:title|core}}</h1>\n" +
    "  \n" +
    "  <p>Someone – you, we hope – asked to reset your password.</p>\n" +
    "  \n" +
    '  <p>Please <a href="{{_|reset_password_url}}">follow this link</a> to update your account details.</p>\n' +
    "  \n" +
    "  <p><em>Link will remain valid for {{_|reset_password_days}} days.</em></p>\n" +
    "</div>\n\n",
} as const;

const VERIFY_EMAIL_TEMPLATE = {
  codename: "verification_email",
  from: "Decko Bot",
  subject: "verification link for {{:title|core}}",
  text:
    "Thank you for signing up with {{:title|core}}!\n\n" +
    "Please follow the link below to verify this email address and activate your account.\n\n" +
    "{{_|verify_url}}\n" +
    "(Link will remain valid for {{_|verify_days}} days.)\n",
  html:
    '<div style="text-align:center">\n' +
    "  <h1>Thank you for signing up with {{:title|core}}!</h1>\n" +
    "  <p>\n" +
    '    Please <a href="{{_|verify_url}}">follow this link</a>\n' +
    "    to verify this email address and activate your account.\n" +
    "  </p>\n" +
    "  <p><em>Link will remain valid for {{_|verify_days}} days.</em></p>\n" +
    "</div>",
} as const;

const WELCOME_EMAIL_TEMPLATE = {
  codename: "welcome_email",
  from: "",
  subject: "",
  text: "",
  html: "",
} as const;

function renderAccountTemplate(
  template: { subject: string; text: string; html?: string },
  vars: { siteTitle: string; url: string; days: string },
): { subject: string; text: string; html?: string } {
  const daysToken = /\{\{_\|(?:reset_password_days|verify_days)\}\}/g;
  const sub = (s: string): string =>
    s
      .replace(/\{\{:title\|core\}\}/g, vars.siteTitle)
      .replace(/\{\{_\|(?:reset_password_url|verify_url)\}\}/g, vars.url)
      .replace(daysToken, vars.days);
  return {
    subject: sub(template.subject),
    text: sub(template.text),
    ...(template.html !== undefined ? { html: sub(template.html) } : {}),
  };
}

export interface AccountRecord {
  readonly id: number;
  readonly holder: Actor;
  readonly name: string;
  readonly email: string | undefined;
  readonly passwordDigest: string | undefined;
  readonly salt: string | undefined;
  readonly status: string | undefined;
  readonly childIds: {
    readonly email: number | undefined;
    readonly password: number | undefined;
    readonly salt: number | undefined;
    readonly status: number | undefined;
  };
}

async function loadAccountByJunctionId(
  driver: SQLDatabaseDriver,
  ids: AccountCodenameIds,
  junctionId: number,
): Promise<AccountRecord | undefined> {
  const head = await driver.query<{
    id: number;
    left_id: number;
    junction_name: string | null;
    holder_name: string | null;
    right_name: string | null;
  }>(
    `SELECT a.id, a.left_id, a.name AS junction_name, h.name AS holder_name, r.name AS right_name
     FROM cards a JOIN cards h ON h.id = a.left_id JOIN cards r ON r.id = a.right_id
     WHERE a.id = ? AND a.trash = 0 LIMIT 1`,
    [junctionId],
  );
  const row = head.rows[0];
  if (row === undefined || row.holder_name === null) return undefined;
  const junctionName =
    row.junction_name ?? (row.right_name === null ? null : `${row.holder_name}+${row.right_name}`);
  if (junctionName === null) return undefined;
  return loadAccountChildren(driver, ids, {
    id: row.id,
    leftId: row.left_id,
    name: junctionName,
    holderName: row.holder_name,
  });
}

async function loadAccountChildren(
  driver: SQLDatabaseDriver,
  ids: AccountCodenameIds,
  head: { id: number; leftId: number; name: string; holderName: string },
): Promise<AccountRecord> {
  const fields = await driver.query<{
    right_id: number;
    id: number;
    db_content: string | null;
  }>(
    `SELECT right_id, id, db_content FROM cards
     WHERE left_id = ? AND right_id IN (?, ?, ?, ?) AND trash = 0`,
    [head.id, ids.email, ids.password, ids.salt, ids.status],
  );
  const byRight = new Map<number, { id: number; content: string | undefined }>();
  for (const f of fields.rows) {
    byRight.set(f.right_id, { id: f.id, content: f.db_content ?? "" });
  }
  const pick = (field: "email" | "password" | "salt" | "status") => {
    const hit = byRight.get(ids[field]);
    return hit === undefined
      ? { content: undefined, id: undefined }
      : { content: hit.content, id: hit.id };
  };
  const email = pick("email");
  const password = pick("password");
  const salt = pick("salt");
  const status = pick("status");
  return {
    id: head.id,
    holder: { id: head.leftId, name: head.holderName },
    name: head.name,
    email: email.content,
    passwordDigest: password.content,
    salt: salt.content,
    status: status.content,
    childIds: {
      email: email.id,
      password: password.id,
      salt: salt.id,
      status: status.id,
    },
  };
}

async function findAccountByEmail(
  driver: SQLDatabaseDriver,
  ids: AccountCodenameIds,
  rawEmail: string,
): Promise<AccountRecord | undefined> {
  const email = rubyStrip(rawEmail).toLowerCase();
  const result = await driver.query<{ id: number }>(
    `SELECT a.id FROM cards a
     JOIN cards e ON e.left_id = a.id AND e.right_id = ? AND e.trash = 0
     WHERE a.right_id = ? AND a.trash = 0 AND e.db_content = ?
     ORDER BY a.id LIMIT 1`,
    [ids.email, ids.account, email],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return loadAccountByJunctionId(driver, ids, row.id);
}

function urlKeyOf(accountName: string): string {
  return DeckoName.parse(accountName).urlKey;
}

function toParamQuery(card: Record<string, string>, token: string): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(card)) {
    pairs.push(`${cgiEscape(`card[${key}]`)}=${cgiEscape(value)}`);
  }
  pairs.push(`token=${cgiEscape(token)}`);
  return pairs.join("&");
}

function cgiEscape(value: string): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9\*\-._]/.test(ch)) {
      out += ch;
    } else if (ch === " ") {
      out += "+";
    } else {
      const bytes = new TextEncoder().encode(ch);
      for (const b of bytes) out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

export async function buildAccountTokenUrl(
  ctx: AccountFlowContext,
  accountName: string,
  trigger: "reset_password" | "verify_and_activate",
  extraPayload: Record<string, unknown> = {},
): Promise<{ url: string; token: string }> {
  const userId = await holderIdForAccountName(ctx.driver, accountName);
  if (userId === undefined) {
    throw new Error(`buildAccountTokenUrl: no such account card: ${accountName}`);
  }
  return buildAccountTokenUrlForHolder(ctx, {
    accountName,
    holderId: userId,
    trigger,
    extraPayload,
  });
}

async function buildAccountTokenUrlForHolder(
  ctx: AccountFlowContext,
  parts: {
    accountName: string;
    holderId: number;
    trigger: "reset_password" | "verify_and_activate";
    extraPayload: Record<string, unknown>;
  },
): Promise<{ url: string; token: string }> {
  const token = await encodeAuthToken(ctx.token, parts.holderId, parts.extraPayload);
  const root = ctx.relativeUrlRoot ?? "";
  const url =
    `${ctx.origin}${root}/update/${urlKeyOf(parts.accountName)}` +
    `?${toParamQuery({ trigger: parts.trigger }, token)}`;
  return { url, token };
}

async function holderIdForAccountName(
  driver: SQLDatabaseDriver,
  accountName: string,
): Promise<number | undefined> {
  const key = DeckoName.parse(accountName).key;
  const result = await driver.query<{ left_id: number }>(
    `SELECT left_id FROM cards
     WHERE trash = 0 AND (key = ? OR name = ?) ORDER BY id LIMIT 1`,
    [key, accountName],
  );
  return result.rows[0]?.left_id;
}

export type ResetRequestOutcome =
  | { ok: true; sentTo: string; token: string; resetUrl: string }
  | {
      ok: false;
      reason: "blank_email" | "not_recognized" | "not_active";
      message: string;
    };

export async function sendResetPasswordToken(
  ctx: AccountFlowContext,
  rawEmail: string,
): Promise<ResetRequestOutcome> {
  if (rubyStrip(rawEmail) === "") {
    return { ok: false, reason: "blank_email", message: ACCOUNT_EN.error_blank };
  }
  const ids = await resolveAccountCodenameIds(ctx.driver);
  if (ids === null) {
    return {
      ok: false,
      reason: "not_recognized",
      message: ACCOUNT_EN.error_not_recognized,
    };
  }
  const account = await findAccountByEmail(ctx.driver, ids, rawEmail);
  if (account !== undefined && account.status !== "active") {
    return { ok: false, reason: "not_active", message: ACCOUNT_EN.error_not_active };
  }
  if (account === undefined) {
    return { ok: false, reason: "not_recognized", message: ACCOUNT_EN.error_not_recognized };
  }
  if (account.email === undefined) {
    return { ok: false, reason: "not_recognized", message: ACCOUNT_EN.error_not_recognized };
  }
  const { url, token } = await buildAccountTokenUrlForHolder(ctx, {
    accountName: account.name,
    holderId: account.holder.id,
    trigger: "reset_password",
    extraPayload: {},
  });
  const mail = renderAccountEmail(ctx, RESET_EMAIL_TEMPLATE, { url });
  await ctx.transport.sendMail({ ...mail, to: account.email });
  return { ok: true, sentTo: account.email, token, resetUrl: url };
}

export type VerificationSendOutcome =
  | { ok: true; sentTo: string; token: string; verifyUrl: string }
  | { ok: false; reason: "account_not_found" | "no_email"; message: string };

export async function sendAccountVerificationToken(
  ctx: AccountFlowContext,
  accountMark: string,
): Promise<VerificationSendOutcome> {
  const ids = await resolveAccountCodenameIds(ctx.driver);
  if (ids === null) {
    return { ok: false, reason: "account_not_found", message: "no account system in this deck" };
  }
  const account = await accountForMark(ctx.driver, ids, accountMark);
  if (account === undefined || account.holder.id === undefined) {
    return { ok: false, reason: "account_not_found", message: `no such card: ${accountMark}` };
  }
  if (account.email === undefined || account.email === "") {
    return { ok: false, reason: "no_email", message: `account ${accountMark} has no +*email content` };
  }
  const { url, token } = await buildAccountTokenUrlForHolder(ctx, {
    accountName: account.name,
    holderId: account.holder.id,
    trigger: "verify_and_activate",
    extraPayload: { anonymous: true },
  });
  const mail = renderAccountEmail(ctx, VERIFY_EMAIL_TEMPLATE, { url });
  await ctx.transport.sendMail({ ...mail, to: account.email });
  return { ok: true, sentTo: account.email, token, verifyUrl: url };
}

export async function sendAccountWelcomeEmail(
  ctx: AccountFlowContext,
  accountMark: string,
): Promise<boolean> {
  const ids = await resolveAccountCodenameIds(ctx.driver);
  if (ids === null) return false;
  const account = await accountForMark(ctx.driver, ids, accountMark);
  if (account?.email === undefined || account.email === "") return false;
  const mail = renderAccountEmail(ctx, WELCOME_EMAIL_TEMPLATE, {});
  await ctx.transport.sendMail({ ...mail, to: account.email });
  return true;
}

const EMAIL_DOCUMENT_HEAD =
  '<!DOCTYPE html>\n<html>\n  <head>\n    <meta http-equiv="Content-type" content="text/html;charset=UTF-8"/>\n    <style></style>\n  </head>\n  <body class="d0-email-body">\n    ';
const EMAIL_DOCUMENT_TAIL = "\n  </body>\n</html>\n";

function renderAccountEmail(
  ctx: AccountFlowContext,
  template: typeof RESET_EMAIL_TEMPLATE | typeof VERIFY_EMAIL_TEMPLATE | typeof WELCOME_EMAIL_TEMPLATE,
  vars: { url?: string },
): Omit<MailMessage, "to"> {
  const days = String(DEFAULT_TOKEN_DAYS);
  const rendered = renderAccountTemplate(
    { subject: template.subject, text: template.text, html: template.html },
    { siteTitle: ctx.siteTitle, url: vars.url ?? "", days },
  );
  const from =
    ctx.deckoBotEmail !== undefined
      ? resolveFromAddress(template.from, { deckoBotEmail: ctx.deckoBotEmail })
      : template.from;
  return {
    from,
    ...(ctx.deckoBotEmail !== undefined && template.from !== "" ? { replyTo: addressOf(from) } : {}),
    subject: rendered.subject,
    textBody: rendered.text,
    ...(rendered.html !== undefined && rendered.html.length > 0
      ? { htmlBody: EMAIL_DOCUMENT_HEAD + rendered.html + EMAIL_DOCUMENT_TAIL }
      : {}),
    tags: { trigger: "account_email", template: template.codename },
  };
}

const DEFAULT_TOKEN_DAYS = 2;

export type PasswordResetConfirmation =
  | {
      ok: true;
      holder: Actor;
      accountId: number;
      session: SessionCreation;
      redirectTo: { name: string; view: "edit" };
    }
  | { ok: false; kind: "token_invalid"; message: string }
  | { ok: false; kind: "account_not_found"; message: string }
  | {
      ok: false;
      kind: "token_account_mismatch";
      message: string;
      resent: true;
    };

export async function confirmPasswordReset(
  ctx: AccountFlowContext,
  accountMark: string,
  token: string | undefined | null,
): Promise<PasswordResetConfirmation> {
  const claims = await decodeAuthToken(ctx.token, token);
  if (typeof claims === "string") {
    return { ok: false, kind: "token_invalid", message: claims };
  }
  const ids = await resolveAccountCodenameIds(ctx.driver);
  if (ids === null) {
    return { ok: false, kind: "account_not_found", message: "no account system in this deck" };
  }
  const account = await accountForMark(ctx.driver, ids, accountMark);
  if (account === undefined) {
    return {
      ok: false,
      kind: "account_not_found",
      message: `no such card: ${accountMark}`,
    };
  }
  const tokenUserId = claimUserId(claims);
  if (tokenUserId === undefined || String(tokenUserId) !== String(account.holder.id)) {
    const errorMsg = rubyValueToString(claims);
    await sendResetEmailAsBot(ctx, account);
    return {
      ok: false,
      kind: "token_account_mismatch",
      message: ACCOUNT_EN.sorry_email_reset.replace("%{error_msg}", errorMsg),
      resent: true,
    };
  }
  const session = await ctx.sessions.createSession(account.holder.id);
  return {
    ok: true,
    holder: account.holder,
    accountId: account.id,
    session,
    redirectTo: { name: account.name, view: "edit" },
  };
}

async function sendResetEmailAsBot(
  ctx: AccountFlowContext,
  account: AccountRecord,
): Promise<void> {
  if (account.email === undefined) return;
  const { url } = await buildAccountTokenUrlForHolder(ctx, {
    accountName: account.name,
    holderId: account.holder.id,
    trigger: "reset_password",
    extraPayload: {},
  });
  const mail = renderAccountEmail(ctx, RESET_EMAIL_TEMPLATE, { url });
  await ctx.transport.sendMail({ ...mail, to: account.email });
}

async function accountForMark(
  driver: SQLDatabaseDriver,
  ids: AccountCodenameIds,
  mark: string,
): Promise<AccountRecord | undefined> {
  const id = await liveCardIdForName(driver, DeckoName.parse(mark.replace(/_/g, " ")));
  if (id === undefined) return undefined;
  return loadAccountByJunctionId(driver, ids, id);
}

async function liveCardIdForName(driver: SQLDatabaseDriver, name: DeckoName): Promise<number | undefined> {
  if (name.isSimple) {
    const r = await driver.query<{ id: number }>(
      "SELECT id FROM cards WHERE trash = 0 AND (key = ? OR name = ?) ORDER BY id LIMIT 1",
      [name.key, name.s],
    );
    return r.rows[0]?.id;
  }
  const left = name.leftName === undefined ? undefined : await liveCardIdForName(driver, name.leftName);
  const right = name.rightName === undefined ? undefined : await liveCardIdForName(driver, name.rightName);
  if (left === undefined || right === undefined) return undefined;
  const r = await driver.query<{ id: number }>(
    "SELECT id FROM cards WHERE trash = 0 AND left_id = ? AND right_id = ? ORDER BY id LIMIT 1",
    [left, right],
  );
  return r.rows[0]?.id;
}

function rubyValueToString(claims: TokenClaims): string {
  const inner = Object.entries(claims)
    .map(([key, value]) => {
      let rendered: string;
      if (typeof value === "string") rendered = `"${value}"`;
      else if (value === true) rendered = "true";
      else if (value === false) rendered = "false";
      else if (value === null) rendered = "nil";
      else rendered = String(value);
      return `"${key}"=>${rendered}`;
    })
    .join(", ");
  return `{${inner}}`;
}

export type VerificationConfirmation =
  | {
      ok: true;
      holder: Actor;
      accountId: number;
      session: SessionCreation;
      activated: boolean;
      welcomeSent: boolean;
      redirectTo: { name: string; view: undefined };
    }
  | { ok: false; kind: "token_invalid"; message: string }
  | { ok: false; kind: "account_not_found"; message: string }
  | {
      ok: false;
      kind: "token_account_mismatch";
      message: string;
      resent: true;
    };

export async function confirmAccountVerification(
  ctx: AccountFlowContext,
  accountMark: string,
  token: string | undefined | null,
): Promise<VerificationConfirmation> {
  const claims = await decodeAuthToken(ctx.token, token);
  if (typeof claims === "string") {
    return { ok: false, kind: "token_invalid", message: claims };
  }
  const ids = await resolveAccountCodenameIds(ctx.driver);
  if (ids === null) {
    return { ok: false, kind: "account_not_found", message: "no account system in this deck" };
  }
  const account = await accountForMark(ctx.driver, ids, accountMark);
  if (account === undefined) {
    return {
      ok: false,
      kind: "account_not_found",
      message: `no such card: ${accountMark}`,
    };
  }
  const tokenUserId = claimUserId(claims);
  if (tokenUserId === undefined || String(tokenUserId) !== String(account.holder.id)) {
    if (account.email !== undefined) {
      const { url } = await buildAccountTokenUrlForHolder(ctx, {
        accountName: account.name,
        holderId: account.holder.id,
        trigger: "verify_and_activate",
        extraPayload: { anonymous: true },
      });
      const mail = renderAccountEmail(ctx, VERIFY_EMAIL_TEMPLATE, { url });
      await ctx.transport.sendMail({ ...mail, to: account.email });
    }
    return {
      ok: false,
      kind: "token_account_mismatch",
      message: VERIFY_FAILURE_MESSAGE.replace("%{error_msg}", rubyValueToString(claims)),
      resent: true,
    };
  }
  const bot = await actorBot(ctx.driver);
  const anonymous = claims.anonymous !== undefined && claims.anonymous !== null && claims.anonymous !== false;
  const rootStamperId = anonymous ? await ctx.fetcher.codenames.id("anonymous") : account.holder.id;
  if (rootStamperId === undefined) throw new Error("activation requires the deck's Anonymous account");
  const session = await ctx.sessions.createSession(account.holder.id);
  let activated = false;
  if (account.childIds.status !== undefined) {
    const holder = await ctx.fetcher.fetchById(account.holder.id);
    const signupTypeId = await ctx.fetcher.codenames.id("signup");
    const userTypeId = await ctx.fetcher.codenames.id("user");
    const changesHolderType = signupTypeId !== undefined && holder?.typeId === signupTypeId;
    if (changesHolderType && userTypeId === undefined) throw new Error("activation requires the default User cardtype");
    const engine = new CardActionEngine(ctx.fetcher, {
      actor: bot, actActorId: account.holder.id, currentActorId: account.holder.id, rootStamperId,
      now: ctx.now ?? cardWallClockNow, ipAddress: ctx.ipAddress,
    });
    await engine.updateCard({ cardId: account.id, subcards: {
      "+*status": { content: "active" },
      ...(changesHolderType ? { [account.holder.name]: { typeId: userTypeId! } } : {}),
    } });
    activated = true;
  }
  if (account.email !== undefined) {
    const mail = renderAccountEmail(ctx, WELCOME_EMAIL_TEMPLATE, {});
    await ctx.transport.sendMail({ ...mail, to: account.email });
  }
  return {
    ok: true,
    holder: account.holder,
    accountId: account.id,
    session,
    activated,
    welcomeSent: account.email !== undefined,
    redirectTo: { name: "", view: undefined },
  };
}

export type PasswordWrite =
  | { ok: true; noOp: boolean; passwordCardId?: number; digest?: string }
  | { ok: false; reason: "password_too_short" | "password_missing_char_types"; message: string }
  | { ok: false; reason: "account_not_found" | "no_password_card" | "write_failed"; message: string };

export async function applyNewAccountPassword(
  deps: { driver: SQLDatabaseDriver; fetcher: FetchEngine; actor: Actor },
  accountMark: string,
  newPassword: string,
): Promise<PasswordWrite> {
  if (rubyStrip(newPassword) === "") {
    return { ok: true, noOp: true };
  }
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      reason: "password_too_short",
      message: ACCOUNT_EN.password_length.replace("%{num_char}", String(PASSWORD_MIN_LENGTH)),
    };
  }
  const missing = PASSWORD_REQUIREMENTS.filter((type) =>
    PASSWORD_REGEX[type].test(newPassword) ? false : true,
  ).map((type) => {
    switch (type) {
      case "lower": return ACCOUNT_EN.pw_lower;
      case "upper": return ACCOUNT_EN.pw_upper;
      case "special_char": return ACCOUNT_EN.pw_special_char;
      case "number": return ACCOUNT_EN.pw_number;
    }
  });
  if (missing.length > 0) {
    const consolidated =
      missing.length > 2
        ? `${missing.slice(0, -1).join(", ")}, and ${missing[missing.length - 1]}`
        : missing.join(" and ");
    return {
      ok: false,
      reason: "password_missing_char_types",
      message: ACCOUNT_EN.password_requirements.replace("%{char_type}", consolidated),
    };
  }

  const ids = await resolveAccountCodenameIds(deps.driver);
  if (ids === null) {
    return { ok: false, reason: "account_not_found", message: "no account system in this deck" };
  }
  const account = await accountForMark(deps.driver, ids, accountMark);
  if (account === undefined) {
    return {
      ok: false,
      reason: "account_not_found",
      message: `no such card: ${accountMark}`,
    };
  }
  if (account.childIds.password === undefined) {
    return {
      ok: false,
      reason: "no_password_card",
      message: `no +*password card under ${account.name}`,
    };
  }
  const ownAccount = deps.actor.id === account.holder.id;
  const writeActor = ownAccount ? await actorBot(deps.driver) : deps.actor;
  const engine = new CardActionEngine(deps.fetcher, { actor: writeActor });
  try {
    const saltRow = (
      await deps.driver.query<{ db_content: string | null }>(
        "SELECT db_content FROM cards WHERE id = ?",
        [account.childIds.salt],
      )
    ).rows[0];
    const salt = saltRow?.db_content ?? "";
    const digest = await storedPasswordValue(newPassword, salt);
    await engine.updateCard({ cardId: account.childIds.password, content: digest, passwordEncrypted: true });
  } catch (error) {
    return {
      ok: false,
      reason: "write_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const stored = await deps.driver.query<{ db_content: string | null }>(
    "SELECT db_content FROM cards WHERE id = ?",
    [account.childIds.password],
  );
  const digest = stored.rows[0]?.db_content ?? undefined;
  return { ok: true, noOp: false, passwordCardId: account.childIds.password, digest };
}
